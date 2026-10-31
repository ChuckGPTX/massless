"""Helpers for authoring the Massless contract library. Templates are authored in Python and dumped to JSON."""
import re, textwrap

LAST_REVIEWED = "2026-10-30"
LICENSE = "CC0-1.0"

STATE_CODES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
               "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
               "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]

BASE_DISCLAIMER = ("This is a starting template from the Massless open contract library. It is not legal advice, and "
                   "using it does not create an attorney-client relationship. Laws vary by state and change over time. "
                   "Have a licensed attorney in your state review it before you sign.")

RE_DISCLAIMER = BASE_DISCLAIMER + (" Real estate contracts carry state-specific disclosure, licensing, closing and recording "
                                   "rules. If a real estate licensee is involved, the licensee may be required to use "
                                   "state-promulgated or approved forms instead of this one (for example in Texas and Colorado). "
                                   "Deeds, mortgages and deeds of trust usually must be notarized and recorded; an electronic "
                                   "signature on this document does not record anything.")

CF_DISCLAIMER = RE_DISCLAIMER + (" Creative-finance transactions (subject-to, seller financing, wraps, lease-options, contracts "
                                 "for deed) can trigger lender due-on-sale rights, federal and state lending and licensing "
                                 "laws (Truth in Lending/Dodd-Frank, SAFE Act), state executory-contract statutes and "
                                 "consumer-protection claims. Each party, and especially the seller, should have independent "
                                 "legal counsel and a tax adviser before signing.")

MUSIC_DISCLAIMER = BASE_DISCLAIMER + (" Music rights are split between the composition (song) and the sound recording "
                                      "(master); royalties also depend on PRO, publisher, distributor and label agreements "
                                      "that this template does not change. An entertainment attorney should review deals "
                                      "involving advances, ownership transfers or long terms.")


def ded(s):
    return textwrap.dedent(s).strip("\n").strip()


class V(dict):
    def __init__(self, id, label, type="text", required=True, default="", options=None, help=""):
        super().__init__(id=id, label=label, type=type, required=required, default=default,
                         options=list(options or []), help=help)


def state_var(id="governing_state", label="Governing law (state)", help=None, required=True):
    return V(id, label, "select", required, "", STATE_CODES,
             help or "Two-letter code of the state whose law governs this agreement. Usually where the parties or the work are located.")


class S(dict):
    def __init__(self, title, body, optional=False, showIf=None):
        super().__init__(id="", title=title, body=ded(body), optional=optional)
        if showIf:
            self["showIf"] = showIf
            self["optional"] = True


def opt(title, body, var):
    """Optional section toggled by a bool variable."""
    return S(title, body, True, f"{var} == true")


def when(title, body, expr):
    return S(title, body, True, expr)


def general_terms(extra="", esign=True, gov="governing_state", title="General terms"):
    body = ded("""
    - **Whole agreement.** This document (with any attachments named in it) is the parties' entire agreement on its subject and replaces earlier discussions and drafts.
    - **Changes.** It can only be changed in a writing signed by all parties.
    - **Severability.** If a court finds any part unenforceable, that part is limited to the minimum extent needed and the rest stays in effect.
    - **No waiver.** Not enforcing a term once is not a waiver of it later.
    - **Notices.** Notices must be in writing and delivered by hand, by a recognized courier, by certified mail, or by email to the addresses in this document (or a later address a party gives in writing). Email notice is effective when sent unless the sender receives a bounce-back.
    - **Governing law.** The law of the state of {{%s}} governs this agreement, without regard to conflict-of-law rules.
    """ % gov)
    if esign:
        body += "\n" + ded("""
    - **Counterparts and electronic signatures.** This agreement may be signed in counterparts and electronically. Each party consents to doing business electronically under the federal E-SIGN Act and the state's version of the Uniform Electronic Transactions Act (or New York's Electronic Signatures and Records Act). An electronic signature has the same effect as a handwritten one.
    """)
    if extra:
        body += "\n" + ded(extra)
    return S(title, body)


def sig_block(role, label, name_expr=None, title=False, extra=""):
    lines = [f"**{label}**" + (f" — {name_expr}" if name_expr else ""), "", f"[[sig:{role}]]", "",
             f"Printed name: [[name:{role}]]"]
    if title:
        lines.append(f"Title (if signing for a company): [[text:{role}:Title]]")
    lines.append(f"Date: [[date:{role}]]")
    if extra:
        lines.append(extra)
    return "\n".join(lines)


def signatures(blocks, intro="By signing below, each party agrees to this document."):
    body = intro + "\n\n" + "\n\n".join(sig_block(*b) if isinstance(b, tuple) else sig_block(**b) for b in blocks)
    return S("Signatures", body)


def ack(role, text):
    """An initialed acknowledgment line."""
    return f"- {text} Initials: [[initial:{role}]]"


def T(**kw):
    t = dict(id=kw["id"], version=kw.get("version", 1), title=kw["title"], category=kw["category"],
             summary=kw["summary"], useWhen=kw["useWhen"], watchOuts=kw["watchOuts"],
             jurisdiction=kw.get("jurisdiction", "US"), stateAware=kw.get("stateAware", False),
             roles=[{"id": r, "label": l} for r, l in kw["roles"]], variables=list(kw["variables"]),
             sections=[], disclaimer=kw.get("disclaimer", BASE_DISCLAIMER), sources=kw["sources"],
             license=LICENSE, lastReviewed=LAST_REVIEWED)
    n = 0
    for i, s in enumerate(kw["sections"], 1):
        s = dict(s)
        s["id"] = f"s{i}"
        if not s["title"].startswith(("Signatures", "Exhibit", "Schedule", "Attachment")):
            n += 1
            s["title"] = f"{n}. {s['title']}"
        t["sections"].append(s)
    t["_tags"] = kw.get("tags", [])
    return t


def party_vars(prefix, label, address=True, email=True, help_name=None):
    out = [V(f"{prefix}_name", f"{label}: full legal name", "party", True, "", None,
             help_name or "Full legal name of the person, or the exact registered name of the company.")]
    if address:
        out.append(V(f"{prefix}_address", f"{label}: address", "address", True, "", None, "Mailing address for notices."))
    if email:
        out.append(V(f"{prefix}_email", f"{label}: email", "email", True, "", None, "Email address for notices."))
    return out


def party_line(prefix, label, address=True, email=True):
    s = f"**{label}:** {{{{{prefix}_name}}}}"
    if address:
        s += f", {{{{{prefix}_address}}}}"
    if email:
        s += f" ({{{{{prefix}_email}}}})"
    return s


def src(title, url):
    return {"title": title, "url": url}


# ---------- common sources ----------
SRC = {
    "esign": src("Electronic Signatures in Global and National Commerce Act, 15 U.S.C. §7001 (Cornell LII)", "https://www.law.cornell.edu/uscode/text/15/7001"),
    "esign_exc": src("E-SIGN exceptions, 15 U.S.C. §7003 (Cornell LII)", "https://www.law.cornell.edu/uscode/text/15/7003"),
    "ueta_il": src("DLA Piper: With Illinois's adoption of UETA, US near full adoption (2021)", "https://www.dlapiper.com/en/insights/publications/2021/07/with-illinoiss-adoption-of-ueta-united-states-near-full-adoption"),
    "signnow": src("signNow: Top 5 most e-signed documents", "https://www.signnow.com/blog/top-5-most-e-signed-documents-in-2020/"),
    "docusign": src("Docusign: How to eSign different documents", "https://www.docusign.com/products/electronic-signature/learn/how-to-esign-different-documents"),
    "irs_ic": src("IRS: Independent contractor (self-employed) or employee?", "https://www.irs.gov/businesses/small-businesses-self-employed/independent-contractor-self-employed-or-employee"),
    "dol_ic": src("U.S. Department of Labor: Employee or independent contractor classification under the FLSA", "https://www.dol.gov/agencies/whd/flsa/misclassification"),
    "circ30": src("U.S. Copyright Office Circular 30: Works Made for Hire", "https://www.copyright.gov/circs/circ30.pdf"),
    "usc101": src("17 U.S.C. §101 definitions, including 'work made for hire' (Cornell LII)", "https://www.law.cornell.edu/uscode/text/17/101"),
    "usc204": src("17 U.S.C. §204: execution of transfers of copyright ownership (Cornell LII)", "https://www.law.cornell.edu/uscode/text/17/204"),
    "ucc3": src("UCC Article 3 (Negotiable Instruments), §3-104 (Cornell LII)", "https://www.law.cornell.edu/ucc/3/3-104"),
    "ftc_debt": src("FTC: Debt collection FAQs", "https://consumer.ftc.gov/articles/debt-collection-faqs"),
    "lead_cfr": src("40 CFR 745.113: certification and acknowledgment of disclosure (eCFR)", "https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-F/section-745.113"),
    "lead_epa": src("EPA: Real estate disclosures about potential lead hazards", "https://www.epa.gov/lead/real-estate-disclosures-about-potential-lead-hazards"),
    "lead_pamphlet": src("EPA: Protect Your Family From Lead in Your Home (pamphlet)", "https://www.epa.gov/lead/protect-your-family-lead-your-home-real-estate-disclosure"),
    "lead_usc": src("42 U.S.C. §4852d: disclosure of information concerning lead upon transfer of residential property (Cornell LII)", "https://www.law.cornell.edu/uscode/text/42/4852d"),
    "garn": src("Garn-St Germain Act due-on-sale provisions, 12 U.S.C. §1701j-3 (Cornell LII)", "https://www.law.cornell.edu/uscode/text/12/1701j-3"),
    "regz36": src("Regulation Z, 12 CFR 1026.36 (loan originator rules, seller-financer exclusions) (eCFR)", "https://www.ecfr.gov/current/title-12/chapter-X/part-1026/subpart-E/section-1026.36"),
    "regz43": src("Regulation Z, 12 CFR 1026.43 (ability-to-repay) (eCFR)", "https://www.ecfr.gov/current/title-12/chapter-X/part-1026/subpart-E/section-1026.43"),
    "safe": src("SAFE Act state licensing rules, 12 CFR Part 1008 (eCFR)", "https://www.ecfr.gov/current/title-12/chapter-X/part-1008"),
    "tx_5016": src("Tex. Prop. Code §5.016: conveyance of residential property encumbered by lien", "https://texas.public.law/statutes/tex._prop._code_section_5.016"),
    "tx_exec": src("TexasLawHelp: Executory contracts and lease-to-own real estate (Tex. Prop. Code ch. 5, subch. D)", "https://texaslawhelp.org/article/executory-contracts-and-lease-to-own-real-estate"),
    "tx_wrap": src("Tex. Fin. Code ch. 159: wrap mortgage loan financing", "https://statutes.capitol.texas.gov/Docs/FI/htm/FI.159.htm"),
    "tx_wrap_sum": src("Lone Star Land Law: Wraparound regulation in Texas", "https://lonestarlandlaw.com/?p=6868"),
    "oh_5313": src("Ohio Rev. Code ch. 5313: land installment contracts", "https://codes.ohio.gov/ohio-revised-code/chapter-5313"),
    "nc_47h": src("N.C. Gen. Stat. ch. 47H: contracts for deed", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_47H.html"),
    "il_67": src("Illinois Installment Sales Contract Act, 765 ILCS 67", "https://ilga.gov/legislation/ilcs/ilcs3.asp?ActID=3813"),
    "mn_559": src("Minn. Stat. §559.21: contract for deed termination", "https://www.revisor.mn.gov/statutes/cite/559.21"),
    "az_33742": src("Ariz. Rev. Stat. §33-742: forfeiture under real property contracts", "https://www.azleg.gov/ars/33/00742.htm"),
    "wa_6130": src("Wash. Rev. Code ch. 61.30: Real Estate Contract Forfeiture Act", "https://app.leg.wa.gov/RCW/default.aspx?cite=61.30&full=true"),
    "ia_656": src("Iowa Code ch. 656: forfeiture of real estate contracts", "https://www.legis.iowa.gov/docs/code/656.pdf"),
    "tx_oc1101": src("Tex. Occ. Code §1101.0045 (wholesaling disclosure)", "https://statutes.capitol.texas.gov/Docs/OC/htm/OC.1101.htm"),
    "il_454": src("225 ILCS 454/1-10 (Illinois brokerage definition including assignable contracts)", "https://www.ilga.gov/Documents/legislation/ilcs/documents/022504540K1-10.htm"),
    "wholesale_tracker": src("Squatters.io: cited 50-state wholesaling law tracker (2026)", "https://squatters.io/blog/wholesaling-laws-by-state"),
    "trec": src("Texas Real Estate Commission: contract forms", "https://www.trec.texas.gov/agency-information/contracts"),
    "crec": src("Colorado Division of Real Estate: real estate broker contracts and forms", "https://dre.colorado.gov/real-estate-broker-contracts-and-forms"),
    "nar_disc": src("Seller's Required Disclosures by Jurisdiction (annual survey, May 2020), distributed by NAR", "https://realtorparty.realtor/download/6643"),
    "firpta": src("IRS: FIRPTA withholding", "https://www.irs.gov/individuals/international-taxpayers/firpta-withholding"),
    "fha_roommates": src("42 U.S.C. §3603 Fair Housing Act exemptions (Cornell LII)", "https://www.law.cornell.edu/uscode/text/42/3603"),
    "fha_3604": src("42 U.S.C. §3604 discrimination in sale or rental, including advertising (Cornell LII)", "https://www.law.cornell.edu/uscode/text/42/3604"),
    "turbotenant": src("TurboTenant: security deposit laws by state (updated Feb 2026)", "https://www.turbotenant.com/state/security-deposit-laws-by-state/"),
    "mlc_blanket": src("The MLC: What is a blanket mechanical license?", "https://help.themlc.com/en/support/what-is-a-blanket-mechanical-license"),
    "agg_downloads": src("Arnall Golden Gregory: Misinformation regarding mechanicals and the MLC — downloads (2024)", "https://www.agg.com/news-insights/publications/misinformation-regarding-mechanicals-and-the-mlc-whats-the-deal-with-downloads/"),
    "crb_2026": src("Hypebot: New 2026 US mechanical royalty rates set (13.1¢ per track)", "https://www.hypebot.com/hypebot/2025/12/new-2026-us-mechanical-royalty-rates-set.html"),
    "usc115": src("17 U.S.C. §115: compulsory license for making and distributing phonorecords (Cornell LII)", "https://www.law.cornell.edu/uscode/text/17/115"),
    "sx_lod": src("SoundExchange: Featured Artist Letters of Direction", "https://www.soundexchange.com/what-we-do/for-artists-labels-and-producers/letters-of-direction/"),
    "usc114": src("17 U.S.C. §114: sound recording performance rights, incl. §114(g)(5) producer payments (Cornell LII)", "https://www.law.cornell.edu/uscode/text/17/114"),
    "ascap": src("ASCAP (performing rights organization)", "https://www.ascap.com/"),
    "bmi": src("BMI (performing rights organization)", "https://www.bmi.com/"),
    "sesac": src("SESAC (performing rights organization)", "https://www.sesac.com/"),
    "gmr": src("Global Music Rights (performing rights organization)", "https://globalmusicrights.com/"),
    "circ56a": src("U.S. Copyright Office Circular 56A: Copyright registration of musical compositions and sound recordings", "https://www.copyright.gov/circs/circ56a.pdf"),
    "mma": src("U.S. Copyright Office: The Music Modernization Act", "https://www.copyright.gov/music-modernization/"),
    "usc106": src("17 U.S.C. §106: exclusive rights in copyrighted works (Cornell LII)", "https://www.law.cornell.edu/uscode/text/17/106"),
    "usc201": src("17 U.S.C. §201: ownership of copyright, joint works (Cornell LII)", "https://www.law.cornell.edu/uscode/text/17/201"),
    "usc203": src("17 U.S.C. §203: termination of transfers (Cornell LII)", "https://www.law.cornell.edu/uscode/text/17/203"),
    "irs_partnership": src("IRS: Partnerships", "https://www.irs.gov/businesses/small-businesses-self-employed/partnerships"),
    "irs_llc": src("IRS: Limited liability company (LLC)", "https://www.irs.gov/businesses/small-businesses-self-employed/limited-liability-company-llc"),
    "ulc_rulpa": src("Uniform Law Commission: Uniform Limited Liability Company Act", "https://www.uniformlaws.org/committees/community-home?CommunityKey=bbea2a1b-6c58-4d6c-a2b6-7d1b5bcf3e1a"),
    "sec_jv": src("SEC (Investor.gov): What is a security? (investment contracts)", "https://www.investor.gov/introduction-investing/investing-basics/glossary/security"),
    "ftc_noncompete": src("FTC: Noncompete rule status", "https://www.ftc.gov/legal-library/browse/rules/noncompete-rule"),
    "dtsa": src("Defend Trade Secrets Act whistleblower immunity notice, 18 U.S.C. §1833(b) (Cornell LII)", "https://www.law.cornell.edu/uscode/text/18/1833"),
    "nlrb_mcl": src("NLRB: McLaren Macomb decision on confidentiality and non-disparagement in severance agreements", "https://www.nlrb.gov/news-outreach/news-story/board-rules-that-employers-may-not-offer-severance-agreements-requiring"),
    "speak_out": src("Speak Out Act, 42 U.S.C. §19403 (Cornell LII)", "https://www.law.cornell.edu/uscode/text/42/19403"),
    "eeoc_release": src("EEOC: Understanding waivers of discrimination claims in employee severance agreements", "https://www.eeoc.gov/laws/guidance/qa-understanding-waivers-discrimination-claims-employee-severance-agreements"),
    "cal_1542": src("California Civil Code §1542 (general release)", "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1542"),
    "ucc2": src("UCC Article 2 (sales), §2-312 warranty of title (Cornell LII)", "https://www.law.cornell.edu/ucc/2/2-312"),
    "ucc2_316": src("UCC §2-316: exclusion or modification of warranties (Cornell LII)", "https://www.law.cornell.edu/ucc/2/2-316"),
    "uscis_i9": src("USCIS: Form I-9 employment eligibility verification", "https://www.uscis.gov/i-9"),
    "dol_atwill": src("USA.gov / DOL: Employment at will and termination", "https://www.dol.gov/general/topic/termination"),
    "sba_partner": src("SBA: Choose a business structure", "https://www.sba.gov/business-guide/launch-your-business/choose-business-structure"),
    "hud_pm": src("HUD: Fair housing rights and obligations", "https://www.hud.gov/program_offices/fair_housing_equal_opp/fair_housing_rights_and_obligations"),
    "wmfh_backup": src("17 U.S.C. §101 'work made for hire' categories (sound recordings not listed) (Cornell LII)", "https://www.law.cornell.edu/uscode/text/17/101"),
    "homelight_attorney": src("HomeLight: States that require a real estate attorney at closing (updated Sept 2026)", "https://homelight.com/blog/states-that-require-real-estate-attorney-at-closing"),
    "lodestar_attorney": src("LodeStar: What is an attorney closing state?", "https://support.lodestarss.com/hc/en-us/articles/9787584713243-What-is-an-Attorney-Closing-State"),
    "proof_ron": src("Proof: Is remote online notarization legal in all states? (updated July 2026)", "https://www.proof.com/blog/is-remote-online-notarization-legal-in-all-states"),
    "circ73": src("U.S. Copyright Office Circular 73: Compulsory license for making and distributing phonorecords", "https://www.copyright.gov/circs/circ73.pdf"),
}

STD_SIGN_SOURCES = [SRC["esign"], SRC["esign_exc"]]

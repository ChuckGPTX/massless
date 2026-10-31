"""Build public/office/contracts/states.json."""
from lib import SRC, LAST_REVIEWED

def s(title, url):
    return {"title": title, "url": url}

NAR = SRC["nar_disc"]
TT = SRC["turbotenant"]
PROOF = SRC["proof_ron"]
HL = SRC["homelight_attorney"]
LS = SRC["lodestar_attorney"]
TRACK = SRC["wholesale_tracker"]
NCLC = s("National Consumer Law Center: Toxic Transactions — land installment contracts (2016)", "https://www.nclc.org/images/pdf/pr-reports/report-land-contracts.pdf")
UETA = SRC["ueta_il"]
NY_ESRA = s("New York City Bar: Modernizing New York's electronic signature law (ESRA and UETA)", "https://www.nycbar.org/reports/modernizing-new-york-electronic-signatures-esra-ueta/")

# code: (name, regulator url)
REG = {
    "AL": ("Alabama", "https://arec.alabama.gov/"), "AK": ("Alaska", "https://www.commerce.alaska.gov/web/cbpl/ProfessionalLicensing/RealEstateCommission.aspx"),
    "AZ": ("Arizona", "https://azre.gov/"), "AR": ("Arkansas", "https://arec.arkansas.gov/"), "CA": ("California", "https://www.dre.ca.gov/"),
    "CO": ("Colorado", "https://dre.colorado.gov/real-estate-broker-contracts-and-forms"), "CT": ("Connecticut", "https://portal.ct.gov/dcp"),
    "DE": ("Delaware", "https://dpr.delaware.gov/boards/realestate/"), "DC": ("District of Columbia", "https://dlcp.dc.gov/"),
    "FL": ("Florida", "https://www2.myfloridalicense.com/real-estate-commission/"), "GA": ("Georgia", "https://grec.state.ga.us/"),
    "HI": ("Hawaii", "https://cca.hawaii.gov/reb/"), "ID": ("Idaho", "https://irec.idaho.gov/"), "IL": ("Illinois", "https://idfpr.illinois.gov/"),
    "IN": ("Indiana", "https://www.in.gov/pla/professions/real-estate-home/"), "IA": ("Iowa", "https://plb.iowa.gov/board/real-estate-sales"),
    "KS": ("Kansas", "https://krec.ks.gov/"), "KY": ("Kentucky", "https://krec.ky.gov/"), "LA": ("Louisiana", "https://lrec.gov/"),
    "ME": ("Maine", "https://www.maine.gov/pfr/professionallicensing/professions/real-estate-commission"), "MD": ("Maryland", "https://labor.maryland.gov/license/mrec/"),
    "MA": ("Massachusetts", "https://www.mass.gov/orgs/board-of-registration-of-real-estate-brokers-and-salespersons"),
    "MI": ("Michigan", "https://www.michigan.gov/lara/bureau-list/bpl/occ/prof/real-estate"), "MN": ("Minnesota", "https://mn.gov/commerce/licensing/"),
    "MS": ("Mississippi", "https://www.mrec.ms.gov/"), "MO": ("Missouri", "https://pr.mo.gov/realestate.asp"), "MT": ("Montana", "https://boards.bsd.dli.mt.gov/realty-regulation/"),
    "NE": ("Nebraska", "https://nrec.nebraska.gov/"), "NV": ("Nevada", "https://red.nv.gov/"), "NH": ("New Hampshire", "https://www.oplc.nh.gov/real-estate-commission"),
    "NJ": ("New Jersey", "https://www.nj.gov/dobi/division_rec/"), "NM": ("New Mexico", "https://www.rld.nm.gov/boards-and-commissions/individual-boards-and-commissions/real-estate-commission/"),
    "NY": ("New York", "https://dos.ny.gov/licensing-services"), "NC": ("North Carolina", "https://www.ncrec.gov/"), "ND": ("North Dakota", "https://www.realestatend.org/"),
    "OH": ("Ohio", "https://com.ohio.gov/divisions-and-programs/real-estate-and-professional-licensing"), "OK": ("Oklahoma", "https://oklahoma.gov/orec.html"),
    "OR": ("Oregon", "https://www.oregon.gov/rea/"), "PA": ("Pennsylvania", "https://www.dos.pa.gov/ProfessionalLicensing/BoardsCommissions/RealEstateCommission/"),
    "RI": ("Rhode Island", "https://dbr.ri.gov/real-estate"), "SC": ("South Carolina", "https://llr.sc.gov/re/"), "SD": ("South Dakota", "https://dlr.sd.gov/realestate/"),
    "TN": ("Tennessee", "https://www.tn.gov/commerce/regboards/trec.html"), "TX": ("Texas", "https://www.trec.texas.gov/agency-information/contracts"),
    "UT": ("Utah", "https://commerce.utah.gov/forms/state-approved/"), "VT": ("Vermont", "https://sos.vermont.gov/opr/"),
    "VA": ("Virginia", "https://www.dpor.virginia.gov/Boards/Real-Estate"), "WA": ("Washington", "https://dol.wa.gov/professional-licenses/real-estate-brokers"),
    "WV": ("West Virginia", "https://www.wvrec.org"), "WI": ("Wisconsin", "https://dsps.wi.gov/Pages/BoardsCouncils/RealEstate/ContractualForms/Forms.aspx"),
    "WY": ("Wyoming", "https://realestate.wyo.gov/"),
}

# ---------------- purchase contract forms
FORMS = {
    "TX": dict(type="state-promulgated", publisher="Texas Real Estate Commission (TREC)", free=True,
               note="TREC promulgates residential contract forms (for example the One to Four Family Residential Contract (Resale)). Texas license holders are required to use TREC forms where one applies. The forms are public and free to download. TREC does not promulgate listing agreements, most leases or commercial forms.",
               sources=[SRC["trec"], s("TREC news: revised contract forms (2022)", "https://www.trec.texas.gov/node/2256")]),
    "CO": dict(type="commission-approved", publisher="Colorado Real Estate Commission (via the Division of Real Estate)", free=True,
               note="Brokers must use Commission-approved forms when an approved form exists and is appropriate. The current forms include the Contract to Buy and Sell Real Estate (Residential) and the Seller's Property Disclosure (Residential) for use on and after January 1, 2026. Free fillable PDFs.",
               sources=[SRC["crec"]]),
    "UT": dict(type="state-approved", publisher="Utah Real Estate Commission and Office of the Attorney General", free=True,
               note="Utah Admin. Code R162-2f-401f lists standard forms approved for licensees, including the Real Estate Purchase Contract (REPC), Seller Financing Addendum, All Inclusive Trust Deed and Note, Assumption Addendum and lead-based paint forms. The Utah Division of Real Estate posts them. The Utah Association of REALTORS also publishes association forms.",
               sources=[s("Utah Admin. Code R162-2f-401f: approved forms (Cornell LII)", "https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R162-2f-401f"), s("Utah Division of Real Estate: state-approved forms", "https://commerce.utah.gov/forms/state-approved/")]),
    "WI": dict(type="state-approved", publisher="Wisconsin Department of Safety and Professional Services (Real Estate Examining Board)", free=True,
               note="DSPS publishes the state-approved WB forms (for example WB-11 Residential Offer to Purchase) in its Real Estate Contractual Forms Library, referenced in Wis. Stat. §452.135. Licensees generally must use approved forms. Verify the current versions and rules.",
               sources=[s("Wisconsin DSPS: Real Estate Contractual Forms Library", "https://dsps.wi.gov/Pages/BoardsCouncils/RealEstate/ContractualForms/Forms.aspx")]),
}


def forms_for(code):
    if code in FORMS:
        return FORMS[code]
    name, reg = REG[code]
    return dict(type="not state-promulgated (verify)", publisher=None, free=None,
                note=f"This research did not identify a state-promulgated or state-approved residential purchase contract in {name}. Licensees usually use forms published by the state REALTOR association (copyrighted, generally member-only) or prepared by attorneys. Do not copy association forms. Check the state real estate regulator for any required forms or disclosures.",
                sources=[s(f"{name} real estate regulator", reg)])


# ---------------- seller disclosures (from the NAR-distributed jurisdiction survey, May 2020, plus official text where checked)
# code: (status, citation, note, [extra sources])
DISC = {
    "AL": ("no general statute", "None (Ala. Code §34-27-36 licensee duty to disclose known latent defects)", "No general seller disclosure statute was located. Licensees must disclose known latent structural defects. Special rules cover non-ad valorem assessments and private transfer fees (Ala. Code §§11-81-245, 35-4-435).", []),
    "AK": ("mandatory", "Alaska Stat. §§34.70.010-.200; 12 AAC 64.930", "The seller must deliver the Residential Real Property Transfer Disclosure Statement before the buyer makes a written offer, unless exempt.", []),
    "AZ": ("no general statute", "Ariz. Rev. Stat. §33-422 (affidavit of disclosure for certain unsubdivided land)", "No general statutory form, but known material defects must be disclosed. The Arizona REALTORS Seller's Property Disclosure Statement is widely used. An affidavit of disclosure is required for sales of five or fewer unsubdivided parcels in unincorporated areas.", []),
    "AR": ("no general statute", "None located", "No general seller disclosure statute was located. Specific rules exist, for example for former drug labs (Ark. Code §8-7-1406).", []),
    "CA": ("mandatory", "Cal. Civ. Code §§1102-1102.17 (Transfer Disclosure Statement, §1102.6); §1103 et seq. (Natural Hazard Disclosure, §1103.2)", "Transfer Disclosure Statement and Natural Hazard Disclosure Statement on the statutory forms, plus many specific disclosures. Exemptions in §1102.2.", [s("California Civil Code §1102.6 (Real Estate Transfer Disclosure Statement)", "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1102.6")]),
    "CO": ("mandatory for brokers (Commission form)", "4 CCR 725-1 Rule 7.1; Colo. Rev. Stat. §38-35.7-101 et seq. (specific disclosures)", "Brokers use the Commission-approved Seller's Property Disclosure (Residential). Several statutory disclosures, such as special districts and water source, also apply.", [SRC["crec"]]),
    "CT": ("mandatory", "Conn. Gen. Stat. §20-327b", "Residential Property Condition Disclosure Report on the Department of Consumer Protection form, unless exempt. A Residential Foundation Condition Report is required in some cases.", []),
    "DE": ("mandatory", "Del. Code tit. 6, §§2570-2578", "The seller must disclose known material defects on the Delaware Real Estate Commission form, unless exempt.", []),
    "DC": ("mandatory", "D.C. Code §§42-1301 to 42-1311; 17 DCMR §2708", "The seller must deliver the real property disclosure statement on the regulatory form, unless exempt.", [s("D.C. Code §42-1302 (D.C. Law Library)", "https://code.dccouncil.gov/us/dc/council/code/sections/42-1302")]),
    "FL": ("no statutory form (common-law duty)", "Johnson v. Davis, 480 So. 2d 625 (Fla. 1985); specific statutes", "No statutory general disclosure form, but Florida courts require sellers of residential property to disclose known facts materially affecting value that are not readily observable. Specific statutory disclosures apply (radon, HOA, property tax, and a newer flood disclosure requirement, reported as Fla. Stat. §689.302. Verify the current text and effective date).", []),
    "GA": ("no general statute", "None (general fraud law, O.C.G.A. §23-2-53)", "No general seller disclosure statute was located. Fraud and concealment rules still apply. Association forms commonly include a seller's property disclosure.", []),
    "HI": ("mandatory", "Haw. Rev. Stat. ch. 508D", "The seller must deliver a disclosure statement of material facts within the seller's knowledge or control, unless exempt.", []),
    "ID": ("mandatory", "Idaho Code §§55-2501 to 55-2518 (form at §55-2508)", "Applies to transfers of 1-4 dwelling units, including installment contracts and lease-options.", []),
    "IL": ("mandatory", "Residential Real Property Disclosure Act, 765 ILCS 77", "The seller must complete the statutory Residential Real Property Disclosure Report, unless exempt. Radon and lead disclosures also apply.", [s("765 ILCS 77 (Illinois General Assembly)", "https://www.ilga.gov/legislation/ilcs/ilcs3.asp?ActID=2161")]),
    "IN": ("mandatory", "Ind. Code ch. 32-21-5; 876 IAC 9-1-2", "Seller's Residential Real Estate Sales Disclosure form, unless exempt. An accepted offer is not enforceable until the form is signed.", []),
    "IA": ("mandatory", "Iowa Code ch. 558A; Iowa Admin. Code r. 193E-14.1", "Written disclosure statement containing at least the items in the sample form, unless exempt.", []),
    "KS": ("no general statute", "None located", "No general seller disclosure statute was located. Licensees have disclosure duties, and association forms are commonly used.", []),
    "KY": ("mandatory when a licensee is compensated", "Ky. Rev. Stat. §324.360", "Seller's Disclosure of Property Condition form when a licensee receives compensation, unless exempt.", []),
    "LA": ("mandatory", "La. Rev. Stat. §§9:3196-3200", "Louisiana Property Disclosure Form, or a form with the Commission's minimum language, unless exempt.", []),
    "ME": ("mandatory (no standard form)", "Me. Rev. Stat. tit. 33, §§171-178", "Property disclosure statement covering specified items (water, waste disposal, heating, hazardous materials and more), unless exempt.", []),
    "MD": ("disclosure or disclaimer", "Md. Code, Real Prop. §10-702", "The seller of 1-4 single-family units delivers either the Maryland Residential Property Disclosure Statement or the Disclaimer Statement (Real Estate Commission forms).", []),
    "MA": ("no general statute", "None located (specific statutes)", "No general seller disclosure statute was located. Specific requirements apply, for example lead paint (Mass. Gen. Laws ch. 111, §197A), Title 5 septic inspections and smoke detector certificates.", []),
    "MI": ("mandatory", "Seller Disclosure Act, Mich. Comp. Laws §§565.951-.966 (form at §565.957)", "Seller Disclosure Statement on the statutory form, unless exempt. Local governments may require additional disclosures.", []),
    "MN": ("mandatory (no standard form)", "Minn. Stat. §§513.52-.61", "Written disclosure of all known material facts that could significantly adversely affect the buyer's use and enjoyment. Can be waived in some cases. Separate radon and well disclosures apply.", []),
    "MS": ("mandatory", "Miss. Code §§89-1-501 to -523", "Property Condition Disclosure Statement on the Mississippi Real Estate Commission form, unless exempt.", []),
    "MO": ("no general statute", "None located", "The Missouri Real Estate Commission states Missouri has no mandatory seller's disclosure statement. Specific disclosures apply, for example former drug labs and radioactive contamination.", []),
    "MT": ("no general statute", "None located (specific radon, mold and drug-lab rules)", "No general seller disclosure statute was located, other than specific radon, mold and drug-lab disclosures.", []),
    "NE": ("mandatory", "Neb. Rev. Stat. §76-2,120; 302 Neb. Admin. Code §1-001", "Seller Property Condition Disclosure Statement, substantially in the regulatory form, unless exempt.", []),
    "NV": ("mandatory", "Nev. Rev. Stat. §§113.100-.150", "Seller's Real Property Disclosure Form from the Real Estate Division. It cannot be waived by the buyer.", []),
    "NH": ("specific disclosures (no standard form)", "N.H. Rev. Stat. §477:4-a et seq.", "Specific required disclosures (for example radon, lead, water supply, sewage, insulation and condo or private road information). No mandatory form.", []),
    "NJ": ("regulatory form for licensees, plus flood disclosure", "N.J.A.C. 13:45A-29.1; flood risk disclosure law (P.L.2023, c.93, reported)", "The Seller's Property Condition Disclosure Statement is set out in consumer-fraud regulations for licensees. A 2023 law (reported as P.L.2023, c.93) added flood risk disclosures for sellers and landlords. Verify the current requirements.", []),
    "NM": ("no general statute", "None located", "No general seller disclosure statute was located. Association forms are commonly used.", []),
    "NY": ("mandatory", "N.Y. Real Prop. Law §§462-463", "Property Condition Disclosure Statement, unless exempt. Reported: amendments effective in 2024 removed the option of giving a $500 credit instead of the statement. Verify current text.", [s("N.Y. Real Property Law §462 (NY Senate)", "https://www.nysenate.gov/legislation/laws/RPP/462")]),
    "NC": ("mandatory", "N.C. Gen. Stat. ch. 47E; 21 NCAC 58A .0114", "Residential Property and Owners' Association Disclosure Statement and Mineral and Oil and Gas Rights Mandatory Disclosure Statement (NC Real Estate Commission forms), unless exempt.", [s("N.C. Gen. Stat. ch. 47E", "https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_47E.html")]),
    "ND": ("mandatory when a licensee is involved", "N.D. Real Estate Commission Seller's Property Disclosure Form (2019 law)", "Effective August 1, 2019, when a licensee assists with the sale of an owner-occupied primary residence, the seller must use the Commission's disclosure form.", []),
    "OH": ("mandatory", "Ohio Rev. Code §5302.30; Ohio Admin. Code 1301:5-6-10", "Residential Property Disclosure Form (Ohio Department of Commerce), unless exempt.", [s("Ohio Rev. Code §5302.30", "https://codes.ohio.gov/ohio-revised-code/section-5302.30")]),
    "OK": ("disclosure or disclaimer", "Okla. Stat. tit. 60, §§831-839", "Residential Property Condition Disclosure Statement or Disclaimer Statement (Real Estate Commission forms), unless exempt.", []),
    "OR": ("mandatory", "Or. Rev. Stat. §§105.462-.490 (form at §105.464)", "Seller's property disclosure statement substantially in the statutory form, unless excluded. The buyer has a statutory revocation right after delivery.", []),
    "PA": ("mandatory", "Real Estate Seller Disclosure Law, 68 Pa. C.S. §§7301-7315; 49 Pa. Code §35.335a", "Property disclosure statement meeting at least the requirements of §7304, unless exempt.", []),
    "RI": ("mandatory", "R.I. Gen. Laws §5-20.8-1 et seq.", "Written disclosure of known deficiencies on the Commission form or a substantially conforming form. Lead warning statements are also required.", []),
    "SC": ("mandatory", "S.C. Code §§27-50-10 to -110", "Residential Property Condition Disclosure Statement (SC Real Estate Commission form), unless exempt.", []),
    "SD": ("mandatory", "S.D. Codified Laws §§43-4-38 to -44", "Seller's Property Condition Disclosure Statement on the statutory form, unless exempt.", []),
    "TN": ("disclosure or disclaimer", "Tenn. Code §§66-5-201 to -213", "Residential Property Condition Disclosure statement, or a disclaimer statement where the buyer waives disclosure, unless exempt.", []),
    "TX": ("mandatory (single dwelling unit)", "Tex. Prop. Code §5.008", "Seller's Disclosure Notice in the statutory form, or a substantially similar notice, for most residential property with no more than one dwelling unit, unless exempt. TREC publishes a version (form OP-H).", [s("Tex. Prop. Code §5.008", "https://texas.public.law/statutes/tex._prop._code_section_5.008")]),
    "UT": ("no statutory form", "None located (common law)", "No statute requires a disclosure on a specified form, but known material defects must be disclosed under common law. Association disclosure forms and state-approved lead forms are used.", []),
    "VT": ("no general statute", "None located (lead law disclosures)", "No general seller disclosure statute was located. Vermont lead law disclosure forms apply to pre-1978 housing.", []),
    "VA": ("mandatory (statutory statement)", "Va. Code §§55.1-700 to -723", "Residential Property Disclosure Statement directing buyers to DPOR's online disclosure information. Specific disclosures apply (for example military air installation, defective drywall and septic).", [s("Virginia Code Title 55.1, Chapter 7", "https://law.lis.virginia.gov/vacode/title55.1/chapter7/")]),
    "WA": ("mandatory unless waived", "Wash. Rev. Code ch. 64.06", "Seller disclosure statement on the statutory form (improved or unimproved residential, and commercial). The buyer may waive it except for the environmental section.", [s("RCW 64.06", "https://app.leg.wa.gov/RCW/default.aspx?cite=64.06")]),
    "WV": ("no general statute", "None located", "No general seller disclosure statute was located.", []),
    "WI": ("mandatory", "Wis. Stat. ch. 709", "Real Estate Condition Report (or Vacant Land Disclosure Report) substantially in the statutory form, unless exempt.", [s("Wis. Stat. ch. 709", "https://docs.legis.wisconsin.gov/statutes/statutes/709")]),
    "WY": ("no general statute", "Wyo. Stat. §34-1-151 (vacant land only)", "No general requirement. Sellers of vacant land must provide a basic disclosure statement.", []),
}

# ---------------- attorney closing (sources differ)
ATTY_BOTH = {"CT", "DE", "GA", "MA", "NC", "SC", "WV"}
ATTY_HL_ONLY = {"AL", "KY", "LA", "MS", "NH", "NY", "ND", "RI"}
ATTY_LS_ONLY = {"VT"}
ATTY_PARTIAL = {"WY", "OK", "MD", "ME", "NJ", "HI"}


def atty_for(code):
    if code in ATTY_BOTH:
        st, note = "attorney closing (listed by both sources checked)", "Closings are conducted or supervised by a licensed attorney under statute, court decisions or bar opinions. Confirm current practice locally."
    elif code in ATTY_HL_ONLY:
        st, note = "attorney involvement required in part (sources differ)", "One source lists this state as requiring an attorney to conduct the closing, examine title or prepare documents. Another does not. Verify locally."
    elif code in ATTY_LS_ONLY:
        st, note = "attorney closing customary (sources differ)", "Listed as an attorney closing state by one source. Another says an attorney 'should' examine title and conduct the closing. Verify locally."
    elif code in ATTY_PARTIAL:
        st, note = "attorneys customary for some steps (verify)", "Attorneys are customary for some steps (for example title opinions or preparing deeds) or in some regions, but title or escrow companies commonly close. Verify locally."
    else:
        st, note = "attorney not generally required (verify)", "Neither source checked lists this state as requiring an attorney at closing. Title or escrow companies commonly close. Some documents may still need to be prepared by an attorney or a party. Verify locally."
    return dict(status=st, note=note, sources=[HL, LS])


# ---------------- remote online notarization (per Proof, July 2026; sources conflict)
RON_NONE = {"AL", "CT", "GA", "MS", "SC"}
RON_PENDING = {"CA": "authorized beginning January 2030 (pending implementation)", "MA": "enacted, not yet effective", "NC": "enacted, not yet effective"}


def esign_for(code):
    ueta = "ESRA (New York's own e-signature law; not UETA)" if code == "NY" else "UETA adopted"
    if code in RON_NONE:
        ron = "no RON law reported"
    elif code in RON_PENDING:
        ron = RON_PENDING[code]
    else:
        ron = "effective RON law reported"
    note = ("Electronic signatures are generally valid for contracts under E-SIGN and state law. Deeds, mortgages, deeds of trust and "
            "memoranda must still be signed with the formalities the state requires (acknowledgment before a notary, and witnesses in some states) "
            "and recorded with the county. Remote online notarization (RON) can satisfy notarization only where state law allows it and the "
            "county accepts the recording. E-SIGN does not cover notices of default, foreclosure or eviction for a primary residence.")
    if code == "CT":
        note += " The source reports that Connecticut restricts RON for local real estate closings."
    if code in ("GA", "SC"):
        note += " Attorney-supervision requirements for closings limit RON use in practice."
    srcs = [PROOF, UETA, SRC["esign_exc"]] + ([NY_ESRA] if code == "NY" else [])
    return dict(ueta=ueta, ron=ron, note=note + " Sources conflict on RON status. Verify with the Secretary of State.", sources=srcs)


# ---------------- executory contracts / contracts for deed
EXEC = {
    "TX": ("Tex. Prop. Code ch. 5, subch. D (§§5.061-5.086)", "Applies to residential executory contracts (contracts for deed, and lease-options) longer than 180 days. Required pre-signing disclosures, language of negotiation, recording within 30 days, annual January statements, statutory default notices with 30/60-day cure periods, foreclosure required in some cases, deed within 30 days of final payment, and restrictions on property with liens. Related: Property Code §5.016 lien notice, and Finance Code ch. 159 for wraps.", [SRC["tx_exec"], SRC["tx_5016"], SRC["tx_wrap"]]),
    "OH": ("Ohio Rev. Code ch. 5313", "Land installment contracts (dwellings, over one year) must contain required terms, be signed in duplicate with deed formalities, and be recorded within 20 days. Forfeiture requires notice and cure. After five years of payments or 20% paid, the vendor must foreclose (§5313.07).", [SRC["oh_5313"]]),
    "IL": ("Installment Sales Contract Act, 765 ILCS 67", "For sellers entering more than three contracts in 12 months on 1-4 unit residential property: Attorney General disclosure and a 3-business-day review, 28 required terms, recording within 10 business days, 90-day cure, repair duties, and no prepayment penalties.", [SRC["il_67"]]),
    "NC": ("N.C. Gen. Stat. ch. 47H", "Contracts for deed on principal-dwelling property: acknowledged written contract with required terms, residential disclosure statement, 3-business-day cancellation right in 14-point bold type, and a notice of default with at least a 30-day cure before forfeiture.", [SRC["nc_47h"]]),
    "MN": ("Minn. Stat. §559.21 (termination); §507.235 (recording)", "Statutory cancellation notice and cure procedure. 2024 amendments added residential protections, including barring termination when the vendor failed to record as required by §507.235, plus investor-seller rules.", [SRC["mn_559"]]),
    "AZ": ("Ariz. Rev. Stat. §§33-741 to -749", "Forfeiture of a purchaser's interest is allowed only after statutory grace periods (which lengthen as more of the price is paid) and a notice of election to forfeit. Other defaults or acceleration require foreclosure as a mortgage.", [SRC["az_33742"]]),
    "WA": ("Wash. Rev. Code ch. 61.30 (Real Estate Contract Forfeiture Act)", "Forfeiture requires statutory notices of intent to forfeit and declarations, recording, and cure rights. Purchasers may seek a court-ordered sale instead.", [SRC["wa_6130"]]),
    "IA": ("Iowa Code ch. 656", "Forfeiture of real estate contracts requires a statutory notice and opportunity to cure, and service and recording of proof. A 2016 report also describes a recording requirement for land contract sellers.", [SRC["ia_656"], NCLC]),
    "MI": ("Mich. Comp. Laws §600.5726 and related summary proceedings", "Land contracts are common. After forfeiture, a vendor may recover possession through summary proceedings only if the contract expressly provides for forfeiture. Courts may require foreclosure in some cases.", [s("Mich. Comp. Laws §600.5726", "https://www.legislature.mi.gov/Laws/MCL?objectName=mcl-600-5726")]),
    "OK": ("Okla. Stat. tit. 16, §11A (reported)", "According to a 2016 consumer-law report, Oklahoma treats land installment contracts as mortgages that must be foreclosed. Verify the current statute.", [NCLC]),
    "MD": ("Md. Code, Real Prop. §§10-101 to -108 (reported)", "According to a 2016 consumer-law report, land installment contracts must include specified disclosures, and the purchaser may cancel and get a refund if not given a copy. Verify the current statute.", [NCLC]),
}


def exec_for(code):
    if code in EXEC:
        st, summ, srcs = EXEC[code]
        return dict(statute=st, summary=summ, sources=srcs)
    name = REG[code][0]
    return dict(statute=None, summary=f"No {name}-specific contract-for-deed statute was identified in this research. Courts in many states treat installment land contracts like mortgages, which can require foreclosure. Lease-options can also be recharacterized. Verify locally before using a contract for deed or lease-option.", sources=[NCLC])


# ---------------- wholesaling and assignment rules (per a cited 2026 tracker; official links where given)
WHOLE = {
    "AL": ("SB228 (2023)", "Written disclosures to the seller and later buyers for single-family wholesale assignments, with at least three business days' notice before an assignment takes effect. Penalties include a misdemeanor and civil liability.", [s("Alabama SB228 (2023) enrolled", "https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/2023RS/SB228-enr.pdf")]),
    "AZ": ("Ariz. Rev. Stat. §44-5101 (2022)", "Mandatory written wholesale disclosures to buyer and seller. If not given, the seller may cancel before close of escrow.", [s("Ariz. Rev. Stat. §44-5101", "https://www.azleg.gov/ars/44/05101.htm")]),
    "CT": ("Public Act 25-168 (2025), effective July 1, 2026 (reported)", "Wholesaler registration with the Department of Consumer Protection, written seller disclosures, a 3-business-day seller cancellation right and closing within 90 days.", [s("Connecticut HB 5572 (2025) bill analysis", "https://www.cga.ct.gov/2025/BA/PDF/2025HB-05572-R01-BA.PDF")]),
    "DE": ("SB 201 (2024), 24 Del. C. ch. 29 (reported)", "Residential wholesalers in the business must be licensed (with a transition period), plus consumer protections.", [s("Delaware SB 201 (2024)", "https://legis.delaware.gov/BillDetail?LegislationId=142673")]),
    "GA": ("O.C.G.A. §10-1-393.18 (SB 90 and HB 1292, 2024)", "Unsolicited written offers to buy real property must carry a 'THIS IS A SOLICITATION' notice and fair-market-value disclaimer.", [s("Georgia Department of Law: unsolicited real estate solicitations", "https://consumer.georgia.gov/title-theft-and-unsolicited-real-estate-brokerage-and-mortgage-solicitations")]),
    "IL": ("225 ILCS 454/1-10 (Public Act 101-0357, 2019)", "Dealing in assignable contracts as a pattern of business (two or more times in 12 months) is brokerage that requires a license.", [SRC["il_454"]]),
    "IN": ("Ind. Code ch. 32-21-16.5 (2024)", "Unlicensed solicitations to buy single-family homes must disclose that they are not from a licensed professional. Noncompliance gives the owner a two-day rescission right.", [s("Indiana Code Title 32", "https://iga.in.gov/laws/2024/ic/titles/32")]),
    "IA": ("Iowa Code §543B.6A (2024)", "Wholesaling residential property requires a broker license or representation by one, plus written disclosures before contracting. Noncompliance allows cancellation.", [s("Iowa Code §543B.6A", "https://www.legis.iowa.gov/docs/code/543B.6A.pdf")]),
    "KY": ("Ky. Rev. Stat. §§324.010, 324.020 (HB 62, 2023)", "Advertising an equitable interest in a purchase contract for sale requires a license.", [s("Kentucky HB 62 (2023)", "https://apps.legislature.ky.gov/record/23RS/hb62.html")]),
    "MD": ("Md. Code, Real Prop. §10-715 (2025, reported)", "Written disclosure to the seller before contracting that the buyer may assign the contract. If not given, the seller may rescind before closing with a deposit refund.", [s("Maryland HB 124 (2025)", "https://mgaleg.maryland.gov/mgawebsite/Legislation/Details/hb0124?ys=2025RS")]),
    "MO": ("SB 973 (2026), effective August 28, 2026 (reported)", "A standalone written disclosure to the owner at least 14 days before contracting. If omitted, the owner may cancel and recover earnest money.", [s("Missouri SB 973 (2026)", "https://www.senate.mo.gov/BillTracking/Bills/BillInformation?year=2026&billid=321")]),
    "NE": ("Neb. Rev. Stat. §81-885.02 (LB892, 2022)", "Publicly marketing an equitable interest in a purchase contract is licensed brokerage. The Commission also requires an assignable-contract addendum by rule.", [s("Neb. Rev. Stat. §81-885.02", "https://nebraskalegislature.gov/laws/statutes.php?statute=81-885.02")]),
    "NC": ("HB 797 (2025), not enacted at last report", "A proposed bill would make residential wholesaling licensed brokerage with a homeowner cancellation right. Check its status.", [s("North Carolina HB 797 (2025)", "https://www.ncleg.gov/BillLookup/2025/H797")]),
    "ND": ("N.D. Cent. Code §43-23 (HB 1125, 2025)", "Written disclosure to all parties that the wholesaler holds an equitable interest, may not be able to convey title, and intends to profit.", [s("N.D. Cent. Code ch. 43-23", "https://ndlegis.gov/cencode/t43c23.pdf")]),
    "OH": ("Ohio Rev. Code §5301.95 (SB 155, 2025)", "A separate written wholesaler disclosure to the owner of 1-4 unit residential property, in bold type, signed before a binding contract. The owner may cancel before closing and recover earnest money.", [s("Ohio Rev. Code §5301.95", "https://codes.ohio.gov/ohio-revised-code/section-5301.95")]),
    "OK": ("Okla. Stat. tit. 59, §858-314 (SB 1075, 2025, effective Nov. 1, 2025)", "Pre-agreement disclosure of intent to assign, a notice to seek legal advice, a 2-day homeowner cancellation right, escrow of earnest money and a standard cancellation form. Missing disclosures void the contract.", [s("Oklahoma SB 1075 (2025) enrolled", "https://www.oklegislature.gov/cf_pdf/2025-26%20ENR/SB/SB1075%20ENR.PDF")]),
    "OR": ("Oregon residential property wholesaling law (HB 4058)", "Residential property wholesalers must register with the Oregon Real Estate Agency or hold a license, and must give a written disclosure to potential buyers and sellers before contracting.", [s("Oregon Real Estate Agency: residential property wholesaling", "https://www.oregon.gov/rea/pages/residential-property-wholesaling.aspx")]),
    "PA": ("Act 52 of 2024 (SB 1173), amending the Real Estate Licensing and Registration Act", "A license is required for covered wholesale transactions. Sellers must receive a statement that the buyer intends to assign for a fee, with a non-waivable cancellation right.", [s("Pennsylvania SB 1173 (2023-24)", "https://www.palegis.us/legislation/bills/2023/sb1173")]),
    "SC": ("Act 204 of 2024 (H 4754), S.C. Code §§40-57-30(44), 40-57-350", "Marketing residential property before taking title requires a license. Merely assigning or offering to assign the contract right is excluded.", [s("South Carolina H 4754 (2024)", "https://www.scstatehouse.gov/sess125_2023-2024/bills/4754.htm")]),
    "TN": ("Public Chapter 72 (SB 909, 2025)", "Written disclosure of the nature of the equitable interest to the seller and later buyers, with at least 3 business days' notice before an assignment takes effect.", [s("Tennessee SB 909 (2025)", "https://wapp.capitol.tn.gov/apps/BillInfo/Default?BillNumber=SB0909&GA=114")]),
    "TX": ("Tex. Occ. Code §1101.0045 (as amended by SB 1577, 2023)", "Written disclosure of the nature of the equitable interest to any seller or potential buyer. Failure to disclose is treated as unlicensed brokerage.", [SRC["tx_oc1101"]]),
    "VA": ("Va. Code §54.1-2100 (HB 917, 2024)", "Dealing in assignable contracts for compensation two or more times in 12 months makes a person a broker who must be licensed.", [s("Va. Code §54.1-2100", "https://law.lis.virginia.gov/vacode/title54.1/chapter21/section54.1-2100/")]),
    "WI": ("Wis. Stat. §710.13 (2023 Wisconsin Act 208)", "Written notice to the seller, no later than the purchase agreement, that the buyer is a real property wholesaler. The seller may rescind before closing if not disclosed.", [s("2023 Wisconsin Act 208", "https://docs.legis.wisconsin.gov/2023/related/acts/208")]),
}


def whole_for(code):
    if code in WHOLE:
        law, summ, srcs = WHOLE[code]
        return dict(law=law, summary=summ + " Summarized from a cited tracker; verify against the official text.", sources=srcs + [TRACK])
    name = REG[code][0]
    return dict(law=None, summary=f"No {name} wholesaling-specific statute was listed in the tracker checked. General real estate licensing law still applies: marketing property you don't own, or being paid to bring buyers and sellers together, can be unlicensed brokerage. Verify locally.", sources=[TRACK])


# ---------------- security deposits (summary table, Feb 2026)
DEP = {
    "AL": ("1 month's rent", "60 days after termination and delivery of possession", "Ala. Code §35-9A-201"),
    "AK": ("2 months' rent (no cap where rent exceeds $2,000/month)", "14 days, or 30 days if deductions", "Alaska Stat. §34.03.070"),
    "AZ": ("1.5 months' rent", "14 business days after termination and delivery of possession", "Ariz. Rev. Stat. §33-1321"),
    "AR": ("2 months' rent", "60 days", "Ark. Code §§18-16-304, -305"),
    "CA": ("1 month's rent (most landlords, since July 1, 2024)", "21 days after move-out", "Cal. Civ. Code §1950.5"),
    "CO": ("1 month's rent", "1 month, or up to 60 days if the lease says so", "Colo. Rev. Stat. §§38-12-102.5, -103"),
    "CT": ("2 months' rent (1 month if tenant is 62+)", "30 days after move-out, or 15 days after receiving a forwarding address (summary source; recent amendments reported, verify)", "Conn. Gen. Stat. §47a-21"),
    "DE": ("1 month's rent for leases of 1 year or more", "20 days", "Del. Code tit. 25, §5514"),
    "DC": ("1 month's rent (Security Deposit Act; verify)", "45 days after termination", "D.C. Code §42-3502.17; 14 DCMR §308"),
    "FL": ("No statutory limit", "15 days if no claim; otherwise written notice of the claim within 30 days (summary source lists up to 60 days; verify)", "Fla. Stat. §83.49"),
    "GA": ("No statutory limit", "30 days", "O.C.G.A. §44-7-34"),
    "HI": ("1 month's rent (pet deposit may be added)", "14 days", "Haw. Rev. Stat. §521-44"),
    "ID": ("No statutory limit", "21 days, or up to 30 days if the lease says so", "Idaho Code §§6-320, -321"),
    "IL": ("No statewide limit (local rules, e.g. Chicago)", "45 days; 30 days to itemize deductions", "765 ILCS 710"),
    "IN": ("No statutory limit", "45 days", "Ind. Code §32-31-3-12"),
    "IA": ("2 months' rent", "30 days", "Iowa Code §562A.12"),
    "KS": ("1 month unfurnished; 1.5 months furnished", "14 days after determining deductions, within 30 days after termination", "Kan. Stat. §58-2550"),
    "KY": ("No statutory limit", "Procedure-based (written notice; tenant response period)", "Ky. Rev. Stat. §383.580"),
    "LA": ("No statutory limit", "1 month", "La. Rev. Stat. §9:3251"),
    "ME": ("2 months' rent", "30 days (21 days for tenancies at will)", "Me. Rev. Stat. tit. 14, §§6032, 6033"),
    "MD": ("2 months' rent", "45 days", "Md. Code, Real Prop. §8-203"),
    "MA": ("1 month's rent", "30 days", "Mass. Gen. Laws ch. 186, §15B"),
    "MI": ("1.5 months' rent", "30 days", "Mich. Comp. Laws §§554.602, .609"),
    "MN": ("No statutory limit", "21 days", "Minn. Stat. §504B.178"),
    "MS": ("No statutory limit", "45 days", "Miss. Code §89-8-21"),
    "MO": ("2 months' rent", "30 days", "Mo. Rev. Stat. §535.300"),
    "MT": ("No statutory limit", "10 days if no deductions; 30 days with deductions", "Mont. Code §70-25-202"),
    "NE": ("1 month's rent (pet deposit may be added)", "14 days", "Neb. Rev. Stat. §76-1416"),
    "NV": ("3 months' rent", "30 days", "Nev. Rev. Stat. §118A.242"),
    "NH": ("1 month's rent or $100, whichever is greater", "30 days; 20 days if the landlord shares the unit", "N.H. Rev. Stat. §§540-A:6, -A:7"),
    "NJ": ("1.5 months' rent", "30 days", "N.J. Stat. §§46:8-21.1, -21.2"),
    "NM": ("1 month's rent for leases under 1 year", "30 days", "N.M. Stat. §47-8-18"),
    "NY": ("1 month's rent", "14 days after move-out", "N.Y. Gen. Oblig. Law §7-108"),
    "NC": ("2 weeks (week-to-week), 1.5 months (month-to-month), 2 months (longer)", "30 days; up to 60 days if deductions cannot yet be determined", "N.C. Gen. Stat. §§42-51, -52"),
    "ND": ("1 month's rent (pet deposit may be added)", "30 days", "N.D. Cent. Code §47-16-07.1"),
    "OH": ("No statutory limit", "30 days", "Ohio Rev. Code §5321.16"),
    "OK": ("No statutory limit", "45 days (a written demand by the tenant may be required; verify)", "Okla. Stat. tit. 41, §115"),
    "OR": ("No statutory limit", "31 days", "Or. Rev. Stat. §90.300"),
    "PA": ("2 months' rent (lower limit after the first year; verify)", "30 days", "68 P.S. §§250.511a, 250.512"),
    "RI": ("1 month's rent", "20 days", "R.I. Gen. Laws §34-18-19"),
    "SC": ("No statutory limit", "30 days", "S.C. Code §27-40-410"),
    "SD": ("1 month's rent (higher in limited cases)", "14 days; itemization within 45 days on request", "S.D. Codified Laws §§43-32-6.1, -24"),
    "TN": ("No statutory limit", "30 days (procedure applies)", "Tenn. Code §66-28-301"),
    "TX": ("No statutory limit", "30 days after the tenant surrenders the premises", "Tex. Prop. Code §92.103"),
    "UT": ("No statutory limit", "30 days", "Utah Code §57-17-3"),
    "VT": ("1 month's rent per summary source (verify)", "14 days; 60 days for seasonal property", "Vt. Stat. tit. 9, §4461"),
    "VA": ("2 months' rent", "45 days", "Va. Code §55.1-1226"),
    "WA": ("No statewide limit (Seattle and Tacoma limit deposits)", "21 days per summary source; reported amended to 30 days (verify)", "Wash. Rev. Code §59.18.280"),
    "WV": ("No statutory limit", "60 days, or 45 days after a new tenant moves in, whichever is shorter", "W. Va. Code §37-6A-2"),
    "WI": ("No statutory limit", "21 days", "Wis. Admin. Code ATCP 134.06"),
    "WY": ("No statutory limit", "30 days, or 15 days after receiving a forwarding address, whichever is later", "Wyo. Stat. §1-21-1208"),
}

ROOM_NOTES = {
    "CA": ("A single lodger in an owner-occupied home may be removed under the faster lodger procedure of Cal. Civ. Code §1946.5. Rooms rented to more than one lodger, or by a non-owner, follow regular tenant law.", [s("California Civil Code §1946.5", "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CIV&sectionNum=1946.5")]),
    "NH": ("The deposit return deadline is shorter (20 days) where the landlord shares the unit with the tenant.", [TT]),
}


def landlord_for(code):
    lim, ret, cite = DEP[code]
    srcs = [TT] if code != "DC" else [s("D.C. Code §42-3502.17 (D.C. Law Library)", "https://code.dccouncil.gov/us/dc/council/code/sections/42-3502.17")]
    out = dict(securityDepositLimit=lim, depositReturnDeadline=ret, statute=cite,
               note="Summary values. Many cities add rules (rent control, deposit interest, just-cause eviction, registration). Verify against the statute and local ordinances before setting deposits or serving notices. Room rentals in an owner-occupied home may be treated as tenancies, lodging or something in between depending on the state.",
               sources=srcs)
    if code in ROOM_NOTES:
        out["roomRentalNote"] = dict(text=ROOM_NOTES[code][0], sources=ROOM_NOTES[code][1])
    return out


FEDERAL = {
    "leadBasedPaint": dict(
        summary="For most housing built before 1978, sellers and landlords must disclose known lead-based paint and hazards, provide available records and the EPA pamphlet 'Protect Your Family From Lead in Your Home', include the exact federal Lead Warning Statement, and get signed acknowledgments before the buyer or tenant is obligated. Buyers get a 10-day inspection opportunity unless waived. Keep records 3 years. Exemptions include 0-bedroom units, leases of 100 days or less, elderly or disabled housing without children under 6, foreclosure sales and certified lead-free housing.",
        citations=["42 U.S.C. §4852d", "40 CFR Part 745, Subpart F", "24 CFR Part 35, Subpart A"],
        sources=[SRC["lead_cfr"], SRC["lead_epa"], SRC["lead_pamphlet"], SRC["lead_usc"]]),
    "dueOnSale": dict(
        summary="The Garn-St Germain Act lets lenders enforce due-on-sale clauses, with exemptions for residential property of fewer than five units. Exemptions include transfers to a spouse or children, on death of a borrower to a relative, by divorce decree, into an inter vivos trust where the borrower remains a beneficiary and occupancy does not transfer, and leases of three years or less without an option to purchase. Sales subject-to, wraps, contracts for deed and lease-options to unrelated buyers are generally not exempt.",
        citations=["12 U.S.C. §1701j-3"], sources=[SRC["garn"]]),
    "sellerFinancing": dict(
        summary="Under Regulation Z, a person who regularly extends consumer credit secured by a dwelling can be a creditor and loan originator subject to ability-to-repay and loan-originator rules. Two seller-financer exclusions from the loan-originator definition: (1) a natural person, estate or trust financing one property in 12 months that it owns, did not build as a contractor, with no negative amortization and a fixed rate or adjustable after 5+ years; (2) any person financing three or fewer properties in 12 months that it owns, did not build, fully amortizing, with a good-faith ability-to-repay determination and a fixed or 5+-year adjustable rate. State SAFE Act laws may separately require a mortgage loan originator license.",
        citations=["12 CFR 1026.36(a)(4)-(5)", "12 CFR 1026.43", "12 U.S.C. §5101 et seq. (SAFE Act)", "12 CFR Part 1008"],
        sources=[SRC["regz36"], SRC["regz43"], SRC["safe"]]),
    "eSign": dict(
        summary="The federal E-SIGN Act and state UETA laws (adopted by 49 states and DC; New York uses its own ESRA) make electronic signatures and records legally effective for most contracts. E-SIGN does not apply to wills and testamentary trusts, family-law matters, most UCC articles other than Articles 2 and 2A (so UCC Article 3 negotiable instruments are excluded), court documents, and notices of utility shutoff, default, foreclosure, eviction or right to cure for a primary residence, among others. Recording and notarization follow state law.",
        citations=["15 U.S.C. §7001", "15 U.S.C. §7003", "15 U.S.C. §7021 (transferable records)"],
        sources=[SRC["esign"], SRC["esign_exc"], UETA]),
    "firpta": dict(
        summary="When the seller is a foreign person, the buyer generally must withhold 15% of the amount realized and remit it to the IRS, unless an exception applies. Get a certification of non-foreign status or other FIRPTA documentation at closing.",
        citations=["26 U.S.C. §1445"], sources=[SRC["firpta"]]),
    "fairHousingRoomRentals": dict(
        summary="The Fair Housing Act exempts some owner-occupied dwellings with four or fewer units from some provisions, but not from the ban on discriminatory advertising. The Ninth Circuit held the Act does not reach roommate selection within a single shared dwelling (Fair Housing Council v. Roommate.com, 2012). State and local laws may be broader.",
        citations=["42 U.S.C. §3603(b)", "42 U.S.C. §3604(c)"],
        sources=[SRC["fha_roommates"], SRC["fha_3604"], s("Fair Housing Council v. Roommate.com, 666 F.3d 1216 (9th Cir. 2012) (Justia)", "https://law.justia.com/cases/federal/appellate-courts/ca9/09-55272/09-55272-2012-02-02.html")]),
}


def build():
    states = {}
    for code, (name, reg) in REG.items():
        st, cite, note, extra = DISC[code]
        states[code] = dict(
            code=code, name=name,
            purchaseContractForms=forms_for(code),
            sellerDisclosure=dict(status=st, citation=cite, note=note + " Based on a 2020 jurisdiction survey; verify current law.", sources=[NAR] + extra),
            closingPractice=atty_for(code),
            eSignatureAndNotarization=esign_for(code),
            executoryContracts=exec_for(code),
            wholesaling=whole_for(code),
            landlordTenant=landlord_for(code),
            lastChecked=LAST_REVIEWED,
        )
    return dict(
        version=1, lastChecked=LAST_REVIEWED, license="CC0-1.0",
        disclaimer="General research notes, not legal advice. State laws change often and these summaries may be incomplete or out of date. Each entry cites its sources; verify against the official statute, regulation or agency before relying on it, and have a licensed attorney in the state review any transaction.",
        federal=FEDERAL, states=states)

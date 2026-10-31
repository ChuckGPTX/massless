# Chucksi Sign contract library

Free, open contract templates for Chucksi Sign: everyday agreements, business contracts, real estate, creative finance, music and joint ventures. Each template is a JSON file that the Sign engine fills in, renders and sends for signature.

**This is not legal advice.** Every template is a starting point. Laws vary by state and change often. Have a licensed attorney in your state review a contract before you sign it, especially for real estate, creative finance (subject-to, seller financing, wraps, lease-options, contracts for deed), employment and music deals with ownership transfers. Chucksi is not a law firm, and using these templates does not create an attorney-client relationship.

## Files

- `<id>.json`: one template per file (schema below).
- `index.json`: the catalog `[{id, title, category, tags, summary}]`.
- `states.json`: research notes for the 50 states and DC, plus federal notes. Each claim carries its own sources.
- `../../../tests/contracts_test.py`: validates all of the above (`python3 tests/contracts_test.py`).

## Template format

```json
{ "id": "mutual-nda", "version": 1, "title": "...", "category": "everyday|business|real-estate|creative-finance|music|joint-venture",
  "summary": "...", "useWhen": "...", "watchOuts": ["..."], "jurisdiction": "US", "stateAware": false,
  "roles": [{"id": "partyA", "label": "First party"}],
  "variables": [{"id": "effective_date", "label": "...", "type": "date|text|longtext|money|percent|number|address|email|select|bool|party",
                 "required": true, "default": "", "options": [], "help": "..."}],
  "sections": [{"id": "s1", "title": "1. Purpose", "body": "...", "optional": false, "showIf": "var == 'x'"}],
  "disclaimer": "...", "sources": [{"title": "...", "url": "..."}], "license": "CC0-1.0", "lastReviewed": "2026-10-30" }
```

Conventions the engine can rely on:

- **Bodies** are Markdown-lite: blank lines separate paragraphs, `- ` starts a bullet, `1. ` a numbered item, `**bold**`. No `#` headings inside bodies; the section title is the heading.
- **Placeholders** `{{variable_id}}` always name a declared variable. A `party` variable is a person's or company's full legal name. `bool` defaults are `"true"`, `"false"` or `""`. Values are inserted as typed; an empty optional value renders as blank.
- **Field markers**: `[[sig:role]]`, `[[initial:role]]`, `[[date:role]]` (date signed), `[[name:role]]` (printed name), `[[text:role:Label]]`, `[[check:role:Label]]`. Every role has at least one `[[sig:…]]` and `[[date:…]]`.
- **showIf** is one comparison: `var == 'value'`, `var != 'value'`, or `var == true|false` (bool only). Select comparisons use exact option strings; `var != ''` means "has a value". Sections with `showIf` are always `optional: true`.
- **Required** applies to variables that appear in visible sections. A variable used only inside a hidden section need not be filled.
- **Roles that appear only in hidden sections need no signer.** The split sheet, band partnership and multi-member LLC support 2–4 parties this way (`writer_count` / `member_count`).
- **Section numbers** in titles (`"3. Payment"`) are assigned in file order. When optional sections are hidden, renumber the visible ones (strip `^\d+\.\s` and re-add). Titles starting with `Signatures` or `Exhibit` are not numbered. Bodies never cross-reference section numbers, only section names.
- **stateAware** templates have a `state` select whose options are exactly the 51 codes in `states.json`. Show `states.json.states[state]` (and `federal`) next to the document as reference notes. A few high-impact state rules (for example Texas Property Code §5.016, Texas executory contracts, Ohio, Illinois, North Carolina and Minnesota contract-for-deed rules) are also built in as `showIf: "state == 'XX'"` sections.

## states.json

For each jurisdiction: `purchaseContractForms` (who publishes official forms; Texas TREC, Colorado CREC, Utah and Wisconsin are state-promulgated or state-approved and free), `sellerDisclosure` (status, citation, note), `closingPractice` (attorney-closing status; sources disagree, so this is labeled), `eSignatureAndNotarization` (UETA/ESRA, remote online notarization status, and the reminder that deeds must still be notarized and recorded), `executoryContracts` (contract-for-deed / installment-contract statutes), `wholesaling` (recent assignment/wholesaling laws), `landlordTenant` (deposit limit, return deadline, statute, room-rental notes), and `lastChecked`. `federal` covers lead-based paint (pre-1978 housing), due-on-sale (Garn-St Germain), seller financing under Regulation Z and the SAFE Act, E-SIGN exceptions, FIRPTA and fair housing for room rentals.

Entries marked "reported" or "verify" could not be confirmed against the official text during research. Treat every entry as a research lead, not a rule.

## Dedication (CC0)

The template text, catalog and state notes in this folder are dedicated to the public domain under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). You may copy, modify and use them for any purpose without asking. Quoted government text (for example the federal Lead Warning Statements from 40 CFR 745.113, California Civil Code §1542, and the federal odometer statement) is already public domain. Linked sources belong to their publishers.

All template text was drafted originally for this library in plain English. It does not copy or paraphrase state REALTOR association forms, paid form libraries, or course or mentorship materials. Please keep it that way when contributing.

## Contributing

1. Edit or add a `<id>.json` file following the format above, and add it to `index.json`.
2. Draft original text. Do not paste proprietary forms. Government text may be quoted with a citation.
3. Cite sources for legal claims in `sources`. When you can't verify something, write "verify locally" instead of guessing.
4. Keep the disclaimer, update `lastReviewed`, and bump `version` when you change substance.
5. Run `python3 tests/contracts_test.py` and fix every reported problem.
6. State notes: add or correct an entry in `states.json` with a source URL for every claim, and update `lastChecked`.

## Research sources (main)

- E-signature usage: [signNow: top e-signed documents](https://www.signnow.com/blog/top-5-most-e-signed-documents-in-2020/), [Docusign: eSigning different documents](https://www.docusign.com/products/electronic-signature/learn/how-to-esign-different-documents).
- E-SIGN Act [15 U.S.C. §7001](https://www.law.cornell.edu/uscode/text/15/7001) and [§7003 exceptions](https://www.law.cornell.edu/uscode/text/15/7003); [UETA adoption (DLA Piper)](https://www.dlapiper.com/en/insights/publications/2021/07/with-illinoiss-adoption-of-ueta-united-states-near-full-adoption).
- Real estate forms: [TREC contracts](https://www.trec.texas.gov/agency-information/contracts), [Colorado Commission forms](https://dre.colorado.gov/real-estate-broker-contracts-and-forms), [Utah R162-2f-401f](https://www.law.cornell.edu/regulations/utah/Utah-Admin-Code-R162-2f-401f), [Wisconsin DSPS forms](https://dsps.wi.gov/Pages/BoardsCouncils/RealEstate/ContractualForms/Forms.aspx).
- Seller disclosures: [Seller's Required Disclosures by Jurisdiction (May 2020, distributed by NAR)](https://realtorparty.realtor/download/6643).
- Lead paint: [40 CFR 745.113](https://www.ecfr.gov/current/title-40/chapter-I/subchapter-R/part-745/subpart-F/section-745.113), [EPA](https://www.epa.gov/lead/real-estate-disclosures-about-potential-lead-hazards).
- Creative finance: [Garn-St Germain 12 U.S.C. §1701j-3](https://www.law.cornell.edu/uscode/text/12/1701j-3), [Reg Z 12 CFR 1026.36](https://www.ecfr.gov/current/title-12/chapter-X/part-1026/subpart-E/section-1026.36), [Tex. Prop. Code §5.016](https://texas.public.law/statutes/tex._prop._code_section_5.016), [TexasLawHelp on executory contracts](https://texaslawhelp.org/article/executory-contracts-and-lease-to-own-real-estate), [Tex. Fin. Code ch. 159](https://statutes.capitol.texas.gov/Docs/FI/htm/FI.159.htm), [Ohio ch. 5313](https://codes.ohio.gov/ohio-revised-code/chapter-5313), [765 ILCS 67](https://ilga.gov/legislation/ilcs/ilcs3.asp?ActID=3813), [N.C. ch. 47H](https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/ByChapter/Chapter_47H.html), [NCLC land contract report](https://www.nclc.org/images/pdf/pr-reports/report-land-contracts.pdf).
- Wholesaling: [cited 50-state tracker](https://squatters.io/blog/wholesaling-laws-by-state) plus official statute links in `states.json`.
- Closing and notarization: [HomeLight](https://homelight.com/blog/states-that-require-real-estate-attorney-at-closing), [LodeStar](https://support.lodestarss.com/hc/en-us/articles/9787584713243-What-is-an-Attorney-Closing-State), [Proof RON overview](https://www.proof.com/blog/is-remote-online-notarization-legal-in-all-states).
- Deposits: [TurboTenant state table (Feb 2026)](https://www.turbotenant.com/state/security-deposit-laws-by-state/).
- Music: [Copyright Office Circular 30](https://www.copyright.gov/circs/circ30.pdf) and [Circular 56A](https://www.copyright.gov/circs/circ56a.pdf), [17 U.S.C. §101](https://www.law.cornell.edu/uscode/text/17/101), [The MLC blanket license](https://help.themlc.com/en/support/what-is-a-blanket-mechanical-license), [AGG on MLC and downloads](https://www.agg.com/news-insights/publications/misinformation-regarding-mechanicals-and-the-mlc-whats-the-deal-with-downloads/), [2026 mechanical rates](https://www.hypebot.com/hypebot/2025/12/new-2026-us-mechanical-royalty-rates-set.html), [SoundExchange Letters of Direction](https://www.soundexchange.com/what-we-do/for-artists-labels-and-producers/letters-of-direction/), [ASCAP](https://www.ascap.com/), [BMI](https://www.bmi.com/), [SESAC](https://www.sesac.com/), [GMR](https://globalmusicrights.com/).

## Templates

### Everyday

| Template | What it is for |
| --- | --- |
| `bill-of-sale` — Bill of Sale | Record the sale of a car, boat, equipment or other personal property, with price, condition and title promises. |
| `equipment-rental-agreement` — Equipment Rental Agreement | Rent out equipment, gear or tools with a deposit, condition checks and responsibility for damage. |
| `event-venue-booking` — Event and Venue Booking Agreement | Book a venue or event space with dates, fees, deposits, cancellation and house rules. |
| `general-release` — General Release of Claims | One party gives up claims against another, usually in exchange for a payment. |
| `loan-agreement` — Loan Agreement | A fuller loan contract than a note: purpose, disbursement, repayment, promises, default, and optional collateral. |
| `payment-plan-agreement` — Payment Plan Agreement | Let a customer or debtor pay an existing balance over time, with a schedule and what happens if a payment is missed. |
| `media-release` — Photo, Video and Likeness Release | Permission to photograph or record someone and use their image, voice and name. |
| `promissory-note-unsecured` — Promissory Note (Unsecured) | A borrower's written promise to repay a loan, with interest, payments, late fees and default terms. |

### Business

| Template | What it is for |
| --- | --- |
| `change-order` — Change Order | Document a change to the scope, price or schedule of an existing contract. |
| `consulting-agreement` — Consulting Agreement | Engage a consultant or advisor on an hourly, project or monthly-retainer basis. |
| `offer-letter` — Employment Offer Letter | A clear at-will job offer covering role, pay, start date, benefits and conditions. |
| `independent-contractor-agreement` — Independent Contractor Agreement | Hire a freelancer or independent contractor for defined services, with payment, IP and confidentiality terms. |
| `llc-operating-agreement-multi-member` — Multi-Member LLC Operating Agreement | A plain-English operating agreement for an LLC with two to four members: ownership, votes, money, exits. |
| `mutual-nda` — Mutual Non-Disclosure Agreement | Two parties share confidential information with each other and both agree to protect it. |
| `mutual-release` — Mutual Release of Claims | Two parties settle a dispute or end a relationship by releasing each other from claims. |
| `one-way-nda` — One-Way Non-Disclosure Agreement | One party shares confidential information and the other agrees to protect it. |
| `proposal-acceptance` — Quote and Proposal Acceptance | Turn a quote or proposal into a binding order with a deposit and basic terms. |
| `referral-agreement` — Referral Agreement | Pay a referral or finder's fee to someone who introduces new customers. |
| `commission-agreement` — Sales Commission Agreement | Set out how and when a salesperson or sales representative earns commissions. |
| `services-agreement` — Services Agreement with Statement of Work | A master services agreement with general terms, plus a first statement of work for the specific project. |
| `partnership-agreement` — Simple General Partnership Agreement | Two partners set out contributions, profit split, decisions and what happens if one leaves. |
| `llc-operating-agreement-single-member` — Single-Member LLC Operating Agreement | A simple operating agreement for an LLC with one owner, supporting liability protection and succession. |

### Real estate

| Template | What it is for |
| --- | --- |
| `real-estate-contract-amendment` — Amendment to Real Estate Purchase Contract | Change the price, closing date, repairs or other terms of a signed purchase contract. |
| `assignment-of-contract` — Assignment of Real Estate Purchase Contract | Transfer a buyer's rights under a purchase contract to a new buyer for an assignment fee, with the disclosures many states now require. |
| `bird-dog-agreement` — Bird Dog (Lead Referral) Agreement | Pay a 'bird dog' a fee for finding off-market property leads, while limiting their role to providing information. |
| `earnest-money-receipt` — Earnest Money Receipt | Acknowledge receipt of an earnest money deposit and state how it will be held and released. |
| `lead-based-paint-disclosure` — Lead-Based Paint Disclosure (Sale or Lease) | The federally required lead-based paint disclosure for selling or renting housing built before 1978, using the exact federal warning statements. |
| `property-management-agreement` — Property Management Agreement | Hire a manager to lease, collect rent and maintain rental property, with fees, spending limits and trust-account rules. |
| `real-estate-loi` — Real Estate Letter of Intent (Non-Binding) | Outline the key deal terms for a property before negotiating a full purchase contract. Mostly non-binding. |
| `residential-lease` — Residential Lease Agreement | A plain-English lease for a house, apartment or unit: rent, deposit, maintenance, entry, pets and ending the lease. |
| `residential-purchase-agreement` — Residential Purchase Agreement | A plain-English contract to buy and sell a home, with financing, inspection, title and closing terms, plus hooks for state addenda. |
| `room-rental-agreement` — Room Rental and Co-Living Agreement with House Rules | Rent a private room in a shared home, with shared-space rules, utilities, chores, guests and move-out terms. |
| `real-estate-contract-termination` — Termination of Purchase Contract and Release of Earnest Money | End a purchase contract by agreement and tell the escrow holder how to release the earnest money. |

### Creative finance

| Template | What it is for |
| --- | --- |
| `contract-for-deed` — Contract for Deed (Installment Land Contract) | Seller keeps title while the buyer pays the price in installments, then delivers the deed at payoff. Includes strong state-specific protections. |
| `novation-agreement` — Novation Agreement | Replace one party to a contract with a new party, with the other party's consent, releasing the departing party. |
| `secured-promissory-note` — Promissory Note Secured by Real Estate | The buyer's note for a seller-financed sale, secured by a separately recorded mortgage or deed of trust. |
| `real-estate-joint-venture` — Real Estate Joint Venture Agreement | A capital partner and an operating partner team up on one property: who funds, who works, how profits are split, and how it ends. |
| `lease-option-agreement` — Residential Lease with Option to Purchase | A residential lease paired with a separate, paid option giving the tenant the right (not the obligation) to buy at a set price. |
| `seller-acknowledgments-disclosures` — Seller Acknowledgments and Disclosures (Creative Finance) | Seller confirms, item by item, that they understand the deal, the equity involved, the risks, and that they were advised to get independent counsel. |
| `seller-financing-addendum` — Seller Financing Addendum | Add owner financing terms to a purchase contract: down payment, rate, amortization, balloon, security, insurance and compliance. |
| `subject-to-addendum` — Subject-To Existing Financing Addendum | An original addendum for buying a property subject to the seller's existing mortgage, with separately initialed acknowledgments by buyer and seller. |
| `wraparound-addendum` — Wraparound Financing Addendum (AITD) | Seller finances the sale with a new note that 'wraps' the seller's existing mortgage, which the seller keeps paying from the buyer's payments. |

### Music

| Template | What it is for |
| --- | --- |
| `artist-management-agreement` — Artist Management Agreement | Appoint a personal manager, with commission, what income is excluded, term, post-term (sunset) commissions and limits on authority. |
| `band-partnership-agreement` — Band Partnership Agreement | Two to four band members agree on the band name, money, decisions, songwriting, gear and what happens when someone leaves. |
| `beat-purchase-receipt` — Beat Purchase Receipt and License Summary | A short signed receipt for a beat purchase that records what was bought, the license type and its main limits. |
| `feature-artist-agreement` — Featured Artist Agreement | A guest artist records a verse or feature on another artist's song, for a fee, credit, optional points and an agreed writer share. |
| `master-use-license` — Master Use License (Sound Recording) | License a specific sound recording (master) for use in film, TV, ads, games or online video. |
| `music-collaboration-agreement` — Music Collaboration Agreement | Two artists or producers making a joint project agree on ownership of songs and masters, costs, decisions, income and credit. |
| `producer-exclusive-license` — Producer Agreement: Exclusive Beat License | An artist gets exclusive rights to use a beat, with no caps. The producer stops licensing it, and may keep ownership, take points and receive a SoundExchange share. |
| `producer-beat-lease-nonexclusive` — Producer Agreement: Non-Exclusive Beat Lease | License a beat non-exclusively for one song, with stream, sales and video caps. The producer keeps ownership and can lease the beat to others. |
| `producer-work-for-hire` — Producer Agreement: Work for Hire and Buyout | An artist or label commissions a production and owns the resulting beat and master outright, with a fee, optional points and agreed writer credit. |
| `publishing-admin-agreement` — Publishing Administration or Co-Publishing Agreement | A simple deal where a publisher registers and collects for a songwriter's songs for a fee (admin), or also takes a share of ownership (co-pub). |
| `remix-agreement` — Remix Agreement | Commission a remix of a track, with stems delivery, fee or royalty, credit, ownership of the remix master and approval. |
| `sample-clearance-agreement` — Sample Clearance License | License the use of a portion of an existing recording or song (a sample or interpolation) in a new track. |
| `session-musician-release` — Session Musician and Vocalist Release | Pay a session player or background vocalist a flat fee and get the rights to their recorded performance. |
| `split-sheet` — Song Split Sheet | Record who wrote a song and each writer's ownership share, PRO, IPI number and publisher, ideally on the day it is written. |
| `sync-license` — Synchronization License (Composition) | License a song's composition (music and lyrics) for use in timed relation with video: film, TV, ads, games or online video. |

### Joint venture

| Template | What it is for |
| --- | --- |
| `joint-venture-agreement` — Joint Venture Agreement | Two parties team up on a specific project, sharing contributions, control and profits without merging their businesses. |
| `profit-share-agreement` — Profit Share Agreement | Give someone a share of a business's or project's net profits without giving them ownership. |
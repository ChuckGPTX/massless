from lib import *

TEMPLATES = []
add = TEMPLATES.append

DTSA = ("**Whistleblower immunity notice (18 U.S.C. §1833(b)).** An individual will not be held criminally or civilly liable "
        "under any federal or state trade secret law for disclosing a trade secret (a) in confidence to a government official "
        "or to an attorney solely for the purpose of reporting or investigating a suspected violation of law, or (b) in a "
        "complaint or other document filed under seal in a lawsuit. Nothing in this agreement stops anyone from reporting "
        "possible violations of law to a government agency, testifying truthfully, or exercising rights that cannot be waived by law.")

CONF_DEF = """
"Confidential Information" means non-public information that a party (the "Discloser") shares with the other party (the "Recipient") in connection with the Purpose, in any form, that is marked confidential or that a reasonable person would understand to be confidential from its nature and the circumstances. It includes business plans, finances, pricing, customer and supplier information, product plans, designs, software, data, know-how and trade secrets, and notes or copies that contain or are derived from them.
"""

CONF_EXCL = """
Confidential Information does not include information that the Recipient can show:
- is or becomes public through no fault of the Recipient;
- the Recipient already knew without a duty of confidentiality before receiving it;
- the Recipient receives from a third party who is free to share it; or
- the Recipient develops independently without using the Discloser's information.
"""

CONF_DUTY = """
The Recipient will:
- use Confidential Information only for the Purpose;
- protect it with at least the care it uses for its own similar information, and never less than reasonable care;
- share it only with its employees, contractors and professional advisers who need it for the Purpose and who are bound by confidentiality duties at least as protective as these (the Recipient is responsible for their compliance); and
- promptly tell the Discloser if it learns of any unauthorized use or disclosure.
"""

COMPELLED = """
If a law, regulation, subpoena or court order requires the Recipient to disclose Confidential Information, the Recipient may do so after (where legally allowed) giving the Discloser prompt notice and reasonable help, at the Discloser's expense, to seek a protective order. The Recipient will disclose only what is legally required.
"""

RETURN = """
Within {{return_days}} days after the Discloser's written request, or when the Purpose ends, the Recipient will return or destroy the Discloser's Confidential Information and confirm this in writing if asked. The Recipient may keep copies required by law or stored in routine backups, which stay subject to this agreement while kept.
"""

NO_LICENSE = """
- All Confidential Information stays the property of the Discloser. No license or other right is granted except the limited right to use it for the Purpose.
- Confidential Information is provided "as is," without warranties.
- Neither party is obligated to enter into any further agreement or transaction. Each party may develop or acquire products or services that compete with the other's, as long as it does not use the other's Confidential Information.
"""

REMEDIES = """
Unauthorized use or disclosure may cause harm that money cannot fully repair. The Discloser may seek an injunction or other court order to stop a breach, in addition to any other remedy, without having to post a bond where the law allows.
"""

NDA_SOURCES = [SRC["dtsa"], SRC["signnow"], SRC["docusign"], SRC["esign"]]

NDA_WATCH = [
    "Define the Purpose narrowly. A vague purpose makes it hard to prove misuse.",
    "Trade secrets should be protected for as long as they remain trade secrets. A fixed end date on the confidentiality period can weaken that protection.",
    "If the other party is an individual employee or contractor, keep the whistleblower immunity notice (18 U.S.C. §1833(b)). Leaving it out can cost an employer exemplary damages and attorney fees in a trade secret case.",
    "Non-solicitation and non-compete terms are restricted or void in some states, for example California. Courts also look closely at their scope and length. Verify locally before turning on the optional clause.",
    "An NDA cannot stop someone from reporting possible illegal conduct to the government or testifying. Clauses that try to are unenforceable and can create liability.",
]

# ------------------------------------------------------------------ mutual NDA
add(T(
    id="mutual-nda", title="Mutual Non-Disclosure Agreement", category="business",
    tags=["nda", "confidentiality", "mutual", "business", "most-signed"],
    summary="Two parties share confidential information with each other and both agree to protect it.",
    useWhen="Two businesses or people are exploring a deal, partnership or project and both will share non-public information.",
    watchOuts=NDA_WATCH,
    roles=[("partyA", "First party"), ("partyB", "Second party")],
    variables=[V("effective_date", "Effective date", "date", help="Date the agreement starts. Information shared on or after this date is covered.")]
    + party_vars("party_a", "First party") + party_vars("party_b", "Second party") + [
        V("purpose", "Purpose", "longtext", help="Why the information is being shared, e.g. 'evaluating a possible software licensing deal between the parties'."),
        V("term_years", "Agreement term (years)", "number", default="2", help="How long either party may keep sharing new information under this agreement."),
        V("confidentiality_years", "Confidentiality period (years)", "number", default="3", help="How long after the term ends the duty to protect information lasts. Trade secrets stay protected for as long as they remain trade secrets."),
        V("return_days", "Days to return or destroy information", "number", default="30", help="How many days a party has to return or destroy information after a request."),
        V("include_nonsolicit", "Include non-solicitation of employees?", "bool", False, "false", help="Each party agrees not to recruit the other's employees it met through the Purpose. Restricted in some states."),
        V("nonsolicit_months", "Non-solicitation period (months)", "number", False, "12", help="Keep this short and reasonable. 6 to 12 months is common."),
        state_var(),
    ],
    sections=[
        S("Parties and purpose", party_line("party_a", "First party") + "\n\n" + party_line("party_b", "Second party") + """

The parties want to share information with each other for this purpose: {{purpose}} (the "Purpose"). Each party may be a Discloser and a Recipient. This agreement starts on {{effective_date}}."""),
        S("Confidential Information", CONF_DEF),
        S("What is not confidential", CONF_EXCL),
        S("How information must be protected", CONF_DUTY),
        S("Disclosures required by law", COMPELLED),
        S("Rights that are not limited", DTSA),
        S("Return or destruction", RETURN),
        S("Ownership, no warranty, no obligation", NO_LICENSE),
        S("Term", """
This agreement covers information shared during {{term_years}} years from the effective date, unless a party ends it earlier with 30 days' written notice. The duty to protect Confidential Information continues for {{confidentiality_years}} years after the term ends, and for trade secrets, for as long as they remain trade secrets under applicable law."""),
        S("Remedies", REMEDIES),
        opt("Non-solicitation of employees", """
During the term and for {{nonsolicit_months}} months after it ends, neither party will directly solicit for employment any employee of the other party whom it first met or learned about through the Purpose. General job advertisements, and hiring people who respond to them without targeted solicitation, are not a breach. This section does not apply where prohibited by law.""", "include_nonsolicit"),
        general_terms(),
        signatures([("partyA", "First party", "{{party_a_name}}", True), ("partyB", "Second party", "{{party_b_name}}", True)]),
    ],
    sources=NDA_SOURCES,
))

# ------------------------------------------------------------------ one-way NDA
add(T(
    id="one-way-nda", title="One-Way Non-Disclosure Agreement", category="business",
    tags=["nda", "confidentiality", "unilateral", "business", "most-signed"],
    summary="One party shares confidential information and the other agrees to protect it.",
    useWhen="Only one side is sharing sensitive information, for example a founder pitching an investor, a business evaluating a vendor or contractor, or a seller giving financials to a buyer.",
    watchOuts=NDA_WATCH + ["Investors and large companies often refuse to sign one-way NDAs for early pitches. Share only what you must until a deal is closer."],
    roles=[("discloser", "Disclosing party"), ("recipient", "Receiving party")],
    variables=[V("effective_date", "Effective date", "date", help="Date the agreement starts.")]
    + party_vars("discloser", "Disclosing party") + party_vars("recipient", "Receiving party") + [
        V("purpose", "Purpose", "longtext", help="Why the information is being shared, e.g. 'evaluating the purchase of the Discloser's landscaping business'."),
        V("confidentiality_years", "Confidentiality period (years)", "number", default="3", help="How long the duty lasts after the last disclosure. Trade secrets stay protected for as long as they remain trade secrets."),
        V("return_days", "Days to return or destroy information", "number", default="15", help="Days to return or destroy information after a request."),
        V("include_nonsolicit", "Include non-solicitation of employees and customers?", "bool", False, "false", help="Recipient agrees not to recruit the Discloser's employees or solicit its customers learned through the Purpose."),
        V("nonsolicit_months", "Non-solicitation period (months)", "number", False, "12", help="Keep it short and reasonable."),
        state_var(),
    ],
    sections=[
        S("Parties and purpose", party_line("discloser", "Disclosing party (Discloser)") + "\n\n" + party_line("recipient", "Receiving party (Recipient)") + """

The Discloser will share information with the Recipient for this purpose: {{purpose}} (the "Purpose"). This agreement starts on {{effective_date}}. Only the Discloser's information is covered."""),
        S("Confidential Information", CONF_DEF),
        S("What is not confidential", CONF_EXCL),
        S("How information must be protected", CONF_DUTY),
        S("Disclosures required by law", COMPELLED),
        S("Rights that are not limited", DTSA),
        S("Return or destruction", RETURN),
        S("Ownership, no warranty, no obligation", NO_LICENSE),
        S("How long this lasts", """
The Recipient's duties continue for {{confidentiality_years}} years after the last disclosure, and for trade secrets, for as long as they remain trade secrets under applicable law."""),
        S("Remedies", REMEDIES),
        opt("Non-solicitation", """
For {{nonsolicit_months}} months after the last disclosure, the Recipient will not use Confidential Information to solicit the Discloser's customers, and will not directly solicit for employment any of the Discloser's employees it first met through the Purpose. General job advertisements are not a breach. This section does not apply where prohibited by law.""", "include_nonsolicit"),
        general_terms(),
        signatures([("discloser", "Disclosing party", "{{discloser_name}}", True), ("recipient", "Receiving party", "{{recipient_name}}", True)]),
    ],
    sources=NDA_SOURCES,
))

# ------------------------------------------------------------------ IP clauses shared
IP_ASSIGN = """
**Client owns the deliverables.** When Client has paid in full, Contractor assigns to Client all rights, title and interest, including copyrights, in the work product Contractor creates specifically for Client under this agreement (the "Deliverables"). To the extent any Deliverable qualifies as a "work made for hire" under U.S. copyright law, it is one. Where it does not, this assignment applies. Contractor will sign any further documents reasonably needed to confirm Client's ownership.

**Contractor's existing materials.** Contractor keeps ownership of tools, templates, code libraries, know-how and materials it owned before this agreement or developed independently ("Background Materials"). If Background Materials are built into a Deliverable, Contractor grants Client a non-exclusive, perpetual, royalty-free, worldwide license to use them as part of that Deliverable.

**Portfolio.** Unless the Confidentiality section prevents it, Contractor may show non-confidential Deliverables in its portfolio after they are public.
"""

IP_LICENSE = """
**Contractor keeps ownership.** Contractor owns the work product it creates under this agreement (the "Deliverables"), including all copyrights.

**Client's license.** When Client has paid in full, Contractor grants Client a non-exclusive, perpetual, worldwide, royalty-free license to use, copy, modify and display the Deliverables for Client's own business purposes. Client may not resell or sublicense the Deliverables as a standalone product without Contractor's written consent.
"""

IC_WATCH = [
    "Calling someone a contractor does not make them one. The IRS, the U.S. Department of Labor and state agencies look at who controls how, when and where the work is done. Some states, for example California, apply a stricter 'ABC' test. Misclassification can mean back taxes, wages and penalties.",
    "Under U.S. copyright law, work by a non-employee is usually not a 'work made for hire' unless it fits one of nine statutory categories and a signed writing says so. That is why the IP section also includes an assignment.",
    "Pay attention to when IP transfers. This template transfers it on full payment. Some clients need ownership as soon as work is created.",
    "Non-compete clauses are void or limited in several states, for example California, Minnesota, North Dakota and Oklahoma. This template leaves them out.",
    "Collect a Form W-9 before the first payment. You may need to file a Form 1099-NEC for payments to the contractor.",
]

# ------------------------------------------------------------------ Independent contractor agreement
add(T(
    id="independent-contractor-agreement", title="Independent Contractor Agreement", category="business",
    tags=["contractor", "freelance", "1099", "services", "most-signed"],
    summary="Hire a freelancer or independent contractor for defined services, with payment, IP and confidentiality terms.",
    useWhen="A business engages an individual or small firm to do work as an independent business, not as an employee.",
    watchOuts=IC_WATCH,
    roles=[("client", "Client"), ("contractor", "Contractor")],
    variables=[V("effective_date", "Effective date", "date", help="Date the engagement starts.")]
    + party_vars("client", "Client") + party_vars("contractor", "Contractor") + [
        V("services", "Services", "longtext", help="What the contractor will do and deliver. Be specific about deliverables, quantities and quality standards."),
        V("end_date", "End date or condition", "text", default="when the services are complete", help="A date, or a condition such as 'when the services are complete'."),
        V("fee_type", "How the contractor is paid", "select", default="fixed", options=["fixed", "hourly", "milestones"], help="Fixed fee, hourly rate, or by milestone."),
        V("fixed_fee", "Fixed fee", "money", False, help="Total fee for the services. Used when the fee type is fixed."),
        V("hourly_rate", "Hourly rate", "money", False, help="Rate per hour. Used when the fee type is hourly."),
        V("hours_cap", "Maximum hours without written approval", "number", False, "40", help="Contractor needs Client's written approval to bill more than this."),
        V("milestones", "Milestones and amounts", "longtext", False, help="List each milestone, its due date and the amount payable on acceptance."),
        V("invoice_frequency", "Invoice frequency", "select", default="monthly", options=["weekly", "every two weeks", "monthly", "on completion"], help="How often the contractor invoices."),
        V("payment_days", "Days to pay invoices", "number", default="15", help="Client pays each undisputed invoice within this many days."),
        V("expenses", "Are pre-approved expenses reimbursed?", "bool", False, "false", help="If on, the client reimburses reasonable, pre-approved, documented expenses."),
        V("ip_model", "Who owns the work product?", "select", default="client owns", options=["client owns", "contractor owns, client licensed"], help="Most clients want to own custom work. Choose a license if the contractor reuses the work."),
        V("termination_days", "Notice to end without cause (days)", "number", default="14", help="Either party may end the agreement with this much written notice."),
        V("include_insurance", "Require contractor insurance?", "bool", False, "false", help="Require general liability or professional liability insurance."),
        V("insurance_amount", "Minimum insurance per occurrence", "money", False, "1000000", help="Common minimum is $1,000,000 per occurrence."),
        state_var(),
    ],
    sections=[
        S("Parties", party_line("client", "Client") + "\n\n" + party_line("contractor", "Contractor") + "\n\nThis agreement starts on {{effective_date}} and continues until {{end_date}}, unless ended earlier under the Ending this agreement section."),
        S("Services", """
Contractor will perform the following services (the "Services"):

{{services}}

Contractor will perform the Services professionally, on time and in line with generally accepted industry standards. Any change to the Services must be agreed in writing, for example with a signed change order."""),
        S("Independent contractor relationship", """
- Contractor is an independent business, not Client's employee, partner or agent.
- Contractor controls how, when and where the Services are performed, and provides its own equipment and tools, except as stated in the Services.
- Contractor may work for others, as long as it meets its obligations under this agreement.
- Contractor is responsible for its own taxes, insurance, licenses and benefits. Client will not withhold taxes and will issue any required tax forms (such as Form 1099-NEC).
- Contractor has no authority to sign contracts or make commitments for Client."""),
        when("Fees: fixed fee", "Client will pay Contractor a fixed fee of {{fixed_fee}} for the Services. Contractor will invoice {{invoice_frequency}}.", "fee_type == 'fixed'"),
        when("Fees: hourly", "Client will pay Contractor {{hourly_rate}} per hour, invoiced {{invoice_frequency}} with a description of the work and hours. Contractor will not bill more than {{hours_cap}} hours without Client's written approval.", "fee_type == 'hourly'"),
        when("Fees: milestones", "Client will pay Contractor by milestone, as follows:\n\n{{milestones}}\n\nEach payment becomes due when Client accepts the milestone deliverable. Client will accept or give written reasons for rejecting it within 7 days of delivery.", "fee_type == 'milestones'"),
        S("Payment", """
Client will pay each undisputed invoice within {{payment_days}} days of receiving it. If Client disputes part of an invoice, it will pay the undisputed part and tell Contractor in writing what it disputes and why. The parties will try in good faith to resolve the dispute promptly."""),
        opt("Expenses", "Client will reimburse reasonable, documented out-of-pocket expenses that Client approved in writing in advance. Contractor will include receipts with its invoice.", "expenses"),
        when("Intellectual property: client owns", IP_ASSIGN, "ip_model == 'client owns'"),
        when("Intellectual property: contractor owns", IP_LICENSE, "ip_model == 'contractor owns, client licensed'"),
        S("Confidentiality", """
Contractor will keep confidential all non-public information it receives from Client, use it only to perform the Services, and return or destroy it when the Services end or when Client asks. This duty continues for three years after this agreement ends, and for trade secrets, for as long as they remain trade secrets.

""" + DTSA),
        S("Warranties", """
Contractor promises that (a) it has the right to enter into this agreement, (b) the Deliverables will be its original work or properly licensed, and to its knowledge will not infringe anyone else's rights, and (c) it will follow applicable laws in performing the Services."""),
        S("Liability", """
Contractor will defend and indemnify Client against third-party claims that the Deliverables infringe intellectual property rights, or that arise from Contractor's gross negligence or willful misconduct. Except for that indemnity, confidentiality breaches, and amounts owed for Services, neither party is liable for indirect or consequential damages, and each party's total liability is limited to the fees paid or payable under this agreement."""),
        opt("Insurance", "During the agreement, Contractor will keep commercial general liability insurance (and professional liability insurance, if the Services are professional services) of at least {{insurance_amount}} per occurrence, and will provide a certificate of insurance on request.", "include_insurance"),
        S("Ending this agreement", """
Either party may end this agreement for any reason with {{termination_days}} days' written notice. Either party may end it immediately if the other materially breaches it and does not fix the breach within 10 days after written notice. When it ends, Client will pay for Services performed and approved expenses incurred up to the end date. Contractor will deliver all completed and in-progress work that Client has paid for. The sections on payment, intellectual property, confidentiality and liability continue after the agreement ends."""),
        general_terms(),
        signatures([("client", "Client", "{{client_name}}", True), ("contractor", "Contractor", "{{contractor_name}}", True)]),
    ],
    sources=[SRC["irs_ic"], SRC["dol_ic"], SRC["circ30"], SRC["usc101"], SRC["dtsa"], SRC["signnow"]],
))

# ------------------------------------------------------------------ Services agreement + SOW
add(T(
    id="services-agreement", title="Services Agreement with Statement of Work", category="business",
    tags=["msa", "services", "statement of work", "sow", "vendor", "most-signed"],
    summary="A master services agreement with general terms, plus a first statement of work for the specific project.",
    useWhen="A business provides services, such as agency, IT, marketing, design or maintenance, to a client and expects more than one project. Add later projects as new statements of work.",
    watchOuts=[
        "If the statement of work and the general terms disagree, decide which one controls. This template lets the statement of work control only where it expressly says it overrides a section.",
        "Acceptance testing protects both sides. Without a deadline, a client can delay acceptance and payment indefinitely.",
        "Liability caps and indemnities are the most negotiated terms. Make sure the cap fits the size of the deal.",
        "If the provider will handle personal data, such as health, financial or children's data, you may need a data processing agreement and sector-specific terms, such as a HIPAA business associate agreement.",
        "Auto-renewal clauses with consumers are regulated in many states. This template is meant for business-to-business use.",
    ],
    roles=[("client", "Client"), ("provider", "Service provider")],
    variables=[V("effective_date", "Effective date", "date", help="Date the master agreement starts.")]
    + party_vars("client", "Client") + party_vars("provider", "Service provider") + [
        V("sow_title", "Statement of work title", "text", default="Statement of Work No. 1", help="Name of the first project."),
        V("sow_scope", "Scope of services", "longtext", help="What the provider will do in this project."),
        V("sow_deliverables", "Deliverables", "longtext", help="List each deliverable and its format."),
        V("sow_timeline", "Timeline and milestones", "longtext", help="Key dates, phases and dependencies."),
        V("sow_client_duties", "Client responsibilities", "longtext", False, "Provide timely feedback, access and materials needed for the services.", help="What the client must provide, such as content, access, approvals or a point of contact."),
        V("sow_fees", "Fees for this statement of work", "longtext", help="Amount and structure, e.g. '$12,000 fixed: 50% on signing, 50% on acceptance'."),
        V("acceptance_days", "Acceptance review period (days)", "number", default="10", help="Days the client has to accept or reject a deliverable. If it does neither, the deliverable is accepted."),
        V("payment_days", "Days to pay invoices", "number", default="30", help="Net payment terms."),
        V("late_interest", "Late interest per month", "percent", False, "1", help="Interest on overdue amounts, capped at the highest lawful rate. Leave it at or below your state's limit."),
        V("warranty_days", "Warranty period (days)", "number", default="30", help="The provider fixes defects reported within this many days after acceptance."),
        V("liability_cap", "Liability cap", "select", default="fees paid in the prior 12 months", options=["fees paid in the prior 12 months", "fees under the applicable statement of work", "a fixed amount"], help="Maximum each party can owe for most claims."),
        V("liability_cap_amount", "Fixed liability cap amount", "money", False, help="Used only if the cap is 'a fixed amount'."),
        V("ip_model", "Who owns the deliverables?", "select", default="client owns on payment", options=["client owns on payment", "provider owns, client licensed"], help="Who owns the custom work product."),
        V("termination_days", "Notice to end without cause (days)", "number", default="30", help="Either party may end the master agreement with this much notice."),
        state_var(),
    ],
    sections=[
        S("Parties and structure", party_line("client", "Client") + "\n\n" + party_line("provider", "Service provider (Provider)") + """

This master agreement starts on {{effective_date}}. Provider will perform services described in one or more statements of work ("SOWs") signed by both parties. Each SOW is part of this agreement. The first SOW is attached as Exhibit A. If an SOW conflicts with these general terms, these terms control unless the SOW expressly says which section it overrides."""),
        S("Performance", """
Provider will perform the services in a professional and workmanlike manner, using qualified personnel, in line with the SOW and generally accepted industry standards. Client will perform the client responsibilities in each SOW. Provider is not responsible for delays caused by Client's failure to do so."""),
        S("Changes", """
Either party may request a change to an SOW. A change takes effect only when both parties sign a written change order describing the change and any adjustment to fees and schedule."""),
        S("Acceptance", """
Client will review each deliverable within {{acceptance_days}} days of delivery and either accept it or describe in writing how it fails to meet the SOW. Provider will fix those failures and redeliver. If Client does not respond within the review period, or uses the deliverable in production, it is accepted."""),
        S("Fees and payment", """
Client will pay the fees in each SOW. Provider will invoice as stated in the SOW. Client will pay undisputed amounts within {{payment_days}} days of the invoice date. Overdue undisputed amounts may bear interest at {{late_interest}}% per month or the highest rate allowed by law, whichever is lower. After 15 days' written notice of non-payment, Provider may pause work until overdue amounts are paid. Fees do not include taxes. Client pays applicable sales and use taxes, but not taxes on Provider's income."""),
        S("Independent contractor", "Provider is an independent contractor. Provider is responsible for its personnel, their pay, taxes and benefits, and for directing their work."),
        when("Intellectual property: client owns", """
When Client has paid for a deliverable in full, Provider assigns to Client all rights in that deliverable, except Provider's pre-existing materials and general tools ("Provider Materials"). Provider grants Client a non-exclusive, perpetual, royalty-free license to use Provider Materials built into the deliverables. Each party keeps all rights in its own pre-existing intellectual property.""", "ip_model == 'client owns on payment'"),
        when("Intellectual property: provider owns", """
Provider owns the deliverables. When Client has paid in full, Provider grants Client a non-exclusive, perpetual, worldwide, royalty-free license to use, copy and modify the deliverables for Client's internal business purposes. Each party keeps all rights in its own pre-existing intellectual property.""", "ip_model == 'provider owns, client licensed'"),
        S("Confidentiality", """
Each party will keep the other's non-public business information confidential, use it only to perform or receive the services, and protect it with reasonable care. This does not apply to information that is public, already known, independently developed or received from someone free to share it. These duties last three years after this agreement ends, and for trade secrets, for as long as they remain trade secrets."""),
        S("Warranty", """
Provider warrants that the services will conform to the SOW. If Client reports a non-conformity within {{warranty_days}} days after acceptance, Provider will fix it at no charge. If Provider cannot fix it within a reasonable time, Client may end the affected SOW and receive a refund of fees paid for the non-conforming deliverable. EXCEPT AS STATED IN THIS AGREEMENT, PROVIDER MAKES NO OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE."""),
        S("Indemnity", """
Provider will defend Client against third-party claims that a deliverable (other than Client-supplied materials) infringes a U.S. intellectual property right, and pay resulting damages and settlements it approves. Client will defend Provider against third-party claims arising from materials Client supplies. The indemnified party must give prompt notice, reasonable cooperation and control of the defense."""),
        S("Limitation of liability", """
Neither party is liable for lost profits or indirect, special or consequential damages. Each party's total liability under this agreement is limited to the {{liability_cap}}. Where the cap is a fixed amount, it is {{liability_cap_amount}}. These limits do not apply to payment obligations, indemnity obligations, breach of confidentiality, or a party's gross negligence or willful misconduct."""),
        S("Term and ending", """
This master agreement continues until ended. Either party may end it, or any SOW, with {{termination_days}} days' written notice. Either party may end it immediately if the other materially breaches and does not cure within 15 days after notice. When it ends, Client pays for services performed up to the end date, and each party returns the other's confidential information. Sections that by their nature should survive will continue."""),
        general_terms(),
        S("Exhibit A — {{sow_title}}", """
This statement of work is issued under the services agreement between {{client_name}} and {{provider_name}} dated {{effective_date}}.

**Scope of services**

{{sow_scope}}

**Deliverables**

{{sow_deliverables}}

**Timeline and milestones**

{{sow_timeline}}

**Client responsibilities**

{{sow_client_duties}}

**Fees and invoicing**

{{sow_fees}}

**Acceptance:** as stated in the Acceptance section of the agreement, with a review period of {{acceptance_days}} days.

Client approval of this statement of work: [[initial:client]]   Provider: [[initial:provider]]"""),
        signatures([("client", "Client", "{{client_name}}", True), ("provider", "Service provider", "{{provider_name}}", True)],
                   "By signing below, each party agrees to the services agreement and Exhibit A."),
    ],
    sources=[SRC["ucc2_316"], SRC["usc101"], SRC["docusign"], SRC["signnow"], SRC["esign"]],
))

# ------------------------------------------------------------------ Consulting agreement
add(T(
    id="consulting-agreement", title="Consulting Agreement", category="business",
    tags=["consulting", "advisor", "retainer", "services"],
    summary="Engage a consultant or advisor on an hourly, project or monthly-retainer basis.",
    useWhen="A business needs expert advice or a defined consulting project from an independent consultant.",
    watchOuts=IC_WATCH[:2] + [
        "Retainers: say whether unused hours roll over and whether the retainer is earned when paid or as work is done. This affects refunds if the agreement ends early.",
        "If the consultant also advises your competitors, use the conflicts section and decide what notice you require.",
        "Advice from a consultant is not a substitute for licensed legal, accounting or investment advice. Some advice may require a license.",
    ],
    roles=[("company", "Company"), ("consultant", "Consultant")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("company", "Company") + party_vars("consultant", "Consultant") + [
        V("scope", "Consulting services", "longtext", help="Areas of advice, projects and deliverables."),
        V("term_months", "Initial term (months)", "number", default="6", help="Length of the initial term."),
        V("auto_renew", "Renew month to month after the initial term?", "bool", False, "true", help="If on, the agreement continues month to month until either party ends it."),
        V("comp_type", "Compensation", "select", default="monthly retainer", options=["monthly retainer", "hourly", "project fee"], help="How the consultant is paid."),
        V("retainer_amount", "Monthly retainer", "money", False, help="Paid in advance each month."),
        V("retainer_hours", "Hours included in retainer", "number", False, "10", help="Hours per month covered by the retainer. Extra hours are billed at the hourly rate."),
        V("hourly_rate", "Hourly rate", "money", False, help="For hourly work and hours beyond the retainer."),
        V("project_fee", "Project fee and schedule", "longtext", False, help="Amount and when each part is paid."),
        V("payment_days", "Days to pay invoices", "number", default="15", help="Net payment terms."),
        V("work_product_owner", "Who owns work product?", "select", default="company", options=["company", "consultant"], help="Reports, analyses and materials created for the company."),
        state_var(),
    ],
    sections=[
        S("Parties", party_line("company", "Company") + "\n\n" + party_line("consultant", "Consultant")),
        S("Services", "Consultant will provide the following consulting services:\n\n{{scope}}\n\nConsultant will use professional skill and judgment. The Company makes all final business decisions and is responsible for how it uses Consultant's advice."),
        S("Term", "This agreement starts on {{effective_date}} and lasts {{term_months}} months, unless ended earlier under the Ending the agreement section."),
        opt("Renewal", "After the initial term, this agreement continues month to month until either party gives 30 days' written notice.", "auto_renew"),
        when("Compensation: retainer", "The Company will pay a monthly retainer of {{retainer_amount}} in advance on the first business day of each month. It covers up to {{retainer_hours}} hours of services per month. Unused hours do not roll over. Additional hours approved in writing by the Company are billed at {{hourly_rate}} per hour.", "comp_type == 'monthly retainer'"),
        when("Compensation: hourly", "The Company will pay {{hourly_rate}} per hour, billed monthly in increments of no more than 15 minutes, with a summary of work performed.", "comp_type == 'hourly'"),
        when("Compensation: project fee", "The Company will pay the following project fee:\n\n{{project_fee}}", "comp_type == 'project fee'"),
        S("Invoices and expenses", "Invoices are due within {{payment_days}} days. The Company will reimburse reasonable travel and other expenses only if it approved them in writing in advance and receipts are provided."),
        S("Independent contractor", """
Consultant is an independent contractor and is responsible for its own taxes, insurance and benefits. Consultant controls the manner and means of performing the services, and has no authority to bind the Company or hold itself out as an employee or officer."""),
        S("Conflicts of interest", "Consultant may advise other clients. Consultant will tell the Company in writing before advising a direct competitor of the Company on the same subject matter during the term, and will never use the Company's confidential information for another client."),
        S("Confidentiality", "Consultant will keep the Company's non-public information confidential, use it only to provide the services, and return or destroy it when the agreement ends. This duty lasts three years after the agreement ends, and for trade secrets, as long as they remain trade secrets.\n\n" + DTSA),
        when("Work product: company owns", "Reports, analyses, presentations and other materials Consultant prepares specifically for the Company (\"Work Product\") belong to the Company once paid for, and Consultant assigns all rights in them to the Company. Consultant keeps its general know-how, methods and pre-existing materials, and grants the Company a perpetual license to use any built into the Work Product.", "work_product_owner == 'company'"),
        when("Work product: consultant owns", "Consultant owns the materials it prepares and grants the Company a perpetual, non-exclusive, royalty-free license to use them for the Company's internal business purposes.", "work_product_owner == 'consultant'"),
        S("Limitation of liability", "Consultant's total liability under this agreement is limited to the fees paid in the six months before the claim arose, except for breach of confidentiality, gross negligence or willful misconduct. Neither party is liable for indirect or consequential damages."),
        S("Ending the agreement", "Either party may end this agreement with 30 days' written notice, or immediately for a material breach not cured within 10 days after notice. The Company will pay fees earned and approved expenses through the end date. A retainer paid for the final month is prorated."),
        general_terms(),
        signatures([("company", "Company", "{{company_name}}", True), ("consultant", "Consultant", "{{consultant_name}}", True)]),
    ],
    sources=[SRC["irs_ic"], SRC["dol_ic"], SRC["dtsa"], SRC["usc101"]],
))

# ------------------------------------------------------------------ Offer letter
add(T(
    id="offer-letter", title="Employment Offer Letter", category="business",
    tags=["employment", "offer", "hiring", "onboarding", "most-signed"],
    summary="A clear at-will job offer covering role, pay, start date, benefits and conditions.",
    useWhen="Offering a job to a new employee in the U.S. Pair it with your confidentiality and IP agreement and onboarding forms (I-9, W-4).",
    watchOuts=[
        "At-will employment is the U.S. default, but Montana requires good cause after a probationary period. Promises in an offer letter ('permanent position', 'job security') can undercut at-will status.",
        "Classify the role correctly as exempt or non-exempt under the FLSA and state law. A salary alone does not make a role exempt.",
        "A growing number of states and cities require pay ranges in job postings or on request, and some ban salary-history questions. Verify locally.",
        "Non-competes are void or restricted in several states, for example California, Minnesota, North Dakota and Oklahoma, and many states limit them for lower-wage workers.",
        "Every new hire must complete Form I-9 within three business days of starting work. Don't make the offer contingent on citizenship. Make it contingent on employment authorization.",
        "Background checks require separate written disclosure and authorization under the federal Fair Credit Reporting Act, plus state and local rules.",
    ],
    roles=[("employer", "Employer"), ("candidate", "Candidate")],
    variables=[V("offer_date", "Offer date", "date", help="Date of this letter.")]
    + party_vars("employer", "Employer", email=False) + party_vars("candidate", "Candidate", address=False) + [
        V("job_title", "Job title", "text", help="Title of the position."),
        V("manager", "Reports to", "text", help="Name or title of the manager."),
        V("work_location", "Work location", "text", default="", help="Office address, 'remote', or hybrid arrangement."),
        V("start_date", "Start date", "date", help="First day of work."),
        V("employment_type", "Employment type", "select", default="full-time", options=["full-time", "part-time", "temporary"], help="Type of position."),
        V("flsa_status", "FLSA status", "select", default="exempt", options=["exempt", "non-exempt"], help="Non-exempt employees must be paid overtime. Check the duties and salary tests."),
        V("pay_basis", "Pay basis", "select", default="annual salary", options=["annual salary", "hourly wage"], help="Salary or hourly."),
        V("pay_amount", "Pay amount", "money", help="Annual salary or hourly rate."),
        V("pay_frequency", "Pay frequency", "select", default="every two weeks", options=["weekly", "every two weeks", "twice monthly", "monthly"], help="Check your state's minimum pay-frequency rules."),
        V("include_bonus", "Include bonus or commission?", "bool", False, "false", help="Describe any bonus or commission plan."),
        V("bonus_terms", "Bonus or commission terms", "longtext", False, help="Eligibility, targets and timing. Say whether it is discretionary."),
        V("include_equity", "Include equity grant?", "bool", False, "false", help="Stock options or other equity, subject to a separate plan and grant agreement."),
        V("equity_terms", "Equity terms", "longtext", False, help="Number and type of shares or options, vesting schedule and the plan name."),
        V("benefits", "Benefits summary", "longtext", False, "You will be eligible for the benefits the Company offers to similarly situated employees, under the terms of each plan.", help="Health, retirement, paid time off. Refer to plan documents."),
        V("pto", "Paid time off", "text", False, "", help="E.g. '15 days per year, accrued per pay period', or as required by state or local law."),
        V("contingencies", "Offer is contingent on", "longtext", False, "Verification of your identity and authorization to work in the United States (Form I-9), and signing the Company's confidentiality and invention assignment agreement.", help="Background check, references, licenses. Background checks need separate FCRA forms."),
        V("accept_by", "Accept by", "date", help="Date the offer expires."),
        state_var("work_state", "State where the employee will work", help="Employment law of the state where the employee works usually applies."),
    ],
    sections=[
        S("Offer", """
{{offer_date}}

{{employer_name}}, {{employer_address}}

To: {{candidate_name}} ({{candidate_email}})

Dear {{candidate_name}},

{{employer_name}} (the "Company") is pleased to offer you the {{employment_type}} position of {{job_title}}, reporting to {{manager}}, working from {{work_location}}. We would like you to start on {{start_date}}."""),
        S("Pay", "Your pay will be {{pay_amount}} ({{pay_basis}}), paid {{pay_frequency}} and subject to required withholdings. This position is classified as {{flsa_status}} under the Fair Labor Standards Act and applicable state law."),
        opt("Bonus or commission", "{{bonus_terms}}\n\nAny bonus or commission plan is governed by its written terms, which control if they differ from this letter.", "include_bonus"),
        opt("Equity", "Subject to approval by the Company's board, you will be offered: {{equity_terms}}. The grant will be governed by the Company's equity plan and your grant agreement, which control.", "include_equity"),
        S("Benefits and time off", "{{benefits}}\n\nPaid time off: {{pto}}. The Company may change its benefit plans from time to time, consistent with the law."),
        S("Conditions of this offer", "This offer is contingent on: {{contingencies}}"),
        S("At-will employment", """
Your employment with the Company is at will. Either you or the Company may end it at any time, with or without cause or notice, to the extent permitted by the law of {{work_state}}. Only a written agreement signed by an authorized officer can change at-will status. This letter is not a contract for any particular length of employment."""),
        S("Company policies and prior obligations", """
You agree to follow the Company's lawful policies. Please do not bring or use any confidential information belonging to a former employer. By accepting, you confirm that you are not bound by any agreement that would prevent you from performing this job, or you have told us about it in writing."""),
        S("Accepting this offer", """
This letter, together with the documents it mentions, is the complete offer and replaces any earlier discussions. To accept, please sign below by {{accept_by}}. After that date the offer expires.

We look forward to working with you.

Sincerely,

{{employer_name}}"""),
        signatures([("employer", "For the Company", "{{employer_name}}", True), ("candidate", "Accepted by", "{{candidate_name}}", False)],
                   "Signed by the Company, and accepted by the candidate:"),
    ],
    sources=[SRC["uscis_i9"], SRC["dol_atwill"], SRC["signnow"], SRC["docusign"]],
))

# ------------------------------------------------------------------ Referral agreement
add(T(
    id="referral-agreement", title="Referral Agreement", category="business",
    tags=["referral", "finder's fee", "partner", "affiliate"],
    summary="Pay a referral or finder's fee to someone who introduces new customers.",
    useWhen="A business wants to reward a partner or individual for introducing customers, without making them a sales agent or employee.",
    watchOuts=[
        "Some referral fees are illegal or need a license. Examples: real estate (a fee tied to a sale usually requires a license), legal services (lawyers face fee-sharing rules), healthcare (the federal Anti-Kickback Statute and state laws), insurance and securities (finders may need a broker license), and mortgage settlement services under RESPA.",
        "Define a 'qualified referral' and how the referral is tracked, such as a code, an email introduction or a CRM entry. This prevents disputes over who referred whom.",
        "If the referral partner promotes you publicly, FTC endorsement rules require them to disclose the paid relationship.",
        "Collect a Form W-9. Payments may require a Form 1099.",
    ],
    roles=[("company", "Company"), ("referrer", "Referral partner")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("company", "Company") + party_vars("referrer", "Referral partner") + [
        V("offering", "Products or services covered", "longtext", help="What referred customers may buy."),
        V("fee_type", "Fee type", "select", default="percentage", options=["percentage", "flat fee"], help="Percentage of revenue or flat fee per customer."),
        V("fee_percent", "Fee percentage", "percent", False, "10", help="Percent of net amounts actually collected from the referred customer."),
        V("fee_duration_months", "Fee paid on revenue for (months)", "number", False, "12", help="How long after the first sale the percentage applies."),
        V("flat_fee", "Flat fee per qualified referral", "money", False, help="Amount per referred customer who becomes a paying customer."),
        V("registration_window_days", "Referral credit window (days)", "number", default="90", help="The referral counts only if the customer signs within this many days after the introduction."),
        V("term_months", "Term (months)", "number", default="12", help="How long the agreement lasts. It renews unless ended."),
        state_var(),
    ],
    sections=[
        S("Parties", party_line("company", "Company") + "\n\n" + party_line("referrer", "Referral partner (Partner)")),
        S("Referrals", """
Partner may introduce potential customers for the following: {{offering}}.

A "Qualified Referral" is a person or business that (a) Partner introduces in writing (for example by email introduction or a referral code), (b) is not already a customer or active prospect of the Company, as shown by its records, and (c) signs a paid agreement with the Company within {{registration_window_days}} days after the introduction. The Company decides in good faith whether to accept any customer."""),
        when("Referral fee: percentage", "For each Qualified Referral, the Company will pay Partner {{fee_percent}}% of the net amounts the Company actually collects from that customer during the first {{fee_duration_months}} months after the customer's first payment. Net amounts exclude taxes, refunds, chargebacks and pass-through costs.", "fee_type == 'percentage'"),
        when("Referral fee: flat", "For each Qualified Referral, the Company will pay Partner {{flat_fee}} after the customer has paid its first invoice and any refund period has passed.", "fee_type == 'flat fee'"),
        S("Payment and statements", "The Company will pay fees within 30 days after the end of each calendar quarter in which they are earned, with a statement showing how they were calculated. If a payment is later refunded or charged back, the Company may deduct the related fee from future payments. Partner is responsible for its own taxes."),
        S("Partner's conduct", """
Partner will:
- describe the Company accurately and make no promises about pricing, terms or results beyond the Company's published materials;
- not sign anything or make commitments on the Company's behalf;
- follow applicable laws, including anti-spam, privacy and FTC endorsement rules, and clearly disclose that it may receive a referral fee when promoting the Company publicly; and
- not accept a referral fee where the law prohibits it or requires a license that Partner does not hold."""),
        S("Relationship", "Partner is an independent contractor and not the Company's employee, agent, partner or joint venturer. This agreement is not exclusive."),
        S("Confidentiality", "Each party will keep confidential the other's non-public information, including customer lists and pricing, and use it only for this agreement."),
        S("Term and ending", "This agreement lasts {{term_months}} months from {{effective_date}} and renews for successive terms of the same length unless either party gives 30 days' written notice. Fees for Qualified Referrals made before the end date remain payable on the schedule above."),
        general_terms(),
        signatures([("company", "Company", "{{company_name}}", True), ("referrer", "Referral partner", "{{referrer_name}}", True)]),
    ],
    sources=[src("FTC: Endorsement guides FAQs", "https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking"),
             src("HHS OIG: Federal Anti-Kickback Statute", "https://oig.hhs.gov/compliance/physician-education/fraud-abuse-laws/"),
             src("CFPB: RESPA Section 8 (12 CFR 1024.14) referral fees (eCFR)", "https://www.ecfr.gov/current/title-12/chapter-X/part-1024/subpart-A/section-1024.14"),
             SRC["irs_ic"]],
))

# ------------------------------------------------------------------ Commission agreement
add(T(
    id="commission-agreement", title="Sales Commission Agreement", category="business",
    tags=["commission", "sales", "compensation", "rep"],
    summary="Set out how and when a salesperson or sales representative earns commissions.",
    useWhen="A business pays an employee or independent sales rep commissions on sales.",
    watchOuts=[
        "California requires employers to put commission arrangements for employees in a signed writing that explains how commissions are computed and paid (Cal. Labor Code §2751). Several other states have similar rules or 'sales representative' acts that require prompt payment of commissions after termination, with penalties.",
        "Decide when a commission is 'earned', for example on signing, invoice or payment received. Ambiguity leads to disputes, especially after the rep leaves.",
        "Chargebacks and clawbacks of commissions already paid to employees can violate state wage laws if not agreed in advance, or if they push pay below minimum wage.",
        "For employees, commissions are wages. Final pay deadlines apply when the job ends.",
    ],
    roles=[("company", "Company"), ("rep", "Sales representative")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("company", "Company") + party_vars("rep", "Sales representative") + [
        V("rep_status", "Representative is", "select", default="employee", options=["employee", "independent contractor"], help="Employment status affects wage-law rules."),
        V("products", "Products or services", "longtext", help="What sales earn commissions."),
        V("territory", "Territory or accounts", "text", default="", help="Geographic area, customer segment or named accounts. Leave blank for none."),
        V("commission_rate", "Commission rate", "percent", default="10", help="Percent of the commission base."),
        V("commission_base", "Commission base", "select", default="net amounts collected", options=["net amounts collected", "net invoiced amounts", "gross profit"], help="What the rate is applied to."),
        V("earned_when", "Commission is earned when", "select", default="the customer pays", options=["the customer pays", "the order is invoiced", "the contract is signed"], help="Earned on payment is most protective for the company."),
        V("pay_schedule", "Paid", "select", default="monthly", options=["with each regular paycheck", "monthly", "quarterly"], help="When earned commissions are paid."),
        V("draw", "Include a draw against commissions?", "bool", False, "false", help="An advance against future commissions."),
        V("draw_amount", "Monthly draw", "money", False, help="Amount advanced each month."),
        V("draw_recoverable", "Is the draw recoverable?", "select", False, "non-recoverable", ["recoverable", "non-recoverable"], help="Recoverable draws can be offset against future commissions. Recovering them after the job ends may be restricted by state law."),
        V("post_term_days", "Commission on orders after departure (days)", "number", default="30", help="Rep is paid on orders they procured that close within this many days after the relationship ends."),
        state_var(),
    ],
    sections=[
        S("Parties and role", party_line("company", "Company") + "\n\n" + party_line("rep", "Sales representative (Rep)") + "\n\nEffective {{effective_date}}. Rep is engaged as an {{rep_status}} of the Company. This agreement sets out how Rep earns commissions. It does not change Rep's other terms of engagement except as stated here."),
        S("Covered sales", "Rep earns commissions on sales of the following, made to customers Rep procures:\n\n{{products}}\n\nTerritory or accounts: {{territory}}. Disputes about which rep procured a sale are decided by the Company in good faith, based on its CRM records."),
        S("How commissions are calculated", "The commission is {{commission_rate}}% of {{commission_base}} for each covered sale. 'Net' means amounts after discounts, returns, credits, taxes, shipping and pass-through charges."),
        S("When commissions are earned and paid", "A commission is earned when {{earned_when}}. Earned commissions are paid {{pay_schedule}}, with a statement showing each sale, the base and the commission."),
        S("Adjustments", "If a customer receives a refund or credit, or a sale is cancelled within 90 days after Rep was paid, the Company may deduct the commission paid on the refunded amount from future commissions, to the extent the law allows. The Company will not deduct amounts in a way that reduces an employee's pay below minimum wage or violates wage-payment laws."),
        opt("Draw against commissions", "The Company will advance Rep {{draw_amount}} per month as a draw against future commissions. The draw is {{draw_recoverable}}. If recoverable, the draw is offset against commissions earned in later periods during the engagement. The Company will not seek repayment of an unrecovered draw after the engagement ends, unless the law allows it and Rep agrees in a separate signed writing.", "draw"),
        S("After the engagement ends", "If the engagement ends for any reason, Rep will be paid commissions earned through the end date, plus commissions on orders Rep procured that are signed within {{post_term_days}} days after the end date. These are paid when they would otherwise be paid, or sooner if the law requires."),
        S("Changes to the plan", "The Company may change commission rates or rules for future periods with at least 30 days' written notice. Changes do not reduce commissions on sales already earned."),
        S("Records", "The Company will keep records of commissionable sales. Rep may review the records relating to Rep's commissions on reasonable notice."),
        general_terms(),
        signatures([("company", "Company", "{{company_name}}", True), ("rep", "Sales representative", "{{rep_name}}", False)]),
    ],
    sources=[src("California Labor Code §2751 (written commission contracts)", "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=2751"),
             SRC["dol_ic"], SRC["irs_ic"]],
))

# ------------------------------------------------------------------ Change order
add(T(
    id="change-order", title="Change Order", category="business",
    tags=["change order", "construction", "project", "scope change"],
    summary="Document a change to the scope, price or schedule of an existing contract.",
    useWhen="A project needs more or different work after the original contract was signed, for example in construction, remodeling, software or creative work.",
    watchOuts=[
        "Sign the change order before the extra work starts. Many contracts and some state home-improvement laws require written change orders, and unsigned extras can be hard to collect.",
        "For home improvement work, some states require specific content in contracts and change orders, and may require the contractor to hold a license. Verify locally.",
        "State the new contract total so everyone knows the running price.",
    ],
    roles=[("client", "Client / owner"), ("contractor", "Contractor / provider")],
    variables=[
        V("change_order_number", "Change order number", "text", default="1", help="Sequential number."),
        V("change_date", "Date", "date", help="Date of this change order."),
        V("client_name", "Client name", "party", help="Owner or client."),
        V("contractor_name", "Contractor name", "party", help="Contractor or service provider."),
        V("original_contract", "Original contract", "text", help="Name and date of the original contract, e.g. 'Kitchen remodel contract dated March 1, 2026'."),
        V("project_address", "Project or job site", "address", False, help="Address or project name."),
        V("change_description", "Description of the change", "longtext", help="Exactly what is added, removed or changed. Include materials, specifications and allowances."),
        V("reason", "Reason for change", "text", False, help="E.g. owner request, unforeseen conditions, code requirement."),
        V("price_change_type", "Price effect", "select", default="increase", options=["increase", "decrease", "no change"], help="Effect on the contract price."),
        V("price_change", "Price change amount", "money", False, help="Amount of the increase or decrease."),
        V("prior_total", "Contract total before this change", "money", help="Original price plus earlier approved changes."),
        V("new_total", "New contract total", "money", help="Total after this change."),
        V("schedule_change_days", "Schedule change (days)", "number", default="0", help="Days added to (or removed from) the completion date. Enter 0 for no change."),
        V("new_completion", "New completion date", "date", False, help="If the completion date changes."),
        V("payment_terms", "Payment for this change", "text", default="Paid with the next progress payment", help="When the change is paid."),
    ],
    sections=[
        S("Change order details", """
**Change order no.:** {{change_order_number}}
**Date:** {{change_date}}
**Client:** {{client_name}}
**Contractor:** {{contractor_name}}
**Original contract:** {{original_contract}}
**Project:** {{project_address}}"""),
        S("Change", "{{change_description}}\n\nReason: {{reason}}"),
        S("Price", "Effect on price: {{price_change_type}} of {{price_change}}.\n\nContract total before this change: {{prior_total}}\nNew contract total: {{new_total}}\n\nPayment: {{payment_terms}}."),
        S("Schedule", "Change to the schedule: {{schedule_change_days}} days. New completion date (if changed): {{new_completion}}."),
        S("Effect", "This change order is part of the original contract. Except as changed here, all terms of the original contract stay in effect. Contractor will not start the changed work until both parties have signed. This change order includes all costs and time for the described change, unless it states otherwise."),
        signatures([("client", "Client / owner", "{{client_name}}", False), ("contractor", "Contractor", "{{contractor_name}}", True)]),
    ],
    sources=[src("Federal Trade Commission: Hiring a contractor", "https://consumer.ftc.gov/articles/hiring-contractor"), SRC["esign"]],
))

# ------------------------------------------------------------------ Quote / proposal acceptance
add(T(
    id="proposal-acceptance", title="Quote and Proposal Acceptance", category="business",
    tags=["quote", "proposal", "estimate", "acceptance", "sales", "most-signed"],
    summary="Turn a quote or proposal into a binding order with a deposit and basic terms.",
    useWhen="You have sent a quote, estimate or proposal and need the customer's signed acceptance before you start work or order materials.",
    watchOuts=[
        "Attach or reference the exact quote version. Price disputes often come from different versions of a quote.",
        "If the customer is a consumer and you sign the deal at their home, the FTC Cooling-Off Rule may give them three business days to cancel. It applies to many sales of $25 or more, and some states extend it. Include the required notice where it applies.",
        "Say whether the deposit is refundable. Some states limit non-refundable deposits for home improvement work.",
    ],
    roles=[("provider", "Provider"), ("customer", "Customer")],
    variables=[
        V("provider_name", "Provider name", "party", help="Your business name."),
        V("customer_name", "Customer name", "party", help="Customer's legal name."),
        V("customer_address", "Customer address", "address", help="Billing or service address."),
        V("quote_number", "Quote or proposal number", "text", help="Reference number on the quote."),
        V("quote_date", "Quote date", "date", help="Date of the quote."),
        V("scope_summary", "Summary of what is included", "longtext", help="Short description. The attached quote controls the details."),
        V("total_price", "Total price", "money", help="Total quoted price, including taxes if applicable."),
        V("deposit", "Deposit due at acceptance", "money", False, "0", help="Amount due to book the work."),
        V("deposit_refundable", "Is the deposit refundable?", "select", default="refundable less costs already incurred", options=["refundable", "refundable less costs already incurred", "non-refundable"], help="Check state limits for consumer and home-improvement work."),
        V("balance_terms", "Balance payment terms", "text", default="Due on completion", help="When the rest is paid."),
        V("start_date", "Estimated start date", "date", False, help="Estimated start."),
        V("valid_until", "Quote valid until", "date", help="The customer must accept by this date."),
        V("cooling_off", "Signed at the customer's home or a temporary location (consumer sale)?", "bool", False, "false", help="If on, adds the FTC three-day cancellation notice."),
        state_var(),
    ],
    sections=[
        S("Acceptance", "{{customer_name}} (\"Customer\") accepts quote/proposal no. {{quote_number}} dated {{quote_date}} from {{provider_name}} (\"Provider\") for the following:\n\n{{scope_summary}}\n\nThe quote is attached to this acceptance. If the quote and this acceptance conflict, this acceptance controls."),
        S("Price and payment", "Total price: {{total_price}}. Deposit due now: {{deposit}} ({{deposit_refundable}}). Balance: {{balance_terms}}. Changes to scope require a signed change order and may change the price."),
        S("Schedule", "Estimated start date: {{start_date}}. Dates are estimates and may be affected by weather, material availability, permits or Customer delays. Provider will keep Customer informed."),
        S("Validity", "This quote can be accepted until {{valid_until}}. After that, Provider may revise pricing."),
        S("Basic terms", "- Provider will perform the work in a good and workmanlike manner and follow applicable laws.\n- Customer will provide reasonable access and information needed for the work.\n- Provider's liability is limited to the amount paid under this acceptance, except where the law does not allow a limit.\n- Customer service address: {{customer_address}}."),
        opt("Notice of right to cancel", """
**You, the buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction.** To cancel, send or deliver a signed and dated notice of cancellation, or any other written notice, to {{provider_name}} at the address on the quote before that deadline. If you cancel, any payments you made will be returned within 10 business days. (FTC Cooling-Off Rule, 16 CFR Part 429. A separate cancellation form must also be provided where the rule applies.)""", "cooling_off"),
        general_terms(esign=True),
        signatures([("customer", "Accepted by Customer", "{{customer_name}}", True), ("provider", "Provider", "{{provider_name}}", True)]),
    ],
    sources=[src("FTC: Buyer's remorse and the Cooling-Off Rule", "https://consumer.ftc.gov/articles/buyers-remorse-ftcs-cooling-rule-may-help"),
             src("16 CFR Part 429: Cooling-off period for sales made at homes or certain other locations (eCFR)", "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-429"),
             SRC["signnow"]],
))

# ------------------------------------------------------------------ Simple partnership agreement
add(T(
    id="partnership-agreement", title="Simple General Partnership Agreement", category="business",
    tags=["partnership", "co-founder", "business", "general partnership"],
    summary="Two partners set out contributions, profit split, decisions and what happens if one leaves.",
    useWhen="Two people are running a small business together as a general partnership and want their deal in writing.",
    watchOuts=[
        "In a general partnership each partner is usually personally liable for all partnership debts, including debts caused by the other partner. Many businesses form an LLC instead.",
        "Register a trade name ('doing business as') if the state or county requires it, and get an EIN. A partnership files Form 1065 and gives each partner a Schedule K-1.",
        "Without an agreement, state partnership law (often based on the Uniform Partnership Act) supplies default rules, such as equal profit shares regardless of contributions.",
        "Set a valuation method for buyouts now. Disagreements about value are the most common partnership fight.",
    ],
    roles=[("partnerA", "Partner A"), ("partnerB", "Partner B")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("partner_a", "Partner A") + party_vars("partner_b", "Partner B") + [
        V("business_name", "Partnership name", "text", help="Business name the partnership will use."),
        V("business_purpose", "Business purpose", "longtext", help="What the partnership does."),
        V("principal_office", "Principal office", "address", help="Main business address."),
        V("contribution_a", "Partner A's contribution", "longtext", help="Cash, property or services, with agreed values."),
        V("contribution_b", "Partner B's contribution", "longtext", help="Cash, property or services, with agreed values."),
        V("share_a", "Partner A's share of profits and losses", "percent", default="50", help="Percent."),
        V("share_b", "Partner B's share of profits and losses", "percent", default="50", help="Percent. The two shares should total 100%."),
        V("spending_limit", "Spending limit without both partners' approval", "money", default="2500", help="Any single expense or commitment above this needs both partners."),
        V("draws", "How partners are paid", "longtext", False, "Partners receive distributions of available cash quarterly, as agreed by both partners, after reserves for expenses and taxes.", help="Draws, guaranteed payments or salaries."),
        V("valuation_method", "Buyout valuation method", "select", default="appraisal by an independent appraiser", options=["appraisal by an independent appraiser", "book value", "agreed value updated each year"], help="How a departing partner's share is valued."),
        V("buyout_months", "Buyout payment period (months)", "number", default="24", help="Remaining partner may pay the buyout over this many months."),
        state_var(),
    ],
    sections=[
        S("Partners and name", party_line("partner_a", "Partner A") + "\n\n" + party_line("partner_b", "Partner B") + "\n\nThe partners form a general partnership named {{business_name}} (the \"Partnership\"), starting on {{effective_date}}, with its principal office at {{principal_office}}."),
        S("Purpose", "{{business_purpose}}"),
        S("Contributions", "Partner A contributes: {{contribution_a}}\n\nPartner B contributes: {{contribution_b}}\n\nNo partner must contribute more without agreeing in writing. No partner earns interest on contributions."),
        S("Profits, losses and pay", "Profits and losses are shared: Partner A {{share_a}}%, Partner B {{share_b}}%.\n\n{{draws}}"),
        S("Management and decisions", """
Each partner has an equal vote in managing the business. Day-to-day decisions may be made by either partner. These need both partners' written approval:
- any single expense, loan or commitment over {{spending_limit}};
- borrowing money, guaranteeing debt or putting liens on partnership property;
- admitting a new partner;
- buying or selling real estate or selling substantially all business assets;
- changing the purpose of the business; and
- filing for bankruptcy."""),
        S("Duties", "Each partner will devote the time and effort reasonably needed for the business, act in good faith, and not compete with the Partnership or take its business opportunities for themselves without the other partner's written consent."),
        S("Books, bank accounts and taxes", "The Partnership will keep complete books, open accounts in its own name, and file its own tax returns. Each partner may inspect the books at any time. The partners will agree on an accountant."),
        S("A partner leaving", """
A partner may withdraw with 90 days' written notice. If a partner withdraws, dies or becomes permanently disabled, the other partner may continue the business and buy the departing partner's interest. The price is the value of the interest determined by {{valuation_method}} as of the departure date. The price may be paid over up to {{buyout_months}} months, with interest at the applicable federal rate. If the remaining partner does not elect to buy within 60 days, the Partnership will be wound up."""),
        S("Disputes", "The partners will first try to resolve disputes by talking in good faith, then by mediation with a mutually chosen mediator, before going to court."),
        S("Dissolution", "If the Partnership dissolves, the partners will collect receivables, sell assets as needed, pay debts and then distribute what is left according to capital accounts and then profit shares."),
        general_terms(),
        signatures([("partnerA", "Partner A", "{{partner_a_name}}"), ("partnerB", "Partner B", "{{partner_b_name}}")]),
    ],
    sources=[SRC["irs_partnership"], SRC["sba_partner"], src("Uniform Law Commission: Partnership Act", "https://www.uniformlaws.org/committees/community-home?CommunityKey=52456941-7883-47a5-91b6-d2f086d0bb44")],
))

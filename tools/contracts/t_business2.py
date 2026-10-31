from lib import *

TEMPLATES = []
add = TEMPLATES.append

LLC_WATCH = [
    "An operating agreement does not form the LLC. You must first file articles (or a certificate) of organization with the state and pay its fees and any annual report or franchise tax.",
    "Keep the LLC separate from your personal finances: its own bank account, signed contracts in the LLC's name, and no mixing of funds. Otherwise a court can 'pierce the veil' and hold members personally liable.",
    "Some states require an operating agreement or have special rules. New York requires a publication step for new LLCs, and California requires a Statement of Information. Verify locally.",
    "Tax classification is a federal choice: single-member LLCs default to disregarded entities and multi-member LLCs default to partnerships. Electing S-corporation or C-corporation treatment requires an IRS filing (Form 2553 or 8832). Talk to a tax adviser.",
    "Bringing in passive investors can make LLC interests 'securities' under federal and state law.",
]

# ------------------------------------------------------------------ Single-member LLC
add(T(
    id="llc-operating-agreement-single-member", title="Single-Member LLC Operating Agreement", category="business",
    tags=["llc", "operating agreement", "single member", "company formation"],
    summary="A simple operating agreement for an LLC with one owner, supporting liability protection and succession.",
    useWhen="You own an LLC by yourself and want a written agreement for banks, lenders and the separateness that liability protection depends on.",
    watchOuts=LLC_WATCH + ["Name a successor or plan for what happens on your death or incapacity. Otherwise the LLC can get stuck in probate."],
    roles=[("member", "Member")],
    variables=[
        V("llc_name", "LLC name", "text", help="Exact name as filed with the state, including 'LLC'."),
        state_var("formation_state", "State of formation", help="State where the articles of organization were filed."),
        V("formation_date", "Date articles were filed", "date", help="Filing date with the Secretary of State."),
        V("effective_date", "Effective date of this agreement", "date", help="Usually the filing date."),
        V("member_name", "Member name", "party", help="The owner. A person or a company."),
        V("member_address", "Member address", "address", help="Mailing address."),
        V("principal_office", "Principal office", "address", help="Main business address."),
        V("registered_agent", "Registered agent", "text", help="Name and address of the registered agent on file."),
        V("purpose", "Business purpose", "longtext", False, "Any lawful business for which an LLC may be formed in the state of formation.", help="General or specific purpose."),
        V("initial_contribution", "Initial capital contribution", "text", help="Cash or property contributed, with value."),
        V("management", "Management", "select", default="member-managed", options=["member-managed", "manager-managed"], help="Member-managed is typical for one owner."),
        V("manager_name", "Manager name", "text", False, help="Only if manager-managed."),
        V("tax_treatment", "Federal tax treatment", "select", default="disregarded entity (default)", options=["disregarded entity (default)", "S corporation (election filed)", "C corporation (election filed)"], help="Elections require IRS forms."),
        V("successor_name", "Successor on death or incapacity", "text", False, help="A person who becomes member (or manages the LLC) if the member dies or is incapacitated. Coordinate with your estate plan."),
    ],
    sections=[
        S("Formation", "{{llc_name}} (the \"Company\") is a limited liability company formed under the laws of {{formation_state}} by filing articles of organization on {{formation_date}}. This operating agreement takes effect on {{effective_date}}. The Company's principal office is {{principal_office}}, and its registered agent is {{registered_agent}}."),
        S("Purpose and powers", "{{purpose}} The Company may do anything lawful that is necessary or convenient for its purpose."),
        S("Sole member", "{{member_name}}, of {{member_address}}, is the sole member and owns 100% of the membership interest."),
        S("Capital", "The member's initial capital contribution is {{initial_contribution}}. The member is not required to contribute more. Additional contributions are recorded in the Company's books."),
        S("Management", "The Company is {{management}}."),
        when("Member management", "The member has full authority to manage the Company and to sign documents for it, and may appoint officers or agents and delegate authority in writing.", "management == 'member-managed'"),
        when("Manager management", "{{manager_name}} is the manager, with authority to run the Company's day-to-day business. The manager serves at the member's discretion and may be removed or replaced by the member in writing. Major decisions (selling substantially all assets, merging, dissolving, borrowing outside the ordinary course) need the member's written approval.", "management == 'manager-managed'"),
        S("Limited liability and separateness", """
The member is not personally liable for the Company's debts, obligations or liabilities just because of being a member or manager, except as required by law. To support that protection, the Company will:
- keep its own bank accounts and records, and not mix its funds with the member's;
- sign contracts in the Company's name, showing the signer's capacity;
- maintain adequate capital for its foreseeable obligations; and
- keep its state filings, registered agent and licenses current."""),
        S("Distributions", "The member decides when to distribute cash. No distribution may be made if it would leave the Company unable to pay its debts as they come due or make its liabilities exceed its assets."),
        S("Taxes", "The Company will be treated for federal income tax purposes as a {{tax_treatment}}. The member will file any required elections and returns."),
        S("Indemnification", "The Company will indemnify the member and any manager or officer against losses and expenses from acting for the Company in good faith, except for fraud, willful misconduct, knowing violation of law, or a breach of this agreement. Indemnification is paid only from Company assets."),
        S("Transfers and new members", "The member may transfer all or part of the interest. A new member may be admitted only with the member's written consent and an amended operating agreement."),
        S("Death or incapacity", "If the member dies or becomes legally incapacitated, the Company does not dissolve. {{successor_name}} (or, if none is named or able to serve, the member's legal representative or heirs) may continue the Company and exercise the member's rights, including any authority needed to wind up or continue the business."),
        S("Dissolution", "The Company dissolves only if the member decides in writing, or as required by law. On dissolution the Company will pay its debts, file articles of dissolution, and distribute any remaining assets to the member."),
        S("General", "This agreement is governed by the laws of {{formation_state}}. It may be amended only in a writing signed by the member. If any part is unenforceable, the rest remains in effect. Electronic signatures are valid."),
        signatures([("member", "Member", "{{member_name}}", True)], "The sole member adopts this operating agreement."),
    ],
    sources=[SRC["irs_llc"], SRC["sba_partner"], src("IRS Form 8832: Entity classification election", "https://www.irs.gov/forms-pubs/about-form-8832"), SRC["sec_jv"]],
))

# ------------------------------------------------------------------ Multi-member LLC (2-4 members)
MEMBER_IDS = ["memberA", "memberB", "memberC", "memberD"]
mm_vars = [
    V("llc_name", "LLC name", "text", help="Exact name as filed."),
    state_var("formation_state", "State of formation", help="State where the LLC was formed."),
    V("formation_date", "Date articles were filed", "date", help="Filing date."),
    V("effective_date", "Effective date", "date", help="Effective date of this agreement."),
    V("principal_office", "Principal office", "address", help="Main business address."),
    V("purpose", "Business purpose", "longtext", False, "Any lawful business for which an LLC may be formed in the state of formation.", help="General or specific purpose."),
    V("member_count", "Number of members", "select", default="2", options=["2", "3", "4"], help="This template supports two to four members."),
]
for i, L in enumerate("ABCD"):
    req = i < 2
    mm_vars += [
        V(f"member_{L.lower()}_name", f"Member {L}: name", "party", req, help="Full legal name of the person or company."),
        V(f"member_{L.lower()}_address", f"Member {L}: address", "address", req, help="Mailing address for notices."),
        V(f"member_{L.lower()}_contribution", f"Member {L}: initial contribution", "text", req, help="Cash, property or services and agreed value."),
        V(f"member_{L.lower()}_percent", f"Member {L}: percentage interest", "percent", req, help="Ownership percentage. All members together should total 100%."),
    ]
mm_vars += [
    V("management", "Management", "select", default="member-managed", options=["member-managed", "manager-managed"], help="Who runs the business day to day."),
    V("manager_name", "Manager name", "text", False, help="Only if manager-managed."),
    V("major_vote", "Vote needed for major decisions", "select", default="unanimous", options=["unanimous", "two-thirds by percentage", "majority by percentage"], help="Major decisions are listed in the agreement."),
    V("spending_limit", "Ordinary spending limit", "money", default="5000", help="Single commitments above this are major decisions."),
    V("distribution_timing", "Distributions", "select", default="quarterly, as approved by majority vote", options=["quarterly, as approved by majority vote", "annually, as approved by majority vote", "as decided by the manager"], help="When cash is distributed."),
    V("tax_distributions", "Make tax distributions?", "bool", False, "true", help="Distribute enough cash for members to pay income tax on their share of profits."),
    V("valuation_method", "Buyout valuation method", "select", default="appraisal by an independent appraiser", options=["appraisal by an independent appraiser", "book value", "agreed value updated each year"], help="How a departing member's interest is valued."),
    V("buyout_months", "Buyout payment period (months)", "number", default="36", help="Buyout may be paid over this many months."),
    V("tax_rep", "Partnership representative", "text", help="Member who handles IRS partnership audits."),
]

mm_sections = [
    S("Formation", "{{llc_name}} (the \"Company\") is a limited liability company formed under the laws of {{formation_state}} on {{formation_date}}. This operating agreement is effective {{effective_date}}. Principal office: {{principal_office}}."),
    S("Purpose", "{{purpose}}"),
    S("Members, contributions and percentages", """
The members, their initial contributions and percentage interests are:

- **Member A:** {{member_a_name}}, {{member_a_address}}. Contribution: {{member_a_contribution}}. Percentage: {{member_a_percent}}%.
- **Member B:** {{member_b_name}}, {{member_b_address}}. Contribution: {{member_b_contribution}}. Percentage: {{member_b_percent}}%."""),
    when("Member C", "- **Member C:** {{member_c_name}}, {{member_c_address}}. Contribution: {{member_c_contribution}}. Percentage: {{member_c_percent}}%.", "member_count != '2'"),
    when("Member D", "- **Member D:** {{member_d_name}}, {{member_d_address}}. Contribution: {{member_d_contribution}}. Percentage: {{member_d_percent}}%.", "member_count == '4'"),
    S("Capital", "No member must contribute more capital without consenting in writing. If additional capital is approved as a major decision and a member does not contribute their share, the percentages will be adjusted in proportion to total capital contributed. No member earns interest on capital or may withdraw it except as provided here. The Company keeps a capital account for each member under federal tax rules."),
    S("Management", "The Company is {{management}}. Ordinary business decisions are made by members holding a majority of percentage interests (or by the manager, if manager-managed)."),
    when("Manager", "{{manager_name}} is the manager and runs the day-to-day business, subject to the major-decision rules. The manager may be removed or replaced by members holding a majority of percentage interests.", "management == 'manager-managed'"),
    S("Major decisions", """
These require approval by a {{major_vote}} vote of the members:
- any single expense, borrowing or commitment over {{spending_limit}}, or any guarantee;
- buying, selling or encumbering real estate, or selling substantially all assets;
- admitting a new member or issuing new interests;
- additional capital calls;
- merging, converting or dissolving the Company;
- amending this agreement or the articles; and
- transactions between the Company and a member or a member's relative or affiliate."""),
    S("Distributions and allocations", "Profits and losses are allocated, and distributions are made, in proportion to percentage interests. Distributions of available cash are made {{distribution_timing}}, after reasonable reserves. No distribution may be made if it would leave the Company insolvent."),
    opt("Tax distributions", "To the extent cash is available, the Company will distribute to each member, by April 1 of each year, an amount at least equal to the member's allocated share of the Company's taxable income for the prior year multiplied by a reasonable assumed combined tax rate set by majority vote. Tax distributions count as advances against other distributions.", "tax_distributions"),
    S("Taxes and books", "The Company will be taxed as a partnership unless the members elect otherwise as a major decision. {{tax_rep}} is the partnership representative for IRS purposes and must keep the members informed. The Company will keep complete books, available to every member on reasonable notice, and provide each member a Schedule K-1 each year."),
    S("Duties and conflicts", "Each member will act in good faith and deal fairly with the Company. A member may have other business interests, but may not take a business opportunity that belongs to the Company without first offering it to the Company. Members do not owe duties beyond those in this agreement and non-waivable law."),
    S("Limited liability and indemnification", "No member is personally liable for Company debts just because of being a member. The Company will indemnify members and the manager for good-faith acts on its behalf, except for fraud, willful misconduct, knowing violation of law or breach of this agreement. Indemnification is paid only from Company assets."),
    S("Transfers", "A member may not sell, give, pledge or otherwise transfer any interest without the written consent of the other members, except to a trust for estate planning where the member keeps control. Before selling to an outsider, a member must first offer the interest to the Company and then to the other members at the same price and terms (right of first refusal). A transferee who is not admitted as a member receives only economic rights."),
    S("Buyout events", "If a member dies, becomes permanently disabled, files bankruptcy, divorces and the interest goes to a former spouse, or withdraws, the Company and then the other members have the option, for 90 days, to buy the affected interest. The price is set by {{valuation_method}} as of the event date, payable in cash or over up to {{buyout_months}} months with interest at the applicable federal rate and secured by the purchased interest."),
    S("Deadlock", "If members cannot reach a required decision after two good-faith meetings, they will mediate with a mutually acceptable mediator before taking other action."),
    S("Dissolution", "The Company dissolves on a major-decision vote or as required by law. On dissolution, the members will wind up the business, pay creditors, then distribute remaining assets according to positive capital account balances."),
    S("General", "This agreement is the entire agreement among the members, is governed by the laws of {{formation_state}}, and may be amended only in a writing signed by all members. If any part is unenforceable, the rest remains in effect. Signatures may be electronic and in counterparts."),
    S("Signatures — Members A and B", "\n\n".join([sig_block("memberA", "Member A", "{{member_a_name}}", True), sig_block("memberB", "Member B", "{{member_b_name}}", True)])),
    when("Signatures — Member C", sig_block("memberC", "Member C", "{{member_c_name}}", True), "member_count != '2'"),
    when("Signatures — Member D", sig_block("memberD", "Member D", "{{member_d_name}}", True), "member_count == '4'"),
]

add(T(
    id="llc-operating-agreement-multi-member", title="Multi-Member LLC Operating Agreement", category="business",
    tags=["llc", "operating agreement", "multi member", "partners", "company formation"],
    summary="A plain-English operating agreement for an LLC with two to four members: ownership, votes, money, exits.",
    useWhen="Two to four people or companies own an LLC together and need clear rules on control, distributions, transfers and buyouts.",
    watchOuts=LLC_WATCH + ["Make sure percentage interests total 100% and match the capital each member contributed, or say why they differ (for example, sweat equity). Granting a profits interest for services has tax consequences."],
    roles=[(MEMBER_IDS[i], f"Member {L}") for i, L in enumerate("ABCD")],
    variables=mm_vars, sections=mm_sections,
    sources=[SRC["irs_llc"], SRC["irs_partnership"], SRC["sba_partner"], SRC["sec_jv"]],
))

# ------------------------------------------------------------------ Joint venture
add(T(
    id="joint-venture-agreement", title="Joint Venture Agreement", category="joint-venture",
    tags=["joint venture", "jv", "collaboration", "profit split", "business"],
    summary="Two parties team up on a specific project, sharing contributions, control and profits without merging their businesses.",
    useWhen="Two businesses or individuals want to pursue one defined project or opportunity together for a limited time.",
    watchOuts=[
        "An unincorporated joint venture is usually treated like a partnership. Each venturer can be liable for venture debts, and it may need to file a partnership tax return. Consider forming an LLC for the project.",
        "If one party only contributes money and relies on the other's efforts for profit, the arrangement may be an 'investment contract' (a security). That can trigger securities law requirements.",
        "Spell out who owns intellectual property and customer relationships created by the venture, and what each party may do after it ends.",
        "Antitrust: venturers who are competitors must not use the venture to fix prices or divide markets.",
    ],
    roles=[("partyA", "Venturer A"), ("partyB", "Venturer B")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("party_a", "Venturer A") + party_vars("party_b", "Venturer B") + [
        V("venture_name", "Venture name", "text", help="Name for the project."),
        V("project", "Project description", "longtext", help="The specific opportunity, product or project."),
        V("contribution_a", "Venturer A contributes", "longtext", help="Money, property, services, IP, relationships. State agreed values."),
        V("contribution_b", "Venturer B contributes", "longtext", help="Money, property, services, IP, relationships. State agreed values."),
        V("roles_a", "Venturer A responsibilities", "longtext", help="What A will do."),
        V("roles_b", "Venturer B responsibilities", "longtext", help="What B will do."),
        V("split_a", "Venturer A share of net profits", "percent", default="50", help="Percent."),
        V("split_b", "Venturer B share of net profits", "percent", default="50", help="Percent."),
        V("return_capital_first", "Return contributed capital before splitting profits?", "bool", False, "true", help="If on, each venturer gets its cash contributions back before profits are split."),
        V("spending_limit", "Expense approval threshold", "money", default="2500", help="Expenses above this need both venturers' approval."),
        V("bank_account", "Venture funds held in", "text", default="a separate bank account in the venture's name", help="Where venture money is kept."),
        V("end_condition", "Venture ends", "text", default="when the project is completed or on the second anniversary of the effective date, whichever is first", help="End date or condition."),
        V("exclusivity", "Exclusive within the project field?", "bool", False, "false", help="Neither party pursues the same project with others while the venture runs."),
        state_var(),
    ],
    sections=[
        S("Parties and venture", party_line("party_a", "Venturer A") + "\n\n" + party_line("party_b", "Venturer B") + "\n\nThe venturers agree to work together on the following project under the name {{venture_name}} (the \"Venture\"), starting on {{effective_date}}:\n\n{{project}}"),
        S("Contributions", "Venturer A will contribute: {{contribution_a}}\n\nVenturer B will contribute: {{contribution_b}}\n\nAdditional contributions require both venturers' written agreement."),
        S("Responsibilities", "Venturer A will: {{roles_a}}\n\nVenturer B will: {{roles_b}}"),
        S("Decisions", "The venturers will make decisions together in good faith. Each must approve in writing any expense over {{spending_limit}}, any borrowing or guarantee, any contract binding the Venture for more than 90 days, any change to the project scope, and admitting another participant. Neither venturer may bind the other outside the Venture's approved activities."),
        S("Money and records", "Venture funds will be held in {{bank_account}}. Revenue goes into that account and approved expenses are paid from it. The venturers will keep complete records, share a written monthly statement of income and expenses, and allow each other to inspect the books on reasonable notice."),
        S("Profits and losses", "Net profit is Venture revenue minus approved Venture expenses. Net profits and losses are shared: Venturer A {{split_a}}%, Venturer B {{split_b}}%. Distributions are made quarterly, after reasonable reserves."),
        opt("Return of capital first", "Before profits are split, distributions first repay each venturer's cash contributions, in proportion to the unreturned amounts.", "return_capital_first"),
        S("Intellectual property", "Each venturer keeps ownership of what it brings to the Venture and grants the Venture a non-exclusive license to use it for the project only. Work product created for the Venture is jointly owned in the profit-sharing percentages, unless the venturers agree otherwise in writing. Neither may license or sell jointly owned work product without the other's consent."),
        opt("Exclusivity", "While the Venture runs, neither venturer will pursue the same project with a third party.", "exclusivity"),
        S("Confidentiality", "Each venturer will keep the other's and the Venture's non-public information confidential and use it only for the Venture, during the Venture and for three years after."),
        S("Relationship and liability", "The Venture is limited to the project described. Nothing else creates a general partnership, agency or employment between the venturers. Each venturer is responsible for its own taxes on its share of profits. Each venturer will indemnify the other for losses caused by its own negligence, misconduct or breach. The venturers will cooperate on any required tax filings for the Venture."),
        S("Ending the Venture", "The Venture ends {{end_condition}}, or earlier by written agreement, or if one venturer materially breaches and does not cure within 30 days after notice. When it ends, the venturers will finish or wind down open work, collect receivables, pay Venture debts, return unused contributed property, and distribute any remaining funds as described above."),
        S("Disputes", "The venturers will first try to resolve disputes by negotiation, then by mediation, before litigation."),
        general_terms(),
        signatures([("partyA", "Venturer A", "{{party_a_name}}", True), ("partyB", "Venturer B", "{{party_b_name}}", True)]),
    ],
    sources=[SRC["irs_partnership"], SRC["sec_jv"], src("Sherman Act, 15 U.S.C. §1 (Cornell LII)", "https://www.law.cornell.edu/uscode/text/15/1"), SRC["sba_partner"]],
))

# ------------------------------------------------------------------ Profit share
add(T(
    id="profit-share-agreement", title="Profit Share Agreement", category="joint-venture",
    tags=["profit share", "revenue share", "incentive", "business"],
    summary="Give someone a share of a business's or project's net profits without giving them ownership.",
    useWhen="You want to reward a key contributor, partner or service provider with a share of profits from a business line or project, without issuing equity.",
    watchOuts=[
        "Define 'net profit' precisely: which expenses count, who decides, and whether owner salaries are deducted. Vague definitions cause most profit-share disputes.",
        "If the participant is an employee, profit-share payments are wages and must follow wage-payment and tax-withholding rules.",
        "If the participant pays money for the profit share, it may be an investment contract (a security).",
        "Profit-sharing between licensed professionals and unlicensed persons is prohibited in some fields (law, medicine, real estate).",
    ],
    roles=[("owner", "Business owner"), ("participant", "Participant")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("owner", "Business owner") + party_vars("participant", "Participant") + [
        V("scope", "Profits from", "longtext", help="The whole business, a product line, a location or a project."),
        V("share_percent", "Participant's share of net profit", "percent", default="10", help="Percent of net profit."),
        V("net_profit_definition", "Net profit means", "longtext", default="Gross revenue actually received from the covered business, minus the direct costs of goods and services, operating expenses, reasonable owner compensation, taxes other than income taxes, and debt service, all determined under the owner's consistently applied accounting method.", help="Be specific about included and excluded expenses."),
        V("period", "Calculation period", "select", default="quarterly", options=["monthly", "quarterly", "annually"], help="How often profit is calculated."),
        V("payment_days", "Paid within (days after period ends)", "number", default="45", help="Payment timing."),
        V("include_cap", "Cap total payments?", "bool", False, "false", help="Set a maximum total amount payable."),
        V("cap", "Maximum total payments", "money", False, help="Total payments will not exceed this."),
        V("term_months", "Term (months)", "number", default="24", help="How long the share lasts."),
        V("conditions", "Conditions to stay eligible", "longtext", False, "Participant continues to provide the services described in the parties' services agreement.", help="E.g. continued services. Leave blank for none."),
        state_var(),
    ],
    sections=[
        S("Parties", party_line("owner", "Owner") + "\n\n" + party_line("participant", "Participant")),
        S("Covered profits", "This agreement covers net profit from: {{scope}}"),
        S("Profit share", "For each {{period}} period during the term, Owner will pay Participant {{share_percent}}% of net profit. If net profit for a period is zero or negative, nothing is due for that period, and losses are not carried forward unless both parties agree in writing."),
        opt("Cap", "Total payments under this agreement will not exceed {{cap}}. Once the cap is reached, Owner's payment obligations end.", "include_cap"),
        S("Net profit", "{{net_profit_definition}}"),
        S("Statements and audit", "With each payment, which is due within {{payment_days}} days after each period ends, Owner will provide a statement showing revenue, expenses and the calculation. Once per year, on 30 days' notice, Participant may have an independent accountant review the relevant records at Participant's expense. If the review shows an underpayment of more than 5%, Owner pays for the review and the shortfall."),
        S("Eligibility", "{{conditions}}"),
        S("No ownership", "Participant receives a contractual right to payment only. Participant does not own any part of the business, has no vote or management rights, and is not a partner. Owner runs the business in its reasonable discretion but will not take actions intended to avoid profit-share payments."),
        S("Term and ending", "This agreement lasts {{term_months}} months from {{effective_date}}. Amounts earned for periods before it ends are still payable. If the covered business is sold, Owner will pay the profit share through the closing date."),
        S("Taxes", "Each party is responsible for its own taxes. Owner will issue required tax forms."),
        general_terms(),
        signatures([("owner", "Owner", "{{owner_name}}", True), ("participant", "Participant", "{{participant_name}}")]),
    ],
    sources=[SRC["sec_jv"], SRC["irs_ic"], SRC["esign"]],
))

# ------------------------------------------------------------------ Mutual release
add(T(
    id="mutual-release", title="Mutual Release of Claims", category="business",
    tags=["release", "settlement", "mutual", "dispute"],
    summary="Two parties settle a dispute or end a relationship by releasing each other from claims.",
    useWhen="Both sides want to close out a dispute, a terminated contract or a business relationship so neither can sue the other later over it.",
    watchOuts=[
        "A release generally covers only claims that exist when it is signed, not future claims.",
        "Some rights cannot be released, for example certain wage claims, workers' compensation and unemployment benefits. Releases of federal age-discrimination claims must meet Older Workers Benefit Protection Act requirements, including 21 days to consider and 7 days to revoke.",
        "California requires an express waiver of Civil Code §1542 to release unknown claims. Other states have similar rules. The template adds the waiver when California law is chosen.",
        "Employment settlements: federal law limits confidentiality and non-disparagement terms in some situations, for example sexual harassment claims under the Speak Out Act.",
        "Settlement payments may have tax consequences and reporting requirements.",
    ],
    roles=[("partyA", "First party"), ("partyB", "Second party")],
    variables=[V("effective_date", "Effective date", "date", help="Date signed by both.")]
    + party_vars("party_a", "First party") + party_vars("party_b", "Second party") + [
        V("dispute", "What is being released", "longtext", help="Describe the dispute, contract or relationship, e.g. 'all claims arising from the website development agreement dated June 1, 2025'."),
        V("payment", "Is either party paying money?", "bool", False, "false", help="Settlement payment."),
        V("payer", "Paying party", "select", False, "First party", ["First party", "Second party"], help="Who pays."),
        V("payment_amount", "Payment amount", "money", False, help="Amount."),
        V("payment_due", "Payment due date", "date", False, help="When payment is due."),
        V("other_consideration", "Other promises (optional)", "longtext", False, "", help="E.g. return of property, deleting files, withdrawing reviews."),
        V("confidential", "Keep settlement terms confidential?", "bool", False, "false", help="Parties agree not to disclose the terms."),
        state_var(),
    ],
    sections=[
        S("Parties and background", party_line("party_a", "First party") + "\n\n" + party_line("party_b", "Second party") + "\n\nEffective {{effective_date}}. The parties want to fully resolve the following matter without any admission of fault: {{dispute}} (the \"Matter\")."),
        opt("Payment", "The {{payer}} will pay {{payment_amount}} to the other party by {{payment_due}}. The releases below take effect when that payment is received.", "payment"),
        S("Other promises", "{{other_consideration}}"),
        S("Mutual release", "Each party, for itself and its owners, affiliates, successors, heirs and assigns, releases the other party and its owners, officers, employees, agents, affiliates, successors and assigns from all claims, demands, damages and causes of action, known or unknown, that arise out of or relate to the Matter and that exist up to the effective date. This release does not cover (a) obligations created by this agreement, (b) claims that cannot be released as a matter of law, or (c) claims arising after the effective date."),
        when("Waiver of California Civil Code §1542", "Each party expressly waives the protection of California Civil Code §1542, which says: \"A general release does not extend to claims that the creditor or releasing party does not know or suspect to exist in his or her favor at the time of executing the release and that, if known by him or her, would have materially affected his or her settlement with the debtor or released party.\" Initials: First party [[initial:partyA]]  Second party [[initial:partyB]]", "governing_state == 'CA'"),
        S("No admission", "This agreement is a compromise. It is not an admission of liability or wrongdoing by anyone."),
        S("No claims filed", "Each party confirms it has not assigned any released claim to anyone else, and will not sue the other on a released claim. Nothing here prevents a party from filing a charge with, or participating in an investigation by, a government agency, although a party waives any right to recover money from the released claims where the law allows such a waiver."),
        opt("Confidentiality", "The parties will keep the terms of this agreement confidential, except as required by law, for tax or legal advice, or to enforce it. This does not limit any right to speak about matters the law protects, such as reporting unlawful conduct to the government.", "confidential"),
        S("Advice of counsel", "Each party has read this agreement, understands it, had the chance to consult a lawyer, and signs voluntarily."),
        general_terms(),
        signatures([("partyA", "First party", "{{party_a_name}}", True), ("partyB", "Second party", "{{party_b_name}}", True)]),
    ],
    sources=[SRC["cal_1542"], SRC["eeoc_release"], SRC["speak_out"], SRC["esign"]],
))

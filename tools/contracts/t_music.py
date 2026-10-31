from lib import *

TEMPLATES = []
add = TEMPLATES.append

PRO_OPTS = ["ASCAP", "BMI", "SESAC", "GMR", "a foreign society", "not yet affiliated"]

TWO_COPYRIGHTS = "Every recorded song has two separate copyrights: the composition (music and lyrics), usually owned by songwriters and their publishers, and the sound recording or master, usually owned by whoever paid for or made the recording (the artist or label). Licenses and splits for one do not cover the other."

WFH_NOTE = "Under U.S. copyright law, a work by a non-employee is a 'work made for hire' only if it falls within one of nine statutory categories (such as a contribution to a collective work or part of an audiovisual work) and the parties sign a written agreement saying so. A stand-alone sound recording or beat is often not in those categories, which is why this template also includes a written assignment."

CA_WFH = "California: commissioning a 'work made for hire' from an individual can make the commissioning party that individual's employer for workers' compensation and unemployment insurance purposes (Cal. Labor Code §3351.5(c), Unemployment Insurance Code §686). Many California deals use an assignment instead of work-for-hire language."

MUSIC_SRC = [SRC["circ56a"], SRC["usc101"], SRC["usc201"], SRC["usc204"], SRC["ascap"], SRC["bmi"], SRC["sesac"], SRC["gmr"]]

SAMPLE_WARRANTY = "{who} promises that its contribution is original, or that every sample, interpolation or third-party element in it has been disclosed in writing and is either cleared or will be cleared before release. {who} has not granted rights that conflict with this agreement."

# ------------------------------------------------------------------ Split sheet (2-4 writers)
W = ["writer1", "writer2", "writer3", "writer4"]
ss_vars = [
    V("song_title", "Song title", "text", help="Working title, with any alternate titles."),
    V("alt_titles", "Alternate titles", "text", False, "", help="Optional."),
    V("created_date", "Date written", "date", help="Date of the writing session."),
    V("session_location", "Where written", "text", False, "", help="Studio or city."),
    V("artist", "Recording artist", "text", False, "", help="Artist who recorded or will record it."),
    V("iswc", "ISWC (if assigned)", "text", False, "", help="International Standard Musical Work Code for the composition."),
    V("isrc", "ISRC of the recording (if assigned)", "text", False, "", help="Identifies the master recording, not the song."),
    V("writer_count", "Number of writers", "select", default="2", options=["2", "3", "4"], help="Two to four writers. For more, use two split sheets or add a writer schedule."),
]
for i in range(4):
    n = i + 1
    req = n <= 2
    p = f"w{n}"
    ss_vars += [
        V(f"{p}_name", f"Writer {n}: legal name", "party", req, help="Legal name as registered with the PRO."),
        V(f"{p}_alias", f"Writer {n}: professional name", "text", False, "", help="Stage or producer name."),
        V(f"{p}_contribution", f"Writer {n}: contribution", "select", False, "music and lyrics", ["music and lyrics", "music", "lyrics", "music (producer/beat)", "topline melody"], help="What they wrote."),
        V(f"{p}_share", f"Writer {n}: share of the composition", "percent", req, help="All writers' shares must total 100%."),
        V(f"{p}_pro", f"Writer {n}: PRO", "select", False, "not yet affiliated", PRO_OPTS, help="Performing rights organization."),
        V(f"{p}_ipi", f"Writer {n}: IPI/CAE number", "text", False, "", help="Writer's IPI number from the PRO."),
        V(f"{p}_publisher", f"Writer {n}: publisher (and its IPI)", "text", False, "", help="Writer's publishing company or designee, or 'self-published' or 'none yet'."),
        V(f"{p}_email", f"Writer {n}: email", "email", False, "", help="Contact."),
    ]
ss_vars += [
    V("producer_credits", "Producer and other credits", "longtext", False, "", help="Producers, co-producers, engineers, featured artists, as credited on the recording. A producer who wrote music must also be listed as a writer to share in the composition."),
    V("samples", "Does the song use samples or interpolations?", "bool", False, "false", help="Any recorded sample or re-sung or re-played melody or lyric from another song."),
    V("sample_details", "Samples and interpolations", "longtext", False, help="Source song, writers, recording, how it is used, and clearance status. Cleared samples usually reduce the writers' shares."),
    V("admin_writer", "Who registers the song", "select", default="each writer registers their own share", options=["each writer registers their own share", "Writer 1 registers for all writers"], help="Registration with PROs and The MLC."),
]


def writer_line(n):
    p = f"w{n}"
    return (f"**Writer {n}:** {{{{{p}_name}}}} ({{{{{p}_alias}}}}). Contribution: {{{{{p}_contribution}}}}. Share: **{{{{{p}_share}}}}%**. "
            f"PRO: {{{{{p}_pro}}}}. IPI: {{{{{p}_ipi}}}}. Publisher: {{{{{p}_publisher}}}}. Email: {{{{{p}_email}}}}. Initials: [[initial:writer{n}]]")


add(T(
    id="split-sheet", title="Song Split Sheet", category="music",
    tags=["split sheet", "songwriting", "publishing", "splits", "pro", "ipi", "co-write"],
    summary="Record who wrote a song and each writer's ownership share, PRO, IPI number and publisher, ideally on the day it is written.",
    useWhen="Right after a co-writing session, before the song is released or registered. Then each writer registers the agreed shares with their PRO and The MLC.",
    watchOuts=[
        TWO_COPYRIGHTS + " A split sheet covers only the composition. Master ownership needs its own agreement.",
        "Under U.S. law, co-writers of a joint work each own an undivided share of the whole song. Without a written agreement, courts generally presume equal shares. Any co-owner can grant non-exclusive licenses but must account to the others.",
        "Shares must total 100%. Writers register their own shares with their PRO (ASCAP, BMI, SESAC or GMR) and with The MLC for U.S. digital mechanical royalties. Mismatched registrations freeze royalties.",
        "Samples and interpolations usually require giving the original writers a share of the new composition. Agree how existing shares are reduced before release.",
        "'Producer points' (master royalties) are not the same as writer shares. A producer who co-wrote the music should be on the split sheet. Producer credit alone does not create a writer share.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[(W[i], f"Writer {i + 1}") for i in range(4)],
    variables=ss_vars,
    sections=[
        S("Song", "**Title:** {{song_title}} (also known as {{alt_titles}})\n**Date written:** {{created_date}} at {{session_location}}\n**Recording artist:** {{artist}}\n**ISWC:** {{iswc}}  **ISRC (recording):** {{isrc}}"),
        S("Writers and shares", "The writers agree that they co-wrote the musical composition named above (music and lyrics, the \"Composition\") and own it in these shares:\n\n" + writer_line(1) + "\n\n" + writer_line(2)),
        when("Writer 3", writer_line(3), "writer_count != '2'"),
        when("Writer 4", writer_line(4), "writer_count == '4'"),
        S("Total", "The writers confirm that the shares listed total 100% of the Composition, including the publishing share attached to each writer's share. Each writer's publisher (if any) owns or administers that writer's share as agreed between them."),
        S("Producer and other credits", "{{producer_credits}}\n\nThese credits are for the recording only. They do not create any ownership of the Composition unless the person is also listed as a writer above."),
        opt("Samples and interpolations", "The song includes: {{sample_details}}\n\nIf a sample or interpolation is cleared by giving the original writers a share of the Composition, each writer's share above will be reduced in proportion, unless the writers agree otherwise in writing. No one will release the song commercially until required clearances are obtained.", "samples"),
        S("Registration and income", "Registration: {{admin_writer}}. Each writer authorizes registration of these shares with PROs (ASCAP, BMI, SESAC, GMR or foreign societies), The MLC and the U.S. Copyright Office. Each writer collects their own share of income directly or through their publisher. No writer may register a different split."),
        S("Licensing", "Each writer may grant non-exclusive licenses for the Composition, but must account to the others for their shares. No writer may grant an exclusive license, transfer the whole Composition, or approve a change to the lyrics or melody without all writers' written consent. A writer may sell or assign their own share."),
        S("Disputes", "If the writers disagree about shares, they will negotiate in good faith, then mediate, before going to court. Until resolved, each writer's PRO and MLC registrations stay as listed here."),
        S("General", "This split sheet is a binding agreement about ownership shares of the Composition. It is governed by U.S. copyright law and the law of the state where it is signed, and may be signed electronically."),
        S("Signatures — Writers 1 and 2", "\n\n".join([sig_block("writer1", "Writer 1", "{{w1_name}}"), sig_block("writer2", "Writer 2", "{{w2_name}}")])),
        when("Signatures — Writer 3", sig_block("writer3", "Writer 3", "{{w3_name}}"), "writer_count != '2'"),
        when("Signatures — Writer 4", sig_block("writer4", "Writer 4", "{{w4_name}}"), "writer_count == '4'"),
    ],
    sources=MUSIC_SRC + [SRC["mlc_blanket"], SRC["mma"]],
))

# ------------------------------------------------------------------ shared beat-license vars
def beat_vars(extra):
    return [
        V("agreement_date", "Date", "date", help="Effective date."),
        V("producer_name", "Producer legal name", "party", help="Producer's legal name."),
        V("producer_alias", "Producer professional name", "text", False, "", help="Producer name for credits."),
        V("producer_email", "Producer email", "email", help="For notices."),
        V("artist_name", "Artist legal name", "party", help="Licensee's legal name."),
        V("artist_alias", "Artist professional name", "text", False, "", help="Stage name."),
        V("artist_email", "Artist email", "email", help="For notices."),
        V("beat_title", "Beat title", "text", help="Name of the instrumental."),
        V("song_title", "New song title", "text", False, "", help="Title of the artist's song using the beat, if known."),
        V("fee", "License fee", "money", help="Amount paid."),
        V("files", "Files delivered", "select", default="WAV and MP3", options=["MP3 only", "WAV and MP3", "WAV, MP3 and track stems"], help="Delivery format."),
    ] + extra + [
        V("producer_share", "Producer's share of the new composition", "percent", default="50", help="Producer's writer and publishing share of the new song (the music). The artist and other writers share the rest. Register it with your PROs and The MLC."),
        V("producer_pro", "Producer's PRO and IPI", "text", False, "", help="E.g. 'BMI, IPI 00123456789'."),
        V("credit", "Producer credit", "text", default="Produced by [producer name]", help="How the producer is credited in titles and metadata."),
        state_var(),
    ]


def beat_parties():
    return S("Parties", "**Producer:** {{producer_name}} ({{producer_alias}}), {{producer_email}}\n\n**Artist:** {{artist_name}} ({{artist_alias}}), {{artist_email}}\n\nDate: {{agreement_date}}. Beat: \"{{beat_title}}\" (the \"Beat\"). New song: \"{{song_title}}\" (the \"New Song\"). " + TWO_COPYRIGHTS)


PUBLISHING = S("Composition and publishing", "The New Song's composition will be co-owned. Producer owns {{producer_share}}% (as writer of the music, including the corresponding publisher share), and Artist and any other writers own the rest, as recorded in a split sheet signed by all writers. Producer's PRO and IPI: {{producer_pro}}. Each party registers its own share with its PRO and The MLC. Neither party may register the New Song with a different split.")

CREDIT = S("Credit", "Artist will credit Producer as \"{{credit}}\" in the song title or description where customary (for example \"prod. by\"), in streaming and distributor metadata where available, and in physical or digital liner notes. Inadvertent failure to credit is not a breach if Artist fixes it promptly after notice.")

PRODUCER_WARRANTY = S("Producer's promises", SAMPLE_WARRANTY.format(who="Producer") + " Producer owns or controls the Beat and has the right to grant this license.")

# ------------------------------------------------------------------ Non-exclusive lease
add(T(
    id="producer-beat-lease-nonexclusive", title="Producer Agreement: Non-Exclusive Beat Lease", category="music",
    tags=["beat lease", "non-exclusive", "producer", "instrumental", "license", "caps"],
    summary="License a beat non-exclusively for one song, with stream, sales and video caps. The producer keeps ownership and can lease the beat to others.",
    useWhen="An artist buys a lease on a beat from a producer or beat store and records one song over it.",
    watchOuts=[
        "Non-exclusive means other artists may use the same beat. If the song takes off, the artist may need to upgrade, and the beat may already be licensed elsewhere.",
        "Know the caps. Once streams, sales or video views pass them, the artist must upgrade or stop. Distributors can take songs down over unlicensed beats.",
        "Content ID: the artist should not register the beat, or the song, in YouTube Content ID or similar systems, because that will flag other licensees and the producer.",
        "Sync (film, TV, ads, games) is usually not included. Get a separate sync license.",
        "Writer splits on the new song should be documented in a split sheet. Leases commonly give the producer 50% of the composition, but that is negotiable.",
        "If the beat contains an uncleared sample, every licensee inherits the problem. Ask in writing.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("producer", "Producer"), ("artist", "Artist")],
    variables=beat_vars([
        V("term_years", "License term (years)", "number", default="3", help="How long the license lasts. Many leases are 1 to 5 years, some perpetual."),
        V("stream_cap", "Audio stream cap", "number", default="500000", help="Total audio streams across platforms."),
        V("sales_cap", "Download and physical sales cap", "number", default="5000", help="Units sold."),
        V("video_cap", "Number of music videos", "number", default="1", help="Monetized music videos allowed."),
        V("video_views_cap", "Video views cap", "number", default="500000", help="Total views across video platforms."),
        V("live_shows", "Live performance allowed?", "bool", False, "true", help="For-profit live performances of the New Song."),
        V("radio", "Radio broadcast allowed?", "bool", False, "false", help="Terrestrial or satellite radio play."),
        V("upgrade_price", "Price to upgrade to an exclusive license", "money", False, help="Optional upgrade price, credited by the lease fee if stated."),
    ]),
    sections=[
        beat_parties(),
        S("License", "On payment of {{fee}}, Producer grants Artist a non-exclusive, worldwide license to record one New Song using the Beat, and to reproduce, distribute, stream and publicly perform that recording within the limits below, for {{term_years}} years from the date above. Producer delivers the Beat as {{files}}."),
        S("Limits", "This license covers up to:\n- {{stream_cap}} audio streams in total across all platforms;\n- {{sales_cap}} downloads and physical units in total;\n- {{video_cap}} music video(s), with up to {{video_views_cap}} total views across video platforms.\n\nOnce Artist reaches any limit, or the term ends, Artist must stop new exploitation of the New Song or obtain a new license or upgrade. Copies already sold and existing streams are not recalled. Artist: [[initial:artist]]"),
        opt("Live performance", "Artist may perform the New Song live, including at for-profit shows. Venue public-performance licensing is handled by the venues and PROs.", "live_shows"),
        opt("Radio", "Artist may permit radio broadcasts of the New Song.", "radio"),
        S("Not included", "Not included without a separate written license: synchronization with film, TV, ads, games or trailers; use of the Beat for more than one song; selling, leasing or giving away the Beat on its own; and registering the Beat or New Song in YouTube Content ID or any similar fingerprinting system. Artist: [[initial:artist]]"),
        S("Ownership", "Producer keeps all ownership of the Beat, including its composition and sound recording, and may continue to license it to others. Artist owns Artist's lyrics, vocals and other original contributions, and the New Song master recording, subject to this license and Producer's rights in the Beat."),
        PUBLISHING, CREDIT,
        when("Upgrade", "Artist may upgrade to an exclusive license at any time while the Beat is still available, for {{upgrade_price}}, with the lease fee credited toward it. Upgrading does not cancel licenses Producer granted to others before the upgrade.", "upgrade_price != ''"),
        PRODUCER_WARRANTY,
        S("Artist's promises", "Artist's lyrics, vocals and other contributions are original or cleared, and will not infringe anyone's rights or be defamatory."),
        S("Ending the license", "If Artist materially breaches this agreement, for example by exceeding the limits without upgrading, and does not cure within 15 days after written notice, the license ends and Artist must remove the New Song from distribution. The fee is non-refundable once the files are delivered."),
        general_terms(),
        signatures([("producer", "Producer", "{{producer_name}}"), ("artist", "Artist", "{{artist_name}}")]),
    ],
    sources=MUSIC_SRC + [SRC["mlc_blanket"], src("YouTube Help: Qualifying for Content ID (exclusive rights required)", "https://support.google.com/youtube/answer/1311402")],
))

# ------------------------------------------------------------------ Exclusive license
add(T(
    id="producer-exclusive-license", title="Producer Agreement: Exclusive Beat License", category="music",
    tags=["exclusive", "beat", "producer", "points", "royalties", "soundexchange"],
    summary="An artist gets exclusive rights to use a beat, with no caps. The producer stops licensing it, and may keep ownership, take points and receive a SoundExchange share.",
    useWhen="An artist wants a beat for an important release without competing versions, with the producer paid a fee plus optional royalties.",
    watchOuts=[
        "Exclusive license versus ownership: under this template the producer keeps the copyright in the beat but cannot license it to anyone new. If the artist needs to own the beat outright, use the work-for-hire or buyout version.",
        "Existing leases: earlier non-exclusive leases usually keep running until they expire. Ask the producer for a list.",
        "Points are a percentage of master royalties. Define the base (for example artist's net master income), whether they are paid from the first unit or after recoupment, and statements and audit rights.",
        "SoundExchange pays featured artists for non-interactive digital radio. A producer can receive a share only if the featured artist signs a Letter of Direction.",
        "Exclusive transfers and licenses must be in a signed writing (17 U.S.C. §204).",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("producer", "Producer"), ("artist", "Artist")],
    variables=beat_vars([
        V("prior_leases", "Existing non-exclusive leases", "longtext", False, "None", help="List leases the producer already sold. They continue until they expire."),
        V("royalty", "Producer royalties (points)?", "bool", False, "false", help="Ongoing share of master income."),
        V("royalty_percent", "Producer royalty (% of Artist's net master income)", "percent", False, "3", help="Common ranges vary. Define the base clearly."),
        V("recoup", "Royalties paid", "select", False, "from the first unit, after the fee is recouped", ["from the first unit", "from the first unit, after the fee is recouped", "after recording costs are recouped, then retroactive to the first unit"], help="When royalties start."),
        V("sx_lod", "Artist signs a SoundExchange Letter of Direction?", "bool", False, "false", help="Directs a share of the featured artist's SoundExchange royalties to the producer."),
        V("sx_percent", "SoundExchange share (% of featured artist share)", "percent", False, "3", help="Percent of the featured artist's share."),
    ]),
    sections=[
        beat_parties(),
        S("Exclusive license", "On payment of {{fee}}, Producer grants Artist an exclusive, worldwide, perpetual license to use the Beat in the New Song and to exploit the New Song master in all media, including streaming, downloads, physical copies, video and live performance. Producer delivers the Beat as {{files}}. Synchronization of the New Song master is included, subject to Producer's share of the composition."),
        S("Exclusivity", "From the date above, Producer will not license, sell or give the Beat, or any substantially similar version, to anyone else, and will remove it from stores and beat marketplaces within 7 days. Existing non-exclusive licenses disclosed here continue until they expire: {{prior_leases}}. Producer: [[initial:producer]]"),
        S("Ownership", "Producer keeps ownership of the copyrights in the Beat, subject to this exclusive license. Artist owns the New Song master recording and Artist's contributions. Artist may register the New Song master, but not the Beat alone, in Content ID once all disclosed leases have expired or the parties agree in writing on a whitelisting process."),
        opt("Producer royalties", "Artist will pay Producer {{royalty_percent}}% of Artist's net income from the New Song master (all amounts Artist actually receives from exploitation of the master, minus distribution fees), {{recoup}}. Artist will account to Producer twice a year, within 60 days after June 30 and December 31, with a statement. Producer may audit once a year on 30 days' notice. If Artist signs with a label, Artist will ask the label to pay Producer directly at an equivalent rate.", "royalty"),
        opt("SoundExchange Letter of Direction", "Artist will sign a SoundExchange Letter of Direction directing {{sx_percent}}% of Artist's featured-artist share of SoundExchange royalties for the New Song to Producer.", "sx_lod"),
        PUBLISHING, CREDIT, PRODUCER_WARRANTY,
        S("Artist's promises", "Artist's contributions are original or cleared and will not infringe anyone's rights."),
        general_terms(),
        signatures([("producer", "Producer", "{{producer_name}}"), ("artist", "Artist", "{{artist_name}}")]),
    ],
    sources=MUSIC_SRC + [SRC["sx_lod"], SRC["usc114"], SRC["mlc_blanket"]],
))

# ------------------------------------------------------------------ Work for hire
add(T(
    id="producer-work-for-hire", title="Producer Agreement: Work for Hire and Buyout", category="music",
    tags=["work for hire", "buyout", "producer", "master ownership", "assignment"],
    summary="An artist or label commissions a production and owns the resulting beat and master outright, with a fee, optional points and agreed writer credit.",
    useWhen="The artist or label needs full ownership of the production, for example for label delivery, sync deals or catalog value.",
    watchOuts=[
        WFH_NOTE,
        CA_WFH,
        "Composition: owning the master does not automatically give the commissioning party the producer's share of the composition. Decide whether the producer keeps their writer share or assigns it.",
        "Authors can terminate assignments (but not true works made for hire) after 35 years under 17 U.S.C. §203. That is another reason buyers prefer valid work-for-hire status.",
        "Interactive streams and downloads generate mechanical royalties for the composition. Make sure split sheets and registrations match the agreed composition shares.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("company", "Artist or label (commissioning party)"), ("producer", "Producer")],
    variables=[
        V("agreement_date", "Date", "date", help="Effective date."),
        V("company_name", "Commissioning party", "party", help="Artist or label."),
        V("company_email", "Commissioning party email", "email", help="For notices."),
        V("producer_name", "Producer legal name", "party", help="Producer."),
        V("producer_alias", "Producer professional name", "text", False, "", help="Credit name."),
        V("producer_email", "Producer email", "email", help="For notices."),
        V("project", "Production services", "longtext", help="Songs or beats to produce, sessions, mixing, delivery requirements."),
        V("deadline", "Delivery deadline", "date", help="When final files are due."),
        V("deliverables", "Deliverables", "text", default="24-bit WAV mixes, instrumental, a cappella and labeled track stems", help="Files."),
        V("fee", "Production fee", "money", help="Total fee."),
        V("fee_schedule", "Fee schedule", "text", default="50% on signing, 50% on delivery of final files", help="When paid."),
        V("points", "Producer royalty (points)?", "bool", False, "false", help="Ongoing master royalty."),
        V("points_percent", "Producer royalty (% of net master income)", "percent", False, "3", help="Percent."),
        V("composition", "Producer's share of the composition", "select", default="producer keeps a writer share", options=["producer keeps a writer share", "producer assigns all composition rights for the fee"], help="Owning the master doesn't automatically include the composition."),
        V("producer_comp_share", "Producer's writer share", "percent", False, "50", help="If the producer keeps a share."),
        V("credit", "Producer credit", "text", default="Produced by [producer name]", help="Credit format."),
        state_var(),
    ],
    sections=[
        S("Parties", "**Commissioning party:** {{company_name}} ({{company_email}})\n\n**Producer:** {{producer_name}} ({{producer_alias}}), {{producer_email}}\n\nDate: {{agreement_date}}. " + TWO_COPYRIGHTS),
        S("Services and delivery", "Producer will provide these production services:\n\n{{project}}\n\nProducer will deliver {{deliverables}} by {{deadline}}. Producer will make reasonable revisions requested within 14 days after delivery."),
        S("Fee", "Commissioning party will pay Producer {{fee}}, paid {{fee_schedule}}. This is the full payment for the services and rights granted, except any royalties stated below."),
        S("Ownership of masters and production", "All recordings, beats, instrumentals, stems and other results of Producer's services (the \"Masters\") are works made for hire for the Commissioning party to the fullest extent the law allows, as contributions to a collective work or parts of an audiovisual work where applicable. To the extent any Master is not a work made for hire, Producer assigns to the Commissioning party all rights, title and interest in it, including copyright, worldwide, for the full term of copyright and any renewals. Producer will sign further documents reasonably needed to confirm this. Producer: [[initial:producer]]"),
        when("Composition: producer keeps a writer share", "Producer keeps a {{producer_comp_share}}% writer and publishing share of each composition Producer co-writes, documented in a split sheet. The Commissioning party may use the compositions in the Masters without further payment to Producer, except royalties collected through PROs, The MLC and other customary channels.", "composition == 'producer keeps a writer share'"),
        when("Composition: full assignment", "For the fee, Producer assigns to the Commissioning party all of Producer's rights in the musical compositions embodied in the Masters, including the writer's share of publishing income, except the writer's share of public performance income that PROs pay directly to writers, which Producer keeps where PRO rules require. Producer: [[initial:producer]]", "composition == 'producer assigns all composition rights for the fee'"),
        opt("Producer royalty", "Commissioning party will pay Producer {{points_percent}}% of its net income from exploitation of the Masters (amounts actually received, minus distribution fees), accounted twice a year within 60 days after June 30 and December 31, with statements. Producer may audit once a year.", "points"),
        S("Credit", "Commissioning party will credit Producer as \"{{credit}}\" in metadata and liner notes where credits appear. Producer may list the work in their portfolio after release."),
        S("Producer's promises", SAMPLE_WARRANTY.format(who="Producer") + " Producer will not use the Masters, or reuse the beats or stems created for them, for anyone else."),
        S("Name and likeness", "Commissioning party may use Producer's approved name, likeness and biography to promote the Masters."),
        S("California note", CA_WFH),
        general_terms(),
        signatures([("company", "Commissioning party", "{{company_name}}", True), ("producer", "Producer", "{{producer_name}}")]),
    ],
    sources=MUSIC_SRC + [SRC["circ30"], SRC["usc203"], src("California Labor Code §3351.5", "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=3351.5"), src("California Unemployment Insurance Code §686", "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=UIC&sectionNum=686")],
))

# ------------------------------------------------------------------ Feature / guest artist
add(T(
    id="feature-artist-agreement", title="Featured Artist Agreement", category="music",
    tags=["feature", "guest verse", "collaboration", "featured artist", "label waiver"],
    summary="A guest artist records a verse or feature on another artist's song, for a fee, credit, optional points and an agreed writer share.",
    useWhen="Booking a feature or guest verse.",
    watchOuts=[
        "If the featured artist is signed to a label, the label usually must approve, sometimes with a 'courtesy of' credit and a share of royalties. Get the waiver in writing before release.",
        "Write the composition split for the feature's lyrics into the split sheet. A paid feature fee doesn't settle writer shares unless you say so.",
        "SoundExchange treats a featured artist as a featured performer. Agree how SoundExchange royalties are split.",
        "Limit use of the feature to this song. Reuse in remixes or other songs should need approval.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("main", "Main artist"), ("featured", "Featured artist")],
    variables=[
        V("agreement_date", "Date", "date", help="Date."),
        V("main_name", "Main artist legal name", "party", help="Owner of the song and master."),
        V("main_alias", "Main artist professional name", "text", False, "", help="Stage name."),
        V("featured_name", "Featured artist legal name", "party", help="Guest."),
        V("featured_alias", "Featured artist professional name", "text", help="As credited."),
        V("song_title", "Song title", "text", help="Song."),
        V("contribution", "Contribution", "text", default="one verse of up to 16 bars and ad-libs", help="What the guest records."),
        V("delivery", "Delivery deadline", "date", help="When the vocal files are due."),
        V("fee", "Feature fee", "money", help="Flat fee."),
        V("royalty", "Featured artist master royalty?", "bool", False, "false", help="Share of master income."),
        V("royalty_percent", "Featured royalty (% of net master income)", "percent", False, "5", help="Percent."),
        V("writer_share", "Featured artist's share of the composition", "percent", default="0", help="Writer share for lyrics the guest writes. Record in the split sheet."),
        V("credit", "Credit", "text", default="[Main artist] feat. [Featured artist]", help="Credit format."),
        V("signed_to_label", "Is the featured artist signed to a label?", "bool", False, "false", help="Label waiver needed."),
        V("label_name", "Featured artist's label", "text", False, help="Label name for 'courtesy of' credit."),
        V("approval", "Featured artist approves the final mix?", "bool", False, "true", help="Approval within 5 days, not unreasonably withheld."),
        V("promo", "Featured artist will promote the release?", "bool", False, "false", help="Social posts on release."),
        state_var(),
    ],
    sections=[
        S("Parties and song", "Main artist: {{main_name}} ({{main_alias}}). Featured artist: {{featured_name}} ({{featured_alias}}). Song: \"{{song_title}}\". Date: {{agreement_date}}."),
        S("Services", "Featured artist will write and record {{contribution}} for the Song, and deliver clean, dry vocal files by {{delivery}}."),
        S("Fee", "Main artist will pay {{fee}}: half on signing and half on delivery of the vocals."),
        opt("Master royalty", "Main artist will pay Featured artist {{royalty_percent}}% of Main artist's net income from the Song's master, accounted twice a year with statements.", "royalty"),
        S("Ownership", "Main artist owns the master recording of the Song, including the featured performance. Featured artist keeps their writer share of {{writer_share}}% of the composition, recorded in the Song's split sheet."),
        S("Use limits", "The featured performance may be used only in the Song, including its clean, instrumental-plus-feature, sped-up and slowed versions, music videos, lyric videos and promotion, and in official remixes approved by Featured artist. Any other use needs Featured artist's written consent."),
        S("Credit and name", "Credit: \"{{credit}}\" on all platforms and metadata. Main artist may use Featured artist's approved name, likeness and biography to promote the Song."),
        opt("Label clearance", "Featured artist is signed to {{label_name}}. This agreement is conditioned on Main artist receiving a signed waiver from {{label_name}} permitting this feature. Credit will include \"courtesy of {{label_name}}\" if required.", "signed_to_label"),
        opt("Approval", "Main artist will send Featured artist the final mix before release. Featured artist may request changes to how their performance is presented within 5 days, and approval will not be unreasonably withheld.", "approval"),
        opt("Promotion", "Featured artist will make at least one post about the Song on their main social channels in the release week.", "promo"),
        S("Promises", "Each party promises that its contributions are original or cleared and will not infringe anyone's rights."),
        general_terms(),
        signatures([("main", "Main artist", "{{main_name}}"), ("featured", "Featured artist", "{{featured_name}}")]),
    ],
    sources=MUSIC_SRC + [SRC["sx_lod"], SRC["usc114"]],
))

# ------------------------------------------------------------------ Sync license and master use license share fields
def media_vars(owner_label):
    return [
        V("license_date", "Date", "date", help="Effective date."),
        V("licensor_name", f"Licensor ({owner_label})", "party", help="Who controls the rights being licensed."),
        V("licensor_email", "Licensor email", "email", help="For notices."),
        V("licensee_name", "Licensee (production company)", "party", help="Who will use the music."),
        V("licensee_email", "Licensee email", "email", help="For notices."),
        V("song_title", "Song title", "text", help="Song."),
        V("writers_or_artist", "Writers or artist", "text", help="Songwriters (for the composition) or recording artist (for the master)."),
        V("controlled_share", "Licensor's controlled share", "percent", default="100", help="Percent of the rights the licensor controls. Other co-owners must license their shares separately."),
        V("production", "Production title", "text", help="Film, episode, ad, game or video."),
        V("use_type", "Type of use", "select", default="background instrumental", options=["background instrumental", "background vocal", "featured (visual) vocal", "main or opening title", "end credits", "trailer or promo", "advertisement"], help="How the music is used on screen."),
        V("duration", "Duration (seconds)", "number", help="Total timing of the use."),
        V("uses", "Number of uses", "number", default="1", help="Separate cues."),
        V("media", "Media", "select", default="all media now known or later devised", options=["all media now known or later devised", "television", "internet and social media", "theatrical and festival", "video games", "in-context advertising"], help="Where the production may be shown."),
        V("territory", "Territory", "text", default="the world", help="Where."),
        V("term", "Term", "text", default="in perpetuity", help="How long."),
        V("fee", "License fee", "money", help="One-time fee."),
        V("mfn", "Most-favored-nations?", "bool", False, "false", help="Fee increases to match the other side of the song if they get more."),
        V("credit", "Credit", "text", False, "", help="On-screen or end-credit wording, if any."),
        state_var(),
    ]


MEDIA_SCOPE = "Use: {{use_type}}, up to {{duration}} seconds in total, {{uses}} use(s), in the production \"{{production}}\" (the \"Production\"), in {{media}}, throughout {{territory}}, {{term}}. Licensor's controlled share: {{controlled_share}}%."

add(T(
    id="sync-license", title="Synchronization License (Composition)", category="music",
    tags=["sync", "synchronization", "film", "tv", "ad", "composition", "publishing"],
    summary="License a song's composition (music and lyrics) for use in timed relation with video: film, TV, ads, games or online video.",
    useWhen="A production wants to use a song. Pair it with a master use license if they will use the original recording, rather than a re-recording.",
    watchOuts=[
        TWO_COPYRIGHTS + " A sync license covers only the composition. Using the original recording also needs a master use license from the master owner.",
        "Every co-owner's share must be cleared, or the publisher must confirm it can license 100%. In the U.S., co-owners can often grant non-exclusive licenses for the whole song, but many productions require sign-off from every publisher.",
        "Public performance (broadcast, streaming, theaters) is licensed separately through PROs. The production should file a cue sheet so writers get paid.",
        "Changing the lyrics or making a parody usually needs separate approval.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("licensor", "Licensor (publisher or songwriter)"), ("licensee", "Licensee")],
    variables=media_vars("publisher or songwriter"),
    sections=[
        S("Parties", "Licensor: {{licensor_name}} ({{licensor_email}}). Licensee: {{licensee_name}} ({{licensee_email}}). Date: {{license_date}}."),
        S("Composition", "Musical composition \"{{song_title}}\", written by {{writers_or_artist}} (the \"Composition\"). " + TWO_COPYRIGHTS),
        S("License", "On payment of {{fee}}, Licensor grants Licensee a non-exclusive license to record the Composition in synchronization with the Production, and to reproduce and distribute the Production with the Composition. " + MEDIA_SCOPE),
        S("Not included", "Not included: the sound recording (master), which requires a separate master use license; public performance rights, which are licensed through performing rights organizations; use outside the Production; use in a soundtrack album; and any change to the lyrics or the fundamental character of the music without Licensor's written approval."),
        S("Cue sheet", "Licensee will prepare an accurate cue sheet listing the Composition, writers, publishers, PRO affiliations, timing and use, file it with the relevant PROs or require its distributor or broadcaster to do so, and send Licensor a copy within 30 days after the first broadcast or release."),
        S("Credit", "Credit, if any: {{credit}}."),
        opt("Most-favored-nations", "If Licensee pays the owner of the master recording, or any other owner of the Composition, a higher fee or better terms for the same use, Licensor's fee and terms will be increased to match.", "mfn"),
        S("Licensor's promises", "Licensor controls {{controlled_share}}% of the Composition and has the right to grant this license for that share. Licensor will indemnify Licensee against claims that the licensed share infringes another's rights, up to the fee paid."),
        general_terms(),
        signatures([("licensor", "Licensor", "{{licensor_name}}", True), ("licensee", "Licensee", "{{licensee_name}}", True)]),
    ],
    sources=MUSIC_SRC + [SRC["usc106"]],
))

add(T(
    id="master-use-license", title="Master Use License (Sound Recording)", category="music",
    tags=["master use", "sync", "sound recording", "film", "tv", "label"],
    summary="License a specific sound recording (master) for use in film, TV, ads, games or online video.",
    useWhen="A production wants to use the original recording of a song. A sync license for the composition is also needed.",
    watchOuts=[
        TWO_COPYRIGHTS + " A master use license covers only the recording. The composition needs a sync license from the publishers.",
        "Recordings made under union agreements (SAG-AFTRA, AFM) may require new-use fees to performers when used in film, TV or ads. The licensee usually pays these.",
        "If the recording contains samples or featured artists, confirm the master owner has the right to license them for sync.",
        "Check whether the master owner controls the recording in all territories. Distribution and label deals sometimes split rights by territory.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("licensor", "Licensor (master owner)"), ("licensee", "Licensee")],
    variables=media_vars("master owner") + [
        V("isrc", "ISRC", "text", False, "", help="Recording identifier."),
        V("union", "Union recording (SAG-AFTRA or AFM)?", "select", default="no", options=["no", "yes", "unknown"], help="New-use fees may apply."),
    ],
    sections=[
        S("Parties", "Licensor: {{licensor_name}} ({{licensor_email}}). Licensee: {{licensee_name}} ({{licensee_email}}). Date: {{license_date}}."),
        S("Recording", "Master recording of \"{{song_title}}\" by {{writers_or_artist}}, ISRC {{isrc}} (the \"Master\")."),
        S("License", "On payment of {{fee}}, Licensor grants Licensee a non-exclusive license to synchronize the Master with the Production, and to reproduce and distribute the Production with the Master. " + MEDIA_SCOPE),
        S("Not included", "Not included: the underlying musical composition, which needs a separate sync license; soundtrack album use; remixing, re-editing beyond fitting the timing, or altering the Master without written approval; and use outside the Production."),
        S("Union fees", "Union recording: {{union}}. If any union or guild requires new-use or reuse payments to performers because of this use, Licensee will pay them, unless the parties agree otherwise in writing."),
        S("Credit", "Credit, if any: {{credit}}."),
        opt("Most-favored-nations", "If Licensee pays any owner of the composition a higher fee or better terms for the same use, Licensor's fee and terms will be increased to match.", "mfn"),
        S("Licensor's promises", "Licensor owns or controls {{controlled_share}}% of the Master in the territory, including any featured performances and samples it contains, and has the right to grant this license. Licensor will indemnify Licensee against claims that the Master infringes another's rights, up to the fee paid."),
        general_terms(),
        signatures([("licensor", "Licensor", "{{licensor_name}}", True), ("licensee", "Licensee", "{{licensee_name}}", True)]),
    ],
    sources=MUSIC_SRC + [SRC["usc106"], src("SAG-AFTRA: Sound recordings code", "https://www.sagaftra.org/production-center/contract/1066/getting-started")],
))

# ------------------------------------------------------------------ Publishing admin / co-pub
add(T(
    id="publishing-admin-agreement", title="Publishing Administration or Co-Publishing Agreement", category="music",
    tags=["publishing", "administration", "co-publishing", "admin deal", "royalties", "mlc"],
    summary="A simple deal where a publisher registers and collects for a songwriter's songs for a fee (admin), or also takes a share of ownership (co-pub).",
    useWhen="A self-published songwriter wants a publisher or administrator to register songs worldwide and collect royalties, with or without giving up ownership.",
    watchOuts=[
        "Admin deals leave ownership with the writer and charge a fee, often 10% to 25%. Co-publishing deals transfer part of the copyright, often 50% of the publisher's share, usually in exchange for an advance. Know which one you are signing.",
        "Term and retention: many deals let the publisher keep collecting for songs (or keep ownership in co-pub deals) for years after the term ends. Make the retention period clear.",
        "Advances are recoupable from your royalties, not loans you repay out of pocket, unless the contract says otherwise. Check cross-collateralization.",
        "The writer's share of performance royalties is paid by PROs directly to the writer and is not usually part of the publisher's collection.",
        "Sync approvals: decide whether the publisher may license your songs for ads, politics or other sensitive uses without asking.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("writer", "Writer (or writer's publishing company)"), ("publisher", "Publisher / administrator")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("writer", "Writer") + party_vars("publisher", "Publisher") + [
        V("deal_type", "Deal type", "select", default="administration only", options=["administration only", "co-publishing"], help="Admin keeps ownership with the writer. Co-pub transfers part of it."),
        V("catalog", "Songs covered", "select", default="all songs written during the term and the existing songs listed below", options=["only the songs listed below", "all songs written during the term and the existing songs listed below"], help="Scope."),
        V("song_list", "Listed songs", "longtext", False, "", help="Existing songs with the writer's share of each."),
        V("term_years", "Term (years)", "number", default="3", help="Length."),
        V("retention_years", "Post-term collection period (years)", "number", default="1", help="Publisher may collect income earned during the term, and administer existing licenses, for this long after the term."),
        V("admin_fee", "Administration fee (% of gross publishing income collected)", "percent", default="15", help="Publisher's fee."),
        V("copub_share", "Publisher's ownership share in co-pub deals (% of the copyright)", "percent", False, "50", help="Typically half of the writer's ownership share, representing half the publisher's share."),
        V("copub_income", "Writer's share of net publishing income in co-pub deals", "percent", False, "75", help="Usually writer's share plus half the publisher's share."),
        V("advance", "Advance", "money", False, "0", help="Recoupable from royalties only."),
        V("sync_approval", "Writer must approve sync licenses?", "select", default="for ads, political, adult and religious uses", options=["for all sync licenses", "for ads, political, adult and religious uses", "no approval needed"], help="Approval rights."),
        V("territory", "Territory", "text", default="the world", help="Where."),
        state_var(),
    ],
    sections=[
        S("Parties", party_line("writer", "Writer") + "\n\n" + party_line("publisher", "Publisher") + "\n\nDeal type: **{{deal_type}}**. Effective {{effective_date}}."),
        S("Songs covered", "This agreement covers {{catalog}}:\n\n{{song_list}}\n\n(the \"Songs\"), to the extent of Writer's ownership share."),
        S("Term and territory", "The term is {{term_years}} years from the effective date, throughout {{territory}}. After the term, Publisher may collect income earned during the term, and continue to administer licenses it issued during the term, for {{retention_years}} year(s). Then all administration rights revert to Writer."),
        when("Administration rights", "Writer keeps 100% ownership of Writer's shares of the Songs. Writer grants Publisher the exclusive right during the term to administer them: register them with PROs, The MLC, mechanical agencies and foreign societies; issue licenses within the approval rules below; and collect all publishing income (except the writer's share of public performance income, which PROs pay directly to Writer). Publisher keeps an administration fee of {{admin_fee}}% of gross publishing income it collects, and pays the rest to Writer.", "deal_type == 'administration only'"),
        when("Co-publishing", "Writer assigns to Publisher {{copub_share}}% of Writer's ownership of each Song, and grants Publisher the exclusive right to administer Writer's remaining share during the term. Publisher will register, license within the approval rules below, and collect all publishing income (except the writer's share of public performance income, which PROs pay directly to Writer). From net publishing income (after an administration fee of {{admin_fee}}% and third-party collection costs), Writer receives {{copub_income}}% and Publisher keeps the rest. The assigned ownership share stays with Publisher after the term unless the parties agree otherwise. Writer: [[initial:writer]]", "deal_type == 'co-publishing'"),
        S("Advance", "Publisher will pay Writer an advance of {{advance}} on signing. It is recoupable only from Writer's royalties under this agreement, not repayable in cash, and not cross-collateralized with any other agreement."),
        S("Approvals", "Publisher needs Writer's prior written approval {{sync_approval}}, and in every case for changes to lyrics or title, translations, and uses of the Songs in advertising. Approvals will not be unreasonably delayed."),
        S("Registration duties", "Within 60 days after a Song is covered, Publisher will register it, with correct splits, writer IPI numbers and ISRCs where known, with the relevant PROs, The MLC and foreign societies, and give Writer copies of registrations on request."),
        S("Accounting and audit", "Publisher will account and pay Writer twice a year, within 90 days after June 30 and December 31, with detailed statements by Song and income type. Writer may audit Publisher's books once a year on 30 days' notice. Statements become binding three years after receipt unless Writer objects in writing."),
        S("Writer's promises", "Writer owns or controls the shares of the Songs stated, and the Songs are original or properly cleared. Writer will sign split sheets with co-writers and give Publisher copies."),
        S("Ending early", "Either party may end this agreement on 30 days' notice if the other materially breaches it and does not cure. If Publisher fails to account or pay on time twice in a row, Writer may end the term early."),
        general_terms(),
        signatures([("writer", "Writer", "{{writer_name}}", True), ("publisher", "Publisher", "{{publisher_name}}", True)]),
    ],
    sources=MUSIC_SRC + [SRC["mlc_blanket"], SRC["mma"], SRC["usc115"], SRC["usc203"]],
))

# ------------------------------------------------------------------ Session musician release
add(T(
    id="session-musician-release", title="Session Musician and Vocalist Release", category="music",
    tags=["session musician", "session vocalist", "release", "work for hire", "buyout"],
    summary="Pay a session player or background vocalist a flat fee and get the rights to their recorded performance.",
    useWhen="Hiring instrumentalists or background vocalists for a recording session.",
    watchOuts=[
        WFH_NOTE,
        "Union members (AFM for musicians, SAG-AFTRA for vocalists) work under collective bargaining agreements with minimum scale, pension and new-use payments. A private release cannot override them.",
        "Non-featured musicians and vocalists receive a statutory share of SoundExchange royalties through the AFM & SAG-AFTRA Intellectual Property Rights Distribution Fund. That is set by law (17 U.S.C. §114(g)(2)) and not affected by this release.",
        "If a session player contributes to the songwriting (melody, lyrics or distinctive parts), they may be a co-writer. Use a split sheet if so.",
        CA_WFH,
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("producer", "Artist or producer"), ("musician", "Session performer")],
    variables=[
        V("session_date", "Session date(s)", "text", help="Dates."),
        V("producer_name", "Artist or producer", "party", help="Who owns the recordings."),
        V("musician_name", "Session performer", "party", help="Performer's legal name."),
        V("musician_alias", "Credit name", "text", False, "", help="Name for credits."),
        V("musician_email", "Performer email", "email", help="Contact."),
        V("instrument", "Instrument or voice part", "text", help="E.g. bass guitar, background vocals."),
        V("songs", "Songs", "longtext", help="Song titles."),
        V("fee", "Fee", "money", help="Flat fee."),
        V("union_status", "Union status", "select", default="non-union", options=["non-union", "AFM member (union contract applies)", "SAG-AFTRA member (union contract applies)"], help="Union contracts control where applicable."),
        V("writer_contribution", "Did the performer contribute to the songwriting?", "bool", False, "false", help="If yes, use a split sheet."),
        state_var(),
    ],
    sections=[
        S("Session", "{{musician_name}} (\"Performer\", {{musician_email}}), credited as {{musician_alias}}, will perform {{instrument}} on the following songs for {{producer_name}} (\"Owner\") on {{session_date}}:\n\n{{songs}}"),
        S("Fee", "Owner will pay Performer {{fee}} within 7 days after the session. This is the full payment for the services and rights below, except payments required by a union contract or by law. Union status: {{union_status}}."),
        S("Rights in the recordings", "Performer's recorded performances (the \"Performances\") are works made for hire for Owner to the extent the law allows. To the extent they are not, Performer assigns to Owner all rights in the Performances and the recordings containing them, worldwide, for the full term of copyright. Owner may edit, mix, and use the Performances in any version of the songs, in any media. Performer: [[initial:musician]]"),
        S("Credit and name", "Owner will make reasonable efforts to credit Performer as \"{{musician_alias}} – {{instrument}}\" where credits appear. Owner may use Performer's name and approved likeness in credits and promotion of the recordings."),
        S("Songwriting", "Performer is not a writer of the songs and has no share of the compositions, unless the writers agree otherwise in a signed split sheet."),
        opt("Songwriting contribution", "The parties agree Performer contributed to the songwriting. A split sheet signed by all writers will set out Performer's share.", "writer_contribution"),
        S("Statutory royalties", "This release does not affect any SoundExchange royalties that non-featured performers receive by law through the AFM & SAG-AFTRA Intellectual Property Rights Distribution Fund."),
        S("Promises", "Performer's performances are original and Performer has the right to sign this release, free of conflicting agreements."),
        general_terms(),
        signatures([("producer", "Artist or producer", "{{producer_name}}"), ("musician", "Session performer", "{{musician_name}}")]),
    ],
    sources=MUSIC_SRC + [SRC["usc114"], src("AFM & SAG-AFTRA Intellectual Property Rights Distribution Fund", "https://www.afmsagaftrafund.org/"), SRC["circ30"]],
))

# ------------------------------------------------------------------ Sample clearance
add(T(
    id="sample-clearance-agreement", title="Sample Clearance License", category="music",
    tags=["sample", "clearance", "interpolation", "license", "master", "publishing"],
    summary="License the use of a portion of an existing recording or song (a sample or interpolation) in a new track.",
    useWhen="An artist or producer used part of someone else's recording or composition and needs permission before release.",
    watchOuts=[
        "Sampling a recording usually requires two clearances: the master (from the label or owner) and the composition (from the publishers). Re-playing or re-singing a melody (interpolation) needs only the composition. Use this template once for each owner.",
        "Clear before release. After release, owners have more leverage and may demand a larger share or a takedown.",
        "Composition clearances often take a percentage of the new song's copyright. That reduces every writer's share, so update the split sheet.",
        "There is no fixed length that is automatically 'fair use' or de minimis. U.S. courts disagree, especially for sampled recordings.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("licensor", "Rights owner"), ("licensee", "Licensee (artist or label)")],
    variables=[
        V("license_date", "Date", "date", help="Effective date."),
        V("licensor_name", "Rights owner", "party", help="Label, master owner or publisher."),
        V("licensee_name", "Licensee", "party", help="Artist or label using the sample."),
        V("rights", "Rights licensed", "select", default="sound recording (master)", options=["sound recording (master)", "composition"], help="Use one agreement per owner and right."),
        V("source", "Original work sampled", "text", help="Title, artist and writers, and recording year."),
        V("portion", "Portion used", "longtext", help="Timestamp, length, and how it is used (looped, chopped, re-sung)."),
        V("new_work", "New work", "text", help="Title and artist of the new track."),
        V("fee", "Clearance fee", "money", help="Upfront fee."),
        V("royalty_type", "Ongoing participation", "select", default="none (buyout)", options=["none (buyout)", "royalty on the new master", "share of the new composition"], help="Master licenses often take a royalty. Publishing licenses often take a share of the new song."),
        V("royalty_value", "Royalty or share (%)", "percent", False, help="Percent of net master income, or percent ownership of the new composition."),
        V("credit", "Credit", "text", default="Contains a sample of [title] by [artist], courtesy of [owner]", help="Credit wording."),
        state_var(),
    ],
    sections=[
        S("Parties", "Rights owner: {{licensor_name}}. Licensee: {{licensee_name}}. Date: {{license_date}}."),
        S("Sample", "Original work: {{source}}. Rights licensed: {{rights}}. Portion used: {{portion}} (the \"Sample\"). New work: {{new_work}} (the \"New Work\")."),
        S("License", "On payment of {{fee}}, Rights owner grants Licensee a non-exclusive, worldwide, perpetual license to use the Sample in the New Work, including its versions (clean, instrumental, sped-up or slowed, and approved remixes), and to exploit the New Work in all media, except that synchronization in advertising or political content needs separate approval."),
        when("Royalty on the new master", "Licensee will pay Rights owner {{royalty_value}}% of Licensee's net income from the New Work master, accounted twice a year with statements, with an annual audit right.", "royalty_type == 'royalty on the new master'"),
        when("Share of the new composition", "Rights owner will own {{royalty_value}}% of the copyright in the New Work's composition, and will register its share with its PRO and The MLC. The other writers' shares are reduced accordingly. Licensee will deliver an updated split sheet. Licensee: [[initial:licensee]]", "royalty_type == 'share of the new composition'"),
        S("Credit", "Licensee will credit: \"{{credit}}\" in metadata and liner notes where credits appear."),
        S("Limits", "The license covers only the Sample as described, in the New Work. Using more of the original work, or using it in another work, needs a new license. Licensee will not use the original artist's name to imply endorsement."),
        S("Promises", "Rights owner owns or controls the {{rights}} rights in the Sample and may grant this license. This license does not cover rights owned by others, such as the other side of the copyright, or featured performers' consents where required."),
        general_terms(),
        signatures([("licensor", "Rights owner", "{{licensor_name}}", True), ("licensee", "Licensee", "{{licensee_name}}", True)]),
    ],
    sources=MUSIC_SRC + [SRC["usc106"], src("U.S. Copyright Office: Fair use index", "https://www.copyright.gov/fair-use/")],
))

# ------------------------------------------------------------------ Collaboration agreement
add(T(
    id="music-collaboration-agreement", title="Music Collaboration Agreement", category="music",
    tags=["collaboration", "joint project", "ep", "masters", "co-owned"],
    summary="Two artists or producers making a joint project agree on ownership of songs and masters, costs, decisions, income and credit.",
    useWhen="Two creators are working on a joint single, EP or album that neither will own alone.",
    watchOuts=[
        TWO_COPYRIGHTS + " Agree on both.",
        "Under U.S. law, each co-owner of a joint work can usually grant non-exclusive licenses without the others' consent, but must share profits. This agreement adds consent requirements so one collaborator can't license the project alone.",
        "If either collaborator is signed to a label or publisher, their deal may claim their share. Check exclusivity clauses and get waivers.",
        "Decide what happens to unreleased material if the collaboration ends.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("collabA", "Collaborator A"), ("collabB", "Collaborator B")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("collab_a", "Collaborator A") + party_vars("collab_b", "Collaborator B") + [
        V("project", "Project", "text", help="E.g. 'a 6-song joint EP titled ...'."),
        V("master_split_a", "Collaborator A's share of masters and master income", "percent", default="50", help="Percent."),
        V("master_split_b", "Collaborator B's share of masters and master income", "percent", default="50", help="Percent."),
        V("costs", "Recording costs paid", "select", default="equally, and recouped first from master income", options=["equally, and recouped first from master income", "in proportion to master shares", "as listed in the budget"], help="Who pays."),
        V("budget", "Budget", "longtext", False, "", help="Optional budget."),
        V("credit_format", "Artist credit", "text", default="[Artist A] & [Artist B]", help="How the project is credited."),
        V("distributor", "Distribution", "text", default="through a distributor chosen together, with income split at source where available", help="How releases are distributed."),
        state_var(),
    ],
    sections=[
        S("Parties and project", party_line("collab_a", "Collaborator A") + "\n\n" + party_line("collab_b", "Collaborator B") + "\n\nThe collaborators will create {{project}} (the \"Project\"), starting {{effective_date}}."),
        S("Compositions", "Each song's composition will be owned by its writers in the shares recorded in a split sheet signed on the day the song is written, or as soon as possible after. No song will be released without a signed split sheet."),
        S("Masters", "The Project's master recordings are owned: Collaborator A {{master_split_a}}%, Collaborator B {{master_split_b}}%. Master income is shared in the same proportions, after recording costs are recouped as agreed."),
        S("Costs", "Recording, mixing, mastering, artwork and video costs are paid {{costs}}. Budget: {{budget}}. Neither collaborator will spend more than $500 on the Project without the other's written approval."),
        S("Releases and decisions", "Release dates, the tracklist, artwork, distributor, pricing and marketing require both collaborators' approval. Distribution: {{distributor}}. Credit: {{credit_format}}."),
        S("Licensing", "Neither collaborator will license the Project's masters or compositions they co-own, including for sync, sampling or remixes, without the other's written approval, which will not be unreasonably withheld for customary non-exclusive licenses at market rates. Each will promptly share all license offers."),
        S("Income and accounting", "Where the distributor or society can split income at source, the collaborators will set up splits there. Otherwise, the collaborator who receives income will account to the other within 30 days after the end of each quarter, with statements, and pay the other's share."),
        S("Name and likeness", "Each collaborator may use the other's approved name, likeness and biography to promote the Project."),
        S("Leaving the collaboration", "Either collaborator may end the collaboration for future work with 30 days' written notice. Released material stays co-owned and administered under this agreement. Unreleased material may be released only with both collaborators' consent. Neither may use the other's unreleased contributions in other projects without consent."),
        S("Promises", "Each collaborator's contributions are original or cleared, and they are free to enter this agreement, or have obtained any needed label or publisher waiver."),
        general_terms(),
        signatures([("collabA", "Collaborator A", "{{collab_a_name}}"), ("collabB", "Collaborator B", "{{collab_b_name}}")]),
    ],
    sources=MUSIC_SRC + [SRC["usc106"]],
))

# ------------------------------------------------------------------ Artist management
add(T(
    id="artist-management-agreement", title="Artist Management Agreement", category="music",
    tags=["management", "manager", "commission", "sunset clause", "artist"],
    summary="Appoint a personal manager, with commission, what income is excluded, term, post-term (sunset) commissions and limits on authority.",
    useWhen="An artist hires a personal manager to guide their career.",
    watchOuts=[
        "California's Talent Agencies Act generally prohibits anyone without a talent agency license, including managers, from procuring employment or engagements for artists. Contracts can be voided and commissions disgorged. New York has related rules. Managers should work with licensed agents for booking.",
        "Commission base: commission on gross income without excluding recording costs, tour support, producer fees and opening-act buy-ons can leave an artist paying the manager more than they earn. Define exclusions.",
        "Sunset clauses decide how long the manager keeps earning after the deal ends. Keep them limited and declining.",
        "Avoid giving the manager a broad power of attorney. Require artist approval for contracts.",
        "Key-person and performance-based exits protect the artist if the manager leaves their company or the career doesn't progress.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("artist", "Artist"), ("manager", "Manager")],
    variables=[V("effective_date", "Effective date", "date", help="Start date.")]
    + party_vars("artist", "Artist") + party_vars("manager", "Manager") + [
        V("artist_alias", "Artist professional name", "text", help="Stage name."),
        V("fields", "Fields", "text", default="music, recording, live performance, publishing, merchandise, brand partnerships and social media", help="Areas managed."),
        V("term_years", "Term (years)", "number", default="2", help="Initial term."),
        V("perf_threshold", "Artist may end after year 1 if gross income is below", "money", False, help="Performance-based exit. Leave blank for none."),
        V("commission", "Commission rate", "percent", default="15", help="Typical range is 15-20%."),
        V("exclusions", "Income excluded from commission", "longtext", default="Recording costs and advances used to pay for recordings, video costs, tour support, producer and mixer fees, payments to opening acts, sound and lighting and other show costs paid through, refundable deposits, and income from agreements signed before the term (except as listed).", help="What the manager does not commission."),
        V("sunset", "Post-term (sunset) commissions", "longtext", default="On income from agreements entered into or substantially negotiated during the term: full commission for the first year after the term, half commission for the second year, and none after that. Income from recordings released during the term is commissionable for the same periods.", help="What the manager earns after the term."),
        V("expense_limit", "Expense approval threshold", "money", default="250", help="Manager needs approval for any expense above this."),
        V("key_person", "Key person", "text", False, "", help="If the manager is a company, the person who must personally manage the artist."),
        state_var(),
    ],
    sections=[
        S("Parties", party_line("artist", "Artist") + " (professionally known as {{artist_alias}})\n\n" + party_line("manager", "Manager")),
        S("Appointment", "Artist appoints Manager as Artist's exclusive personal manager in {{fields}}, for {{term_years}} years from {{effective_date}}."),
        S("Manager's duties", "Manager will advise and guide Artist's career, including on releases, image, team (agents, attorneys, business managers, labels, publishers), budgets, touring strategy, marketing and partnerships. Manager will be reasonably available, keep Artist informed, and act in Artist's best interests."),
        S("No employment procurement", "Manager will not procure or attempt to procure employment or engagements where the law requires a talent agency or employment agency license that Manager does not hold. Booking will be handled by a licensed agent where required."),
        S("Limits on authority", "Manager may not sign any contract or make any commitment for Artist without Artist's prior written approval of the specific contract. Manager may not receive or hold Artist's money unless Artist agrees in writing, and then only in a separate account with monthly statements."),
        S("Commission", "Artist will pay Manager {{commission}}% of Artist's gross income earned during the term from the fields covered, excluding:\n\n{{exclusions}}\n\nCommission is due within 30 days after Artist receives the income."),
        S("After the term", "{{sunset}}\n\nManager will not earn commission on anything else after the term."),
        S("Expenses", "Artist will reimburse Manager's reasonable, documented out-of-pocket expenses incurred for Artist, but any single expense over {{expense_limit}}, and all travel, need Artist's prior approval. Manager's general overhead is not reimbursed."),
        S("Key person", "If Manager is a company, {{key_person}} will personally manage Artist. If that person stops doing so, Artist may end this agreement on 30 days' notice."),
        when("Performance exit", "If Artist's gross income from the covered fields in the first 12 months is below {{perf_threshold}}, Artist may end the term on 30 days' notice given within 60 days after that period.", "perf_threshold != ''"),
        S("Ending early", "Either party may end this agreement for the other's material breach not cured within 30 days after written notice. Artist may end it immediately if Manager commits fraud or misappropriates Artist's money."),
        S("Accounting", "Each party will keep records of commissionable income and expenses, provide statements quarterly, and allow the other to audit once a year."),
        S("Independent advice", "Artist has been advised to have an independent entertainment attorney review this agreement and has had the opportunity to do so. Artist: [[initial:artist]]"),
        general_terms(),
        signatures([("artist", "Artist", "{{artist_name}}"), ("manager", "Manager", "{{manager_name}}", True)]),
    ],
    sources=[src("California Labor Code §1700.5 (Talent Agencies Act license requirement)", "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=1700.5")] + MUSIC_SRC[:2],
))

# ------------------------------------------------------------------ Band partnership (2-4 members)
B = ["memberA", "memberB", "memberC", "memberD"]
band_vars = [
    V("effective_date", "Effective date", "date", help="Start date."),
    V("band_name", "Band name", "text", help="Name the band performs under."),
    V("member_count", "Number of members", "select", default="2", options=["2", "3", "4"], help="Two to four members."),
]
for i, L in enumerate("ABCD"):
    req = i < 2
    band_vars += [
        V(f"m{L.lower()}_name", f"Member {L}: legal name", "party", req, help="Legal name."),
        V(f"m{L.lower()}_role", f"Member {L}: role", "text", req, help="Instrument or role."),
        V(f"m{L.lower()}_share", f"Member {L}: income share", "percent", req, help="Share of band income. All shares should total 100%."),
        V(f"m{L.lower()}_email", f"Member {L}: email", "email", req, help="For notices."),
    ]
band_vars += [
    V("vote", "Vote for major decisions", "select", default="unanimous", options=["unanimous", "majority", "two-thirds"], help="Major decisions are listed."),
    V("name_owner", "If the band splits up, the name belongs to", "select", default="no one may use it without consent of all members", options=["no one may use it without consent of all members", "the members who continue, if a majority continue"], help="Band name ownership."),
    V("entity", "Business form", "select", default="general partnership", options=["general partnership", "LLC (formed separately)"], help="An LLC limits personal liability for band debts."),
    state_var(),
]


def member_line(L):
    l = L.lower()
    return f"- **Member {L}:** {{{{m{l}_name}}}}, {{{{m{l}_role}}}}, {{{{m{l}_email}}}}. Income share: {{{{m{l}_share}}}}%."


add(T(
    id="band-partnership-agreement", title="Band Partnership Agreement", category="music",
    tags=["band", "partnership", "band name", "leaving member", "income split"],
    summary="Two to four band members agree on the band name, money, decisions, songwriting, gear and what happens when someone leaves.",
    useWhen="A band is earning (or about to earn) money together and wants clear rules before there is a dispute.",
    watchOuts=[
        "A band that shares profits is usually a general partnership by default, so members may be personally liable for band debts. Consider forming an LLC.",
        "Band names are the most fought-over asset. Decide now who can use the name after a split, and consider a federal trademark registration.",
        "Songwriting is separate from band income. Use split sheets for each song. Recording and touring income can still be shared by band shares.",
        "Label deals usually include 'leaving member' clauses that may override this agreement for recording matters.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[(B[i], f"Member {L}") for i, L in enumerate("ABCD")],
    variables=band_vars,
    sections=[
        S("Band and members", "The members form a band called **{{band_name}}** (the \"Band\"), starting {{effective_date}}, as a {{entity}}:\n\n" + member_line("A") + "\n" + member_line("B")),
        when("Member C", member_line("C"), "member_count != '2'"),
        when("Member D", member_line("D"), "member_count == '4'"),
        S("Band income and expenses", "Band income includes live performance fees, merchandise, recording income from Band masters, sync of Band masters, sponsorships and crowdfunding. Band expenses (rehearsal space, travel, gear bought for the Band, marketing, recording costs) are paid first. Net income is shared by the income shares above. The Band will keep a separate bank account and shared books visible to all members, and will settle accounts monthly."),
        S("Songwriting", "Songwriting income belongs to the writers of each song, as recorded in split sheets, and is not Band income unless the writers agree otherwise in writing. Masters of Band recordings are owned by the Band."),
        S("Decisions", "Day-to-day decisions are made by majority vote. These need a {{vote}} vote: signing any recording, publishing, management, agency or merchandise deal; spending over $500; borrowing; adding or removing a member; licensing Band masters; and using the Band name in a new way."),
        S("Band name", "The Band name and logos are Band property. If the Band breaks up: {{name_owner}}. A departing member may describe themselves as a \"former member of {{band_name}}\" but may not perform under the name."),
        S("Gear", "Gear bought with Band money is Band property, listed in a shared inventory. Each member's personal gear stays theirs, even if used for Band work."),
        S("Leaving members", "A member may leave with 30 days' written notice. A departing member keeps their income share of Band masters and merchandise designs created while a member, and of income from shows played while a member. They give up any share of future income from new work and any right to the Band name. The remaining members may buy the departing member's share of Band gear and cash at book value. A member may be removed for serious misconduct by the vote above after written notice and a chance to respond."),
        S("New members", "New members join only by the vote above and by signing this agreement. Their income share will be set at that time and other shares reduced proportionally for future income."),
        S("Debts and liability", "No member may take on debt or sign contracts for the Band without approval under Decisions. A member who does so without approval is personally responsible."),
        S("Disputes", "The members will try to resolve disputes in a band meeting, then by mediation, before going to court."),
        general_terms(),
        S("Signatures — Members A and B", "\n\n".join([sig_block("memberA", "Member A", "{{ma_name}}"), sig_block("memberB", "Member B", "{{mb_name}}")])),
        when("Signatures — Member C", sig_block("memberC", "Member C", "{{mc_name}}"), "member_count != '2'"),
        when("Signatures — Member D", sig_block("memberD", "Member D", "{{md_name}}"), "member_count == '4'"),
    ],
    sources=[SRC["irs_partnership"], SRC["sba_partner"], src("USPTO: Trademark basics", "https://www.uspto.gov/trademarks/basics"), SRC["circ56a"]],
))

# ------------------------------------------------------------------ Remix
add(T(
    id="remix-agreement", title="Remix Agreement", category="music",
    tags=["remix", "remixer", "stems", "dj", "buyout"],
    summary="Commission a remix of a track, with stems delivery, fee or royalty, credit, ownership of the remix master and approval.",
    useWhen="An artist or label hires a remixer, or approves a remix, for an official release.",
    watchOuts=[
        "The remixer usually gets no share of the composition. The original writers own the song. If the remixer adds new melodies or lyrics, decide in writing whether they get a writer share and whether publishers approve.",
        "The original owner must control the master and have the right to authorize remixes, including featured artists' approvals.",
        "If the remixer adds samples, they must be cleared.",
        WFH_NOTE,
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("owner", "Rights owner (artist or label)"), ("remixer", "Remixer")],
    variables=[
        V("agreement_date", "Date", "date", help="Date."),
        V("owner_name", "Rights owner", "party", help="Owner of the original master."),
        V("remixer_name", "Remixer legal name", "party", help="Remixer."),
        V("remixer_alias", "Remixer professional name", "text", help="Credit name."),
        V("original", "Original track", "text", help="Title and artist."),
        V("stems_date", "Stems delivered by", "date", help="Owner's delivery date."),
        V("deadline", "Remix delivery deadline", "date", help="Remixer's deadline."),
        V("comp_type", "Remixer is paid", "select", default="flat fee (buyout)", options=["flat fee (buyout)", "fee plus royalty"], help="Buyout is most common."),
        V("fee", "Remix fee", "money", help="Flat fee."),
        V("royalty_percent", "Remix royalty (% of net income from the remix master)", "percent", False, help="If fee plus royalty."),
        V("writer_share", "Remixer gets a composition share?", "bool", False, "false", help="Only if they add new written material and the writers and publishers agree."),
        V("writer_share_percent", "Remixer's composition share", "percent", False, help="Percent of the composition."),
        V("dj_use", "Remixer may play the remix in DJ sets before release?", "bool", False, "false", help="Leaks are a risk."),
        state_var(),
    ],
    sections=[
        S("Parties and track", "Rights owner: {{owner_name}}. Remixer: {{remixer_name}} ({{remixer_alias}}). Original track: {{original}}. Date: {{agreement_date}}."),
        S("Stems and delivery", "Rights owner will deliver stems by {{stems_date}}. Remixer will deliver a final remix (WAV, plus instrumental and stems on request) by {{deadline}}. Rights owner may request reasonable revisions and may reject the remix in its discretion. If rejected, Remixer keeps any fee already paid and may not release the remix."),
        S("Payment", "Payment: {{comp_type}}. Fee: {{fee}}, paid within 15 days after Rights owner accepts the remix."),
        when("Royalty", "Rights owner will also pay Remixer {{royalty_percent}}% of Rights owner's net income from the remix master, accounted twice a year with statements.", "comp_type == 'fee plus royalty'"),
        S("Ownership", "The remix master is a work made for hire for Rights owner to the extent the law allows. Otherwise Remixer assigns all rights in the remix master and Remixer's contributions to Rights owner. Rights owner may release, edit and license it. Remixer: [[initial:remixer]]"),
        S("Composition", "Remixer gets no ownership of the composition, unless the next section applies."),
        opt("Composition share", "Remixer added new written material. With the original writers' and publishers' written approval, Remixer will receive {{writer_share_percent}}% of the composition of the remix version only, recorded in a split sheet.", "writer_share"),
        S("Credit", "The remix will be titled \"{{original}} ({{remixer_alias}} Remix)\" where the platform allows, and Remixer will be credited in metadata."),
        opt("DJ use", "Before release, Remixer may play the remix in live DJ sets, but may not share files, upload or stream it.", "dj_use"),
        S("Confidentiality", "Remixer will keep the stems and unreleased remix confidential, will not share or upload them, and will delete the stems after delivery unless Rights owner agrees otherwise."),
        S("Promises", SAMPLE_WARRANTY.format(who="Remixer")),
        general_terms(),
        signatures([("owner", "Rights owner", "{{owner_name}}", True), ("remixer", "Remixer", "{{remixer_name}}")]),
    ],
    sources=MUSIC_SRC + [SRC["circ30"]],
))

# ------------------------------------------------------------------ Beat purchase receipt
add(T(
    id="beat-purchase-receipt", title="Beat Purchase Receipt and License Summary", category="music",
    tags=["beat", "receipt", "purchase", "license summary", "beat store"],
    summary="A short signed receipt for a beat purchase that records what was bought, the license type and its main limits.",
    useWhen="A producer sells a beat online or in person and wants a signed record that points to the full license terms.",
    watchOuts=[
        "A receipt is not the license. Attach or link the full license (non-exclusive lease, exclusive license or work-for-hire agreement), because it controls.",
        "Make sure the license type and caps on the receipt match the full license.",
        "Keep transaction IDs. Distributors and platforms often ask for proof of license when a beat is disputed.",
    ],
    disclaimer=MUSIC_DISCLAIMER,
    roles=[("producer", "Producer (seller)"), ("buyer", "Buyer")],
    variables=[
        V("purchase_date", "Purchase date", "date", help="Date paid."),
        V("producer_name", "Producer", "party", help="Seller."),
        V("buyer_name", "Buyer", "party", help="Artist or buyer."),
        V("buyer_email", "Buyer email", "email", help="Contact."),
        V("beat_title", "Beat title", "text", help="Beat."),
        V("transaction_id", "Order or transaction ID", "text", help="From the store or payment processor."),
        V("license_type", "License type", "select", default="non-exclusive lease", options=["non-exclusive lease", "exclusive license", "work for hire / full buyout"], help="Which full agreement applies."),
        V("price", "Amount paid", "money", help="Total."),
        V("payment_method", "Payment method", "text", default="online payment", help="Method."),
        V("files", "Files delivered", "text", default="WAV and MP3", help="Files."),
        V("caps", "Main limits", "longtext", False, "Streams: 500,000. Sales: 5,000. Music videos: 1. Term: 3 years. No sync. No Content ID.", help="Summary of caps (for leases)."),
        V("license_link", "Full license agreement", "text", help="Title and date, or link, of the full agreement."),
        V("producer_share", "Producer's composition share", "percent", default="50", help="Writer share of the new song."),
    ],
    sections=[
        S("Receipt", "{{producer_name}} (\"Producer\") confirms receiving {{price}} from {{buyer_name}} ({{buyer_email}}) on {{purchase_date}} by {{payment_method}}, transaction {{transaction_id}}, for the beat \"{{beat_title}}\". Files delivered: {{files}}."),
        S("License", "License type: **{{license_type}}**. The full terms are in: {{license_link}}, which controls if anything here differs.\n\nSummary of main limits: {{caps}}\n\nProducer's share of the composition of the new song: {{producer_share}}%."),
        S("Confirmation", "Buyer confirms receiving the files and the full license terms. Buyer: [[initial:buyer]]"),
        signatures([("producer", "Producer", "{{producer_name}}"), ("buyer", "Buyer", "{{buyer_name}}")]),
    ],
    sources=MUSIC_SRC[:4] + [SRC["esign"]],
))

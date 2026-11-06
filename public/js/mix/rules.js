// The mix rulebook: per-role channel strips and per-genre profiles, from engineering references
// (sources listed in docs/research/ai-mix-2026-11-05.md). Numbers are starting points the planner adapts
// to each stem: levels are loudness (LU) relative to the lead vocal; EQ in Hz / dB; times in seconds.

// role: level (LU vs the lead vocal), hpf, lpf, eq (tone and corrective moves; cuts narrower than boosts),
// comp / comp2 (ratio, attack, release, gr = gain reduction in dB aimed at the stem's loud passages),
// deess (centre Hz, most cut dB), sat (drive, wet mix), pan, width (stereo stems), verb ('vox' | 'beat', send dB:
// the return lands about that far under the dry track), delay (note as a fraction of a 4/4 bar, send dB, feedback),
// duck ('kick', depth dB), rider (phrase-by-phrase level riding before the compressors), fix (resonance cuts allowed)
// Sources in brackets refer to docs/research/ai-mix-2026-11-05.md; [E] = an engineering pick inside the sources' ranges.
export const ROLE_RULES = {
  // kick ≈ −10 vs vocal [26]; box 400–700 Hz, bottom 50–65 Hz, beater 4 kHz [64][72]; 4:1, 3–4 dB [64]
  kick: { level: -10, hpf: 30, eq: [{ type: 'peaking', f: 60, q: 1, gain: 2 }, { type: 'peaking', f: 420, q: 2.5, gain: -2.5 }, { type: 'peaking', f: 4000, q: 1, gain: 2 }], comp: { ratio: 4, attack: 0.01, release: 0.15, gr: 3.5 }, sat: { drive: 1.6, mix: 0.15 }, pan: 0, verb: null, fix: 2 },
  // snare ≈ −12 to −14 [26]; body 200 Hz, ring 400–900 Hz, crack 5 kHz [68][72]; 4:1 slow attack 2–6 dB [68]; short plate −15 [E]
  snare: { level: -12, hpf: 90, eq: [{ type: 'peaking', f: 200, q: 1, gain: 1.5 }, { type: 'peaking', f: 700, q: 2.5, gain: -2 }, { type: 'peaking', f: 5000, q: 1, gain: 2 }], comp: { ratio: 4, attack: 0.02, release: 0.1, gr: 3 }, sat: { drive: 1.4, mix: 0.12 }, pan: 0, verb: { bus: 'beat', send: -15 }, fix: 2 },
  // hats −14 to −18 [E]; HPF ~300 [66]; resonances 4–8 kHz [66], sparkle 6–10 kHz [72]; light comp; 30–50% off centre [66]
  hats: { level: -16, hpf: 300, eq: [{ type: 'peaking', f: 6000, q: 3, gain: -1.5 }, { type: 'highshelf', f: 9000, gain: 1.5 }], comp: { ratio: 2, attack: 0.005, release: 0.06, gr: 1.5 }, pan: 0.35, verb: { bus: 'beat', send: -20 }, fix: 1 },
  perc: { level: -16, hpf: 200, eq: [{ type: 'peaking', f: 220, q: 2.5, gain: -2 }, { type: 'peaking', f: 5000, q: 1, gain: 1 }], comp: { ratio: 3, attack: 0.01, release: 0.08, gr: 2.5 }, pan: 'spread', width: 1.1, verb: { bus: 'beat', send: -15 }, fix: 1 },
  drums: { level: -6, hpf: 30, eq: [{ type: 'peaking', f: 400, q: 2, gain: -2 }, { type: 'highshelf', f: 6000, gain: 1.5 }], comp: { ratio: 3, attack: 0.01, release: 0.12, gr: 3 }, sat: { drive: 1.3, mix: 0.1 }, pan: 0, verb: { bus: 'beat', send: -20 }, fix: 2 },
  // rooms: −5 dB at 100–200 Hz, +1–2 at 5 kHz, 3:1 slow attack [71]
  room: { level: -18, hpf: 150, eq: [{ type: 'peaking', f: 150, q: 1, gain: -4 }, { type: 'peaking', f: 5000, q: 1, gain: 1.5 }], comp: { ratio: 3, attack: 0.1, release: 0.07, gr: 4 }, sat: { drive: 2, mix: 0.25 }, pan: 0, width: 1.15, verb: null, fix: 1 },
  // 808 −3 to −6 vs vocal [E]; cut 250 [35]; fuzz near 3 kHz, LPF 6.5 kHz [38]; tube ~30% wet [33]; mono [64]; ducked by the kick [2][33][34]
  '808': { level: -5, hpf: 22, lpf: 6500, eq: [{ type: 'peaking', f: 250, q: 1.5, gain: -2.5 }, { type: 'peaking', f: 3000, q: 1, gain: 1 }], comp: { ratio: 4, attack: 0.005, release: 0.08, gr: 3.5 }, sat: { drive: 3, mix: 0.3 }, pan: 0, mono: true, verb: null, duck: { by: 'kick', depth: 5 }, fix: 1 },
  // bass ≈ −7 vs vocal [26]; bottom 50–80, attack 700 Hz, snap 2.5 kHz [72]; 1176-style fast, 6 dB [39]
  bass: { level: -7, hpf: 30, eq: [{ type: 'peaking', f: 250, q: 1.5, gain: -2 }, { type: 'peaking', f: 700, q: 1.2, gain: 1.5 }, { type: 'peaking', f: 2500, q: 1.2, gain: 1 }], comp: { ratio: 4, attack: 0.002, release: 0.09, gr: 5 }, sat: { drive: 2, mix: 0.2 }, pan: 0, mono: true, verb: null, duck: { by: 'kick', depth: 4 }, fix: 2 },
  // lead vocal: HPF 80–120 [37][52][73]; mud 200–400 −3 narrow, nasal check, presence +2–3 at 2–5 k, air +2–4 above 10 k [37][52];
  // comp 1 fast 5–8 dB, comp 2 opto 1–3 dB [44][37]; de-ess 5–8 kHz 4–6 dB [37]; saturation light [37]; rider before comps [54];
  // reverb return about −9 LU under the dry vocal [25]; tempo delay 20–30% feedback [37]
  leadVox: { level: 0, hpf: 85, eq: [{ type: 'peaking', f: 300, q: 2.5, gain: -3 }, { type: 'peaking', f: 3500, q: 0.8, gain: 2.5 }, { type: 'highshelf', f: 11000, gain: 3 }], comp: { ratio: 6, attack: 0.004, release: 0.06, gr: 6.5 }, comp2: { ratio: 2.5, attack: 0.02, release: 0.3, gr: 2 }, deess: { f: 6500, max: 6 }, sat: { drive: 1.4, mix: 0.12 }, pan: 0, rider: true, verb: { bus: 'vox', send: -11 }, delay: { note: 0.25, send: -18, feedback: 0.25 }, fix: 3 },
  // doubles 4–6 under, harmonies 6–9 under [61]; HPF 120–200 [E]; −2 to −3 at 2–5 kHz to leave presence to the lead [49]; 4:1 [49]
  backVox: { level: -6, hpf: 150, eq: [{ type: 'peaking', f: 300, q: 2, gain: -3 }, { type: 'peaking', f: 3500, q: 0.9, gain: -2 }, { type: 'highshelf', f: 11000, gain: 1.5 }], comp: { ratio: 4, attack: 0.01, release: 0.12, gr: 4 }, deess: { f: 6500, max: 8 }, pan: 'spread', width: 1.2, verb: { bus: 'vox', send: -9 }, fix: 2 },
  // a double of the lead: 8-10 dB under it [78][79][80] (felt, not heard), high-passed above the lead, de-essed hard so
  // only the lead's "s" is heard [81], a touch darker, same compression, pan hard by its name [77][79]; room, no delay
  double: { level: -9, hpf: 160, eq: [{ type: 'peaking', f: 300, q: 2, gain: -3 }, { type: 'peaking', f: 3500, q: 0.9, gain: -1.5 }, { type: 'highshelf', f: 10000, gain: -2 }], comp: { ratio: 4, attack: 0.008, release: 0.1, gr: 5 }, deess: { f: 6500, max: 9 }, sat: { drive: 1.5, mix: 0.1 }, pan: 'spread', verb: { bus: 'vox', send: -12 }, fix: 2 },
  // the deep layer: the hook an octave down, felt under it [92]; band-limited so it's weight, not a second singer
  deep: { level: -13, hpf: 70, lpf: 2500, eq: [{ type: 'peaking', f: 300, q: 1.2, gain: -2 }], comp: { ratio: 4, attack: 0.01, release: 0.12, gr: 4 }, pan: 0, mono: true, verb: null, fix: 0 },
  // ad-libs 6–10 under [37]; HPF 150–200 [37]; more reverb and delay than the lead [2][61]; 15–30% L/R [37]
  adlib: { level: -8, hpf: 180, eq: [{ type: 'peaking', f: 350, q: 2, gain: -3 }, { type: 'peaking', f: 3000, q: 1, gain: 1.5 }, { type: 'highshelf', f: 10000, gain: -1 }], comp: { ratio: 4, attack: 0.005, release: 0.08, gr: 4 }, deess: { f: 6500, max: 6 }, sat: { drive: 1.6, mix: 0.12 }, pan: 'spread', verb: { bus: 'vox', send: -8 }, delay: { note: 0.25, send: -13, feedback: 0.3 }, fix: 2 },
  // keys −10 to −14 [E]; HPF ~75–90 [46]; dynamic-ish 300–600 Hz −1–2 [46]; 3:1 ~5 dB [46]
  keys: { level: -12, hpf: 90, eq: [{ type: 'peaking', f: 400, q: 2, gain: -2 }, { type: 'peaking', f: 3000, q: 1, gain: -1 }, { type: 'highshelf', f: 12000, gain: 1 }], comp: { ratio: 3, attack: 0.005, release: 0.05, gr: 3 }, pan: 0, width: 1.1, verb: { bus: 'beat', send: -15 }, fix: 2 },
  // pads −14 to −20 [E]; HPF 200–430 [67]; carve 1.5–5 kHz for the vocal [51][63]; light comp [E]; wide but not folded [67]
  pad: { level: -17, hpf: 250, eq: [{ type: 'peaking', f: 400, q: 1.5, gain: -2 }, { type: 'peaking', f: 2800, q: 0.8, gain: -2.5 }], comp: { ratio: 2, attack: 0.03, release: 0.25, gr: 1.5 }, pan: 0, width: 1.25, verb: { bus: 'beat', send: -11 }, fix: 1 },
  // electric/acoustic: HPF 100 (rhythm) [47][70]; fullness 240–500, +1–2 at 2 kHz [47]; 3:1 [47]; pairs hard L/R [47]
  guitar: { level: -10, hpf: 100, eq: [{ type: 'peaking', f: 300, q: 2, gain: -2 }, { type: 'peaking', f: 2000, q: 1, gain: 1.5 }, { type: 'lowpass', f: 9000, q: 0.7 }], comp: { ratio: 3, attack: 0.005, release: 0.05, gr: 3 }, pan: 'spread', width: 1.1, verb: { bus: 'beat', send: -15 }, fix: 2 },
  // synth leads −6 to −10 [E]; HPF 150–200 [E]; cut 2–5 kHz under the vocal [73]
  synth: { level: -9, hpf: 150, eq: [{ type: 'peaking', f: 350, q: 2, gain: -2 }, { type: 'peaking', f: 3000, q: 0.9, gain: -2 }], comp: { ratio: 2.5, attack: 0.015, release: 0.2, gr: 2 }, pan: 0, width: 1.15, verb: { bus: 'beat', send: -15 }, fix: 2 },
  fx: { level: -14, hpf: 150, eq: [], comp: { ratio: 2, attack: 0.03, release: 0.25, gr: 2 }, pan: 0, width: 1.25, verb: { bus: 'beat', send: -10 }, fix: 0 },
  // every instrument but drums and bass, as a splitter leaves it: keep it whole and gentle. HPF only the rumble, carve a
  // little 300 Hz and 2.5-4 kHz for the vocal [50][51][63], light 2:1 glue [38], a touch wider and some room [E]
  music: { level: -5, hpf: 35, eq: [{ type: 'peaking', f: 300, q: 1.4, gain: -1.5 }, { type: 'peaking', f: 3200, q: 0.8, gain: -1.5 }, { type: 'highshelf', f: 12000, gain: 1 }], comp: { ratio: 2, attack: 0.02, release: 0.2, gr: 1.5 }, pan: 0, width: 1.1, verb: { bus: 'beat', send: -20 }, fix: 1 },
  // 2-track beat: vocal ≈ beat [25]; check 200–300 Hz [50]; music bus 1.5:1 [38]; the vocal ducks its mids 2–3 dB [50][63]
  beat: { level: 0, hpf: 20, eq: [{ type: 'peaking', f: 250, q: 1.2, gain: -1 }], comp: { ratio: 1.5, attack: 0.03, release: 0.2, gr: 1.5 }, pan: 0, verb: null, fix: 1 },
};

// Genre: loudness target (integrated LUFS) and true-peak ceiling [19][20][21][22][36][38]; vocal-bus offset over the beat in LU [25];
// low end and brightness (dB moves) [27]; space (reverb/delay send offset dB); vocal reverb decay and pre-delay [37][55][58][61];
// delay note [2][37][61]; vocal compression ratio [37][61][73]; how much the 808/bass ducks the kick; tonal target (octave bands);
// dist: a parallel distortion bus under the lead (dB; null = none) [92][95]; parComp: parallel compression under the drums (dB) [96];
// punch: dB lifted off the start of every drum hit; slap: a 110 ms slap on the lead (dB); deep: an octave-down layer under the hooks [92].
// tune: pitch correction on every vocal, the way every pro vocal template starts (Auto-Key then Auto-Tune on each take) [92][93][94]:
// retune speed in ms (Auto-Tune's 0 is instant, melodic rap sits near 8-20, natural voices 60-120) and how much of the correction to apply.
// arrange: the build-up into each chorus (sweep top Hz, beats the beat drops, beats the vocal effects go dry, the throw dB)
// and the lifts (lead, doubles in dB; verse tucks of the doubles, verse room) [82][83][84][85][86].
const BASE_TONE = [-6, 0, 1, 0, -0.5, -1.5, -3.5, -6, -9.5, -15.5];
const tone = (d) => BASE_TONE.map((v, i) => v + (d[i] || 0));
export const GENRES = {
  hiphop: { name: 'Hip-hop / rap', air: -10, doubler: -10, delayDuck: 9, clip: -6, lift: 3, dist: -12, parComp: -9, punch: 2, slap: -18, deep: true, tune: { speedMs: 60, strength: 0.8 }, arrange: { sweepTo: 400, dropBeats: 2, punchBeats: 1, throwDb: 8, liftLead: 1, liftDouble: 2 }, lufs: -8.5, tp: -1, vox: 1.5, low: 1.5, bright: 1, space: -2, width: 1, duck: 1, voxRatio: 5, verbDecay: 1.2, predelay: 0.03, verbDuck: true, delayNote: 0.125, voxHpf: 100, tone: tone([2, 2, 1, 0, 0, 0, 0, 0.5, 1, 1]) },
  trap: { name: 'Trap', air: -10, doubler: -9, delayDuck: 9, clip: -6, lift: 3, dist: -10, parComp: -8, punch: 2.5, slap: -20, deep: true, tune: { speedMs: 20, strength: 1 }, arrange: { sweepTo: 450, dropBeats: 2, punchBeats: 1, throwDb: 9, liftLead: 1, liftDouble: 2.5 }, lufs: -8, tp: -1, vox: 1, low: 2.5, bright: 1.5, space: -1, width: 1.05, duck: 1.2, voxRatio: 8, verbDecay: 1, predelay: 0.025, verbDuck: true, delayNote: 0.1875, voxHpf: 110, tone: tone([3, 2.5, 1, 0, -0.5, 0, 0, 0.5, 1, 1.5]) },
  drill: { name: 'Drill', air: -10, doubler: -10, delayDuck: 9, clip: -6, lift: 3, dist: -10, parComp: -8, punch: 2.5, slap: null, deep: true, tune: { speedMs: 30, strength: 1 }, arrange: { sweepTo: 450, dropBeats: 2, punchBeats: 1, throwDb: 8, liftLead: 1, liftDouble: 2 }, lufs: -8, tp: -1, vox: 1, low: 2, bright: 1, space: -2, width: 1, duck: 1.2, voxRatio: 4, verbDecay: 0.9, predelay: 0.025, verbDuck: true, delayNote: 0.25, voxHpf: 95, tone: tone([3, 2, 0.5, 0, 0, 0, 0, 0.5, 1, 1]) },
  rnb: { name: 'R&B', air: -9, doubler: -9, delayDuck: 7, clip: -6, lift: 2.5, dist: null, parComp: -12, punch: 1, slap: null, deep: false, tune: { speedMs: 25, strength: 1 }, arrange: { sweepTo: 250, dropBeats: 1, punchBeats: 1, throwDb: 7, liftLead: 0.8, liftDouble: 2, verseVerb: 4 }, lufs: -10, tp: -1, vox: 0.5, low: 1, bright: 0, space: 2, width: 1.15, duck: 0.8, voxRatio: 4, verbDecay: 2.5, predelay: 0.08, verbDuck: true, delayNote: 0.25, voxHpf: 80, tone: tone([1, 1, 0.5, 0, 0, 0, -0.5, -0.5, -0.5, -0.5]) },
  pop: { name: 'Pop', air: -9, doubler: -9, delayDuck: 8, clip: -6, lift: 3, dist: -14, parComp: -10, punch: 1.5, slap: -20, deep: false, tune: { speedMs: 25, strength: 1 }, arrange: { sweepTo: 320, dropBeats: 2, punchBeats: 1, throwDb: 8, liftLead: 1.2, liftDouble: 2.5 }, lufs: -8.5, tp: -1, vox: 0.5, low: 0.5, bright: 1.5, space: 1, width: 1.2, duck: 0.8, voxRatio: 4, verbDecay: 1.8, predelay: 0.05, verbDuck: false, delayNote: 0.25, voxHpf: 85, tone: tone([0.5, 1, 0.5, 0, 0, 0, 0.5, 1, 1, 1]) },
  rock: { name: 'Rock', air: -12, doubler: -12, delayDuck: 6, clip: -5, lift: 2, dist: -8, parComp: -8, punch: 2, slap: -16, deep: false, tune: { speedMs: 90, strength: 0.6 }, arrange: { sweepTo: 250, dropBeats: 2, punchBeats: 1, throwDb: 8, liftLead: 1.5, liftDouble: 3, verseDouble: -3, verseVerb: 2 }, lufs: -8.5, tp: -1, vox: -1, low: 0, bright: 0.5, space: 0, width: 1.2, duck: 0.5, voxRatio: 4, verbDecay: 1.6, predelay: 0.04, verbDuck: false, delayNote: 0.25, voxHpf: 90, tone: tone([-1, 0, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, -0.5]) },
  edm: { name: 'EDM / dance', air: -10, doubler: -9, delayDuck: 8, clip: -6, lift: 3, dist: -10, parComp: -8, punch: 2, slap: null, deep: false, tune: { speedMs: 15, strength: 1 }, arrange: { sweepTo: 600, dropBeats: 4, punchBeats: 2, throwDb: 10, liftLead: 1, liftDouble: 2.5 }, lufs: -8, tp: -1, vox: -1.5, low: 2, bright: 1.5, space: 1, width: 1.25, duck: 1.6, voxRatio: 5, verbDecay: 2.2, predelay: 0.04, verbDuck: true, delayNote: 0.1875, voxHpf: 100, tone: tone([2, 2, 0.5, 0, -0.5, 0, 0, 1, 1.5, 1.5]) },
  afrobeats: { name: 'Afrobeats', air: -9, doubler: -9, delayDuck: 7, clip: -6, lift: 2.5, dist: null, parComp: -10, punch: 1.5, slap: null, deep: false, tune: { speedMs: 40, strength: 0.9 }, arrange: { sweepTo: 300, dropBeats: 2, punchBeats: 1, throwDb: 7, liftLead: 1, liftDouble: 2 }, lufs: -9, tp: -1, vox: 1, low: 1.5, bright: 1, space: 1, width: 1.15, duck: 0.8, voxRatio: 3, verbDecay: 1.3, predelay: 0.04, verbDuck: false, delayNote: 0.25, voxHpf: 90, tone: tone([1.5, 1.5, 0.5, 0, 0, 0, 0, 0.5, 1, 1]) },
  lofi: { name: 'Lo-fi', air: null, doubler: null, delayDuck: 4, clip: null, lift: 1.5, dist: -14, parComp: null, punch: 0, slap: -16, deep: false, tune: { speedMs: 80, strength: 0.6 }, arrange: { sweepTo: 200, dropBeats: 1, punchBeats: 0.5, throwDb: 4, liftLead: 0.5, liftDouble: 1, verseVerb: 2 }, lufs: -13, tp: -1, vox: -1.5, low: 1, bright: -2.5, space: 1.5, width: 1, duck: 0.5, voxRatio: 3, verbDecay: 1.6, predelay: 0.03, verbDuck: false, delayNote: 0.25, voxHpf: 100, tone: tone([1, 1, 1, 0.5, 0, 0, -0.5, -2, -4, -6]) },
  country: { name: 'Country / acoustic', air: -12, doubler: null, delayDuck: 5, clip: -6, lift: 1.5, dist: null, parComp: null, punch: 1, slap: -18, deep: false, tune: { speedMs: 120, strength: 0.5 }, arrange: { sweepTo: 180, dropBeats: 1, punchBeats: 0.5, throwDb: 5, liftLead: 1, liftDouble: 1.5, verseDouble: -2 }, lufs: -9, tp: -1, vox: 1, low: -0.5, bright: 0.5, space: 1, width: 1.15, duck: 0.4, voxRatio: 3, verbDecay: 1.6, predelay: 0.04, verbDuck: false, delayNote: 0.25, voxHpf: 80, tone: tone([-1.5, -0.5, 0, 0, 0, 0, 0, 0, -0.5, -1]) },
  latin: { name: 'Latin / reggaeton', air: -9, doubler: -9, delayDuck: 7, clip: -6, lift: 2.5, dist: null, parComp: -10, punch: 1.5, slap: null, deep: false, tune: { speedMs: 40, strength: 0.9 }, arrange: { sweepTo: 350, dropBeats: 2, punchBeats: 1, throwDb: 8, liftLead: 1, liftDouble: 2 }, lufs: -8, tp: -1, vox: 0.5, low: 2, bright: 1, space: 0, width: 1.1, duck: 1, voxRatio: 4, verbDecay: 1.4, predelay: 0.04, verbDuck: true, delayNote: 0.125, voxHpf: 90, tone: tone([2, 2, 1, 0, 0, 0, 0, 0.5, 1, 1]) },
};
export const GENRE_IDS = Object.keys(GENRES);

// Guardrails the planner never crosses, however a stem measures or the AI suggests.
export const LIMITS = { boost: 4, cut: 6, fixCut: 5, trim: 30, macro: 3 };

// Plain-language lines shown while the mix runs.
export const TIPS = [
  "Cutting 200–400 Hz mud from the vocal so the words come forward",
  "Sidechaining the 808 to the kick so they stop fighting",
  "Keeping everything under 120 Hz in mono for phones and clubs",
  "Adding gentle saturation to the 808 so it shows up on small speakers",
  "Compressing the vocal in two stages so it stays steady but natural",
  "Taming harsh “s” sounds between 5 and 8 kHz with a de-esser",
  "Adding a soft air shelf above 10 kHz to make the vocal shimmer",
  "Setting ad-libs 6–10 dB below the lead so they support, not compete",
  "Panning ad-libs left and right so the lead keeps the centre",
  "Tucking vocal doubles 4–6 dB under the lead for a thicker hook",
  "Timing delays to your tempo so echoes land on the beat",
  "Filtering reverb below 250 Hz so the space doesn’t muddy the bass",
  "Keeping reverb about 9 dB under the dry vocal so words stay clear",
  "Adding pre-delay so the reverb starts after each word, not on top of it",
  "Ducking the beat 2–3 dB in the vocal range only while the vocal sings",
  "High-passing hi-hats around 300 Hz to clear room for the low end",
  "Panning hi-hats 30–50% off centre for a wider groove",
  "Shaving harsh resonances, one third-octave at a time",
  "Giving the kick a 4 kHz click so it cuts through without more volume",
  "Gluing the mix bus with 2:1 compression and only 2–3 dB of squeeze",
  "Clipping the peaks before the limiter for loud but clean punch",
  "Limiting to a −1 dBTP ceiling so streaming encoders don’t distort",
  "Matching tonal balance to finished records in your genre",
  "Brightening the snare’s crack around 5 kHz for backbeat snap",
  "Riding the vocal level phrase by phrase before it hits the compressor",
  "Spreading double-tracked guitars hard left and right",
];

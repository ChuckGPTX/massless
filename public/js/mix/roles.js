// What each stem is. File and folder names say the most ("Kick", "808", "Lead Vox", "Adlibs"); when a stem is
// called "Audio 14" the sound decides (low end, transients, brightness, stereo). The scene writer on the
// server can relabel anything, but only to one of these roles.

export const ROLES = {
  kick: { name: 'Kick', group: 'drums', color: '#ff5b5b' },
  snare: { name: 'Snare / clap', group: 'drums', color: '#ff8a4c' },
  hats: { name: 'Hi-hats', group: 'drums', color: '#ffc94c' },
  perc: { name: 'Percussion', group: 'drums', color: '#ffb36b' },
  drums: { name: 'Drums', group: 'drums', color: '#ff7a59' },
  room: { name: 'Room / overheads', group: 'drums', color: '#e8a07a' },
  '808': { name: '808', group: 'bass', color: '#b86bff' },
  bass: { name: 'Bass', group: 'bass', color: '#8f6bff' },
  leadVox: { name: 'Lead vocal', group: 'vox', color: '#46d6ff' },
  backVox: { name: 'Backing vocals', group: 'vox', color: '#5ab8ff' },
  adlib: { name: 'Ad-libs', group: 'vox', color: '#7aa5ff' },
  keys: { name: 'Keys / piano', group: 'music', color: '#55e3a1' },
  pad: { name: 'Pad / strings', group: 'music', color: '#4cc7a0' },
  guitar: { name: 'Guitar', group: 'music', color: '#8fe06b' },
  synth: { name: 'Synth / melody', group: 'music', color: '#3fe0d0' },
  fx: { name: 'FX / risers', group: 'music', color: '#c0c6d0' },
  beat: { name: 'Beat (2-track)', group: 'music', color: '#f06bd3' },
  music: { name: 'Music', group: 'music', color: '#4fd9a8' },
};
export const ROLE_IDS = Object.keys(ROLES);

// Ordered: the first match wins, so "808 kick" is an 808, "vox reverb print" is skipped by the FX rule later.
const RULES = [
  ['adlib', /ad[\s_-]?libs?|adlb|\bad\b|hype|shouts?/],
  ['backVox', /\b(bgv|bv|bvs|bg ?vox|backing|back ?vox|background|harm(ony|onies|s)?|dbl|double|dubs?|stack|choir|oohs?|aahs?|gang)\b/],
  ['leadVox', /\b(lead ?vox|lead ?vocal|ld ?vox|main ?vox|vox|vocals?|vocal|verse|hook|chorus|rap|sing(ing|er)?|acapella|a ?cappella|voice|lv)\b/],
  ['808', /\b808s?\b|\bsub ?bass\b|\bsub\b/],
  ['kick', /\b(kick|kik|kck|bd|bassdrum|bass ?drum)\b/],
  ['snare', /\b(snare|snr|sn|clap|clp|rim(shot)?)\b/],
  ['hats', /\b(hi[\s-]?hats?|hh|hats?|oh|open ?hat|closed ?hat|cymbals?|crash|ride|shaker)\b/],
  ['perc', /\b(perc(ussion)?|tom|toms|conga|bongo|tamb(ourine)?|cowbell|block|clave|tabla|djembe|log ?drum)\b/],
  ['room', /\b(room|overheads?|ohs|amb(ience)?)\b/],
  ['drums', /\b(drums?|drum ?bus|kit|breaks?|loop ?drums?)\b/],
  ['bass', /\b(bass|bs|bassline|reese|upright)\b/],
  ['guitar', /\b(gtr|guitars?|acoustic|electric|strat|tele)\b/],
  ['keys', /\b(keys|piano|pno|rhodes|wurli|organ|ep|epiano|clav|celesta|marimba|bells?)\b/],
  ['pad', /\b(pads?|strings?|str|violin|cello|orch(estra)?|choir ?pad|atmos(phere)?|texture|drone)\b/],
  ['fx', /\b(fx|sfx|risers?|sweep|impact|downlifter|uplifter|whoosh|noise|transition|vinyl|tape ?stop)\b/],
  ['beat', /\b(beat|instrumental|inst|2 ?track|two ?track|music ?bed|track ?out|full ?beat|karaoke)\b/],
  ['synth', /\b(synths?|lead|leads|pluck|arp|melody|mel|chords?|brass|horns?|flute|sax|bell)\b/],
];

/** Lower-case words of a stem path, with camelCase, numbers and punctuation split. */
export function words(path) {
  return String(path).replace(/\.[a-z0-9]+$/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-./()[\]{}+]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function roleFromName(path) {
  const name = words(String(path).split('/').pop()), folder = words(String(path).split('/').slice(-2, -1)[0] || '');
  for (const [role, re] of RULES) if (re.test(name)) return role;
  for (const [role, re] of RULES) if (folder && re.test(folder)) return role;
  return null;
}

/** Guess from the sound when the name says nothing. f: analyzeStem() result. */
export function roleFromSound(f, { stemCount = 8 } = {}) {
  if (stemCount <= 2 && f.activeRatio > 0.7 && f.lowShare > 0.15 && f.highShare > 0.01) return 'beat';
  const punchy = f.onsetsPerSec > 1.2 && f.crestDb > 14;
  if (f.subShare > 0.45 && f.centroid < 120) return f.onsetsPerSec > 2.5 && f.crestDb > 16 ? 'kick' : '808';
  if (f.lowShare > 0.55 && punchy && f.activeRatio < 0.6) return 'kick';
  if (f.lowShare > 0.5) return 'bass';
  if (f.highShare > 0.45 && f.onsetsPerSec > 2) return 'hats';
  if (punchy && f.centroid > 400 && f.centroid < 3000 && f.activeRatio < 0.5) return 'snare';
  if (punchy && f.highShare > 0.2) return 'perc';
  // Voice: energy concentrated 200 Hz - 4 kHz, gaps between phrases, mostly mono.
  if (f.midShare > 0.55 && f.isMono && f.activeRatio < 0.85 && f.centroid > 250 && f.centroid < 2500) return f.activeRatio < 0.25 ? 'adlib' : 'leadVox';
  if (!f.isMono && f.width > 0.35 && f.onsetsPerSec < 1) return 'pad';
  if (f.activeRatio < 0.12 && f.highShare > 0.25) return 'fx';
  return 'synth';
}

/**
 * Label every stem. stems: [{ path, feats }]. Picks one lead vocal: the vocal stem that plays longest.
 * Returns [{ role, source: 'name' | 'sound' }].
 */
export function labelStems(stems) {
  const out = stems.map((s) => {
    const byName = roleFromName(s.path);
    return byName ? { role: byName, source: 'name' } : { role: roleFromSound(s.feats, { stemCount: stems.length }), source: 'sound' };
  });
  const leads = out.map((o, i) => (o.role === 'leadVox' ? i : -1)).filter((i) => i >= 0);
  if (leads.length > 1) {
    // Several "vocal" stems: the longest-playing one leads, the others are verses/hook parts of the same voice
    // unless their names say double/harmony. Verse and hook files by one artist all stay lead.
    const named = leads.filter((i) => /\b(verse|hook|chorus|bridge|intro|outro|lead|main)\b/.test(words(stems[i].path)));
    if (named.length < leads.length) {
      const longest = leads.reduce((a, b) => (stems[b].feats.activeSeconds > stems[a].feats.activeSeconds ? b : a));
      for (const i of leads) if (i !== longest && !named.includes(i) && stems[i].feats.activeSeconds < stems[longest].feats.activeSeconds * 0.35) out[i] = { role: 'backVox', source: out[i].source };
    }
  }
  return out;
}

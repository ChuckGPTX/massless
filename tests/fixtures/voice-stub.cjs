// A stand-in for the site's voice (/api/tts) in browser tests: a speech-like WAV made from the script itself.
// Each word is a run of voiced syllables as long as its letters, with short dips between words and longer pauses at
// commas and full stops, so the talking ad can line the words up with it the way it does with the real voice.
// speechWav(text) -> { wav: Buffer, words: [{ w, t0, t1 }] } (the true word times, for checking the alignment).
function speechWav(text, rate = 24000) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 80);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const plan = [];
  let t = 0.22;
  for (const w of words) {
    const letters = w.replace(/[^a-z0-9]/gi, '').length || 2;
    const d = (letters * 0.058 + 0.08) * (0.85 + 0.3 * rnd());
    const syl = Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) || []).length);
    plan.push({ w, t0: t, t1: t + d, syl });
    t += d + (/[.!?]$/.test(w) ? 0.48 : /[,;:]$/.test(w) ? 0.26 : 0.015 + 0.03 * rnd());
  }
  const seconds = t + 0.35, n = Math.ceil(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let k = 0, phase = 0;
  for (let i = 0; i < n; i++) {
    const s = i / rate;
    while (k < plan.length - 1 && s > plan[k].t1) k++;
    const p = plan[k];
    let env = 0;
    if (s >= p.t0 && s <= p.t1) {
      const u = (s - p.t0) / (p.t1 - p.t0);
      env = 0.35 + 0.65 * Math.abs(Math.sin(u * Math.PI * p.syl)); // syllables
      env *= Math.min(1, (s - p.t0) / 0.02, (p.t1 - s) / 0.02); // no clicks
    }
    const f0 = 135 + 25 * Math.sin(s * 2.1) + 12 * Math.sin(s * 9);
    phase += (2 * Math.PI * f0) / rate;
    const v = Math.sin(phase) * 0.6 + Math.sin(phase * 2) * 0.25 + Math.sin(phase * 3) * 0.15;
    b.writeInt16LE(Math.round(v * env * 11000), 44 + i * 2);
  }
  return { wav: b, words: plan.map(({ w, t0, t1 }) => ({ w, t0, t1 })) };
}
module.exports = { speechWav };

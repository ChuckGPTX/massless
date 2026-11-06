// Sample-domain effects the bus stage uses: a transient shaper and the octave-down "deep" layer.

/**
 * Transient shaper: lifts the first milliseconds of every hit by `attackDb` (the AVOX Punch / SPL Transient
 * Designer idea). Two envelope followers, fast and slow; where the fast one leads, the hit is starting.
 */
export function transientShape(chs, rate, { attackDb = 2.5, sustainDb = 0 } = {}) {
  const n = chs[0].length, out = chs.map(() => new Float32Array(n));
  const aFast = Math.exp(-1 / (rate * 0.0008)), aSlow = Math.exp(-1 / (rate * 0.02)), rel = Math.exp(-1 / (rate * 0.05));
  let fast = 0, slow = 0;
  const gA = 10 ** (attackDb / 20) - 1, gS = 10 ** (sustainDb / 20) - 1;
  for (let i = 0; i < n; i++) {
    let x = 0; for (const c of chs) x = Math.max(x, Math.abs(c[i]));
    fast = x > fast ? x + (fast - x) * aFast : x + (fast - x) * rel;
    slow = x > slow ? x + (slow - x) * aSlow : x + (slow - x) * rel;
    const lead = slow > 1e-4 ? Math.max(0, Math.min(1, (fast - slow) / slow)) : 0; // 0..1: how much the fast follower leads
    const g = 1 + gA * lead + gS * (1 - lead) * (slow > 1e-3 ? 1 : 0);
    for (let c = 0; c < chs.length; c++) out[c][i] = chs[c][i] * g;
  }
  return out;
}

/** An octave down, for the "deep vox" layer under a hook: granular shift by a ratio of 0.5, 60 ms grains. */
export function octaveDown(mono, rate) {
  const grain = Math.round(rate * 0.06), hop = grain >> 1, out = new Float32Array(mono.length), ratio = 0.5;
  const win = new Float32Array(grain); for (let i = 0; i < grain; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / grain);
  for (let g = 0; g + hop < mono.length; g += hop) {
    for (let i = 0; i < grain && g + i < out.length; i++) {
      const src = g + i * ratio, j = Math.floor(src), fr = src - j;
      if (j + 1 >= mono.length) break;
      out[g + i] += (mono[j] * (1 - fr) + mono[j + 1] * fr) * win[i];
    }
  }
  return out;
}

// Loudness for Massless, shared by Extract audio and Master: the ITU-R BS.1770 meter, loudness range, a 4x
// oversampled true-peak meter and the look-ahead limiter (which can watch true peaks instead of samples).
// Pure JavaScript with no DOM, so it runs in workers, pages and the Node tests.

// ---------------------------------------------------------------------------------------------
// Loudness: ITU-R BS.1770-4 K-weighting, 400 ms blocks every 100 ms, absolute and relative gates
// ---------------------------------------------------------------------------------------------

/** K-weighting biquads for any sample rate (the pre-filter shelf and the RLB high-pass), as libebur128 derives them. */
export function kWeights(fs) {
  let f0 = 1681.974450955533;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (3.999843853973347 / 20);
  const Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const shelf = { b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  const d = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / d, (1 - K / Q + K * K) / d] };
  return [shelf, hp];
}

/** Streaming integrated-loudness meter. push() planar channels; integrated() gives LUFS (-Infinity for silence). */
export class LoudnessMeter {
  constructor(rate, channels, frames) {
    this.sub = Math.max(1, Math.round(rate / 10)); // 100 ms
    this.bins = new Float64Array(Math.ceil((frames + 1) / this.sub) + 2);
    this.n = 0;
    this.f = kWeights(rate);
    this.s = new Float64Array(channels * 4); // two transposed direct-form II states per biquad, per channel
    this.peak = 0;
  }

  push(chs, len) {
    const [{ b: pb, a: pa }, { b: rb, a: ra }] = this.f;
    const { bins, sub, s } = this;
    let peak = this.peak;
    for (let c = 0; c < chs.length; c++) {
      const x = chs[c];
      let s1 = s[c * 4];
      let s2 = s[c * 4 + 1];
      let s3 = s[c * 4 + 2];
      let s4 = s[c * 4 + 3];
      let bin = Math.floor(this.n / sub);
      let left = sub - (this.n % sub);
      let acc = 0;
      for (let i = 0; i < len; i++) {
        const v = x[i];
        const av = v < 0 ? -v : v;
        if (av > peak) peak = av;
        const y = pb[0] * v + s1;
        s1 = pb[1] * v - pa[0] * y + s2;
        s2 = pb[2] * v - pa[1] * y;
        const z = rb[0] * y + s3;
        s3 = rb[1] * y - ra[0] * z + s4;
        s4 = rb[2] * y - ra[1] * z;
        acc += z * z;
        if (--left === 0) {
          bins[bin++] += acc;
          acc = 0;
          left = sub;
        }
      }
      if (acc) bins[bin] += acc;
      s[c * 4] = s1;
      s[c * 4 + 1] = s2;
      s[c * 4 + 2] = s3;
      s[c * 4 + 3] = s4;
    }
    this.peak = peak;
    this.n += len;
  }

  integrated() {
    const done = Math.floor(this.n / this.sub);
    const z = [];
    for (let j = 0; j + 4 <= done; j++) z.push((this.bins[j] + this.bins[j + 1] + this.bins[j + 2] + this.bins[j + 3]) / (4 * this.sub));
    if (!z.length && this.n) z.push(this.bins.slice(0, done + 1).reduce((a, b) => a + b, 0) / this.n); // under 400 ms: one block
    const lufs = (e) => -0.691 + 10 * Math.log10(e);
    const above = z.filter((e) => e > 0 && lufs(e) > -70);
    if (!above.length) return -Infinity;
    const rel = lufs(above.reduce((a, b) => a + b, 0) / above.length) - 10;
    const gated = above.filter((e) => lufs(e) > rel);
    return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  }

  /** Short-term loudness (3 s windows) every 100 ms, in LUFS. */
  shortTerm() {
    const done = Math.floor(this.n / this.sub);
    const out = [];
    let acc = 0;
    for (let j = 0; j < done; j++) {
      acc += this.bins[j];
      if (j >= 30) acc -= this.bins[j - 30];
      if (j >= 29) out.push(-0.691 + 10 * Math.log10(acc / (30 * this.sub)));
    }
    return out;
  }

  /** Loudness range in LU (EBU Tech 3342): the spread from the 10th to the 95th percentile of gated short-term loudness. */
  lra() {
    const st = this.shortTerm().filter((l) => l > -70);
    if (st.length < 2) return 0;
    const mean = 10 * Math.log10(st.reduce((a, l) => a + 10 ** (l / 10), 0) / st.length);
    const g = st.filter((l) => l > mean - 20).sort((a, b) => a - b);
    if (g.length < 2) return 0;
    const pct = (p) => g[Math.min(g.length - 1, Math.max(0, Math.round((p / 100) * (g.length - 1))))];
    return pct(95) - pct(10);
  }
}

// ---------------------------------------------------------------------------------------------
// True peak: oversampling as in ITU-R BS.1770-4 Annex 2. Each in-between phase is a 24-tap Kaiser-windowed sinc
// interpolator, so peaks that fall between samples are seen. The meter uses 4x, the standard.
// ---------------------------------------------------------------------------------------------

export const TP_TAPS = 24;
const TP_LEFT = TP_TAPS / 2 - 1; // taps before the sample (11); TP_RIGHT after it (12)
const TP_RIGHT = TP_TAPS - TP_LEFT - 1;
function besselI0(x) {
  let s = 1;
  let t = 1;
  for (let k = 1; k < 30; k++) {
    t *= (x / (2 * k)) ** 2;
    s += t;
  }
  return s;
}
/** Interpolation filters for the in-between phases 1/up .. (up-1)/up, flattened: coef[tap * (up - 1) + phase]. */
export function tpPhases(up) {
  const P = up - 1;
  const beta = 7;
  const half = TP_RIGHT + 0.5;
  const coef = new Float64Array(TP_TAPS * P);
  for (let p = 0; p < P; p++) {
    const d = (p + 1) / up;
    let sum = 0;
    for (let m = -TP_LEFT; m <= TP_RIGHT; m++) {
      const t = d - m;
      const sinc = Math.sin(Math.PI * t) / (Math.PI * t);
      const r = t / half;
      const w = Math.abs(r) < 1 ? besselI0(beta * Math.sqrt(1 - r * r)) / besselI0(beta) : 0;
      coef[(m + TP_LEFT) * P + p] = sinc * w;
      sum += sinc * w;
    }
    for (let k = 0; k < TP_TAPS; k++) coef[k * P + p] /= sum;
  }
  return { up, P, coef };
}
export const TP4 = tpPhases(4); // the BS.1770 meter
function l1Norm({ P, coef }) {
  let best = 1;
  for (let p = 0; p < P; p++) {
    let s = 0;
    for (let k = 0; k < TP_TAPS; k++) s += Math.abs(coef[k * P + p]);
    if (s > best) best = s;
  }
  return best;
}
const L1_TP4 = l1Norm(TP4);
export const TP8 = tpPhases(8); // the limiter looks closer, so the meter never reads over its ceiling

/** The true peak (linear) of x over [j, j + 1): |x[j]| and the interpolated points after it. x[j - 5 .. j + 6] must exist. */
function peakBetween(x, j, { P, coef }, acc) {
  acc.fill(0);
  for (let k = 0, i = j - TP_LEFT, o = 0; k < TP_TAPS; k++, i++) {
    const v = x[i];
    for (let p = 0; p < P; p++, o++) acc[p] += coef[o] * v;
  }
  let pk = x[j] < 0 ? -x[j] : x[j];
  for (let p = 0; p < P; p++) {
    const a = acc[p] < 0 ? -acc[p] : acc[p];
    if (a > pk) pk = a;
  }
  return pk;
}

/** The same on a ring buffer of length S holding the frame j at j % S. */
function peakInRing(x, j, S, { P, coef }, acc) {
  acc.fill(0);
  let i = (((j - TP_LEFT) % S) + S) % S;
  for (let k = 0, o = 0; k < TP_TAPS; k++) {
    const v = x[i];
    for (let p = 0; p < P; p++, o++) acc[p] += coef[o] * v;
    if (++i === S) i = 0;
  }
  const v = x[j % S];
  let pk = v < 0 ? -v : v;
  for (let p = 0; p < P; p++) {
    const a = acc[p] < 0 ? -acc[p] : acc[p];
    if (a > pk) pk = a;
  }
  return pk;
}

/** Streaming true-peak meter: push() planar chunks, then finish(); peak is linear, dBTP() in decibels. */
export class TruePeakMeter {
  constructor(channels) {
    this.hist = Array.from({ length: channels }, () => new Float32Array(TP_TAPS - 1)); // the last TP_TAPS - 1 samples (silence before the start)
    this.peak = 0;
    this.acc = new Float64Array(TP4.P);
    this.dq = new Int32Array(0);
  }

  push(chs, len = chs[0].length) {
    const H = TP_TAPS - 1;
    let peak = this.peak;
    for (let c = 0; c < chs.length; c++) {
      const buf = new Float32Array(H + len);
      buf.set(this.hist[c]);
      buf.set(chs[c].subarray(0, len), H);
      // every frame whose interpolation window is now complete and was not complete before. A frame whose
      // window holds no sample above peak / l1 cannot set a new peak, so most frames skip the filter.
      // sliding maximum of |buf| over [j - TP_LEFT, j + TP_RIGHT] with a monotonic deque of indexes
      if (this.dq.length < buf.length) this.dq = new Int32Array(buf.length);
      const q = this.dq;
      let qh = 0;
      let qt = 0;
      const add = (i) => {
        const a = buf[i] < 0 ? -buf[i] : buf[i];
        while (qt > qh && (buf[q[qt - 1]] < 0 ? -buf[q[qt - 1]] : buf[q[qt - 1]]) <= a) qt--;
        q[qt++] = i;
      };
      for (let i = 0; i < TP_TAPS - 1; i++) add(i);
      for (let j = TP_LEFT; j < buf.length - TP_RIGHT; j++) {
        add(j + TP_RIGHT);
        while (q[qh] < j - TP_LEFT) qh++;
        const near = buf[q[qh]] < 0 ? -buf[q[qh]] : buf[q[qh]];
        if (near * L1_TP4 <= peak) continue;
        const p = peakBetween(buf, j, TP4, this.acc);
        if (p > peak) peak = p;
      }
      this.hist[c] = buf.slice(buf.length - H);
    }
    this.peak = peak;
  }

  /** The last few samples have no future yet: judge them as if silence followed. */
  finish() {
    this.push(this.hist.map(() => new Float32Array(TP_RIGHT)), TP_RIGHT);
    return this.peak;
  }

  dBTP() {
    return this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity;
  }
}

/** True peak of whole planar channels, in dBTP. */
export function truePeakDb(chs) {
  const m = new TruePeakMeter(chs.length);
  m.push(chs, chs[0]?.length || 0);
  m.finish();
  return m.dBTP();
}

// ---------------------------------------------------------------------------------------------
// Limiter: the bed limiter from audio-engine.js (linked channels, 2 ms look-ahead, ~80 ms release),
// made streaming. Output lags input by `look` frames; flush() pushes the tail out.
// With { truePeak: true } the detector watches the peak between samples (8x oversampled, finer than the 4x
// BS.1770 meter) instead of the samples alone, looking 12 frames further ahead to see them, so a -1 dBTP ceiling
// is a true-peak ceiling as any meter reads it.
// ---------------------------------------------------------------------------------------------

export class Limiter {
  constructor(channels, rate, ceiling, gain = 1, { truePeak = false, lookahead = 0.002, release = 0.08 } = {}) {
    this.tp = truePeak ? TP8 : null;
    this.acc = new Float64Array(TP8.P);
    // a cheap bound skips the interpolation where no in-between peak can reach the ceiling: the largest sample
    // in the filter's reach times the largest sum of |taps| of any phase
    this.l1 = truePeak ? l1Norm(TP8) : 1;
    this.mq = new Int32Array(TP_TAPS + 2); // sliding maximum of |x| over the last TP_TAPS frames (indexes)
    this.mv = new Float32Array(TP_TAPS + 2);
    this.mh = 0;
    this.mt = 0;
    this.ch = channels;
    this.ceil = ceiling;
    this.g = gain;
    const W = (this.W = Math.max(1, Math.round(lookahead * rate)));
    const D = (this.D = truePeak ? TP_RIGHT : 0); // the detector needs this many frames of the future
    const S = (this.S = truePeak ? Math.max(W + D + 1, TP_TAPS) : W + 1);
    this.rel = 1 - Math.exp(-1 / (release * rate));
    this.x = Array.from({ length: channels }, () => new Float32Array(S)); // delay line
    this.lim = new Float32Array(W + 1).fill(1); // the last W + 1 windowed minimums
    this.qi = new Float64Array(W + 3); // monotonic deque of (index, need) for the sliding minimum: up to W + 2 entries
    this.qv = new Float32Array(W + 3);
    this.qh = 0;
    this.qt = 0;
    this.box = W + 1; // as if preceded by unity gain
    this.gain = 1;
    this.minGain = 1;
    this.k = 0; // input frames seen
    // Pre-roll silent frames and drop their output: the gain can then ramp down ahead of a peak in the very
    // first frame too (the beds never needed this, they fade in from silence).
    this.drop = 0;
    this.process(null, W + D);
    this.drop = W + D;
  }

  /** Feed len frames (planar); returns planar output, len frames long except at the very start. */
  process(chs, len) {
    const { ch, W, D, S, x, lim, qi, qv, ceil, g, rel } = this;
    const cap = W + 3;
    const out = Array.from({ length: ch }, () => new Float32Array(len));
    let o = 0;
    for (let i = 0; i < len; i++) {
      const k = this.k++;
      let p = 0;
      for (let c = 0; c < ch; c++) {
        const v = chs ? chs[c][i] : 0;
        x[c][k % S] = v;
        const a = v < 0 ? -v : v;
        if (a > p) p = a;
      }
      if (D) {
        // slide the window maximum: frames k - TP_TAPS + 1 .. k
        const mc = TP_TAPS + 2;
        while (this.mt !== this.mh && this.mv[(this.mt - 1 + mc) % mc] <= p) this.mt = (this.mt - 1 + mc) % mc;
        this.mq[this.mt] = k;
        this.mv[this.mt] = p;
        this.mt = (this.mt + 1) % mc;
        while (this.mq[this.mh] <= k - TP_TAPS) this.mh = (this.mh + 1) % mc;
      }
      const j = k - D; // the frame whose peak can now be judged
      if (j < 0) continue;
      if (D) {
        const near = this.mv[this.mh]; // the largest sample the interpolation for frame j can see
        p = 0;
        if (near * this.l1 * g > ceil) for (let c = 0; c < ch; c++) { const a = peakInRing(x[c], j, S, this.tp, this.acc); if (a > p) p = a; }
        else p = near; // under the ceiling either way
      }
      p *= g;
      const need = p > ceil ? ceil / p : 1;
      // push need[j]; keep the deque increasing; drop indexes older than j - W
      while (this.qt !== this.qh && qv[(this.qt - 1 + cap) % cap] >= need) this.qt = (this.qt - 1 + cap) % cap;
      qi[this.qt] = j;
      qv[this.qt] = need;
      this.qt = (this.qt + 1) % cap;
      while (qi[this.qh] < j - W) this.qh = (this.qh + 1) % cap;
      const m = j - W; // the frame whose look-ahead window is now complete
      if (m < 0) continue;
      const l = qv[this.qh];
      const slot = m % (W + 1);
      this.box += l - lim[slot];
      lim[slot] = l;
      this.gain = Math.min(this.box / (W + 1), this.gain + (1 - this.gain) * rel);
      if (this.drop) {
        this.drop--;
        continue;
      }
      if (this.gain < this.minGain) this.minGain = this.gain;
      const v = g * this.gain;
      const src = m % S; // where x[m] sits in the delay line
      for (let c = 0; c < ch; c++) out[c][o] = x[c][src] * v;
      o++;
    }
    return o === len ? out : out.map((a) => a.subarray(0, o));
  }

  /** The last frames still in the delay line. */
  flush() {
    return this.process(null, this.W + this.D);
  }
}

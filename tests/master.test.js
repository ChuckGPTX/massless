import test from "node:test";
import assert from "node:assert/strict";
import * as M from "../public/js/master.js";
import { truePeakDb, TruePeakMeter, Limiter, LoudnessMeter } from "../public/js/loudness.js";

const RATE = 44100;
const SECONDS = 6;
const N = RATE * SECONDS;
let seed = 11;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return (seed / 2 ** 32) * 2 - 1;
};

// An independent true-peak oracle: 16x windowed-sinc (Blackman, 64 taps) interpolation, away from the edges.
function oracleTp(chs, up = 16, half = 32) {
  const phases = [];
  for (let p = 1; p < up; p++) {
    const d = p / up;
    const h = [];
    let s = 0;
    for (let m = -half + 1; m <= half; m++) {
      const t = d - m;
      const w = 0.42 + 0.5 * Math.cos((Math.PI * t) / half) + 0.08 * Math.cos((2 * Math.PI * t) / half);
      const v = (Math.sin(Math.PI * t) / (Math.PI * t)) * w;
      h.push(v);
      s += v;
    }
    phases.push(h.map((v) => v / s));
  }
  let peak = 0;
  for (const x of chs) {
    for (let j = half; j < x.length - half; j++) {
      const a = Math.abs(x[j]);
      if (a > peak) peak = a;
      if (a < 0.5 * peak) continue; // an in-between peak this far under the top cannot matter
      for (const h of phases) {
        let v = 0;
        for (let k = 0; k < h.length; k++) v += h[k] * x[j - half + 1 + k];
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
    }
  }
  return 20 * Math.log10(peak);
}

const SIGNALS = {
  "sine sweep": () => {
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    let ph = 0;
    for (let i = 0; i < N; i++) {
      ph += (2 * Math.PI * 20 * 1000 ** (i / N)) / RATE;
      L[i] = 0.12 * Math.sin(ph);
      R[i] = 0.12 * Math.sin(ph + 0.4);
    }
    return [L, R];
  },
  noise: () => {
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      L[i] = 0.05 * rnd();
      R[i] = 0.05 * rnd();
    }
    return [L, R];
  },
  "clipped loud mix": () => {
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / RATE;
      const beat = Math.exp(-(t % 0.5) * 10);
      const v = Math.max(-1, Math.min(1, 2.2 * beat * Math.sin(2 * Math.PI * 55 * t) + 0.6 * Math.sin(2 * Math.PI * 220 * t) + 0.4 * rnd()));
      L[i] = v;
      R[i] = Math.max(-1, Math.min(1, v * 0.95 + 0.05 * rnd()));
    }
    return [L, R];
  },
  "peaky drums": () => {
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / RATE;
      const env = Math.exp(-(t % 0.25) * 40);
      const v = 0.5 * env * (Math.sin(2 * Math.PI * 60 * t) + 0.6 * rnd()) + 0.02 * Math.sin(2 * Math.PI * 440 * t);
      L[i] = v;
      R[i] = 0.9 * v + 0.01 * rnd();
    }
    return [L, R];
  },
};

test("true-peak meter sees peaks between samples; the limiter holds them", () => {
  // a 11.025 kHz sine at 45 degrees: every sample sits at 0.707, the wave itself reaches 1.0
  const x = new Float32Array(RATE);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 11025 * i) / RATE + Math.PI / 4);
  const tp = truePeakDb([x.subarray(1000, 40000)]);
  assert.ok(tp > -0.3 && tp < 0.3, `true peak ${tp}`);
  // chunked metering gives the same answer
  const m = new TruePeakMeter(1);
  for (let o = 1000; o < 40000; o += 777) m.push([x.subarray(o, Math.min(40000, o + 777))], Math.min(777, 40000 - o));
  m.finish();
  assert.ok(Math.abs(m.dBTP() - tp) < 1e-9);
  // the sample-peak limiter misses the in-between peaks; the true-peak one does not
  const run = (truePeak) => {
    const lim = new Limiter(1, RATE, 10 ** (-1 / 20), 2, { truePeak });
    const parts = [];
    for (let o = 0; o < x.length; o += 4096) parts.push(lim.process([x.subarray(o, o + 4096)], Math.min(4096, x.length - o))[0]);
    parts.push(lim.flush()[0]);
    const y = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { y.set(p, o); o += p.length; }
    return y;
  };
  const sp = run(false);
  const tpOut = run(true);
  assert.equal(tpOut.length, x.length);
  // measured whole: a cut-out slice would add its own edge ringing
  assert.ok(truePeakDb([sp]) > 0, "sample peaks alone let the true peak through");
  assert.ok(truePeakDb([tpOut]) <= -0.99, `true-peak limiter: ${truePeakDb([tpOut])}`);
});

test("the meter's loudness range: steady tone near 0 LU, alternating levels about their difference", () => {
  const rate = 48000;
  const steady = new Float32Array(rate * 20).map((_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / rate));
  const m = new LoudnessMeter(rate, 1, steady.length);
  m.push([steady], steady.length);
  assert.ok(m.lra() < 0.2);
  const steps = new Float32Array(rate * 40).map((_, i) => (Math.floor(i / (rate * 10)) % 2 ? 0.1 : 0.02) * Math.sin((2 * Math.PI * 1000 * i) / rate));
  const m2 = new LoudnessMeter(rate, 1, steps.length);
  m2.push([steps], steps.length);
  const lra = m2.lra();
  assert.ok(lra > 12 && lra < 15, `LRA ${lra} for 14 dB steps`);
});

for (const [name, make] of Object.entries(SIGNALS)) {
  test(`master hits every destination on ${name}: loudness within 0.5 LU, true peak at or under target`, () => {
    const chs = make();
    const report = M.analyze(chs, RATE);
    assert.equal(report.tooQuiet, false);
    assert.ok(report.lines.length >= 5 && report.lines.every((l) => l.label && l.value && l.say));
    for (const dest of Object.keys(M.DESTINATIONS)) {
      const D = M.DESTINATIONS[dest];
      const plan = M.planChain(report, dest === "loud" ? "bright" : dest === "podcast" ? "warm" : "balanced", dest, { widen: true });
      const r = M.master(chs, RATE, plan);
      assert.ok(Math.abs(r.lufs - D.lufs) <= 0.5, `${dest}: ${r.lufs} LUFS`);
      const tp = truePeakDb(r.channels);
      assert.ok(tp <= D.tp, `${dest}: ${tp} dBTP on the 4x meter`);
      assert.ok(Math.abs(tp - r.truePeak) < 1e-9, "the reported true peak is the output's");
      // a finer, independent oracle stays under the target too (within a hair)
      if (dest === "loud" || dest === "streaming") {
        const o = oracleTp(r.channels.map((x) => x.subarray(0, RATE * 2)));
        assert.ok(o <= D.tp + 0.05, `${dest}: oracle ${o} dBTP`);
      }
      assert.equal(r.channels[0].length, N, "same length as the source");
    }
  });
}

test("clipping is counted and the lossy plan leaves extra headroom", () => {
  const chs = SIGNALS["clipped loud mix"]();
  const report = M.analyze(chs, RATE);
  assert.ok(report.clips > 10, `clips ${report.clips}`);
  assert.match(report.lines.find((l) => l.label === "Clipping").say, /cannot undo/);
  const plan = M.planChain(report, "balanced", "streaming", { lossy: true });
  assert.ok(plan.ceiling <= -2);
  const r = M.master(chs, RATE, plan);
  assert.ok(r.truePeak <= -2 + 0.02);
});

test("near-silence is too quiet to master", () => {
  const L = new Float32Array(N).map(() => 1e-5 * rnd());
  const report = M.analyze([L, L.slice()], RATE);
  assert.equal(report.tooQuiet, true);
  assert.match(report.lines[0].say, /silent/i);
  assert.throws(() => M.master([L, L.slice()], RATE, M.planChain(report, "balanced", "streaming")), (e) => e.code === "quiet");
});

test("characters tilt the tone in the direction their names say", () => {
  const chs = SIGNALS.noise();
  const report = M.analyze(chs, RATE);
  const tone = (c) => {
    const pre = M.preChain(chs, RATE, M.planChain(report, c, "streaming"));
    const s = M.octaveSpectrum(pre, RATE);
    return { low: s[1] + s[2], high: s[8] + s[9] };
  };
  const warm = tone("warm");
  const bright = tone("bright");
  assert.ok(warm.low > bright.low + 1, "warm has more low end");
  assert.ok(bright.high > warm.high + 2, "bright has more highs");
  // the plan is pure: the same report gives the same chain
  assert.deepEqual(M.planChain(report, "warm", "podcast"), M.planChain(report, "warm", "podcast"));
  // width only on stereo material that can take it
  assert.equal(M.planChain({ ...report, channels: 1 }, "bright", "streaming", { widen: true }).width, 1);
  assert.equal(M.planChain(report, "bright", "streaming", { widen: true }).width, 1, "uncorrelated noise is wide enough already");
  const sweep = M.analyze(SIGNALS["sine sweep"](), RATE);
  assert.ok(M.planChain(sweep, "bright", "streaming", { widen: true }).width > 1);
});

/*! Massless Games · sound.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Sound effects synthesized with Web Audio (no samples) and a music loop rendered by the Film page's score
// engine (score.js) at the recipe's tempo. The loop is cut from the middle of a longer render, one full
// chord cycle long, with a short crossfade so it repeats without a seam.

const MUTE_KEY = 'massless-games-muted';
let noiseBuf = null;

function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const n = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = (s / 2147483648) - 1; }
  return noiseBuf;
}

// Each effect: (ctx, out, t, p) where p = { pitch, vol }. Short envelopes keep them punchy.
function tone(ctx, out, t, { type = 'square', f0, f1 = f0, dur, vol = 0.3, attack = 0.004, curve = 'exp' }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function hiss(ctx, out, t, { dur, vol = 0.3, type = 'bandpass', f0 = 2000, f1 = f0, q = 1 }) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  s.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

export const SFX = {
  jump: (c, o, t, p) => tone(c, o, t, { type: 'square', f0: 260 * p.pitch, f1: 620 * p.pitch, dur: 0.16, vol: 0.16 * p.vol }),
  djump: (c, o, t, p) => { tone(c, o, t, { type: 'square', f0: 420 * p.pitch, f1: 980 * p.pitch, dur: 0.14, vol: 0.13 * p.vol }); hiss(c, o, t, { dur: 0.12, vol: 0.08 * p.vol, f0: 5000, f1: 9000 }); },
  land: (c, o, t, p) => hiss(c, o, t, { dur: 0.08, vol: 0.12 * p.vol, type: 'lowpass', f0: 900, f1: 200 }),
  coin: (c, o, t, p) => { tone(c, o, t, { type: 'triangle', f0: 988 * p.pitch, dur: 0.07, vol: 0.2 * p.vol }); tone(c, o, t + 0.06, { type: 'triangle', f0: 1319 * p.pitch, dur: 0.18, vol: 0.2 * p.vol }); },
  gem: (c, o, t, p) => [0, 4, 7, 12].forEach((n, i) => tone(c, o, t + i * 0.035, { type: 'sine', f0: 880 * p.pitch * 2 ** (n / 12), dur: 0.22, vol: 0.13 * p.vol })),
  hit: (c, o, t, p) => { tone(c, o, t, { type: 'sawtooth', f0: 220 * p.pitch, f1: 70, dur: 0.22, vol: 0.22 * p.vol }); hiss(c, o, t, { dur: 0.16, vol: 0.25 * p.vol, f0: 1500, f1: 300 }); },
  hurt: (c, o, t, p) => { tone(c, o, t, { type: 'square', f0: 330 * p.pitch, f1: 110, dur: 0.3, vol: 0.18 * p.vol }); tone(c, o, t + 0.05, { type: 'square', f0: 311 * p.pitch, f1: 100, dur: 0.3, vol: 0.12 * p.vol }); },
  explode: (c, o, t, p) => { hiss(c, o, t, { dur: 0.55 * p.pitch, vol: 0.45 * p.vol, type: 'lowpass', f0: 2600, f1: 120, q: 0.7 }); tone(c, o, t, { type: 'sine', f0: 120, f1: 35, dur: 0.45, vol: 0.4 * p.vol }); },
  boom: (c, o, t, p) => { hiss(c, o, t, { dur: 1.1, vol: 0.5 * p.vol, type: 'lowpass', f0: 1800, f1: 60, q: 0.6 }); tone(c, o, t, { type: 'sine', f0: 90, f1: 28, dur: 1, vol: 0.55 * p.vol }); },
  shoot: (c, o, t, p) => tone(c, o, t, { type: 'square', f0: 1400 * p.pitch, f1: 380 * p.pitch, dur: 0.07, vol: 0.06 * p.vol }),
  zap: (c, o, t, p) => tone(c, o, t, { type: 'sawtooth', f0: 900 * p.pitch, f1: 160, dur: 0.12, vol: 0.08 * p.vol }),
  pop: (c, o, t, p) => tone(c, o, t, { type: 'sine', f0: 700 * p.pitch, f1: 180 * p.pitch, dur: 0.11, vol: 0.28 * p.vol }),
  chomp: (c, o, t, p) => { tone(c, o, t, { type: 'square', f0: 180 * p.pitch, f1: 90 * p.pitch, dur: 0.09, vol: 0.18 * p.vol }); hiss(c, o, t, { dur: 0.06, vol: 0.16 * p.vol, f0: 1200 }); },
  place: (c, o, t, p) => { tone(c, o, t, { type: 'triangle', f0: 523 * p.pitch, dur: 0.16, vol: 0.26 * p.vol }); hiss(c, o, t, { dur: 0.05, vol: 0.18 * p.vol, type: 'highpass', f0: 3000 }); },
  perfect: (c, o, t, p) => { tone(c, o, t, { type: 'sine', f0: 659 * p.pitch, dur: 0.35, vol: 0.22 * p.vol }); tone(c, o, t, { type: 'triangle', f0: 1318 * p.pitch, dur: 0.25, vol: 0.1 * p.vol }); },
  slice: (c, o, t, p) => hiss(c, o, t, { dur: 0.14, vol: 0.2 * p.vol, f0: 6000, f1: 1500, q: 2 }),
  match: (c, o, t, p) => [0, 7].forEach((n, i) => tone(c, o, t + i * 0.05, { type: 'sine', f0: 587 * p.pitch * 2 ** (n / 12), dur: 0.28, vol: 0.18 * p.vol })),
  swap: (c, o, t, p) => tone(c, o, t, { type: 'sine', f0: 380 * p.pitch, f1: 520 * p.pitch, dur: 0.09, vol: 0.12 * p.vol }),
  nope: (c, o, t, p) => { tone(c, o, t, { type: 'square', f0: 200, dur: 0.08, vol: 0.1 * p.vol }); tone(c, o, t + 0.09, { type: 'square', f0: 160, dur: 0.1, vol: 0.1 * p.vol }); },
  step: (c, o, t, p) => tone(c, o, t, { type: 'triangle', f0: 240 * p.pitch, f1: 200 * p.pitch, dur: 0.04, vol: 0.05 * p.vol }),
  key: (c, o, t, p) => [0, 5, 9, 12].forEach((n, i) => tone(c, o, t + i * 0.06, { type: 'triangle', f0: 660 * p.pitch * 2 ** (n / 12), dur: 0.2, vol: 0.15 * p.vol })),
  door: (c, o, t, p) => { tone(c, o, t, { type: 'sawtooth', f0: 110, f1: 220, dur: 0.5, vol: 0.12 * p.vol, curve: 'lin' }); hiss(c, o, t, { dur: 0.45, vol: 0.12 * p.vol, f0: 400, f1: 1600 }); },
  power: (c, o, t, p) => tone(c, o, t, { type: 'square', f0: 220 * p.pitch, f1: 1760 * p.pitch, dur: 0.4, vol: 0.12 * p.vol }),
  grow: (c, o, t, p) => tone(c, o, t, { type: 'sine', f0: 300 * p.pitch, f1: 600 * p.pitch, dur: 0.18, vol: 0.2 * p.vol }),
  whoosh: (c, o, t, p) => hiss(c, o, t, { dur: 0.3, vol: 0.18 * p.vol, f0: 500, f1: 4000, q: 0.8 }),
  level: (c, o, t, p) => [0, 4, 7, 12, 16].forEach((n, i) => tone(c, o, t + i * 0.07, { type: 'square', f0: 523 * p.pitch * 2 ** (n / 12), dur: 0.16, vol: 0.09 * p.vol })),
  win: (c, o, t, p) => [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) => tone(c, o, t + i * 0.09, { type: i % 2 ? 'triangle' : 'square', f0: 523 * 2 ** (n / 12), dur: 0.22, vol: 0.1 * p.vol })),
  lose: (c, o, t, p) => [0, -3, -6, -10].forEach((n, i) => tone(c, o, t + i * 0.13, { type: 'triangle', f0: 392 * 2 ** (n / 12), dur: 0.3, vol: 0.16 * p.vol })),
  tick: (c, o, t, p) => tone(c, o, t, { type: 'square', f0: 1800 * p.pitch, dur: 0.025, vol: 0.05 * p.vol }),
};

export class Sound {
  /**
   * loadScore: () => Promise<{ renderScore }>; the page passes () => import('../score.js').
   * cache (optional): { get(key) -> Promise<Blob|null>, put(key, blob) } to keep rendered loops between visits.
   */
  constructor({ loadScore = null, cache = null } = {}) {
    this.loadScore = loadScore;
    this.cache = cache;
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* private mode */ }
    this.recent = new Map();
    this.loopData = null;
    this.musicSrc = null;
    this.musicWanted = false;
  }
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.ratio.value = 4;
        this.master.connect(comp).connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 0.85;
        this.sfxBus.connect(this.master);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.42;
        this.musicBus.connect(this.master);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  }
  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* ok */ }
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }
  play(name, { pitch = 1, vol = 1 } = {}) {
    const fn = SFX[name];
    if (!fn || !this.ctx || this.muted || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const last = this.recent.get(name) || 0;
    if (now - last < 0.035) return; // the same sound twice in one frame just gets louder
    this.recent.set(name, now);
    try { fn(this.ctx, this.sfxBus, now + 0.005, { pitch, vol }); } catch { /* never let audio break a game */ }
  }

  /**
   * Render the music loop (no AudioContext needed). Safe to call before any user gesture. The score engine runs
   * on the main thread, so pages call this while the title screen is up, and pass a cache so it runs once.
   */
  async prepareMusic({ style = 'house', bpm = 120, seed = 1 } = {}) {
    if (!this.loadScore) return null;
    const key = `${style}|${bpm}|${seed >>> 0}|v1`;
    if (this.loopKey === key && this.loopData) return this.loopData;
    this.loopKey = key;
    this.loopData = null;
    try {
      const hit = await this.cache?.get(key).catch(() => null);
      if (hit && this.loopKey === key) {
        const buf = new Int16Array(await hit.arrayBuffer());
        const n = (buf.length - 2) / 2;
        const sr = buf[0] * 1000 + buf[1];
        const chans = [new Float32Array(n), new Float32Array(n)];
        for (let i = 0; i < n; i++) { chans[0][i] = buf[2 + i] / 32767; chans[1][i] = buf[2 + n + i] / 32767; }
        return this.setLoop({ sampleRate: sr, channels: chans, seconds: n / sr });
      }
      const mod = await this.loadScore();
      if (!mod?.renderScore || this.loopKey !== key) return null;
      // one 16-beat phrase cut from just after the opening hit, so the loop starts mid-groove
      const L = 16;
      const pre = Math.max(4, Math.ceil((1.6 * bpm) / 60));
      const res = await mod.renderScore({ style, bpm, beats: pre + L, dropBeat: 0, endBeat: pre + L, cuts: [], seed });
      if (this.loopKey !== key) return null;
      const sr = res.sampleRate;
      const spb = 60 / bpm;
      const a = Math.round(pre * spb * sr);
      const n = Math.round(L * spb * sr);
      const fade = Math.round(0.03 * sr);
      const chans = res.channels.map((full) => {
        const seg = full.slice(a, a + n);
        // crossfade the tail into what came just before the loop start, so the wrap is continuous
        for (let i = 0; i < fade; i++) {
          const k = i / fade;
          seg[n - fade + i] = seg[n - fade + i] * (1 - k) + full[a - fade + i] * k;
        }
        return seg;
      });
      if (this.cache) {
        // kept at half rate (24 kHz, 16-bit): plenty for a game loop, a quarter of the bytes
        const h = n >> 1;
        const pcm = new Int16Array(2 + 2 * h);
        const sr2 = sr / 2;
        pcm[0] = Math.floor(sr2 / 1000);
        pcm[1] = sr2 % 1000;
        const q = (v) => Math.max(-1, Math.min(1, v)) * 32767;
        for (let i = 0; i < h; i++) { pcm[2 + i] = q((chans[0][2 * i] + chans[0][2 * i + 1]) / 2); pcm[2 + h + i] = q((chans[1][2 * i] + chans[1][2 * i + 1]) / 2); }
        Promise.resolve(this.cache.put(key, new Blob([pcm.buffer]))).catch(() => {});
      }
      return this.setLoop({ sampleRate: sr, channels: chans, seconds: n / sr });
    } catch {
      return null;
    }
  }
  setLoop(d) {
    this.loopData = d;
    if (this.musicWanted && !this.musicSrc) this.startMusic();
    return d;
  }
  startMusic() {
    this.musicWanted = true;
    if (!this.ctx || !this.loopData) return;
    this.stopMusic(true);
    this.musicWanted = true;
    const d = this.loopData;
    const buf = this.ctx.createBuffer(2, d.channels[0].length, d.sampleRate);
    buf.copyToChannel(d.channels[0], 0);
    buf.copyToChannel(d.channels[1], 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(1, this.ctx.currentTime + 0.4);
    src.connect(g).connect(this.musicBus);
    src.start();
    this.musicSrc = src;
    this.musicGain = g;
  }
  duckMusic() {
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(0.25, this.ctx.currentTime, 0.2);
  }
  pauseMusic() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resumeMusic() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  stopMusic(keepWanted = false) {
    if (!keepWanted) this.musicWanted = false;
    try { this.musicSrc?.stop(); } catch { /* already stopped */ }
    this.musicSrc = null;
  }
  close() {
    this.stopMusic();
    try { this.ctx?.close(); } catch { /* ok */ }
    this.ctx = null;
  }
}

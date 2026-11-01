// Film poem: a short poem becomes a 20-40 s film. One FLUX frame per line (graded to one look), typed-on words,
// slow alternating camera moves, a word-grid interlude, the whole poem as a block, and an end card.
// Drawn on canvas; exported in the browser as H.264 MP4 (WebCodecs + the vendored mp4-muxer the Film page uses)
// with an optional ambience bed from the Audio tools, or as WebM through MediaRecorder where WebCodecs is missing.

import { canvas, font, measure, text, wrap, cover, grain, greyscale, hashStr, clamp } from './kit.js';

const FORMATS = { vertical: [1080, 1920], landscape: [1920, 1080] };
const PAPER = { ground: '#d6d9d1', ink: '#1d211e', soft: '#6b726b', rule: 'rgba(29,33,30,0.16)' };
const CINE = { ground: '#0c0d0d', ink: '#f1eee6', soft: '#9b978d' };
export const MAX_LINES = 7;
export const MAX_FRAMES = 6;

export function poemLines(src) {
  return String(src || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, MAX_LINES);
}
/** The cut: title, one shot per line, word grid, full poem, end card. 20-40 s for 1-7 lines. */
export function timeline(n) {
  const lines = clamp(n, 1, MAX_LINES);
  const shot = clamp(21 / lines, 3.2, 7);
  const seg = [{ kind: 'title', d: 3 }];
  for (let i = 0; i < lines; i++) seg.push({ kind: 'shot', i, d: shot });
  seg.push({ kind: 'grid', d: 3.5 }, { kind: 'block', d: 4 }, { kind: 'end', d: 2.5 });
  let t = 0;
  for (const s of seg) { s.start = t; t += s.d; }
  return { segments: seg, duration: t };
}
export function framePrompt(line, world, style) {
  const look = style === 'paper' ? 'black and white archival photograph, soft grain, quiet museum print' : '35mm film still, muted natural colour, soft light, shallow depth of field';
  return `${line.replace(/[.,;:!?]+$/, '')}. ${world}. Cinematic still, ${look}, minimal composition, no text, no letters, no captions`;
}
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const tc = (t) => `00:${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 24)).padStart(2, '0')}`;

function desaturate(img, amount) {
  const g = greyscale(img, { lift: 0.04 }), c = canvas(img.width, img.height), x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalAlpha = amount;
  x.drawImage(g, 0, 0);
  return c;
}

const AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f'];
async function pickVideo(w, h, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of AVC) {
    const cfg = { codec, width: w, height: h, bitrate: 5_000_000, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* next */ }
  }
  return null;
}
async function pickAudio(sampleRate) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate, numberOfChannels: 2, bitrate: 160000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* next */ }
  }
  return null;
}
const yieldTask = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

export default {
  id: 'film-poem',
  fields: [
    { key: 'title', label: 'Title', max: 40 },
    { key: 'poem', label: 'Poem', type: 'textarea', rows: 7, max: 700, hint: 'One line per shot, up to 7 lines. Each line gets its own painted frame (6 at most).' },
    { key: 'world', label: 'Visual world', type: 'textarea', rows: 2, max: 200, hint: 'Where the images live. Keeps every frame in one film.' },
    { key: 'credit', label: 'Credit', max: 50 },
    { key: 'style', label: 'Style', type: 'select', options: [['paper', 'Paper: mono type, framed archive'], ['cinema', 'Cinema: full-bleed, serif lines']] },
    { key: 'format', label: 'Format', type: 'select', options: [['vertical', 'Vertical 9:16'], ['landscape', 'Landscape 16:9']] },
    { key: 'sound', label: 'Sound', type: 'select', options: [['none', 'Silent'], ['ocean', 'Ocean waves'], ['wind', 'Wind'], ['rain', 'Rain'], ['forest-birds', 'Forest birds'], ['room-tone', 'Room tone'], ['city-night', 'City night'], ['campfire', 'Campfire']], hint: 'A soft ambient bed under the words.' },
    { key: 'quality', label: 'Export size', type: 'select', options: [['720', '720p (fast)'], ['1080', '1080p']] },
  ],
  presets: [{
    state: { title: 'Morning Tide', poem: 'The sea keeps its own slow hours.\nWe fold the map along the old creases.\nThe road remembers every wind.\nA lamp keeps turning for the late ones home.', world: 'A quiet coastal village at dawn, in the mist', credit: 'Words and frames made with Chucksi', style: 'paper', format: 'vertical', sound: 'ocean', quality: '720' },
    samples: { f0: '/media/make/samples/film-1.webp', f1: '/media/make/samples/film-2.webp', f2: '/media/make/samples/film-3.webp', f3: '/media/make/samples/film-4.webp' },
  }],
  frames: (s) => Math.min(MAX_FRAMES, poemLines(s.poem).length || 1),
  surprise(r) {
    const ideas = [
      ['Night Train', 'The carriage hums a song it never finishes.\nWindows hold a town for half a breath.\nSomeone sleeps with a ticket in their hand.\nMorning arrives one station early.', 'A night train crossing an empty plain'],
      ['Glasshouse', 'Under glass the weather is a rumour.\nFerns unroll like slow green questions.\nRain taps the roof in a language of nails.\nWe leave with soil on our cuffs.', 'An old glasshouse full of ferns and palms'],
      ['Small Hours', 'The city keeps one window lit for you.\nA taxi folds the rain into the road.\nThe bakery opens before the birds.\nYou walk home inside the first light.', 'A sleeping city at four in the morning'],
      ['Field Notes', 'The wheat leans where the wind has been.\nA kestrel holds still against the sky.\nThe fence posts count the afternoon.\nWe stop, and the field keeps going.', 'Open farmland in late summer under a big sky'],
    ];
    const [title, poem, world] = ideas[Math.floor(r() * ideas.length)];
    return { title, poem, world, style: r() < 0.6 ? 'paper' : 'cinema', sound: ['wind', 'rain', 'room-tone', 'forest-birds'][Math.floor(r() * 4)] };
  },
  async build(s, io) {
    const [W, H] = FORMATS[s.format] || FORMATS.vertical;
    const vertical = H > W;
    const paper = s.style !== 'cinema';
    const C = paper ? PAPER : CINE;
    const lines = poemLines(s.poem);
    if (!lines.length) lines.push(s.title || 'Untitled');
    const { segments, duration } = timeline(lines.length);
    const base = 2000 + (hashStr(s.title + s.world) % 50000);
    const raw = [];
    for (let i = 0; i < Math.min(lines.length, MAX_FRAMES); i++) {
      raw.push(await io.image(`f${i}`, framePrompt(lines[i], s.world, s.style), vertical ? 720 : 1280, vertical ? 1280 : 720, base + i));
    }
    io.status('Grading frames…');
    const frames = raw.map((im) => (paper ? greyscale(im, { lift: 0.1, gamma: 1.08 }) : desaturate(im, 0.3)));
    const frameOf = (i) => frames[i % frames.length];
    const words = lines.join(' ').split(/\s+/).filter(Boolean).slice(0, 40);
    const firstWords = new Set();
    { let k = 0; for (const l of lines) { firstWords.add(k); k += l.split(/\s+/).filter(Boolean).length; } }
    const M = W * 0.075, U = Math.min(W, H) / 100; // margin and a type unit

    const heads = (ctx, t, label) => {
      if (!paper) return;
      font(ctx, { family: 'IBM Plex Mono', weight: 400, size: U * 1.5, tracking: 0.06 });
      ctx.fillStyle = C.soft;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left'; text(ctx, s.title.toUpperCase(), M, M * 0.8);
      ctx.textAlign = 'right'; text(ctx, label, W - M, M * 0.8);
      ctx.textAlign = 'left'; text(ctx, 'A FILM POEM', M, H - M * 0.6);
      ctx.textAlign = 'right'; text(ctx, tc(t), W - M, H - M * 0.6);
      // registration crosses on a loose grid
      ctx.strokeStyle = C.rule; ctx.lineWidth = U * 0.12;
      const cols = vertical ? 4 : 8, rows = vertical ? 7 : 4;
      for (let x = 1; x < cols; x++) for (let y = 1; y < rows; y++) {
        const px = (W * x) / cols, py = (H * y) / rows, a = U * 0.6;
        ctx.beginPath(); ctx.moveTo(px - a, py); ctx.lineTo(px + a, py); ctx.moveTo(px, py - a); ctx.lineTo(px, py + a); ctx.stroke();
      }
    };
    const typed = (str, p) => str.slice(0, Math.round(str.length * clamp(p, 0, 1)));

    const draw = (ctx, t) => {
      t = clamp(t, 0, duration - 1e-3);
      const seg = segments.find((x) => t >= x.start && t < x.start + x.d) || segments[segments.length - 1];
      const lt = t - seg.start, p = lt / seg.d;
      ctx.save();
      ctx.fillStyle = C.ground;
      ctx.fillRect(0, 0, W, H);
      ctx.textBaseline = 'alphabetic';
      if (seg.kind === 'title') {
        heads(ctx, t, 'I');
        const k = ease(lt / 0.8);
        ctx.globalAlpha = k;
        if (paper) {
          font(ctx, { family: 'IBM Plex Mono', weight: 500, size: U * 5.2, tracking: 0.02 });
          ctx.fillStyle = C.ink; ctx.textAlign = 'left';
          text(ctx, typed(s.title.toUpperCase(), (lt - 0.3) / 1.2), M + W * 0.05, H * 0.47);
          font(ctx, { family: 'IBM Plex Mono', weight: 400, size: U * 1.7, tracking: 0.04 });
          ctx.fillStyle = C.soft;
          text(ctx, s.credit, M + W * 0.05, H * 0.47 + U * 5);
        } else {
          font(ctx, { family: 'Instrument Serif', weight: 400, style: 'italic', size: U * 10 });
          ctx.fillStyle = C.ink; ctx.textAlign = 'center';
          text(ctx, s.title, W / 2, H / 2 + U * 2);
          font(ctx, { family: 'IBM Plex Mono', weight: 400, size: U * 1.6, tracking: 0.18 });
          ctx.fillStyle = C.soft;
          text(ctx, s.credit.toUpperCase(), W / 2, H / 2 + U * 8);
        }
      } else if (seg.kind === 'shot') {
        const i = seg.i, line = lines[i], img = frameOf(i), dir = i % 2 ? -1 : 1;
        const zoom = 1.04 + 0.1 * (dir > 0 ? p : 1 - p), pan = dir * (p - 0.5) * 0.7;
        const fade = Math.min(ease(lt / 0.6), ease((seg.d - lt) / 0.35));
        if (paper) {
          heads(ctx, t, `II · ${String(i + 1).padStart(2, '0')}/${String(lines.length).padStart(2, '0')}`);
          const box = vertical ? { x: M, y: H * 0.17, w: W - 2 * M, h: H * 0.48 } : { x: W * 0.42, y: H * 0.16, w: W * 0.5, h: H * 0.68 };
          ctx.save();
          ctx.globalAlpha = fade;
          ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
          cover(ctx, img, box.x, box.y, box.w, box.h, { zoom, px: pan, py: 0 });
          ctx.restore();
          font(ctx, { family: 'IBM Plex Mono', weight: 400, size: U * 1.35, tracking: 0.06 });
          ctx.fillStyle = C.soft; ctx.textAlign = 'left';
          text(ctx, `FIG. ${String(i + 1).padStart(2, '0')} — ${line.split(/\s+/).slice(0, 4).join(' ').replace(/[.,;:]$/, '').toUpperCase()}`, box.x, box.y + box.h + U * 3);
          font(ctx, { family: 'IBM Plex Mono', weight: 500, size: U * (vertical ? 4.1 : 3.3), tracking: 0 });
          ctx.fillStyle = C.ink;
          const tx = vertical ? M : M, tw = vertical ? W - 2 * M : W * 0.42 - M * 1.6;
          const shown = typed(line, (lt - 0.35) / Math.max(1.2, seg.d * 0.45));
          const wl = wrap(ctx, line, tw);
          let left = shown.length, y = vertical ? box.y + box.h + U * 11 : H * 0.42;
          for (const l of wl) {
            const part = l.slice(0, Math.max(0, left));
            left -= l.length + 1;
            text(ctx, part, tx, y);
            if (left < 0 && left > -l.length - 2 && Math.floor(t * 2.4) % 2 === 0) { ctx.fillRect(tx + measure(ctx, part) + U * 0.4, y - U * 3.2, U * 1.9, U * 3.8); }
            y += U * (vertical ? 5.6 : 4.6);
          }
        } else {
          ctx.globalAlpha = fade;
          cover(ctx, img, 0, 0, W, H, { zoom, px: pan, py: 0 });
          const gr = ctx.createLinearGradient(0, H * 0.45, 0, H);
          gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.72)');
          ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
          if (!vertical) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H * 0.07); ctx.fillRect(0, H * 0.93, W, H * 0.07); }
          font(ctx, { family: 'Instrument Serif', weight: 400, style: 'italic', size: U * (vertical ? 6.6 : 5.2) });
          ctx.textAlign = 'center';
          const wl = wrap(ctx, line, W * 0.82);
          const ws = line.split(/\s+/).length, shownWords = Math.ceil(ws * clamp((lt - 0.4) / Math.max(1.2, seg.d * 0.5), 0, 1));
          let k = 0;
          wl.forEach((l, j) => {
            const lw = l.split(/\s+/);
            const vis = lw.filter((_, n) => k + n < shownWords).join(' ');
            k += lw.length;
            ctx.fillStyle = C.ink;
            ctx.globalAlpha = fade;
            const lineW = measure(ctx, l);
            ctx.textAlign = 'left';
            text(ctx, vis, W / 2 - lineW / 2, H * (vertical ? 0.78 : 0.8) + j * U * (vertical ? 7.4 : 6) - (wl.length - 1) * U * 3);
          });
        }
      } else if (seg.kind === 'grid') {
        heads(ctx, t, 'III');
        const cols = vertical ? 4 : 8, gw = W - 2 * M, cw = gw / cols, ch = U * (vertical ? 7 : 6.4);
        const rows = Math.ceil(words.length / cols), gy = (H - rows * ch) / 2;
        ctx.strokeStyle = paper ? C.rule : 'rgba(255,255,255,0.16)'; ctx.lineWidth = U * 0.12;
        font(ctx, { family: 'IBM Plex Mono', weight: 400, size: U * (vertical ? 2.2 : 1.9) });
        words.forEach((w, j) => {
          const a = ease((lt - (j / words.length) * seg.d * 0.55) / 0.25);
          if (a <= 0) return;
          const x = M + (j % cols) * cw, y = gy + Math.floor(j / cols) * ch;
          ctx.globalAlpha = a;
          if (firstWords.has(j)) { ctx.fillStyle = C.ink; ctx.fillRect(x, y, cw, ch); }
          ctx.strokeRect(x, y, cw, ch);
          ctx.fillStyle = firstWords.has(j) ? C.ground : C.ink;
          ctx.textAlign = 'center';
          text(ctx, w.toLowerCase(), x + cw / 2, y + ch / 2 + U * 0.7);
          font(ctx, { family: 'IBM Plex Mono', weight: 400, size: U * 0.95 });
          ctx.textAlign = 'left';
          ctx.fillStyle = firstWords.has(j) ? C.ground : C.soft;
          text(ctx, String(j + 1).padStart(2, '0'), x + U * 0.7, y + U * 1.7);
          font(ctx, { family: 'IBM Plex Mono', weight: 400, size: U * (vertical ? 2.2 : 1.9) });
        });
      } else if (seg.kind === 'block') {
        heads(ctx, t, 'IV');
        ctx.globalAlpha = ease(lt / 0.9);
        const spec = paper ? { family: 'IBM Plex Mono', weight: 400, size: U * (vertical ? 3.1 : 2.5) } : { family: 'Instrument Serif', weight: 400, style: 'italic', size: U * (vertical ? 4.6 : 3.8) };
        font(ctx, spec);
        ctx.fillStyle = C.ink;
        ctx.textAlign = 'left';
        const bw = vertical ? W - 2 * M : W * 0.56;
        const all = lines.flatMap((l) => wrap(ctx, l, bw));
        const lh = spec.size * 1.45, x = vertical ? M : (W - bw) / 2;
        let y = H / 2 - ((all.length - 1) * lh) / 2;
        for (const l of all) { text(ctx, l, x, y); y += lh; }
      } else {
        heads(ctx, t, 'V');
        const a = Math.min(ease(lt / 0.6), ease((seg.d - lt) / 0.8));
        ctx.globalAlpha = a;
        ctx.textAlign = 'center';
        font(ctx, paper ? { family: 'IBM Plex Mono', weight: 500, size: U * 3, tracking: 0.04 } : { family: 'Instrument Serif', weight: 400, style: 'italic', size: U * 6 });
        ctx.fillStyle = C.ink;
        text(ctx, paper ? s.title.toUpperCase() : s.title, W / 2, H / 2);
        font(ctx, { family: 'IBM Plex Mono', weight: 400, size: U * 1.4, tracking: 0.16 });
        ctx.fillStyle = C.soft;
        text(ctx, 'MADE WITH CHUCKSI', W / 2, H / 2 + U * 5);
      }
      ctx.restore();
      grain(ctx, W, H, paper ? 0.1 : 0.08, 5, Math.floor(t * 24));
    };

    // ---------- sound: an ambience bed from the Audio tools, rendered once ----------
    let audioP = null;
    const audio = s.sound && s.sound !== 'none' ? () => (audioP ||= (async () => {
      const { renderBed } = await import('../audio-engine.js');
      const bed = await renderBed(s.sound, Math.ceil(duration) + 1, { intensity: 0.4, seed: base });
      const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await bed.blob.arrayBuffer());
      const n = Math.round(duration * buf.sampleRate);
      const channels = [0, 1].map((c) => {
        const src = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)), out = new Float32Array(n);
        for (let i = 0; i < n; i++) { const tt = i / buf.sampleRate; out[i] = (src[i] || 0) * 0.75 * Math.min(1, tt / 1.5, (duration - tt) / 2); }
        return out;
      });
      return { url: bed.url, channels, sampleRate: buf.sampleRate };
    })().catch((e) => { audioP = null; throw e; })) : null;

    async function exportVideo(onProgress) {
      const q = Number(s.quality) || 720, k = q / Math.min(W, H);
      const w = Math.round((W * k) / 2) * 2, hh = Math.round((H * k) / 2) * 2, fps = 30;
      const c = canvas(w, hh), ctx = c.getContext('2d');
      const drawAt = (t) => { ctx.setTransform(w / W, 0, 0, hh / H, 0, 0); draw(ctx, t); };
      const a = audio ? await audio().catch(() => null) : null;
      const vcfg = await pickVideo(w, hh, fps);
      if (vcfg) {
        const acfg = a ? await pickAudio(a.sampleRate) : null;
        const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
        const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: hh, frameRate: fps }, ...(acfg ? { audio: { codec: acfg.mux, numberOfChannels: 2, sampleRate: a.sampleRate } } : {}), fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
        let err = null;
        const venc = new VideoEncoder({ output: (ch, m) => muxer.addVideoChunk(ch, m), error: (e) => (err = e) });
        venc.configure(vcfg);
        if (acfg) {
          const aenc = new AudioEncoder({ output: (ch, m) => muxer.addAudioChunk(ch, m), error: (e) => (err = e) });
          aenc.configure(acfg.cfg);
          const [L, R] = a.channels, step = 4800;
          for (let i = 0; i < L.length; i += step) {
            const n = Math.min(step, L.length - i), data = new Float32Array(n * 2);
            data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
            const ad = new AudioData({ format: 'f32-planar', sampleRate: a.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / a.sampleRate) * 1e6), data });
            aenc.encode(ad); ad.close();
          }
          await aenc.flush();
        }
        const total = Math.ceil(duration * fps);
        for (let i = 0; i < total; i++) {
          if (err) throw err;
          drawAt(i / fps);
          const fr = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
          venc.encode(fr, { keyFrame: i % (fps * 2) === 0 });
          fr.close();
          while (venc.encodeQueueSize > 6) await yieldTask();
          if (i % 6 === 0) { onProgress(i / total); await yieldTask(); }
        }
        await venc.flush();
        if (err) throw err;
        muxer.finalize();
        return new Blob([muxer.target.buffer], { type: 'video/mp4' });
      }
      // Real-time fallback: MediaRecorder on the canvas, with the bed mixed in through Web Audio.
      if (typeof MediaRecorder === 'undefined' || !c.captureStream) throw new Error('Video recording isn’t available here. Try desktop Chrome, Edge or Safari.');
      const stream = c.captureStream(fps);
      let actx = null;
      if (a) {
        actx = new AudioContext({ sampleRate: a.sampleRate });
        const buf = actx.createBuffer(2, a.channels[0].length, a.sampleRate);
        a.channels.forEach((ch, i) => buf.copyToChannel(ch, i));
        const src = actx.createBufferSource(), dest = actx.createMediaStreamDestination();
        src.buffer = buf; src.connect(dest);
        dest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
        src.start();
      }
      const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((r) => (rec.onstop = r));
      rec.start(250);
      const start = performance.now();
      await new Promise((resolve) => {
        const step = () => {
          const t = (performance.now() - start) / 1000;
          drawAt(Math.min(t, duration));
          onProgress(Math.min(1, t / duration));
          if (t < duration) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });
      rec.stop();
      await done;
      stream.getTracks().forEach((tr) => tr.stop());
      actx?.close();
      return new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' });
    }

    const still = (t, id, label) => { const c = canvas(W, H); draw(c.getContext('2d'), t); return { id, label, canvas: c, save: true }; };
    const firstShot = segments[1];
    return {
      name: s.title,
      prompt: framePrompt(lines[0], s.world, s.style),
      layout: 'series',
      film: {
        w: W, h: H, duration, draw, audio,
        preview: vertical ? [405, 720] : [720, 405],
        cover: firstShot.start + firstShot.d * 0.8,
        export: exportVideo,
        exportNote: `${duration.toFixed(1)} s · ${s.quality || 720}p${audio ? ' · with sound' : ''}`,
      },
      boards: [still(1.6, 'title-card', 'Title card'), still(firstShot.start + firstShot.d * 0.8, 'still-1', 'Still · line 1'), still(segments.find((x) => x.kind === 'grid').start + 3, 'word-grid', 'Word grid')],
    };
  },
};

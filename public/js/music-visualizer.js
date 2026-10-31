// Deterministic artwork + audio visualizer. No generated performance or lip-sync.
export function analyzeTrack(channels, sampleRate, fps = 50) {
  const samples = channels[0]?.length || 0;
  const hop = Math.max(1, Math.round(sampleRate / fps));
  const energy = new Float32Array(Math.ceil(samples / hop));
  for (let n = 0; n < energy.length; n++) {
    let sum = 0,
      count = 0;
    for (let i = n * hop; i < Math.min(samples, (n + 1) * hop); i += 8) {
      for (const channel of channels) {
        sum += channel[i] * channel[i];
        count++;
      }
    }
    energy[n] = count ? Math.sqrt(sum / count) : 0;
  }
  const peak = energy.reduce((a, b) => Math.max(a, b), 0) || 1;
  return { energy, peak, fps, duration: samples / sampleRate };
}

export function frameTiming(time, bpm, duration) {
  const t = Math.max(0, Math.min(Number(time) || 0, duration));
  const beat = (t * Math.max(40, Math.min(240, Number(bpm) || 120))) / 60;
  return {
    time: t,
    beat,
    pulse: Math.exp(-(beat % 1) * 7),
    scene: Math.floor(beat / 8) % 4,
    progress: duration ? t / duration : 0,
  };
}

export function drawMusicFrame(canvas, image, config, analysis, time) {
  const c = canvas.getContext("2d");
  const w = canvas.width,
    h = canvas.height;
  const { beat, pulse, scene, progress } = frameTiming(
    time,
    config.bpm,
    config.duration,
  );
  const level = analysis
    ? (analysis.energy[
        Math.min(analysis.energy.length - 1, Math.floor(time * analysis.fps))
      ] || 0) / analysis.peak
    : 0;
  const accent = config.color || "#dfbb6a";
  c.save();
  c.fillStyle = "#0c1110";
  c.fillRect(0, 0, w, h);
  const glow = c.createRadialGradient(
    w * 0.72,
    h * 0.52,
    0,
    w * 0.72,
    h * 0.52,
    w * 0.6,
  );
  glow.addColorStop(0, "#354439");
  glow.addColorStop(1, "#0c1110");
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);
  // Moving score lines remain low contrast; no strobes or full-frame flashes.
  c.strokeStyle = "#ffffff09";
  c.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const x = ((i / 15 + time * 0.008) % 1) * w;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x - h * 0.3, h);
    c.stroke();
  }
  const portrait = w < h,
    square = w === h,
    stacked = portrait || square;
  const size = square ? w * 0.42 : portrait ? w * 0.79 : h * 0.73;
  const ix = stacked ? (w - size) / 2 : w * 0.55;
  const iy = h * (square ? 0.09 : portrait ? 0.1 : 0.13);
  c.save();
  c.translate(ix + size / 2, iy + size / 2);
  c.rotate(Math.sin(time * 0.35) * 0.018 + (scene === 1 ? -0.035 : 0.015));
  const scale = 1 + level * 0.015 + Math.sin(time * 0.4) * 0.012;
  c.scale(scale, scale);
  c.fillStyle = accent;
  c.fillRect(-size / 2 - 9, -size / 2 - 9, size + 18, size + 18);
  const crop = Math.min(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  );
  c.drawImage(
    image,
    ((image.naturalWidth || image.width) - crop) / 2,
    ((image.naturalHeight || image.height) - crop) / 2,
    crop,
    crop,
    -size / 2,
    -size / 2,
    size,
    size,
  );
  c.strokeStyle = "#ffffff60";
  c.lineWidth = 1;
  c.strokeRect(-size / 2 + 10, -size / 2 + 10, size - 20, size - 20);
  c.restore();
  const tx = w * 0.065,
    ty = square ? h * 0.72 : portrait ? h * 0.7 : h * 0.42;
  c.textBaseline = "alphabetic";
  c.fillStyle = "#b8bfb8";
  c.font = `500 ${Math.round(w * 0.012 + (portrait ? 6 : 0))}px "Instrument Sans", sans-serif`;
  c.fillText("MASSLESS SESSIONS / 001", tx, h * 0.085);
  c.fillStyle = accent;
  c.font = `600 ${Math.round(w * (stacked ? 0.035 : 0.018))}px "Instrument Sans", sans-serif`;
  c.fillText(
    config.artist.toUpperCase().slice(0, 40),
    tx,
    ty - h * (square ? 0.15 : portrait ? 0.13 : 0.2),
    w * (stacked ? 0.86 : 0.46),
  );
  const title = config.title.toUpperCase().slice(0, 32);
  const parts =
    title === "SHOWTIME"
      ? ["SHOW", "TIME."]
      : title
          .split(/\s+/)
          .reduce((a, word) => {
            if (!a.length || a[a.length - 1].length + word.length > 12)
              a.push(word);
            else a[a.length - 1] += ` ${word}`;
            return a;
          }, [])
          .slice(0, 2);
  c.font = `900 ${Math.round(w * (square ? 0.13 : portrait ? 0.16 : 0.109))}px "Big Shoulders Display", sans-serif`;
  parts.forEach((line, i) => {
    c.fillStyle = i === 0 ? "#f2efe1" : accent;
    c.fillText(
      line,
      tx + pulse * w * 0.002,
      ty + i * h * (square ? 0.13 : portrait ? 0.09 : 0.19),
      w * (stacked ? 0.86 : 0.46),
    );
  });
  c.fillStyle = "#b8bfb8";
  c.font = `400 ${Math.round(w * (portrait ? 0.024 : 0.012))}px "Instrument Sans", sans-serif`;
  const caption = [
    "ARTWORK IN MOTION",
    "FIND YOUR RHYTHM",
    "MAKE THE MOMENT",
    "YOUR NEXT RELEASE",
  ][scene];
  if (!square) c.fillText(caption, tx, h * (portrait ? 0.86 : 0.85));
  // The bar heights come from the actual track envelope, while cuts use the editable beat grid.
  const bx = stacked ? tx : w * 0.55,
    by = h * (square ? 0.96 : 0.93),
    bw = stacked ? w * 0.87 : w * 0.39;
  const bars = 64;
  for (let i = 0; i < bars; i++) {
    const n = analysis ? Math.floor((i / bars) * analysis.energy.length) : 0;
    const value = analysis ? analysis.energy[n] / analysis.peak : 0.08;
    c.fillStyle = i / bars < progress ? accent : "#677466";
    c.fillRect(
      bx + (i / bars) * bw,
      by - value * h * 0.055,
      Math.max(2, bw / bars - 3),
      Math.max(2, value * h * 0.055),
    );
  }
  c.fillStyle = accent;
  c.fillRect(0, h - 3, w * progress, 3);
  c.restore();
}

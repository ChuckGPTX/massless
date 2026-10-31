export function parseCaptions(text) {
  const time = (s) => {
    const m = s.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/);
    if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) return NaN;
    return (
      Number(m[1] || 0) * 3600 +
      Number(m[2]) * 60 +
      Number(m[3]) +
      Number(m[4]) / 1000
    );
  };
  const rows = [];
  for (const block of String(text)
    .replace(/\r/g, "")
    .split(/\n\s*\n/)) {
    const lines = block.trim().split("\n"),
      i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const ends = lines[i].split("-->"),
      start = time(ends[0]),
      end = time(ends[1].trim().split(/\s/)[0]),
      words = lines
        .slice(i + 1)
        .join(" ")
        .replace(/<[^>]*>/g, "")
        .trim();
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      !words
    )
      throw new Error(
        "Check caption times. Use 00:00:01,000 --> 00:00:03,000 followed by text.",
      );
    rows.push({ start, end, text: words.slice(0, 500) });
  }
  if (rows.length > 2000) throw new Error("Use at most 2,000 caption cues.");
  return rows.sort((a, b) => a.start - b.start);
}
export function activeCaption(cues, t) {
  return cues.find((c) => t >= c.start && t < c.end)?.text || "";
}
export function validateTrim(start, end, duration) {
  start = Number(start);
  end = Number(end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > duration + 0.05
  )
    throw new Error("Choose a start and end within the clip.");
  if (end - start > 120) throw new Error("Export up to two minutes at a time.");
  return { start, end };
}

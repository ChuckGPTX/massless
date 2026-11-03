// "Popular" for the Workflows gallery: how often this browser opened or made each card. Stays on the device.
const KEY = 'chucksi.workflow-uses.v1';
export function counts() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
export function bump(id, by = 1) {
  try {
    const c = counts();
    c[id] = Math.min(1e6, (c[id] || 0) + by);
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch { /* storage may be off; popularity is optional */ }
}
/** Items ordered by local use (most first); ties keep their original order. */
export function byPopularity(items, c = counts(), key = (x) => x.id) {
  return items.map((x, i) => [x, i]).sort((a, b) => (c[key(b[0])] || 0) - (c[key(a[0])] || 0) || a[1] - b[1]).map(([x]) => x);
}

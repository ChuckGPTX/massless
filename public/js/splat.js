// Turn a still plus its depth map into a 3D Gaussian splat, written as a standard 3DGS .ply.
// Every sample becomes a small, flat Gaussian placed along its own camera ray, so the result
// opens in any splat viewer (Spark, SuperSplat, Polycam) as well as in Massless.
// A second, sparser layer from the refilled background sits behind foreground objects, so
// orbiting reveals plausible surroundings instead of holes.

const SH_C0 = 0.28209479177387814;
const PROPS = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];

function pixels(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

function bilinear(data, w, h, x, y) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const a = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx;
  const b = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx;
  return a * (1 - fy) + b * fy;
}

/**
 * opts: { image, depth: { data, w, h, bg?, bgColor? }, cols = 400 (samples along the long side), sNear = 0.5, sFar = 1.6, D, background = true }
 * Coordinates: x right, y up, camera at (0, 0, D) looking down -z, image height = 1 unit at s = 1.
 * Returns { bytes (Uint8Array .ply), count, target: [x, y, z], D, aspect }.
 */
export function depthToSplat({ image, depth, cols = 400, sNear = 0.5, sFar = 1.6, D = 1.4, background = true, subject = 0.7 }) {
  const aspect = image.width / image.height;
  const long = cols;
  cols = Math.max(2, Math.round(aspect >= 1 ? long : long * aspect));
  const rows = Math.max(2, Math.round(aspect >= 1 ? long / aspect : long));
  const sFor = (d) => 1 / (1 / sFar + (1 / sNear - 1 / sFar) * d);
  const layers = [{ cols, rows, depth: depth.data, color: pixels(image, cols, rows), push: 1, alpha: 0.98 }];
  if (background && depth.bg) {
    const bc = Math.round(cols / 2);
    const br = Math.round(rows / 2);
    let color;
    if (depth.bgColor) {
      const c = document.createElement('canvas');
      c.width = depth.bgColor.width;
      c.height = depth.bgColor.height;
      c.getContext('2d').putImageData(depth.bgColor, 0, 0);
      color = pixels(c, bc, br);
    } else color = pixels(image, bc, br);
    layers.push({ cols: bc, rows: br, depth: depth.bg, color, push: 1.012, alpha: 0.9 });
  }
  const count = layers.reduce((n, l) => n + l.cols * l.rows, 0);
  const out = new Float32Array(count * PROPS.length);
  let k = 0;
  for (const L of layers) {
    const step = 1 / L.rows; // world size of one sample at s = 1
    for (let j = 0; j < L.rows; j++) {
      const v = (j + 0.5) / L.rows; // 0 at top
      for (let i = 0; i < L.cols; i++) {
        const u = (i + 0.5) / L.cols;
        const d = bilinear(L.depth, depth.w, depth.h, u * depth.w - 0.5, v * depth.h - 0.5) / 255;
        const s = sFor(d) * L.push;
        const p = (j * L.cols + i) * 4;
        const sigma = step * s * 0.62;
        out[k++] = (u - 0.5) * aspect * s;
        out[k++] = (0.5 - v) * s;
        out[k++] = D - D * s;
        out[k++] = 0; out[k++] = 0; out[k++] = 1;
        out[k++] = (L.color[p] / 255 - 0.5) / SH_C0;
        out[k++] = (L.color[p + 1] / 255 - 0.5) / SH_C0;
        out[k++] = (L.color[p + 2] / 255 - 0.5) / SH_C0;
        out[k++] = Math.log(L.alpha / (1 - L.alpha));
        out[k++] = Math.log(sigma);
        out[k++] = Math.log(sigma);
        out[k++] = Math.log(sigma * 0.35);
        out[k++] = 1; out[k++] = 0; out[k++] = 0; out[k++] = 0;
      }
    }
  }
  const header = `ply\nformat binary_little_endian 1.0\ncomment Massless depth splat\nelement vertex ${count}\n${PROPS.map((p) => `property float ${p}`).join('\n')}\nend_header\n`;
  const head = new TextEncoder().encode(header);
  const bytes = new Uint8Array(head.length + out.byteLength);
  bytes.set(head, 0);
  bytes.set(new Uint8Array(out.buffer), head.length);
  return { bytes, count, target: [0, 0, D - D * sFor(subject)], D, aspect };
}

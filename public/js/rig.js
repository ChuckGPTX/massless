// The camera rig vocabulary shared by every page: loading, prompt compiling and the physical finish.

let rigPromise = null;
export function loadRig() {
  if (!rigPromise) rigPromise = fetch(new URL('../data/rig.json', import.meta.url)).then((r) => r.json());
  return rigPromise;
}

export const DEFAULT_SEL = {
  camera: '35mm', lens: 'anamorphic', focal: 50, aperture: '1.4', shot: 'ms', angle: 'eye',
  light: 'golden', stock: 'negative', aspect: '169', genre: 'none', palette: 'natural',
};

export function pick(rig, group, key) {
  const list = rig[group] || [];
  if (group === 'focal') return list.find((x) => x.mm === Number(key)) || list[0];
  if (group === 'aperture') return list.find((x) => x.f === String(key)) || list[0];
  return list.find((x) => x.id === key) || list[0];
}

export function compilePrompt(rig, subject, sel) {
  const s = { ...DEFAULT_SEL, ...sel };
  const parts = [
    (subject || 'a lone traveler with a lantern on a desert ridge at dusk').trim().replace(/[.\s]+$/, ''),
    pick(rig, 'genre', s.genre).prompt,
    pick(rig, 'shot', s.shot).prompt,
    pick(rig, 'angle', s.angle).prompt,
    pick(rig, 'camera', s.camera).prompt,
    pick(rig, 'lens', s.lens).prompt,
    pick(rig, 'focal', s.focal).prompt,
    pick(rig, 'aperture', s.aperture).prompt,
    pick(rig, 'light', s.light).prompt,
    pick(rig, 'stock', s.stock).prompt,
    pick(rig, 'palette', s.palette).prompt,
    'cinematic film still, high detail, no text',
  ];
  return parts.filter(Boolean).join(', ');
}

/**
 * Lens, camera and stock choices as renderer finishing parameters.
 * gradeMix scales the colour grade: generated frames already carry their grade, so they get less.
 */
export function finishFor(rig, sel, gradeMix = 1) {
  const s = { ...DEFAULT_SEL, ...sel };
  const cam = pick(rig, 'camera', s.camera);
  const lens = pick(rig, 'lens', s.lens);
  const stock = pick(rig, 'stock', s.stock);
  const light = pick(rig, 'light', s.light);
  const focal = pick(rig, 'focal', s.focal);
  const g = gradeMix;
  return {
    grain: cam.finish.grain,
    weave: cam.finish.weave,
    vhs: cam.finish.vhs,
    fade: Math.max(cam.finish.fade, stock.grade.fade) * g,
    halation: lens.finish.halation,
    streak: lens.finish.streak,
    ovalBokeh: lens.finish.ovalBokeh,
    ca: lens.finish.ca,
    soft: lens.finish.soft,
    tilt: lens.id === 'tiltshift' ? 1 : 0,
    distort: focal.distort,
    sat: 1 + (stock.grade.sat - 1) * g,
    contrast: 1 + (stock.grade.contrast - 1) * g,
    tealOrange: stock.grade.tealOrange * g,
    mono: stock.grade.mono * g,
    warm: (stock.grade.warm + light.warm * 0.35) * g,
    vignette: 0.22 + cam.finish.grain * 0.2,
    exposure: 1,
    dof: g < 1 ? 0.35 : 1,
  };
}

export function apertureBlur(rig, sel, dof = 1) {
  const s = { ...DEFAULT_SEL, ...sel };
  const lens = pick(rig, 'lens', s.lens);
  let b = pick(rig, 'aperture', s.aperture).blur;
  if (lens.id === 'macro') b = Math.min(1, b * 1.25 + 0.1);
  if (lens.id === 'tiltshift') b = Math.max(b, 0.7);
  return b * dof;
}

export const DEPTH_RANGE = { 8: [0.38, 1.9], 14: [0.42, 1.75], 24: [0.5, 1.6], 35: [0.55, 1.5], 50: [0.6, 1.42], 85: [0.7, 1.28], 135: [0.8, 1.18] };

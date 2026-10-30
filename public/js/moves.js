// Camera-move presets. Each one maps normalized time t (0..1) to a virtual camera.
// Distances are in units of the rest distance D, so a move behaves the same at any resolution.

import { REST_FOV } from './renderer.js';

const ease = {
  inOut: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const window01 = (t, a, b) => clamp01((t - a) / (b - a));

// smooth pseudo-random wobble for handheld
function wobble(t, seed) {
  return (
    Math.sin(t * 6.1 + seed) * 0.5 +
    Math.sin(t * 13.7 + seed * 2.3) * 0.3 +
    Math.sin(t * 27.3 + seed * 5.1) * 0.2
  );
}

function rotY(v, pivot, a) {
  const x = v[0] - pivot[0];
  const z = v[2] - pivot[2];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [pivot[0] + x * c + z * s, v[1], pivot[2] - x * s + z * c];
}

/**
 * ctx: { D, sSub (subject distance factor), focusSub, focusNear, focusFar, k (intensity), blur (aperture) }
 * Returns { eye, target, fov, roll, focus, blur }.
 */
function base(ctx) {
  const D = ctx.D;
  const pivotZ = D - D * ctx.sSub;
  return {
    D,
    rest: [0, 0, D],
    pivot: [0, 0, pivotZ],
    ahead: (eye) => [eye[0], eye[1], eye[2] - D],
  };
}

export const MOVES = [
  {
    id: 'breathe',
    name: 'Breathe',
    hint: 'Locked off, the frame just lives',
    icon: 'M24 22 v-2',
    duration: 4,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOut(t);
      const eye = [Math.sin(t * Math.PI * 2) * 0.004 * b.D * ctx.k, Math.sin(t * Math.PI * 4) * 0.002 * b.D * ctx.k, b.D - 0.02 * b.D * ctx.k * e];
      return { eye, target: b.ahead(eye), fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'dolly-in',
    name: 'Dolly in',
    hint: 'Push toward the subject',
    icon: 'M24 27 V13 M20 17 l4 -4 4 4',
    duration: 4,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOut(t);
      const eye = [0, 0, b.D - 0.3 * b.D * ctx.k * e * ctx.sSub];
      return { eye, target: b.ahead(eye), fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'dolly-out',
    name: 'Dolly out',
    hint: 'Pull back to reveal',
    icon: 'M24 13 V27 M20 23 l4 4 4 -4',
    duration: 4,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOut(t);
      const eye = [0, 0, b.D - 0.3 * b.D * ctx.k * (1 - e) * ctx.sSub];
      return { eye, target: b.ahead(eye), fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'crash-zoom',
    name: 'Crash zoom',
    hint: 'Violent snap in on the subject',
    icon: 'M12 28 L24 14 L36 28 M18 21 h12',
    duration: 3,
    fn(t, ctx) {
      const b = base(ctx);
      const hit = window01(t, 0.18, 0.42);
      const z = ease.in(hit);
      const after = Math.max(0, t - 0.42);
      const shake = Math.exp(-after * 9) * Math.sin(after * 70) * (t > 0.42 ? 1 : 0);
      const fov = REST_FOV * (1 - 0.58 * Math.min(ctx.k, 1.3) * z);
      const eye = [shake * 0.003 * b.D, shake * 0.004 * b.D, b.D - 0.06 * b.D * z];
      const target = [b.pivot[0], b.pivot[1], b.pivot[2]];
      return { eye, target, fov, roll: shake * 0.004, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'dolly-zoom',
    name: 'Dolly zoom',
    hint: 'Subject holds, the world stretches',
    icon: 'M24 13 V27 M14 16 L24 22 L34 16 M14 28 L24 22 L34 28',
    duration: 5,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOutCubic(t);
      const zs0 = b.D * ctx.sSub;
      const zs = zs0 * (1 + 0.95 * ctx.k * e);
      const eye = [0, 0, b.pivot[2] + zs];
      const fov = (2 * Math.atan((Math.tan((REST_FOV * Math.PI) / 360) * zs0) / zs) * 180) / Math.PI;
      return { eye, target: b.pivot, fov, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'arc-left',
    name: 'Arc left',
    hint: 'Swing around the subject',
    icon: 'M34 26 A12 12 0 0 1 14 26 M14 26 l1 -5 M14 26 l5 -1',
    duration: 5,
    fn(t, ctx) {
      const b = base(ctx);
      const a = -0.2 * ctx.k * (ease.inOut(t) - 0.5) * 2;
      return { eye: rotY(b.rest, b.pivot, a), target: b.pivot, fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'arc-right',
    name: 'Arc right',
    hint: 'Swing the other way',
    icon: 'M14 26 A12 12 0 0 0 34 26 M34 26 l-1 -5 M34 26 l-5 -1',
    duration: 5,
    fn(t, ctx) {
      const b = base(ctx);
      const a = 0.2 * ctx.k * (ease.inOut(t) - 0.5) * 2;
      return { eye: rotY(b.rest, b.pivot, a), target: b.pivot, fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'crane-up',
    name: 'Crane up',
    hint: 'Rise and look down',
    icon: 'M16 28 L32 12 M32 12 h-6 M32 12 v6',
    duration: 5,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOut(t);
      const y = (-0.1 + 0.22 * e) * b.D * ctx.k * ctx.sSub;
      const eye = [0, y, b.D - 0.05 * b.D * e * ctx.k];
      return { eye, target: b.pivot, fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'truck-right',
    name: 'Truck right',
    hint: 'Slide sideways, layers separate',
    icon: 'M12 20 H36 M31 15 l5 5 -5 5',
    duration: 5,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOut(t);
      const x = (-0.12 + 0.24 * e) * b.D * ctx.k * ctx.sSub;
      const eye = [x, 0, b.D];
      return { eye, target: b.ahead(eye), fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'tilt-up',
    name: 'Tilt up',
    hint: 'Camera stays, the view climbs',
    icon: 'M24 28 V12 M19 17 l5 -5 5 5 M16 28 h16',
    duration: 4,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOut(t);
      const ty = (-0.07 + 0.14 * e) * b.D * ctx.k;
      return { eye: b.rest, target: [0, ty, b.rest[2] - b.D], fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'handheld',
    name: 'Handheld',
    hint: 'Operator on their feet',
    icon: 'M12 22 q4 -6 8 0 t8 0 t8 0',
    duration: 5,
    fn(t, ctx) {
      const b = base(ctx);
      const T = t * 5;
      const k = ctx.k;
      const eye = [wobble(T, 1) * 0.008 * b.D * k, wobble(T, 2) * 0.006 * b.D * k, b.D - 0.03 * b.D * ease.inOut(t) * k];
      const target = [b.pivot[0] + wobble(T, 3) * 0.006 * b.D * k, b.pivot[1] + wobble(T, 4) * 0.005 * b.D * k, b.pivot[2]];
      return { eye, target, fov: REST_FOV, roll: wobble(T, 5) * 0.008 * k, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'rack-focus',
    name: 'Rack focus',
    hint: 'Pull focus from near to far',
    icon: 'M14 14 v12 M34 14 v12 M18 20 H30 M26 16 l4 4 -4 4',
    duration: 5,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOutCubic(window01(t, 0.25, 0.75));
      const eye = [0, 0, b.D - 0.025 * b.D * ease.inOut(t) * ctx.k];
      const focus = ctx.focusNear + (ctx.focusFar - ctx.focusNear) * e;
      return { eye, target: b.ahead(eye), fov: REST_FOV, roll: 0, focus, blur: Math.max(ctx.blur, 0.75) };
    },
  },
  {
    id: 'bullet-time',
    name: 'Bullet time',
    hint: 'The moment freezes, the camera does not',
    icon: 'M24 20 m-12 0 a12 6 0 1 0 24 0 a12 6 0 1 0 -24 0 M24 20 m-2 0 a2 2 0 1 0 4 0 a2 2 0 1 0 -4 0',
    duration: 5,
    fn(t, ctx) {
      const b = base(ctx);
      const e = ease.inOutQuint(t);
      const a = 0.3 * ctx.k * (e - 0.5) * 2;
      const pushed = [0, 0.02 * b.D * ctx.k, b.D - 0.06 * b.D * ctx.k * Math.sin(Math.PI * t)];
      return { eye: rotY(pushed, b.pivot, a), target: b.pivot, fov: REST_FOV, roll: a * 0.05, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
  {
    id: 'float',
    name: 'Float',
    hint: 'A slow drifting loop',
    icon: 'M24 20 m-9 0 a9 6 0 1 0 18 0 a9 6 0 1 0 -18 0',
    duration: 6,
    fn(t, ctx) {
      const b = base(ctx);
      const a = t * Math.PI * 2;
      const eye = [Math.sin(a) * 0.05 * b.D * ctx.k * ctx.sSub, Math.sin(a * 2) * 0.018 * b.D * ctx.k, b.D - (0.5 - 0.5 * Math.cos(a)) * 0.04 * b.D * ctx.k];
      return { eye, target: b.pivot, fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    },
  },
];

export const moveById = (id) => MOVES.find((m) => m.id === id) || MOVES[1];

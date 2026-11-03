// Mockup plates: a billboard, a box truck, a street poster and a shop window. Each is rendered twice, once with
// the artwork surface white and once black. The runtime lays your art in with out = dark + art * (white - dark)
// in linear light, so the scene's own lighting, shadows, paper texture and glass reflections land on your art.
import { THREE, TEX, mat, mesh, roundedBox, skyDome, worldUV, rng, cvs, toTex, normalTex, tfbm, leafTexture } from './lib.js';

function cam(pos, target, fov = 32) {
  const c = new THREE.PerspectiveCamera(fov, 1.5, 0.05, 600);
  c.position.set(...pos); c.lookAt(...target);
  return c;
}
function artQuad(scene, w, h, pass, o = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 32, 32), new THREE.MeshPhysicalMaterial({ color: pass === 'dark' ? '#000000' : '#ffffff', roughness: o.rough ?? 0.6, clearcoat: o.coat ?? 0, normalMap: o.normal || null, normalScale: o.normal ? new THREE.Vector2(o.ns ?? 0.6, o.ns ?? 0.6) : undefined }));
  m.receiveShadow = true; m.castShadow = false;
  if (o.pos) m.position.set(...o.pos);
  if (o.rot) m.rotation.set(...o.rot);
  scene.add(m);
  return m;
}
function corners(m) {
  m.updateMatrixWorld();
  const p = m.geometry.parameters, w = p.width / 2, h = p.height / 2;
  return [[-w, h], [w, h], [w, -h], [-w, -h]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld));
}
function windows(cols, rows, lit = 0.25, s = 3, base = '#c9b9a5') {
  const c = cvs(1024), g = c.getContext('2d'), r = rng(s);
  g.fillStyle = base; g.fillRect(0, 0, 1024, 1024);
  const cw = 1024 / cols, rh = 1024 / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const on = r() < lit;
    g.fillStyle = on ? `hsl(38 70% ${60 + r() * 20}%)` : `hsl(210 20% ${14 + r() * 12}%)`;
    g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.16, cw * 0.64, rh * 0.62);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.76, cw * 0.64, rh * 0.05);
  }
  return toTex(c);
}
const meta = (r, { project }) => ({ quad: r.s.quadCorners.map((v) => project(r.camera, [v.x, v.y, v.z]).map((n) => +n.toFixed(5))) });

export const MOCKUPS = {
  billboard: {
    title: 'Billboard', art: [2, 1],
    async build({ pass }) {
      const scene = new THREE.Scene();
      scene.add(skyDome('#4d7fc2', '#f7c999', '#d79b72', 400, { dir: [-0.8, 0.12, -1], color: '#ffd29a' }));
      const bw = 12, bh = 6;
      const q = artQuad(scene, bw, bh, pass, { pos: [0, 21, 0], rough: 0.45, coat: 0.2 });
      const steel = mat('#2c2e33', { roughness: 0.55, metalness: 0.6 });
      const frame = (w, h, d, x, y, z) => scene.add(mesh(new THREE.BoxGeometry(w, h, d), steel, { pos: [x, y, z] }));
      frame(bw + 0.5, 0.3, 0.4, 0, 21 + bh / 2 + 0.1, -0.1); frame(bw + 0.5, 0.3, 0.4, 0, 21 - bh / 2 - 0.1, -0.1);
      frame(0.3, bh + 0.5, 0.4, -bw / 2 - 0.1, 21, -0.1); frame(0.3, bh + 0.5, 0.4, bw / 2 + 0.1, 21, -0.1);
      scene.add(mesh(new THREE.BoxGeometry(bw + 0.4, bh + 0.2, 0.2), steel, { pos: [0, 21, -0.25] }));
      for (const x of [-3.5, 3.5]) frame(0.5, 18, 0.5, x, 9, -1.2);
      frame(bw + 1, 0.12, 1.4, 0, 21 - bh / 2 - 0.5, 0.5);
      for (let i = -2; i <= 2; i++) {
        frame(0.08, 0.08, 1.6, i * 2.6, 21 + bh / 2 + 0.6, 0.6);
        const lamp = new THREE.SpotLight('#ffe7c0', 60, 14, 0.75, 0.6, 1.4); lamp.position.set(i * 2.6, 21 + bh / 2 + 0.6, 1.4); lamp.target.position.set(i * 2.6, 19, 0); scene.add(lamp, lamp.target);
        scene.add(mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), steel, { pos: [i * 2.6, 21 + bh / 2 + 0.55, 1.4] }));
      }
      const wt = windows(10, 14, 0.18, 4, '#b9a690'); wt.repeat.set(2, 1);
      scene.add(mesh(new THREE.BoxGeometry(40, 0.1, 20), mat('#6f6a64'), { pos: [0, 0, -4] }));
      const bld = mesh(new THREE.BoxGeometry(30, 15, 14), mat('#ffffff', { map: wt, roughness: 0.8 }), { pos: [2, -0.5 + 0, -6] }); scene.add(bld);
      const wt2 = windows(8, 20, 0.3, 7, '#8d97a3');
      scene.add(mesh(new THREE.BoxGeometry(14, 40, 14), mat('#ffffff', { map: wt2, roughness: 0.5, metalness: 0.2 }), { pos: [-26, 6, -30] }));
      scene.add(mesh(new THREE.BoxGeometry(16, 30, 12), mat('#ffffff', { map: windows(8, 16, 0.2, 9, '#a58f7d'), roughness: 0.8 }), { pos: [28, 2, -26] }));
      scene.add(mesh(new THREE.BoxGeometry(2, 1.2, 2), mat('#5a5651'), { pos: [9, 7.6, -3] }));
      const camera = cam([-8, 3.0, 30], [0.8, 18.5, 0], 36);
      return { scene, camera, target: [0, 18, 0], quadCorners: corners(q), key: { pos: [-40, 18, 30], color: '#ffcc93', intensity: 3.2, radius: 1 }, sky: { color: '#a9c1e6', intensity: 1.1 }, envIntensity: 0.25, exposure: 1.0, shadowBox: 30 };
    },
    meta,
  },
  truck: {
    title: 'Box truck', art: [2.4, 1],
    async build({ pass }) {
      const scene = new THREE.Scene();
      scene.add(skyDome('#86a7cf', '#e3e7ea', '#9a9a98', 300));
      scene.add(mesh(new THREE.PlaneGeometry(200, 200), mat('#3c3d40', { roughness: 0.85, map: TEX.concrete(1024, '#4a4b4f', 3) }), { rot: [-Math.PI / 2, 0, 0], cast: false }));
      const walk = mesh(new THREE.BoxGeometry(80, 0.18, 4), mat('#ffffff', { map: TEX.concrete(1024, '#b2aea6', 5), roughness: 0.9 }), { pos: [0, 0.09, -4.2] }); worldUV(walk.geometry, 0.4); scene.add(walk);
      const brick = cvs(1024), g = brick.getContext('2d'), r = rng(8);
      g.fillStyle = '#d9d2c6'; g.fillRect(0, 0, 1024, 1024);
      for (let y = 0; y < 32; y++) for (let x = -1; x < 17; x++) { g.fillStyle = `hsl(${12 + r() * 10} ${40 + r() * 15}% ${32 + r() * 12}%)`; g.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28); }
      const bt = toTex(brick); bt.repeat.set(10, 4);
      scene.add(mesh(new THREE.PlaneGeometry(80, 16), mat('#ffffff', { map: bt, roughness: 0.9, normalMap: TEX.bumpy(512, 3, 60, 1.5) }), { pos: [0, 8, -6.2], cast: false }));
      for (const x of [-12, -6, 6, 12, 18]) { scene.add(mesh(new THREE.BoxGeometry(2.2, 2.6, 0.2), mat('#1d2228', { roughness: 0.1, metalness: 0.3 }), { pos: [x, 4.4, -6.1] })); scene.add(mesh(new THREE.BoxGeometry(2.5, 0.15, 0.3), mat('#e8e2d6'), { pos: [x, 3.0, -6.0] })); }
      scene.add(mesh(new THREE.BoxGeometry(3.4, 3.0, 0.3), mat('#20262e', { roughness: 0.08, metalness: 0.4 }), { pos: [0, 1.7, -6.05] }));
      // the truck, parked along the kerb, side facing the camera
      const L = 6.4, Hb = 2.7, D = 2.45, x0 = -1.0;
      const box = mesh(roundedBox(L, Hb, D, 0.05), mat('#f2f2f0', { roughness: 0.5 }), { pos: [x0, 1.0 + Hb / 2, 0] }); scene.add(box);
      const q = artQuad(scene, L - 0.3, Hb - 0.3, pass, { pos: [x0, 1.0 + Hb / 2, D / 2 + 0.006], rough: 0.4, coat: 0.3 });
      const cabC = mat('#2a5c8a', { roughness: 0.3, clearcoat: 1 });
      scene.add(mesh(roundedBox(2.0, 2.1, D, 0.25), cabC, { pos: [x0 + L / 2 + 1.05, 1.0 + 1.05, 0] }));
      scene.add(mesh(new THREE.BoxGeometry(1.0, 0.9, D - 0.1), mat('#0e1418', { roughness: 0.05, metalness: 0.5 }), { pos: [x0 + L / 2 + 1.55, 2.55, 0] }));
      scene.add(mesh(new THREE.BoxGeometry(0.9, 0.8, 0.02), mat('#0e1418', { roughness: 0.05, metalness: 0.5 }), { pos: [x0 + L / 2 + 0.95, 2.5, D / 2 + 0.01] }));
      scene.add(mesh(new THREE.BoxGeometry(L + 2.2, 0.35, D - 0.3), mat('#1a1a1c'), { pos: [x0 + 1.0, 0.85, 0] }));
      for (const wx of [x0 - L / 2 + 1.0, x0 - L / 2 + 2.2, x0 + L / 2 + 1.2]) for (const z of [D / 2 - 0.25, -D / 2 + 0.25]) {
        scene.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 48), mat('#151515', { roughness: 0.8 }), { pos: [wx, 0.5, z], rot: [Math.PI / 2, 0, 0] }));
        scene.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.34, 32), mat('#9a9ca0', { metalness: 1, roughness: 0.3 }), { pos: [wx, 0.5, z], rot: [Math.PI / 2, 0, 0] }));
      }
      scene.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 16), mat('#2d3033', { metalness: 0.7, roughness: 0.4 }), { pos: [-6.5, 2.1, -3.3] }));
      scene.add(mesh(new THREE.SphereGeometry(0.9, 32, 16), mat('#3f6b3d', { roughness: 0.9 }), { pos: [9.5, 3.4, -4.6] }));
      scene.add(mesh(new THREE.CylinderGeometry(0.12, 0.15, 3, 16), mat('#4d3b2c'), { pos: [9.5, 1.6, -4.6] }));
      const camera = cam([-7.5, 1.55, 9.5], [0.2, 2.1, 0], 34);
      return { scene, camera, target: [0, 2, 0], quadCorners: corners(q), key: { pos: [-12, 18, 16], color: '#fff3e2', intensity: 3.6, radius: 1.5 }, sky: { color: '#dfe7f2', intensity: 1.4 }, envIntensity: 0.35, exposure: 1.02, shadowBox: 16, aperture: 0.02, focus: [x0, 2.3, 1.2] };
    },
    meta,
  },
  'street-poster': {
    title: 'Street poster', art: [2, 3],
    async build({ pass }) {
      const scene = new THREE.Scene();
      scene.add(skyDome('#9fb6cf', '#e8e4dc', '#8a8580', 300));
      const conc = TEX.concrete(1024, '#a9a49c', 11); conc.repeat.set(3, 1.5);
      scene.add(mesh(new THREE.PlaneGeometry(14, 7), mat('#ffffff', { map: conc, roughness: 0.92, normalMap: TEX.bumpy(512, 5, 40, 1.4) }), { pos: [0, 3.5, 0], cast: false }));
      scene.add(mesh(new THREE.PlaneGeometry(40, 20), mat('#ffffff', { map: TEX.concrete(1024, '#8f8b84', 2), roughness: 0.95 }), { rot: [-Math.PI / 2, 0, 0], pos: [0, 0, 5], cast: false }));
      const wrinkle = normalTex(1024, (u, v) => tfbm(u * 3, v * 3, 3, 6, 4) * 0.8 + Math.abs(Math.sin((u * 2.2 + tfbm(u * 2, v * 2, 2, 3, 9)) * Math.PI * 2)) * 0.12, 2.2, 1);
      const r = rng(21);
      const old = ['#d94a3a', '#f0c63c', '#2b4d8c', '#f2ece1', '#1f1f1f', '#e7835f'];
      for (let i = 0; i < 9; i++) {
        const w = 1.0 + r() * 0.5, h = w * 1.45, x = -4.2 + i * 1.05 + (r() - 0.5) * 0.3;
        if (Math.abs(x - 0.2) < 1.1) continue;
        scene.add(mesh(new THREE.PlaneGeometry(w, h), mat(old[i % old.length], { roughness: 0.85, normalMap: wrinkle, normalScale: new THREE.Vector2(0.6, 0.6) }), { pos: [x, 1.8 + r() * 0.5, 0.01 + i * 0.001], rot: [0, 0, (r() - 0.5) * 0.04], cast: false }));
      }
      const q = artQuad(scene, 1.6, 2.4, pass, { pos: [0.2, 2.15, 0.03], rough: 0.8, normal: wrinkle, ns: 0.5 });
      scene.add(mesh(new THREE.BoxGeometry(14, 0.25, 0.4), mat('#7a766f'), { pos: [0, 0.12, 0.2] }));
      scene.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 16), mat('#33373b', { metalness: 0.8, roughness: 0.35 }), { pos: [3.6, 2, 1.6] }));
      const camera = cam([-3.4, 1.7, 5.0], [0.05, 2.15, 0], 36);
      return { scene, camera, target: [0, 2, 0], quadCorners: corners(q), key: { pos: [8, 9, 7], color: '#fff0dc', intensity: 3.4, radius: 0.6 }, sky: { color: '#e3e9f0', intensity: 1.3 }, skyBias: [0, 0, 0.7], envIntensity: 0.3, exposure: 1.02, shadowBox: 9, aperture: 0.03, focus: [0.2, 2.15, 0] };
    },
    meta,
  },
  storefront: {
    title: 'Shop window', art: [3, 4],
    async build({ pass }) {
      const scene = new THREE.Scene();
      scene.add(skyDome('#7f9fc8', '#dfe3e6', '#77736e', 300, { dir: [1, 0.5, 1], color: '#fff2dd' }));
      const facade = new THREE.Shape(); facade.moveTo(-8, 0); facade.lineTo(8, 0); facade.lineTo(8, 6); facade.lineTo(-8, 6); facade.lineTo(-8, 0);
      const hole = new THREE.Path(); hole.moveTo(-2.6, 0.7); hole.lineTo(2.6, 0.7); hole.lineTo(2.6, 3.9); hole.lineTo(-2.6, 3.9); hole.lineTo(-2.6, 0.7); facade.holes.push(hole);
      const door = new THREE.Path(); door.moveTo(3.4, 0.05); door.lineTo(4.8, 0.05); door.lineTo(4.8, 3.6); door.lineTo(3.4, 3.6); door.lineTo(3.4, 0.05); facade.holes.push(door);
      scene.add(mesh(new THREE.ExtrudeGeometry(facade, { depth: 0.35, bevelEnabled: false }), mat('#26302b', { roughness: 0.4, clearcoat: 0.6 }), { pos: [0, 0, -0.35] }));
      scene.add(mesh(new THREE.BoxGeometry(16, 0.7, 0.5), mat('#e9e2d4'), { pos: [0, 4.45, 0.05] }));
      // awning
      const aw = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6, 40, 1), mat('#ffffff', { map: (() => { const c = cvs(512, 64), g = c.getContext('2d'); for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#f3efe6' : '#2f5d4a'; g.fillRect(i * 32, 0, 32, 64); } return toTex(c); })(), side: THREE.DoubleSide, roughness: 0.8 }));
      aw.position.set(0, 4.05, 0.75); aw.rotation.x = -1.0; aw.castShadow = true; scene.add(aw);
      // interior behind the glass
      scene.add(mesh(new THREE.BoxGeometry(7, 4, 0.1), mat('#efe6d8', { roughness: 0.9 }), { pos: [0, 2.2, -3.4] }));
      scene.add(mesh(new THREE.BoxGeometry(7, 0.1, 3.2), mat('#b88b5f', { map: TEX.wood(1024, '#b88b5f', '#7a5232', 3), roughness: 0.6 }), { pos: [0, 0.65, -1.8] }));
      const lampC = new THREE.PointLight('#ffd9a6', 18, 8, 1.6); lampC.position.set(0, 3.5, -1.6); scene.add(lampC);
      for (const [x, h, c] of [[-2.0, 0.5, '#c9785a'], [-1.6, 0.3, '#e6c06b'], [1.8, 0.45, '#7aa08a'], [2.2, 0.25, '#f2ece2']]) scene.add(mesh(new THREE.BoxGeometry(0.4, h, 0.4), mat(c), { pos: [x, 0.7 + h / 2, -1.2] }));
      const q = artQuad(scene, 1.5, 2.0, pass, { pos: [0, 1.75, -1.4], rough: 0.55 });
      scene.add(mesh(new THREE.BoxGeometry(1.62, 2.12, 0.04), mat('#1b1b1b', { roughness: 0.4 }), { pos: [0, 1.75, -1.43] }));
      const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, transmission: 0.92, thickness: 0.02, ior: 1.5, transparent: true });
      scene.add(mesh(new THREE.PlaneGeometry(5.2, 3.2), glass, { pos: [0, 2.3, -0.1], cast: false }));
      scene.add(mesh(new THREE.PlaneGeometry(40, 20), mat('#ffffff', { map: TEX.concrete(1024, '#a8a39b', 6), roughness: 0.9 }), { rot: [-Math.PI / 2, 0, 0], pos: [0, 0, 5], cast: false }));
      const pl = leafTexture('olive', 512, '#ffffff', 3);
      scene.add(mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.7, 32), mat('#d8cfc0'), { pos: [-4.0, 0.35, 0.8] }));
      const fol = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshStandardMaterial({ map: pl, color: '#5f7a4f', alphaTest: 0.5, side: THREE.DoubleSide })); fol.position.set(-4.0, 1.5, 0.8); fol.castShadow = true; scene.add(fol);
      const camera = cam([2.4, 1.65, 7.2], [-0.1, 1.95, -1.0], 34);
      return { scene, camera, target: [0, 2, 0], quadCorners: corners(q), key: { pos: [10, 12, 10], color: '#fff3e0', intensity: 3.2, radius: 0.8 }, sky: { color: '#e2e8ef', intensity: 1.2 }, skyBias: [0, 0, 0.6], envIntensity: 0.45, exposure: 1.0, shadowBox: 12 };
    },
    meta,
  },
};

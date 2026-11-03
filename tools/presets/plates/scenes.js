// The 20 product-scene plates. Each scene leaves an empty spot at `anchor` (world units, product base centre)
// for a product about `productH` tall; render-plates.cjs projects these into the manifest so the runtime can
// stand any cutout there with the right size, contact shadow, cast shadow and reflection.
// `prompt` is the brief for a photographic replacement plate (same framing, same empty spot).
import { THREE, TEX, mat, mesh, podium, roundedBox, sweep, skyDome, heightPlane, rock, leafTexture, worldUV, fbm, rng, toTex, cvs, normalTex, tfbm } from './lib.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function camera(target, dist = 5, elev = 6, fov = 28, yaw = 0) {
  const c = new THREE.PerspectiveCamera(fov, 1.5, 0.05, 400);
  const e = (elev * Math.PI) / 180, a = (yaw * Math.PI) / 180;
  c.position.set(target[0] + Math.sin(a) * Math.cos(e) * dist, target[1] + Math.sin(e) * dist, target[2] + Math.cos(a) * Math.cos(e) * dist);
  c.lookAt(...target);
  return c;
}
const base = (o) => ({ productH: 1, reflect: 0, ...o });
function bgSweep(scene, color, o = {}) {
  const g = sweep(40, 20, 16, o.radius ?? 3);
  const m = mesh(g, mat(color, { roughness: o.roughness ?? 0.92, side: THREE.DoubleSide, ...(o.map ? { map: o.map } : {}) }), { cast: false });
  m.position.z = o.z ?? -4;
  scene.add(m);
  return m;
}
function wall(scene, color, z = -3, o = {}) {
  const m = mesh(new THREE.PlaneGeometry(60, 30), mat(color, { roughness: 0.95, ...o }), { pos: [0, 15 - (o.drop || 0), z], cast: false });
  scene.add(m); return m;
}
function floor(scene, material, y = 0) {
  const m = mesh(new THREE.PlaneGeometry(80, 80), material, { rot: [-Math.PI / 2, 0, 0], pos: [0, y, 0], cast: false });
  scene.add(m); return m;
}
function gobo(scene, tex, pos, rot, scale) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false, depthWrite: false }));
  m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(scale, scale, 1);
  m.castShadow = true; m.receiveShadow = false;
  scene.add(m); return m;
}
function foliage(scene, tex, pos, rot, scale, color = '#3e6b3f') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 8, 8), new THREE.MeshStandardMaterial({ map: tex, color, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 }));
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -Math.pow(p.getX(i), 2) * 0.35 - Math.pow(p.getY(i) + 0.5, 2) * 0.12);
  m.geometry.computeVertexNormals();
  m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
  m.position.set(...pos); m.rotation.set(...rot); m.scale.set(scale, scale, scale);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m); return m;
}
const sceneOf = () => new THREE.Scene();

export const SCENES = {
  'marble-podium': base({
    title: 'Marble podium', group: 'Beauty', ink: 'dark', font: 'serif',
    prompt: 'empty round white marble podium on a warm beige seamless backdrop, soft window light from the left, a taller travertine plinth behind, product photography, 85mm, no product, no text',
    anchor: [0, 0.62, 0],
    build() {
      const scene = sceneOf();
      bgSweep(scene, '#d9c8b4');
      const marble = TEX.marble(1024, '#f4f1ec', '#9a938b', 3);
      const top = mesh(worldUV(podium(0.95, 0.62, 0.025), 0.6), mat('#ffffff', { map: marble, roughness: 0.22, clearcoat: 0.4, clearcoatRoughness: 0.3 }));
      scene.add(top);
      const trav = TEX.noiseColor(512, '#d8c3a5', '#b39a7b', 10, 0.8, 4);
      scene.add(mesh(podium(0.62, 1.55, 0.02), mat('#ffffff', { map: trav, roughness: 0.8 }), { pos: [1.35, 0, -1.25] }));
      scene.add(mesh(worldUV(podium(0.55, 0.28, 0.02), 0.6), mat('#ffffff', { map: marble, roughness: 0.25 }), { pos: [-1.35, 0, 0.35] }));
      floor(scene, mat('#d9c8b4', { roughness: 0.95 }), 0);
      return { scene, camera: camera([0, 1.05, 0], 6.0, 8), target: [0, 1.05, 0], key: { pos: [-5, 6, 3], color: '#ffeedd', intensity: 3.6, radius: 1.4 }, sky: { color: '#f3e7da', intensity: 1.6 }, envIntensity: 0.35, exposure: 1.05, aperture: 0.03, focus: [0, 1.1, 0] };
    },
  }),
  'beach-rocks': base({
    title: 'Beach rocks', group: 'Outdoor', ink: 'light', font: 'sans',
    prompt: 'smooth dark beach pebbles and a flat rock on pale sand, calm turquoise sea and soft sky behind, warm late sun from the right, shallow depth of field, product photography, empty flat rock in the centre, no text',
    anchor: [0, 0.44, 0],
    build() {
      const scene = sceneOf();
      scene.add(skyDome('#7fb2d9', '#f3dcc4', '#c9a27f', 150, { dir: [0.6, 0.12, -1], color: '#ffd9a8' }));
      const sea = mesh(new THREE.PlaneGeometry(400, 160), mat('#2f8ba0', { roughness: 0.08, normalMap: TEX.rippleNormal(512, 4, 40), normalScale: new THREE.Vector2(0.4, 0.4) }), { rot: [-Math.PI / 2, 0, 0], pos: [0, -0.05, -95], cast: false });
      scene.add(sea);
      const sand = heightPlane(60, 40, 200, 140, (x, z) => (fbm(x * 0.25, z * 0.25, 4, 3) - 0.5) * 0.35 - Math.max(0, -z - 9) * 0.02, 0.6);
      const sandM = mesh(sand, mat('#e3cba8', { roughness: 0.95, normalMap: TEX.sandNormal(512, 9, 1), normalScale: new THREE.Vector2(0.6, 0.6) }), { cast: false });
      scene.add(sandM);
      const stone = TEX.noiseColor(512, '#5f5a55', '#3e3a37', 12, 0.9, 7);
      const flat = mesh(rock(1.05, 2, 0.42), mat('#ffffff', { map: stone, roughness: 0.55 }), { pos: [0, 0, 0] });
      flat.scale.set(1, 1, 0.85);
      scene.add(flat);
      const r = rng(11);
      for (const [x, z, s] of [[-1.5, 0.6, 0.45], [1.55, 0.3, 0.6], [2.4, -1.4, 0.8], [-2.3, -1.2, 0.7], [-0.9, 1.3, 0.28], [1.0, 1.4, 0.22], [-3.6, 0.2, 0.5], [3.6, 0.8, 0.4]]) {
        const m = mesh(rock(s, Math.floor(r() * 99), 0.55 + r() * 0.2), mat('#ffffff', { map: stone, roughness: 0.5, color: r() > 0.5 ? '#d8d2cc' : '#ffffff' }), { pos: [x, -0.05, z], rot: [0, r() * 6, 0] });
        scene.add(m);
      }
      return { scene, camera: camera([0, 0.95, 0], 5.6, 5), target: [0, 0.95, 0], key: { pos: [6, 3.2, -3], color: '#ffd7a8', intensity: 4.2, radius: 0.5 }, sky: { color: '#b9d4ee', intensity: 1.1 }, envIntensity: 0.3, exposure: 1.0, aperture: 0.09, focus: [0, 0.95, 0], shadowBox: 9 };
    },
  }),
  'kitchen-counter': base({
    title: 'Kitchen counter', group: 'Home', ink: 'dark', font: 'sans',
    prompt: 'clean white stone kitchen counter, white subway tile backsplash, wooden cutting board and a ceramic bowl blurred to the side, soft morning window light from the left, lifestyle product photography, empty space in the centre, no text',
    anchor: [0, 0, 0.2],
    build() {
      const scene = sceneOf();
      const quartz = TEX.noiseColor(1024, '#f2f0ec', '#d9d4cc', 30, 0.7, 2);
      const counter = mesh(new THREE.BoxGeometry(30, 0.2, 3.2), mat('#ffffff', { map: quartz, roughness: 0.25, clearcoat: 0.3 }), { pos: [0, -0.1, -0.3] });
      worldUV(counter.geometry, 0.12); scene.add(counter);
      scene.add(mesh(new THREE.BoxGeometry(30, 0.8, 2.6), mat('#3d4a44', { roughness: 0.5 }), { pos: [0, -0.62, -0.25], cast: false }));
      const tileMap = TEX.tiles(1024, '#f3f1ec', '#cbc5ba', 4, 8, 3); tileMap.repeat.set(8, 4);
      const tn = TEX.tilesNormal(1024, 4, 8, 1); tn.repeat.set(8, 4);
      const back = mesh(new THREE.PlaneGeometry(30, 8), mat('#ffffff', { map: tileMap, normalMap: tn, roughness: 0.18, clearcoat: 0.6 }), { pos: [0, 4, -1.9], cast: false });
      scene.add(back);
      const wood = TEX.wood(1024, '#c89a6b', '#8d6340', 2);
      const board = mesh(roundedBox(1.6, 2.4, 0.08, 0.035), mat('#ffffff', { map: wood, roughness: 0.6 }), { pos: [-1.9, 1.15, -1.62], rot: [-0.18, 0.12, 0] });
      scene.add(board);
      const bowlPts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; bowlPts.push(new THREE.Vector2(0.15 + Math.sin(t * Math.PI / 2) * 0.55, Math.pow(t, 1.4) * 0.42)); }
      scene.add(mesh(new THREE.LatheGeometry(bowlPts, 96), mat('#efe8de', { roughness: 0.35, clearcoat: 0.5, side: THREE.DoubleSide }), { pos: [1.85, 0, -0.9] }));
      for (const [x, z] of [[1.6, -0.75], [2.05, -0.95], [1.82, -0.7]]) scene.add(mesh(new THREE.SphereGeometry(0.17, 48, 24), mat('#e9a43a', { roughness: 0.45, normalMap: TEX.bumpy(256, 3, 40, 1.4) }), { pos: [x, 0.32, z] }));
      const sprig = leafTexture('olive', 512, '#ffffff', 4);
      foliage(scene, sprig, [2.6, 1.0, -1.5], [0, -0.3, 0.2], 1.8, '#5d7a4a');
      return { scene, camera: camera([0, 0.75, 0], 5.2, 9), target: [0, 0.75, 0], key: { pos: [-7, 5, 2], color: '#fff2e2', intensity: 3.4, radius: 2 }, sky: { color: '#eef3f8', intensity: 1.4 }, skyBias: [-0.3, 0, 0.6], envIntensity: 0.4, exposure: 1.08, aperture: 0.12, focus: [0, 0.6, 0.2] };
    },
  }),
  'studio-sweep': base({
    title: 'Studio sweep', group: 'Studio', ink: 'dark', font: 'sans',
    prompt: 'seamless peach paper studio sweep, two large softboxes, soft even light, clean minimal product photography backdrop with a low round platform, no product, no text',
    anchor: [0, 0.08, 0],
    build() {
      const scene = sceneOf();
      bgSweep(scene, '#f0b49b', { radius: 3.5, z: -3.2 });
      scene.add(mesh(podium(1.05, 0.08, 0.02), mat('#f6c7b2', { roughness: 0.7 })));
      return { scene, camera: camera([0, 0.62, 0], 5.0, 5), target: [0, 0.62, 0], key: { pos: [-3, 6, 4], color: '#ffffff', intensity: 2.3, radius: 2.6 }, sky: { color: '#fff3ec', intensity: 2.0 }, envIntensity: 0.4, exposure: 1.02, saturation: 0.95 };
    },
  }),
  'botanical-shadows': base({
    title: 'Botanical shadows', group: 'Beauty', ink: 'dark', font: 'serif',
    prompt: 'warm off-white plaster wall and floor with crisp palm leaf shadows cast by low afternoon sun, a low plaster block in the centre, minimal product photography, empty block top, no text',
    anchor: [0, 0.4, 0],
    build() {
      const scene = sceneOf();
      const plaster = TEX.noiseColor(1024, '#efe4d4', '#dccbb5', 6, 0.8, 9);
      const pn = TEX.bumpy(512, 9, 10, 1.2, 1);
      bgSweep(scene, '#ffffff', { radius: 0.6, z: -1.6, map: plaster, roughness: 0.95 });
      floor(scene, mat('#ffffff', { map: plaster, normalMap: pn, roughness: 0.95 }), 0);
      const blk = mesh(roundedBox(1.9, 0.4, 1.3, 0.04), mat('#ffffff', { map: plaster, normalMap: pn, roughness: 0.9 }), { pos: [0, 0.2, 0] });
      worldUV(blk.geometry, 0.4); scene.add(blk);
      const palm = leafTexture('palm', 1024, '#000000', 5), mon = leafTexture('monstera', 1024, '#000000', 6);
      gobo(scene, palm, [3.2, 4.2, 1.2], [0.4, -0.9, 2.2], 5.5);
      gobo(scene, mon, [4.4, 3.4, -0.6], [0.2, -1.1, 1.6], 3.6);
      gobo(scene, palm, [2.2, 5.4, -1.0], [0.6, -0.6, 2.8], 4.5);
      return { scene, camera: camera([0, 1.0, 0], 5.3, 6), target: [0, 1.0, 0], key: { pos: [9, 7, 2], color: '#ffe2bf', intensity: 4.6, radius: 0.18 }, sky: { color: '#f2e6d8', intensity: 1.3 }, envIntensity: 0.3, exposure: 1.02, shadowBox: 8 };
    },
  }),
  'water-splash': base({
    title: 'Water splash', group: 'Fresh', ink: 'light', font: 'sans', reflect: 0.35,
    prompt: 'clear turquoise water surface with gentle ripples and floating droplets, bright aqua gradient background, fresh clean product photography, product stands in shallow water in the centre, no text',
    anchor: [0, 0, 0],
    build() {
      const scene = sceneOf();
      scene.add(skyDome('#3fb7d6', '#a6e6ef', '#1b6f8d', 120));
      const water = mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshPhysicalMaterial({ color: '#1f9ab4', roughness: 0.04, metalness: 0, normalMap: TEX.rippleNormal(1024, 5, 6), normalScale: new THREE.Vector2(0.55, 0.55), clearcoat: 1, transmission: 0 }), { rot: [-Math.PI / 2, 0, 0], cast: false });
      scene.add(water);
      const r = rng(5);
      const drop = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, transmission: 1, thickness: 0.3, ior: 1.33, metalness: 0 });
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2, d = 0.75 + r() * 1.9, y = 0.15 + r() * 1.9;
        const s = 0.025 + r() ** 2 * 0.09;
        const m = mesh(new THREE.SphereGeometry(s, 32, 16), drop, { pos: [Math.cos(a) * d * 1.3, y, Math.sin(a) * d * 0.6 + 0.2], cast: false });
        m.scale.y = 1.15; scene.add(m);
      }
      // splash crown ring around the base
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2 + r() * 0.1, rr = 0.52 + r() * 0.12, h = 0.12 + r() * 0.3;
        const m = mesh(new THREE.ConeGeometry(0.04 + r() * 0.03, h, 12), drop, { pos: [Math.cos(a) * rr, h / 2 - 0.02, Math.sin(a) * rr * 0.9], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], cast: false });
        scene.add(m);
        if (r() > 0.4) scene.add(mesh(new THREE.SphereGeometry(0.035, 16, 12), drop, { pos: [Math.cos(a) * (rr + 0.08), h + 0.04, Math.sin(a) * (rr + 0.08) * 0.9], cast: false }));
      }
      return { scene, camera: camera([0, 0.62, 0], 5.0, 8), target: [0, 0.62, 0], key: { pos: [-3, 7, 4], color: '#ffffff', intensity: 2.6, radius: 1.2 }, sky: { color: '#d8f4fa', intensity: 1.1 }, envIntensity: 0.9, exposure: 1.0, aperture: 0.02 };
    },
  }),
  'sand-dune': base({
    title: 'Sand dune', group: 'Outdoor', ink: 'light', font: 'serif',
    prompt: 'rolling desert sand dunes at golden hour, rippled sand, long soft shadows, warm hazy sky, the product would stand on the nearest dune crest in the centre, product photography, no text',
    anchor: [0, 0.03, 0.4],
    build() {
      const scene = sceneOf();
      scene.add(skyDome('#c98a5e', '#f6cf9b', '#e9b98a', 200, { dir: [0.75, 0.1, -1], color: '#ffd8a0' }));
      const dune = (x, z) => {
        const ridge = Math.exp(-Math.pow((z - 0.4 + Math.sin(x * 0.35) * 0.6) / 1.8, 2)) * 0.05;
        const far = Math.max(0, -z - 3) * 0.16 * (0.55 + 0.45 * Math.sin(x * 0.18 + 1.2)) + Math.sin(x * 0.21 - z * 0.1) * Math.max(0, -z - 6) * 0.06;
        return ridge + far + (fbm(x * 0.12, z * 0.12, 3, 4) - 0.5) * 0.5 - Math.pow(Math.max(0, z - 1.5), 1.5) * 0.12;
      };
      const g = heightPlane(140, 90, 360, 240, dune, 0.5);
      g.translate(0, 0, -36);
      scene.add(mesh(g, mat('#e2b48a', { roughness: 0.92, normalMap: TEX.sandNormal(1024, 3, 1), normalScale: new THREE.Vector2(0.9, 0.9) })));
      return { scene, camera: camera([0, 0.75, 0], 5.6, 5), target: [0, 0.75, 0], key: { pos: [9, 2.6, -4], color: '#ffc58a', intensity: 5.2, radius: 0.3 }, sky: { color: '#f1c9a0', intensity: 0.9 }, envIntensity: 0.25, exposure: 1.0, aperture: 0.06, focus: [0, 0.6, 0.4], shadowBox: 14 };
    },
  }),
  'neon-shelf': base({
    title: 'Neon shelf', group: 'Night', ink: 'light', font: 'display', reflect: 0.25,
    prompt: 'dark moody room, glossy black shelf, pink and blue neon light tubes on a dark concrete wall behind, reflections on the shelf, product photography, empty spot on the shelf in the centre, no text',
    anchor: [0, 0.9, 0],
    build() {
      const scene = sceneOf();
      const conc = TEX.concrete(1024, '#2a2a30', 4);
      wall(scene, '#ffffff', -1.4, { map: conc, roughness: 0.85 });
      floor(scene, mat('#141418', { roughness: 0.6 }), -1);
      scene.add(mesh(new THREE.BoxGeometry(6.2, 0.1, 1.9), mat('#08080a', { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }), { pos: [0, 0.85, -0.45] }));
      const tube = (pts, color) => {
        const curve = new THREE.CatmullRomCurve3(pts.map((p) => V(...p)));
        const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 200, 0.035, 12), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 14 }));
        scene.add(m);
        const glow = new THREE.Mesh(new THREE.TubeGeometry(curve, 200, 0.16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }));
        scene.add(glow);
        const pl = new THREE.PointLight(color, 9, 6, 1.6); pl.position.copy(curve.getPoint(0.5)).add(V(0, 0, 0.4)); scene.add(pl);
      };
      tube([[-2.6, 3.6, -1.3], [-2.0, 2.2, -1.3], [-2.6, 1.4, -1.3]], '#ff3e9a');
      tube([[1.3, 3.4, -1.3], [2.0, 2.1, -1.3], [2.6, 3.2, -1.3], [3.1, 2.0, -1.3]], '#3ea0ff');
      const ring = new THREE.EllipseCurve(0, 0, 0.75, 0.75, 0, Math.PI * 2);
      tube(ring.getPoints(64).map((p) => [p.x - 0.1, p.y + 2.65, -1.32]), '#ff6ad5');
      return { scene, camera: camera([0, 1.55, 0], 5.0, 4), target: [0, 1.55, 0], key: { pos: [-2, 5, 4], color: '#c7d4ff', intensity: 0.55, radius: 1 }, sky: { color: '#4b4f7a', intensity: 0.25 }, envIntensity: 0.12, exposure: 1.1, aperture: 0.04 };
    },
  }),
  linen: base({
    title: 'Linen', group: 'Home', ink: 'dark', font: 'serif',
    prompt: 'soft cream linen fabric draped over a block with gentle folds, warm natural light, calm neutral product photography, flat empty area in the centre, no text',
    anchor: [0, 0.5, 0.05],
    build() {
      const scene = sceneOf();
      const lin = TEX.linen(1024, '#ece3d4', 3); lin.repeat.set(5, 5);
      const ln = normalTex(512, (u, v) => Math.sin(u * 512 * 0.5) * Math.sin(v * 512 * 0.5) * 0.5 + tfbm(u * 8, v * 8, 8, 3, 2) * 2, 1.2, 10);
      bgSweep(scene, '#e7dccb', { radius: 2.5, z: -3 });
      // draped cloth over a block: a height field with folds that relax away from the top
      const cloth = heightPlane(7, 5, 260, 200, (x, z) => {
        const top = Math.abs(x) < 1.2 && Math.abs(z) < 0.8 ? 0.5 : 0.5 * Math.exp(-Math.pow(Math.max(Math.abs(x) - 1.2, 0) * 1.4, 2) - Math.pow(Math.max(Math.abs(z) - 0.8, 0) * 1.3, 2));
        const edge = Math.max(Math.abs(x) - 1.2, Math.abs(z) - 0.8, 0);
        const folds = Math.sin(x * 5.2 + Math.sin(z * 2.1) * 1.6) * 0.06 * Math.min(1, edge * 1.6) + (fbm(x * 0.8, z * 0.8, 4, 7) - 0.5) * 0.12 * Math.min(1, edge * 2);
        return Math.max(0, top + folds);
      }, 1);
      scene.add(mesh(cloth, mat('#ffffff', { map: lin, normalMap: ln, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#fff4e3'), sheenRoughness: 0.6 })));
      floor(scene, mat('#e7dccb', { roughness: 0.95 }), -0.001);
      foliage(scene, leafTexture('olive', 1024, '#ffffff', 2), [-2.1, 1.3, -1.5], [0, 0.4, -0.25], 2.6, '#7a8b62');
      return { scene, camera: camera([0, 1.0, 0], 5.2, 9), target: [0, 1.0, 0], key: { pos: [-6, 7, 3], color: '#fff0dc', intensity: 3.0, radius: 1.6 }, sky: { color: '#f4ecdf', intensity: 1.5 }, envIntensity: 0.35, exposure: 1.06, aperture: 0.06 };
    },
  }),
  terrazzo: base({
    title: 'Terrazzo', group: 'Studio', ink: 'dark', font: 'display',
    prompt: 'terrazzo cube podium on a terrazzo floor against a sage green wall, crisp late morning sun with a hard shadow, colourful stone chips, playful product photography, empty cube top, no text',
    anchor: [0, 0.75, 0],
    build() {
      const scene = sceneOf();
      const tz = TEX.terrazzo(1024, '#ede6da', undefined, 5);
      wall(scene, '#9db5a2', -2.2);
      const fl = TEX.terrazzo(1024, '#e6dfd2', undefined, 6); fl.repeat.set(6, 6);
      floor(scene, mat('#ffffff', { map: fl, roughness: 0.35, clearcoat: 0.3 }), 0);
      const cube = mesh(roundedBox(1.3, 0.75, 1.3, 0.02), mat('#ffffff', { map: tz, roughness: 0.32, clearcoat: 0.3 }), { pos: [0, 0.375, 0], rot: [0, 0.35, 0] });
      worldUV(cube.geometry, 0.55); scene.add(cube);
      scene.add(mesh(new THREE.SphereGeometry(0.32, 64, 32), mat('#e2735a', { roughness: 0.4 }), { pos: [1.25, 0.32, 0.45] }));
      const arch = new THREE.Shape(); arch.moveTo(-0.5, 0); arch.lineTo(-0.5, 0.9); arch.absarc(0, 0.9, 0.5, Math.PI, 0, true); arch.lineTo(0.5, 0); arch.lineTo(-0.5, 0);
      const ag = new THREE.ExtrudeGeometry(arch, { depth: 0.25, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, curveSegments: 48 });
      scene.add(mesh(ag, mat('#e9b44c', { roughness: 0.6 }), { pos: [-1.45, 0, -1.2], rot: [0, 0.3, 0] }));
      return { scene, camera: camera([0, 1.15, 0], 5.3, 7), target: [0, 1.15, 0], key: { pos: [6, 7, 5], color: '#fff1d9', intensity: 4.4, radius: 0.25 }, sky: { color: '#e5efe7', intensity: 1.2 }, envIntensity: 0.35, exposure: 1.0 };
    },
  }),
  'pastel-arches': base({
    title: 'Pastel arches', group: 'Studio', ink: 'dark', font: 'serif',
    prompt: 'blush pink wall with tall arched openings showing a soft pastel sky, pink stepped cylinder podiums, dreamy soft light, product photography, empty top step in the centre, no text',
    anchor: [0, 0.55, 0],
    build() {
      const scene = sceneOf();
      scene.add(skyDome('#b7cdea', '#f7d9d3', '#f0cfc6', 150));
      const w = new THREE.Shape(); w.moveTo(-14, 0); w.lineTo(14, 0); w.lineTo(14, 9); w.lineTo(-14, 9); w.lineTo(-14, 0);
      for (const x of [-3.0, 0, 3.0]) { const h = new THREE.Path(); h.moveTo(x - 0.8, 0.6); h.lineTo(x - 0.8, 2.6); h.absarc(x, 2.6, 0.8, Math.PI, 0, true); h.lineTo(x + 0.8, 0.6); h.lineTo(x - 0.8, 0.6); w.holes.push(h); }
      const wg = new THREE.ExtrudeGeometry(w, { depth: 0.5, bevelEnabled: false, curveSegments: 48 });
      scene.add(mesh(wg, mat('#eab6ad', { roughness: 0.92 }), { pos: [0, 0, -2.6] }));
      floor(scene, mat('#efc3b9', { roughness: 0.9 }), 0);
      scene.add(mesh(podium(1.0, 0.3, 0.02), mat('#f3cfc6', { roughness: 0.8 })));
      scene.add(mesh(podium(0.72, 0.55, 0.02), mat('#f6d8d0', { roughness: 0.8 })));
      scene.add(mesh(podium(0.45, 1.25, 0.02), mat('#e9aea4', { roughness: 0.8 }), { pos: [1.55, 0, -0.9] }));
      return { scene, camera: camera([0, 1.1, 0], 5.6, 6), target: [0, 1.1, 0], key: { pos: [-5, 6, 5], color: '#fff2ea', intensity: 2.8, radius: 1.2 }, sky: { color: '#fbe6e2', intensity: 1.6 }, envIntensity: 0.35, exposure: 1.05 };
    },
  }),
  'concrete-plinth': base({
    title: 'Concrete plinth', group: 'Urban', ink: 'light', font: 'display',
    prompt: 'brutalist raw concrete blocks and plinth under hard midday sun, deep geometric shadows, pale blue sky backdrop, architectural product photography, empty plinth top in the centre, no text',
    anchor: [0, 1.0, 0],
    build() {
      const scene = sceneOf();
      scene.add(skyDome('#5f8fc8', '#bcd3ea', '#9a9a96', 150));
      const conc = TEX.concrete(1024, '#b4b0a8', 3);
      const block = (w, h, d, pos, rot = 0) => { const m = mesh(roundedBox(w, h, d, 0.012), mat('#ffffff', { map: conc, roughness: 0.92, normalMap: TEX.bumpy(256, 5, 24, 1.5) }), { pos, rot: [0, rot, 0] }); worldUV(m.geometry, 0.35); scene.add(m); };
      floor(scene, mat('#9f9b94', { roughness: 0.95, map: TEX.concrete(1024, '#a29e97', 8) }), 0);
      block(1.2, 1.0, 1.2, [0, 0.5, 0]);
      block(1.0, 2.6, 0.9, [-1.6, 1.3, -1.0]);
      block(2.6, 0.5, 1.2, [1.4, 0.25, -1.1]);
      block(0.6, 1.6, 0.6, [2.3, 0.8, -2.4]);
      return { scene, camera: camera([0, 1.5, 0], 5.5, 8, 28, -8), target: [0, 1.5, 0], key: { pos: [5, 9, 4], color: '#fff6e8', intensity: 5.4, radius: 0.12 }, sky: { color: '#c8daf0', intensity: 1.3 }, envIntensity: 0.25, exposure: 0.98, shadowBox: 8 };
    },
  }),
  'black-gloss': base({
    title: 'Black gloss', group: 'Night', ink: 'light', font: 'serif', reflect: 0.55,
    prompt: 'luxury black glossy floor and black backdrop, thin vertical light strips behind, mirror-like reflections, dramatic rim light, premium product photography, empty centre, no text',
    anchor: [0, 0, 0],
    build() {
      const scene = sceneOf();
      wall(scene, '#050506', -3.2, { roughness: 0.6 });
      for (const [x, h] of [[-2.2, 3.2], [2.2, 3.2], [-3.3, 2.4], [3.3, 2.4]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), new THREE.MeshStandardMaterial({ color: '#fff4e8', emissive: '#fff1e0', emissiveIntensity: 6 }));
        bar.position.set(x, h / 2 + 0.2, -2.6); scene.add(bar);
        const mirror = bar.clone(); mirror.position.y = -bar.position.y; scene.add(mirror);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.6, h + 0.4), new THREE.MeshBasicMaterial({ color: '#ffe9d0', transparent: true, opacity: 0.05, depthWrite: false })); glow.position.set(x, h / 2 + 0.2, -2.55); scene.add(glow);
      }
      const glossy = mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.18, transparent: true, opacity: 0.88, clearcoat: 1, clearcoatRoughness: 0.12 }), { rot: [-Math.PI / 2, 0, 0], cast: false });
      scene.add(glossy);
      scene.add(mesh(podium(1.0, 0.02, 0.008), new THREE.MeshPhysicalMaterial({ color: '#0b0b0c', roughness: 0.25, clearcoat: 1 })));
      const rim = new THREE.SpotLight('#ffe7cc', 40, 12, 0.6, 0.8); rim.position.set(0, 4, -3); rim.target.position.set(0, 0, 0); scene.add(rim, rim.target);
      return { scene, camera: camera([0, 0.6, 0], 5.1, 6), target: [0, 0.6, 0], key: { pos: [-3, 5, 4], color: '#ffffff', intensity: 0.5, radius: 1.5 }, sky: { color: '#2b2b33', intensity: 0.15 }, envIntensity: 0.15, exposure: 1.05, aperture: 0.03 };
    },
  }),
  'wood-window': base({
    title: 'Window light', group: 'Home', ink: 'dark', font: 'serif',
    prompt: 'warm oak wooden table against a plaster wall, late afternoon sun through a window casting window-frame shadows, cosy lifestyle product photography, empty table space in the centre, no text',
    anchor: [0, 0, 0],
    build() {
      const scene = sceneOf();
      const plaster = TEX.noiseColor(1024, '#e6d8c4', '#d2bfa6', 5, 0.8, 3);
      wall(scene, '#ffffff', -1.8, { map: plaster });
      const oak = TEX.wood(1024, '#c09062', '#875c37', 5);
      const tbl = mesh(new THREE.BoxGeometry(30, 0.12, 4), mat('#ffffff', { map: oak, roughness: 0.42, clearcoat: 0.25 }), { pos: [0, -0.06, 0] });
      worldUV(tbl.geometry, 0.3); scene.add(tbl);
      // window frame gobo: four panes
      const c = cvs(1024), g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 1024);
      g.clearRect(70, 70, 420, 420); g.clearRect(534, 70, 420, 420); g.clearRect(70, 534, 420, 420); g.clearRect(534, 534, 420, 420);
      const tex = toTex(c, { srgb: false });
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
      const inv = cvs(1024), ig = inv.getContext('2d'); ig.fillStyle = '#fff'; ig.fillRect(0, 0, 1024, 1024); ig.drawImage(c, 0, 0);
      win.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: toTex(c, { srgb: false }), alphaTest: 0.5 });
      win.customDepthMaterial.alphaMap.flipY = true;
      win.position.set(5, 4.2, 2.2); win.rotation.set(0, -1.1, 0); win.scale.set(4.2, 4.2, 1); win.castShadow = true; scene.add(win);
      void tex;
      foliage(scene, leafTexture('olive', 1024, '#ffffff', 7), [-1.9, 1.5, -1.2], [0, 0.3, 0.1], 2.8, '#6c7f55');
      const vase = []; for (let i = 0; i <= 30; i++) { const t = i / 30; vase.push(new THREE.Vector2(0.18 + Math.sin(t * Math.PI) * 0.16 - t * 0.06, t * 0.85)); }
      scene.add(mesh(new THREE.LatheGeometry(vase, 96), mat('#d8cbb8', { roughness: 0.7, normalMap: TEX.bumpy(256, 2, 18, 1) }), { pos: [-1.9, 0, -1.1] }));
      return { scene, camera: camera([0, 0.62, 0], 5.0, 7), target: [0, 0.62, 0], key: { pos: [10, 6.5, 4.5], color: '#ffd7a6', intensity: 5.0, radius: 0.2 }, sky: { color: '#e9e2d8', intensity: 1.0 }, skyBias: [0.4, 0, 0.5], envIntensity: 0.3, exposure: 1.0, shadowBox: 8, aperture: 0.05 };
    },
  }),
  'stone-steps': base({
    title: 'Stone steps', group: 'Beauty', ink: 'dark', font: 'serif',
    prompt: 'stacked travertine stone slabs forming soft steps against a muted sage backdrop, gentle diffused light, spa-like calm product photography, empty top slab in the centre, no text',
    anchor: [0, 0.7, 0],
    build() {
      const scene = sceneOf();
      bgSweep(scene, '#b9c2b0', { radius: 3 });
      const trav = TEX.noiseColor(1024, '#e3d3bb', '#c2ab8c', 14, 0.9, 6);
      const tn = TEX.bumpy(512, 6, 30, 2.2);
      const slab = (w, h, d, pos, rot) => { const m = mesh(roundedBox(w, h, d, 0.03), mat('#ffffff', { map: trav, normalMap: tn, roughness: 0.75 }), { pos, rot: [0, rot, 0] }); worldUV(m.geometry, 0.5); scene.add(m); };
      slab(2.8, 0.25, 1.9, [0.2, 0.125, -0.2], 0.08);
      slab(2.0, 0.25, 1.5, [-0.05, 0.375, 0], -0.06);
      slab(1.3, 0.2, 1.1, [0, 0.6, 0.05], 0.12);
      floor(scene, mat('#b9c2b0', { roughness: 0.95 }), 0);
      return { scene, camera: camera([0, 1.15, 0], 5.3, 8), target: [0, 1.15, 0], key: { pos: [-4, 7, 3], color: '#fff6ea', intensity: 2.8, radius: 2 }, sky: { color: '#eef2ea', intensity: 1.7 }, envIntensity: 0.35, exposure: 1.04 };
    },
  }),
  'sky-clouds': base({
    title: 'In the clouds', group: 'Dreamy', ink: 'dark', font: 'display',
    prompt: 'white round podium floating among soft fluffy clouds in a pastel blue and pink sky, dreamy light, surreal product photography, empty podium top, no text',
    anchor: [0, 0.3, 0],
    build() {
      const scene = sceneOf();
      scene.add(skyDome('#8fb6ec', '#f6dce6', '#fbe7ee', 150));
      scene.add(mesh(podium(0.95, 0.3, 0.04), mat('#fbfaf8', { roughness: 0.5 })));
      const r = rng(4);
      const cm = mat('#ffffff', { roughness: 1, sheen: 1, sheenColor: new THREE.Color('#ffe9f1') });
      const puff = (cx, cy, cz, s, n) => { for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = r() * s; scene.add(mesh(new THREE.SphereGeometry(s * (0.35 + r() * 0.45), 32, 16), cm, { pos: [cx + Math.cos(a) * d * 1.6, cy + r() * s * 0.4, cz + Math.sin(a) * d * 0.6] })); } };
      puff(0, -0.2, 0.1, 1.0, 26);
      puff(-2.6, 0.8, -2.4, 0.9, 18); puff(2.8, 0.4, -2.0, 1.0, 20); puff(-3.6, -0.6, -0.8, 0.8, 14); puff(3.4, -0.8, 0.2, 0.7, 12); puff(0.6, 2.2, -5.5, 1.3, 20);
      return { scene, camera: camera([0, 0.8, 0], 5.6, 5), target: [0, 0.8, 0], key: { pos: [-4, 7, 5], color: '#fff6ee', intensity: 2.6, radius: 2.5 }, sky: { color: '#f8e6ef', intensity: 1.8 }, envIntensity: 0.5, exposure: 1.02, aperture: 0.05 };
    },
  }),
  'ice-cubes': base({
    title: 'On ice', group: 'Fresh', ink: 'light', font: 'sans', reflect: 0.3,
    prompt: 'clear ice cubes scattered on a glossy icy blue surface, cool blue gradient backdrop, crisp refreshing drink product photography, empty space in the centre, no text',
    anchor: [0, 0, 0],
    build() {
      const scene = sceneOf();
      bgSweep(scene, '#5aa8d8', { radius: 3, roughness: 0.4 });
      floor(scene, mat('#76b9e2', { roughness: 0.1, clearcoat: 1 }), 0);
      const ice = new THREE.MeshPhysicalMaterial({ color: '#eaf7ff', roughness: 0.08, transmission: 1, thickness: 0.6, ior: 1.31, normalMap: TEX.bumpy(256, 3, 6, 1.4), normalScale: new THREE.Vector2(0.3, 0.3) });
      const r = rng(9);
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2, d = 0.95 + r() * 1.9, s = 0.28 + r() * 0.2;
        scene.add(mesh(roundedBox(s, s, s, 0.05, 3), ice, { pos: [Math.cos(a) * d * 1.3, s / 2, Math.sin(a) * d * 0.7 - 0.2], rot: [r() * 0.4, r() * 3, r() * 0.4] }));
      }
      for (let i = 0; i < 30; i++) scene.add(mesh(new THREE.SphereGeometry(0.02 + r() * 0.03, 16, 8), ice, { pos: [(r() - 0.5) * 5, 0.02, (r() - 0.5) * 2.5] }));
      return { scene, camera: camera([0, 0.62, 0], 5.0, 9), target: [0, 0.62, 0], key: { pos: [-3, 7, 4], color: '#ffffff', intensity: 3.0, radius: 1.2 }, sky: { color: '#dff1ff', intensity: 1.3 }, envIntensity: 0.6, exposure: 1.02, aperture: 0.04 };
    },
  }),
  'tropical-leaves': base({
    title: 'Tropical leaves', group: 'Outdoor', ink: 'light', font: 'display',
    prompt: 'beige round podium framed by lush monstera and palm leaves, dappled tropical light, warm summer product photography, empty podium top in the centre, no text',
    anchor: [0, 0.5, 0],
    build() {
      const scene = sceneOf();
      bgSweep(scene, '#e9dcc3', { radius: 2.4, z: -3 });
      scene.add(mesh(podium(0.9, 0.5, 0.03), mat('#e2cfae', { roughness: 0.75, normalMap: TEX.bumpy(256, 3, 18, 1) })));
      const mon = leafTexture('monstera', 1024, '#ffffff', 3), palm = leafTexture('palm', 1024, '#ffffff', 8);
      foliage(scene, mon, [-1.9, 0.0, -0.8], [0.15, 0.6, 0.35], 2.4, '#2f6b3a');
      foliage(scene, mon, [2.1, 0.2, -1.1], [0.1, -0.7, -0.4], 2.2, '#3b7a44');
      foliage(scene, palm, [-2.8, 0.2, -2.0], [0, 0.4, 0.6], 3.6, '#4b7e3f');
      foliage(scene, palm, [2.9, 0.1, -2.2], [0, -0.3, -0.7], 3.8, '#3d6e36');
      foliage(scene, mon, [1.4, -0.3, 1.1], [-0.4, -0.2, -0.9], 1.4, '#2c5f35');
      foliage(scene, mon, [-1.5, -0.4, 1.2], [-0.5, 0.3, 0.8], 1.3, '#356b3b');
      gobo(scene, leafTexture('palm', 1024, '#000000', 9), [-3, 5, 2], [0.5, 0.6, -2.4], 5);
      floor(scene, mat('#e9dcc3', { roughness: 0.95 }), 0);
      return { scene, camera: camera([0, 1.0, 0], 5.3, 7), target: [0, 1.0, 0], key: { pos: [-6, 8, 3], color: '#fff0d0', intensity: 3.8, radius: 0.4 }, sky: { color: '#e6efd9', intensity: 1.2 }, envIntensity: 0.3, exposure: 1.02, aperture: 0.06, shadowBox: 8 };
    },
  }),
  'pop-blocks': base({
    title: 'Pop blocks', group: 'Studio', ink: 'dark', font: 'display',
    prompt: 'playful colour-block set, yellow cylinder podium, red sphere, cobalt arch and mint backdrop, bright even light, bold pop product photography, empty podium top, no text',
    anchor: [0, 0.7, 0],
    build() {
      const scene = sceneOf();
      bgSweep(scene, '#9fe0c9', { radius: 3 });
      scene.add(mesh(podium(0.8, 0.7, 0.02), mat('#ffcf3a', { roughness: 0.55 })));
      scene.add(mesh(new THREE.SphereGeometry(0.42, 64, 32), mat('#f2533d', { roughness: 0.35, clearcoat: 0.5 }), { pos: [-1.35, 0.42, 0.3] }));
      const arch = new THREE.Shape(); arch.moveTo(-0.7, 0); arch.lineTo(-0.7, 1.0); arch.absarc(0, 1.0, 0.7, Math.PI, 0, true); arch.lineTo(0.7, 0); arch.lineTo(0.35, 0); arch.lineTo(0.35, 1.0); arch.absarc(0, 1.0, 0.35, 0, Math.PI, false); arch.lineTo(-0.35, 0); arch.lineTo(-0.7, 0);
      scene.add(mesh(new THREE.ExtrudeGeometry(arch, { depth: 0.3, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, curveSegments: 48 }), mat('#2f5bd8', { roughness: 0.5 }), { pos: [1.45, 0, -1.0], rot: [0, -0.35, 0] }));
      scene.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat('#f7a8c4', { roughness: 0.5 }), { pos: [1.1, 0.25, 0.7], rot: [0, 0.6, 0] }));
      floor(scene, mat('#9fe0c9', { roughness: 0.9 }), 0);
      return { scene, camera: camera([0, 1.15, 0], 5.4, 7), target: [0, 1.15, 0], key: { pos: [-4, 7, 5], color: '#ffffff', intensity: 3.2, radius: 0.6 }, sky: { color: '#effaf5', intensity: 1.6 }, envIntensity: 0.35, exposure: 1.0, saturation: 1.05 };
    },
  }),
  'bokeh-night': base({
    title: 'Holiday lights', group: 'Night', ink: 'light', font: 'serif', reflect: 0.2,
    prompt: 'deep burgundy velvet podium with warm golden bokeh lights in the dark background, festive holiday product photography, glossy surface, empty podium top, no text',
    anchor: [0, 0.45, 0],
    build() {
      const scene = sceneOf();
      wall(scene, '#120708', -6);
      floor(scene, new THREE.MeshPhysicalMaterial({ color: '#1c0b0d', roughness: 0.25, clearcoat: 0.8 }), 0);
      scene.add(mesh(podium(0.9, 0.45, 0.03), mat('#5c1420', { roughness: 0.85, sheen: 1, sheenColor: new THREE.Color('#d0566a'), sheenRoughness: 0.4 })));
      const r = rng(12);
      for (let i = 0; i < 90; i++) {
        const c = ['#ffcf7a', '#ffb347', '#fff1c9', '#ff9d6b'][Math.floor(r() * 4)];
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.04 + r() * 0.04, 12, 8), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 10 + r() * 14 }));
        s.position.set((r() - 0.5) * 16, r() * 6 + 0.3, -3 - r() * 6); scene.add(s);
      }
      const pl = new THREE.PointLight('#ffb760', 6, 12, 1.5); pl.position.set(1.5, 3, -2.5); scene.add(pl);
      return { scene, camera: camera([0, 0.95, 0], 5.2, 5), target: [0, 0.95, 0], key: { pos: [-3, 6, 4], color: '#ffe0b8', intensity: 1.4, radius: 1 }, sky: { color: '#3a1d1d', intensity: 0.25 }, envIntensity: 0.12, exposure: 1.05, aperture: 0.32, focus: [0, 0.9, 0], frames: 96 };
    },
  }),
};

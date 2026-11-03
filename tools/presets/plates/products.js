// Sample products for the presets, rendered as transparent cutouts. All brand names are invented.
import { THREE, mat, mesh, roundedBox, cvs, toTex, TEX } from './lib.js';

async function fonts() {
  const faces = [['Fraunces', 'fraunces-latin-700-normal', 700], ['Fraunces', 'fraunces-latin-300-italic', 300, 'italic'], ['Archivo Black', 'archivo-black-latin-400-normal', 400], ['Instrument Sans', 'instrument-sans-latin-600-normal', 600], ['DM Serif Display', 'dm-serif-display-latin-400-normal', 400], ['Unbounded', 'unbounded-latin-700-normal', 700], ['Space Grotesk', 'space-grotesk-latin-700-normal', 700]];
  for (const [f, file, w, st = 'normal'] of faces) { const ff = new FontFace(f, `url(/public/fonts/${file}.woff2)`, { weight: String(w), style: st }); document.fonts.add(ff); await ff.load().catch(() => {}); }
}
function label(w, h, draw) { const c = cvs(w, h), g = c.getContext('2d'); draw(g, w, h); const t = toTex(c); t.wrapS = THREE.ClampToEdgeWrapping; t.anisotropy = 16; return t; }
function lathe(profile, seg = 160) { return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), seg); }
/** A label band: an open cylinder slightly outside the body, covering arc `arc` radians facing the camera. */
function band(r, y0, y1, tex, arc = Math.PI * 1.15, o = {}) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, 160, 1, true, Math.PI - arc / 2 + Math.PI / 2 * 0 - Math.PI, arc);
  const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ map: tex, roughness: o.rough ?? 0.45, clearcoat: o.coat ?? 0.2, transparent: true, metalness: o.metal ?? 0 }));
  m.position.y = (y0 + y1) / 2; m.castShadow = true;
  return m;
}
const studio = (scene, target, dist, fov = 18, elev = 4) => {
  const c = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
  const e = (elev * Math.PI) / 180;
  c.position.set(0, target[1] + Math.sin(e) * dist, Math.cos(e) * dist);
  c.lookAt(...target);
  return { scene, camera: c, target, alpha: true, background: null, key: { pos: [-4, 5, 5], color: '#ffffff', intensity: 2.4, radius: 1.6 }, sky: { color: '#ffffff', intensity: 0.9 }, envIntensity: 1.1, exposure: 1.0, shadowBox: 3 };
};

export const PRODUCTS = {
  serum: {
    title: 'Serum bottle', size: [900, 1500],
    async build() {
      await fonts();
      const scene = new THREE.Scene();
      const body = lathe([[0, 0], [0.33, 0], [0.36, 0.02], [0.37, 0.06], [0.37, 0.95], [0.34, 1.04], [0.2, 1.1], [0.13, 1.13], [0.13, 1.2], [0, 1.2]]);
      scene.add(mesh(body, new THREE.MeshPhysicalMaterial({ color: '#9a4b12', roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0, specularIntensity: 1, ior: 1.5, metalness: 0, emissive: '#2a0e02', emissiveIntensity: 0.25 })));
      const tex = label(1600, 700, (g, w, h) => {
        g.fillStyle = '#f5efe6'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#2b2622'; g.textAlign = 'center';
        g.font = '700 150px Fraunces'; g.letterSpacing = '24px'; g.fillText('ORVELA', w / 2, 300);
        g.font = 'italic 300 70px Fraunces'; g.letterSpacing = '2px'; g.fillText('radiance serum', w / 2, 420);
        g.font = '600 38px "Instrument Sans"'; g.letterSpacing = '10px'; g.fillText('VITAMIN C  ·  30 ML', w / 2, 560);
        g.fillRect(w / 2 - 60, 470, 120, 3);
      });
      scene.add(band(0.374, 0.22, 0.78, tex, Math.PI * 1.1));
      scene.add(mesh(lathe([[0, 1.12], [0.17, 1.12], [0.175, 1.14], [0.175, 1.3], [0.17, 1.32], [0, 1.32]]), new THREE.MeshPhysicalMaterial({ color: '#c9a35f', metalness: 1, roughness: 0.22 })));
      scene.add(mesh(lathe([[0, 1.31], [0.13, 1.31], [0.135, 1.35], [0.12, 1.55], [0.1, 1.68], [0.06, 1.74], [0, 1.75]]), mat('#1d1b1a', { roughness: 0.55, sheen: 0.3 })));
      return studio(scene, [0, 0.87, 0], 6.4, 18, 3);
    },
  },
  jar: {
    title: 'Cream jar', size: [1400, 1000],
    async build() {
      await fonts();
      const scene = new THREE.Scene();
      scene.add(mesh(lathe([[0, 0], [0.62, 0], [0.66, 0.03], [0.68, 0.1], [0.68, 0.52], [0.64, 0.56], [0.6, 0.58], [0, 0.58]]), new THREE.MeshPhysicalMaterial({ color: '#f1d6cf', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') })));
      const tex = label(2000, 420, (g, w, h) => {
        g.clearRect(0, 0, w, h); g.fillStyle = '#6b3d35'; g.textAlign = 'center';
        g.font = '400 150px "DM Serif Display"'; g.letterSpacing = '20px'; g.fillText('KAIMO', w / 2, 210);
        g.font = '600 40px "Instrument Sans"'; g.letterSpacing = '14px'; g.fillText('DAILY BARRIER CREAM  ·  50 ML', w / 2, 320);
      });
      scene.add(band(0.684, 0.12, 0.5, tex, Math.PI * 0.95, { rough: 0.5, coat: 0 }));
      scene.add(mesh(lathe([[0, 0.57], [0.66, 0.57], [0.7, 0.6], [0.71, 0.66], [0.71, 0.86], [0.69, 0.89], [0.64, 0.9], [0, 0.9]]), new THREE.MeshPhysicalMaterial({ color: '#d7b06b', metalness: 1, roughness: 0.18 })));
      return studio(scene, [0, 0.45, 0], 6.6, 16, 9);
    },
  },
  can: {
    title: 'Soda can', size: [800, 1400],
    async build() {
      await fonts();
      const scene = new THREE.Scene();
      const prof = [[0, 0.02], [0.24, 0], [0.31, 0.03], [0.33, 0.1], [0.33, 1.08], [0.3, 1.18], [0.27, 1.22], [0.28, 1.235], [0.27, 1.25], [0, 1.24]];
      scene.add(mesh(lathe(prof), new THREE.MeshPhysicalMaterial({ color: '#d9dde0', metalness: 1, roughness: 0.25 })));
      const tex = label(1800, 1300, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#c8e86b'); gr.addColorStop(1, '#3fae74'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 70; i++) { g.beginPath(); g.arc((i * 263) % w, (i * 397) % h, 6 + (i % 7) * 4, 0, 7); g.fill(); }
        g.save(); g.translate(w / 2, h * 0.5); g.rotate(-0.12);
        g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.font = '400 260px "Archivo Black"'; g.fillText('FIZZY', 0, -30);
        g.fillStyle = '#1f4f2f'; g.font = '700 200px Unbounded'; g.fillText('PEAR', 0, 190); g.restore();
        g.fillStyle = '#1f4f2f'; g.textAlign = 'center'; g.font = '600 46px "Instrument Sans"'; g.letterSpacing = '12px'; g.fillText('SPARKLING · NO SUGAR · 330 ML', w / 2, h - 90);
      });
      scene.add(band(0.334, 0.12, 1.07, tex, Math.PI * 1.2, { rough: 0.3, coat: 0.6, metal: 0.25 }));
      return studio(scene, [0, 0.64, 0], 6.0, 16, 4);
    },
  },
  perfume: {
    title: 'Perfume', size: [1000, 1400],
    async build() {
      await fonts();
      const scene = new THREE.Scene();
      const glass = new THREE.MeshPhysicalMaterial({ color: '#f0c98f', roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, metalness: 0, ior: 1.6, specularIntensity: 1, emissive: '#5b3410', emissiveIntensity: 0.18, iridescence: 0.3 });
      const b = mesh(roundedBox(1.0, 0.95, 0.5, 0.09, 6), glass, { pos: [0, 0.475, 0] }); scene.add(b);
      const inner = mesh(roundedBox(0.8, 0.7, 0.3, 0.08, 4), new THREE.MeshPhysicalMaterial({ color: '#e6a24e', roughness: 0.2, transparent: true, opacity: 0.6 }), { pos: [0, 0.45, 0] }); scene.add(inner);
      scene.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 64), new THREE.MeshPhysicalMaterial({ color: '#c9a35f', metalness: 1, roughness: 0.2 }), { pos: [0, 1.0, 0] }));
      scene.add(mesh(roundedBox(0.48, 0.42, 0.48, 0.05, 5), mat('#141414', { roughness: 0.35, clearcoat: 0.8 }), { pos: [0, 1.26, 0] }));
      const plaque = label(900, 300, (g, w, h) => {
        g.fillStyle = '#f7f1e6'; g.fillRect(0, 0, w, h); g.fillStyle = '#1b1b1b'; g.textAlign = 'center';
        g.font = '400 120px "DM Serif Display"'; g.fillText('été 09', w / 2, 150); g.font = '600 32px "Instrument Sans"'; g.letterSpacing = '12px'; g.fillText('EAU DE PARFUM', w / 2, 230);
      });
      scene.add(mesh(new THREE.PlaneGeometry(0.5, 0.167), new THREE.MeshPhysicalMaterial({ map: plaque, roughness: 0.5 }), { pos: [0, 0.5, 0.252] }));
      return studio(scene, [0, 0.74, 0], 6.6, 17, 6);
    },
  },
  speaker: {
    title: 'Smart speaker', size: [900, 1300],
    async build() {
      await fonts();
      const scene = new THREE.Scene();
      const knit = TEX.bumpy(512, 4, 120, 3); knit.repeat.set(3, 3);
      const fab = TEX.noiseColor(512, '#cfcbc4', '#b9b4ac', 80, 1, 5); fab.repeat.set(3, 3);
      scene.add(mesh(lathe([[0, 0], [0.42, 0], [0.47, 0.04], [0.48, 0.12], [0.48, 1.05], [0.46, 1.1], [0, 1.1]]), new THREE.MeshPhysicalMaterial({ map: fab, normalMap: knit, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, sheen: 1, sheenColor: new THREE.Color('#ffffff'), sheenRoughness: 0.5 })));
      scene.add(mesh(lathe([[0, 1.08], [0.44, 1.08], [0.47, 1.1], [0.47, 1.16], [0.44, 1.19], [0, 1.19]]), mat('#e9e6e1', { roughness: 0.4, clearcoat: 0.5 })));
      scene.add(mesh(new THREE.TorusGeometry(0.24, 0.012, 16, 96), new THREE.MeshStandardMaterial({ color: '#7fd0ff', emissive: '#58b8ff', emissiveIntensity: 3 }), { pos: [0, 1.195, 0], rot: [Math.PI / 2, 0, 0] }));
      return studio(scene, [0, 0.62, 0], 6.2, 16, 8);
    },
  },
};
for (const p of Object.values(PRODUCTS)) p.meta = () => ({});

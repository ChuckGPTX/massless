import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { saveAsset, downloadBlob } from "../assets.js";
const $ = (s) => document.querySelector(s),
  scene = new THREE.Scene(),
  objects = [],
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  }),
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
let light, controls;
const message = (t) => ($("#status").textContent = t);
scene.background = new THREE.Color("#171b24");
camera.position.set(9, 7, 11);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
$("#scene").append(renderer.domElement);
controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight("#e0eaff", "#44372c", 2));
light = new THREE.DirectionalLight("#fff2dc", 4);
light.position.set(4, 8, 3);
light.castShadow = true;
scene.add(light);
const ground = new THREE.Mesh(
  new THREE.BoxGeometry(16, 0.15, 16),
  new THREE.MeshStandardMaterial({ color: "#343d41", roughness: 0.8 }),
);
ground.position.y = -0.1;
ground.receiveShadow = true;
ground.name = "Stage";
scene.add(ground);
function selected() {
  return objects[Number($("#object").value)];
}
function sync() {
  const m = selected();
  if (!m) return;
  for (const k of ["x", "y", "z"]) $("#" + k).value = m.position[k];
  $("#scale").value = m.scale.x;
  $("#rotation").value = THREE.MathUtils.radToDeg(m.rotation.y);
  $("#color").value = "#" + m.material.color.getHexString();
}
function list() {
  const index = Math.max(0, objects.length - 1);
  $("#object").replaceChildren(
    ...objects.map((m, i) => {
      const o = document.createElement("option");
      o.value = i;
      o.textContent = m.name;
      return o;
    }),
  );
  $("#object").value = index;
  sync();
}
function add(
  shape = "box",
  color = "#ffc338",
  p = [0, 1, 0],
  scale = 1,
  rotation = 0,
) {
  if (objects.length >= 40) throw new Error("Use up to 40 objects per scene.");
  const geometry = {
    box: () => new THREE.BoxGeometry(1.6, 1.6, 1.6),
    sphere: () => new THREE.SphereGeometry(1, 32, 24),
    torus: () => new THREE.TorusGeometry(1, 0.3, 16, 48),
    cone: () => new THREE.ConeGeometry(1, 2, 32),
  }[shape];
  if (!geometry) throw new Error("Choose a supported shape.");
  const m = new THREE.Mesh(
    geometry(),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.2 }),
  );
  m.position.fromArray(p);
  m.scale.setScalar(scale);
  m.rotation.y = rotation;
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = shape + " " + (objects.length + 1);
  m.userData.shape = shape;
  scene.add(m);
  objects.push(m);
  list();
}
$("#add").onclick = () => {
  try {
    add($("#shape").value, $("#color").value);
  } catch (e) {
    message(e.message);
  }
};
$("#object").onchange = sync;
for (const k of ["x", "y", "z", "scale", "rotation", "color"])
  $("#" + k).oninput = () => {
    const m = selected();
    if (!m) return;
    for (const axis of ["x", "y", "z"])
      m.position[axis] = Number($("#" + axis).value);
    m.scale.setScalar(Number($("#scale").value));
    m.rotation.y = THREE.MathUtils.degToRad(Number($("#rotation").value));
    m.material.color.set($("#color").value);
  };
$("#light").oninput = () => (light.intensity = Number($("#light").value));
function remove(m) {
  scene.remove(m);
  objects.splice(objects.indexOf(m), 1);
  m.geometry.dispose();
  m.material.dispose();
}
$("#remove").onclick = () => {
  const m = selected();
  if (m) {
    remove(m);
    list();
  }
};
$("#frame").onclick = async () => {
  try {
    renderer.render(scene, camera);
    const blob = await new Promise((r) =>
      renderer.domElement.toBlob(r, "image/png"),
    );
    await saveAsset(blob, {
      name: "Scene studio frame",
      engine: "three-scene",
      settings: recipe(),
    });
    message(
      "Frame saved to My library. Animate it or use it in a launch film.",
    );
  } catch (e) {
    message(e.message);
  }
};
$("#glb").onclick = async () => {
  try {
    const buffer = await new GLTFExporter().parseAsync(
      (() => {
        const exported = scene.clone();
        const view = camera.clone();
        view.name = "Chucksi camera";
        exported.add(view);
        return exported;
      })(),
      { binary: true },
    );
    downloadBlob(
      new Blob([buffer], { type: "model/gltf-binary" }),
      "chucksi-scene.glb",
    );
    message("GLB exported with objects, materials and lights.");
  } catch (e) {
    message("Export failed: " + e.message);
  }
};
function recipe() {
  return {
    version: 1,
    camera: {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    },
    objects: objects.map((m) => ({
      shape: m.userData.shape,
      color: "#" + m.material.color.getHexString(),
      position: m.position.toArray(),
      scale: m.scale.x,
      rotation: m.rotation.y,
    })),
    light: light.intensity,
  };
}
$("#settings").onclick = () =>
  downloadBlob(
    new Blob([JSON.stringify(recipe(), null, 2)], { type: "application/json" }),
    "chucksi-scene.json",
  );
$("#restore").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 30000) throw new Error("Choose a scene file under 30 KB.");
    const s = JSON.parse(await f.text());
    if (s.version !== 1 || !Array.isArray(s.objects) || s.objects.length > 40)
      throw new Error("Choose Chucksi scene settings.");
    for (const o of s.objects) {
      if (
        !["box", "sphere", "torus", "cone"].includes(o.shape) ||
        !/^#[a-f0-9]{6}$/i.test(o.color) ||
        !Array.isArray(o.position) ||
        o.position.length !== 3 ||
        o.position.some((n) => !Number.isFinite(n) || Math.abs(n) > 20) ||
        !Number.isFinite(o.scale) ||
        o.scale < 0.1 ||
        o.scale > 5 ||
        !Number.isFinite(o.rotation)
      )
        throw new Error("Invalid scene object.");
    }
    if (s.camera)
      for (const v of [s.camera.position, s.camera.target]) {
        if (
          !Array.isArray(v) ||
          v.length !== 3 ||
          v.some((n) => !Number.isFinite(n) || Math.abs(n) > 100)
        )
          throw new Error("Invalid scene camera.");
      }
    objects.slice().forEach(remove);
    for (const o of s.objects)
      add(o.shape, o.color, o.position, o.scale, o.rotation);
    light.intensity = Math.max(0, Math.min(8, Number(s.light) || 4));
    $("#light").value = light.intensity;
    if (s.camera) {
      camera.position.fromArray(s.camera.position);
      controls.target.fromArray(s.camera.target);
      controls.update();
    }
    message("Scene restored.");
  } catch (e) {
    message(e.message);
  }
};
const resize = new ResizeObserver(() => {
  const box = $("#scene");
  renderer.setSize(box.clientWidth, box.clientHeight);
  camera.aspect = box.clientWidth / box.clientHeight;
  camera.updateProjectionMatrix();
});
resize.observe($("#scene"));
add("torus", "#ffc338", [0, 1.8, 0]);
add("sphere", "#b8c7dc", [-2.5, 1, 1], 0.75);
add("box", "#526d78", [2.5, 0.8, -1]);
renderer.setAnimationLoop(() => {
  controls.autoRotate =
    $("#orbit").checked &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.update();
  renderer.render(scene, camera);
});

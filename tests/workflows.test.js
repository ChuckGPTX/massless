import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WORKFLOWS,
  validatePlan,
  stepURL,
} from "../public/js/workflow-data.js";
test("plan import uses known workflows and rejects malformed states", () => {
  const p = {
    version: 1,
    workflowId: WORKFLOWS[0].id,
    brief: "Release",
    done: [false, true, false],
    shotId: "saved",
  };
  assert.deepEqual(validatePlan({ ...p, href: "https://untrusted.test" }), p);
  for (const patch of [
    { version: 2 },
    { workflowId: "external" },
    { done: [1] },
    { brief: "x".repeat(4001) },
  ])
    assert.throws(() => validatePlan({ ...p, ...patch }));
  assert.equal(
    stepURL("/video?effect=lidar", "shot one"),
    "/video?effect=lidar&shot=shot+one",
  );
  assert.equal(stepURL("/music", "shot"), "/music?shot=shot");
  assert.equal(stepURL("/3d", "shot"), "/3d?shot=shot");
});
test("every workflow preview and selected community graph is a real bundled file", async () => {
  for (const w of WORKFLOWS)
    assert.ok(
      (await readFile(new URL("../public" + w.image, import.meta.url))).length >
        0,
    );
  const presets = JSON.parse(
    await readFile(
      new URL("../public/workflows/presets/index.json", import.meta.url),
    ),
  );
  assert.equal(presets.length, 5);
  for (const p of presets) {
    const graph = JSON.parse(
      await readFile(
        new URL("../public/comfy/vfx4all/" + p.id + ".json", import.meta.url),
      ),
    );
    assert.ok(
      Object.values(graph).some(
        (n) =>
          n.class_type === "SaveVideo" ||
          n.class_type === "VHS_VideoCombine" ||
          n.class_type === "SaveImage",
      ),
    );
    assert.match(p.comfy_app, /^https:\/\//);
  }
});

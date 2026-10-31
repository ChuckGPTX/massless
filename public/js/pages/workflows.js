import { createPreviewMotion } from "../preview-motion.js";
import { WORKFLOWS, validatePlan, stepURL } from "../workflow-data.js";
import { all } from "../store.js";
import * as cloud from "../cloud.js";
const $ = (s) => document.querySelector(s),
  KEY = "massless.workflow-plan.v1";
const make = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};
let plan;
let shots = [];
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    $("#run-status").textContent =
      "Browser storage is unavailable. Download your plan before leaving.";
  }
}
function renderSteps() {
  const spec = WORKFLOWS.find((x) => x.id === plan.workflowId);
  $("#run-steps").replaceChildren(
    ...spec.steps.map(([name, href], i) => {
      const row = make("div", "workflow-step"),
        label = make("label"),
        check = make("input");
      check.type = "checkbox";
      check.checked = plan.done[i];
      check.onchange = () => {
        plan.done[i] = check.checked;
        persist();
      };
      label.append(check, document.createTextNode(i + 1 + ". " + name));
      const a = make("a", "", "Open tool ↗");
      a.href = stepURL(href, plan.shotId, plan.brief);
      row.append(label, a);
      return row;
    }),
  );
}
function openPlan(next, scroll = true) {
  plan = validatePlan(next);
  if (plan.shotId && !shots.some((x) => x.id === plan.shotId)) plan.shotId = "";
  $("#run-panel").hidden = false;
  $("#run-title").textContent = WORKFLOWS.find(
    (x) => x.id === plan.workflowId,
  ).name;
  $("#run-brief").value = plan.brief;
  $("#shot-list").value = plan.shotId;
  renderSteps();
  persist();
  if (scroll)
    $("#run-panel").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "start",
    });
}
for (const flow of WORKFLOWS) {
  const card = make("article", "hub-card");
  const image = make("img");
  image.src = flow.image;
  image.alt = "";
  image.loading = "lazy";
  image.onerror = () => {
    image.remove();
    const visual = make("div", "preset-stages", flow.tag.split(" + ")[0]);
    card.prepend(visual);
  };
  const body = make("div", "hub-card-body"),
    button = make("button", "btn-accent", "Start workflow ↗");
  button.onclick = () =>
    openPlan({
      version: 1,
      workflowId: flow.id,
      brief: "",
      shotId: "",
      done: flow.steps.map(() => false),
    });
  body.append(
    make("small", "eyebrow", flow.tag),
    make("h2", "", flow.name),
    make("p", "", flow.description),
    make("small", "", "YOU LEAVE WITH / " + flow.output),
    make("div", "hub-actions"),
  );
  body.lastChild.append(button);
  card.append(image, body);
  $("#workflow-cards").append(card);
}
shots = (await all().catch(() => [])).filter((x) =>
  x.blob?.type.startsWith("image/"),
);
for (const shot of shots) {
  const o = make("option", "", shot.prompt?.slice(0, 70) || "Saved image");
  o.value = shot.id;
  $("#shot-list").append(o);
}
const none = make("option", "", "Use a sample or upload inside the tool");
none.value = "";
$("#shot-list").prepend(none);
$("#run-brief").oninput = () => {
  plan.brief = $("#run-brief").value;
  persist();
  renderSteps();
};
$("#shot-list").onchange = () => {
  plan.shotId = $("#shot-list").value;
  persist();
  renderSteps();
};
$("#export-run").onclick = () => {
  const blob = new Blob(
      [
        JSON.stringify(
          { ...plan, exportedAt: new Date().toISOString() },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
    url = URL.createObjectURL(blob),
    a = make("a");
  a.href = url;
  a.download = "massless-" + plan.workflowId + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("#import-run").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 20000)
      throw new Error("Choose a workflow plan smaller than 20 KB.");
    openPlan(JSON.parse(await file.text()));
    $("#run-status").textContent =
      "Plan imported. Image selections stay specific to this browser.";
  } catch (e) {
    $("#run-status").textContent = e.message;
  } finally {
    e.target.value = "";
  }
};
$("#save-run").onclick = async (e) => {
  e.target.disabled = true;
  try {
    const rows = await cloud.projects();
    if (!rows.length) throw new Error("Create a project in My projects first.");
    let select = $("#cloud-project");
    if (!select) {
      const label = make("label", "", "Save to project");
      select = make("select");
      select.id = "cloud-project";
      for (const p of rows) {
        const o = make("option", "", p.name);
        o.value = p.id;
        select.append(o);
      }
      label.append(select);
      $("#run-status").before(label);
      $("#run-status").textContent =
        "Choose a project, then press Save plan again.";
      return;
    }
    await cloud.cloudRequest("/rest/v1/massless_workflow_runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workflow_id: plan.workflowId,
        project_id: select.value,
        state: plan,
      }),
    });
    $("#run-status").textContent =
      "Plan saved privately. Local image files were not uploaded.";
  } catch (e) {
    $("#run-status").textContent = e.message + " Open My projects to sign in.";
  } finally {
    e.target.disabled = false;
  }
};
try {
  const runId = new URLSearchParams(location.search).get("run");
  if (runId) {
    if (!/^[0-9a-f-]{36}$/.test(runId))
      throw new Error("Invalid saved workflow.");
    const rows = await cloud.workflowRun(runId);
    if (!rows[0])
      throw new Error("This workflow is not available to your account.");
    openPlan(rows[0].state);
  } else {
    const saved = localStorage.getItem(KEY);
    if (saved) openPlan(JSON.parse(saved), false);
  }
} catch (e) {
  openPlan(
    {
      version: 1,
      workflowId: WORKFLOWS[0].id,
      brief: "",
      shotId: "",
      done: WORKFLOWS[0].steps.map(() => false),
    },
    false,
  );
  $("#run-status").textContent = e.message;
}
const presets = await fetch("/workflows/presets/index.json")
  .then((r) => r.json())
  .catch(() => []);
for (const preset of presets) {
  const card = make("article", "hub-card"),
    art = make("div", "preset-stages", preset.name.toUpperCase()),
    body = make("div", "hub-card-body"),
    actions = make("div", "hub-actions");
  const a = make("a", "btn-ghost", "Download workflow");
  a.href = "/comfy/vfx4all/" + preset.id + ".json";
  a.download = preset.id + ".json";
  actions.append(a);
  if (preset.comfy_app) {
    const launch = make("a", "btn-accent", "Open Comfy app ↗");
    launch.href = preset.comfy_app;
    launch.target = "_blank";
    launch.rel = "noopener";
    actions.append(launch);
  }
  body.append(
    make("small", "eyebrow", "COMFYUI / " + preset.category),
    make("h3", "", preset.name),
    make("p", "", preset.description),
    make("small", "", "LTX 2.5 + Qwen Image Edit · separate setup required"),
    actions,
  );
  card.id = "preset-" + preset.id;
  if (["liquid-chrome", "walk-of-fire", "zero-gravity"].includes(preset.id)) {
    const image = make("img");
    image.src =
      "/media/workflows/" +
      {
        "liquid-chrome": "moss-chrome-poster.jpg",
        "walk-of-fire": "moss-fire.jpg",
        "zero-gravity": "moss-gravity.jpg",
      }[preset.id];
    image.alt = preset.name + " concept still generated with MOSS Image";
    art.replaceChildren(image);
    art.classList.add("preset-image");
    body.append(
      make(
        "small",
        "",
        "Concept artwork: MOSS Image · the Comfy workflow creates the effect video.",
      ),
    );
  }
  card.append(art, body);
  $("#preset-cards").append(card);
}

createPreviewMotion({ videos: document.querySelectorAll("video[data-src]") });

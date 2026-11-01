import * as cloud from "../cloud.js";
import { all } from "../store.js";
const $ = (s) => document.querySelector(s);
const message = (s, target = "#cloud-status") => ($(target).textContent = s);
const option = (name, value) => {
  const o = document.createElement("option");
  o.textContent = name;
  o.value = value;
  return o;
};
let local = [];
async function refreshAssets() {
  const area = $("#asset-list");
  area.replaceChildren();
  if (!$("#project-list").value) return;
  for (const item of await cloud.assets($("#project-list").value)) {
    const card = document.createElement("article");
    card.className = "hub-card";
    const body = document.createElement("div");
    body.className = "hub-card-body";
    const title = document.createElement("h3");
    title.textContent = item.name;
    const kind = document.createElement("p");
    kind.textContent = item.kind;
    const button = document.createElement("button");
    button.className = "btn-ghost";
    button.textContent = "Download private file ↓";
    button.onclick = async () => {
      button.disabled = true;
      try {
        const url = await cloud.assetURL(item.object_path);
        const response = await fetch(url);
        if (!response.ok)
          throw new Error("The private file could not be downloaded.");
        const blob = await response.blob(),
          objectURL = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectURL;
        a.download = item.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
      } catch (e) {
        message(e.message, "#project-status");
      } finally {
        button.disabled = false;
      }
    };
    body.append(title, kind, button);
    card.append(body);
    area.append(card);
  }
  for (const run of await cloud.workflowRuns($("#project-list").value)) {
    const card = document.createElement("article");
    card.className = "hub-card";
    const body = document.createElement("div");
    body.className = "hub-card-body";
    const title = document.createElement("h3");
    title.textContent = run.workflow_id.replaceAll("-", " ");
    const a = document.createElement("a");
    a.className = "btn-ghost";
    a.href = "/workflows/?run=" + run.id;
    a.textContent = "Continue workflow ↗";
    body.append(title, a);
    card.append(body);
    area.append(card);
  }
}
async function refresh() {
  const signed = !!cloud.session();
  $("#auth-form").hidden = signed;
  $("#signout").hidden = !signed;
  $("#workspace").hidden = !signed;
  if (!signed) {
    message("Sign in to save private projects.");
    return;
  }
  message("Signed in as " + cloud.session().user.email);
  const rows = await cloud.projects();
  const selected = $("#project-list").value;
  $("#project-list").replaceChildren(...rows.map((x) => option(x.name, x.id)));
  if (rows.some((x) => x.id === selected)) $("#project-list").value = selected;
  local = (await all().catch(() => [])).filter((x) =>
    x.blob?.type.startsWith("image/"),
  );
  $("#local-list").replaceChildren(
    option("Choose a saved image", ""),
    ...local.map((x) => option(x.prompt?.slice(0, 70) || "Saved image", x.id)),
  );
  await refreshAssets();
}
async function action(fn) {
  for (const b of document.querySelectorAll("#account button"))
    b.disabled = true;
  try {
    await fn();
  } catch (e) {
    message(e.message);
  } finally {
    for (const b of document.querySelectorAll("#account button"))
      b.disabled = false;
  }
}
// Pages that sent a visitor here to sign in (e.g. Video's prompt bar) get them back afterwards.
function returnAfterSignIn() {
  let next = "";
  try { next = sessionStorage.getItem("chucksi.after-signin") || ""; sessionStorage.removeItem("chucksi.after-signin"); } catch { /* private mode */ }
  if (/^\/[a-z0-9/_-]*$/i.test(next) && !next.startsWith("//") && next !== "/projects/") { location.href = next; return true; }
  return false;
}
for (const b of document.querySelectorAll("#auth-form .oauth"))
  b.onclick = () => action(() => cloud.signInWithProvider(b.dataset.provider));
$("#auth-form").onsubmit = (e) => {
  e.preventDefault();
  action(async () => {
    await cloud.signIn($("#email").value.trim(), $("#password").value);
    if (returnAfterSignIn()) return;
    $("#password").value = "";
    await refresh();
  });
};
$("#signup").onclick = () => {
  if (!$("#auth-form").reportValidity()) return;
  action(async () => {
    const result = await cloud.signUp(
      $("#email").value.trim(),
      $("#password").value,
    );
    $("#password").value = "";
    if (result.access_token) await refresh();
    else
      message(
        "Check your email to confirm your account, then return here to sign in.",
      );
  });
};
$("#signout").onclick = () =>
  action(async () => {
    await cloud.signOut();
    await refresh();
  });
$("#new-project").onsubmit = async (e) => {
  e.preventDefault();
  const b = e.submitter;
  b.disabled = true;
  try {
    const result = await cloud.createProject($("#project-name").value.trim());
    $("#project-name").value = "";
    await refresh();
    $("#project-list").value = result[0].id;
    await refreshAssets();
    message("Project ready.", "#project-status");
  } catch (e) {
    message(e.message, "#project-status");
  } finally {
    b.disabled = false;
  }
};
$("#project-list").onchange = () =>
  refreshAssets().catch((e) => message(e.message, "#project-status"));
async function upload(file) {
  const project = $("#project-list").value;
  if (!project) throw new Error("Create or choose a project first.");
  message("Saving your file…", "#project-status");
  await cloud.uploadAsset(project, file);
  await refreshAssets();
  message("Saved privately.", "#project-status");
}
$("#upload").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.disabled = true;
  try {
    await upload(file);
  } catch (e) {
    message(e.message, "#project-status");
  } finally {
    e.target.disabled = false;
    e.target.value = "";
  }
};
$("#upload-local").onclick = async (e) => {
  e.target.disabled = true;
  try {
    const item = local.find((x) => x.id === $("#local-list").value);
    if (!item) throw new Error("Choose a saved image.");
    await upload(
      new File([item.blob], item.id + ".jpg", { type: item.blob.type }),
    );
  } catch (e) {
    message(e.message, "#project-status");
  } finally {
    e.target.disabled = false;
  }
};
try {
  const c = await cloud.cloudConfig();
  if (!c.cloud)
    message("Cloud projects are being connected. Your local tools are ready.");
  else {
    // back from Google/GitHub or an email confirmation link
    let back = false;
    try {
      back = await cloud.completeRedirect();
    } catch (err) {
      message(err.message);
    }
    await refresh();
    const on = await cloud.enabledProviders();
    for (const b of document.querySelectorAll("#auth-form .oauth")) b.hidden = !on.includes(b.dataset.provider);
    document.querySelector("#auth-form .oauth-buttons").hidden = !on.length;
    document.querySelector("#auth-form .oauth-or").hidden = !on.length;
    if (back && !returnAfterSignIn()) message("Signed in as " + (cloud.session()?.user?.email || "you") + ". Welcome to Chucksi.");
  }
} catch (e) {
  message(e.message);
}

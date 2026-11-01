import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal browser stand-ins for public/js/cloud.js
function setup(hash, userOk = true) {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  globalThis.window = { dispatchEvent() {} };
  globalThis.Event = class { constructor(t) { this.type = t; } };
  const replaced = [];
  globalThis.history = { replaceState: (_s, _t, url) => replaced.push(url) };
  globalThis.location = { hash, pathname: "/projects/", search: "", origin: "https://chucksi.com", href: "" };
  globalThis.fetch = async (url, init) => {
    if (url === "/api/config") return { ok: true, json: async () => ({ cloud: true, supabaseUrl: "https://x.supabase.co", publishableKey: "pk" }) };
    if (url.endsWith("/auth/v1/user")) {
      assert.equal(init.headers.Authorization, "Bearer AT");
      return { ok: userOk, json: async () => ({ id: "u1", email: "a@b.c" }) };
    }
    throw new Error("unexpected " + url);
  };
  return { store, replaced };
}

test("Google/GitHub return: tokens in the fragment become a session with the user, and the URL is tidied", async () => {
  const { store, replaced } = setup("#access_token=AT&refresh_token=RT&expires_in=3600&token_type=bearer");
  const cloud = await import("../public/js/cloud.js?" + Math.random());
  assert.equal(await cloud.completeRedirect(), true);
  const s = cloud.session();
  assert.equal(s.access_token, "AT");
  assert.equal(s.refresh_token, "RT");
  assert.equal(s.user.email, "a@b.c");
  assert.ok(s.expires_at > Date.now() / 1000);
  assert.deepEqual(replaced, ["/projects/"]);
  assert.ok(store.size === 1);
});

test("an error in the fragment is shown and nothing is stored", async () => {
  const { store } = setup("#error=access_denied&error_description=User+cancelled");
  const cloud = await import("../public/js/cloud.js?" + Math.random());
  await assert.rejects(cloud.completeRedirect(), /User cancelled/);
  assert.equal(store.size, 0);
});

test("no fragment: nothing happens", async () => {
  setup("");
  const cloud = await import("../public/js/cloud.js?" + Math.random());
  assert.equal(await cloud.completeRedirect(), false);
});

test("sign-in goes to Supabase authorize with the provider and a return address", async () => {
  setup("");
  const cloud = await import("../public/js/cloud.js?" + Math.random());
  await cloud.signInWithProvider("github");
  assert.equal(location.href, "https://x.supabase.co/auth/v1/authorize?provider=github&redirect_to=" + encodeURIComponent("https://chucksi.com/projects/"));
  await assert.rejects(cloud.signInWithProvider("myspace"), /Unknown/);
});

test("only providers switched on in Supabase get a button", async () => {
  setup("");
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url.endsWith("/auth/v1/settings")) {
      assert.equal(init.headers.apikey, "pk");
      return { ok: true, json: async () => ({ external: { google: true, github: false, email: true } }) };
    }
    return base(url, init);
  };
  const cloud = await import("../public/js/cloud.js?" + Math.random());
  assert.deepEqual(await cloud.enabledProviders(), ["google"]);
});

test("provider check fails closed when Supabase can't be reached", async () => {
  setup("");
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => (url.endsWith("/auth/v1/settings") ? Promise.reject(new Error("offline")) : base(url, init));
  const cloud = await import("../public/js/cloud.js?" + Math.random());
  assert.deepEqual(await cloud.enabledProviders(), []);
});

test("LinkedIn, X and Facebook are offered when switched on, and unknown providers are refused", async () => {
  setup("");
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) =>
    url.endsWith("/auth/v1/settings")
      ? { ok: true, json: async () => ({ external: { google: true, github: true, linkedin_oidc: true, twitter: true, facebook: true, linkedin: true } }) }
      : base(url, init);
  const cloud = await import("../public/js/cloud.js?" + Math.random());
  assert.deepEqual(await cloud.enabledProviders(), ["google", "github", "linkedin_oidc", "twitter", "facebook"]);
  await cloud.signInWithProvider("facebook");
  assert.match(location.href, /authorize\?provider=facebook&redirect_to=/);
  await assert.rejects(cloud.signInWithProvider("myspace"), /Unknown sign-in provider/);
});

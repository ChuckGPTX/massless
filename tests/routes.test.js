import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../src/index.js";

test("new studio routes serve real pages and pin their scripts and styles", async () => {
  const originalFetch = globalThis.fetch,
    originalCaches = globalThis.caches;
  const sha = "a".repeat(40),
    pending = [];
  globalThis.caches = {
    default: { match: async () => undefined, put: async () => {} },
  };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.split("/public/")[1];
    try {
      return new Response(
        await readFile(new URL(`../public/${path}`, import.meta.url)),
      );
    } catch {
      return new Response("missing", { status: 404 });
    }
  };
  try {
    for (const route of [
      "/",
      "/music",
      "/music/",
      "/music/index.html",
      "/demo-site",
      "/demo-site/",
      "/demo-site/index.html",
      ...["image", "video", "audio", "3d", "office"].flatMap((id) => [
        `/studios/${id}`,
        `/studios/${id}/`,
        `/studios/${id}/index.html`,
      ]),
    ]) {
      const response = await worker.fetch(
        new Request(`https://massless.test${route}`),
        { ASSET_REF: sha },
        { waitUntil: (p) => pending.push(p) },
      );
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type"), /text\/html/);
      const html = await response.text();
      assert.ok(
        html.includes(`/v/${sha}/`),
        `versioned dependencies: ${route}`,
      );
      assert.match(html, /Music, made visible|FORM|studio|STUDIO/);
      if (route === "/" || route.startsWith("/studios/image")) {
        assert.ok(
          html.includes('href="/demo-site/"'),
          "page links remain navigable",
        );
        assert.ok(
          !html.includes(`href="/v/${sha}/demo-site/"`),
          "do not pin directory navigation",
        );
      }
      if (route.startsWith("/demo-site")) {
        assert.ok(html.includes(`href="/v/${sha}/demo-site/style.css"`));
        assert.ok(html.includes(`src="/v/${sha}/demo-site/studio.js"`));
      }
    }
    const head = await worker.fetch(
      new Request("https://massless.test/music/", { method: "HEAD" }),
      { ASSET_REF: sha },
      { waitUntil: (p) => pending.push(p) },
    );
    assert.equal(await head.text(), "");
    await Promise.all(pending);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});

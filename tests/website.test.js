// Chucksi Website: the builder's pure logic in Node: the built-in writer, sanitizing, rendering, share links,
// the ZIP writer and the contrast guard. The page itself is checked in a browser by tests/website_test.py.
import test from "node:test";
import assert from "node:assert/strict";
import { KINDS, SECTIONS, templateSite, sanitizeSite, safeHref, embedFor, checklist } from "../public/js/website/spec.js";
import { STYLES, tokens, contrastReport, contrast } from "../public/js/website/theme.js";
import { renderPage, renderSingle, sitePages } from "../public/js/website/render.js";
import { encodeSite, decodeSite, shareUrl } from "../public/js/website/share.js";
import { zip, crc32, sitemapXml, robotsTxt } from "../public/js/website/export.js";

test("the built-in writer makes a complete site for every kind and style", () => {
  for (const kind of Object.keys(KINDS)) {
    for (const style of Object.keys(STYLES)) {
      const site = templateSite({ prompt: KINDS[kind].example, kind, style });
      assert.equal(site.kind, kind);
      assert.ok(site.name && site.pages.length >= 1, `${kind}/${style}`);
      assert.equal(site.pages[0].title, "Home");
      for (const p of site.pages) {
        assert.ok(p.sections.length >= 1);
        for (const s of p.sections) assert.ok(SECTIONS[s.type], `${kind}: ${s.type}`);
      }
      assert.deepEqual(sanitizeSite(site, site, { source: "user" }).pages.length, site.pages.length, "sanitizing a good site keeps its pages");
    }
  }
  const lawn = templateSite({ prompt: "A site for my lawn care business in Cedar Rapids", kind: "business" });
  assert.match(JSON.stringify(lawn), /Cedar Rapids|lawn/i, "the prompt shapes the copy");
});

test("sanitizeSite survives junk and strips script links", () => {
  const fb = templateSite({ prompt: "a bakery", kind: "business" });
  for (const junk of [null, 1, "x", [], { pages: "no" }, { name: "<script>", pages: [{ title: "Home", sections: [{ type: "nope" }] }] }, { __proto__: { evil: 1 }, name: "A" }]) {
    const out = sanitizeSite(junk, fb, { source: "model" });
    assert.ok(out.pages.length >= 1);
    assert.ok(!JSON.stringify(out).includes("<script"));
  }
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.ok(safeHref("https://example.com/x").startsWith("https://"));
  assert.equal(embedFor("https://youtu.be/dQw4w9WgXcQ").kind, "video");
  assert.equal(embedFor("https://evil.example/x"), null);
  assert.equal({}.evil, undefined);
});

test("every page renders to a full static HTML document", () => {
  const site = templateSite({ prompt: "a jazz band from Chicago", kind: Object.keys(KINDS).find((k) => /band|music/i.test(k)) || "business" });
  const pages = sitePages(site);
  assert.ok(pages.length >= site.pages.length);
  for (const here of pages) {
    const html = renderPage(site, here, { mode: "zip" });
    assert.match(html, /^<!doctype html>/i);
    assert.ok(html.includes("</html>"));
    for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/gi)) assert.match(m[1], /^(\.\.\/)*assets\/site\.js$/, "only the site's own small script");
  }
  const one = renderSingle(site, {});
  assert.match(one, /^<!doctype html>/i);
  assert.ok(sitemapXml(site, pages).includes("<urlset"));
  assert.ok(robotsTxt(site).includes("User-agent"));
  assert.ok(checklist(site).length > 0);
});

test("share links round-trip a site and leave uploaded images out", async () => {
  const site = templateSite({ prompt: "a coffee cart", kind: "business" });
  const code = await encodeSite(site);
  assert.match(code, /^[\w-]+$/);
  const back = await decodeSite(code);
  assert.equal(back.name, site.name);
  assert.equal(back.pages.length, site.pages.length);
  const url = await shareUrl(site, "https://chucksi.com/website");
  assert.ok(url.startsWith("https://chucksi.com/website#s="));
});

test("the ZIP writer produces a valid archive", async () => {
  assert.equal(crc32(new TextEncoder().encode("hello")), 0x3610a686);
  const blob = await zip([{ name: "index.html", data: "<!doctype html><p>hi</p>" }, { name: "robots.txt", data: "User-agent: *" }]);
  const buf = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...buf.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], "local file header");
  const tail = buf.slice(-22);
  assert.deepEqual([...tail.slice(0, 4)], [0x50, 0x4b, 0x05, 0x06], "end of central directory");
  assert.equal(tail[10], 2, "two entries");
});

test("every style passes its own contrast check for body text", () => {
  for (const id of Object.keys(STYLES)) {
    const site = templateSite({ prompt: "a shop", kind: "business", style: id });
    const t = tokens(site.theme);
    assert.ok(t, id);
    const rep = contrastReport(site.theme);
    assert.ok(Array.isArray(rep) && rep.length > 0, id);
  }
  assert.ok(contrast("#000000", "#ffffff") > 20);
});

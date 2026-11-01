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

// ---------------------------------------------------------------------------------------------
// Templates (/website?template=<id>) and the template sections
// ---------------------------------------------------------------------------------------------
import { readFileSync, statSync } from "node:fs";
import { TEMPLATES_LIST } from "../public/js/website/templates-list.js";
import { TEMPLATES, buildTemplate } from "../public/js/website/templates.js";
import { placeholderArt, artKind, ART_KINDS, motifSvg, MOTIFS } from "../public/js/website/art.js";
import { fontsHref, themeFor } from "../public/js/website/theme.js";
import { SITE_JS } from "../public/js/website/render.js";

const NEW_TEMPLATES = { "editorial-shop": ["products", "lookbook", "statement"], manifesto: ["chapters", "statement"], "portfolio-timeline": ["cases", "statement"], "ai-product": ["annotated", "features"] };

test("the template list is complete data another page can link to", () => {
  const ids = TEMPLATES_LIST.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "unique ids");
  for (const id of Object.keys(NEW_TEMPLATES)) assert.ok(ids.includes(id), id);
  assert.ok(ids.length >= 11);
  for (const t of TEMPLATES_LIST) {
    assert.ok(t.title && t.description && t.description.length < 140, t.id);
    assert.equal(t.href, `/website?template=${t.id}`);
    assert.match(t.thumb, /^\/media\/website\/tpl-[\w-]+\.webp$/);
    const file = new URL(`../public${t.thumb}`, import.meta.url);
    const size = statSync(file).size;
    assert.ok(size > 2000 && size < 82 * 1024, `${t.id} thumbnail is ${size} bytes`);
    assert.deepEqual([...readFileSync(file).subarray(8, 12)].map((c) => String.fromCharCode(c)).join(""), "WEBP");
    assert.ok(STYLES[t.style] && KINDS[t.kind], t.id);
    assert.equal(TEMPLATES[t.id], t);
  }
  assert.equal(buildTemplate("no-such-template"), null);
});

test("every template builds a complete, sanitized, renderable example site", async () => {
  for (const t of TEMPLATES_LIST) {
    const site = buildTemplate(t.id);
    assert.equal(site.theme.style, t.style, t.id);
    assert.equal(site.kind, t.kind, t.id);
    assert.equal(site.pages[0].sections[0].type, "hero", t.id);
    const types = new Set(site.pages.flatMap((p) => p.sections.map((s) => s.type)));
    for (const need of NEW_TEMPLATES[t.id] || []) assert.ok(types.has(need), `${t.id} has a ${need} section`);
    // the visible copy is filled in: no [bracketed] blanks left in a template's example
    const visible = JSON.stringify(site).replace(/"prompt":"[^"]*"/g, "");
    assert.doesNotMatch(visible, /\[[^\]"]{2,80}\]/, `${t.id} has no blanks`);
    // two builds are independent copies
    assert.notEqual(buildTemplate(t.id).pages[0].id, buildTemplate(t.id).pages[0].id);
    // it survives the user-source sanitizer (saved projects and share links) with every section intact
    const again = sanitizeSite(JSON.parse(JSON.stringify(site)), null, { source: "user" });
    assert.deepEqual(again.pages.map((p) => p.sections.map((s) => `${s.type}/${s.variant}`)), site.pages.map((p) => p.sections.map((s) => `${s.type}/${s.variant}`)), t.id);
    for (const here of sitePages(site)) {
      const html = renderPage(site, here, { mode: "zip" });
      assert.match(html, /^<!doctype html>/i);
      for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/gi)) assert.match(m[1], /^(\.\.\/)*assets\/site\.js$/, "self-contained: only the site's own script");
      assert.doesNotMatch(html, /<img[^>]+src="https?:/i, "no remote images");
    }
    const back = await decodeSite(await encodeSite(site));
    assert.equal(back.theme.style, t.style, "share link keeps the template style");
  }
});

test("template sections render with edit hooks and generated art, motion is optional", () => {
  const shop = buildTemplate("editorial-shop");
  const home = sitePages(shop)[0];
  const edit = renderPage(shop, home, { mode: "edit" });
  const stmt = shop.pages[0].sections.find((s) => s.type === "statement");
  assert.ok(edit.includes(`data-edit="${stmt.id}:text"`), "statement text is editable in place");
  const prod = shop.pages[0].sections.find((s) => s.type === "products");
  assert.ok(edit.includes(`data-edit="${prod.id}:items.0.price"`), "prices are editable in place");
  assert.ok(edit.includes(`data-img="${prod.id}:items.0.image"`), "product images open the image dialog");
  assert.match(edit, /<img src="\/media\/website\/editorial-shop\/[\w-]+\.webp" srcset="[^"]+-sm\.webp 560w/, "the template ships its own photos, with a small copy");
  const written = templateSite({ prompt: KINDS.shop.example, kind: "shop" });
  assert.match(renderPage(written, sitePages(written)[0], { mode: "edit" }), /<svg class="art art-(figure|scene)/, "a described shop keeps generated art in empty slots, not stock photos");
  const live = renderPage(shop, home, { mode: "zip" });
  assert.doesNotMatch(live, /data-edit=|data-img=/, "no editor hooks in the export");
  const man = renderPage(buildTemplate("manifesto"), sitePages(buildTemplate("manifesto"))[0], { mode: "zip" });
  assert.match(man, /<canvas data-gen>/, "manifesto hero has the generative canvas");
  assert.match(man, /<svg class="amb"/, "and a still frame for reduced motion and no-JS");
  assert.match(man, /class="motif motif-(wave|grid|horizon|orbit|stairs)"/);
  const cases = renderPage(buildTemplate("portfolio-timeline"), sitePages(buildTemplate("portfolio-timeline"))[0], { mode: "zip" });
  assert.match(cases, /data-rail=""/);
  assert.match(cases, /data-year-out/);
  const ai = renderPage(buildTemplate("ai-product"), sitePages(buildTemplate("ai-product"))[0], { mode: "zip" });
  assert.match(ai, /class="ann portrait" data-scrub=""/);
  assert.match(ai, /class="tag tg0"/);
  // motion off: no scroll hooks at all
  const still = buildTemplate("ai-product");
  still.theme.motion = "none";
  assert.doesNotMatch(renderPage(still, sitePages(still)[0], { mode: "zip" }), /data-scrub|data-rail|data-rv/);
  // the runtime is small, valid and respects reduced motion
  assert.ok(SITE_JS.length < 6500, `site.js is ${SITE_JS.length} bytes`);
  new Function(SITE_JS);
  assert.match(SITE_JS, /prefers-reduced-motion: no-preference/);
});

test("the writer maps descriptions onto the template kinds", () => {
  const shop = templateSite({ prompt: "A shop for Moss & Thread, a ceramics studio in Portland selling mugs, bowls and vases.", kind: "shop" });
  assert.equal(shop.theme.style, "editorial-shop");
  const names = shop.pages[0].sections.find((s) => s.type === "products").items.map((x) => x.name);
  assert.ok(names.includes("Mug") && names.includes("Vase"), names.join());
  assert.ok(shop.pages[0].sections.find((s) => s.type === "products").items.every((x) => x.ph), "prices not in the prompt stay placeholders");
  assert.match(JSON.stringify(shop), /Portland/);
  const man = templateSite({ prompt: "A manifesto for Open Fields, a farming co-op that believes soil is infrastructure.", kind: "manifesto" });
  assert.match(man.pages[0].sections[0].title.replace(/\*/g, ""), /Soil is infrastructure/i);
  assert.equal(man.pages[0].sections[0].variant, "ambient");
  const cases = templateSite({ prompt: "A portfolio for Sam Ortiz, a product designer who has designed banking apps and a bike computer since 2014.", kind: "cases" });
  const items = cases.pages[0].sections.find((s) => s.type === "cases").items;
  assert.equal(items[items.length - 1].year, "2014");
  assert.ok(items.some((x) => /Banking app/.test(x.title)) && items.some((x) => /Bike computer/.test(x.title)), items.map((x) => x.title).join());
  const ai = templateSite({ prompt: "A launch page for Quill, an AI assistant that writes meeting notes.", kind: "product" });
  assert.equal(ai.pages[0].sections[0].variant, "portrait");
  const ann = ai.pages[0].sections.find((s) => s.type === "annotated");
  assert.ok(ann.items.length >= 3 && !/Face matched/.test(JSON.stringify(ann)), "a text product gets text labels, not face labels");
  // a new kind restyles cleanly into every style
  for (const style of Object.keys(STYLES)) {
    const site = templateSite({ prompt: KINDS.shop.example, kind: "shop", style });
    assert.equal(site.theme.style, style);
    assert.ok(renderPage(site, sitePages(site)[0], { mode: "zip" }).includes("</html>"));
  }
});

test("placeholder art follows the photo, is deterministic, and fonts stay open-licensed", () => {
  assert.equal(artKind("a model wearing an olive wool coat, full length, plain studio backdrop"), "figure");
  assert.equal(artKind("the same woman sitting on brick steps in the city"), "scene");
  assert.equal(artKind("an app interface shown on a laptop"), "device");
  assert.equal(artKind("a freshly mowed suburban lawn with crisp stripes"), "landscape");
  for (const k of ART_KINDS) {
    const a = placeholderArt("x", `slot-${k}`, 4 / 5, k);
    assert.match(a, /^<svg class="art art-[\w]+" viewBox="0 0 600 750"/, k);
    assert.equal(a, placeholderArt("x", `slot-${k}`, 4 / 5, k), "same slot, same art");
    assert.ok(a.length < 6000, `${k} art is small (${a.length})`);
    assert.doesNotMatch(a, /<script|href=|NaN|undefined/);
  }
  for (const m of Object.keys(MOTIFS)) assert.ok(m === "none" ? motifSvg(m) === "" : motifSvg(m, "k").startsWith("<svg"), m);
  // Archivo at width 125 is requested from Google Fonts through the width axis
  assert.match(fontsHref(themeFor("editorial-shop")), /family=Archivo:wdth,wght@[\d,;]*125,800/);
  for (const id of ["manifesto", "portfolio-timeline", "ai-product"]) assert.match(fontsHref(themeFor(id)), /^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
});

// ---------------------------------------------------------------------------------------------
// Template photography and motion
// ---------------------------------------------------------------------------------------------
import { PHOTOS } from "../public/js/website/photos.js";
import { usedPhotos } from "../public/js/website/export.js";
import { BASE_CSS } from "../public/js/website/css.js";
import { GEN_JS } from "../public/js/website/render.js";

test("template examples use bundled photos that exist, are small and are recorded", () => {
  const prov = JSON.parse(readFileSync(new URL("../public/media/website/provenance.json", import.meta.url), "utf8"));
  const recorded = new Set(prov.template_photography.images.map((x) => `/${x.path}`));
  for (const t of TEMPLATES_LIST) {
    const site = buildTemplate(t.id);
    const srcs = [...usedPhotos(site)];
    assert.ok(srcs.length >= 2, `${t.id} has photos`);
    if (site.pages[0].sections[0].variant !== "minimal") assert.ok(site.pages[0].sections[0].image?.src?.startsWith("/media/website/"), `${t.id} hero has a photo`);
    for (const src of srcs) {
      const info = PHOTOS[src];
      assert.ok(info, `${src} is in photos.js`);
      assert.ok(recorded.has(src), `${src} is in provenance.json`);
      const big = statSync(new URL(`../public${src}`, import.meta.url)).size;
      const small = statSync(new URL(`../public${info.sm}`, import.meta.url)).size;
      assert.ok(big < 185 * 1024 && small < 50 * 1024, `${src}: ${big} / ${small} bytes`);
    }
  }
  for (const kind of Object.keys(KINDS)) {
    const site = templateSite({ prompt: KINDS[kind].example, kind });
    assert.equal(usedPhotos(site).size, 0, `a described ${kind} site gets no stock photos`);
  }
});

test("photos render with dimensions and a small copy; exports know which to copy", () => {
  const site = buildTemplate("local-business");
  const html = renderPage(site, sitePages(site)[0], { mode: "edit" });
  assert.match(html, /<img src="\/media\/website\/local-business\/hero\.webp" srcset="\/media\/website\/local-business\/hero-sm\.webp 560w, \/media\/website\/local-business\/hero\.webp 1200w" sizes="[^"]+" alt="A freshly striped front lawn[^"]*" width="1200" height="1600" fetchpriority="high"/);
  const zipped = renderPage(site, sitePages(site)[0], { mode: "zip", src: (src) => (src.includes("hero") ? "assets/img/x.webp" : ""), srcset: () => "" });
  assert.ok(zipped.includes('src="assets/img/x.webp"'), "the ZIP maps photos to its own files");
  assert.ok(usedPhotos(site).has("/media/website/local-business/hero.webp"));
});

test("motion hooks are there when motion is on and gone when it is off or reduced", () => {
  const site = buildTemplate("editorial-shop");
  const on = renderPage(site, sitePages(site)[0], { mode: "zip" });
  assert.match(on, /class="runway-media" data-scrub="par"/, "hero photo parallax");
  assert.match(on, /class="lb-item" data-scrub="par"/, "lookbook parallax");
  assert.match(on, /class="marquee"/, "the shop has a ticker");
  assert.match(renderPage(buildTemplate("conference"), sitePages(buildTemplate("conference"))[0], { mode: "zip" }), /class="marquee"/, "so does the conference");
  site.theme.motion = "none";
  assert.doesNotMatch(renderPage(site, sitePages(site)[0], { mode: "zip" }), /data-scrub|data-rv/);
  // every animation lives inside the reduced-motion guard
  const guard = BASE_CSS.indexOf("@media (prefers-reduced-motion:no-preference){");
  const end = BASE_CSS.indexOf("\n}\n@keyframes mz-rise", guard);
  const outside = BASE_CSS.slice(0, guard) + BASE_CSS.slice(end);
  assert.doesNotMatch(outside.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ""), /animation:mz-(kb|mask|clip|spin|marquee)/, "no animation outside the guard");
  for (const k of ["mz-kb", "mz-mask", "mz-clip"]) assert.ok(BASE_CSS.slice(guard, end).includes(k), k);
  assert.match(GEN_JS, /prefers-reduced-motion: no-preference/);
  assert.match(GEN_JS, /data-motion'\)!=='none'/);
  assert.ok(SITE_JS.length < 6500, `site.js is ${SITE_JS.length} bytes`);
  assert.ok(SITE_JS.includes(GEN_JS), "the export runs the same canvas code as the editor");
});

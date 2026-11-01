// Every public page carries one consistent share block (Open Graph + Twitter + canonical), so links show the
// same Chucksi share image in iMessage, WhatsApp, X, Facebook, LinkedIn and Slack.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../public/", import.meta.url).pathname;
const IMAGE = "https://chucksi.com/og.jpg?v=4";
const ALT = "Chucksi. Your marketing super intelligence: video, images, websites, brand kits, games and sign.";

function pages(dir = ROOT) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "comfy" ? [] : pages(p);
    return name.endsWith(".html") ? [p] : [];
  });
}
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
function metas(html) {
  const head = html.split(/<\/head>/i)[0];
  const out = {};
  for (const m of head.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)) {
    (out[m[1]] ||= []).push(unescape(m[2]));
  }
  const canonical = [...head.matchAll(/<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?>/g)].map((m) => m[1]);
  return { tags: out, canonical };
}

const list = pages();

test("every public page is covered", () => {
  assert.ok(list.length >= 28, `found ${list.length} pages`);
});

for (const file of list) {
  const name = relative(ROOT, file);
  test(`share tags: ${name}`, () => {
    const { tags, canonical } = metas(readFileSync(file, "utf8"));
    const one = (k) => {
      assert.equal(tags[k]?.length, 1, `${name}: exactly one ${k}`);
      return tags[k][0];
    };
    assert.equal(one("og:type"), "website");
    assert.equal(one("og:site_name"), "Chucksi");
    const url = one("og:url");
    assert.match(url, /^https:\/\/chucksi\.com\//, `${name}: og:url is on chucksi.com`);
    assert.equal(canonical.length, 1, `${name}: one canonical link`);
    assert.equal(canonical[0], url, `${name}: canonical matches og:url`);
    for (const k of ["og:title", "og:description", "twitter:title", "twitter:description", "description"]) {
      const v = one(k);
      assert.ok(v.trim().length > 3 && v.length <= 200, `${name}: ${k} is short and present`);
      assert.doesNotMatch(v, /GPU|open[- ]weight|Cloudflare|FLUX|Llama|Whisper|\$0/i, `${name}: ${k} is plain language`);
    }
    assert.equal(one("og:image"), IMAGE);
    assert.equal(one("og:image:width"), "1200");
    assert.equal(one("og:image:height"), "630");
    assert.equal(one("og:image:type"), "image/jpeg");
    assert.equal(one("og:image:alt"), ALT);
    assert.equal(one("twitter:card"), "summary_large_image");
    assert.equal(one("twitter:image"), IMAGE);
  });
}

test("the share image is a 1200 x 630 JPEG", () => {
  const b = readFileSync(join(ROOT, "og.jpg"));
  assert.equal(b[0], 0xff);
  assert.equal(b[1], 0xd8);
  // walk the JPEG markers to the first frame header
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      assert.equal(b.readUInt16BE(i + 5), 630);
      assert.equal(b.readUInt16BE(i + 7), 1200);
      return;
    }
    i += 2 + len;
  }
  assert.fail("no frame header");
});

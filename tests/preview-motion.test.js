import test from "node:test";
import assert from "node:assert/strict";
import { createPreviewMotion } from "../public/js/preview-motion.js";
function setup({ reduced = false, saveData = false } = {}) {
  const pref = new EventTarget();
  pref.matches = reduced;
  const connection = new EventTarget();
  connection.saveData = saveData;
  const document = new EventTarget();
  document.hidden = false;
  const button = new EventTarget();
  button.setAttribute = (key, value) => (button[key] = value);
  const root = { classList: { toggle() {} } };
  const videos = [0, 1].map(() => ({
    dataset: { src: "clip.mp4" },
    src: "",
    paused: true,
    plays: 0,
    getAttribute() {
      return this.src;
    },
    play() {
      this.paused = false;
      this.plays++;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
    },
  }));
  let observe;
  globalThis.matchMedia = () => pref;
  globalThis.document = document;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { connection },
  });
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      observe = callback;
    }
    observe() {}
  };
  let suspended = false;
  const control = createPreviewMotion({
    videos,
    button,
    root,
    isSuspended: () => suspended,
  });
  const visible = (i, on) =>
    observe([
      { target: videos[i], isIntersecting: on, intersectionRatio: on ? 1 : 0 },
    ]);
  return {
    videos,
    button,
    pref,
    connection,
    document,
    control,
    visible,
    suspend(value) {
      suspended = value;
      control.sync();
    },
  };
}
test("only loads and plays visible videos; leaving viewport pauses", () => {
  const f = setup();
  assert.equal(f.videos[0].src, "");
  f.visible(0, true);
  assert.equal(f.videos[0].src, "clip.mp4");
  assert.equal(f.videos[1].src, "");
  assert.equal(f.videos[0].paused, false);
  f.visible(0, false);
  assert.equal(f.videos[0].paused, true);
});
test("manual pause survives scrolling, then resumes visible clips only", () => {
  const f = setup();
  f.visible(0, true);
  f.button.dispatchEvent(new Event("click"));
  f.visible(1, true);
  assert.ok(f.videos.every((v) => v.paused));
  assert.equal(f.videos[1].src, "");
  f.visible(0, false);
  f.button.dispatchEvent(new Event("click"));
  assert.equal(f.videos[0].paused, true);
  assert.equal(f.videos[1].paused, false);
});
test("reduced-motion and save-data start with posters and allow explicit playback", () => {
  for (const options of [{ reduced: true }, { saveData: true }]) {
    const f = setup(options);
    f.visible(0, true);
    assert.equal(f.videos[0].src, "");
    assert.equal(f.button.textContent, "Play previews");
    f.button.dispatchEvent(new Event("click"));
    assert.equal(f.videos[0].paused, false);
  }
});
test("hidden page and modal suspend playback without discarding user choice", () => {
  const f = setup();
  f.visible(0, true);
  f.document.hidden = true;
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.videos[0].paused, true);
  f.document.hidden = false;
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.videos[0].paused, false);
  f.suspend(true);
  assert.equal(f.videos[0].paused, true);
  f.suspend(false);
  assert.equal(f.videos[0].paused, false);
});
test("a late play promise cannot restart an offscreen preview", async () => {
  const f = setup();
  let resolve;
  f.videos[0].play = () =>
    new Promise((done) => {
      resolve = () => {
        f.videos[0].paused = false;
        done();
      };
    });
  f.visible(0, true);
  f.visible(0, false);
  resolve();
  await Promise.resolve();
  assert.equal(f.videos[0].paused, true);
});
test("changed accessibility and data preferences stop active previews", () => {
  const f = setup();
  f.visible(0, true);
  f.pref.matches = true;
  f.pref.dispatchEvent(new Event("change"));
  assert.equal(f.videos[0].paused, true);
  f.button.dispatchEvent(new Event("click"));
  f.connection.saveData = true;
  f.connection.dispatchEvent(new Event("change"));
  assert.equal(f.videos[0].paused, true);
});

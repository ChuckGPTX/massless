import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTrack, frameTiming } from "../public/js/music-visualizer.js";

test("audio envelope retains silence, signal amplitude and stereo energy", () => {
  const silence = analyzeTrack([new Float32Array(100)], 100, 10);
  assert.equal(silence.duration, 1);
  assert.ok([...silence.energy].every((n) => n === 0));
  const track = analyzeTrack(
    [new Float32Array(100).fill(0.5), new Float32Array(100).fill(0.5)],
    100,
    10,
  );
  assert.equal(track.peak, 0.5);
  assert.equal(track.energy.length, 10);
  assert.ok([...track.energy].every((n) => n === 0.5));
});
test("beat cuts stay aligned to tempo and clamp seeking to the clip", () => {
  assert.equal(frameTiming(4, 120, 16).scene, 1);
  assert.equal(frameTiming(8, 60, 32).scene, 1);
  assert.equal(frameTiming(4, 120, 16).pulse, 1);
  assert.equal(frameTiming(-3, 120, 16).progress, 0);
  assert.equal(frameTiming(100, 120, 16).progress, 1);
  assert.equal(frameTiming(0, 120, 0).progress, 0);
});

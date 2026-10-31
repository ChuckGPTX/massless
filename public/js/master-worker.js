// Master for Chucksi: the worker that measures and masters a mix, so the page stays responsive.
// The page decodes the file in the tab and sends the samples here; nothing leaves the device.
// Messages (each answered { id, ok, ... }; progress arrives as { id, progress, label }):
//   load { rate, channels }            keep the source
//   analyze                            the report (numbers and plain sentences)
//   render { character, destination, widen, lossy }   the master, as planar channels, with its measured numbers
//   measure { rate, channels }         loudness and true peak of any audio (a decoded export)

import { analyze, planChain, preChain, master, measureOutput } from './master.js';

let src = null; // { rate, channels }
let report = null;
const pres = new Map(); // character|widen -> the chain before the loudness stage

const handlers = {
  load({ rate, channels }) {
    src = { rate, channels };
    report = null;
    pres.clear();
    return {};
  },
  analyze() {
    if (!src) throw new Error('Open a file first.');
    report ||= analyze(src.channels, src.rate);
    return { report };
  },
  render({ character, destination, widen, lossy }, progress) {
    if (!src) throw new Error('Open a file first.');
    report ||= analyze(src.channels, src.rate);
    const plan = planChain(report, character, destination, { widen, lossy });
    const key = `${plan.character}|${plan.width}|${plan.monoBass}`;
    if (!pres.has(key)) {
      if (pres.size >= 2) pres.delete(pres.keys().next().value); // two characters in memory at most
      pres.set(key, preChain(src.channels, src.rate, plan));
    }
    const r = master(src.channels, src.rate, plan, { pre: pres.get(key), onProgress: progress });
    return { plan, lufs: r.lufs, truePeak: r.truePeak, gainDb: r.gainDb, limiterDb: r.limiterDb, channels: r.channels, transfer: r.channels.map((c) => c.buffer) };
  },
  measure({ rate, channels }) {
    return measureOutput(channels, rate);
  },
};

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    const out = await handlers[type](e.data, (f, label) => self.postMessage({ id, progress: f, label }));
    const transfer = out.transfer || [];
    delete out.transfer;
    self.postMessage({ id, ok: true, ...out }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err), code: err?.code });
  }
};

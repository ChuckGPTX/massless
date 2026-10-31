// Every third-party file the image tools download, pinned to an exact version or revision and checked
// against its SHA-256 before it runs. All permissive: MIT, Apache-2.0 or BSD-3-Clause.
// Files come from jsDelivr and Hugging Face (free to serve) or from this site; the visitor's device does
// the work, so a use costs nothing on the server.

const HF = (repo, rev, file) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';

/** ONNX Runtime Web 1.30.0 (MIT, Microsoft): WebGPU when the browser has it, WebAssembly otherwise. */
export const RUNTIME = {
  name: 'ONNX Runtime Web 1.30.0',
  license: 'MIT',
  lib: { url: `${ORT}ort.webgpu.bundle.min.mjs`, sha256: '0730816731ce2cdfb06f273da065d4a1c7091eb9d1756a83b2916c8a89d015e2', size: 117732 },
  wasm: { url: `${ORT}ort-wasm-simd-threaded.asyncify.wasm`, sha256: '39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da', size: 26781914 },
};

export const MODELS = {
  birefnet: {
    name: 'BiRefNet lite',
    task: 'remove-bg',
    license: 'MIT',
    source: 'ZhengPeng7/BiRefNet_lite, 512 × 512 ONNX export by studioludens/birefnet-lite-512',
    input: 512,
    // fp16 halves the download where WebGPU can run it; WebAssembly needs fp32
    files: {
      webgpu: { url: HF('studioludens/birefnet-lite-512', '962e67969ec6acec9c19fab76acee4f5e22e990c', 'onnx/model_fp16.onnx'), sha256: 'eff9216bb2f9d3f023d9c2b7196845a7485739ab1f231593633e4d2344ffc516', size: 98484532 },
      wasm: { url: HF('studioludens/birefnet-lite-512', '962e67969ec6acec9c19fab76acee4f5e22e990c', 'onnx/model.onnx'), sha256: '1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2', size: 191877254 },
    },
  },
  modnet: {
    name: 'MODNet',
    task: 'remove-bg',
    license: 'Apache-2.0',
    source: 'ZHKKKe/MODNet, ONNX by Xenova/modnet (8-bit)',
    files: {
      wasm: { url: HF('Xenova/modnet', 'fa2fa546052fba4c08921230a26cc69a333fca12', 'onnx/model_quantized.onnx'), sha256: '92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a', size: 6632188 },
    },
  },
  esrgan: {
    name: 'Real-ESRGAN general x4v3',
    task: 'upscale',
    license: 'BSD-3-Clause',
    source: 'xinntao/Real-ESRGAN v0.2.5.0 weights, converted to ONNX by tools/convert_realesrgan.py, served from this repo via jsDelivr (pinned commit)',
    files: {
      webgpu: { url: 'https://cdn.jsdelivr.net/gh/ChuckGPTX/massless@dd9556366d3d5c63d7a896df65c0172e185b606d/public/models/realesr-general-x4v3.onnx', sha256: '3efc184abc51d761453e5f40539e3183451389903ad24b051b7e4726de6bd14e', size: 4860819 },
      wasm: { url: 'https://cdn.jsdelivr.net/gh/ChuckGPTX/massless@dd9556366d3d5c63d7a896df65c0172e185b606d/public/models/realesr-general-x4v3.onnx', sha256: '3efc184abc51d761453e5f40539e3183451389903ad24b051b7e4726de6bd14e', size: 4860819 },
    },
  },
  migan: {
    name: 'MI-GAN',
    task: 'erase',
    license: 'MIT',
    source: 'Picsart-AI-Research/MI-GAN, 512 Places2 ONNX pipeline from andraniksargsyan/migan',
    files: {
      wasm: { url: HF('andraniksargsyan/migan', '406830d0fa60666da0071c342ad2fbc8f30c5c64', 'migan_pipeline_v2.onnx'), sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b', size: 28079181 },
    },
  },
};

/** The file a model uses on a backend ('webgpu' or 'wasm'). */
export function modelFile(id, backend) {
  const m = MODELS[id];
  return (backend === 'webgpu' && m.files.webgpu) || m.files.wasm;
}

export const CACHE_NAME = 'massless-models-v1';

export const mb = (bytes) => `${bytes >= 1e7 ? Math.round(bytes / 1e6) : (bytes / 1e6).toFixed(1)} MB`;

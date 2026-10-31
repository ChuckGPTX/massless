// Shared image model metadata. Importing this file never starts a network request.

/** Every model the Image page offers, keyed by id. `server` is the /api/shot model name. */
export const MODELS = {
  "moss-image-sft": { engine: "hosted", family: "moss", group: "hosted", name: "MOSS Image SFT", short: "MOSS Image", note: "Detailed images, typography and layouts · sign in", licence: "Apache-2.0" },
  "flux-1-schnell": {
    engine: "workers",
    server: "flux-1-schnell",
    cf: "@cf/black-forest-labs/flux-1-schnell",
    family: "flux",
    group: "cloudflare",
    name: "FLUX.1 schnell",
    short: "FLUX.1 schnell",
    note: "Black Forest Labs. Sharp, follows prompts",
    licence: "Apache-2.0",
  },
  "sdxl-lightning": {
    engine: "workers",
    server: "sdxl-lightning",
    cf: "@cf/bytedance/stable-diffusion-xl-lightning",
    family: "sdxl",
    group: "cloudflare",
    name: "SDXL-Lightning",
    short: "SDXL-Lightning",
    note: "ByteDance. 8 steps, the quickest SDXL",
    licence: "OpenRAIL++",
  },
  "dreamshaper-8-lcm": {
    engine: "workers",
    server: "dreamshaper-8-lcm",
    cf: "@cf/lykon/dreamshaper-8-lcm",
    family: "sd15",
    group: "cloudflare",
    name: "DreamShaper 8",
    short: "DreamShaper 8",
    note: "Lykon. Stylized looks and illustration",
    licence: "CreativeML OpenRAIL-M",
  },
  "sdxl-base": {
    engine: "workers",
    server: "sdxl-base",
    cf: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    family: "sdxl",
    group: "cloudflare",
    name: "SDXL 1.0",
    short: "SDXL 1.0",
    note: "Stability AI base. 20 steps, slower",
    licence: "OpenRAIL++",
  },
  sana: {
    engine: "pollinations",
    family: "sana",
    group: "community",
    name: "Pollinations · Sana",
    short: "Sana",
    note: "Community API, NVIDIA Sana, 1 image per 45 s",
    licence: "NVIDIA's licence, open weights",
  },
  comfy: {
    engine: "comfy",
    family: "flux",
    group: "gpu",
    name: "ComfyUI · FLUX.1 schnell",
    short: "FLUX.1 schnell · ComfyUI",
    note: "Connect your own image workflow",
    licence: "Your choice",
  },
};

export const MODEL_GROUPS = [
  { id: "cloudflare", name: "Free on Cloudflare" },
  {id:"hosted",name:"Connected models"},
  { id: "community", name: "Community" },
  { id: "gpu", name: "Connected workflows" },
];

export const DEFAULT_MODEL = "flux-1-schnell";

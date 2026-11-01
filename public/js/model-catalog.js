// Shared image model metadata. Importing this file never starts a network request.

/** Every model the Image page offers, keyed by id. `server` is the /api/shot model name. */
export const MODELS = {
  "moss-image-sft": { engine: "hosted", family: "moss", group: "hosted", name: "Best quality", short: "Best quality", note: "Detailed images, lettering and layouts · sign in", licence: "Apache-2.0" },
  "flux-1-schnell": {
    engine: "workers",
    server: "flux-1-schnell",
    cf: "@cf/black-forest-labs/flux-1-schnell",
    family: "flux",
    group: "cloudflare",
    name: "Fast",
    short: "Fast",
    note: "Sharp and true to your words",
    licence: "Apache-2.0",
  },
  "sdxl-lightning": {
    engine: "workers",
    server: "sdxl-lightning",
    cf: "@cf/bytedance/stable-diffusion-xl-lightning",
    family: "sdxl",
    group: "cloudflare",
    name: "Quick sketch",
    short: "Quick sketch",
    note: "The quickest results",
    licence: "OpenRAIL++",
  },
  "dreamshaper-8-lcm": {
    engine: "workers",
    server: "dreamshaper-8-lcm",
    cf: "@cf/lykon/dreamshaper-8-lcm",
    family: "sd15",
    group: "cloudflare",
    name: "Illustration",
    short: "Illustration",
    note: "Stylized looks and illustration",
    licence: "CreativeML OpenRAIL-M",
  },
  "sdxl-base": {
    engine: "workers",
    server: "sdxl-base",
    cf: "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    family: "sdxl",
    group: "cloudflare",
    name: "Detailed",
    short: "Detailed",
    note: "Slower, with more detail",
    licence: "OpenRAIL++",
  },
  sana: {
    engine: "pollinations",
    family: "sana",
    group: "community",
    name: "Backup",
    short: "Backup",
    note: "One image every 45 seconds",
    licence: "NVIDIA's licence, open weights",
  },
  comfy: {
    engine: "comfy",
    family: "flux",
    group: "gpu",
    name: "Your own workflow",
    short: "Your workflow",
    note: "Connect your own image workflow",
    licence: "Your choice",
  },
};

export const MODEL_GROUPS = [
  { id: "cloudflare", name: "Free" },
  { id: "hosted", name: "Members" },
  { id: "community", name: "More" },
  { id: "gpu", name: "Custom" },
];

export const DEFAULT_MODEL = "flux-1-schnell";

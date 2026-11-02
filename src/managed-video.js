// Wan 2.2 open weights, served by Runpod's shared pool. This is an explicit route,
// never an automatic retry of a potentially billable job on another provider.
export const MANAGED_VIDEO_ENDPOINT = 'wan-2-2-i2v-720';
export const MANAGED_VIDEO_RESERVE = 35; // 5 s = $0.30, plus a bounded first-frame allowance
export const FRAME_TTL = 30 * 60 * 1000;
export const managedVideoOn = env => env.MANAGED_VIDEO_ENABLED === 'true' && !!env.RUNPOD_API_KEY;
export function managedVideoRequest(input, image) {
  if (input.resolution !== '720p' || !['16:9', '9:16'].includes(input.aspect))
    throw new Error('Choose 720p landscape or portrait for this video.');
  return { image, prompt: input.prompt || 'Subtle natural movement, smooth cinematic camera movement.',
    size: input.aspect === '9:16' ? '720*1280' : '1280*720', duration: 5,
    num_inference_steps: 30, guidance: 5, flow_shift: 5, seed: input.seed ?? -1,
    negative_prompt: '', enable_prompt_optimization: false, enable_safety_checker: true };
}
export async function videoFirstFrame(env, input) {
  if (input.image) {
    const data = input.image.replace(/^data:image\/[^;]+;base64,/, '');
    const bytes = atob(data.slice(0, 32));
    return { data, mime: bytes.startsWith('\x89PNG') ? 'image/png' : bytes.startsWith('RIFF') ? 'image/webp' : 'image/jpeg' };
  }
  if (!env.AI) throw new Error('Add a first-frame image to create this video.');
  const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
    prompt: `Cinematic opening frame, no text or watermark. ${input.prompt}`, steps: 4,
  }, env.AI_GATEWAY ? { gateway: { id: env.AI_GATEWAY, skipCache: true } } : undefined);
  if (typeof result?.image !== 'string' || result.image.length < 100)
    throw new Error('The first frame could not be created. Add an image and try again.');
  return { data: result.image, mime: 'image/jpeg' };
}
export function managedVideoCost(result, firstFrameCents = 0) {
  const cost = result.output?.cost;
  // Known failures are free on Public Endpoints; ambiguous results retain the reservation.
  if (typeof cost === 'number' && Number.isFinite(cost) && cost >= 0) return Math.ceil(cost * 100 - 1e-8) + firstFrameCents;
  if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(result.status)) return firstFrameCents;
  return null;
}
export function videoResultURL(output) {
  const value = output?.result || output?.video_url;
  if (typeof value !== 'string') return null;
  let u; try { u = new URL(value); } catch { return null; }
  // Provider output is untrusted. Never proxy arbitrary URLs or send provider credentials.
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (!['runpod.ai', 'runpod.net'].some(h => u.hostname === h || u.hostname.endsWith('.' + h))) return null;
  return u.href;
}

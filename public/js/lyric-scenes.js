// Pictures for a lyric video: one per scene, written from the lyrics and painted with FLUX.1 schnell.
// The scene writer (Llama 3.3) and the painter run on the site's free allowance. If either is
// unavailable, built-in prompts and built-in art take over, so a video is always made.

const STOP = new Set('the a an and or but to of in on at for with you your my me i we our it is are be was were this that so just like all every ever its im ill youre dont cant oh ooh yeah hey la na'.split(' '));
// Words about writing invite the image model to draw text, so they never reach a prompt.
const TEXTY = /^(letter|word|lyric|line|screen|video|upload|song|sing|sang|sung|text|sign|page|book|write|wrote|read|chuck|makes|make|ready|every|watch)/;
const WORLDS = [
  'neon-lit city rooftop at night, magenta and cyan light, wet reflections',
  'golden hour desert highway, long shadows, warm haze',
  'underwater light rays through deep blue water, floating particles',
  'concert stage with laser beams and haze over a silhouetted crowd',
  'rain on a window at night with soft city bokeh',
  'cosmic nebula above snowy mountains, purple and teal sky',
  'retro roller rink with glowing floor lights and motion blur',
  'sunflower field at sunset, lens flare, dreamy film grain',
  'tokyo-style alley with paper lanterns and puddle reflections',
  'ocean waves at dusk from above, pink and orange sky',
];

export function sceneLines(scenes, cues) {
  return scenes.map(s => cues.filter(c => c.start < s.end && c.end > s.start).map(c => c.text));
}

// Built-in prompts: a visual world per scene, flavoured by the strongest words in its lyrics.
export function fallbackPrompts(scenes, cues, title = '') {
  const offset = [...title].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  return sceneLines(scenes, cues).map((lines, i) => {
    const words = lines.join(' ').toLowerCase().replace(/[^\p{L}\s']/gu, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w) && !TEXTY.test(w));
    const motif = [...new Set(words)].slice(0, 3).join(', ');
    const world = WORLDS[(offset + i * 3) % WORLDS.length];
    return `Cinematic music video still, ${world}${motif ? `, evoking ${motif}` : ''}, dramatic lighting, rich colour, shallow depth of field, 35mm film look. No text, no letters, no words, no logos.`;
  });
}

export async function writePrompts({ scenes, cues, title, apiFetch, signal }) {
  const fallback = fallbackPrompts(scenes, cues, title);
  try {
    const r = await apiFetch('/api/lyric-scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, scenes: sceneLines(scenes, cues) }), signal });
    const data = await r.json();
    if (!r.ok || !Array.isArray(data.prompts) || data.prompts.length < scenes.length) return { prompts: fallback, written: false };
    return { prompts: data.prompts.map(p => `${p} No text, no letters, no words.`), written: true };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { prompts: fallback, written: false };
  }
}

// Paint every prompt, a few at a time. Returns one entry per scene: { image, url, prompt } or null.
export async function paintScenes({ prompts, apiFetch, signal, onProgress = () => {}, concurrency = 3, seed = 1 }) {
  const out = new Array(prompts.length).fill(null);
  let next = 0, done = 0, limitHit = null;
  const worker = async () => {
    while (next < prompts.length && !limitHit) {
      const i = next++;
      try {
        const r = await apiFetch('/api/shot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompts[i], purpose: 'lyrics', seed: (seed * 7919 + i * 104729) % 4294967295, width: 1024, height: 1024 }), signal });
        if (r.status === 429) { limitHit = (await r.json().catch(() => ({}))).error || 'Today’s free pictures are used up.'; break; }
        if (r.ok) {
          const blob = await r.blob();
          const image = await createImageBitmap(blob);
          out[i] = { image, url: URL.createObjectURL(blob), prompt: prompts[i] };
        }
      } catch (e) { if (signal?.aborted) throw e; }
      onProgress(++done, prompts.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, prompts.length) }, worker));
  return { pictures: out, limitHit };
}

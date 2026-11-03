// POST /api/edit: change a picture with words, on FLUX.2 [klein] (Workers AI, multipart input).
// Body: multipart/form-data with prompt (1-1000 characters), input_image_0 (the picture to change) and up to
// three more input_image_N references, and size: match | square | portrait | landscape. Every picture must be
// a JPEG, PNG or WebP under 512 x 512 px and 1 MB (the page shrinks them first). Answers with the image itself.
// Cost (Workers AI pricing, November 2026): klein 9B bills $0.015 for the first output megapixel plus $0.002 per
// input megapixel, so a 1024 px edit with one to four 511 px inputs is about $0.0155-$0.017. Klein 4B, the
// fallback, is about $0.0012. EDIT_CAP and PER_VISITOR_EDIT bound the daily spend (see wrangler.jsonc).
import { INPUT_MAX, INPUT_BYTES, MAX_IMAGES, MAX_INSTRUCTION, EDIT_SIZES, editSize, editRefusal } from '../public/js/edit-words.js';

export const EDIT_MODEL = '@cf/black-forest-labs/flux-2-klein-9b';
export const EDIT_FALLBACK = '@cf/black-forest-labs/flux-2-klein-4b';
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Type and pixel size from a JPEG, PNG or WebP header, or null when the bytes are none of those. */
export function imageInfo(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'image/png', w: v.getUint32(16), h: v.getUint32(20) };
  }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === 'VP8 ') return { type: 'image/webp', w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: 'image/webp', w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { type: 'image/webp', w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return null;
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      // SOF0-SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { type: 'image/jpeg', w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** The image bytes in a model answer: { image: base64 } as documented, or raw bytes. */
async function outputBytes(result) {
  if (result && typeof result.image === 'string') return Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
  if (result instanceof ReadableStream || result instanceof ArrayBuffer || ArrayBuffer.isView(result)) return new Uint8Array(await new Response(result).arrayBuffer());
  return null;
}

/**
 * Handle POST /api/edit. `run(model, input)` calls Workers AI (through AI Gateway when configured), `json`
 * writes an error answer, and `cap()` checks the daily counters: it returns an answer when over and
 * otherwise a function that records one finished edit.
 */
export async function editImage(request, env, { run, json, cap }) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  if (Number(request.headers.get('content-length') || 0) > MAX_IMAGES * INPUT_BYTES + 64 * 1024) return json({ error: 'These pictures are too large. Each one must be under 1 MB.' }, 413);
  if (!/^multipart\/form-data/i.test(request.headers.get('content-type') || '')) return json({ error: 'Send the picture and your instruction as a form.' }, 400);
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'The upload was incomplete. Try again.' }, 400); }

  const prompt = String(form.get('prompt') || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim();
  if (!prompt) return json({ error: 'Say what to change first, like “make it sunset”.' }, 400);
  if (prompt.length > MAX_INSTRUCTION) return json({ error: `Keep the instruction under ${MAX_INSTRUCTION} characters.` }, 400);
  const refusal = editRefusal(prompt);
  if (refusal) return json({ error: refusal, refused: true }, 422);

  const files = [];
  for (let i = 0; i < 8; i++) {
    const f = form.get(`input_image_${i}`);
    if (f === null) continue;
    if (i >= MAX_IMAGES) return json({ error: 'Use one picture plus up to three references.' }, 400);
    if (typeof f === 'string' || typeof f.arrayBuffer !== 'function') return json({ error: 'One of the pictures did not upload. Try again.' }, 400);
    if (f.size > INPUT_BYTES) return json({ error: 'Each picture must be under 1 MB.' }, 413);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const info = imageInfo(bytes);
    if (!info || !TYPES.includes(info.type)) return json({ error: 'Use a JPEG, PNG or WebP picture.' }, 415);
    if (info.w > INPUT_MAX || info.h > INPUT_MAX || info.w < 16 || info.h < 16) return json({ error: 'A picture is the wrong size. Reload the page and add it again.' }, 400);
    files.push({ bytes, ...info });
  }
  if (!files.length) return json({ error: 'Add a picture to edit first.' }, 400);
  if (!form.has('input_image_0')) return json({ error: 'Add the picture to edit first, then any references.' }, 400);

  const size = String(form.get('size') || 'match');
  if (!Object.hasOwn(EDIT_SIZES, size)) return json({ error: 'Pick Match original, Square, Portrait or Landscape.' }, 400);
  const out = editSize(size, files[0].w, files[0].h);

  const done = await cap();
  if (done instanceof Response) return done;

  // FormData does not expose its body, so a Response serializes it with the multipart boundary.
  const input = () => {
    const f = new FormData();
    f.append('prompt', prompt);
    f.append('width', String(out.w));
    f.append('height', String(out.h));
    files.forEach((x, i) => f.append(`input_image_${i}`, new Blob([x.bytes], { type: x.type }), `image-${i}`));
    const r = new Response(f);
    return { multipart: { body: r.body, contentType: r.headers.get('content-type') } };
  };
  const models = [env.EDIT_MODEL || EDIT_MODEL, EDIT_FALLBACK].filter((m, i, a) => a.indexOf(m) === i);
  let bytes = null;
  let used = '';
  for (const model of models) {
    try {
      bytes = await outputBytes(await run(model, input()));
      if (bytes && bytes.length > 100 && imageInfo(bytes)) { used = model; break; }
      bytes = null;
    } catch (e) {
      console.error('edit failed:', model, e?.message || e);
    }
  }
  if (!bytes) return json({ error: "Couldn't make this edit. Try again, or say it a different way." }, 502);
  const left = await done();
  return new Response(bytes, {
    headers: {
      'content-type': imageInfo(bytes).type,
      'cache-control': 'no-store',
      'x-massless-model': used,
      'x-massless-size': `${out.w}x${out.h}`,
      ...(Number.isFinite(left) ? { 'x-massless-remaining-today': String(left) } : {}),
    },
  });
}

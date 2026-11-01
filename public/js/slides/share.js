// Share links: the deck spec (never images you uploaded or generated; those stay in this browser) deflated
// and base64url-encoded into the URL hash, the same scheme as the website builder's #s= links. The hash is
// never sent to a server, so a shared deck travels only inside the link itself.

import { sanitizeDeck } from './spec.js';

const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** A copy of the deck without local media: asset: sources become empty (their prompts stay, so they can be regenerated). */
export function shareable(deck) {
  const copy = JSON.parse(JSON.stringify(deck));
  const strip = (o) => {
    if (Array.isArray(o)) { o.forEach(strip); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.src === 'string' && !o.src.startsWith('/media/')) o.src = '';
    Object.values(o).forEach(strip);
  };
  strip(copy);
  return copy;
}
export const localImageCount = (deck) => JSON.stringify(deck).split('"src":"asset:').length - 1;

/** Deck -> 'z…' (deflate-raw) or 'j…' (plain JSON where CompressionStream is missing). */
export async function encodeDeck(deck) {
  const bytes = new TextEncoder().encode(JSON.stringify(shareable(deck)));
  if (typeof CompressionStream !== 'undefined') return `z${b64url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `j${b64url(bytes)}`;
}

export async function decodeDeck(code) {
  const kind = String(code || '')[0];
  let bytes = unb64url(String(code).slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('This link is not a Chucksi deck.');
  if (bytes.length > 400000) throw new Error('This link is too long.');
  return sanitizeDeck(JSON.parse(new TextDecoder().decode(bytes)));
}

export async function shareUrl(deck, base = `${location.origin}/office?tab=slides&play=1`) {
  return `${base}#d=${await encodeDeck(deck)}`;
}

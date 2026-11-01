// Share links: the site spec (never the images you uploaded or generated) deflated and base64url-encoded
// into the URL hash, so a link reopens the editor with the same site. Nothing is sent to a server.

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

/** A copy of the site without uploaded or generated media (those live only in this browser). */
export function shareable(site) {
  const copy = JSON.parse(JSON.stringify(site));
  const strip = (o) => {
    if (Array.isArray(o)) { o.forEach(strip); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.src === 'string' && o.src.startsWith('asset:')) o.src = '';
    if (typeof o.audio === 'string' && o.audio.startsWith('asset:')) o.audio = '';
    Object.values(o).forEach(strip);
  };
  strip(copy);
  return copy;
}

/** Site -> 'z…' (deflate-raw) or 'j…' (plain JSON when CompressionStream is missing). */
export async function encodeSite(site) {
  const bytes = new TextEncoder().encode(JSON.stringify(shareable(site)));
  if (typeof CompressionStream !== 'undefined') return `z${b64url(await pipe(bytes, new CompressionStream('deflate-raw')))}`;
  return `j${b64url(bytes)}`;
}

export async function decodeSite(code) {
  const kind = code[0];
  let bytes = unb64url(code.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  else if (kind !== 'j') throw new Error('This link is not a Chucksi site.');
  if (bytes.length > 400000) throw new Error('This link is too long.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function shareUrl(site, base = `${location.origin}/website`) {
  return `${base}#s=${await encodeSite(site)}`;
}

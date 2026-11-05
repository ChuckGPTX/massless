// AI Mix, server side. The mixing itself runs in the visitor's browser; the server does two small things:
//   POST /api/mix-plan   the creative calls: a role for stems the browser couldn't name, and bounded style moves
//                        (vocal level, low end, brightness, space, width, loudness) for the genre and the
//                        reference song (title read from YouTube / Spotify / SoundCloud / Apple Music oEmbed).
//   GET  /api/mix-fetch  downloads a shared Dropbox or Google Drive link for the browser, which can't fetch those
//                        itself (no CORS). Only those hosts, only files, size-capped, streamed straight through.

const ROLES = ['kick', 'snare', 'hats', 'perc', 'drums', 'room', '808', 'bass', 'leadVox', 'backVox', 'adlib', 'keys', 'pad', 'guitar', 'synth', 'fx', 'beat', 'music'];
const GENRES = ['hiphop', 'trap', 'drill', 'rnb', 'pop', 'rock', 'edm', 'afrobeats', 'lofi', 'country', 'latin'];
const MACROS = ['vox', 'low', 'bright', 'space', 'width', 'loud'];
const OEMBED = [
  [/^(www\.|m\.|music\.)?youtube\.com$|^youtu\.be$/, (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`],
  [/^open\.spotify\.com$/, (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`],
  [/^(www\.|m\.)?soundcloud\.com$/, (u) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u)}`],
];
const FETCH_HOSTS = /^(www\.)?dropbox\.com$|^dl\.dropboxusercontent\.com$|^([\w-]+\.)?dl\.dropbox\.com$|^drive\.usercontent\.google\.com$|^drive\.google\.com$/;
const MAX_FETCH_BYTES = 1.5 * 1024 ** 3;

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Title and artist of a reference link, from the platform's public oEmbed. */
export async function referenceInfo(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const hit = OEMBED.find(([re]) => re.test(u.hostname));
  if (!hit) {
    // Apple Music and others: the path usually carries the song and artist slug.
    if (/music\.apple\.com$/.test(u.hostname)) {
      const slug = decodeURIComponent(u.pathname.split('/').filter(Boolean).slice(-2, -1)[0] || '').replace(/-/g, ' ');
      return slug ? { title: slug.slice(0, 120), author: '', source: 'Apple Music' } : null;
    }
    return null;
  }
  try {
    const r = await fetch(hit[1](u.href), { headers: { accept: 'application/json' }, cf: { cacheTtl: 86400 } });
    if (!r.ok) return null;
    const d = await r.json();
    return { title: String(d.title || '').slice(0, 160), author: String(d.author_name || '').slice(0, 80), source: String(d.provider_name || u.hostname).slice(0, 40) };
  } catch { return null; }
}

const RULES = `You are a Grammy-level mix engineer planning an automatic mix. You get the genre, an optional reference song,
and the session's stems (file name, a guessed role, whether the name made it certain, seconds of sound, share of low and
high energy, transients per second, stereo or mono).
Reply with JSON only:
{"roles": [one role per stem, in order],
 "macros": {"vox": n, "low": n, "bright": n, "space": n, "width": n, "loud": n},
 "notes": "two or three short sentences, in plain words, on how this mix will sound and why"}
Roles must be one of: ${ROLES.join(', ')}. Keep a role marked sure unless it is clearly wrong. Pick exactly one leadVox
when there is a vocal (the main voice); doubles, harmonies and stacks are backVox; short shouts are adlib.
Macros are whole or half numbers from -3 to 3, 0 meaning the genre's normal: vox = vocal level against the beat,
low = 808/bass/kick weight, bright = top end, space = reverb and delay, width = stereo width, loud = master loudness.
Use the reference song (if any) to lean the macros toward how that record sounds; never claim to have heard it.
Never mention real people other than the reference artist, never give legal or business advice.`;

export async function mixPlan(request, env, { ai, json, allow, LLM }) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON.' }, 400); }
  const genre = GENRES.includes(body.genre) ? body.genre : 'hiphop';
  const tracks = (Array.isArray(body.tracks) ? body.tracks : []).slice(0, 48).map((t) => ({
    name: String(t?.name || '').slice(0, 90), role: ROLES.includes(t?.role) ? t.role : 'synth', sure: !!t?.sure,
    seconds: clamp(Number(t?.seconds) || 0, 0, 600), low: clamp(Number(t?.low) || 0, 0, 1), high: clamp(Number(t?.high) || 0, 0, 1),
    punch: clamp(Number(t?.punch) || 0, 0, 30), stereo: !!t?.stereo,
  }));
  if (!tracks.length) return json({ error: 'No stems.' }, 400);
  const gate = await allow(request, env, 'mix', Number(env.MIX_CAP || 2000), Number(env.PER_VISITOR_MIX || 20));
  if (gate) return gate;
  const reference = body.reference ? await referenceInfo(body.reference) : null;
  let result;
  try {
    result = await ai(env, LLM, {
      messages: [
        { role: 'system', content: RULES },
        { role: 'user', content: `Genre: ${genre}\nReference: ${reference ? `"${reference.title}"${reference.author ? ` by ${reference.author}` : ''}` : 'none'}\nStems:\n` + tracks.map((t, i) => `${i + 1}. ${t.name} | guess ${t.role}${t.sure ? ' (sure)' : ''} | ${t.seconds}s | low ${t.low} | high ${t.high} | punch ${t.punch}/s | ${t.stereo ? 'stereo' : 'mono'}`).join('\n') },
      ],
      max_tokens: 900,
      temperature: 0.3,
    });
  } catch (e) {
    console.error('mix plan failed:', e?.message || e);
    return json({ error: 'The mix planner is busy. The built-in plan is used instead.' }, 502);
  }
  let spec = result && result.response;
  if (typeof spec === 'string') { try { spec = JSON.parse(spec.slice(spec.indexOf('{'), spec.lastIndexOf('}') + 1)); } catch { spec = null; } }
  if (!spec || typeof spec !== 'object') return json({ error: 'The mix planner is busy. The built-in plan is used instead.' }, 502);
  const roles = tracks.map((t, i) => (ROLES.includes(spec.roles?.[i]) ? spec.roles[i] : t.role));
  const macros = Object.fromEntries(MACROS.map((k) => [k, Math.round(clamp(Number(spec.macros?.[k]) || 0, -3, 3) * 2) / 2]));
  const notes = String(spec.notes || '').replace(/\s+/g, ' ').trim().slice(0, 420);
  return json({ roles, macros, notes, reference, model: LLM });
}

export async function mixFetch(request, env, { json, allow }) {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  let u;
  try { u = new URL(new URL(request.url).searchParams.get('url') || ''); } catch { return json({ error: 'Send ?url=' }, 400); }
  if (u.protocol !== 'https:' || !FETCH_HOSTS.test(u.hostname)) return json({ error: 'Links from Dropbox and Google Drive can be fetched here. For other sites, download the file and drop it in.' }, 400);
  const gate = await allow(request, env, 'mixget', Number(env.MIX_FETCH_CAP || 3000), Number(env.PER_VISITOR_MIX_FETCH || 15));
  if (gate) return gate;
  let r;
  try { r = await fetch(u.href, { redirect: 'follow', headers: { 'user-agent': 'Chucksi-AI-Mix/1.0' } }); } catch { return json({ error: 'Couldn’t reach that link. Check it’s shared publicly.' }, 502); }
  const final = new URL(r.url || u.href);
  if (!FETCH_HOSTS.test(final.hostname) && !/googleusercontent\.com$|dropboxusercontent\.com$/.test(final.hostname)) return json({ error: 'That link redirected somewhere we don’t fetch from.' }, 400);
  if (!r.ok) return json({ error: r.status === 404 ? 'That link wasn’t found.' : `The link answered ${r.status}. Make sure it’s shared with anyone who has the link.` }, 502);
  const type = r.headers.get('content-type') || 'application/octet-stream';
  if (/text\/html/.test(type)) return json({ error: 'The link opened a web page instead of a file. Share it publicly, or download it and drop it in.' }, 422);
  const size = Number(r.headers.get('content-length')) || 0;
  if (size > MAX_FETCH_BYTES) return json({ error: 'That file is over 1.5 GB. Zip fewer stems, or use MP3 stems.' }, 413);
  const headers = { 'content-type': type, 'cache-control': 'no-store' };
  if (size) headers['content-length'] = String(size);
  const disp = r.headers.get('content-disposition');
  if (disp) headers['content-disposition'] = disp.slice(0, 300);
  return new Response(r.body, { status: 200, headers });
}

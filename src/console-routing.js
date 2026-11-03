export const CONSOLE_HOST = 'console.chucksi.com';
export function consoleTarget(request) {
  const url = new URL(request.url);
  const legacy = url.pathname.match(/^\/console(?:\/(.*))?$/);
  if (legacy && ['chucksi.com', 'www.chucksi.com', 'massless.chucksi.com', CONSOLE_HOST].includes(url.hostname)) {
    const path = (legacy[1] || '').replace(/(?:^|\/)index\.html$/, '');
    return { redirect: `https://${CONSOLE_HOST}/${path}${url.search}` };
  }
  if (url.hostname !== CONSOLE_HOST) return null;
  if (url.pathname === '/') return { asset: '/console/index.html' };
  if (/^\/docs(?:\/[^.]+)?\/?$/.test(url.pathname)) return { asset: `/console${url.pathname.replace(/\/$/, '')}/index.html` };
  if (url.pathname === '/llms.txt') return { asset: '/console/llms.txt' };
  return null;
}

import { TOTAL_ENTRY, TOTAL_EXPECTED_SHA256 } from '../server/catalog/total.js';

export const TOKI_VIEWER_SHA256 = '14a9d730aecf7e47172fb534d4fada3ff9db1b03a8f58bf22ddff6e1d8ee1dc0';
/** Audited collectors only. Authentication-required and unknown WebViews fail explicitly. */
export async function totalHttpCollector(bundle, request, http) {
  const toki = ['68925355','1153259314'].includes(bundle.entry.id) && bundle.codeDigest === TOKI_VIEWER_SHA256;
  if (bundle.action !== 'pages' || (!toki && (bundle.entry.id !== TOTAL_ENTRY.id || bundle.codeDigest !== TOTAL_EXPECTED_SHA256)))
    throw new Error('source_browser_required');
  const pageUrl = new URL(request.url);
  const route = /^\/(manhwa|webtoon)\/([^/]+)\/([^/]+)\/?$/.exec(pageUrl.pathname);
  if (!route || (!toki && route[1] !== 'manhwa') || pageUrl.protocol !== 'https:') throw new Error('source_browser_required');
  const response = await http({ url: pageUrl.href, headers: request.headers });
  if (response.statusCode !== 200) throw new Error('source_access_denied');
  let flight = '';
  for (const script of response.body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const match = script[1].trim().match(/^self\.__next_f\.push\((\[1,[\s\S]*\])\);?$/);
    if (!match) continue;
    const frame = JSON.parse(match[1]);
    if (Array.isArray(frame) && typeof frame[1] === 'string') flight += frame[1];
  }
  const pending = [];
  for (const line of flight.split('\n')) {
    try { pending.push(JSON.parse(line.slice(line.indexOf(':') + 1))); } catch {}
  }
  let props, visited = 0;
  while (pending.length) {
    if (++visited > 100000) throw new Error('source_body_limit');
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (typeof value.imagesToken === 'string' && String(value.sourceWorkId) === route[2] && String(value.episodeId) === route[3]) {
      if (props) throw new Error('invalid_source_result');
      props = value;
    }
    for (const child of Object.values(value)) pending.push(child);
  }
  if (!props) throw new Error('source_browser_required');
  if (props.adVerificationEnabled !== false) throw new Error('source_browser_auth_required');
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const result = await http({ url: new URL(`/api/${route[1]}-images`, pageUrl).href, method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json',
      'x-images-client': 'viewer-v1', Referer: pageUrl.href, Origin: pageUrl.origin },
    body: JSON.stringify({ workId: props.sourceWorkId, episodeId: props.episodeId, token: props.imagesToken, nonce, proof: '' }) });
  if (result.statusCode !== 200) throw new Error('source_access_denied');
  const data = JSON.parse(result.body);
  if (data?.ok !== true || !Array.isArray(data.images) || !data.images.length || data.images.length > 2048 ||
    !Array.isArray(props.imageMetas) || data.images.length !== props.imageMetas.length)
    throw new Error('invalid_source_result');
  const pages = data.images.map((row, index) => {
    if (row?.page !== index + 1 || typeof row.src !== 'string') throw new Error('invalid_source_result');
    const url = new URL(row.src);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_source_result');
    return url.href;
  });
  if (new Set(pages).size !== pages.length) throw new Error('invalid_source_result');
  return JSON.stringify(toki ? {images:data.images,expected:pages.length} : { ok: true, pages, referer: pageUrl.origin + '/' });
}

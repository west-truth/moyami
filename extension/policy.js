export const limits = { http: 2 * 1024 * 1024, image: 20 * 1024 * 1024, job: 32 * 1024 * 1024, body: 512 * 1024 };
export function sourceUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('source_url_denied');
  let url; try { url = new URL(value); } catch { throw new Error('source_url_denied'); }
  const host = url.hostname.toLowerCase();
  // DNS resolution is owned by the browser; host permission is an additional, required boundary.
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      host.endsWith('.') || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') ||
      /(^|\.)(localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)) throw new Error('source_url_denied');
  return url;
}
export function requestSpec(input, image = false) {
  if (!input || typeof input !== 'object') throw new Error('invalid_source_invocation');
  const url = sourceUrl(input.url);
  const method = (input.method ?? 'GET').toUpperCase();
  if (!['GET', 'POST', 'HEAD'].includes(method) || (image && method !== 'GET')) throw new Error('permission_denied');
  if (input.body !== undefined && (typeof input.body !== 'string' || new TextEncoder().encode(input.body).length > limits.body || method !== 'POST'))
    throw new Error('source_body_limit');
  const headers = {}, special = {};
  if (input.headers !== undefined && (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers))) throw new Error('invalid_source_invocation');
  if (Object.keys(input.headers ?? {}).length > 32) throw new Error('invalid_source_invocation');
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    const name = key.toLowerCase();
    if (typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value)) throw new Error('invalid_source_invocation');
    if (name === 'referer' || name === 'origin') {
      const headerUrl = sourceUrl(value);
      special[name] = name === 'origin' ? headerUrl.origin : headerUrl.href;
    } else if (name === 'user-agent') special[name] = value;
    else if (name === 'range') { if (!/^bytes=(?:[0-9]+-[0-9]*|-[0-9]+)$/.test(value)) throw new Error('invalid_source_invocation'); headers[name] = value; }
    else if (['accept', 'accept-language', 'content-type', 'cache-control', 'pragma', 'if-none-match', 'if-modified-since', 'x-images-client', 'x-requested-with'].includes(name)) headers[name] = value;
    else if (!['user-agent', 'accept-encoding', 'connection', 'content-length', 'host'].includes(name)) throw new Error('connector_header_unsupported');
  }
  const timeout = input.options?.timeout;
  if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0)) throw new Error('invalid_source_invocation');
  return { url: url.href, origin: url.origin, method, headers, special, body: input.body,
    timeoutMs: Math.max(1, Math.min(25000, timeout === undefined ? 15000 : timeout * 1000)), maximum: image ? limits.image : limits.http, image };
}
export function isReader(sender, origins) {
  try { return sender.frameId === 0 && Number.isInteger(sender.tab?.id) && origins.includes(new URL(sender.url).origin); } catch { return false; }
}

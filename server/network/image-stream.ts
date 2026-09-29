import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { Transform } from 'node:stream';
import { isPublicSourceAddress } from './source-http.mjs';
import { pinnedProxyAgent } from './outbound-proxy.js';

const maximumBytes = 20 * 1024 * 1024;
type SourceAddress = { address: string; family: 4 | 6 };

// Browser image requests cannot set source-specific credentials or arbitrary headers.
export function canRedirectImage(headers: Record<string, string>) {
  return Object.entries(headers).every(([key, value]) =>
    /^(accept|user-agent|referer)$/i.test(key) && typeof value === 'string' && !/[\r\n]/.test(value));
}

export async function publicImageUrl(input: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href.length > 8192)
    throw new Error('source_url_denied');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(row => !isPublicSourceAddress(row.address)))
    throw new Error('source_address_denied');
  return url.href;
}

export async function openImageStream(
  input: { url: string; headers: Record<string, string> },
  signal: AbortSignal,
  outboundProxy?: string
) {
  let url = new URL(input.url);
  let headers = validHeaders(input.headers);
  for (let redirects = 0; redirects <= 4; redirects++) {
    signal.throwIfAborted();
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.href.length > 8192)
      throw new Error('source_url_denied');
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
      : await lookup(hostname, { all: true, verbatim: true }) as SourceAddress[];
    if (!addresses.length || addresses.some((row) => !isPublicSourceAddress(row.address)))
      throw new Error('source_address_denied');
    let response: IncomingMessage | undefined;
    let agent: ReturnType<typeof pinnedProxyAgent> | undefined;
    for (const address of addresses) {
      agent = pinnedProxyAgent(outboundProxy, url, address.address, signal);
      try {
        response = await request(url, headers, address, signal, agent);
        break;
      } catch (error) {
        agent?.destroy();
        if (signal.aborted || address === addresses.at(-1)) throw error;
      }
    }
    if (!response) throw new Error('source_connection_failed');
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const location = response.headers.location;
      response.destroy();
      agent?.destroy();
      if (!location || redirects === 4) throw new Error('source_redirect_limit');
      const next = new URL(location, url);
      if (next.origin !== url.origin) {
        headers = { ...headers };
        delete headers.authorization;
        delete headers.cookie;
      }
      url = next;
      continue;
    }
    const type = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const length = Number(response.headers['content-length'] ?? 0);
    if (response.statusCode !== 200 || !type.startsWith('image/') || (length && (!Number.isSafeInteger(length) || length > maximumBytes))) {
      response.destroy();
      agent?.destroy();
      throw new Error('image_decode_failed');
    }
    const limiter = imageSizeLimiter();
    limiter.once('close', () => { response?.destroy(); agent?.destroy(); });
    response.once('close', () => agent?.destroy());
    response.once('error', (error: Error) => limiter.destroy(error));
    response.pipe(limiter);
    return {
      stream: limiter,
      contentType: String(response.headers['content-type'] ?? type),
      contentLength: length || undefined,
      contentEncoding: response.headers['content-encoding']
    };
  }
  throw new Error('source_redirect_limit');
}

export function imageSizeLimiter(maximum = maximumBytes) {
  let bytes = 0;
  return new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maximum ? new Error('source_body_limit') : undefined, chunk);
      }
    });
}

function validHeaders(input: Record<string, string>) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 32)
    throw new Error('source_http_failed');
  const output: Record<string, string> = { 'user-agent': 'Mozilla/5.0', accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8', 'accept-encoding': 'identity' };
  for (const [key, value] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(key) || typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value) || /^(host|connection|content-length|transfer-encoding|proxy-.*)$/i.test(key))
      throw new Error('source_http_failed');
    output[key.toLowerCase()] = value;
  }
  return output;
}

function request(
  url: URL,
  headers: Record<string, string>,
  address: SourceAddress,
  signal: AbortSignal,
  agent: ReturnType<typeof pinnedProxyAgent>
) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: 'GET', headers, signal, agent: agent ?? false,
      lookup: (_host, options, callback) => queueMicrotask(() =>
        options.all ? callback(null, [address]) : callback(null, address.address, address.family))
    }, resolve);
    request.once('error', reject);
    request.end();
  });
}

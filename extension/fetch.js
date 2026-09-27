// Self-contained so scripting.executeScript can run this bundled function in an authenticated source tab.
export async function boundedFetch(spec, requestId) {
  const controllers = globalThis.__moyaConnectorRequests ??= new Map();
  if (spec.inTab && location.origin !== spec.origin) throw new Error('connector_auth_tab_changed');
  const abort = new AbortController();
  controllers.set(requestId, abort);
  const timer = setTimeout(() => abort.abort(), spec.timeoutMs);
  try {
    const response = await fetch(spec.url, { method: spec.method, headers: spec.headers, body: spec.body,
      referrer: spec.inTab && spec.special?.referer && new URL(spec.special.referer).origin === location.origin ? spec.special.referer : undefined,
      credentials: 'include', redirect: 'error', cache: 'no-store', signal: abort.signal });
    let type = response.headers.get('content-type') ?? '';
    if (spec.image && !response.ok)
      throw new Error([401, 403].includes(response.status) ? 'source_access_denied' : 'image_decode_failed');
    if (spec.method !== 'HEAD' && Number(response.headers.get('content-length')) > spec.maximum) throw new Error('source_body_limit');
    const reader = response.body?.getReader();
    let size = 0; const chunks = [];
    while (reader) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > spec.maximum) { await reader.cancel(); throw new Error('source_body_limit'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (spec.image) {
      // Some CDNs label JPEG/PNG as application/octet-stream. Check the bytes,
      // and never pass HTML/SVG through as an image merely because of its header.
      const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start,start+length));
      const actual = bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff ? 'image/jpeg' :
        bytes[0]===137 && ascii(1,3)==='PNG' ? 'image/png' :
        ['GIF87a','GIF89a'].includes(ascii(0,6)) ? 'image/gif' :
        ascii(0,4)==='RIFF' && ascii(8,4)==='WEBP' ? 'image/webp' :
        ascii(4,4)==='ftyp' && /avif|avis/.test(ascii(8,24)) ? 'image/avif' :
        ascii(0,2)==='BM' ? 'image/bmp' : undefined;
      if (!actual) throw new Error('image_decode_failed');
      type = actual;
    }
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { statusCode: response.status, contentType: type, headers: { 'content-type': type }, bytes: btoa(binary), size,
      isRedirect: false, request: { url: spec.url, method: spec.method, headers: spec.headers, contentLength: spec.body?.length ?? 0, followRedirects: false, maxRedirects: 0 } };
  } catch (error) {
    throw new Error(error.name === 'AbortError' ? 'source_request_timeout' : /^[a-z_]+$/.test(error.message) ? error.message : 'source_connection_failed');
  } finally { clearTimeout(timer); controllers.delete(requestId); }
}
export function cancelFetch(requestId) { globalThis.__moyaConnectorRequests?.get(requestId)?.abort(); }

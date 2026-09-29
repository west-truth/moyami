import { localCache } from './local-cache.js';
const sources = localCache('source-v1');
const digest = async source => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
import { connectorMode, connectorCall, connectorImages, clearConnectorFailure, connectorFailure } from './connector.js';
/** Trusted coordinator. Extension code is sent only to the QuickJS realm in a disposable Worker. */
export async function runBrowserSource(input, api, signal) {
  const post = (path, body, options = {}) => api(path, { method: 'POST', body: JSON.stringify(body), ...options });
  const useConnector = connectorMode();
  if (useConnector) { clearConnectorFailure(); await connectorCall('hello', {}, signal, 2000); }
  const cacheKey = JSON.stringify([input.repositoryUrl, input.sourceId, input.codeDigest || 'initial']);
  let cached = await sources.get(cacheKey);
  if (cached && (typeof cached.source !== 'string' || await digest(cached.source) !== cached.codeDigest)) {
    await sources.delete(cacheKey); cached = undefined;
  }
  signal?.throwIfAborted();
  const bundle = await post('/api/runtime/prepare', { ...input, cachedCodeDigest: cached?.codeDigest }, { signal });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const unload = () => abort.abort();
  window.addEventListener('pagehide', unload, { once: true });
  let worker, timer, connectorToken;
  try {
    if (bundle.source === undefined && cached?.codeDigest === bundle.codeDigest) bundle.source = cached.source;
    if (typeof bundle.source !== 'string' || await digest(bundle.source) !== bundle.codeDigest) throw new Error('source_digest_changed');
    // Key by the server-validated digest. A later approved update gets a separate entry.
    if (!cached || cached.codeDigest !== bundle.codeDigest) await sources.set(JSON.stringify([input.repositoryUrl, input.sourceId, bundle.codeDigest]),
      { source: bundle.source, codeDigest: bundle.codeDigest }, Date.now() + 90 * 86400_000);
    if (useConnector) connectorToken = (await connectorCall('begin', { action: input.action }, signal)).token;
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    worker = new Worker('/runtime/source-worker.js', { type: 'module', name: 'moya-source-isolate' });
    const value = await new Promise((resolve, reject) => {
      const fail = error => { worker.terminate(); reject(error); };
      abort.signal.addEventListener('abort', () => fail(new DOMException('cancelled', 'AbortError')), { once: true });
      timer = setTimeout(() => fail(new Error('execution_timeout')), bundle.timeoutMs + 1500);
      worker.onerror = () => fail(new Error('source_worker_failed'));
      worker.onmessageerror = () => fail(new Error('invalid_source_result'));
      worker.onmessage = async ({ data }) => {
        if (data?.type === 'result') { worker.terminate(); resolve(data.value); }
        else if (data?.type === 'failure') fail(new Error(data.code));
        else if (data?.type === 'http') {
          try {
            const value = useConnector
              ? await connectorCall('http', { token: connectorToken, request: data.request }, abort.signal)
              : await post('/api/runtime/http', { token: bundle.token, request: data.request }, { signal: abort.signal });
            worker.postMessage({ type: 'http-result', id: data.id, value });
          } catch (error) {
            worker.postMessage({ type: 'http-result', id: data.id, error: error.message });
          }
        }
      };
      worker.postMessage({ type: 'invoke', bundle });
    });
    clearTimeout(timer);
    if (useConnector && connectorFailure() === 'connector_permission_required') throw new Error(connectorFailure());
    const result = await post('/api/runtime/finish', { token: bundle.token, value }, { signal: abort.signal });
    // Old clients retain the relay URL; only clients with automatic fallback opt into redirects.
    if (!useConnector && input.action === 'pages' && Array.isArray(result.result)) {
      result.result = result.result.map(page => ({ ...page, imageUrl: page.directImageUrl || page.imageUrl }));
    }
    return useConnector ? connectorImages(input.action, value, result) : result;
  } finally {
    clearTimeout(timer);
    if (connectorToken) void connectorCall('end', { token: connectorToken }).catch(() => {});
    worker?.terminate();
    abort.abort();
    signal?.removeEventListener('abort', cancel);
    window.removeEventListener('pagehide', unload);
    // This also revokes unfinished network requests after timeout/navigation. Expiry is a server backstop.
    void post('/api/runtime/cancel', { token: bundle.token }, { keepalive: true }).catch(() => {});
  }
}

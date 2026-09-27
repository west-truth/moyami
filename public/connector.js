import { localStorage, indexedDB } from "/account-storage.js";
const pending = new Map();
let failure;
const errorCodes = new Set(['connector_permission_required','source_access_denied','connector_auth_fetch_failed','connector_header_unsupported','source_connection_failed']);
export function connectorMode() { return localStorage.getItem('moya-network-mode') === 'browser'; }
export function connectorFailure() { return failure; }
export function clearConnectorFailure() { failure = undefined; }
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.channel === 'moya-connector-disconnected-v1') {
    for (const request of pending.values()) request.reject(new Error('connector_disconnected'));
    pending.clear(); return;
  }
  if (data?.channel !== 'moya-connector-response-v1') return;
  const request = pending.get(data.id); if (!request) return;
  if (data.error) request.reject(new Error(data.error)); else request.resolve(data.value);
});
export function connectorCall(type, args = {}, signal, timeoutMs = 30000) {
  if (signal?.aborted) return Promise.reject(new DOMException('cancelled', 'AbortError'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { pending.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const sendCancel = () => window.postMessage({ channel: 'moya-connector-request-v1', id: crypto.randomUUID(), type: 'cancel', token: args.token, requestId: id }, location.origin);
    const abort = () => { sendCancel(); cleanup(); reject(new DOMException('cancelled', 'AbortError')); };
    const timer = setTimeout(() => { sendCancel(); cleanup(); reject(new Error(type === 'hello' ? 'connector_not_installed' : 'connector_timeout')); }, timeoutMs);
    pending.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: error => {
      cleanup(); if (errorCodes.has(error.message)) { failure = error.message; window.dispatchEvent(new CustomEvent('moya-connector-error', { detail: error.message })); }
      reject(error);
    } });
    signal?.addEventListener('abort', abort, { once: true });
    window.postMessage({ channel: 'moya-connector-request-v1', id, type, ...args }, location.origin);
  });
}
// Keep validated server output for text/preferences; preserve only image requests for the local transport.
export function connectorImages(action, raw, validated) {
  const descriptor = value => 'moya-image:' + encodeURIComponent(JSON.stringify(value));
  if (action === 'pages') {
    if (!Array.isArray(raw.result) || raw.result.length !== validated.result?.length) throw new Error('invalid_source_result');
    validated.result = validated.result.map((page, index) => ({ ...page, imageUrl: descriptor({ url: raw.result[index].url, headers: raw.result[index].headers ?? {} }) }));
  } else {
    const visit = (original, output, depth = 0) => {
      if (depth > 4 || !original || !output || typeof original !== 'object' || typeof output !== 'object') return;
      for (const key of Object.keys(output)) {
        if (key === 'imageUrl' && typeof original[key] === 'string' && /^https:\/\//i.test(original[key])) output[key] = descriptor({ url: original[key], headers: original.imageHeaders ?? {} });
        else visit(original[key], output[key], depth + 1);
      }
    };
    visit(raw.result, validated.result);
  }
  return validated;
}

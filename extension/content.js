(() => {
  if (window !== window.top || !__READER_ORIGINS__.includes(location.origin)) return;
  const api = globalThis.browser ?? chrome;
  let port;
  function connect() {
    if (port) return port;
    port = api.runtime.connect({ name: 'moya-connector-v1' });
    port.onMessage.addListener(message => window.postMessage({ channel: 'moya-connector-response-v1', ...message }, location.origin));
    port.onDisconnect.addListener(() => { port = null; window.postMessage({ channel: 'moya-connector-disconnected-v1' }, location.origin); });
    return port;
  }
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'moya-connector-request-v1') return;
    const data = event.data;
    if (typeof data.id !== 'string' || !['hello','begin','http','image','end','cancel'].includes(data.type)) return;
    try { connect().postMessage(data); } catch { window.postMessage({ channel: 'moya-connector-response-v1', id: data.id, error: 'connector_disconnected' }, location.origin); }
  });
  window.addEventListener('pagehide', () => { port?.disconnect(); port = null; });
})();

import { sourceUrl, requestSpec, isReader, limits } from './policy.js';
import { boundedFetch, cancelFetch } from './fetch.js';
const api = globalThis.browser ?? chrome;
const readers = __READER_ORIGINS__;
const sessions = new Set();
let nextRule = 100, headerQueue = Promise.resolve(), activeImages = 0;
// Only temporary rules made by this extension exist. Clear leftovers after a background restart.
const ready = api.declarativeNetRequest.getSessionRules().then(rules => api.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map(r => r.id) }));
let pendingQueue = Promise.resolve();
function remember(origin, denied = false) {
  pendingQueue = pendingQueue.catch(() => {}).then(async () => {
    const { pending = {} } = await api.storage.local.get('pending');
    pending[origin] = { denied, at: Date.now() };
    const entries = Object.entries(pending).sort((a,b) => b[1].at-a[1].at).slice(0,32);
    await api.storage.local.set({ pending: Object.fromEntries(entries) });
  });
  return pendingQueue;
}
async function permission(origin) {
  if (!await api.permissions.contains({ origins: [origin + '/*'] })) { await remember(origin); throw new Error('connector_permission_required'); }
}
async function transport(spec, requestId, state) {
  await ready; await permission(spec.origin);
  for (const key of ['referer','origin']) if (spec.special[key]) await permission(new URL(spec.special[key]).origin);
  const { authTabs = {} } = await api.storage.local.get('authTabs');
  let authTab;
  if (Number.isInteger(authTabs[spec.origin])) {
    try { const tab = await api.tabs.get(authTabs[spec.origin]); if (new URL(tab.url).origin === spec.origin) authTab = tab.id; } catch {}
  }
  const check = () => { if (state.cancelled || state.cancelledIds.has(requestId)) throw new Error('connector_cancelled'); };
  check();
  const operation = { cancel: () => { cancelFetch(requestId); if (authTab !== undefined) void api.scripting.executeScript({ target: { tabId: authTab }, func: cancelFetch, args: [requestId] }).catch(() => {}); } };
  state.operations.set(requestId, operation);
  let release, rule;
  try {
    if (authTab !== undefined) {
      // Origin is supplied by the real source page. Never copy its cookies to the reader.
      const rows = await api.scripting.executeScript({ target: { tabId: authTab }, func: boundedFetch, args: [{ ...spec, inTab: true }, requestId] });
      check();
      if (!rows[0]?.result || rows[0].error) throw new Error('connector_auth_fetch_failed');
      return rows[0].result;
    }
    if (Object.keys(spec.special).length) {
      const previous = headerQueue;
      headerQueue = new Promise(resolve => { release = resolve; });
      await previous; check();
      rule = ++nextRule;
      const extensionHost = new URL(api.runtime.getURL('/')).hostname;
      await api.declarativeNetRequest.updateSessionRules({ addRules: [{ id: rule, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: Object.entries(spec.special).map(([header,value]) => ({ header, operation: 'set', value })) },
        condition: { regexFilter: '^' + spec.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', initiatorDomains: [extensionHost], resourceTypes: ['xmlhttprequest'] } }] });
    }
    check();
    return await boundedFetch(spec, requestId);
  } finally {
    state.operations.delete(requestId);
    if (rule) await api.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rule] }).catch(() => {});
    release?.();
  }
}
function stop(state) { state.cancelled = true; for (const op of state.operations.values()) op.cancel(); }
api.runtime.onConnect.addListener(port => {
  if (port.name !== 'moya-connector-v1' || !isReader(port.sender, readers)) { port.disconnect(); return; }
  const jobs = new Map(), operations = new Map(), inflight = new Set();
  const state = { operations, cancelledIds: new Set(), cancelled: false }; sessions.add(state);
  const send = value => { try { port.postMessage(value); } catch {} };
  function end(token) { const job = jobs.get(token); if (job) { stop(job); clearTimeout(job.timer); jobs.delete(token); } }
  port.onDisconnect.addListener(() => { stop(state); for (const key of jobs.keys()) end(key); sessions.delete(state); });
  port.onMessage.addListener(async message => {
    const { id, type } = message ?? {};
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || inflight.has(id) || inflight.size >= 16) return;
    inflight.add(id);
    try {
      let value;
      if (type === 'hello') value = { version: 1, name: 'Moya Browser Connector', appVersion: '0.1.1', capabilities: ['http-head-range-user-agent'] };
      else if (type === 'cancel') { const target = jobs.get(message.token) ?? state; if (inflight.has(message.requestId)) { target.cancelledIds.add(message.requestId); target.operations.get(message.requestId)?.cancel(); } value = { ok: true }; }
      else if (type === 'end') { end(message.token); value = { ok: true }; }
      else if (type === 'begin') {
        if (jobs.size >= 4 || !['metadata','preferences','list','detail','chapters','pages','html','headers'].includes(message.action)) throw new Error('runtime_busy');
        const token = crypto.randomUUID();
        const timeout = message.action === 'chapters' ? 600000 : ['pages','html'].includes(message.action) ? 150000 : 30000;
        const job = { operations: new Map(), cancelledIds: new Set(), pending: 0, cancelled: false, calls: 0, bytes: 0, action: message.action, timer: setTimeout(() => end(token), timeout) };
        jobs.set(token, job); value = { token };
      } else if (type === 'http' || type === 'image') {
        const image = type === 'image', job = image ? state : jobs.get(message.token);
        if (!job || job.cancelled) throw new Error('runtime_expired');
        if (image ? activeImages >= 3 : ['metadata','preferences'].includes(job.action) || job.pending >= 4 || ++job.calls > 240) throw new Error('runtime_busy');
        const spec = requestSpec(message.request, image);
        if (image) activeImages++; else job.pending++;
        try {
          value = await transport(spec, id, job);
          if (!image && (job.bytes += value.size) > limits.job) { end(message.token); throw new Error('source_body_limit'); }
          if ([401,403].includes(value.statusCode)) await remember(spec.origin, true);
        } catch (error) { if (error.message === 'source_access_denied') await remember(spec.origin, true); throw error; }
        finally { if (image) activeImages--; else job.pending--; job.cancelledIds.delete(id); }
      } else throw new Error('permission_denied');
      send({ id, value });
    } catch (error) { send({ id, error: /^[a-z_]+$/.test(error.message) ? error.message : 'connector_failed' }); }
    finally { inflight.delete(id); }
  });
});
// Configuration messages only from the packaged popup, never a website content script.
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.tab || sender.url !== api.runtime.getURL('popup.html') || message?.type !== 'open-auth') return;
  (async () => {
    const url = sourceUrl(message.origin); await permission(url.origin);
    const tab = await api.tabs.create({ url: url.origin + '/', active: true });
    const { authTabs = {} } = await api.storage.local.get('authTabs');
    authTabs[url.origin] = tab.id;
    await api.storage.local.set({ authTabs }); return { ok: true };
  })().then(respond, () => respond({ error: 'connector_failed' }));
  return true;
});

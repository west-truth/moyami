import { downloadSettings, initializeDownloads } from '/download-settings.js';
import { queueProgress } from '/account-sync.js';
import { localStorage, indexedDB } from "/account-storage.js";
import { connectorMode, connectorCall } from "/connector.js";
import { assignImage, hydrateImages, disposeImages, prefetchImages, clearImageCache } from "/connector-images.js";
import { runBrowserSource } from "/source-runtime.js";
import { maximumRequestBytes } from "/host-config.js";
import { createNovelReader } from "/novel-reader.js";
import { renderLibraryHome } from "/library-home.js";
import { createSourceManager } from "/source-manager.js";
import { createMetadataCache, metadataCacheLifetime } from "/metadata-cache.js";
import { localCache, clearContentCache, trimContentCache } from "/local-cache.js";
import { coverKey, saveCover, clearCovers } from "/cover-cache.js";
import { createComicReader } from "/comic-reader.js";
import { initializeUI, updateScreen, updateSourceTitle } from "/ui.js";
import { expectScreen, showPending, hidePending, enterScreen, fadeInImages, checkedLabel } from "/transitions.js";
import { mountWorkView, mountFilters, mountReleases, mountPreferences, mountQuickJump, mountAutoReading, BrowserNavigation } from "/moya-ui.js";
const $ = (id) => document.getElementById(id);
const generatedClientId = () =>
  crypto.randomUUID?.() ||
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
const clientId =
  localStorage.getItem("moya-source-client-id") || generatedClientId();
localStorage.setItem("moya-source-client-id", clientId);
let preferences = {},
  retryOperation = null,
  view = "browse",
  requestNo = 0,
  currentChapters = [],
  currentWork = null,
  readerCleanup = null,
  invocationQueue = Promise.resolve(),
  activeInvocation = null,
  sourceGate = Promise.resolve(),
  browseState = {
    mode: "popular",
    query: "",
    page: 1,
    filters: [],
    hasNext: false,
  },
  selected = {
    repositoryUrl: "",
    sourceId: "",
    sourceName: "확장 소스",
    itemType: 0,
  };
const metadataCache = createMetadataCache({ persistence: localCache('metadata-v3') });
const catalogs = localCache('catalog-v2');
// Chapter bodies stay in this tab only; signed URLs are deliberately short-lived.
const chapterCache = createMetadataCache({ maxEntries: 6, maxBytes: 8 * 1024 * 1024 });
let warmTimer, warmController, warmInvocation, loadingMore = false;
function stopWarmup() {
  clearTimeout(warmTimer); warmController?.abort(); warmController = null;
  warmInvocation?.abort();
}
function scheduleWarmup(task) {
  stopWarmup();
  if (!downloadSettings().prefetch || document.hidden || !navigator.onLine || navigator.connection?.saveData || /(^|-)2g$/.test(navigator.connection?.effectiveType || '')) return;
  const controller = new AbortController(); warmController = controller;
  const key = stateKey(), screen = view;
  warmTimer = setTimeout(async () => {
    if (controller.signal.aborted || activeInvocation || key !== stateKey() || screen !== view) return;
    try { await task(controller.signal); } catch { /* Speculation never replaces the current screen with an error. */ }
  }, 800);
}
addEventListener('visibilitychange', () => { if (document.hidden) stopWarmup(); });
async function warmChapter(chapter, signal, page = 1) {
  if (!chapter) return;
  signal.throwIfAborted();
  const chapterUrl = field(chapter, ['url', 'link']);
  const novel = selected.itemType === 2;
  const result = await invoke(novel ? 'html' : 'pages', novel ? { title: field(chapter, ['name','title']), chapterUrl } : {chapterUrl}, {background:true, signal});
  signal.throwIfAborted();
  if (!novel) await prefetchImages(records(result).slice(Math.max(0,page-1), Math.max(0,page-1)+downloadSettings().pages).map(row => row.imageUrl), signal);
}
function warmRecent() {
  if (!selected.sourceId) return;
  scheduleWarmup(async signal => {
    const list = await invoke('list', {page:1, mode:'popular', filters:[]}, {background:true, signal});
    const item = allRecent().find(item => item.repositoryUrl === selected.repositoryUrl && item.sourceId === selected.sourceId);
    if (item) {
      const work = await invoke('detail', {workUrl:item.url}, {background:true, signal});
      const chapter = records(work.chapters || work.episodes).find(row => field(row,['url','link']) === item.chapterUrl);
      if (chapter) { const progress = await progressGet(item.chapterUrl); await warmChapter(chapter,signal,Number(progress.page)||1); }
    }
    await prefetchImages(records(list).slice(0,6).map(row => row.imageUrl), signal);
  });
}

let filterDraft = [];
async function fetchCatalog(repositoryUrl, signal, refresh = false) {
  const fetchFresh = async () => {
    const catalog = await api('/api/catalog', { method:'POST', body:JSON.stringify({repositoryUrl}), signal });
    signal?.throwIfAborted();
    await catalogs.set(repositoryUrl, { catalog, fetchedAt:Date.now() }, Date.now() + 7 * 86400_000);
    return catalog;
  };
  if (!refresh) {
    const cached = await catalogs.get(repositoryUrl);
    signal?.throwIfAborted();
    if (cached?.catalog?.sources?.length) {
      // Refresh for the next activation; never reset a screen the user has since opened.
      if (Date.now() - cached.fetchedAt > 10 * 60_000) void fetchFresh().catch(() => {});
      return cached.catalog;
    }
  }
  return fetchFresh();
}
const metadataTimes = new WeakMap();
let appNavigation, listResult, listSourceKey, detailResult, activeChapter, catalogSources = [], catalogAbort, autoViewport, releaseGeneration = 0, sourceManager, noticeTimer;
addEventListener("moya-settings-open", event => { if (event.detail === "sources") sourceManager?.open(); });
function syncAutoReading(...args) {
  const adapter = args.length ? args[0] : autoViewport;
  autoViewport = adapter;
  if (view !== "reader" || !activeChapter || !currentWork) { mountAutoReading($("autoReadingRoot"), null); return; }
  const next = currentChapters[activeChapter.index - 1];
  mountAutoReading($("autoReadingRoot"), {
    workKey: `${stateKey()}:${currentWork.url}`, scope: activeChapter.url, kind: selected.itemType === 2 ? "text" : "comic", adapter,
    nextChapter: next ? { scope: field(next, ["url", "link"]), open: async isCurrent => { if (isCurrent()) await openReader(field(next, ["url", "link"]), activeChapter.index - 1); } } : undefined,
  });
}
addEventListener("moya-reader-layout", () => syncAutoReading());
function navigationLayers() {
  return [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].map(node=>node.id || node.closest('#quickJumpRoot,#autoReadingRoot')?.id).filter(Boolean);
}
function restoreLayers(saved) {
  for(const node of document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')) {
    const id=node.id||node.closest('#quickJumpRoot,#autoReadingRoot')?.id;
    if(!saved.layers?.includes(id)){if(node.tagName==='DIALOG')node.close();else node.querySelector('header button')?.click();}
  }
  for(const id of saved.layers||[]) {
    if(id==='quickJumpRoot'&&!$(id).querySelector('[role=dialog]'))$('quickJump').click();
    else if(id==='autoReadingRoot'&&!$(id).querySelector('[role=dialog]'))$('readerAuto').click();
    else if(id==='settingsDialog'&&!$(id).open)document.querySelector(`[data-settings="${saved.settingsTab||'reader'}"]`)?.click();
    else if($(id)?.tagName==='DIALOG'&&!$(id).open)$(id).showModal();
  }
}
function navigationSnapshot() {
  const snapshot = {
    layers:navigationLayers(),settingsTab:document.querySelector('.settings-tabs [aria-current="true"]')?.dataset.settings,
    errorText:$("errorText").textContent, updateRequired:!$("acceptUpdate").hidden,
    view, selection: { ...selected }, browseState: structuredClone(browseState),
    listResult, listSourceKey, detailResult, currentWork, currentChapters, activeChapter,
    scroll: scrollY, query: $("query").value,
  };
  return {
    key: JSON.stringify([stateKey(), view, view === "browse" ? browseState : view === "reader" ? activeChapter?.url : currentWork?.url, snapshot.layers]),
    snapshot,
  };
}
function rememberNavigation() {
  if (!["browse", "recent", "detail", "reader", "error"].includes(view)) return;
  const entry = navigationSnapshot();
  if (appNavigation) { appNavigation.record(entry); return; }
  appNavigation = new BrowserNavigation({
    window, initial: entry, capture: navigationSnapshot,
    closesLayer:(from,to)=>from.view===to.view&&from.activeChapter?.url===to.activeChapter?.url&&from.selection.sourceId===to.selection.sourceId&&from.selection.repositoryUrl===to.selection.repositoryUrl&&from.currentWork?.url===to.currentWork?.url&&JSON.stringify(from.browseState)===JSON.stringify(to.browseState)&&from.layers?.length>to.layers?.length,
    replacesEntry:(from,to)=>from.view==='reader'&&['reader','detail'].includes(to.view)&&!from.layers?.length&&!to.layers?.length&&from.selection.sourceId===to.selection.sourceId&&from.selection.repositoryUrl===to.selection.repositoryUrl&&from.currentWork?.url===to.currentWork?.url,
    cancelPending: cancelInvocation, onError: fail,
    settled: () => new Promise(resolve => requestAnimationFrame(resolve)),
    restore: async (saved, signal) => {
      const current=navigationSnapshot().snapshot;
      const sameScreen=saved.view===view&&saved.selection.repositoryUrl===selected.repositoryUrl&&saved.selection.sourceId===selected.sourceId&&saved.activeChapter?.url===activeChapter?.url&&saved.currentWork?.url===currentWork?.url&&JSON.stringify(saved.browseState)===JSON.stringify(browseState);
      if(sameScreen){restoreLayers(saved);return;}
      restoreLayers({layers:[]});
      if (saved.selection.repositoryUrl !== selected.repositoryUrl || saved.selection.sourceId !== selected.sourceId)
        await loadCatalog(saved.selection.repositoryUrl, false, saved.selection.sourceId, signal);
      signal.throwIfAborted();
      browseState = structuredClone(saved.browseState);
      listSourceKey = saved.listSourceKey;
      listResult = listSourceKey === stateKey() ? saved.listResult : undefined; detailResult = saved.detailResult;
      currentWork = saved.currentWork; currentChapters = saved.currentChapters;
      activeChapter = saved.activeChapter;
      $("query").value = saved.query;
      if (saved.view === "reader") await openReader(activeChapter.url, activeChapter.index);
      else if (saved.view === "recent") { show("recent"); renderRecent(); warmRecent(); }
      else if (saved.view === "error") { $("errorText").textContent=saved.errorText; $("acceptUpdate").hidden=!saved.updateRequired; show("error"); }
      else if (saved.view === "detail") renderDetail(detailResult, currentWork.url);
      else if (listResult && listSourceKey === stateKey()) renderWorks(listResult, browseTitle(browseState.mode, browseState.query));
      else await popular();
      signal.throwIfAborted();
      restoreLayers(saved);
      if (saved.view !== "reader") requestAnimationFrame(() => { if (!signal.aborted) scrollTo(0, saved.scroll); });
    },
  });
}
let previousLayers='[]';
new MutationObserver(()=>{const layers=JSON.stringify(navigationLayers());if(layers!==previousLayers){previousLayers=layers;rememberNavigation();}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
const labels = {
  connector_not_installed: "연결 확장을 설치하고 이 사이트에서 켠 뒤 새로고침하세요.",
  connector_disconnected: "브라우저 연결이 끊겼습니다. 다시 시도하세요.",
  connector_permission_required: "연결 확장 아이콘을 열어 요청한 사이트를 허용한 뒤 다시 시도하세요.",
  connector_header_unsupported: "이 소스의 요청 헤더는 브라우저 연결에서 아직 지원하지 않습니다.",
  connector_auth_fetch_failed: "원본 인증 탭을 확인한 뒤 다시 시도하세요.",
  connector_timeout: "브라우저 연결 응답이 늦습니다. 원본 탭과 확장 권한을 확인하세요.",
  connector_failed: "브라우저 연결에 실패했습니다. 확장 권한을 확인하세요.",
  source_connection_failed: "원본에 연결하지 못했습니다. 원본 사이트가 브라우저에서 열리는지 확인하세요.",
  execution_failed: "확장 실행에 실패했습니다.",
  source_failed: "소스를 불러오지 못했습니다.",
  source_request_timeout: "소스 응답 시간이 초과됐습니다.",
  source_access_denied: "원본 사이트가 접근을 거부했습니다.",
  source_browser_unavailable: "이 소스는 별도의 브라우저 실행 기능이 필요합니다.",
  source_browser_required: "이 소스는 WebView 실행이 필요해 지원하지 않습니다. 브라우저 연결 확장으로도 WebView를 실행할 수 없습니다.",
  source_worker_failed: "브라우저의 확장 실행기를 시작하지 못했습니다. 최신 브라우저에서 다시 시도하세요.",
  execution_timeout: "처리 시간이 초과됐습니다. 다시 시도하세요.",
  runtime_busy: "요청이 많습니다. 잠시 후 다시 시도하세요.",
  runtime_expired: "요청이 만료됐습니다. 다시 시도하세요.",
  runtime_store_unavailable: "작업 연결을 확인하지 못했습니다. 잠시 후 다시 시도하세요.",
  payload_limit: "전송할 데이터가 서버의 허용 크기를 초과했습니다.",
  image_expired: "이미지 주소가 만료됐습니다.",
  source_digest_changed:
    "확장 코드가 바뀌었습니다. 출처를 확인한 뒤 업데이트를 허용하세요.",
  source_session_expired: "원본 사이트 세션이 만료되어 새로 연결합니다.",
  source_lock_unavailable:
    "여러 탭의 상태를 안전하게 저장하려면 HTTPS 또는 localhost로 접속하세요.",
  access_denied: "접근 키를 확인하세요.",
};
function esc(value) {
  const node = document.createElement("span");
  node.textContent = String(value ?? "");
  return node.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function imageAttribute(url) {
  return url?.startsWith('moya-image:') ? `data-moya-image="${esc(url)}"` : `src="${esc(url)}"`;
}
function records(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["list", "items", "mangas", "results"])
      if (Array.isArray(value[key])) return value[key];
  }
  return [];
}
function field(row, names) {
  for (const name of names)
    if (typeof row?.[name] === "string" && row[name]) return row[name];
  return "";
}
function readSelection() {
  try {
    return JSON.parse(localStorage.getItem("moya-source-selection") || "null");
  } catch {
    return null;
  }
}
function readRepositories() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("moya-source-repositories") || "[]",
    );
    return [
      ...new Set(Array.isArray(saved) ? saved : []),
    ]
      .filter(
        (value) => typeof value === "string" && value.startsWith("https://"),
      )
      .slice(0, 20);
  } catch {
    return [];
  }
}
function saveRepositories(repositories) {
  localStorage.setItem(
    "moya-source-repositories",
    JSON.stringify(repositories.slice(0, 20)),
  );
}
function show(name) {
  if (name !== "reader") document.body.classList.remove("immersive");
  if (name !== "reader" && readerCleanup) {
    readerCleanup();
    readerCleanup = null;
  }
  for (const id of ["login", "browse", "recent", "detail", "reader", "error"])
    $(id).hidden = id !== name;
  const previous = view;
  view = name;
  enterScreen(name, previous);
  if (name !== "reader") { autoViewport = undefined; mountAutoReading($("autoReadingRoot"), null); }
  if (name === "reader") rememberRecent();
  if (name === "detail") refreshReleases();
  updateScreen(name);
  $("back").hidden = !["detail", "reader", "error"].includes(name);
  if (["error", "login"].includes(name)) $("settingsDialog").close();
  scrollTo(0, 0);
  rememberNavigation();
}
function focusReaderContent(node) {
  if (navigationLayers().length) return;
  node.tabIndex = -1;
  node.focus({preventScroll:true});
}
let pendingTimer;
function busy(text = "", kind = "") {
  clearTimeout(pendingTimer);
  // Before the first screen renders every section is hidden: show the destination's placeholder.
  if (text) showPending(kind, $(view).hidden ? "" : view);
  // A follow-up request (catalog, then list) keeps the same placeholder instead of flashing.
  else { delete document.body.dataset.pending; pendingTimer = setTimeout(hidePending, 60); }
  // While another screen is opening, the back button cancels it.
  $("back").hidden = !(["detail", "reader", "error"].includes(view) || (text && !$(view).hidden && !["refresh", "task"].includes(document.body.dataset.pending)));
  $("activity").textContent = "";
  $("loadingStatus").hidden = !text;
  $("loadingMessage").textContent = text;
  $("settingsBusy").hidden = !text; $("settingsBusy").textContent = text;
  $("workspaceContent").setAttribute("aria-busy", String(Boolean(text)));
  $("workspaceContent").inert = Boolean(text);
}
function notice(message) {
  clearTimeout(noticeTimer);
  for (const id of ["notice","settingsNotice"]) { $(id).textContent = message; $(id).hidden = false; }
  noticeTimer = setTimeout(() => { $("notice").hidden = true; $("settingsNotice").hidden = true; }, 5000);
}
async function api(path, options = {}) {
  if (typeof options.body === "string" && new TextEncoder().encode(options.body).length > maximumRequestBytes)
    throw new Error("payload_limit");
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({ error: response.status === 413 ? "payload_limit" : "source_failed" }));
  if (!response.ok) {
    const error = new Error(data.error || "source_failed");
    error.status = response.status;
    if (response.status === 401) dispatchEvent(new Event("moyami-session-expired"));
    throw error;
  }
  return data;
}
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("moya-source-lite", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("state"))
        request.result.createObjectStore("state");
      if (!request.result.objectStoreNames.contains("progress"))
        request.result.createObjectStore("progress");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const stateKey = () => `${selected.repositoryUrl}\n${selected.sourceId}`;
const progressKey = (chapterUrl, sourceKey = stateKey()) => `${sourceKey}\n${chapterUrl}`;
const digestKey = () => `moya-source-digest:${stateKey()}`;
const recentKey = () => `moya-source-recent:${stateKey()}`;
function readRecent() {
  try {
    const items = JSON.parse(localStorage.getItem(recentKey()) || "[]");
    return Array.isArray(items) ? items.slice(0, 20) : [];
  } catch {
    return [];
  }
}
function allRecent() {
  const result = [];
  for (let i=0; i<localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("moya-source-recent:")) continue;
    const [repositoryUrl, sourceId] = key.slice("moya-source-recent:".length).split("\n");
    try {
      const rows = JSON.parse(localStorage.getItem(key));
      if (!Array.isArray(rows)) continue;
      for (const row of rows) if (row && typeof row.url === "string") result.push({ ...row, repositoryUrl, sourceId });
    } catch {}
  }
  return result.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0,100);
}
function renderRecent() {
  if (view !== "recent") return;
  renderLibraryHome(allRecent(), {open: item => openRecent(item), resume: item => openRecent(item,true), remove: removeRecent});
}
function removeRecent(item) {
  const key = `moya-source-recent:${item.repositoryUrl}\n${item.sourceId}`;
  try {
    const rows = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify(rows.filter(row => row.url !== item.url)));
    renderRecent(); warmRecent();
  } catch (error) { fail(error); }
}
async function openRecent(item, resume = false) {
  stopWarmup();
  rememberNavigation();
  expectScreen({ screen: "detail", title: item.title, imageUrl: item.imageUrl, source: item.sourceName });
  try {
    if (item.repositoryUrl !== selected.repositoryUrl || item.sourceId !== selected.sourceId) {
      await sourceGate.catch(() => {}); await invocationQueue.catch(() => {});
      await loadCatalog(item.repositoryUrl,false,item.sourceId);
    }
    await openDetail(item.url);
    if (resume && view === "detail" && currentWork?.url === item.url) $("continueReading").click();
  } catch (error) { fail(error); }
}
function rememberRecent() {
  if (!currentWork?.url) return;
  const previous = readRecent().find(item => item.url === currentWork.url);
  const items = readRecent().filter((item) => item.url !== currentWork.url);
  items.unshift({
    url: currentWork.url.slice(0, 8192), title: currentWork.title.slice(0, 500),
    imageUrl: currentWork.imageUrl || previous?.imageUrl, author: currentWork.author || previous?.author, sourceName: selected.sourceName,
    chapterUrl: activeChapter?.url, chapterTitle: field(currentChapters[activeChapter?.index], ["name","title"]),
    updatedAt: Date.now(),
  });
  localStorage.setItem(recentKey(), JSON.stringify(items.slice(0, 20)));
}
async function stateGet(key = stateKey()) {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction("state");
    const request = tx.objectStore("state").get(key);
    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => resolve({});
  });
}
async function stateSet(value, key = stateKey()) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite");
    tx.objectStore("state").put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function progressGet(chapterUrl, sourceKey = stateKey()) {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction("progress");
    const request = tx.objectStore("progress").get(progressKey(chapterUrl, sourceKey));
    request.onsuccess = () => resolve(request.result || {});
    request.onerror = () => resolve({});
  });
}
async function progressSet(chapterUrl, value, sourceKey = stateKey()) {
  return navigator.locks.request(`moya-progress:${sourceKey}`, async () => {
    const db = await openDb();
    const key = progressKey(chapterUrl, sourceKey);
    const progress = { ...value, updatedAt: Date.now() };
    await new Promise((resolve, reject) => {
      const tx = db.transaction("progress", "readwrite");
      tx.objectStore("progress").put(progress, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    queueProgress(sourceKey, chapterUrl, progress);
    const entries = await new Promise((resolve) => {
      const tx = db.transaction("progress");
      const store = tx.objectStore("progress");
      const keys = store.getAllKeys();
      const values = store.getAll();
      tx.oncomplete = () =>
        resolve(keys.result.map((item, index) => [item, values.result[index]]));
      tx.onerror = () => resolve([]);
    });
    if (entries.length > 200) {
      entries.sort((a, b) => (a[1]?.updatedAt || 0) - (b[1]?.updatedAt || 0));
      await new Promise((resolve) => {
        const tx = db.transaction("progress", "readwrite");
        for (const [oldKey] of entries.slice(0, entries.length - 200))
          tx.objectStore("progress").delete(oldKey);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }
  });
}
async function withSourceLock(key, task, signal) {
  if (!navigator.locks) throw new Error("source_lock_unavailable");
  return navigator.locks.request(`moya-source:${key}`, signal ? { signal } : {}, task);
}
function merge(changes, state, key) {
  for (const [key, value] of Object.entries(changes || {})) {
    if (value === null) delete state[key];
    else state[key] = value;
  }
  return stateSet(state, key);
}
function cancelInvocation() {
  stopWarmup();
  activeInvocation?.abort();
  requestNo++;
  busy("");
}
async function invoke(action, params = {}, { refresh = false, background = false, signal, quiet = false } = {}) {
  if (!background) stopWarmup();
  signal?.throwIfAborted();
  const source = { ...selected };
  const key = stateKey();
  const digestStorageKey = digestKey();
  const id = ++requestNo;
  const before = invocationQueue;
  let release;
  invocationQueue = new Promise((resolve) => (release = resolve));
  await before.catch(() => {});
  const abort = new AbortController();
  activeInvocation = abort;
  if (background) warmInvocation = abort;
  const cancel = () => abort.abort();
  signal?.addEventListener("abort", cancel, {once:true});
  if (signal?.aborted) abort.abort();
  if (!background && !quiet) busy(({pages:"회차 이미지를 준비하는 중…",html:"본문을 불러오는 중…",detail:"작품 정보와 회차를 불러오는 중…",list:"작품을 불러오는 중…",preferences:"소스 설정을 확인하는 중…"})[action] || "불러오는 중…", action);
  try {
    if (id !== requestNo || key !== stateKey()) throw new DOMException("stale", "AbortError");
    const execute = async () => {
      abort.signal.throwIfAborted();
      const state = await stateGet(key);
      await metadataCache.ready;
      // Filter application may save provider tab rules: execute it even for identical inputs.
      const chapter = action === 'pages' || action === 'html';
      const cache = chapter ? chapterCache : metadataCache;
      const cacheable = chapter || (action === 'list' && params.mode !== 'filter') || action === 'detail';
      const cacheKey = () => JSON.stringify([key, source.version, connectorMode(), localStorage.getItem(digestStorageKey),
        Number(state.__moya_lite_preference_revision) || 0, action, params]);
      const startedAt = Date.now();
      if (cacheable) {
        if (refresh) cache.delete(cacheKey());
        else {
          const cached = cache.get(cacheKey());
          if (cached !== undefined) {
            preferences = state;
            if (cached.result && typeof cached.result === 'object') metadataTimes.set(cached.result, cached.fetchedAt);
            return { result: cached.result };
          }
        }
      }
      const data = await runBrowserSource({
        repositoryUrl: source.repositoryUrl,
        sourceId: source.sourceId,
        action, params, preferences: state,
        codeDigest: localStorage.getItem(digestStorageKey) || undefined,
        clientId,
      }, api, abort.signal);
      abort.signal.throwIfAborted();
      if (id !== requestNo || key !== stateKey()) throw new DOMException("stale", "AbortError");
      if (typeof data.codeDigest === "string")
        localStorage.setItem(digestStorageKey, data.codeDigest);
      if (action === 'list' && params.mode === 'filter') {
        state.__moya_lite_preference_revision = (Number(state.__moya_lite_preference_revision) || 0) + 1;
      }
      await merge(data.changes, state, key);
      abort.signal.throwIfAborted();
      if (id !== requestNo || key !== stateKey()) throw new DOMException("stale", "AbortError");
      if (stateKey() === key) preferences = state;
      if (cacheable) {
        await cache.set(cacheKey(), { result: data.result, fetchedAt: startedAt },
          startedAt + (chapter ? 2 * 60_000 : metadataCacheLifetime(action, params, connectorMode(), data.result)));
        if (data.result && typeof data.result === 'object') metadataTimes.set(data.result, startedAt);
      }
      return data;
    };
    const data = await withSourceLock(key, execute, abort.signal);
    if (id !== requestNo || key !== stateKey())
      throw new DOMException("stale", "AbortError");
    return data.result;
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (warmInvocation === abort) warmInvocation = null;
    if (activeInvocation === abort) activeInvocation = null;
    release();
    if (!background && !quiet && id === requestNo) busy("");
  }
}
function fail(error) {
  if (error?.name === "AbortError") return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  $("errorText").textContent = !navigator.onLine
    ? '오프라인입니다. 저장된 최근 읽기와 목록을 볼 수 있으며, 새 회차를 불러오려면 인터넷에 연결해야 합니다.'
    : standalone && error.message === 'connector_not_installed'
      ? '이 앱 창에서 연결 확장을 찾지 못했습니다. 연결 확장을 켠 브라우저의 일반 탭에서 모야를 열어 주세요.'
      : labels[error.message] || `오류: ${error.message || "source_failed"}`;
  $("acceptUpdate").hidden = error.message !== "source_digest_changed";
  show(error.status === 401 ? "login" : "error");
}
function renderFilters(definitions = []) {
  filterDraft = structuredClone(browseState.filters);
  mountFilters($("filters"), definitions, filterDraft, (change) => {
    filterDraft = filterDraft.filter(item => item.position !== change.position || item.groupPosition !== change.groupPosition);
    filterDraft.push(change);
  });
}
function renderMetadataTime(id, result) {
  const time = metadataTimes.get(result);
  $(id).hidden = !time;
  $(id).textContent = time ? checkedLabel(time) : '';
  $(id).title = time ? `${new Date(time).toLocaleString('ko-KR')}에 확인한 정보입니다. 상단 새로고침으로 최신 정보를 불러옵니다.` : '';
}
function renderWorks(result, title, append = false) {
  listResult = result;
  listSourceKey = stateKey();
  renderMetadataTime('browseUpdatedAt', result);
  const works = records(result);
  const filters = result?.browse?.filters || [];
  const modes = result?.browse?.availableModes || ["popular", "search"];
  browseState.hasNext = result?.hasNextPage === true;
  $("listTitle").textContent = title;
  $("browseCount").textContent = `${works.length}개 작품`;
  $("loadMore").hidden = !browseState.hasNext;
  $("loadMoreStatus").textContent = "";
  $("latest").disabled = !modes.includes("latest");
  $("popular").setAttribute("aria-pressed", String(browseState.mode === "popular"));
  $("latest").setAttribute("aria-pressed", String(browseState.mode === "latest"));
  $("filterPanel").hidden = filters.length === 0;
  $("clearBrowse").hidden = !["search", "filter"].includes(browseState.mode);
  $("clearBrowse").textContent = browseState.mode === "filter" ? "필터 해제" : "검색 지우기";
  renderWorkCards(append ? works.slice($("works").querySelectorAll(".card").length) : works, append);
  if (!append) { renderFilters(filters); show("browse"); }
  else rememberNavigation();
}
function renderWorkCards(works, append = false) {
  if (!append) disposeImages($("works"));
  if (!append) $("works").innerHTML = works.length
    ? ""
    : '<p class="loadingCard">표시할 작품이 없습니다.</p>';
  for (const work of works) {
    const button = document.createElement("button");
    button.className = "card discovery-card";
    button.setAttribute("aria-label", `${field(work, ["name", "title"]) || "제목 없음"} 상세 보기`);
    const cover = $("works").dataset.view === "text" ? "" : `<span class="discovery-cover">${work.imageUrl ? `<img loading="lazy" decoding="async" ${imageAttribute(work.imageUrl)} alt="">` : '<span class="cover-placeholder">표지 없음</span>'}</span>`;
    button.innerHTML = `${cover}<span class="discovery-card-copy"><strong>${esc(field(work, ["name", "title"]) || "제목 없음")}</strong><span class="discovery-card-description">${esc(field(work, ["author", "subtitle"]))}</span></span>`;
    button.onclick = () => openDetail(field(work, ["link", "url"]));
    $("works").append(button);
    fadeInImages(button);
    hydrateImages(button);
  }
}
async function browse(mode, page = 1, query = "", refresh = false, propagate = false) {
  if (!selected.sourceId) { showEmptyLibrary(); return; }
  rememberNavigation();
  retryOperation = () => browse(mode, page, query, true);
  try {
    await sourceGate.catch(() => {});
    browseState = { ...browseState, mode, page, query };
    const params = { page, mode, filters: ["filter", "search"].includes(mode) ? browseState.filters : [] };
    if (mode === "search") params.query = query;
    renderWorks(await invoke("list", params, { refresh }), browseTitle(mode, query));
  } catch (error) {
    if (propagate) throw error;
    fail(error);
  }
}
function browseTitle(mode, query = "") {
  return mode === "search" ? `검색 결과 · ${query}` : mode === "latest" ? "최신" : mode === "filter" ? "필터 결과" : "인기";
}
const popular = () => browse("popular", 1);
const search = (query) => browse("search", 1, query);
async function loadPreferences() {
  mountPreferences($("sourcePreferences"), null, null);
  const optionSourceKey = stateKey();
  const specs = records(await invoke("preferences"));
  const revisionKey = "__moya_lite_preference_revision";
  const manager = {
    preferences: async () => {
      const state = await stateGet(optionSourceKey);
      return { revision: Number(state[revisionKey]) || 0, privateOrigins: [], networkPolicy: "direct",
        fields: specs.map(spec => ({ ...spec, value: state[spec.key] ?? spec.value })) };
    },
    savePreferences: async (_id, revision, changes) => withSourceLock(optionSourceKey, async () => {
      const state = await stateGet(optionSourceKey);
      if ((Number(state[revisionKey]) || 0) !== revision) throw new Error("preference_conflict");
      for (const [key, value] of Object.entries(changes)) {
        if (!specs.some(spec => spec.key === key) || key === revisionKey) throw new Error("invalid_preference");
        if (typeof value === "string" && value.length > 2048) throw new Error("invalid_preference");
        state[key] = value;
      }
      state[revisionKey] = revision + 1;
      await stateSet(state, optionSourceKey);
      metadataCache.clear();
      if (stateKey() === optionSourceKey) preferences = state;
    }),
  };
  mountPreferences($("sourcePreferences"), optionSourceKey, manager);
}
async function openDetail(workUrl, refresh = false) {
  if (!workUrl) return;
  rememberNavigation();
  retryOperation = () => openDetail(workUrl, true);
  try {
    await sourceGate.catch(() => {});
    const listed = listSourceKey === stateKey() ? records(listResult).find(row => field(row, ["link", "url"]) === workUrl) : undefined;
    const recent = readRecent().find(row => row.url === workUrl);
    expectScreen({ title: field(listed, ["name", "title"]) || recent?.title, imageUrl: listed?.imageUrl || recent?.imageUrl, source: selected.sourceName });
    const work = await invoke("detail", { workUrl }, { refresh });
    renderDetail(work, workUrl);
  } catch (error) {
    fail(error);
  }
}
function renderDetail(work, workUrl) {
    detailResult = work;
    renderMetadataTime('detailUpdatedAt', work);
    const listed = listSourceKey === stateKey() ? records(listResult).find(row => field(row, ['url','link']) === workUrl) : undefined;
    const recent = readRecent().find(row => row.url === workUrl);
    currentWork = {
      url: workUrl,
      title: field(work, ["name", "title"]) || "제목 없음",
      imageUrl: work.imageUrl || listed?.imageUrl || recent?.imageUrl, author: field(work,["author","artist"]) || recent?.author,
    };
    currentChapters = records(work.chapters || work.episodes);
    const actions = $("detailActions");
    $("workInfo").innerHTML =
      `<div class="detail-hero-cover">${currentWork.imageUrl ? `<img ${imageAttribute(currentWork.imageUrl)} alt="">` : '<span class="cover-placeholder">표지 없음</span>'}</div><div class="detail-hero-copy"><span class="detail-status">${esc(selected.sourceName)}</span><h1>${esc(currentWork.title)}</h1><p class="detail-byline">${esc(metadataText(work.author))}</p></div>`;
    // The primary action sits beside the cover; the description follows so long synopses never push it away.
    $("workInfo").querySelector(".detail-hero-copy").append(actions);
    renderDescription(work.description);
    const cover = $('workInfo').querySelector('img'), key = coverKey(stateKey(), workUrl);
    if (cover) {
      cover.addEventListener('load', () => { void saveCover(key, cover); }, {once:true});
      if (cover.complete && cover.naturalWidth) void saveCover(key, cover);
    }
    renderMetadata(work);
    fadeInImages($("workInfo"));
    hydrateImages($("workInfo"));
    show("detail");
}
function renderDescription(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const box = $("workDescription");
  box.hidden = !text;
  $("workDescriptionText").textContent = text;
  box.classList.remove("is-expanded");
  $("workDescriptionToggle").hidden = true;
  if (!text) return;
  requestAnimationFrame(() => {
    const node = $("workDescriptionText");
    $("workDescriptionToggle").hidden = node.scrollHeight <= node.clientHeight + 2;
  });
}
$("workDescriptionToggle").onclick = () => {
  const expanded = $("workDescription").classList.toggle("is-expanded");
  $("workDescriptionToggle").textContent = expanded ? "접기" : "더 보기";
  $("workDescriptionToggle").setAttribute("aria-expanded", String(expanded));
};
function metadataText(value) {
  if (Array.isArray(value)) return value.filter(item => typeof item === "string").join(' · ');
  return typeof value === "string" ? value.trim() : "";
}
function renderMetadata(work) {
  const status = typeof work.status === "string" ? ({ongoing:"연재 중",completed:"완결",hiatus:"휴재",cancelled:"연재 중단"})[work.status.toLowerCase()] || work.status : "";
  const values = [
    ['형식', selected.itemType === 2 ? '소설' : '만화'], ['총 회차', `${currentChapters.length}화`],
    ['작가',metadataText(work.author)], ['그림',metadataText(work.artist)], ['연재 상태',status],
    ['장르',metadataText(work.genre || work.genres || work.tags)], ['다른 제목',metadataText(work.alternativeTitles || work.alternativeName)],
  ];
  $('workMetadata').replaceChildren();
  for (const [label,value] of values) {
    if (!value) continue;
    const item = document.createElement('div'), term = document.createElement('span'), content = document.createElement('strong');
    term.textContent = label; content.textContent = value; item.append(term,content); $('workMetadata').append(item);
  }
}
function chapterMetadata(chapter) {
  let raw = chapter.dateUpload || chapter.uploadDate || chapter.date;
  let date = '';
  // Mangayomi sources report epoch milliseconds as a numeric string.
  if (typeof raw === 'string' && /^\d{9,14}$/.test(raw.trim())) raw = Number(raw);
  if (typeof raw === 'string' && raw.length < 80) date = raw;
  if (typeof raw === 'number' && raw > 0) {
    const value = new Date(raw < 1e11 ? raw * 1000 : raw);
    if (Number.isFinite(value.getTime())) date = value.toLocaleDateString('ko');
  }
  return [field(chapter,['scanlator','translator']),date].filter(Boolean).join(' · ');
}
function readChapterMarks(sourceKey, workUrl) {
  try { const value = JSON.parse(localStorage.getItem(`moya-chapter-marks:${sourceKey}\n${workUrl}`) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
async function changeChapterMarks(sourceKey, workUrl, urls, patch) {
  try {
    await withSourceLock(sourceKey,async () => {
      const marks = readChapterMarks(sourceKey,workUrl);
      for (const url of urls) marks[url] = {...marks[url],...patch,updatedAt:Date.now()};
      localStorage.setItem(`moya-chapter-marks:${sourceKey}\n${workUrl}`,JSON.stringify(marks));
    });
    if (sourceKey === stateKey() && workUrl === currentWork?.url) await refreshReleases();
    notice(patch.title ? '회차 제목을 저장했습니다.' : `${urls.length}개 회차를 ${patch.read ? '읽음' : '안 읽음'}으로 변경했습니다.`);
  } catch (error) {notice('읽기 상태를 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.'); throw error;}
}
async function refreshReleases() {
  const generation = ++releaseGeneration;
  $('resetReadingPosition').disabled = true;
  const sourceKey = stateKey(), workUrl = currentWork?.url;
  if (!workUrl) return;
  const chapters = currentChapters;
  const recent = readRecent().find(item => item.url === workUrl);
  const resumeIndex = chapters.findIndex(chapter => field(chapter, ["url", "link"]) === recent?.chapterUrl);
  $("continueReading").textContent = resumeIndex >= 0 ? "이어 읽기" : "첫 화 보기";
  $("continueReading").disabled = !chapters.length;
  $("continueReading").onclick = () => {
    const index = resumeIndex >= 0 ? resumeIndex : chapters.length - 1;
    openReader(field(chapters[index], ["url", "link"]), index);
  };
  const db = await openDb();
  const progress = await new Promise(resolve => {
    const tx = db.transaction("progress"), store = tx.objectStore("progress");
    const keys = store.getAllKeys(), values = store.getAll();
    tx.oncomplete = () => resolve(new Map(keys.result.map((key, index) => [key, values.result[index]])));
    tx.onerror = () => resolve(new Map());
  });
  if (generation !== releaseGeneration || sourceKey !== stateKey() || workUrl !== currentWork?.url) return;
  const marks = readChapterMarks(sourceKey, workUrl);
  $('resetReadingPosition').disabled = resettingReadingPosition || !(recent?.chapterUrl ||
    Object.values(marks).some(mark=>typeof mark.read==='boolean') ||
    chapters.some(chapter=>progress.has(`${sourceKey}\n${field(chapter,['url','link'])}`)));
  if (resumeIndex < 0 || (marks[recent?.chapterUrl]?.read === true && marks[recent.chapterUrl].updatedAt >= recent.updatedAt)) {
    const firstUnread = [...chapters.keys()].reverse().find(index => marks[field(chapters[index],["url","link"])]?.read !== true);
    const nextIndex = firstUnread ?? chapters.length - 1;
    const hasRead = Object.values(marks).some(mark => mark.read === true);
    $("continueReading").textContent = firstUnread === undefined ? "처음부터 다시 읽기" : hasRead ? `${chapters.length - nextIndex}화부터 읽기` : "첫 화 보기";
    $("continueReading").onclick = () => openReader(field(chapters[nextIndex],["url","link"]),nextIndex);
  }
  mountReleases($("chapters"), { sourceKey, workUrl,
    items: chapters.map((chapter, index) => {
      const url = field(chapter, ["url", "link"]);
      const saved = progress.get(`${sourceKey}\n${url}`) || {};
      const mark = marks[url];
      const complete = saved.ratio >= .98 || (saved.totalPages > 0 && saved.page >= saved.totalPages);
      const isRead = mark?.read === true || (mark?.read === false && mark.updatedAt >= (saved.updatedAt || 0) ? false : complete);
      return { key: { connectorId: sourceKey, remoteId: url }, title: mark?.title || field(chapter, ["name", "title"]) || "회차",
        originalTitle: field(chapter,["name","title"]), subtitle: chapterMetadata(chapter),
        sourceIndex: index, release: { sourceOrder: chapters.length - index },
        readingState: isRead ? "read" : mark?.read === false ? "unread" : recent?.chapterUrl === url ? "current" : "unread" };
    }),
    actions: {
      setReleasesRead: (items, read) => changeChapterMarks(sourceKey, workUrl, items.map(item => item.key.remoteId), {read}),
      markPreviousReleasesRead: item => changeChapterMarks(sourceKey, workUrl, chapters.slice(item.sourceIndex).map(chapter => field(chapter,["url","link"])), {read:true}),
      renameRelease: (item, title) => changeChapterMarks(sourceKey, workUrl, [item.key.remoteId], {title: title.trim().slice(0,200)}),
    },
    open: index => openReader(field(chapters[index], ["url", "link"]), index),
  });
}
let resettingReadingPosition = false;
$('resetReadingPosition').onclick = async () => {
  if (resettingReadingPosition || view !== 'detail' || !currentWork) return;
  const sourceKey=stateKey(), work={...currentWork}, chapters=[...currentChapters];
  if (!confirm(`「${work.title}」의 읽은 위치를 초기화할까요?\n\n이어 읽기 위치, 회차별 진행률과 읽음 표시가 초기화되며 동기화된 기기에도 반영됩니다. 북마크·메모와 회차 제목은 유지됩니다.`)) return;
  resettingReadingPosition=true;
  $('resetReadingPosition').disabled=true;
  try {
    await withSourceLock(sourceKey,()=>navigator.locks.request(`moya-progress:${sourceKey}`,async()=>{
      const recentKey=`moya-source-recent:${sourceKey}`, marksKey=`moya-chapter-marks:${sourceKey}\n${work.url}`;
      const recent=JSON.parse(localStorage.getItem(recentKey)||'[]'), marks=readChapterMarks(sourceKey,work.url);
      const saved=recent.find(row=>row.url===work.url);
      const urls=new Set([...chapters.map(chapter=>field(chapter,['url','link'])),...Object.keys(marks),saved?.chapterUrl].filter(Boolean));
      const db=await openDb();
      const removed=[];
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('progress','readwrite'), store=tx.objectStore('progress');
        const keys=store.getAllKeys();
        keys.onsuccess=()=>{
          const existing=new Set(keys.result);
          for (const url of urls) {
            const key=progressKey(url,sourceKey);
            if (existing.has(key)) { store.delete(key);removed.push(url); }
          }
        };
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
      });
      for (const url of removed) queueProgress(sourceKey,url,null);
      for (const mark of Object.values(marks)) { delete mark.read;delete mark.updatedAt; }
      localStorage.setItem(marksKey,JSON.stringify(marks));
      if (saved) {
        delete saved.chapterUrl;delete saved.chapterTitle;saved.updatedAt=Date.now();
        localStorage.setItem(recentKey,JSON.stringify(recent));
      }
    }));
    notice(`「${work.title}」의 읽은 위치를 초기화했습니다.`);
  } catch { notice('읽은 위치를 초기화하지 못했습니다. 다시 시도해 주세요.'); }
  finally {
    resettingReadingPosition=false;
    if (view==='detail') await refreshReleases();
  }
};
async function openReader(chapterUrl, chapterIndex = 0, targetAnchor) {
  if (!chapterUrl) return;
  const chapterSourceKey = stateKey();
  rememberNavigation();
  const direction = view === "reader" && activeChapter && activeChapter.url !== chapterUrl ? (chapterIndex < activeChapter.index ? "next" : "previous") : undefined;
  activeChapter = { url: chapterUrl, index: chapterIndex };
  syncAutoReading(undefined);
  retryOperation = () => openReader(chapterUrl, chapterIndex);
  $("readerProgress").textContent = "…";
  $("readerProgress").setAttribute("aria-label", "회차 불러오는 중");
  $("readerWorkTitle").textContent = currentWork?.title || "읽기";
  $("readerChapterTitle").textContent = field(currentChapters[chapterIndex], ["name", "title"]);
  try {
    await sourceGate.catch(() => {});
    expectScreen({ title: currentWork?.title, chapter: field(currentChapters[chapterIndex], ["name", "title"]), direction });
    if (readerCleanup) readerCleanup();
    readerCleanup = null;
    const savedProgress = await progressGet(chapterUrl, chapterSourceKey);
    $("previousChapter").disabled = chapterIndex >= currentChapters.length - 1;
    $("nextChapter").disabled = chapterIndex <= 0;
    $("previousChapter").onclick = () => {
      const item = currentChapters[chapterIndex + 1];
      if (item) openReader(field(item, ["url", "link"]), chapterIndex + 1);
    };
    $("nextChapter").onclick = () => {
      const item = currentChapters[chapterIndex - 1];
      if (item) openReader(field(item, ["url", "link"]), chapterIndex - 1);
    };
    $("comicNavigation").hidden = selected.itemType === 2;
    $("comicSettings").hidden = selected.itemType === 2;
    $("novelSettingsPanel").hidden = selected.itemType !== 2;
    $("novelNavigation").hidden = selected.itemType !== 2;
    $("pageBookmark").hidden = selected.itemType === 2;
    $("readerNotes").hidden = selected.itemType !== 2;
    $("readerNotes").onclick = () => $("novelNotes").click();
    $("readerLoadProgress").hidden = true;
    $("novelSearchToolbar").hidden = true;
    $("readerSearchToggle").hidden = selected.itemType !== 2;
    $("readerSearchToggle").setAttribute("aria-expanded","false");
    $("pages").innerHTML = "";
    $("novelText").hidden = true;
    $("pages").hidden = false;
    if (selected.itemType === 2) {
      const result = await invoke("html", {
        title: field(currentChapters[chapterIndex], ["name", "title"]),
        chapterUrl,
      });
      $("pages").hidden = true;
      $("novelText").hidden = false;
      for (const id of ["novelFontDown", "novelFontUp", "novelLine", "novelTheme"]) $(id).hidden = false;
      show("reader");
      const novelCleanup = await createNovelReader({ text: result.text, initial: targetAnchor ? 0 : Number(savedProgress.ratio) || 0, initialAnchor: targetAnchor ? undefined : savedProgress.anchor,
        isCurrent:()=>stateKey()===chapterSourceKey&&view==="reader"&&activeChapter?.url===chapterUrl,
        initialReaderAnchor: targetAnchor || savedProgress.readerAnchor, workKey: `${chapterSourceKey}\n${currentWork?.url}`, chapterUrl,
        title: field(currentChapters[chapterIndex], ["name", "title"]), chapterNumber: currentChapters.length - chapterIndex,
        chapters: currentChapters.map((item,index)=>({id:field(item,["url","link"]),index:currentChapters.length-index,title:field(item,["name","title"])})).reverse(),
        openChapter: (url,anchor)=>{if(stateKey()!==chapterSourceKey)return;const index=currentChapters.findIndex(item=>field(item,["url","link"])===url);if(index>=0)return openReader(url,index,anchor);},
        save: progress => progressSet(chapterUrl, progress, chapterSourceKey) });
      if(!novelCleanup)return;readerCleanup=novelCleanup;
      focusReaderContent($("novelText"));
      syncAutoReading(readerCleanup.autoViewport);
      scheduleWarmup(signal => warmChapter(currentChapters[chapterIndex-1],signal));
      return;
    }
    const pages = records(await invoke("pages", { chapterUrl }));
    $("pages").style.visibility = "hidden";
    if (!pages.length) throw new Error("source_failed");
    $("novelFontDown").hidden = true;
    $("novelFontUp").hidden = true;
    $("novelLine").hidden = true;
    $("novelTheme").hidden = true;
    const decodedPages = new Set();
    let loaded = 0,
      current = Math.max(
        1,
        Math.min(pages.length, targetAnchor?.end ? pages.length : targetAnchor?.start ? 1 : Number(savedProgress.page) || 1),
      ),
      comicReader,
      restoring = current > 1 || Boolean(targetAnchor?.end);
    const update = () => {
      $("readerProgress").textContent = `${Math.round(current / pages.length * 100)}%`;
      $("readerProgress").setAttribute('aria-label', `현재 페이지 ${current} / ${pages.length} (${Math.round(current / pages.length * 100)}%)`);
      const loadLabel = `이미지 ${loaded} / ${pages.length} (${Math.round(loaded / pages.length * 100)}%)`;
      $("readerLoadProgress").textContent = `${Math.round(loaded / pages.length * 100)}%`;
      $("readerLoadProgress").title = loadLabel;
      $("readerLoadProgress").setAttribute('aria-label', loadLabel);
      $("readerLoadProgress").hidden = loaded === pages.length;
    };
    for (const [index, page] of pages.entries()) {
      const wrap = document.createElement("div");
      wrap.className = "page";
      wrap.dataset.page = String(index + 1);
      wrap.dataset.imageUrl = pages[index].imageUrl;
      const mountImage = () => {
        wrap.classList.remove("errorPage");
        wrap.innerHTML = "";
        delete wrap.dataset.loaded;
        const loading = document.createElement('span'); loading.className = 'page-loading'; loading.setAttribute('role','status');
        loading.innerHTML = `<span class="loading-spinner" aria-hidden="true"></span><span>${index + 1} 페이지 불러오는 중</span>`;
        wrap.append(loading);
        const image = document.createElement("img");
        image.draggable = false;
        image.loading = index < 3 ? "eager" : "lazy";
        image.alt = `${index + 1} 페이지`;
        assignImage(image, pages[index].imageUrl, { priority: 0 });
        image.addEventListener('moya-image-loading', () => {
          delete wrap.dataset.loaded;
          if (!wrap.contains(loading)) wrap.append(loading);
        });
        image.onload = () => {
          loading.remove();
          decodedPages.add(index); loaded = decodedPages.size;
          comicReader?.imageLoaded(index, image);
          update();
        };
        image.onerror = () => {
          wrap.classList.add("errorPage");
          wrap.innerHTML = "";
          const retry = document.createElement("button");
          retry.textContent = `${index + 1} 페이지 다시 불러오기`;
          retry.onclick = async (event) => {
            event.stopPropagation();
            retry.disabled = true;
            retry.textContent = `${index + 1} 페이지 주소 갱신 중`;
            try {
              const refreshed = records(await invoke("pages", { chapterUrl }, {refresh:true}));
              if (!refreshed[index]?.imageUrl) throw new Error("source_failed");
              pages[index] = refreshed[index];
              mountImage();
            } catch (error) {
              fail(error);
            }
          };
          wrap.append(retry);
          update();
        };
        wrap.append(image);
        comicReader?.refresh();
      };
      mountImage();
      $("pages").append(wrap);
    }
    show("reader");
    comicReader = createComicReader({ root: $("pages"), total: pages.length, initial: current,
      storageKey: `moya-comic-profile:${stateKey()}:${currentWork.url}`, chapterUrl,
      nextChapterTitle: chapterIndex > 0 ? field(currentChapters[chapterIndex-1],["name","title"]) || "다음 화" : undefined,
      openChapter: step => {
        if (stateKey() !== chapterSourceKey || view !== 'reader' || activeChapter?.url !== chapterUrl) return;
        const index = chapterIndex - step, item = currentChapters[index];
        if (item) return openReader(field(item,['url','link']),index,step < 0 ? {end:true} : {start:true});
      },
      changed: page => { current = page; update(); progressSet(chapterUrl, { page: current, totalPages: pages.length }, chapterSourceKey); },
    });
    $("pages").style.visibility = "";
    focusReaderContent($("pages"));
    syncAutoReading(comicReader.autoViewport);
    const observer = new IntersectionObserver(
      (entries) => {
        if (comicReader.paged || restoring) return;
        const visible = entries
          .filter((x) => x.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          comicReader.observePage(Number(visible.target.dataset.page));
        }
      },
      { threshold: [0.1, 0.5, 0.9] },
    );
    document
      .querySelectorAll(".page")
      .forEach((node) => observer.observe(node));
    // Keep the saved target visible while preceding lazy images acquire their height.
    // User interaction takes over immediately; never pull the reader back afterwards.
    let restoreTimer, restoreActive = true;
    const stopRestore = () => { restoreActive = false; restoring = false; clearTimeout(restoreTimer); };
    const restoreEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
    for (const event of restoreEvents) addEventListener(event, stopRestore, { passive: true });
    readerCleanup = () => {
      stopRestore();
      for (const event of restoreEvents) removeEventListener(event, stopRestore);
      disposeImages($("pages"));
      observer.disconnect();
      comicReader.dispose();
    };
    const restoreDeadline = performance.now() + 10000;
    const restoreTarget = current;
    const restorePosition = () => {
      if (!restoreActive) return;
      const target = document.querySelector(`.page[data-page="${restoreTarget}"]`);
      if (!target) return;
      if (!comicReader.paged) {
        if (targetAnchor?.end) scrollTo(0, document.scrollingElement.scrollHeight);
        else target.scrollIntoView();
      }
      if (!restoring || target.querySelector("img")?.naturalWidth || performance.now() > restoreDeadline) { stopRestore(); return; }
      restoreTimer = setTimeout(restorePosition, 100);
    };
    requestAnimationFrame(restorePosition);
    scheduleWarmup(signal => warmChapter(currentChapters[chapterIndex-1],signal));
  } catch (error) {
    fail(error);
  }
}
$("networkMode").value = connectorMode() ? 'browser' : 'server';
$("networkMode").onchange = () => {
  cancelInvocation();
  localStorage.setItem('moya-network-mode', $("networkMode").value);
  location.reload();
};
$("connectorCheck").onclick = async () => {
  try { await connectorCall('hello', {}, undefined, 2000); $("connectorStatus").textContent = '연결됨 · 사이트 권한은 확장 아이콘에서 설정하세요.'; }
  catch (error) { $("connectorStatus").textContent = labels[error.message] || labels.connector_failed; }
};
addEventListener('moya-connector-error', event => { $("connectorStatus").textContent = labels[event.detail] || labels.connector_failed; });
$("searchForm").onsubmit = (event) => {
  event.preventDefault();
  const query = $("query").value.trim();
  if (query) search(query);
};
$("popular").onclick = popular;
$("clearBrowse").onclick = () => { $("query").value = ""; if (browseState.mode === "filter") browseState.filters = []; popular(); };
$("latest").onclick = () => browse("latest", 1);
$("applyFilters").onclick = () => { browseState.filters = structuredClone(filterDraft); return browse("filter", 1); };
$("loadMore").onclick = async () => {
  if (loadingMore || !browseState.hasNext) return;
  loadingMore = true; $("loadMore").disabled = true; $("loadMore").textContent = "불러오는 중…";
  const previous = listResult, key = stateKey(), state = {...browseState};
  try {
    const params = {page:state.page+1, mode:state.mode, filters:['filter','search'].includes(state.mode) ? state.filters : []};
    if (state.mode === 'search') params.query = state.query;
    const result = await invoke('list',params,{quiet:true});
    if (key !== stateKey() || listResult !== previous || view !== 'browse') return;
    const seen = new Set(), combined = [...records(previous), ...records(result)].filter(row => {
      const url = field(row,['link','url']); if (seen.has(url)) return false; seen.add(url); return true;
    });
    browseState = {...state,page:state.page+1};
    const top = scrollY;
    renderWorks({...result,list:combined},browseTitle(state.mode,state.query),true);
    scrollTo(0,top);
  } catch (error) {
    if (error.name !== 'AbortError' && key === stateKey() && listResult === previous)
      $("loadMoreStatus").textContent = '추가 목록을 불러오지 못했습니다. 다시 눌러 주세요.';
  } finally { loadingMore = false; $("loadMore").disabled = false; $("loadMore").textContent = "더 불러오기"; }
};
$("retry").onclick = () => retryOperation?.();
$("acceptUpdate").onclick = () => {
  metadataCache.clear(); chapterCache.clear();
  localStorage.removeItem(digestKey());
  $("acceptUpdate").hidden = true;
  retryOperation?.();
};
$("back").onclick = () => {
  // Cancel a screen that is still opening; in-place refreshes navigate back as usual.
  if (["detail", "browse", "reader"].includes(document.body.dataset.pending) && view !== "reader") { cancelInvocation(); catalogAbort?.abort(); return; }
  cancelInvocation();
  if (view === "reader") {
    if (appNavigation?.backTo(saved => saved.view === 'detail' && saved.currentWork?.url === currentWork?.url && saved.selection.repositoryUrl === selected.repositoryUrl && saved.selection.sourceId === selected.sourceId)) return;
    renderDetail(detailResult, currentWork.url);
    return;
  }
  if (!appNavigation?.back()) show("browse");
};
async function loadCatalog(repositoryUrl, remember = true, preferredSourceId, signal) {
  cancelInvocation();
  busy("저장소 확인 중", "catalog");
  catalogAbort?.abort();
  const controller = new AbortController(); catalogAbort = controller;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, {once:true});
  try {
    const catalog = await fetchCatalog(repositoryUrl, controller.signal);
    controller.signal.throwIfAborted();
    if (remember) {
      const repositories = readRepositories();
      if (!repositories.includes(catalog.repositoryUrl)) {
        repositories.push(catalog.repositoryUrl);
        saveRepositories(repositories);
      }
    }
    if (!catalog.sources?.length) throw new Error("이 저장소에는 지원하는 JS 소스가 없습니다.");
    $("browse").classList.remove("is-empty"); $("emptySources").hidden = true;
    catalogSources = catalog.sources;
    selected.repositoryUrl = catalog.repositoryUrl;
    currentWork = null;
    const saved = readSelection();
    const wanted = catalog.sources.some(row => row.id === preferredSourceId) ? preferredSourceId :
      saved?.repositoryUrl === catalog.repositoryUrl &&
      catalog.sources.some((row) => row.id === saved.sourceId)
        ? saved.sourceId
        : catalog.sources[0].id;
    const source = catalog.sources.find(row => row.id === wanted);
    selected.sourceId = source.id; selected.sourceName = source.name; selected.itemType = Number(source.itemType); selected.version = source.version;
    listResult = undefined; listSourceKey = undefined; detailResult = undefined;
    currentChapters = []; activeChapter = undefined;
    browseState = { mode: 'popular', query: '', page: 1, filters: [], hasNext: false };
    $('query').value = ''; $('works').replaceChildren();
    sourceManager?.update(catalog);
    updateSourceTitle(selected.sourceName);
    renderSourceTabs();
    $("repositoryStatus").textContent =
      `JS 소스 ${catalog.sources.length}개${catalog.skipped ? ` · 미지원/잘못된 항목 ${catalog.skipped}개 제외` : ""}`;
    localStorage.setItem("moya-source-selection", JSON.stringify(selected));
    preferences = await stateGet();
    controller.signal.throwIfAborted();
    renderRecent();
  } finally {
    signal?.removeEventListener("abort", abort);
    if (catalogAbort === controller) { catalogAbort = null; busy(""); }
  }
}
function readPinnedSources() {
  try { return JSON.parse(localStorage.getItem("moya-source-pins") || "[]").filter(item => typeof item.sourceId === "string" && typeof item.repositoryUrl === "string").slice(0, 30); }
  catch { return []; }
}
const sourceIdentity = source => JSON.stringify([source.repositoryUrl, source.sourceId]);
function renderSourceTabs() {
  $("sourceTabs").replaceChildren();
  const pinned = readPinnedSources();
  if (selected.sourceId && !pinned.some(source => sourceIdentity(source) === sourceIdentity(selected))) pinned.push({ ...selected });
  for (const source of pinned) {
    const button = document.createElement("button"); button.textContent = source.sourceName || "소스";
    if (sourceIdentity(source) === sourceIdentity(selected)) button.setAttribute("aria-current", "page");
    button.onclick = () => switchSource(source).catch(fail);
    $("sourceTabs").append(button);
  }
}
async function switchSource(source) {
  rememberNavigation(); cancelInvocation();
  retryOperation = () => switchSource(source).catch(fail);
  await sourceGate.catch(() => {}); await invocationQueue.catch(() => {});
  if (sourceIdentity(source) !== sourceIdentity(selected)) await loadCatalog(source.repositoryUrl, false, source.sourceId);
  browseState = { mode: "popular", query: "", page: 1, filters: [], hasNext: false };
  $("query").value = "";
  await browse("popular", 1, "", false, true);
}
$("errorQuickJump").onclick = () => $("quickJump").click();
$("quickJump").onclick = () => {
  const repositories = [...new Set([...readRepositories(),selected.repositoryUrl].filter(Boolean))];
  let repository = selected.repositoryUrl, all = [], saving = false, loading = false, message, closed = false, controller;
  const setSources = sources => { all = sources.map(source => ({...source,repositoryUrl:repository,sourceId:source.id,sourceName:source.name})); };
  setSources(catalogSources);
  const close = () => { closed = true; controller?.abort(); mountQuickJump($("quickJumpRoot"), null); };
  const selectRepository = async url => {
    controller?.abort(); const request = new AbortController(); controller = request;
    repository = url; all = []; loading = true; message = undefined; draw();
    try {
      const catalog = await fetchCatalog(url,request.signal);
      if (closed || request.signal.aborted) return;
      setSources(catalog.sources);
    } catch (error) { if (!request.signal.aborted) message = labels[error.message] || '저장소를 불러오지 못했습니다. 다른 저장소를 선택하거나 다시 시도해 주세요.'; }
    finally { if (!closed && controller === request) { loading = false; draw(); } }
  };
  const draw = () => { if (closed) return; mountQuickJump($("quickJumpRoot"), {
    repositories, repository, selectRepository, loading,
    retry: () => selectRepository(repository),
    sources: all.map(source => ({ id: sourceIdentity(source), title: source.sourceName, kind: "catalog", connection: { state: "connected" } })),
    pinned: readPinnedSources().map(sourceIdentity), close, saving, error: message,
    open: async id => {
      if (saving || loading) return false;
      saving = true; draw();
      try {
        const target = all.find(source => sourceIdentity(source) === id);
        close(); rememberNavigation(); await appNavigation?.whenSettled();
        await switchSource(target); return true;
      }
      catch (error) { fail(error); return false; }
      finally { saving = false; draw(); }
    },
    togglePin: source => {
      const pinned = readPinnedSources(), exists = pinned.some(item => sourceIdentity(item) === source.id);
      if (!exists && pinned.length >= 30) { message = "탭은 최대 30개까지 추가할 수 있습니다."; draw(); return; }
      const next = exists ? pinned.filter(item => sourceIdentity(item) !== source.id) : [...pinned, all.find(item => sourceIdentity(item) === source.id)];
      localStorage.setItem("moya-source-pins", JSON.stringify(next)); renderSourceTabs(); draw();
    },
  }); };
  draw();
  if (!all.length) void selectRepository(repository);
};

function showEmptyLibrary() {
  show("browse"); $('browse').classList.add('is-empty');
  $('emptySources').hidden = false; updateSourceTitle('확장 소스');
}
async function boot() {
  $("login").hidden = true;
  try {
    const saved = readSelection();
    const repositories = readRepositories();
    const initial = repositories.includes(saved?.repositoryUrl)
      ? saved.repositoryUrl
      : repositories[0];
    if (!initial) { showEmptyLibrary(); return; }
    if (saved?.repositoryUrl === initial) { selected = { ...selected, ...saved }; updateSourceTitle(selected.sourceName || '소스'); renderSourceTabs(); }
    if (allRecent().length) {
      // Local history is immediately usable; entering a work resolves its source as needed.
      show("recent"); renderRecent();
      const generation = requestNo;
      void fetchCatalog(initial).then(async catalog => {
        if (requestNo !== generation || view !== 'recent') return;
        catalogSources = catalog.sources; sourceManager?.update(catalog);
        const recent = allRecent().find(item => item.repositoryUrl === initial);
        const source = catalog.sources.find(row => row.id === selected.sourceId)
          || catalog.sources.find(row => row.id === recent?.sourceId) || catalog.sources[0];
        if (!source) return;
        selected = { repositoryUrl:initial, sourceId:source.id, sourceName:source.name, itemType:Number(source.itemType), version:source.version };
        localStorage.setItem('moya-source-selection', JSON.stringify(selected));
        updateSourceTitle(selected.sourceName); renderSourceTabs();
        await metadataCache.ready;
        if (requestNo === generation && view === 'recent') warmRecent();
      }).catch(() => {});
      return;
    }
    await metadataCache.ready;
    await loadCatalog(initial);
    await popular();
  } catch (error) {
    if (error.status === 401) show("login");
    else fail(error);
  }
}
mountWorkView($("workViewControl"), "moya.discovery-view:lite", (value) => {
  $("works").dataset.view = value;
  if (listResult && listSourceKey === stateKey()) renderWorkCards(records(listResult));
});
initializeUI({
  refresh: () => view === "detail" ? openDetail(currentWork.url, true) : browse(browseState.mode, 1, browseState.query, true),
  navigate: async (destination, closeMenu) => {
    if (view === "login") return;
    rememberNavigation(); closeMenu(); rememberNavigation();
    await appNavigation?.whenSettled();
    cancelInvocation(); catalogAbort?.abort();
    if (destination === "recent") { show("recent"); renderRecent(); warmRecent(); }
    else if (listResult && listSourceKey === stateKey()) renderWorks(listResult,browseTitle(browseState.mode,browseState.query));
    else void popular();
  },
});
sourceManager = createSourceManager({
  repositories: readRepositories, saveRepositories, selected: () => selected,
  removed: repositoryUrl => {
    const pins = readPinnedSources().filter(item => item.repositoryUrl !== repositoryUrl);
    localStorage.setItem('moya-source-pins', JSON.stringify(pins));
    if (selected.repositoryUrl !== repositoryUrl) { renderSourceTabs(); return; }
    cancelInvocation(); catalogAbort?.abort(); stopWarmup();
    selected = {repositoryUrl:'',sourceId:'',sourceName:'확장 소스',itemType:0};
    localStorage.removeItem('moya-source-selection'); catalogSources=[]; listResult=undefined;
    renderSourceTabs(); showEmptyLibrary();
  },
  fetchCatalog: (repositoryUrl, signal) => fetchCatalog(repositoryUrl, signal, true),
  activate: async source => {
    try { await switchSource(source); }
    catch (error) { $("settingsDialog").close(); fail(error); throw error; }
  }, editOptions: () => { void loadPreferences().catch(fail); }, notice,
  pinned: source => readPinnedSources().some(item => sourceIdentity(item) === sourceIdentity(source)),
  pin: source => {
    const pins = readPinnedSources(), id = sourceIdentity(source), exists = pins.some(item => sourceIdentity(item) === id);
    if (!exists && pins.length >= 30) {notice("탭은 최대 30개까지 고정할 수 있습니다."); return;}
    localStorage.setItem("moya-source-pins",JSON.stringify(exists ? pins.filter(item => sourceIdentity(item) !== id) : [...pins,source])); renderSourceTabs();
  },
});
addEventListener('moyami-synced', () => {
  renderRecent(); renderSourceTabs();
  if (view === 'detail') void refreshReleases();
  if ($('settingsDialog').open && !$('sourceSettings').hidden) sourceManager?.refresh();
});
$("recentQuery").oninput = renderRecent;

initializeDownloads({
  changed: async () => {
    stopWarmup(); await trimContentCache();
    if (view === 'recent') warmRecent();
    else if (view === 'reader' && activeChapter) scheduleWarmup(signal => warmChapter(currentChapters[activeChapter.index-1], signal));
  },
  clear: async () => {
    stopWarmup();
    metadataCache.clear(); chapterCache.clear(); clearImageCache();
    await Promise.all([clearContentCache(), clearCovers()]);
  },
});
boot();

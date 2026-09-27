import { connectorCall } from './connector.js';
const states = new Map();
let active = 0;
const blobs = new Map();
let blobBytes = 0;
const alive = state => state.prefetch || state.image.isConnected;
function forgetBlob(url) { const old = blobs.get(url); if (old) blobBytes -= old.blob.size; blobs.delete(url); }
function cachedBlob(url) {
  const item = blobs.get(url);
  if (!item) return;
  if (item.expires <= Date.now()) { forgetBlob(url); return; }
  blobs.delete(url); blobs.set(url,item); return item.blob;
}
function rememberBlob(url, blob) {
  forgetBlob(url);
  if (blob.size > 24 * 1024 * 1024) return;
  while (blobs.size && (blobs.size >= 24 || blobBytes + blob.size > 24 * 1024 * 1024)) forgetBlob(blobs.keys().next().value);
  blobs.set(url, {blob,expires:Date.now()+2*60_000}); blobBytes += blob.size;
}

const wanted = state => state.priority === undefined ? state.near : state.priority > 0;
const priority = state => state.priority ?? (state.near ? 1 : 0);
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const state = states.get(entry.target); if (!state) continue;
    state.near = entry.isIntersecting;
    if (!wanted(state)) release(state);
  }
  drain();
}, { rootMargin: '1200px' });
function release(state) {
  state.abort?.abort(); state.finishNative?.();
  if (state.image.naturalWidth) { state.image.width = state.image.naturalWidth; state.image.height = state.image.naturalHeight; }
  state.image.removeAttribute('src');
  if (state.blob) URL.revokeObjectURL(state.blob);
  state.blob = undefined; state.loaded = false;
}
function drain() {
  const queue = [...states.values()].sort((a,b) => priority(b) - priority(a));
  for (const state of queue) {
    if (active >= 3) break;
    if (!wanted(state) || !alive(state) || state.loading || state.loaded || state.failed) continue;
    // A speculative image uses at most one slot and yields to visible/nearby images.
    if (state.prefetch && [...states.values()].some(other => other.loading && other.prefetch)) continue;
    if ([...states.values()].some(other => other !== state && other.url === state.url && other.loading)) continue;
    const cached = state.request && cachedBlob(state.url);
    if (cached) {
      state.blob = URL.createObjectURL(cached); state.loaded = true; state.image.src = state.blob;
      continue;
    }
    active++; state.loading = true;
    if (state.priority > 0) state.image.loading = 'eager';
    state.image.dispatchEvent(new Event('moya-image-loading'));
    if (!state.request) {
      let complete = false;
      const finish = () => {
        if (complete) return; complete = true;
        state.image.removeEventListener('load', loaded); state.image.removeEventListener('error', failed);
        state.finishNative = undefined; state.loading = false; active--; queueMicrotask(drain);
      };
      const loaded = () => { state.loaded = true; finish(); };
      const failed = () => { state.failed = true; finish(); };
      state.finishNative = finish;
      state.image.addEventListener('load', loaded); state.image.addEventListener('error', failed);
      state.image.loading = 'eager'; state.image.src = state.url;
      continue;
    }
    state.abort = new AbortController();
    const signal = state.abort.signal;
    connectorCall('image', { request: state.request }, signal).then(reply => {
      if (signal.aborted || !alive(state) || states.get(state.image) !== state) return;
      const bytes = Uint8Array.from(atob(reply.bytes), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: reply.contentType });
      rememberBlob(state.url, blob);
      state.blob = URL.createObjectURL(blob);
      state.loaded = true; state.image.src = state.blob;
    }).catch(error => {
      if (signal.aborted || !alive(state) || states.get(state.image) !== state) return;
      state.failed = true; state.image.dispatchEvent(new Event('error'));
    }).finally(() => { active--; state.loading = false; drain(); });
  }
}
new MutationObserver(() => {
  for (const [image, state] of states) if (!alive(state)) { release(state); observer.unobserve(image); states.delete(image); }
}).observe(document.documentElement, { childList: true, subtree: true });
export function assignImage(image, url, { priority: initialPriority } = {}) {
  const previous = states.get(image); if (previous) { release(previous); states.delete(image); observer.unobserve(image); }
  if (!url?.startsWith('moya-image:') && initialPriority === undefined) { image.src = url; return; }
  try {
    const request = url?.startsWith('moya-image:') ? JSON.parse(decodeURIComponent(url.slice('moya-image:'.length))) : undefined;
    states.set(image, { image, url, request, priority: initialPriority, near: false, loading: false, loaded: false, failed: false }); observer.observe(image);
  } catch { queueMicrotask(() => image.dispatchEvent(new Event('error'))); }
}
// Explicit priorities let paged reading retain hidden neighbours; undefined restores viewport loading.
export function setImagePriority(image, value) {
  const state = states.get(image); if (!state) return;
  state.priority = value;
  if (!wanted(state)) release(state);
}
export function flushImageQueue() { drain(); }
// Detached images share the same priority queue and Blob cache as visible pages.
export async function prefetchImages(urls, signal) {
  for (const url of urls.slice(0,2)) {
    signal?.throwIfAborted();
    if (!url || cachedBlob(url)) continue;
    await new Promise(resolve => {
      const image = new Image();
      let timer;
      const finish = () => {
        clearTimeout(timer); signal?.removeEventListener('abort',finish);
        image.onload = image.onerror = null;
        const state = states.get(image);
        if (state) { release(state); states.delete(image); observer.unobserve(image); }
        resolve(); queueMicrotask(drain);
      };
      image.onload = finish; image.onerror = () => { forgetBlob(url); finish(); };
      assignImage(image,url,{priority:0.5});
      const state = states.get(image); if (state) state.prefetch = true;
      signal?.addEventListener('abort',finish,{once:true});
      timer = setTimeout(finish,15000);
      if (signal?.aborted) finish(); else drain();
    });
  }
}
export function hydrateImages(root) {
  for (const image of root.querySelectorAll('img[data-moya-image]')) { assignImage(image, image.dataset.moyaImage); delete image.dataset.moyaImage; }
}
export function disposeImages(root) {
  for (const [image, state] of states) if (root.contains(image)) { release(state); observer.unobserve(image); states.delete(image); }
}

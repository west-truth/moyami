import { downloadSettings } from '/download-settings.js';
import { localStorage, indexedDB } from "/account-storage.js";
// Disposable display/code cache. Reader progress and source preferences live elsewhere.
const database = 'moya-source-cache';
const maxEntries = 256;
let opening;
function open() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'id' });
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('cache_blocked'));
  }).catch(() => { opening = undefined; return null; });
  return opening;
}
async function transaction(mode, action, strict = false) {
  try {
    const db = await open(); if (!db) { if (strict) throw new Error('cache_unavailable'); return; }
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('entries', mode), store = tx.objectStore('entries');
      let value;
      action(store, result => { value = result; });
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } catch (error) { if (strict) throw error; /* Cache failures never interrupt reading. */ }
}
export function localCache(namespace) {
  const id = key => JSON.stringify([namespace, key]);
  return {
    async all() {
      return await transaction('readonly', (store, done) => {
        store.getAll().onsuccess = event => done(event.target.result.filter(row => row.namespace === namespace && row.expiresAt > Date.now()));
      }) || [];
    },
    async get(key) {
      return transaction('readonly', (store, done) => {
        store.get(id(key)).onsuccess = event => { const row = event.target.result; done(row?.expiresAt > Date.now() ? row.value : undefined); };
      });
    },
    async set(key, value, expiresAt) {
      const maxBytes = downloadSettings().cacheMiB * 1024 * 1024;
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
      if (bytes > maxBytes / 2 || expiresAt <= Date.now()) return;
      await transaction('readwrite', store => {
        store.getAll().onsuccess = event => {
          let rows = event.target.result.filter(row => {
            if (row.expiresAt <= Date.now() || row.id === id(key)) { store.delete(row.id); return false; }
            return true;
          }).sort((a,b) => a.savedAt - b.savedAt);
          let size = rows.reduce((sum,row) => sum + row.bytes, 0);
          while (rows.length && (rows.length >= maxEntries || size + bytes > maxBytes)) {
            const row = rows.shift(); size -= row.bytes; store.delete(row.id);
          }
          store.put({ id:id(key), namespace, key, value, expiresAt, bytes, savedAt:Date.now() });
        };
      });
    },
    async delete(key) { await transaction('readwrite', store => store.delete(id(key))); },
    async clear() {
      await transaction('readwrite', store => { store.getAll().onsuccess = event => {
        for (const row of event.target.result) if (row.namespace === namespace) store.delete(row.id);
      }; });
    },
  };
}

export async function clearContentCache() {
  await transaction('readwrite', store => store.clear(), true);
}
export async function trimContentCache() {
  const limit = downloadSettings().cacheMiB * 1024 * 1024;
  await transaction('readwrite', store => {
    store.getAll().onsuccess = event => {
      let bytes = 0;
      for (const row of event.target.result.sort((a,b) => b.savedAt-a.savedAt)) {
        if (row.expiresAt <= Date.now() || bytes + row.bytes > limit) store.delete(row.id);
        else bytes += row.bytes;
      }
    };
  });
}

import { localStorage, indexedDB } from "/account-storage.js";
// Small decoded thumbnails, keyed by source + work. No source cookies or expiring image tickets.
let database;
function open() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('moya-source-covers', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('covers');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
export const coverKey = (sourceKey, workUrl) => `${sourceKey}\n${workUrl}`;
export async function readCover(key) {
  try {
    const db = await open();
    return await new Promise(resolve => {
      const request = db.transaction('covers').objectStore('covers').get(key);
      request.onsuccess = () => resolve(request.result?.blob);
      request.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}
export async function saveCover(key, image) {
  try {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const scale = Math.min(1, 240 / image.naturalWidth, 360 / image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .8));
    if (!blob || blob.size > 96 * 1024) return;
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('covers', 'readwrite'), store = tx.objectStore('covers');
      store.put({ blob, updatedAt: Date.now() }, key);
      const keys = store.getAllKeys(), values = store.getAll();
      values.onsuccess = () => {
        const entries = keys.result.map((key,index) => ({key,...values.result[index]})).sort((a,b) => b.updatedAt-a.updatedAt);
        let bytes = 0;
        for (const [index, entry] of entries.entries()) {
          bytes += entry.blob.size;
          if (index >= 100 || bytes > 8 * 1024 * 1024) store.delete(entry.key);
        }
      };
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } catch { /* Storage quota or a cross-origin canvas must not interrupt reading. */ }
}

// Lite page-layout cache. Never opens the original app's library database.
import { upgradeReaderPageMapStore } from './reader-page-map-schema';
let database: Promise<IDBDatabase> | undefined;
export function openReaderDb(): Promise<IDBDatabase> {
 return database ||= new Promise((resolve,reject) => {
  const request=indexedDB.open('moya-source-reader-layouts',1);
  request.onupgradeneeded=()=>upgradeReaderPageMapStore(request.result);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>{database=undefined;reject(request.error);};
 });
}

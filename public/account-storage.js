// Selected before app modules load. Each account keeps its own settings and reading history.
let prefix = '';
export function selectAccount(id) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('invalid_account');
  prefix = `moyami:${id}:`;
}
export const localStorage = new Proxy({}, {
  get(_, key) {
    const storage = globalThis.localStorage;
    const keys = () => Object.keys(storage).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
    if (key === 'getItem') return key => storage.getItem(prefix + key);
    if (key === 'setItem') return (key, value) => storage.setItem(prefix + key, value);
    if (key === 'removeItem') return key => storage.removeItem(prefix + key);
    if (key === 'clear') return () => keys().forEach(key => storage.removeItem(prefix + key));
    if (key === 'key') return index => keys()[index] ?? null;
    if (key === 'length') return keys().length;
    if (typeof key === 'string') return storage.getItem(prefix + key);
  },
  ownKeys() { return Object.keys(globalThis.localStorage).filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)); },
  getOwnPropertyDescriptor() { return { configurable:true, enumerable:true }; },
});
export const indexedDB = new Proxy({}, {
  get(_, key) {
    const db = globalThis.indexedDB;
    if (key === 'open' || key === 'deleteDatabase') return (name, ...args) => db[key](prefix + name, ...args);
    if (key === 'databases') return async () => (await db.databases()).filter(row => row.name?.startsWith(prefix)).map(row => ({...row, name:row.name.slice(prefix.length)}));
    return typeof db[key] === 'function' ? db[key].bind(db) : db[key];
  },
});

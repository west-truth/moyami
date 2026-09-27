// Display metadata only; never stores source state or page bodies.
export function metadataCacheLifetime(action, params, browserConnection, result) {
  const ttl = action === 'detail' ? 6 * 60 * 60_000 : action === 'list' ?
    (params.mode === 'latest' ? 5 : 30) * 60_000 : 0;
  // Some covers cannot use the connector (e.g. HTTP URLs), even in browser mode.
  const hasTicket = value => typeof value === 'string' ? value.startsWith('/api/image?ticket=') :
    value && typeof value === 'object' && Object.values(value).some(hasTicket);
  return !browserConnection || hasTicket(result) ? Math.min(ttl, 10 * 60_000) : ttl;
}
export function createMetadataCache({ now = Date.now, maxEntries = 128, maxBytes = 16 * 1024 * 1024, persistence } = {}) {
  const entries = new Map();
  let bytes = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (entry) bytes -= entry.bytes;
    entries.delete(key);
  }
  function prune() {
    for (const [key, entry] of entries) if (entry.expiresAt <= now()) remove(key);
  }
  let hydrating = true;
  const cache = {
    get(key) {
      prune();
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key); entries.set(key, entry);
      return JSON.parse(entry.json);
    },
    set(key, value, expiresAt) {
      remove(key); prune();
      if (expiresAt <= now()) return;
      const json = JSON.stringify(value);
      if (json === undefined) return;
      const size = new TextEncoder().encode(key + json).byteLength;
      if (size > maxBytes || maxEntries < 1) return;
      while (entries.size >= maxEntries || bytes + size > maxBytes) remove(entries.keys().next().value);
      entries.set(key, { json, bytes: size, expiresAt }); bytes += size;
      if (persistence && !hydrating) return persistence.set(key, value, expiresAt);
    },
    delete(key) { remove(key); if (persistence) void persistence.delete(key); },
    clear() { entries.clear(); bytes = 0; if (persistence) void persistence.clear(); },
  };
  cache.ready = (async () => {
    if (persistence) for (const row of await persistence.all()) cache.set(row.key, row.value, row.expiresAt);
    hydrating = false;
  })();
  return cache;
}

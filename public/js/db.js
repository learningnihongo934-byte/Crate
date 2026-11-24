// IndexedDB: plays (listening history), kv (settings/queue/rules), art (thumbnail cache), genre (artist → genres).
// A play: { k: dedupe key, t: end time ms, ms: ms played, n: track, a: artist, b: album, u: track id, s: skipped 0/1, src: 'x' export | 'a' api | 'd' demo }
let dbp;
function open() {
  dbp ||= new Promise((ok, bad) => {
    const r = indexedDB.open('crate', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('plays', { keyPath: 'k' });
      db.createObjectStore('kv', { keyPath: 'key' });
      db.createObjectStore('art', { keyPath: 'id' });
      db.createObjectStore('genre', { keyPath: 'artist' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => bad(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((ok, bad) => {
    const t = db.transaction(store, mode);
    const st = t.objectStore(store);
    let out;
    const res = fn(st);
    if (res && 'onsuccess' in res) res.onsuccess = () => { out = res.result; };
    t.oncomplete = () => ok(out);
    t.onerror = () => bad(t.error);
    t.onabort = () => bad(t.error);
  });
}

export const allPlays = () => tx('plays', 'readonly', (st) => st.getAll());
export const putPlays = (arr) => tx('plays', 'readwrite', (st) => { for (const p of arr) st.put(p); });
export const deletePlays = (keys) => tx('plays', 'readwrite', (st) => { for (const k of keys) st.delete(k); });
export const clearPlays = () => tx('plays', 'readwrite', (st) => st.clear());

export async function kvGet(key, fallback = null) {
  const r = await tx('kv', 'readonly', (st) => st.get(key));
  return r ? r.value : fallback;
}
export const kvSet = (key, value) => tx('kv', 'readwrite', (st) => st.put({ key, value }));

export const artGet = (id) => tx('art', 'readonly', (st) => st.get(id));
export const artPut = (id, url) => tx('art', 'readwrite', (st) => st.put({ id, url, t: Date.now() }));

export const genreAll = () => tx('genre', 'readonly', (st) => st.getAll());
export const genrePut = (rows) => tx('genre', 'readwrite', (st) => { for (const r of rows) st.put(r); });
export const genreClear = () => tx('genre', 'readwrite', (st) => st.clear());

// Persistence via IndexedDB. Stores world metadata (seed, time, player, survival,
// inventory, furnaces) plus the full block buffer of every player-edited chunk.
// Regenerated (unedited) chunks are never stored — they come from the seed.

const DB_NAME = 'voxelcraft';
const DB_VERSION = 1;

// Exact byte length of a stored chunk block buffer: CHUNK * CHUNK * HEIGHT = 16*16*128.
// Buffers restored from IndexedDB are used directly as authoritative block data
// (getBlock indexing, worker meshing), so a tampered record with a wrong/oversized
// buffer could cause OOM or out-of-bounds reads. Restored buffers must match exactly.
const CHUNK_BYTES = 16 * 16 * 128;
// Upper bound on how many edited-chunk keys we will restore in one load. Guards
// against an attacker-sized editedKeys array spawning unbounded concurrent reads.
// Each restored chunk is CHUNK_BYTES (32 KB) held live in the savedEdits Map for
// the session, so the cap also bounds peak memory: 8192 * 32 KB ~= 256 MB. This is
// far above any realistic edited-world size while denying a tampered save the
// ~3.28 GB allocation the old 100000 cap allowed (which OOM-crashes the tab).
const MAX_EDITED_KEYS = 8192;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'seed' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks'); // key: `${seed}:${cx},${cz}`
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, stores, mode) {
  const t = db.transaction(stores, mode);
  return { t, done: new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }) };
}

export const Save = {
  _db: null,
  async init() { if (!this._db) this._db = await openDB(); return this._db; },

  async hasWorld(seed) {
    const db = await this.init();
    return await new Promise((res) => {
      const r = db.transaction('meta').objectStore('meta').get(seed);
      r.onsuccess = () => res(!!r.result); r.onerror = () => res(false);
    });
  },

  // state: { seed, time, player, survival, inventory, furnaces, edits:[{cx,cz,blocks:Uint8Array}] }
  async saveWorld(state) {
    const db = await this.init();
    const { t, done } = tx(db, ['meta', 'chunks'], 'readwrite');
    const editedKeys = state.edits.map(e => `${e.cx},${e.cz}`);
    t.objectStore('meta').put({
      seed: state.seed, time: state.time, player: state.player,
      survival: state.survival, inventory: state.inventory, furnaces: state.furnaces,
      editedKeys, savedAt: state.savedAt || 0,
    });
    const cs = t.objectStore('chunks');
    for (const e of state.edits) cs.put(e.blocks, `${state.seed}:${e.cx},${e.cz}`);
    await done;
    return true;
  },

  async loadWorld(seed) {
    const db = await this.init();
    const meta = await new Promise((res) => {
      const r = db.transaction('meta').objectStore('meta').get(seed);
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    if (!meta) return null;
    const edits = new Map();
    if (Array.isArray(meta.editedKeys) && meta.editedKeys.length) {
      const keys = meta.editedKeys.slice(0, MAX_EDITED_KEYS);
      // Read in bounded batches instead of one unbounded Promise.all over all
      // MAX_EDITED_KEYS keys. Each record's full ArrayBuffer is materialized by
      // r.result before its byteLength can be checked, so a tampered DB whose
      // records hold oversized buffers could otherwise deserialize thousands of
      // them into memory at once — blowing past the ~256 MB bound the cap is meant
      // to enforce. Capping concurrency to READ_BATCH keeps at most a small, fixed
      // number of (possibly oversized) buffers resident, and each is dropped
      // immediately after the size check so bad records can't accumulate.
      const READ_BATCH = 32;
      for (let i = 0; i < keys.length; i += READ_BATCH) {
        const batch = keys.slice(i, i + READ_BATCH);
        const store = db.transaction('chunks').objectStore('chunks');
        await Promise.all(batch.map(k => new Promise((res) => {
          const r = store.get(`${seed}:${k}`);
          r.onsuccess = () => {
            const buf = r.result;
            // Only overlay buffers that are exactly the expected chunk size; drop
            // missing, short, oversized, or non-buffer records so corrupt/tampered
            // saves can't OOM or feed out-of-bounds block data into the game.
            if (buf && typeof buf.byteLength === 'number' && buf.byteLength === CHUNK_BYTES) {
              edits.set(k, new Uint8Array(buf));
            }
            res();
          };
          r.onerror = () => res();
        })));
      }
    }
    return { meta, edits };
  },

  async deleteWorld(seed) {
    const db = await this.init();
    const { t, done } = tx(db, ['meta', 'chunks'], 'readwrite');
    const metaStore = t.objectStore('meta');
    const r = metaStore.get(seed);
    await new Promise((res) => { r.onsuccess = res; r.onerror = res; });
    const keys = r.result?.editedKeys || [];
    metaStore.delete(seed);
    const cs = t.objectStore('chunks');
    for (const k of keys) cs.delete(`${seed}:${k}`);
    await done;
    return true;
  },
};

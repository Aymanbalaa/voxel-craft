// Persistence via IndexedDB. Stores world metadata (seed, time, player, survival,
// inventory, furnaces) plus the full block buffer of every player-edited chunk.
// Regenerated (unedited) chunks are never stored — they come from the seed.

const DB_NAME = 'voxelcraft';
const DB_VERSION = 1;

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
    if (meta.editedKeys && meta.editedKeys.length) {
      const store = db.transaction('chunks').objectStore('chunks');
      await Promise.all(meta.editedKeys.map(k => new Promise((res) => {
        const r = store.get(`${seed}:${k}`);
        r.onsuccess = () => { if (r.result) edits.set(k, new Uint8Array(r.result)); res(); };
        r.onerror = () => res();
      })));
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

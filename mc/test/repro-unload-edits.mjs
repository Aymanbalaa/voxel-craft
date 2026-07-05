// Repro: player edits a chunk, walks far enough that the chunk unloads, then the
// game saves. The edit should still be in the collected save data.
//
// We exercise the REAL World.prototype methods (_unloadFar, collectEdits) on a
// hand-built instance so we avoid the browser-only Worker in the constructor.
import { CHUNK } from '../js/config.js';

let World;
try {
  ({ World } = await import('../js/world.js'));
  console.log('world.js imported OK');
} catch (e) { console.log('import FAILED:', e.message); process.exit(0); }

const key = (cx, cz) => cx + ',' + cz;

// Minimal Chunk-like record.
function chunk(cx, cz, blocks) {
  return { cx, cz, blocks, opaqueMesh: null, waterMesh: null };
}

// Fake `this` with just the fields the two methods touch.
const w = {
  chunks: new Map(),
  editedChunks: new Set(),
  savedEdits: new Map(),
  scene: { remove() {} },
  _disposeMesh: World.prototype._disposeMesh,
};

// Player edited chunk (15,0): give it a distinctive block buffer. It sits beyond
// the unload radius (RENDER_DIST+2 = 10) from the player's chunk (0,0).
const edited = new Uint8Array(CHUNK * CHUNK * 128);
edited[123] = 42;                       // the player's edit
w.chunks.set(key(15, 0), chunk(15, 0, edited));
w.editedChunks.add(key(15, 0));

// Player is now near chunk (0,0) and far from (15,0): trigger unload.
World.prototype._unloadFar.call(w, 0, 0);

const stillLoaded = w.chunks.has(key(15, 0));
const edits = World.prototype.collectEdits.call(w);
const savedEdit = edits.find(e => e.cx === 15 && e.cz === 0);

console.log('chunk (15,0) still loaded after walking away:', stillLoaded);
console.log('edit present in collected save data:', !!savedEdit,
            savedEdit ? '(block[123]=' + savedEdit.blocks[123] + ')' : '');

if (!savedEdit)
  console.log('BUG CONFIRMED: player edit was lost on chunk unload (not in save data)');
else
  console.log('OK: edit survived unload');

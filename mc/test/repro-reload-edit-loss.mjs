// Repro: after a RELOAD, edits live only in savedEdits (editedChunks starts empty
// and is only re-populated for chunks that regenerate near the player). A saved
// edit in a chunk the player never revisits this session is dropped by
// collectEdits() on the next save — silently reverting the structure on reload.
//
// Exercises the REAL World.prototype methods on a hand-built instance to avoid
// the browser-only Worker in the constructor (same trick as repro-unload-edits).
import { CHUNK } from '../js/config.js';

const { World } = await import('../js/world.js');
const key = (cx, cz) => cx + ',' + cz;

// Simulate the state right after Save.loadWorld + world.setSavedEdits(...):
//   - savedEdits holds every player-edited chunk from disk
//   - editedChunks is empty (nothing edited/regenerated yet this session)
const w = {
  chunks: new Map(),
  editedChunks: new Set(),
  savedEdits: new Map(),
};

const buf = new Uint8Array(CHUNK * CHUNK * 128);
buf[123] = 42;                              // the player's previously-saved edit
World.prototype.setSavedEdits.call(w, new Map([[key(15, 0), buf]]));

// The player plays near spawn and never revisits chunk (15,0), so it is never
// regenerated and never re-added to editedChunks. Now an autosave fires:
const edits = World.prototype.collectEdits.call(w);
const found = edits.find(e => e.cx === 15 && e.cz === 0);

console.log('collected edits count:', edits.length);
console.log('far saved edit present in save data:', !!found);
if (!found)
  console.log('BUG CONFIRMED: saved edit dropped on reload+save (structure reverts)');
else
  console.log('OK: saved edit survived reload+save (block[123]=' + found.blocks[123] + ')');

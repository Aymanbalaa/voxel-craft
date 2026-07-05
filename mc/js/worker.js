// Terrain worker: generates chunks and meshes slabs off the main thread.
// Module worker: new Worker('./worker.js', { type:'module' }).
// All heavy pure code (worldgen/lighting/mesher) imported directly.

import { generateChunk } from './worldgen.js';
import { buildSlab, computeLight } from './lighting.js';
import { meshChunk } from './mesher.js';

let SEED = 0;
let faceTiles = null;

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.t) {
    case 'init': {
      SEED = msg.seed;
      faceTiles = msg.faceTiles;       // Uint16Array(256*6)
      self.postMessage({ t: 'ready' });
      break;
    }
    case 'gen': {
      const blocks = generateChunk(msg.cx, msg.cz, SEED);
      self.postMessage({ t: 'gen', cx: msg.cx, cz: msg.cz, blocks }, [blocks.buffer]);
      break;
    }
    case 'mesh': {
      // msg.chunks = 9 ArrayBuffers|null in [(dcz+1)*3+(dcx+1)] order.
      const bufs = msg.chunks.map(b => b ? new Uint8Array(b) : null);
      const slab = buildSlab(bufs);
      const light = computeLight(slab);
      const m = meshChunk(slab, light, faceTiles);
      const transfer = [
        m.opaque.position.buffer, m.opaque.uv.buffer, m.opaque.color.buffer, m.opaque.index.buffer,
        m.water.position.buffer, m.water.uv.buffer, m.water.color.buffer, m.water.index.buffer,
      ];
      self.postMessage({ t: 'mesh', cx: msg.cx, cz: msg.cz, rev: msg.rev, opaque: m.opaque, water: m.water }, transfer);
      break;
    }
  }
};

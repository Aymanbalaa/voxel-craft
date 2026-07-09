// Terrain worker: generates chunks and meshes slabs off the main thread.
// Module worker: new Worker('./worker.js', { type:'module' }).
// All heavy pure code (worldgen/lighting/mesher) imported directly.

import { generateChunk, biomeAt, biomeTint } from './worldgen.js';
import { buildSlab, computeLight } from './lighting.js';
import { meshChunk } from './mesher.js';
import { CHUNK } from './config.js';

const WHITE = [255, 255, 255];

let SEED = 0;
let faceTiles = null;
let GRASS_TOP = -1, TALL_GRASS = -1; // tile indices that get per-biome tint

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.t) {
    case 'init': {
      SEED = msg.seed;
      faceTiles = msg.faceTiles;       // Uint16Array(256*6)
      const TILES = msg.TILES || {};   // tile name → atlas index
      GRASS_TOP = TILES.grass_top ?? -1;
      TALL_GRASS = TILES.tall_grass ?? -1;
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
      // Per-biome grass tint: recompute biome per world column (grass tiles only).
      const ox = msg.cx * CHUNK, oz = msg.cz * CHUNK;
      const tintAt = (lx, lz, tile) => (tile === GRASS_TOP || tile === TALL_GRASS)
        ? biomeTint(biomeAt(SEED, ox + lx, oz + lz)) : WHITE;
      const m = meshChunk(slab, light, faceTiles, tintAt);
      // buildSlab copied the input chunks into the slab, so the incoming
      // buffers are no longer needed here — transfer them back for the main
      // thread's buffer pool instead of leaving them as worker-side garbage.
      const srcBufs = msg.chunks.filter(Boolean);
      const transfer = [
        m.opaque.position.buffer, m.opaque.uv.buffer, m.opaque.color.buffer, m.opaque.tint.buffer, m.opaque.index.buffer,
        m.water.position.buffer, m.water.uv.buffer, m.water.color.buffer, m.water.tint.buffer, m.water.index.buffer,
        ...srcBufs,
      ];
      self.postMessage({ t: 'mesh', cx: msg.cx, cz: msg.cz, rev: msg.rev, opaque: m.opaque, water: m.water, srcBufs }, transfer);
      break;
    }
  }
};

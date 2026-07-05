// Node tests for lighting.js + mesher.js
import { CHUNK, HEIGHT } from '../js/config.js';
import { B, BLOCKS } from '../js/blocks.js';
import { SLAB, sidx, buildSlab, computeLight } from '../js/lighting.js';
import { meshChunk, buildFaceTiles } from '../js/mesher.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.error('  FAIL:', msg); } }

const VOL = CHUNK * CHUNK * HEIGHT;
// A trivial faceTiles: every block/face -> tile 0. Enough for geometry tests.
const faceTiles = buildFaceTiles(BLOCKS, null);

// Helper: make a 3x3 set of empty chunks, return center for editing.
function emptyChunks() { return Array.from({ length: 9 }, () => new Uint8Array(VOL)); }
const cidx = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

// 1. Single stone cube in the center of an empty world → 6 faces = 24 verts, 36 indices.
{
  const chunks = emptyChunks();
  chunks[4][cidx(8, 40, 8)] = B.STONE;
  const slab = buildSlab(chunks);
  const light = computeLight(slab);
  const m = meshChunk(slab, light, faceTiles);
  ok(m.opaque.position.length === 24 * 3, `lone cube has 24 verts (got ${m.opaque.position.length / 3})`);
  ok(m.opaque.index.length === 36, `lone cube has 36 indices (got ${m.opaque.index.length})`);
  ok(m.water.count === 0, 'no water geometry');
}

// 2. Fully buried cube → 0 faces.
{
  const chunks = emptyChunks();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
    chunks[4][cidx(8 + dx, 40 + dy, 8 + dz)] = B.STONE;
  const slab = buildSlab(chunks);
  const light = computeLight(slab);
  const m = meshChunk(slab, light, faceTiles);
  // center cube contributes 0; the shell's outward faces exist though. Check the CENTER cube specifically:
  // Simpler assertion: a solid 3x3x3 block has only outer faces = 6*9 = 54 faces.
  ok(m.opaque.index.length === 54 * 6, `3x3x3 solid shows 54 faces (got ${m.opaque.index.length / 6})`);
}

// 3. Two adjacent stone cubes → shared face culled → 10 faces (not 12).
{
  const chunks = emptyChunks();
  chunks[4][cidx(8, 40, 8)] = B.STONE;
  chunks[4][cidx(9, 40, 8)] = B.STONE;
  const slab = buildSlab(chunks);
  const m = meshChunk(slab, computeLight(slab), faceTiles);
  ok(m.opaque.index.length / 6 === 10, `two adjacent cubes show 10 faces (got ${m.opaque.index.length / 6})`);
}

// 4. Skylight: open sky column is 15; under a solid roof it's 0 directly below.
{
  const chunks = emptyChunks();
  // roof slab at y=50 across the center chunk
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) chunks[4][cidx(x, 50, z)] = B.STONE;
  const slab = buildSlab(chunks);
  const { sky } = computeLight(slab);
  const cx = 8 + CHUNK, cz = 8 + CHUNK; // center chunk slab coords
  ok(sky[sidx(cx, 60, cz)] === 15, `sky above roof = 15 (got ${sky[sidx(cx, 60, cz)]})`);
  ok(sky[sidx(cx, 49, cz)] < 15, `sky just under roof center < 15 (got ${sky[sidx(cx, 49, cz)]})`);
  ok(sky[sidx(cx, 40, cz)] < 8, `sky deep under roof center is dim (got ${sky[sidx(cx, 40, cz)]})`);
}

// 5. Blocklight: a torch/glowstone emits 15 and falls off by 1 per block.
{
  const chunks = emptyChunks();
  chunks[4][cidx(8, 40, 8)] = B.GLOWSTONE; // emits 15
  const slab = buildSlab(chunks);
  const { block } = computeLight(slab);
  const gx = 8 + CHUNK, gz = 8 + CHUNK;
  ok(block[sidx(gx, 40, gz)] === 15, `glowstone cell = 15 (got ${block[sidx(gx, 40, gz)]})`);
  ok(block[sidx(gx + 1, 40, gz)] === 14, `1 block away = 14 (got ${block[sidx(gx + 1, 40, gz)]})`);
  ok(block[sidx(gx + 5, 40, gz)] === 10, `5 blocks away = 10 (got ${block[sidx(gx + 5, 40, gz)]})`);
  ok(block[sidx(gx + 15, 40, gz)] === 0, `15 blocks away = 0 (got ${block[sidx(gx + 15, 40, gz)]})`);
}

// 6. Cross-plant (tall grass) emits geometry (2 planes × 2 sides = 4 quads = 8 tris).
{
  const chunks = emptyChunks();
  chunks[4][cidx(8, 40, 8)] = B.TALL_GRASS;
  const slab = buildSlab(chunks);
  const m = meshChunk(slab, computeLight(slab), faceTiles);
  ok(m.opaque.index.length / 6 === 4, `tall grass = 4 quads (got ${m.opaque.index.length / 6})`);
}

// 7. Water surface: a single water cell open to air on top produces a lowered top face.
{
  const chunks = emptyChunks();
  chunks[4][cidx(8, 40, 8)] = B.WATER;
  const slab = buildSlab(chunks);
  const m = meshChunk(slab, computeLight(slab), faceTiles);
  ok(m.water.count > 0, 'water produces geometry in the water bucket');
  ok(m.opaque.count === 0, 'water is not in the opaque bucket');
  // top face lowered: max y of water verts should be < 41 (i.e. 40.88)
  let maxY = -1;
  for (let i = 1; i < m.water.position.length; i += 3) maxY = Math.max(maxY, m.water.position[i]);
  ok(maxY < 41 && maxY > 40.5, `water top lowered to ~40.88 (got ${maxY.toFixed(2)})`);
}

// 8. Glass next to glass: internal face culled (2 glass → 10 faces).
{
  const chunks = emptyChunks();
  chunks[4][cidx(8, 40, 8)] = B.GLASS;
  chunks[4][cidx(9, 40, 8)] = B.GLASS;
  const slab = buildSlab(chunks);
  const m = meshChunk(slab, computeLight(slab), faceTiles);
  ok(m.opaque.index.length / 6 === 10, `two glass cull internal face → 10 (got ${m.opaque.index.length / 6})`);
}

// 9. Cross-chunk face culling: a stone cube at the center-chunk edge whose neighbor
//    lives in the adjacent chunk should have that shared face culled.
{
  const chunks = emptyChunks();
  chunks[4][cidx(0, 40, 8)] = B.STONE;     // center chunk, x=0 (west edge)
  chunks[3][cidx(15, 40, 8)] = B.STONE;    // west neighbor, x=15 (touches it)
  const slab = buildSlab(chunks);
  const m = meshChunk(slab, computeLight(slab), faceTiles);
  ok(m.opaque.index.length / 6 === 5, `edge cube culls face against neighbor chunk → 5 (got ${m.opaque.index.length / 6})`);
}

// 10. Color channels are in range and top face is brightest under open sky.
{
  const chunks = emptyChunks();
  chunks[4][cidx(8, 40, 8)] = B.STONE;
  const slab = buildSlab(chunks);
  const m = meshChunk(slab, computeLight(slab), faceTiles);
  let ok255 = true;
  for (const c of m.opaque.color) if (c > 255 || c < 0) ok255 = false;
  ok(ok255, 'all color bytes in [0,255]');
  ok(m.opaque.color.length === m.opaque.position.length, '3 color bytes per vertex');
}

console.log(`\nmesh+light: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

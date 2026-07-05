// Node tests for the tile registry + v2 generators (no browser/canvas needed).
import { REGISTRY, TILES, NAMES, makeRng, chooseSource, TILE } from '../js/texture-registry.js';
import { GENERATORS } from '../js/texture-generators.js';
import { makeMockCtx } from './mock-canvas.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL:', m); } };

// --- Registry completeness + stable order ---
const EXPECTED_HEAD = ['stone', 'grass_top', 'grass_side', 'grass_snow_side', 'dirt', 'cobblestone',
  'oak_planks', 'birch_planks', 'spruce_planks', 'bedrock', 'sand', 'gravel', 'water', 'lava',
  'oak_log', 'oak_log_top', 'birch_log', 'birch_log_top', 'spruce_log', 'spruce_log_top',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'glass', 'coal_ore', 'iron_ore', 'gold_ore',
  'diamond_ore', 'redstone_ore', 'snow', 'ice', 'sandstone', 'sandstone_top', 'sandstone_bottom',
  'cactus_top', 'cactus_bottom', 'cactus_side', 'tall_grass', 'dead_bush', 'dandelion', 'poppy',
  'mushroom_brown', 'mushroom_red', 'torch', 'crafting_table_top', 'crafting_table_side',
  'furnace_top', 'furnace_side', 'furnace_front', 'stone_bricks', 'mossy_cobblestone', 'obsidian',
  'glowstone', 'bricks', 'bookshelf', 'wool', 'clay', 'dirt_path_top', 'dirt_path_side',
  'pumpkin_top', 'pumpkin_side', 'pumpkin_face', 'melon_top', 'melon_side'];

ok(REGISTRY.length >= 112, `registry has >=112 tiles (got ${REGISTRY.length})`);
for (let i = 0; i < EXPECTED_HEAD.length; i++)
  ok(REGISTRY[i].name === EXPECTED_HEAD[i], `tile ${i} is ${EXPECTED_HEAD[i]} (got ${REGISTRY[i]?.name})`);
for (const n of EXPECTED_HEAD) ok(typeof TILES[n] === 'number', `TILES has ${n}`);
ok(TILES.unknown !== undefined, 'TILES has unknown');

// Every registered name has a real v2 generator (no fallback stubs).
for (const t of REGISTRY) ok(GENERATORS[t.name], `${t.name} has a v2 generator`);
ok(NAMES.length === new Set(NAMES).size, 'no duplicate tile names');

// --- Determinism: same seed → identical buffer ---
const draw = (name) => { const idx = TILES[name]; const { ctx, buf } = makeMockCtx(); REGISTRY[idx].gen(ctx, makeRng(idx)); return buf; };
{ const a = draw('stone'), b = draw('stone'); ok(a.every((v, i) => v === b[i]), 'stone generator is deterministic'); }
{ const a = draw('grass_side'), b = draw('grass_side'); ok(a.every((v, i) => v === b[i]), 'grass_side generator is deterministic'); }

// --- Seam test: wrap-aware noise keeps opposite edges continuous ---
function edgeDelta(name) {
  const idx = TILES[name]; const { ctx, at, size } = makeMockCtx();
  GENERATORS[name](ctx, makeRng(idx));
  let d = 0;
  for (let y = 0; y < size; y++) { const L = at(0, y), R = at(size - 1, y); d += Math.abs(L[0] - R[0]) + Math.abs(L[1] - R[1]) + Math.abs(L[2] - R[2]); }
  return d / size;
}
for (const n of ['grass_top', 'dirt', 'stone', 'sand', 'gravel', 'snow']) {
  const d = edgeDelta(n);
  ok(d < 60, `${n} edges are seam-safe (mean edge delta ${d.toFixed(1)} < 60)`);
}

// --- No harsh specks: full-face terrain has no pure black/white pixels ---
function hasHarshSpeck(name) {
  const idx = TILES[name]; const { ctx, buf } = makeMockCtx();
  GENERATORS[name](ctx, makeRng(idx));
  for (let i = 0; i < buf.length; i += 4) {
    const r = buf[i], g = buf[i + 1], b = buf[i + 2], a = buf[i + 3];
    if (a === 0) continue;
    if (r < 8 && g < 8 && b < 8) return true;
    if (r > 248 && g > 248 && b > 248) return true;
  }
  return false;
}
for (const n of ['grass_top', 'dirt', 'stone', 'sand']) ok(!hasHarshSpeck(n), `${n} has no harsh black/white specks`);

// --- Full-face terrain fully opaque (no accidental transparency) ---
function fullyOpaque(name) {
  const idx = TILES[name]; const { ctx, buf } = makeMockCtx();
  GENERATORS[name](ctx, makeRng(idx));
  for (let i = 3; i < buf.length; i += 4) if (buf[i] < 255) return false;
  return true;
}
for (const n of ['stone', 'dirt', 'grass_top', 'sand', 'gravel', 'oak_log', 'oak_planks']) ok(fullyOpaque(n), `${n} is fully opaque`);

// --- Override selection logic ---
ok(chooseSource({ width: TILE, height: TILE }, () => {}) === 'png', 'valid 16x16 PNG wins');
ok(chooseSource(null, () => {}) === 'gen', 'missing PNG falls back to generator');
ok(chooseSource({ width: 8, height: 8 }, () => {}) === 'gen', 'wrong-size PNG rejected');

console.log(`test-atlas: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

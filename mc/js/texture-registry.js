// Tile registry — pure, Node-importable (no `document`). Single source of truth
// for what tiles exist and how each is drawn. `textures.js` composites this into
// the atlas (with optional PNG overrides); Node tests import it directly.

export const TILE = 16, COLS = 16, ATLAS_PX = TILE * COLS; // 256

// ---- Seeded PRNG (mulberry32) — deterministic, reseeded per-tile ------------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const makeRng = (idx) => mulberry32(0xC0FFEE + idx * 101);

// ---- Pixel helpers (restricted API: fillStyle/fillRect/clearRect only) -------
export const clamp8 = (v) => Math.max(0, Math.min(255, v | 0));
export function px(ctx, x, y, r, g, b, a = 255) {
  ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`; ctx.fillRect(x, y, 1, 1);
}
export function fillTile(ctx, r, g, b, a = 255) {
  ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`; ctx.fillRect(0, 0, TILE, TILE);
}
export function clearTile(ctx) { ctx.clearRect(0, 0, TILE, TILE); }

// Wrap-aware value noise: samples a 16x16 grid indexed by (x&15,y&15) so a tile's
// left edge (x=0) hashes identically to a virtual x=16 → seamless when tiled.
export function vnoise(rng) {
  const grid = new Float32Array(TILE * TILE);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  return (x, y) => grid[((y & 15) * TILE) + (x & 15)];
}

// Decide whether an override PNG should replace the generator for a cell.
export function chooseSource(png, _gen) {
  return (png && png.width === TILE && png.height === TILE) ? 'png' : 'gen';
}

// ---- Ordered tile names — MUST match legacy paintAll order (index-stable) ----
export const NAMES = [
  // Terrain blocks
  'stone', 'grass_top', 'grass_side', 'grass_snow_side', 'dirt', 'cobblestone',
  'oak_planks', 'birch_planks', 'spruce_planks', 'bedrock', 'sand', 'gravel', 'water', 'lava',
  'oak_log', 'oak_log_top', 'birch_log', 'birch_log_top', 'spruce_log', 'spruce_log_top',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'glass', 'coal_ore', 'iron_ore', 'gold_ore',
  'diamond_ore', 'redstone_ore', 'snow', 'ice', 'sandstone', 'sandstone_top', 'sandstone_bottom',
  'cactus_top', 'cactus_bottom', 'cactus_side', 'tall_grass', 'dead_bush', 'dandelion', 'poppy',
  'mushroom_brown', 'mushroom_red', 'torch', 'crafting_table_top', 'crafting_table_side',
  'furnace_top', 'furnace_side', 'furnace_front', 'stone_bricks', 'mossy_cobblestone', 'obsidian',
  'glowstone', 'bricks', 'bookshelf', 'wool', 'clay', 'dirt_path_top', 'dirt_path_side',
  'pumpkin_top', 'pumpkin_side', 'pumpkin_face', 'melon_top', 'melon_side',
  // Flat item icons
  'stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'diamond', 'apple', 'bread', 'wheat',
  'porkchop', 'cooked_porkchop', 'string', 'bowl', 'clay_ball', 'brick_item', 'flint', 'leather',
  'bone', 'gunpowder', 'paper', 'book', 'shears',
  // Tool icons
  'wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_sword', 'wooden_hoe',
  'stone_pickaxe', 'stone_axe', 'stone_shovel', 'stone_sword', 'stone_hoe',
  'iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_sword', 'iron_hoe',
  'gold_pickaxe', 'gold_axe', 'gold_shovel', 'gold_sword', 'gold_hoe',
  'diamond_pickaxe', 'diamond_axe', 'diamond_shovel', 'diamond_sword', 'diamond_hoe',
  'unknown',
];

import { GENERATORS } from './texture-generators.js';

export const REGISTRY = NAMES.map((name) => ({
  name,
  gen: GENERATORS[name] || ((ctx) => fillTile(ctx, 230, 60, 230)),
}));

export const TILES = {};
REGISTRY.forEach((t, i) => { TILES[t.name] = i; });

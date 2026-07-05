// Procedural texture generators v2 — pure, seeded, wrap-aware. Restricted to the
// fillStyle/fillRect/clearRect subset so they also run under the Node mock canvas.
// Design: quantize wrap-aware noise into a small fixed palette per material
// (crisp, faithful) instead of per-channel random jitter (which reads as mud).

import { TILE, px, fillTile, clearTile, clamp8, vnoise } from './texture-registry.js';

// Quantize a 0..1 value into one of `shades` ([r,g,b]).
const pick = (n, shades) => shades[Math.min(shades.length - 1, (n * shades.length) | 0)];

// Fill the whole tile by sampling wrap-aware noise into a palette.
function paintNoise(ctx, rng, shades) {
  const nz = vnoise(rng);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const [r, g, b] = pick(nz(x, y), shades);
    px(ctx, x, y, r, g, b);
  }
}

// ---- Palettes (faithful, earthy vanilla-ish) --------------------------------
const STONE = [[124, 124, 127], [132, 132, 135], [140, 140, 143], [118, 118, 121]];
const DIRT = [[122, 86, 58], [134, 96, 67], [112, 78, 52], [128, 92, 63]];
const GRASS = [[92, 148, 58], [104, 160, 66], [84, 140, 52], [112, 168, 74]];
const SAND = [[224, 214, 168], [214, 200, 154], [232, 222, 180], [206, 192, 146]];
const GRAVEL = [[128, 124, 120], [110, 106, 102], [140, 136, 132], [96, 94, 92]];
const SNOW = [[236, 240, 246], [244, 248, 252], [228, 234, 242]];
const BEDROCK = [[70, 70, 74], [86, 86, 90], [54, 54, 58], [96, 96, 100]];

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// Draw a grass lip (organic top strip) over an already-painted dirt tile.
function grassLip(ctx, rng, shades = GRASS) {
  const nz = vnoise(rng);
  for (let x = 0; x < TILE; x++) {
    const h = 3 + (nz(x, 3) < 0.5 ? 0 : 1) + (nz(x, 9) < 0.25 ? 1 : 0); // 3..5
    for (let y = 0; y < h; y++) { const [r, g, b] = pick(nz(x, y), shades); px(ctx, x, y, r, g, b); }
  }
}

// Log side: vertical bark grooves + subtle streaks, seam-safe columns.
function logSide(ctx, rng, bark, streak, dark) {
  const nz = vnoise(rng);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    let c = bark;
    if (x % 4 === 0) c = dark;               // groove
    else if (nz(x, y) > 0.72) c = streak;    // highlight fleck
    px(ctx, x, y, c[0], c[1], c[2]);
  }
}
// Log top: concentric rings around center.
function logTop(ctx, wood, ring) {
  const cx = 7.5, cy = 7.5;
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const c = Math.sin(d * 1.6) > 0.5 ? ring : wood;
    px(ctx, x, y, c[0], c[1], c[2]);
  }
}
// Planks: base fill, deliberate horizontal seams, gentle vertical grain (seeded, seam-safe).
function planks(ctx, rng, base, grain) {
  const nz = vnoise(rng);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    let c = base;
    if (y === 0 || y === 5 || y === 6 || y === 11) c = grain; // plank seams
    else if (nz(x, y) > 0.82) c = grain;                      // grain fleck
    px(ctx, x, y, c[0], c[1], c[2]);
  }
}
// Leaves: faithful green with a couple of alpha holes for depth (kept opaque-ish for Phase 1).
function leaves(ctx, rng, shades) {
  const nz = vnoise(rng);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const [r, g, b] = pick(nz(x, y), shades);
    px(ctx, x, y, r, g, b);
  }
  // darker pockets for depth
  for (let i = 0; i < 5; i++) {
    const x = (nz(i * 3 + 1, i) * TILE) | 0, y = (nz(i, i * 2 + 1) * TILE) | 0;
    const [r, g, b] = pick(0, shades); px(ctx, x, y, clamp8(r * 0.7), clamp8(g * 0.7), clamp8(b * 0.7));
  }
  // Transparent cutout holes: the opaque material's alphaTest (0.5) discards
  // these fragments, giving a see-through "fancy" canopy instead of a solid blob.
  for (let i = 0; i < 13; i++) {
    const x = (nz(i + 5, i * 2) * TILE) | 0, y = (nz(i * 2, i + 7) * TILE) | 0;
    ctx.clearRect(x, y, 1, 1);
  }
}
const LEAF_OAK = [[54, 108, 40], [64, 122, 46], [46, 96, 36], [70, 130, 52]];
const LEAF_BIRCH = [[88, 140, 52], [100, 152, 60], [78, 128, 46], [108, 160, 68]];
const LEAF_SPRUCE = [[40, 84, 50], [48, 96, 58], [34, 74, 44], [54, 104, 64]];

// Ore: stone base + faithful mineral blobs.
function ore(ctx, rng, mineral) {
  paintNoise(ctx, rng, STONE);
  const nz = vnoise(rng);
  const spots = [[4, 4], [11, 5], [6, 10], [12, 12], [3, 12], [9, 8]];
  const dark = mineral.map((v) => clamp8(v * 0.7));
  for (const [sx, sy] of spots) {
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const x = (sx + dx) & 15, y = (sy + dy) & 15;
      const c = nz(x, y) > 0.5 ? mineral : dark;
      px(ctx, x, y, c[0], c[1], c[2]);
    }
  }
}

// Brick/stone-brick pattern (deliberate mortar grid).
function brickPattern(ctx, base, mortar, extra) {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) px(ctx, x, y, base[0], base[1], base[2]);
  ctx.fillStyle = rgb(mortar);
  for (let y = 0; y < TILE; y += 4) ctx.fillRect(0, y, TILE, 1);
  for (let row = 0; row < 4; row++) {
    const offset = (row % 2 === 0) ? 0 : 4;
    for (let x = offset; x < TILE; x += 8) ctx.fillRect(x, row * 4, 1, 4);
  }
  if (extra) extra(ctx);
}

// Cross-plant clear helper.
const cross = (painter) => (ctx, rng) => { clearTile(ctx); painter(ctx, rng); };

function tallGrass(ctx) {
  ctx.fillStyle = 'rgb(96,158,60)';
  const blades = [[2, 15, 5], [5, 15, 12], [8, 15, 6], [11, 15, 10], [14, 15, 8]];
  for (const [x, y0, len] of blades) ctx.fillRect(x, y0 - len, 1, len);
  ctx.fillStyle = 'rgb(72,132,46)';
  ctx.fillRect(7, 9, 1, 6); ctx.fillRect(4, 11, 1, 4);
}
function deadBush(ctx) {
  ctx.fillStyle = 'rgb(126,94,56)';
  const t = [[7, 14], [6, 12], [8, 12], [5, 10], [9, 10], [7, 9], [6, 7], [9, 7], [7, 6]];
  for (const [x, y] of t) ctx.fillRect(x, y, 1, 1);
}
function flower(ctx, petal, center = [235, 200, 40]) {
  ctx.fillStyle = 'rgb(72,132,46)';
  ctx.fillRect(7, 9, 1, 6);
  ctx.fillStyle = rgb(petal);
  ctx.fillRect(6, 4, 4, 4); ctx.fillRect(5, 5, 1, 2); ctx.fillRect(10, 5, 1, 2);
  ctx.fillStyle = rgb(center); ctx.fillRect(7, 5, 2, 2);
}
function mushroom(ctx, cap) {
  ctx.fillStyle = 'rgb(225,225,215)'; ctx.fillRect(7, 10, 1, 4);
  ctx.fillStyle = rgb(cap); ctx.fillRect(5, 7, 5, 3); ctx.fillRect(6, 6, 3, 1);
  if (cap[0] > 180) { ctx.fillStyle = 'rgb(255,255,255)'; ctx.fillRect(5, 7, 1, 1); ctx.fillRect(8, 8, 1, 1); }
}
function torch(ctx) {
  clearTile(ctx);
  ctx.fillStyle = 'rgb(110,80,50)'; ctx.fillRect(7, 8, 2, 7);
  ctx.fillStyle = 'rgb(255,220,90)'; ctx.fillRect(6, 5, 4, 3);
  ctx.fillStyle = 'rgb(255,255,220)'; ctx.fillRect(7, 5, 2, 2);
}
function glass(ctx) {
  clearTile(ctx);
  ctx.fillStyle = 'rgba(210,235,240,0.5)'; ctx.fillRect(0, 0, TILE, TILE);
  ctx.clearRect(2, 2, TILE - 4, TILE - 4);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(0, 0, TILE, 1); ctx.fillRect(0, 0, 1, TILE);
}
function cactus(ctx, rng, isTop) {
  paintNoise(ctx, rng, [[64, 132, 66], [74, 144, 74], [56, 120, 58]]);
  ctx.fillStyle = 'rgba(48,104,52,0.8)';
  for (let y = 0; y < TILE; y += 4) ctx.fillRect(3, y, 1, 2);
  if (isTop) { ctx.fillStyle = 'rgb(92,160,92)'; ctx.fillRect(4, 4, 8, 8); }
}
function sandstone(ctx, rng, banded) {
  paintNoise(ctx, rng, [[220, 205, 160], [228, 214, 172], [212, 197, 150]]);
  if (banded) { ctx.fillStyle = 'rgba(190,175,130,0.6)'; ctx.fillRect(0, 7, TILE, 1); ctx.fillRect(0, 13, TILE, 1); }
}
function water(ctx, rng) {
  paintNoise(ctx, rng, [[54, 104, 210], [62, 116, 222], [48, 96, 200]]);
  ctx.fillStyle = 'rgba(120,170,240,0.5)'; ctx.fillRect(0, 3, TILE, 1); ctx.fillRect(0, 10, TILE, 1);
}
function lava(ctx, rng) {
  paintNoise(ctx, rng, [[220, 90, 20], [236, 110, 26], [200, 70, 14]]);
  const nz = vnoise(rng);
  for (let i = 0; i < 5; i++) { const x = (nz(i, i + 3) * TILE) | 0, y = (nz(i + 2, i) * TILE) | 0; px(ctx, x, y, 255, 220, 80); }
}
function furnaceFront(ctx, rng, lit) {
  paintNoise(ctx, rng, [[100, 100, 102], [108, 108, 110], [92, 92, 94]]);
  ctx.fillStyle = 'rgb(40,40,42)'; ctx.fillRect(4, 8, 8, 6);
  ctx.fillStyle = lit ? 'rgb(255,160,40)' : 'rgb(30,30,30)'; ctx.fillRect(5, 9, 6, 4);
}
function pumpkinSide(ctx, rng) {
  paintNoise(ctx, rng, [[204, 122, 30], [214, 130, 34], [194, 114, 26]]);
  ctx.fillStyle = 'rgba(170,100,20,0.7)';
  for (let x = 2; x < TILE; x += 4) ctx.fillRect(x, 0, 1, TILE);
}

// ---- Item icon helpers (ported, restricted API) -----------------------------
function material(ctx, color, shape) { clearTile(ctx); ctx.fillStyle = rgb(color); shape(ctx, color); }
const stickShape = (ctx) => { ctx.fillStyle = 'rgb(120,84,48)'; ctx.fillRect(6, 2, 2, 12); };
const lumpShape = (ctx) => { ctx.fillRect(4, 6, 8, 6); ctx.fillRect(5, 5, 6, 1); ctx.fillRect(5, 12, 6, 1); };
const ingotShape = (ctx) => { ctx.fillRect(4, 6, 8, 4); ctx.fillRect(5, 5, 6, 1); ctx.fillRect(5, 10, 6, 1); };
const gemShape = (ctx) => { ctx.fillRect(6, 4, 4, 4); ctx.fillRect(5, 6, 6, 4); ctx.fillRect(7, 10, 2, 2); };
const roundFoodShape = (ctx) => { ctx.fillRect(5, 5, 6, 6); ctx.fillRect(6, 4, 4, 1); ctx.fillRect(6, 11, 4, 1); };
const slabShape = (ctx) => { ctx.fillRect(4, 6, 8, 4); };
const stringShape = (ctx) => { for (let y = 2; y < 14; y++) ctx.fillRect(7 + (y % 2), y, 1, 1); };
const bowlShape = (ctx) => { ctx.fillRect(4, 8, 8, 3); ctx.fillRect(5, 11, 6, 1); };
const ballShape = (ctx) => { ctx.fillRect(5, 5, 6, 6); };
const boneShape = (ctx) => { ctx.fillRect(3, 7, 10, 2); ctx.fillRect(2, 6, 2, 1); ctx.fillRect(2, 9, 2, 1); ctx.fillRect(12, 6, 2, 1); ctx.fillRect(12, 9, 2, 1); };
const bookShape = (ctx) => { ctx.fillRect(4, 3, 8, 10); ctx.fillStyle = 'rgb(230,220,190)'; ctx.fillRect(5, 4, 6, 8); };
const shearsShape = (ctx) => { ctx.fillRect(4, 3, 2, 6); ctx.fillRect(10, 3, 2, 6); ctx.fillRect(5, 9, 1, 1); ctx.fillRect(10, 9, 1, 1); ctx.fillRect(7, 10, 2, 4); };
const wheatShape = (ctx) => { ctx.fillRect(7, 2, 2, 12); ctx.fillRect(5, 5, 2, 1); ctx.fillRect(9, 5, 2, 1); ctx.fillRect(5, 8, 2, 1); ctx.fillRect(9, 8, 2, 1); };

function tool(ctx, type, matColor) {
  clearTile(ctx);
  ctx.fillStyle = 'rgb(120,85,50)';
  for (const [x, y] of [[3, 13], [4, 12], [5, 11], [6, 10], [7, 9]]) ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = rgb(matColor);
  if (type === 'pickaxe') { ctx.fillRect(6, 2, 7, 2); ctx.fillRect(5, 3, 2, 2); ctx.fillRect(12, 3, 2, 2); ctx.fillRect(7, 4, 2, 2); }
  else if (type === 'axe') { ctx.fillRect(7, 2, 6, 3); ctx.fillRect(6, 5, 5, 3); ctx.fillRect(9, 8, 2, 2); }
  else if (type === 'shovel') { ctx.fillRect(7, 2, 4, 5); ctx.fillRect(6, 3, 1, 3); ctx.fillRect(11, 3, 1, 3); }
  else if (type === 'sword') { ctx.fillRect(8, 1, 2, 9); ctx.fillRect(6, 9, 6, 2); ctx.fillStyle = 'rgb(90,60,35)'; ctx.fillRect(8, 11, 2, 3); }
  else if (type === 'hoe') { ctx.fillRect(6, 2, 6, 2); ctx.fillRect(6, 4, 2, 2); }
}

const WOOD = [150, 110, 65], STONE_M = [150, 150, 152], IRON = [230, 225, 215], GOLD = [250, 215, 60], DIAMOND_M = [90, 230, 230];
const toolGen = (type, mat) => (c) => tool(c, type, mat);

// ============================================================================
export const GENERATORS = {
  // Terrain
  stone: (c, r) => paintNoise(c, r, STONE),
  grass_top: (c, r) => paintNoise(c, r, GRASS),
  grass_side: (c, r) => { paintNoise(c, r, DIRT); grassLip(c, r, GRASS); },
  grass_snow_side: (c, r) => { paintNoise(c, r, DIRT); grassLip(c, r, SNOW); },
  dirt: (c, r) => paintNoise(c, r, DIRT),
  cobblestone: (c, r) => {
    paintNoise(c, r, [[120, 120, 122], [104, 104, 106], [136, 136, 138], [92, 92, 94]]);
    const nz = vnoise(r);
    for (let i = 0; i < 8; i++) { const x = (nz(i, i + 1) * TILE) | 0, y = (nz(i + 4, i) * TILE) | 0; px(c, x, y, 74, 74, 76); }
  },
  oak_planks: (c, r) => planks(c, r, [178, 140, 90], [130, 98, 58]),
  birch_planks: (c, r) => planks(c, r, [222, 208, 170], [190, 172, 130]),
  spruce_planks: (c, r) => planks(c, r, [130, 92, 55], [95, 65, 36]),
  bedrock: (c, r) => paintNoise(c, r, BEDROCK),
  sand: (c, r) => paintNoise(c, r, SAND),
  gravel: (c, r) => paintNoise(c, r, GRAVEL),
  water,
  lava,
  oak_log: (c, r) => logSide(c, r, [120, 92, 60], [150, 118, 80], [88, 64, 40]),
  oak_log_top: (c) => logTop(c, [190, 155, 105], [140, 105, 65]),
  birch_log: (c, r) => logSide(c, r, [222, 218, 205], [240, 238, 230], [180, 176, 166]),
  birch_log_top: (c) => logTop(c, [220, 205, 165], [180, 160, 120]),
  spruce_log: (c, r) => logSide(c, r, [95, 68, 45], [120, 90, 62], [64, 44, 28]),
  spruce_log_top: (c) => logTop(c, [160, 125, 85], [110, 80, 50]),
  oak_leaves: (c, r) => leaves(c, r, LEAF_OAK),
  birch_leaves: (c, r) => leaves(c, r, LEAF_BIRCH),
  spruce_leaves: (c, r) => leaves(c, r, LEAF_SPRUCE),
  glass,
  coal_ore: (c, r) => ore(c, r, [32, 32, 36]),
  iron_ore: (c, r) => ore(c, r, [200, 150, 100]),
  gold_ore: (c, r) => ore(c, r, [235, 200, 60]),
  diamond_ore: (c, r) => ore(c, r, [90, 220, 220]),
  redstone_ore: (c, r) => ore(c, r, [210, 40, 40]),
  snow: (c, r) => paintNoise(c, r, SNOW),
  ice: (c, r) => { paintNoise(c, r, [[180, 215, 235], [196, 226, 244], [168, 205, 228]]); },
  sandstone: (c, r) => sandstone(c, r, true),
  sandstone_top: (c, r) => sandstone(c, r, false),
  sandstone_bottom: (c, r) => sandstone(c, r, false),
  cactus_top: (c, r) => cactus(c, r, true),
  cactus_bottom: (c, r) => cactus(c, r, false),
  cactus_side: (c, r) => cactus(c, r, false),
  tall_grass: cross(tallGrass),
  dead_bush: cross(deadBush),
  dandelion: cross((c) => flower(c, [235, 200, 40])),
  poppy: cross((c) => flower(c, [210, 40, 40])),
  mushroom_brown: cross((c) => mushroom(c, [150, 100, 70])),
  mushroom_red: cross((c) => mushroom(c, [200, 40, 40])),
  torch: cross(torch),
  crafting_table_top: (c, r) => { planks(c, r, [150, 108, 66], [110, 76, 44]); c.fillStyle = 'rgba(60,40,25,0.8)'; c.fillRect(1, 1, TILE - 2, 1); c.fillRect(1, 1, 1, TILE - 2); c.fillRect(1, TILE - 2, TILE - 2, 1); c.fillRect(TILE - 2, 1, 1, TILE - 2); c.fillRect(2, 7, 12, 1); },
  crafting_table_side: (c, r) => { planks(c, r, [150, 108, 66], [110, 76, 44]); c.fillStyle = 'rgb(90,60,35)'; c.fillRect(2, 3, 2, 2); c.fillRect(12, 3, 2, 2); c.fillRect(2, 11, 2, 2); c.fillRect(12, 11, 2, 2); },
  furnace_top: (c, r) => paintNoise(c, r, [[110, 110, 112], [118, 118, 120], [102, 102, 104]]),
  furnace_side: (c, r) => { paintNoise(c, r, [[100, 100, 102], [108, 108, 110], [92, 92, 94]]); c.fillStyle = 'rgb(70,70,72)'; c.fillRect(1, 1, 14, 2); },
  furnace_front: (c, r) => furnaceFront(c, r, false),
  stone_bricks: (c) => brickPattern(c, [138, 138, 140], [100, 100, 102]),
  mossy_cobblestone: (c, r) => { GENERATORS.cobblestone(c, r); const nz = vnoise(r); for (let i = 0; i < 10; i++) { const x = (nz(i, i + 2) * TILE) | 0, y = (nz(i + 3, i) * TILE) | 0; px(c, x, y, 70, 120, 60); } },
  obsidian: (c, r) => { paintNoise(c, r, [[35, 20, 55], [44, 26, 66], [28, 16, 46]]); const nz = vnoise(r); for (let i = 0; i < 4; i++) { const x = (nz(i, i) * TILE) | 0, y = (nz(i + 1, i) * TILE) | 0; px(c, x, y, 70, 50, 100); } },
  glowstone: (c, r) => { paintNoise(c, r, [[240, 200, 120], [250, 216, 140], [228, 186, 104]]); const nz = vnoise(r); for (let i = 0; i < 6; i++) { const x = (nz(i, i + 1) * TILE) | 0, y = (nz(i + 2, i) * TILE) | 0; px(c, x, y, 255, 240, 180); } },
  bricks: (c) => brickPattern(c, [150, 70, 55], [190, 190, 185]),
  bookshelf: (c, r) => { planks(c, r, [150, 108, 66], [110, 76, 44]); const spines = [[150, 40, 40], [40, 90, 140], [60, 120, 60], [140, 120, 40]]; let x = 1, i = 0; const nz = vnoise(r); while (x < TILE - 1) { const w = 2 + ((nz(x, 2) * 2) | 0); const cc = spines[i++ % spines.length]; c.fillStyle = rgb(cc); c.fillRect(x, 2, w, 11); x += w; } },
  wool: (c, r) => paintNoise(c, r, [[225, 225, 225], [232, 232, 232], [218, 218, 218]]),
  clay: (c, r) => paintNoise(c, r, [[160, 165, 175], [168, 173, 183], [152, 157, 167]]),
  dirt_path_top: (c, r) => paintNoise(c, r, [[150, 120, 85], [158, 128, 92], [142, 113, 79]]),
  dirt_path_side: (c, r) => { paintNoise(c, r, DIRT); c.fillStyle = 'rgb(150,120,85)'; c.fillRect(0, 0, TILE, 3); },
  pumpkin_top: (c, r) => { paintNoise(c, r, [[200, 120, 30], [210, 128, 34], [190, 112, 26]]); c.fillStyle = 'rgb(90,140,60)'; c.fillRect(6, 6, 4, 4); },
  pumpkin_side: pumpkinSide,
  pumpkin_face: (c, r) => { pumpkinSide(c, r); c.fillStyle = 'rgb(40,30,15)'; c.fillRect(3, 5, 2, 2); c.fillRect(10, 5, 2, 2); c.fillRect(4, 10, 7, 2); c.fillRect(3, 9, 1, 1); c.fillRect(11, 9, 1, 1); },
  melon_top: (c, r) => paintNoise(c, r, [[90, 150, 60], [98, 158, 66], [82, 142, 54]]),
  melon_side: (c, r) => { paintNoise(c, r, [[110, 165, 60], [118, 172, 66], [102, 158, 54]]); c.fillStyle = 'rgba(70,120,45,0.7)'; for (let x = 2; x < TILE; x += 4) c.fillRect(x, 0, 1, TILE); },

  // Flat item icons
  stick: (c) => material(c, [140, 100, 60], stickShape),
  coal: (c) => material(c, [30, 30, 32], lumpShape),
  charcoal: (c) => material(c, [60, 50, 45], lumpShape),
  iron_ingot: (c) => material(c, [230, 225, 215], ingotShape),
  gold_ingot: (c) => material(c, [250, 215, 60], ingotShape),
  diamond: (c) => material(c, [90, 230, 230], gemShape),
  apple: (c) => material(c, [200, 30, 30], roundFoodShape),
  bread: (c) => material(c, [195, 150, 80], slabShape),
  wheat: (c) => material(c, [210, 190, 70], wheatShape),
  porkchop: (c) => material(c, [230, 150, 150], roundFoodShape),
  cooked_porkchop: (c) => material(c, [165, 105, 70], roundFoodShape),
  string: (c) => material(c, [235, 235, 225], stringShape),
  bowl: (c) => material(c, [150, 110, 65], bowlShape),
  clay_ball: (c) => material(c, [170, 175, 185], ballShape),
  brick_item: (c) => material(c, [165, 85, 65], ingotShape),
  flint: (c) => material(c, [70, 70, 75], gemShape),
  leather: (c) => material(c, [160, 115, 70], slabShape),
  bone: (c) => material(c, [235, 230, 210], boneShape),
  gunpowder: (c) => material(c, [90, 90, 95], lumpShape),
  paper: (c) => material(c, [240, 235, 220], slabShape),
  book: (c) => material(c, [150, 40, 40], bookShape),
  shears: (c) => material(c, [210, 210, 215], shearsShape),

  // Tools
  wooden_pickaxe: toolGen('pickaxe', WOOD), wooden_axe: toolGen('axe', WOOD), wooden_shovel: toolGen('shovel', WOOD), wooden_sword: toolGen('sword', WOOD), wooden_hoe: toolGen('hoe', WOOD),
  stone_pickaxe: toolGen('pickaxe', STONE_M), stone_axe: toolGen('axe', STONE_M), stone_shovel: toolGen('shovel', STONE_M), stone_sword: toolGen('sword', STONE_M), stone_hoe: toolGen('hoe', STONE_M),
  iron_pickaxe: toolGen('pickaxe', IRON), iron_axe: toolGen('axe', IRON), iron_shovel: toolGen('shovel', IRON), iron_sword: toolGen('sword', IRON), iron_hoe: toolGen('hoe', IRON),
  gold_pickaxe: toolGen('pickaxe', GOLD), gold_axe: toolGen('axe', GOLD), gold_shovel: toolGen('shovel', GOLD), gold_sword: toolGen('sword', GOLD), gold_hoe: toolGen('hoe', GOLD),
  diamond_pickaxe: toolGen('pickaxe', DIAMOND_M), diamond_axe: toolGen('axe', DIAMOND_M), diamond_shovel: toolGen('shovel', DIAMOND_M), diamond_sword: toolGen('sword', DIAMOND_M), diamond_hoe: toolGen('hoe', DIAMOND_M),

  unknown: (c) => { clearTile(c); c.fillStyle = 'rgb(230,60,230)'; c.fillRect(0, 0, 8, 8); c.fillRect(8, 8, 8, 8); },
};

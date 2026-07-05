// Crafting / smelting / fuel registry. PURE — no three.js, no DOM. Node-testable.
//
// Grid cells: {id,count} | null. Grid array length 4 (2x2) or 9 (3x3), row-major
// (index = r*size + c). Only the *presence* of an item in a slot matters for
// matching (count just needs to be >= 1) — actual consumption of counts is the
// caller's job (inventory system), not this module's.
//
// Recipe design notes / simplifications (documented per the spec):
//  - "Any plank" recipes (sticks, crafting table, bowl) require ALL plank
//    cells in that craft to be the SAME plank type (oak+oak, birch+birch, ...).
//    We implement this by generating one concrete recipe per plank type rather
//    than allowing mixed types in a single craft.
//  - Bookshelf is the one exception: real Minecraft's plank "tag" allows mixed
//    wood types in a single bookshelf, so its plank cells accept ANY plank type
//    independently (mixed allowed).
//  - Tool recipes (pickaxe/axe/shovel/sword/hoe) are generated for 5 material
//    "families" (wood, stone, iron, gold, diamond) x 5 tool shapes = 25 logical
//    recipes. Wood expands to 3 concrete recipes (oak/birch/spruce planks, same
//    type per craft as above), so ALL_RECIPES contains 35 concrete tool entries.
//  - Shaped recipes also match their horizontal mirror image (vanilla Minecraft
//    behavior), so e.g. an axe/hoe/shears pattern can be placed mirrored L-R.

import { B } from './blocks.js';
import { I } from './items.js';

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

function gridToMatrix(grid) {
  const size = grid.length === 4 ? 2 : 3;
  const m = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) row.push(grid[r * size + c] || null);
    m.push(row);
  }
  return { size, m };
}

// Trim a size x size matrix down to the minimal bounding box containing all
// occupied (non-null) cells. Returns null if the grid is entirely empty.
function trimGrid(m, size) {
  let minR = size, maxR = -1, minC = size, maxC = -1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = m[r][c];
      if (cell && cell.count >= 1) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR === -1) return null;
  const rows = maxR - minR + 1;
  const cols = maxC - minC + 1;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(m[minR + r][minC + c]);
    cells.push(row);
  }
  return { rows, cols, cells };
}

function occupiedIds(m, size) {
  const ids = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = m[r][c];
      if (cell && cell.count >= 1) ids.push(cell.id);
    }
  }
  return ids;
}

// A pattern cell is: null (must be empty), a number (exact id), or an array of
// numbers (any-of match, used for the mixed-plank bookshelf recipe).
function cellMatches(patternCell, actualCell) {
  if (patternCell === null || patternCell === undefined) return actualCell === null;
  if (!actualCell || actualCell.count < 1) return false;
  if (Array.isArray(patternCell)) return patternCell.includes(actualCell.id);
  return actualCell.id === patternCell;
}

function matchesPattern(trimmed, pattern) {
  const rows = pattern.length;
  const cols = pattern[0].length;
  if (trimmed.rows !== rows || trimmed.cols !== cols) return false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cellMatches(pattern[r][c], trimmed.cells[r][c])) return false;
    }
  }
  return true;
}

function mirrorPattern(pattern) {
  return pattern.map((row) => [...row].reverse());
}

function multisetEquals(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

// ---------------------------------------------------------------------------
// Recipe construction
// ---------------------------------------------------------------------------

const ST = I.STICK;
const PLANKS = [B.OAK_PLANKS, B.BIRCH_PLANKS, B.SPRUCE_PLANKS];
const LOG_TO_PLANKS = [
  [B.OAK_LOG, B.OAK_PLANKS],
  [B.BIRCH_LOG, B.BIRCH_PLANKS],
  [B.SPRUCE_LOG, B.SPRUCE_PLANKS],
];

function shapeless(ingredients, result) {
  return { type: 'shapeless', ingredients, result };
}
function shaped(pattern, result) {
  return { type: 'shaped', pattern, result };
}

const recipes = [];

// --- Logs -> planks (shapeless, 1 log -> 4 planks) --------------------------
for (const [log, planks] of LOG_TO_PLANKS) {
  recipes.push(shapeless([log], { id: planks, count: 4 }));
}

// --- Planks -> sticks (shapeless, 2 of same plank type -> 4 sticks) --------
for (const p of PLANKS) {
  recipes.push(shapeless([p, p], { id: ST, count: 4 }));
}

// --- Crafting table: 2x2 of one plank type -> 1 crafting table -------------
for (const p of PLANKS) {
  recipes.push(shaped([[p, p], [p, p]], { id: B.CRAFTING_TABLE, count: 1 }));
}

// --- Furnace: 8 cobble ring, center empty -> 1 furnace ---------------------
recipes.push(shaped(
  [
    [B.COBBLE, B.COBBLE, B.COBBLE],
    [B.COBBLE, null, B.COBBLE],
    [B.COBBLE, B.COBBLE, B.COBBLE],
  ],
  { id: B.FURNACE, count: 1 },
));

// --- Torch: coal/charcoal over a stick -> 4 torches ------------------------
for (const fuel of [I.COAL, I.CHARCOAL]) {
  recipes.push(shaped([[fuel], [ST]], { id: B.TORCH, count: 4 }));
}

// --- Tools: 5 shapes x (3 plank types + cobble + iron + gold + diamond) ----
const TOOL_MATERIALS = [
  { id: B.OAK_PLANKS, prefix: 'WOODEN' },
  { id: B.BIRCH_PLANKS, prefix: 'WOODEN' },
  { id: B.SPRUCE_PLANKS, prefix: 'WOODEN' },
  { id: B.COBBLE, prefix: 'STONE' },
  { id: I.IRON_INGOT, prefix: 'IRON' },
  { id: I.GOLD_INGOT, prefix: 'GOLD' },
  { id: I.DIAMOND, prefix: 'DIAMOND' },
];

const TOOL_SHAPES = {
  PICKAXE: (M) => [[M, M, M], [null, ST, null], [null, ST, null]],
  AXE: (M) => [[M, M], [M, ST], [null, ST]],
  SHOVEL: (M) => [[M], [ST], [ST]],
  SWORD: (M) => [[M], [M], [ST]],
  HOE: (M) => [[M, M], [null, ST], [null, ST]],
};

for (const mat of TOOL_MATERIALS) {
  for (const [shapeName, patternFn] of Object.entries(TOOL_SHAPES)) {
    const itemKey = `${mat.prefix}_${shapeName}`;
    const resultId = I[itemKey];
    if (resultId === undefined) continue; // safety net if items.js ever changes
    recipes.push(shaped(patternFn(mat.id), { id: resultId, count: 1 }));
  }
}

// --- Shears: 2 iron ingots, diagonal ---------------------------------------
recipes.push(shaped(
  [
    [null, I.IRON_INGOT],
    [I.IRON_INGOT, null],
  ],
  { id: I.SHEARS, count: 1 },
));

// --- Stone bricks: 2x2 stone -> 4 stone bricks ------------------------------
recipes.push(shaped([[B.STONE, B.STONE], [B.STONE, B.STONE]], { id: B.STONE_BRICKS, count: 4 }));

// --- Bricks block: 2x2 brick items -> 1 bricks block ------------------------
recipes.push(shaped([[I.BRICK, I.BRICK], [I.BRICK, I.BRICK]], { id: B.BRICKS, count: 1 }));

// --- Bread: 3 wheat in a row -> 1 bread -------------------------------------
recipes.push(shaped([[I.WHEAT, I.WHEAT, I.WHEAT]], { id: I.BREAD, count: 1 }));

// --- Bowl: 3 planks (same type) in a V -> 4 bowls ---------------------------
// P . P
// . P .
for (const p of PLANKS) {
  recipes.push(shaped(
    [
      [p, null, p],
      [null, p, null],
    ],
    { id: I.BOWL, count: 4 },
  ));
}

// --- Bookshelf: planks / book / planks (mixed plank types allowed) --------
if (I.BOOK !== undefined) {
  recipes.push(shaped(
    [
      [PLANKS, PLANKS, PLANKS],
      [I.BOOK, I.BOOK, I.BOOK],
      [PLANKS, PLANKS, PLANKS],
    ],
    { id: B.BOOKSHELF, count: 1 },
  ));
}

export const ALL_RECIPES = recipes;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function matchRecipe(grid) {
  const { size, m } = gridToMatrix(grid);

  const occupied = occupiedIds(m, size);
  if (occupied.length === 0) return null;

  // Shapeless recipes first.
  for (const r of recipes) {
    if (r.type !== 'shapeless') continue;
    if (multisetEquals(occupied, r.ingredients)) return { result: r.result };
  }

  // Shaped recipes: trim to bounding box, compare (and mirrored) shape.
  const trimmed = trimGrid(m, size);
  if (!trimmed) return null;
  for (const r of recipes) {
    if (r.type !== 'shaped') continue;
    if (matchesPattern(trimmed, r.pattern) || matchesPattern(trimmed, mirrorPattern(r.pattern))) {
      return { result: r.result };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Smelting
// ---------------------------------------------------------------------------

const SMELT = new Map([
  [B.IRON_ORE, { id: I.IRON_INGOT, count: 1 }],
  [B.GOLD_ORE, { id: I.GOLD_INGOT, count: 1 }],
  [B.SAND, { id: B.GLASS, count: 1 }],
  [B.COBBLE, { id: B.STONE, count: 1 }],
  [I.CLAY_BALL, { id: I.BRICK, count: 1 }],
  [B.OAK_LOG, { id: I.CHARCOAL, count: 1 }],
  [B.BIRCH_LOG, { id: I.CHARCOAL, count: 1 }],
  [B.SPRUCE_LOG, { id: I.CHARCOAL, count: 1 }],
  [I.PORKCHOP, { id: I.COOKED_PORKCHOP, count: 1 }],
]);

export function smeltResult(inputId) {
  const r = SMELT.get(inputId);
  return r ? { id: r.id, count: r.count } : null;
}

// ---------------------------------------------------------------------------
// Fuel (values in item-smelt-ticks; 1 smelt operation = 200 ticks)
// ---------------------------------------------------------------------------

const FUEL = new Map([
  [I.COAL, 1600],       // 8 items worth
  [I.CHARCOAL, 1600],   // 8 items worth
  [B.OAK_PLANKS, 300],  // 1.5 items worth
  [B.BIRCH_PLANKS, 300],
  [B.SPRUCE_PLANKS, 300],
  [B.OAK_LOG, 300],
  [B.BIRCH_LOG, 300],
  [B.SPRUCE_LOG, 300],
  [I.STICK, 100],       // 0.5 items worth
  [B.CRAFTING_TABLE, 300],
  [B.BOOKSHELF, 300],
]);

export function fuelTicks(itemId) {
  return FUEL.get(itemId) || 0;
}

// Node test for recipes.js. Run: node mc/test/test-recipes.mjs
import { B } from '../js/blocks.js';
import { I } from '../js/items.js';
import { matchRecipe, smeltResult, fuelTicks, ALL_RECIPES } from '../js/recipes.js';

let pass = 0;
let fail = 0;

function stack(id, count = 1) {
  return { id, count };
}

function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`PASS: ${name}`);
  } else {
    fail++;
    console.log(`FAIL: ${name}`);
  }
}

function deepEqResult(actual, expected) {
  if (expected === null) return actual === null;
  if (!actual || !actual.result) return false;
  return actual.result.id === expected.id && actual.result.count === expected.count;
}

// Build a grid of given size (2 or 3) filled with nulls, then apply overrides
// via a map of "r,c" -> {id,count}.
function grid(size, cells) {
  const g = new Array(size * size).fill(null);
  for (const [key, val] of Object.entries(cells)) {
    const [r, c] = key.split(',').map(Number);
    g[r * size + c] = val;
  }
  return g;
}

// --- log -> planks ----------------------------------------------------------
{
  const g = grid(2, { '0,0': stack(B.OAK_LOG, 1) });
  const res = matchRecipe(g);
  check('oak log -> 4 oak planks', deepEqResult(res, { id: B.OAK_PLANKS, count: 4 }));
}
{
  const g = grid(3, { '1,1': stack(B.BIRCH_LOG, 1) });
  const res = matchRecipe(g);
  check('birch log -> 4 birch planks (in 3x3 grid)', deepEqResult(res, { id: B.BIRCH_PLANKS, count: 4 }));
}

// --- sticks ------------------------------------------------------------------
{
  const g = grid(2, { '0,0': stack(B.OAK_PLANKS, 1), '1,0': stack(B.OAK_PLANKS, 1) });
  const res = matchRecipe(g);
  check('2 oak planks -> 4 sticks', deepEqResult(res, { id: I.STICK, count: 4 }));
}

// --- crafting table: 2x2 grid and 3x3 grid corner ---------------------------
{
  const g = grid(2, {
    '0,0': stack(B.OAK_PLANKS), '0,1': stack(B.OAK_PLANKS),
    '1,0': stack(B.OAK_PLANKS), '1,1': stack(B.OAK_PLANKS),
  });
  const res = matchRecipe(g);
  check('2x2 oak planks -> crafting table (2x2 grid)', deepEqResult(res, { id: B.CRAFTING_TABLE, count: 1 }));
}
{
  // Same shape, placed in the top-left corner of a 3x3 grid.
  const g = grid(3, {
    '0,0': stack(B.OAK_PLANKS), '0,1': stack(B.OAK_PLANKS),
    '1,0': stack(B.OAK_PLANKS), '1,1': stack(B.OAK_PLANKS),
  });
  const res = matchRecipe(g);
  check('2x2 oak planks -> crafting table (corner of 3x3 grid)', deepEqResult(res, { id: B.CRAFTING_TABLE, count: 1 }));
}
{
  // Placed off in a different corner (bottom-right) of a 3x3 grid.
  const g = grid(3, {
    '1,1': stack(B.SPRUCE_PLANKS), '1,2': stack(B.SPRUCE_PLANKS),
    '2,1': stack(B.SPRUCE_PLANKS), '2,2': stack(B.SPRUCE_PLANKS),
  });
  const res = matchRecipe(g);
  check('2x2 spruce planks -> crafting table (bottom-right of 3x3 grid)', deepEqResult(res, { id: B.CRAFTING_TABLE, count: 1 }));
}

// --- pickaxe (iron), shaped in a 3x3 grid -----------------------------------
{
  const g = grid(3, {
    '0,0': stack(I.IRON_INGOT), '0,1': stack(I.IRON_INGOT), '0,2': stack(I.IRON_INGOT),
    '1,1': stack(I.STICK),
    '2,1': stack(I.STICK),
  });
  const res = matchRecipe(g);
  check('iron pickaxe shaped match', deepEqResult(res, { id: I.IRON_PICKAXE, count: 1 }));
}

// --- furnace: 8 cobble ring --------------------------------------------------
{
  const g = grid(3, {
    '0,0': stack(B.COBBLE), '0,1': stack(B.COBBLE), '0,2': stack(B.COBBLE),
    '1,0': stack(B.COBBLE), '1,2': stack(B.COBBLE),
    '2,0': stack(B.COBBLE), '2,1': stack(B.COBBLE), '2,2': stack(B.COBBLE),
  });
  const res = matchRecipe(g);
  check('8 cobble ring -> furnace', deepEqResult(res, { id: B.FURNACE, count: 1 }));
}

// --- torch: coal over stick --------------------------------------------------
{
  const g = grid(3, {
    '0,0': stack(I.COAL),
    '1,0': stack(I.STICK),
  });
  const res = matchRecipe(g);
  check('coal over stick -> 4 torches', deepEqResult(res, { id: B.TORCH, count: 4 }));
}
{
  const g = grid(3, {
    '0,0': stack(I.CHARCOAL),
    '1,0': stack(I.STICK),
  });
  const res = matchRecipe(g);
  check('charcoal over stick -> 4 torches', deepEqResult(res, { id: B.TORCH, count: 4 }));
}

// --- sword (diamond) ---------------------------------------------------------
{
  const g = grid(3, {
    '0,1': stack(I.DIAMOND),
    '1,1': stack(I.DIAMOND),
    '2,1': stack(I.STICK),
  });
  const res = matchRecipe(g);
  check('diamond sword shaped match', deepEqResult(res, { id: I.DIAMOND_SWORD, count: 1 }));
}

// --- axe (wooden), and its mirror image --------------------------------------
{
  const g = grid(3, {
    '0,0': stack(B.OAK_PLANKS), '0,1': stack(B.OAK_PLANKS),
    '1,0': stack(B.OAK_PLANKS), '1,1': stack(I.STICK),
    '2,1': stack(I.STICK),
  });
  const res = matchRecipe(g);
  check('wooden axe shaped match', deepEqResult(res, { id: I.WOODEN_AXE, count: 1 }));
}
{
  // Mirrored horizontally.
  const g = grid(3, {
    '0,1': stack(B.OAK_PLANKS), '0,2': stack(B.OAK_PLANKS),
    '1,1': stack(I.STICK), '1,2': stack(B.OAK_PLANKS),
    '2,1': stack(I.STICK),
  });
  const res = matchRecipe(g);
  check('wooden axe mirrored shaped match', deepEqResult(res, { id: I.WOODEN_AXE, count: 1 }));
}

// --- shears -------------------------------------------------------------------
{
  const g = grid(2, {
    '0,1': stack(I.IRON_INGOT),
    '1,0': stack(I.IRON_INGOT),
  });
  const res = matchRecipe(g);
  check('2 iron ingots diagonal -> shears', deepEqResult(res, { id: I.SHEARS, count: 1 }));
}

// --- stone bricks --------------------------------------------------------------
{
  const g = grid(2, {
    '0,0': stack(B.STONE), '0,1': stack(B.STONE),
    '1,0': stack(B.STONE), '1,1': stack(B.STONE),
  });
  const res = matchRecipe(g);
  check('2x2 stone -> 4 stone bricks', deepEqResult(res, { id: B.STONE_BRICKS, count: 4 }));
}

// --- bricks block ----------------------------------------------------------
{
  const g = grid(2, {
    '0,0': stack(I.BRICK), '0,1': stack(I.BRICK),
    '1,0': stack(I.BRICK), '1,1': stack(I.BRICK),
  });
  const res = matchRecipe(g);
  check('2x2 brick items -> bricks block', deepEqResult(res, { id: B.BRICKS, count: 1 }));
}

// --- bread -------------------------------------------------------------------
{
  const g = grid(3, {
    '1,0': stack(I.WHEAT), '1,1': stack(I.WHEAT), '1,2': stack(I.WHEAT),
  });
  const res = matchRecipe(g);
  check('3 wheat in a row -> bread', deepEqResult(res, { id: I.BREAD, count: 1 }));
}

// --- bowl ----------------------------------------------------------------------
{
  const g = grid(3, {
    '0,0': stack(B.SPRUCE_PLANKS), '0,2': stack(B.SPRUCE_PLANKS),
    '1,1': stack(B.SPRUCE_PLANKS),
  });
  const res = matchRecipe(g);
  check('planks V -> 4 bowls', deepEqResult(res, { id: I.BOWL, count: 4 }));
}

// --- bookshelf (mixed plank types allowed) --------------------------------------
if (I.BOOK !== undefined) {
  const g = grid(3, {
    '0,0': stack(B.OAK_PLANKS), '0,1': stack(B.BIRCH_PLANKS), '0,2': stack(B.SPRUCE_PLANKS),
    '1,0': stack(I.BOOK), '1,1': stack(I.BOOK), '1,2': stack(I.BOOK),
    '2,0': stack(B.OAK_PLANKS), '2,1': stack(B.OAK_PLANKS), '2,2': stack(B.OAK_PLANKS),
  });
  const res = matchRecipe(g);
  check('mixed planks + books -> bookshelf', deepEqResult(res, { id: B.BOOKSHELF, count: 1 }));
}

// --- non-matching grid -----------------------------------------------------
{
  const g = grid(3, {
    '0,0': stack(B.DIRT), '1,1': stack(B.SAND), '2,2': stack(B.GRAVEL),
  });
  const res = matchRecipe(g);
  check('garbage grid -> null', res === null);
}
{
  const g = grid(2, {}); // fully empty
  const res = matchRecipe(g);
  check('empty grid -> null', res === null);
}

// --- smelting ----------------------------------------------------------------
check('smelt iron ore -> iron ingot', JSON.stringify(smeltResult(B.IRON_ORE)) === JSON.stringify({ id: I.IRON_INGOT, count: 1 }));
check('smelt gold ore -> gold ingot', JSON.stringify(smeltResult(B.GOLD_ORE)) === JSON.stringify({ id: I.GOLD_INGOT, count: 1 }));
check('smelt sand -> glass', JSON.stringify(smeltResult(B.SAND)) === JSON.stringify({ id: B.GLASS, count: 1 }));
check('smelt cobble -> stone', JSON.stringify(smeltResult(B.COBBLE)) === JSON.stringify({ id: B.STONE, count: 1 }));
check('smelt clay ball -> brick', JSON.stringify(smeltResult(I.CLAY_BALL)) === JSON.stringify({ id: I.BRICK, count: 1 }));
check('smelt oak log -> charcoal', JSON.stringify(smeltResult(B.OAK_LOG)) === JSON.stringify({ id: I.CHARCOAL, count: 1 }));
check('smelt porkchop -> cooked porkchop', JSON.stringify(smeltResult(I.PORKCHOP)) === JSON.stringify({ id: I.COOKED_PORKCHOP, count: 1 }));
check('smelt non-smeltable -> null', smeltResult(B.GLASS) === null);

// --- fuel ----------------------------------------------------------------------
check('fuelTicks(coal) === 1600', fuelTicks(I.COAL) === 1600);
check('fuelTicks(charcoal) === 1600', fuelTicks(I.CHARCOAL) === 1600);
check('fuelTicks(oak planks) === 300', fuelTicks(B.OAK_PLANKS) === 300);
check('fuelTicks(stick) === 100', fuelTicks(I.STICK) === 100);
check('fuelTicks(random non-fuel material) === 0', fuelTicks(B.DIAMOND_ORE) === 0 && fuelTicks(I.DIAMOND) === 0);

// --- sanity on recipe registry ------------------------------------------------
check('ALL_RECIPES is a non-empty array', Array.isArray(ALL_RECIPES) && ALL_RECIPES.length > 0);

console.log(`\n${pass} passed, ${fail} failed, ${ALL_RECIPES.length} total recipes`);
if (fail > 0) process.exit(1);
process.exit(0);

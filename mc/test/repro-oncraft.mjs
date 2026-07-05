// Repro: the crafting result slot in the survival inventory never shows/crafts,
// because main.js's onCraft() and ui.js disagree on the return shape.
//
// ui.js (result slot) does:
//     const preview = ctx.onCraft(grid);
//     if (preview && preview.result) { ctx.takeCraftResult(grid); ... }   // line 489
//     renderResultSlot(preview) -> renderSlotEl(el, preview ? preview.result : null)  // line 529
// i.e. ui.js expects onCraft() to return { result: {id,count} } | null.
//
// main.js does:
//     onCraft(grid) { const r = matchRecipe(grid); return r ? r.result : null; }
// i.e. it returns the inner {id,count} stack, so preview.result === undefined.

import { matchRecipe } from '../js/recipes.js';
import { B } from '../js/blocks.js';

// A valid 2x2 craft: 1 oak log -> 4 oak planks (shapeless).
const grid = [{ id: B.OAK_LOG, count: 1 }, null, null, null];

// Sanity: the recipe itself matches and is wrapped in {result}.
const raw = matchRecipe(grid);
console.log('matchRecipe(grid) =', JSON.stringify(raw));

// --- Current main.js onCraft ---
const onCraftCurrent = (g) => { const r = matchRecipe(g); return r ? r.result : null; };
const previewCur = onCraftCurrent(grid);
const uiWouldCraftCur = !!(previewCur && previewCur.result);
const resultSlotShowsCur = previewCur ? previewCur.result : null;
console.log('CURRENT  onCraft ->', JSON.stringify(previewCur));
console.log('  ui guard (preview && preview.result) =', uiWouldCraftCur);
console.log('  result slot renders stack =', JSON.stringify(resultSlotShowsCur ?? null));

// --- Proposed fix: onCraft returns the {result} wrapper ---
const onCraftFixed = (g) => matchRecipe(g);
const previewFix = onCraftFixed(grid);
const uiWouldCraftFix = !!(previewFix && previewFix.result);
const resultSlotShowsFix = previewFix ? previewFix.result : null;
console.log('FIXED    onCraft ->', JSON.stringify(previewFix));
console.log('  ui guard (preview && preview.result) =', uiWouldCraftFix);
console.log('  result slot renders stack =', JSON.stringify(resultSlotShowsFix ?? null));

console.log('\nBUG:', uiWouldCraftCur === false && uiWouldCraftFix === true
  ? 'CONFIRMED — valid recipe is invisible/uncraftable in UI with current onCraft, fixed by returning the wrapper'
  : 'not reproduced');

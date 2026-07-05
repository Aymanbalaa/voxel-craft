// Repro: takeCraftResult() can push the cursor stack ABOVE maxStack, duplicating
// items. main.js:
//   else if (inventory.cursor.id === res.id) inventory.cursor.count += res.count;
// adds the result to the held cursor with NO stack-size check. Vanilla forbids
// taking the result when it wouldn't fit on the cursor.

import { matchRecipe } from '../js/recipes.js';
import { maxStack } from '../js/items.js';
import { B } from '../js/blocks.js';

// Faithful copy of main.js takeCraftResult's cursor arithmetic (grid consume omitted).
function takeCurrent(cursor, grid) {
  const r = matchRecipe(grid);
  if (!r) return cursor;
  const res = r.result;
  if (!cursor) cursor = { id: res.id, count: res.count };
  else if (cursor.id === res.id) cursor.count += res.count;   // <-- no cap
  else return cursor;
  return cursor;
}

function takeFixed(cursor, grid) {
  const r = matchRecipe(grid);
  if (!r) return cursor;
  const res = r.result;
  if (!cursor) cursor = { id: res.id, count: res.count };
  else if (cursor.id === res.id && cursor.count + res.count <= maxStack(res.id)) cursor.count += res.count;
  else return cursor;   // different item OR would overflow the stack -> no-op
  return cursor;
}

// Craft = 1 oak log -> 4 oak planks. Cursor already near full (62 planks).
const grid = [{ id: B.OAK_LOG, count: 1 }, null, null, null];
const max = maxStack(B.OAK_PLANKS);

const cur1 = takeCurrent({ id: B.OAK_PLANKS, count: 62 }, grid);
console.log(`CURRENT: cursor 62 + 4 -> ${cur1.count} (maxStack=${max})  overflow=${cur1.count > max}`);

const cur2 = takeFixed({ id: B.OAK_PLANKS, count: 62 }, grid);
console.log(`FIXED:   cursor 62 + 4 -> ${cur2.count} (blocked, stays 62)  overflow=${cur2.count > max}`);

console.log('\nBUG:', cur1.count > max && cur2.count <= max ? 'CONFIRMED' : 'not reproduced');

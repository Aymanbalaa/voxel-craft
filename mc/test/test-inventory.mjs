import { Inventory } from '../js/inventory.js';
import { B } from '../js/blocks.js';
import { I } from '../js/items.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL:', m); } };

// addItem merges then fills empties, respects maxStack.
{
  const inv = new Inventory();
  inv.addItem({ id: B.DIRT, count: 100 });
  ok(inv.slots[0].count === 64 && inv.slots[1].count === 36, 'addItem splits across stacks at maxStack');
  ok(inv.count(B.DIRT) === 100, 'count sums stacks');
}
// tools maxStack 1
{
  const inv = new Inventory();
  const left = inv.addItem({ id: I.IRON_PICKAXE, count: 1 });
  ok(left === null && inv.slots[0].count === 1, 'tool added');
}
// left click pick up + place
{
  const inv = new Inventory();
  inv.slots[0] = { id: B.STONE, count: 10 };
  inv.clickSlot(0, 'left');           // pick up
  ok(inv.cursor.count === 10 && inv.slots[0] === null, 'left click picks up whole stack');
  inv.clickSlot(5, 'left');           // place into empty
  ok(inv.slots[5].count === 10 && inv.cursor === null, 'left click places into empty');
}
// right click picks up half, places one
{
  const inv = new Inventory();
  inv.slots[0] = { id: B.SAND, count: 9 };
  inv.clickSlot(0, 'right');
  ok(inv.cursor.count === 5 && inv.slots[0].count === 4, 'right click takes ceil(half)');
  inv.clickSlot(1, 'right');
  ok(inv.slots[1].count === 1 && inv.cursor.count === 4, 'right click places one');
}
// merge same id up to max leaves leftover on cursor
{
  const inv = new Inventory();
  inv.slots[0] = { id: B.DIRT, count: 60 };
  inv.cursor = { id: B.DIRT, count: 20 };
  inv.clickSlot(0, 'left');
  ok(inv.slots[0].count === 64 && inv.cursor.count === 16, 'merge caps at maxStack, leftover on cursor');
}
// swap different items
{
  const inv = new Inventory();
  inv.slots[0] = { id: B.STONE, count: 5 };
  inv.cursor = { id: B.OAK_LOG, count: 3 };
  inv.clickSlot(0, 'left');
  ok(inv.slots[0].id === B.OAK_LOG && inv.cursor.id === B.STONE, 'left click swaps different items');
}
// shift-move hotbar -> main
{
  const inv = new Inventory();
  inv.slots[0] = { id: B.COBBLE, count: 30 };
  inv.clickSlot(0, 'left', true);
  ok(inv.slots[0] === null && inv.slots[9]?.count === 30, 'shift-move sends hotbar stack to main');
}
// consumeSelected
{
  const inv = new Inventory();
  inv.slots[0] = { id: B.TORCH, count: 2 };
  inv.consumeSelected();
  ok(inv.slots[0].count === 1, 'consumeSelected decrements');
  inv.consumeSelected();
  ok(inv.slots[0] === null, 'consumeSelected clears empty stack');
}

console.log(`\ninventory: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

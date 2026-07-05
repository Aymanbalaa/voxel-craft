// Item registry (non-block items: tools, food, materials). PURE.
// Block ids 0..255 are also valid item ids (a block in inventory). Items start at 256.

import { B, BLOCKS } from './blocks.js';

export const I = {
  STICK: 256, COAL: 257, CHARCOAL: 258, IRON_INGOT: 259, GOLD_INGOT: 260,
  DIAMOND: 261, APPLE: 262, BREAD: 263, WHEAT: 264, PORKCHOP: 265, COOKED_PORKCHOP: 266,
  STRING: 267, BOWL: 268, CLAY_BALL: 269, BRICK: 270, FLINT: 271, LEATHER: 272,
  BONE: 273, GUNPOWDER: 274, PAPER: 275, BOOK: 276, CHARRED: 277,

  // Tools: tier 0 wood, 1 stone, 2 iron, 3 gold(fast/weak treated as 0 dmg but tier flag), 4 diamond.
  WOODEN_PICKAXE: 300, WOODEN_AXE: 301, WOODEN_SHOVEL: 302, WOODEN_SWORD: 303, WOODEN_HOE: 304,
  STONE_PICKAXE: 305, STONE_AXE: 306, STONE_SHOVEL: 307, STONE_SWORD: 308, STONE_HOE: 309,
  IRON_PICKAXE: 310, IRON_AXE: 311, IRON_SHOVEL: 312, IRON_SWORD: 313, IRON_HOE: 314,
  GOLD_PICKAXE: 315, GOLD_AXE: 316, GOLD_SHOVEL: 317, GOLD_SWORD: 318, GOLD_HOE: 319,
  DIAMOND_PICKAXE: 320, DIAMOND_AXE: 321, DIAMOND_SHOVEL: 322, DIAMOND_SWORD: 323, DIAMOND_HOE: 324,
  SHEARS: 325,
};

// Tool factory: type, tier, mining speed multiplier, attack damage.
function tool(name, icon, type, tier, speed, dmg) {
  return { name, icon, maxStack: 1, tool: { type, tier, speed }, damage: dmg, durability: [0,60,132,251,33,1562][tier] };
}
function food(name, icon, hunger, sat, stack = 64) {
  return { name, icon, maxStack: stack, food: { hunger, saturation: sat } };
}
function mat(name, icon, stack = 64) { return { name, icon, maxStack: stack }; }

export const ITEMS = {
  [I.STICK]:   mat('Stick', 'stick'),
  [I.COAL]:    mat('Coal', 'coal'),
  [I.CHARCOAL]:mat('Charcoal', 'charcoal'),
  [I.IRON_INGOT]: mat('Iron Ingot', 'iron_ingot'),
  [I.GOLD_INGOT]: mat('Gold Ingot', 'gold_ingot'),
  [I.DIAMOND]: mat('Diamond', 'diamond'),
  [I.STRING]:  mat('String', 'string'),
  [I.BOWL]:    mat('Bowl', 'bowl'),
  [I.CLAY_BALL]: mat('Clay Ball', 'clay_ball'),
  [I.BRICK]:   mat('Brick', 'brick_item'),
  [I.FLINT]:   mat('Flint', 'flint'),
  [I.LEATHER]: mat('Leather', 'leather'),
  [I.BONE]:    mat('Bone', 'bone'),
  [I.GUNPOWDER]: mat('Gunpowder', 'gunpowder'),
  [I.PAPER]:   mat('Paper', 'paper'),
  [I.BOOK]:    mat('Book', 'book'),
  [I.WHEAT]:   mat('Wheat', 'wheat'),

  [I.APPLE]:   food('Apple', 'apple', 4, 2.4),
  [I.BREAD]:   food('Bread', 'bread', 5, 6),
  [I.PORKCHOP]: food('Raw Porkchop', 'porkchop', 3, 1.8),
  [I.COOKED_PORKCHOP]: food('Cooked Porkchop', 'cooked_porkchop', 8, 12.8),

  [I.WOODEN_PICKAXE]: tool('Wooden Pickaxe','wooden_pickaxe','pickaxe',0,2,2),
  [I.WOODEN_AXE]:     tool('Wooden Axe','wooden_axe','axe',0,2,3),
  [I.WOODEN_SHOVEL]:  tool('Wooden Shovel','wooden_shovel','shovel',0,2,1),
  [I.WOODEN_SWORD]:   tool('Wooden Sword','wooden_sword','sword',0,1,4),
  [I.WOODEN_HOE]:     tool('Wooden Hoe','wooden_hoe','hoe',0,1,1),
  [I.STONE_PICKAXE]:  tool('Stone Pickaxe','stone_pickaxe','pickaxe',1,4,3),
  [I.STONE_AXE]:      tool('Stone Axe','stone_axe','axe',1,4,4),
  [I.STONE_SHOVEL]:   tool('Stone Shovel','stone_shovel','shovel',1,4,2),
  [I.STONE_SWORD]:    tool('Stone Sword','stone_sword','sword',1,1,5),
  [I.STONE_HOE]:      tool('Stone Hoe','stone_hoe','hoe',1,1,1),
  [I.IRON_PICKAXE]:   tool('Iron Pickaxe','iron_pickaxe','pickaxe',2,6,4),
  [I.IRON_AXE]:       tool('Iron Axe','iron_axe','axe',2,6,5),
  [I.IRON_SHOVEL]:    tool('Iron Shovel','iron_shovel','shovel',2,6,3),
  [I.IRON_SWORD]:     tool('Iron Sword','iron_sword','sword',2,1,6),
  [I.IRON_HOE]:       tool('Iron Hoe','iron_hoe','hoe',2,1,1),
  [I.GOLD_PICKAXE]:   tool('Golden Pickaxe','gold_pickaxe','pickaxe',0,12,2),
  [I.GOLD_AXE]:       tool('Golden Axe','gold_axe','axe',0,12,3),
  [I.GOLD_SHOVEL]:    tool('Golden Shovel','gold_shovel','shovel',0,12,1),
  [I.GOLD_SWORD]:     tool('Golden Sword','gold_sword','sword',0,1,4),
  [I.GOLD_HOE]:       tool('Golden Hoe','gold_hoe','hoe',0,1,1),
  [I.DIAMOND_PICKAXE]:tool('Diamond Pickaxe','diamond_pickaxe','pickaxe',3,8,5),
  [I.DIAMOND_AXE]:    tool('Diamond Axe','diamond_axe','axe',3,8,6),
  [I.DIAMOND_SHOVEL]: tool('Diamond Shovel','diamond_shovel','shovel',3,8,4),
  [I.DIAMOND_SWORD]:  tool('Diamond Sword','diamond_sword','sword',3,1,7),
  [I.DIAMOND_HOE]:    tool('Diamond Hoe','diamond_hoe','hoe',3,1,1),
  [I.SHEARS]:         { name:'Shears', icon:'shears', maxStack:1, tool:{ type:'shears', tier:0, speed:5 }, damage:1, durability:238 },
};

export function isBlockItem(id) { return id > 0 && id < 256; }
export function itemDef(id)  { return isBlockItem(id) ? BLOCKS[id] : ITEMS[id]; }
export function itemName(id) { return isBlockItem(id) ? (BLOCKS[id]?.name || 'Air') : (ITEMS[id]?.name || 'Unknown'); }
export function itemIcon(id) {
  if (isBlockItem(id)) return { block: id }; // UI renders a 3D cube icon from the atlas
  return { flat: ITEMS[id]?.icon || 'unknown' };
}
export function maxStack(id) { return isBlockItem(id) ? 64 : (ITEMS[id]?.maxStack ?? 64); }
export function toolOf(id)   { return isBlockItem(id) ? null : (ITEMS[id]?.tool || null); }
export function foodValue(id){ return isBlockItem(id) ? null : (ITEMS[id]?.food || null); }
export function attackDamage(id) { return isBlockItem(id) ? 1 : (ITEMS[id]?.damage || 1); }

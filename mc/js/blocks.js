// Block registry. PURE — no three.js, no DOM. Imported by main, worker, tests.
//
// Shapes: 'block' full cube | 'cross' X-plant | 'torch' | 'cactus' inset | 'liquid'
// Tool types: 'pickaxe' 'axe' 'shovel' 'shears' | null (hand)
// minTier: 0 wood/gold, 1 stone, 2 iron, 3 diamond — required to drop anything.
// tex: {all} | {top,bottom,side} | {top,bottom,side,front} — tile names in textures.js TILES.

export const B = {
  AIR: 0, STONE: 1, GRASS: 2, DIRT: 3, COBBLE: 4, OAK_PLANKS: 5, BEDROCK: 6,
  SAND: 7, GRAVEL: 8, WATER: 9, OAK_LOG: 10, OAK_LEAVES: 11, GLASS: 12,
  COAL_ORE: 13, IRON_ORE: 14, GOLD_ORE: 15, DIAMOND_ORE: 16, REDSTONE_ORE: 17,
  SNOWY_GRASS: 18, SNOW_BLOCK: 19, ICE: 20, SANDSTONE: 21, CACTUS: 22,
  BIRCH_LOG: 23, BIRCH_LEAVES: 24, SPRUCE_LOG: 25, SPRUCE_LEAVES: 26,
  TALL_GRASS: 27, DANDELION: 28, POPPY: 29, DEAD_BUSH: 30, TORCH: 31,
  CRAFTING_TABLE: 32, FURNACE: 33, STONE_BRICKS: 34, MOSSY_COBBLE: 35,
  OBSIDIAN: 36, GLOWSTONE: 37, BRICKS: 38, BOOKSHELF: 39, WOOL: 40,
  LAVA: 41, MUSHROOM_BROWN: 42, MUSHROOM_RED: 43, CLAY: 44, DIRT_PATH: 45,
  PUMPKIN: 46, MELON: 47, OAK_LEAVES_FLOWER: 48, BIRCH_PLANKS: 49, SPRUCE_PLANKS: 50,
};

// Compact factory to keep the table readable.
function blk(name, o = {}) {
  return {
    name,
    solid: o.solid !== false,          // default solid
    opaque: o.opaque !== false,        // default opaque (blocks light+faces)
    shape: o.shape || 'block',
    tex: o.tex || { all: name.toLowerCase().replace(/ /g, '_') },
    hardness: o.hardness ?? 1,
    tool: o.tool || null,
    minTier: o.minTier ?? 0,
    drops: o.drops,                    // block id or item id; default self
    dropCount: o.dropCount || 1,
    light: o.light || 0,               // 0..15 emission
    flammable: !!o.flammable,
    collide: o.collide !== false,      // default has collision
  };
}

export const BLOCKS = {
  [B.STONE]:    blk('Stone',    { tex:{all:'stone'},    hardness:1.5, tool:'pickaxe', minTier:1, drops:B.COBBLE }),
  [B.GRASS]:    blk('Grass Block', { tex:{top:'grass_top', bottom:'dirt', side:'grass_side'}, hardness:0.6, tool:'shovel', drops:B.DIRT }),
  [B.DIRT]:     blk('Dirt',     { tex:{all:'dirt'},     hardness:0.5, tool:'shovel' }),
  [B.COBBLE]:   blk('Cobblestone', { tex:{all:'cobblestone'}, hardness:2, tool:'pickaxe', minTier:1 }),
  [B.OAK_PLANKS]: blk('Oak Planks', { tex:{all:'oak_planks'}, hardness:2, tool:'axe', flammable:true }),
  [B.BIRCH_PLANKS]: blk('Birch Planks', { tex:{all:'birch_planks'}, hardness:2, tool:'axe', flammable:true }),
  [B.SPRUCE_PLANKS]: blk('Spruce Planks', { tex:{all:'spruce_planks'}, hardness:2, tool:'axe', flammable:true }),
  [B.BEDROCK]:  blk('Bedrock',  { tex:{all:'bedrock'}, hardness:-1, drops:0 }), // unbreakable
  [B.SAND]:     blk('Sand',     { tex:{all:'sand'},    hardness:0.5, tool:'shovel' }),
  [B.GRAVEL]:   blk('Gravel',   { tex:{all:'gravel'},  hardness:0.6, tool:'shovel' }),
  [B.WATER]:    blk('Water',    { tex:{all:'water'}, shape:'liquid', solid:false, opaque:false, collide:false, hardness:-1, drops:0 }),
  [B.LAVA]:     blk('Lava',     { tex:{all:'lava'}, shape:'liquid', solid:false, opaque:false, collide:false, hardness:-1, drops:0, light:15 }),
  [B.OAK_LOG]:  blk('Oak Log',  { tex:{top:'oak_log_top', bottom:'oak_log_top', side:'oak_log'}, hardness:2, tool:'axe', flammable:true }),
  [B.BIRCH_LOG]: blk('Birch Log', { tex:{top:'birch_log_top', bottom:'birch_log_top', side:'birch_log'}, hardness:2, tool:'axe', flammable:true }),
  [B.SPRUCE_LOG]: blk('Spruce Log', { tex:{top:'spruce_log_top', bottom:'spruce_log_top', side:'spruce_log'}, hardness:2, tool:'axe', flammable:true }),
  [B.OAK_LEAVES]: blk('Oak Leaves', { tex:{all:'oak_leaves'}, opaque:false, hardness:0.2, tool:'shears', drops:0, flammable:true }),
  [B.BIRCH_LEAVES]: blk('Birch Leaves', { tex:{all:'birch_leaves'}, opaque:false, hardness:0.2, tool:'shears', drops:0, flammable:true }),
  [B.SPRUCE_LEAVES]: blk('Spruce Leaves', { tex:{all:'spruce_leaves'}, opaque:false, hardness:0.2, tool:'shears', drops:0, flammable:true }),
  [B.GLASS]:    blk('Glass',    { tex:{all:'glass'}, opaque:false, hardness:0.3, drops:0 }),
  [B.COAL_ORE]:    blk('Coal Ore',    { tex:{all:'coal_ore'},    hardness:3, tool:'pickaxe', minTier:1 }),
  [B.IRON_ORE]:    blk('Iron Ore',    { tex:{all:'iron_ore'},    hardness:3, tool:'pickaxe', minTier:2 }),
  [B.GOLD_ORE]:    blk('Gold Ore',    { tex:{all:'gold_ore'},    hardness:3, tool:'pickaxe', minTier:3 }),
  [B.DIAMOND_ORE]: blk('Diamond Ore', { tex:{all:'diamond_ore'}, hardness:3, tool:'pickaxe', minTier:2 }),
  [B.REDSTONE_ORE]:blk('Redstone Ore',{ tex:{all:'redstone_ore'},hardness:3, tool:'pickaxe', minTier:2 }),
  [B.SNOWY_GRASS]: blk('Snowy Grass', { tex:{top:'snow', bottom:'dirt', side:'grass_snow_side'}, hardness:0.6, tool:'shovel', drops:B.DIRT }),
  [B.SNOW_BLOCK]:  blk('Snow',   { tex:{all:'snow'}, hardness:0.2, tool:'shovel' }),
  [B.ICE]:      blk('Ice',      { tex:{all:'ice'}, opaque:false, hardness:0.5, tool:'pickaxe', drops:0 }),
  [B.SANDSTONE]:blk('Sandstone',{ tex:{top:'sandstone_top', bottom:'sandstone_bottom', side:'sandstone'}, hardness:0.8, tool:'pickaxe', minTier:1 }),
  [B.CACTUS]:   blk('Cactus',   { tex:{top:'cactus_top', bottom:'cactus_bottom', side:'cactus_side'}, shape:'cactus', opaque:false, hardness:0.4 }),
  [B.TALL_GRASS]: blk('Grass', { tex:{all:'tall_grass'}, shape:'cross', solid:false, opaque:false, collide:false, hardness:0, drops:0 }),
  [B.DEAD_BUSH]:  blk('Dead Bush', { tex:{all:'dead_bush'}, shape:'cross', solid:false, opaque:false, collide:false, hardness:0, drops:0 }),
  [B.DANDELION]:  blk('Dandelion', { tex:{all:'dandelion'}, shape:'cross', solid:false, opaque:false, collide:false, hardness:0 }),
  [B.POPPY]:      blk('Poppy', { tex:{all:'poppy'}, shape:'cross', solid:false, opaque:false, collide:false, hardness:0 }),
  [B.MUSHROOM_BROWN]: blk('Brown Mushroom', { tex:{all:'mushroom_brown'}, shape:'cross', solid:false, opaque:false, collide:false, hardness:0 }),
  [B.MUSHROOM_RED]:   blk('Red Mushroom', { tex:{all:'mushroom_red'}, shape:'cross', solid:false, opaque:false, collide:false, hardness:0 }),
  [B.TORCH]:    blk('Torch', { tex:{all:'torch'}, shape:'torch', solid:false, opaque:false, collide:false, hardness:0, light:14 }),
  [B.CRAFTING_TABLE]: blk('Crafting Table', { tex:{top:'crafting_table_top', bottom:'oak_planks', side:'crafting_table_side'}, hardness:2.5, tool:'axe', flammable:true }),
  [B.FURNACE]:  blk('Furnace', { tex:{top:'furnace_top', bottom:'furnace_top', side:'furnace_side', front:'furnace_front'}, hardness:3.5, tool:'pickaxe', minTier:1 }),
  [B.STONE_BRICKS]: blk('Stone Bricks', { tex:{all:'stone_bricks'}, hardness:1.5, tool:'pickaxe', minTier:1 }),
  [B.MOSSY_COBBLE]: blk('Mossy Cobblestone', { tex:{all:'mossy_cobblestone'}, hardness:2, tool:'pickaxe', minTier:1 }),
  [B.OBSIDIAN]: blk('Obsidian', { tex:{all:'obsidian'}, hardness:50, tool:'pickaxe', minTier:3 }),
  [B.GLOWSTONE]:blk('Glowstone', { tex:{all:'glowstone'}, hardness:0.3, light:15 }),
  [B.BRICKS]:   blk('Bricks', { tex:{all:'bricks'}, hardness:2, tool:'pickaxe', minTier:1 }),
  [B.BOOKSHELF]:blk('Bookshelf', { tex:{top:'oak_planks', bottom:'oak_planks', side:'bookshelf'}, hardness:1.5, tool:'axe', flammable:true, drops:0 }),
  [B.WOOL]:     blk('Wool', { tex:{all:'wool'}, hardness:0.8, tool:'shears', flammable:true }),
  [B.CLAY]:     blk('Clay', { tex:{all:'clay'}, hardness:0.6, tool:'shovel' }),
  [B.DIRT_PATH]:blk('Dirt Path', { tex:{top:'dirt_path_top', bottom:'dirt', side:'dirt_path_side'}, hardness:0.6, tool:'shovel', drops:B.DIRT }),
  [B.PUMPKIN]:  blk('Pumpkin', { tex:{top:'pumpkin_top', bottom:'pumpkin_top', side:'pumpkin_side', front:'pumpkin_face'}, hardness:1, tool:'axe' }),
  [B.MELON]:    blk('Melon', { tex:{top:'melon_top', bottom:'melon_top', side:'melon_side'}, hardness:1, tool:'axe' }),
};

// ---- Fast lookup tables (built once) ---------------------------------------

const MAX_ID = 256;
export const IS_SOLID   = new Uint8Array(MAX_ID);
export const IS_OPAQUE  = new Uint8Array(MAX_ID);
export const IS_COLLIDE = new Uint8Array(MAX_ID);
export const LIGHT_EMIT = new Uint8Array(MAX_ID);
export const SHAPE_ID   = new Uint8Array(MAX_ID); // 0 block,1 cross,2 torch,3 cactus,4 liquid

const SHAPE_MAP = { block:0, cross:1, torch:2, cactus:3, liquid:4 };

for (const id in BLOCKS) {
  const b = BLOCKS[id];
  IS_SOLID[id]   = b.solid ? 1 : 0;
  IS_OPAQUE[id]  = b.opaque ? 1 : 0;
  IS_COLLIDE[id] = b.collide ? 1 : 0;
  LIGHT_EMIT[id] = b.light;
  SHAPE_ID[id]   = SHAPE_MAP[b.shape] ?? 0;
}

export function isSolid(id)  { return IS_SOLID[id] === 1; }
export function isOpaque(id) { return IS_OPAQUE[id] === 1; }
export function blockName(id){ return BLOCKS[id]?.name || 'Air'; }

// What a block drops when mined with `toolTier`/`toolType`. Returns {id,count}|null.
export function blockDrop(id, toolType, toolTier) {
  const b = BLOCKS[id];
  if (!b || id === B.AIR) return null;
  if (b.hardness < 0) return null; // bedrock/liquids
  // Required tool check: if a tool is required and player's tool is wrong/too weak → no drop.
  if (b.tool && b.minTier > 0) {
    if (toolType !== b.tool || toolTier < b.minTier) return null;
  }
  const dropId = (b.drops === undefined) ? Number(id) : b.drops;
  if (dropId === 0) return null;
  return { id: dropId, count: b.dropCount };
}

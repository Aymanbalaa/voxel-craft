// VoxelCraft - js/blocks.js
// Classic script (no ES modules). Attaches block definitions and helpers to the
// global window per CONTRACT.md.
//
// Globals exposed:
//   AIR             - number = 0 (reserved air id).
//   BLOCKS          - object NAME -> { id, name, color, emissive,
//                     emissiveIntensity, transparent? }.
//   HOTBAR          - array of selectable block ids (ordered).
//   getBlockById(id)- function returning a block definition or null.
//
// Standard Minecraft palette: blocks have normal colors, no neon emissive glow.
//   color             - block face color (0xRRGGBB).
//   emissive          - always 0x000000 (no glow).
//   emissiveIntensity - always 0 (no bloom).
//   transparent       - kept for GLASS / WATER.

(function (global) {
  'use strict';

  // Air is always id 0.
  var AIR = 0;

  // Block registry. Ids are unique positive integers (0 reserved for AIR).
  // Transparent blocks (GLASS, WATER) are flagged so the mesher can treat their
  // face culling differently from opaque blocks.
  // Standard Minecraft palette: no emissive glow, just base colors.
  var BLOCKS = {
    GRASS:  { id: 1, name: 'Grass',     color: 0x7ec850, emissive: 0x000000, emissiveIntensity: 0,     transparent: false },
    DIRT:   { id: 2, name: 'Dirt',      color: 0x8b7355, emissive: 0x000000, emissiveIntensity: 0,     transparent: false },
    STONE:  { id: 3, name: 'Stone',     color: 0x777777, emissive: 0x000000, emissiveIntensity: 0,     transparent: false },
    WOOD:   { id: 4, name: 'Wood',      color: 0x6b4423, emissive: 0x000000, emissiveIntensity: 0,     transparent: false },
    LEAVES: { id: 5, name: 'Leaves',    color: 0x5f9e3f, emissive: 0x000000, emissiveIntensity: 0,     transparent: false },
    SAND:   { id: 6, name: 'Sand',      color: 0xc9b350, emissive: 0x000000, emissiveIntensity: 0,     transparent: false },
    PLANK:  { id: 7, name: 'Plank',     color: 0xa6845c, emissive: 0x000000, emissiveIntensity: 0,     transparent: false },
    GLASS:  { id: 8, name: 'Glass',     color: 0xb3d9ff, emissive: 0x000000, emissiveIntensity: 0,     transparent: true  },
    WATER:  { id: 9, name: 'Water',     color: 0x2d5a7b, emissive: 0x000000, emissiveIntensity: 0,     transparent: true  }
  };

  // Build a fast id -> definition lookup table so getBlockById is O(1).
  var BY_ID = {};
  (function indexBlocks() {
    for (var key in BLOCKS) {
      if (Object.prototype.hasOwnProperty.call(BLOCKS, key)) {
        var def = BLOCKS[key];
        BY_ID[def.id] = def;
      }
    }
  })();

  // Ordered list of selectable block ids shown in the hotbar UI.
  var HOTBAR = [
    BLOCKS.GRASS.id,
    BLOCKS.DIRT.id,
    BLOCKS.STONE.id,
    BLOCKS.WOOD.id,
    BLOCKS.LEAVES.id,
    BLOCKS.SAND.id,
    BLOCKS.PLANK.id,
    BLOCKS.GLASS.id
  ];

  // Return the block definition for an id, or null for AIR / unknown ids.
  function getBlockById(id) {
    if (id === AIR) return null;
    var def = BY_ID[id];
    return def ? def : null;
  }

  // Expose globals.
  global.AIR = AIR;
  global.BLOCKS = BLOCKS;
  global.HOTBAR = HOTBAR;
  global.getBlockById = getBlockById;
})(window);

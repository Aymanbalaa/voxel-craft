// Procedural terrain generation. PURE — imports only noise/blocks/config.
// generateChunk(cx,cz,seed) -> Uint8Array(16*128*16), idx = x + z*16 + y*256.
//
// Pipeline per column: biome (temp/humidity) -> height (continent+hills+ridged mtn)
// -> stone/dirt/surface strata -> water/ice fill to sea level -> caves (3D noise)
// -> ores (by depth) -> bedrock floor. Then decorations (trees/plants/snow) placed
// with neighborhood-deterministic hashing so features that cross chunk borders agree.

import { Noise } from './noise.js';
import { B } from './blocks.js';
import { CHUNK, HEIGHT, SEA_LEVEL } from './config.js';

const AREA = CHUNK * CHUNK;               // 256
const VOL = AREA * HEIGHT;                // 32768
export const idx = (x, y, z) => x + z * CHUNK + y * AREA;

export const BIOME = {
  OCEAN: 0, BEACH: 1, DESERT: 2, PLAINS: 3, FOREST: 4, BIRCH_FOREST: 5,
  TAIGA: 6, SNOWY: 7, MOUNTAINS: 8, SAVANNA: 9,
};
export const BIOME_NAME = ['Ocean','Beach','Desert','Plains','Forest','Birch Forest','Taiga','Snowy Tundra','Mountains','Savanna'];

// A NoiseField bundles all the seeded noise layers we need. Built once per seed and cached.
let CACHE = null;
function fields(seed) {
  if (CACHE && CACHE.seed === seed) return CACHE;
  const base = new Noise(seed);
  CACHE = {
    seed,
    cont: base.derive('continent'),   // large landmass shape
    hill: base.derive('hills'),       // medium hills
    ridge: base.derive('ridge'),      // mountain ridges
    temp: base.derive('temperature'),
    humid: base.derive('humidity'),
    cave1: base.derive('cave1'),
    cave2: base.derive('cave2'),
    caveCheese: base.derive('cheese'),
    // Pre-derive ore noise fields ONCE (deriving per-voxel rebuilds a 256-perm
    // table millions of times per chunk — the single biggest gen cost).
    oreDiamond: base.derive('ore').derive('diamond'),
    oreRedstone: base.derive('ore').derive('redstone'),
    oreGold: base.derive('ore').derive('gold'),
    oreIron: base.derive('ore').derive('iron'),
    oreCoal: base.derive('ore').derive('coal'),
    surface: base.derive('surfacevar'),
    tree: base.derive('tree'),
    detail: base.derive('detail'),
  };
  return CACHE;
}

// Integer hash for deterministic per-column feature decisions (trees, flowers).
function hash2i(x, z, salt) {
  let h = (x * 374761393 + z * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // [0,1)
}

// --- Per-column climate + biome ---------------------------------------------

function climate(f, wx, wz) {
  // temperature falls with a low-freq field; humidity independent.
  const t = f.temp.fbm2(wx * 0.0016, wz * 0.0016, 3) * 0.5 + 0.5;      // 0..1
  const h = f.humid.fbm2(wx * 0.0021 + 100, wz * 0.0021 + 100, 3) * 0.5 + 0.5;
  return { t, h };
}

// Continent/height in world blocks.
function terrainHeight(f, wx, wz, t) {
  const c = f.cont.fbm2(wx * 0.0009, wz * 0.0009, 4);          // -1..1 landmass
  const hills = f.hill.fbm2(wx * 0.006, wz * 0.006, 4);        // -1..1
  // Mountain mask: ridged noise gated by high continent + coolish temp.
  const ridge = f.ridge.ridged2(wx * 0.0032, wz * 0.0032, 4); // 0..1
  const mtnMask = Math.max(0, c) * Math.max(0, ridge - 0.55) * 2.2;

  let h = SEA_LEVEL + c * 26 + hills * 7;
  h += mtnMask * 55;                                           // sharp peaks
  // flatten deep oceans a bit
  if (c < -0.15) h = SEA_LEVEL - 6 + (c + 0.15) * 30;
  return h;
}

function pickBiome(t, h, height, mtn) {
  if (height < SEA_LEVEL - 3) return BIOME.OCEAN;
  if (height <= SEA_LEVEL + 1) return BIOME.BEACH;
  if (mtn) return BIOME.MOUNTAINS;
  if (t > 0.72) return h < 0.35 ? BIOME.DESERT : BIOME.SAVANNA;
  if (t < 0.28) return h > 0.5 ? BIOME.SNOWY : BIOME.TAIGA;
  if (h > 0.6) return BIOME.FOREST;
  if (h > 0.45) return BIOME.BIRCH_FOREST;
  return BIOME.PLAINS;
}

// Surface block set per biome.
function surfaceOf(biome) {
  switch (biome) {
    case BIOME.DESERT:   return { top: B.SAND, filler: B.SAND, fillerDepth: 4 };
    case BIOME.BEACH:    return { top: B.SAND, filler: B.SAND, fillerDepth: 3 };
    case BIOME.SNOWY:    return { top: B.SNOWY_GRASS, filler: B.DIRT, fillerDepth: 4 };
    case BIOME.TAIGA:    return { top: B.GRASS, filler: B.DIRT, fillerDepth: 4 };
    case BIOME.MOUNTAINS:return { top: B.GRASS, filler: B.DIRT, fillerDepth: 3 };
    case BIOME.OCEAN:    return { top: B.GRAVEL, filler: B.DIRT, fillerDepth: 3 };
    default:             return { top: B.GRASS, filler: B.DIRT, fillerDepth: 4 };
  }
}

// --- Cave carving ------------------------------------------------------------

function isCave(f, wx, y, wz) {
  if (y <= 3 || y >= HEIGHT - 4) return false;
  // Spaghetti caves: intersection of two low-freq 3D fields near zero → tunnels.
  const a = f.cave1.simplex3(wx * 0.012, y * 0.015, wz * 0.012);
  const b = f.cave2.simplex3(wx * 0.012 + 50, y * 0.015 + 50, wz * 0.012 + 50);
  if (a * a + b * b < 0.0038) return true;
  // Cheese caverns: bigger blobs, more common deeper.
  const depthBias = (SEA_LEVEL - y) / SEA_LEVEL; // grows below sea level
  const cheese = f.caveCheese.fbm3(wx * 0.02, y * 0.03, wz * 0.02, 3);
  if (cheese > 0.62 - depthBias * 0.12 && y < SEA_LEVEL) return true;
  return false;
}

// --- Ores --------------------------------------------------------------------

function oreAt(f, wx, y, wz) {
  // Each ore is a thresholded high-freq 3D noise, gated to a depth band.
  if (y < 16) {
    if (f.oreDiamond.simplex3(wx * 0.11, y * 0.11, wz * 0.11) > 0.86) return B.DIAMOND_ORE;
    if (f.oreRedstone.simplex3(wx * 0.10, y * 0.10, wz * 0.10) > 0.80) return B.REDSTONE_ORE;
  }
  if (y < 32 && f.oreGold.simplex3(wx * 0.10, y * 0.10, wz * 0.10) > 0.85) return B.GOLD_ORE;
  if (y < 64 && f.oreIron.simplex3(wx * 0.09, y * 0.09, wz * 0.09) > 0.80) return B.IRON_ORE;
  if (y < 128 && f.oreCoal.simplex3(wx * 0.08, y * 0.08, wz * 0.08) > 0.80) return B.COAL_ORE;
  return 0;
}

// --- Main generation ---------------------------------------------------------

export function generateChunk(cx, cz, seed) {
  const f = fields(seed);
  const blocks = new Uint8Array(VOL); // all AIR
  const ox = cx * CHUNK, oz = cz * CHUNK;

  // Store per-column surface height + biome for the decoration pass.
  const heightMap = new Int16Array(AREA);
  const biomeMap = new Uint8Array(AREA);

  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const wx = ox + lx, wz = oz + lz;
      const { t, h } = climate(f, wx, wz);
      let height = terrainHeight(f, wx, wz, t);
      const mtn = height > SEA_LEVEL + 34;
      height = Math.max(2, Math.min(HEIGHT - 12, Math.round(height)));
      const biome = pickBiome(t, h, height, mtn);
      const surf = surfaceOf(biome);
      const ci = lx + lz * CHUNK;
      heightMap[ci] = height;
      biomeMap[ci] = biome;

      for (let y = 0; y <= height; y++) {
        let id = B.STONE;
        const depth = height - y;
        if (y === 0) id = B.BEDROCK;
        else if (y <= 2 && hash2i(wx, wz, y * 31) < 0.5) id = B.BEDROCK; // jagged bedrock floor
        else if (depth === 0) id = (height >= SEA_LEVEL - 1) ? surf.top : surf.filler;
        else if (depth <= surf.fillerDepth) id = surf.filler;

        // Mountain tops get stone/snow instead of grass.
        if (id === B.GRASS && y > SEA_LEVEL + 42) id = B.SNOWY_GRASS;
        if (id === B.STONE && biome === BIOME.DESERT && depth <= 5) id = B.SANDSTONE;

        // Carve caves (never carve bedrock).
        if (id !== B.BEDROCK && depth > 0 && isCave(f, wx, y, wz)) {
          // lava at the bottom of caves
          if (y < 11) blocks[idx(lx, y, lz)] = B.LAVA;
          continue;
        }

        // Ores replace stone.
        if (id === B.STONE) {
          const ore = oreAt(f, wx, y, wz);
          if (ore) id = ore;
        }
        blocks[idx(lx, y, lz)] = id;
      }

      // Water / ice fill from surface up to sea level.
      for (let y = height + 1; y <= SEA_LEVEL; y++) {
        // don't fill if a cave opened the surface below into air that connects to sky? keep simple: fill.
        if (blocks[idx(lx, y, lz)] === B.AIR) {
          blocks[idx(lx, y, lz)] = B.WATER;
        }
      }
      // Freeze top water in cold biomes.
      if ((biome === BIOME.SNOWY || t < 0.24) && height < SEA_LEVEL) {
        const s = idx(lx, SEA_LEVEL, lz);
        if (blocks[s] === B.WATER) blocks[s] = B.ICE;
      }
      // Snow layer on cold land surfaces.
      if (t < 0.26 && height >= SEA_LEVEL && biome !== BIOME.OCEAN) {
        const above = idx(lx, height + 1, lz);
        if (height + 1 < HEIGHT && blocks[above] === B.AIR && blocks[idx(lx, height, lz)] !== B.WATER) {
          // thin snow represented as snow block only on flat-ish snowy biome tops
          if (biome === BIOME.SNOWY) blocks[above] = B.SNOW_BLOCK;
        }
      }
    }
  }

  decorate(f, cx, cz, blocks, heightMap, biomeMap, seed);
  return blocks;
}

// --- Decoration pass (trees, plants) ----------------------------------------
// Trees can overhang chunk borders. To stay deterministic we scan a 3-block
// margin of NEIGHBOR columns too, computing each potential tree's origin by the
// same global hash; if its canopy reaches into this chunk we stamp those voxels.

function columnInfo(f, wx, wz) {
  const { t, h } = climate(f, wx, wz);
  let height = terrainHeight(f, wx, wz, t);
  const mtn = height > SEA_LEVEL + 34;
  height = Math.max(2, Math.min(HEIGHT - 12, Math.round(height)));
  const biome = pickBiome(t, h, height, mtn);
  return { height, biome, t };
}

function treeKind(biome, r) {
  switch (biome) {
    case BIOME.FOREST:       return B.OAK_LOG;
    case BIOME.BIRCH_FOREST: return B.BIRCH_LOG;
    case BIOME.TAIGA:        return B.SPRUCE_LOG;
    case BIOME.SNOWY:        return r < 0.6 ? B.SPRUCE_LOG : 0;
    case BIOME.PLAINS:       return r < 0.12 ? B.OAK_LOG : 0;
    case BIOME.SAVANNA:      return r < 0.10 ? B.OAK_LOG : 0;
    case BIOME.DESERT:       return -1; // cactus marker
    default: return 0;
  }
}

function treeDensity(biome) {
  switch (biome) {
    case BIOME.FOREST: case BIOME.BIRCH_FOREST: return 0.09;
    case BIOME.TAIGA: return 0.08;
    case BIOME.SNOWY: return 0.04;
    case BIOME.PLAINS: case BIOME.SAVANNA: return 0.015;
    case BIOME.DESERT: return 0.012;
    default: return 0;
  }
}

function setLocal(blocks, lx, y, lz, id, overwrite = true) {
  if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
  const i = idx(lx, y, lz);
  if (!overwrite && blocks[i] !== B.AIR) return;
  blocks[i] = id;
}

function stampTree(blocks, cx, cz, gx, gz, ground, logId, leafId) {
  const lx0 = gx - cx * CHUNK, lz0 = gz - cz * CHUNK; // trunk local (may be out of range)
  const isSpruce = logId === B.SPRUCE_LOG;
  const h = isSpruce ? 6 + ((gx ^ gz) & 1) : 4 + ((gx * 7 + gz) & 1);
  // Trunk
  for (let y = 1; y <= h; y++) setLocal(blocks, lx0, ground + y, lz0, logId, false);
  // Canopy
  if (isSpruce) {
    // conical spruce
    let r = 2, top = ground + h;
    for (let y = top - 3; y <= top; y++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) + Math.abs(dz) <= r) setLocal(blocks, lx0 + dx, y, lz0 + dz, leafId, false);
      }
      r = r > 0 ? r - 1 : 1;
      if ((y & 1) === 0) r++; // stagger layers
      r = Math.max(0, Math.min(2, r));
    }
    setLocal(blocks, lx0, top + 1, lz0, leafId, false);
  } else {
    const top = ground + h;
    for (let y = top - 2; y <= top + 1; y++) {
      const r = (y >= top) ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && ((gx + gz + y) & 1)) continue; // trim corners
        if (dx === 0 && dz === 0 && y <= top - 1) continue; // trunk space
        setLocal(blocks, lx0 + dx, y, lz0 + dz, leafId, false);
      }
    }
  }
}

function leafFor(logId) {
  if (logId === B.BIRCH_LOG) return B.BIRCH_LEAVES;
  if (logId === B.SPRUCE_LOG) return B.SPRUCE_LEAVES;
  return B.OAK_LEAVES;
}

function decorate(f, cx, cz, blocks, heightMap, biomeMap, seed) {
  // Trees: scan this chunk plus a 3-block margin so overhanging canopies fill in.
  const M = 3;
  for (let gz = cz * CHUNK - M; gz < cz * CHUNK + CHUNK + M; gz++) {
    for (let gx = cx * CHUNK - M; gx < cx * CHUNK + CHUNK + M; gx++) {
      const inThis = gx >= cx * CHUNK && gx < cx * CHUNK + CHUNK && gz >= cz * CHUNK && gz < cz * CHUNK + CHUNK;
      // Cheap reject most columns.
      const r = hash2i(gx, gz, 91);
      // We need biome/height for the tree's own column; recompute (cheap enough at margin).
      let height, biome;
      if (inThis) { const ci = (gx - cx * CHUNK) + (gz - cz * CHUNK) * CHUNK; height = heightMap[ci]; biome = biomeMap[ci]; }
      else { const info = columnInfo(f, gx, gz); height = info.height; biome = info.biome; }
      if (height < SEA_LEVEL || biome === BIOME.OCEAN || biome === BIOME.BEACH) continue;
      if (r >= treeDensity(biome)) continue;
      // Spacing: require this to be the local max in a 2-radius neighborhood to avoid clumping.
      let clear = true;
      for (let ez = -1; ez <= 1 && clear; ez++) for (let ex = -1; ex <= 1; ex++) {
        if (ex === 0 && ez === 0) continue;
        if (hash2i(gx + ex, gz + ez, 91) < r) { clear = false; break; }
      }
      if (!clear) continue;

      const kind = treeKind(biome, hash2i(gx, gz, 13));
      if (kind === 0) continue;
      if (kind === -1) {
        // Cactus 1-3 tall (only stamp if trunk column is in this chunk).
        if (!inThis) continue;
        const lx = gx - cx * CHUNK, lz = gz - cz * CHUNK;
        const ch = 1 + ((gx ^ gz) % 3);
        for (let y = 1; y <= ch; y++) setLocal(blocks, lx, height + y, lz, B.CACTUS, false);
        continue;
      }
      stampTree(blocks, cx, cz, gx, gz, height, kind, leafFor(kind));
    }
  }

  // Ground plants (only within this chunk, on the surface block).
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const ci = lx + lz * CHUNK;
      const height = heightMap[ci], biome = biomeMap[ci];
      if (height < SEA_LEVEL) continue;
      const top = idx(lx, height, lz);
      const surf = blocks[top];
      const above = height + 1 < HEIGHT ? idx(lx, height + 1, lz) : -1;
      if (above < 0 || blocks[above] !== B.AIR) continue;
      const gx = cx * CHUNK + lx, gz = cz * CHUNK + lz;
      const r = hash2i(gx, gz, 271);
      if (surf === B.GRASS) {
        if (r < 0.18) blocks[above] = B.TALL_GRASS;
        else if (r < 0.205) blocks[above] = B.DANDELION;
        else if (r < 0.225) blocks[above] = B.POPPY;
        else if (biome === BIOME.FOREST && r < 0.235) blocks[above] = (hash2i(gx, gz, 33) < 0.5 ? B.MUSHROOM_RED : B.MUSHROOM_BROWN);
      } else if (surf === B.SAND && biome === BIOME.DESERT) {
        if (r < 0.02) blocks[above] = B.DEAD_BUSH;
      }
    }
  }
}

// Convenience for tests/debug: surface height at world x,z.
export function surfaceHeight(seed, wx, wz) {
  return columnInfo(fields(seed), wx, wz).height;
}
export function biomeAt(seed, wx, wz) {
  return columnInfo(fields(seed), wx, wz).biome;
}

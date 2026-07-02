// js/world.js
// VoxelCraft — World module.
// Global class `World`. Classic script: attaches `World` to `window`.
// Depends on globals: THREE, Noise, BLOCKS, AIR, getBlockById.
//
// Responsibilities:
//   - Store voxel data per chunk in typed arrays.
//   - Generate terrain (heightmap + layers + water/sand + trees) from Noise.
//   - Build one opaque mesh + one transparent mesh per chunk with face culling,
//     per-face shading + per-vertex ambient occlusion via vertex colors, and
//     procedural neon CanvasTextures (cached per block id).
//   - Support getBlock/setBlock in WORLD integer coordinates and rebuild affected
//     chunk meshes (and border neighbors) on edit, disposing replaced geometry.
//
// NEON CYBER-GRID overhaul:
//   - Each block id gets a procedural <canvas> texture (dark base + neon grid /
//     edges / grain) cached once and applied as material.map + emissiveMap, with
//     material.emissive + emissiveIntensity so neon parts bloom under postfx.
//   - Classic voxel per-vertex ambient occlusion darkens crevices.
//   - Water is its own translucent neon-cyan mesh; world.update(dt) shimmers it.
(function () {
  'use strict';

  // ---- Tunable constants ----
  var CHUNK_SIZE = 16;     // blocks per chunk along X and Z
  var WORLD_HEIGHT = 64;   // blocks along Y (0 .. WORLD_HEIGHT-1)
  var RENDER_DISTANCE = 4; // chunks in each direction around origin
  var SEA_LEVEL = 24;      // water fills up to (and including) this Y
  var BEACH_BAND = 2;      // sand appears within this many blocks of sea level

  // Per-face shading multipliers applied to a block's base color.
  var SHADE_TOP = 1.0;
  var SHADE_SIDE = 0.8;
  var SHADE_BOTTOM = 0.6;

  // Six face directions. Each: normal, the 4 corner offsets (CCW when viewed
  // from outside so the front face points along +normal), and a shade factor.
  // Corner offsets are in unit-cube space (block occupies [x,x+1] etc.).
  // Per-face quad UVs (one [u,v] per corner). The neon grid texture is
  // symmetric, so a single mapping works for all faces without flipping.
  var FACE_UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];

  var FACES = [
    { // +X (east) side
      dir: [1, 0, 0], shade: SHADE_SIDE,
      corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
      tangents: [2, 1] // axes spanning this face (z, y)
    },
    { // -X (west) side
      dir: [-1, 0, 0], shade: SHADE_SIDE,
      corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
      tangents: [2, 1]
    },
    { // +Y (top)
      dir: [0, 1, 0], shade: SHADE_TOP,
      corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
      tangents: [0, 2] // x, z
    },
    { // -Y (bottom)
      dir: [0, -1, 0], shade: SHADE_BOTTOM,
      corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      tangents: [0, 2]
    },
    { // +Z (south) side
      dir: [0, 0, 1], shade: SHADE_SIDE,
      corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
      tangents: [0, 1] // x, y
    },
    { // -Z (north) side
      dir: [0, 0, -1], shade: SHADE_SIDE,
      corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
      tangents: [0, 1]
    }
  ];

  // Classic voxel AO brightness for occlusion levels 0..3 (more neighbors ->
  // darker crevice). Multiplied into the vertex color alongside face shading.
  var AO_LEVELS = [1.0, 0.75, 0.55, 0.4];

  /**
   * World
   * @param {THREE.Scene} scene
   * @param {number} seed
   */
  function World(scene, seed) {
    this.scene = scene;
    this.seed = (seed === undefined || seed === null) ? 1337 : seed;

    // Expose constants as instance properties (per contract) and statics below.
    this.CHUNK_SIZE = CHUNK_SIZE;
    this.WORLD_HEIGHT = WORLD_HEIGHT;
    this.RENDER_DISTANCE = RENDER_DISTANCE;
    this.SEA_LEVEL = SEA_LEVEL;

    // Noise generator for the heightmap.
    this.noise = new Noise(this.seed);

    // chunk storage: key "cx,cz" -> chunk object {cx, cz, blocks (Uint8Array),
    //   opaqueMesh, glassMesh, waterMesh}
    this.chunks = {};

    // Per-block-id procedural texture caches (built lazily, reused everywhere).
    //   _texCache[id]      -> THREE.CanvasTexture (color map, dark + neon grid)
    //   _emissiveCache[id] -> THREE.CanvasTexture (glow map: neon parts only)
    //   _matCache key      -> shared THREE material (one per id/kind)
    this._texCache = {};
    this._emissiveCache = {};
    this._matCache = {};

    // Animated-water bookkeeping: list of transparent water meshes + base UVs.
    this._waterMeshes = [];
    this._time = 0;

    // Precompute the set of transparent block ids for fast lookups.
    this._transparent = {}; // id -> true
    for (var k in BLOCKS) {
      if (!Object.prototype.hasOwnProperty.call(BLOCKS, k)) continue;
      var def = BLOCKS[k];
      if (def && def.transparent) this._transparent[def.id] = true;
    }
  }

  // Static constants (also handy without an instance).
  World.CHUNK_SIZE = CHUNK_SIZE;
  World.WORLD_HEIGHT = WORLD_HEIGHT;
  World.RENDER_DISTANCE = RENDER_DISTANCE;
  World.SEA_LEVEL = SEA_LEVEL;

  // ---- Procedural neon textures ----

  // Texture resolution (power-of-two for clean NearestFilter sampling).
  var TEX_SIZE = 32;

  // Convert a 0xRRGGBB hex to a "#rrggbb" CSS string.
  function hexToCss(hex) {
    var s = (hex & 0xffffff).toString(16);
    while (s.length < 6) s = '0' + s;
    return '#' + s;
  }

  // Mix two 0xRRGGBB colors by t in [0,1] -> CSS string.
  function mixCss(a, b, t) {
    var ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    var br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    var r = Math.round(ar + (br - ar) * t);
    var g = Math.round(ag + (bg - ag) * t);
    var bl = Math.round(ab + (bb - ab) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  // Scale a 0xRRGGBB color's brightness by s (0..1), returning a 0xRRGGBB int.
  function scaleColor(hex, s) {
    var r = Math.round(((hex >> 16) & 0xff) * s);
    var g = Math.round(((hex >> 8) & 0xff) * s);
    var b = Math.round((hex & 0xff) * s);
    return (r << 16) | (g << 8) | b;
  }

  // Deterministic per-pixel hash for grain so textures are stable across builds.
  function pixelHash(id, x, y) {
    var h = (x * 73856093) ^ (y * 19349663) ^ (id * 83492791);
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /**
   * _makeBlockTexture — build the COLOR map for a block id: dark base color +
   * subtle grain + a neon grid (lines + glowing edge border) drawn in the
   * block's emissive accent. Cached per id. NearestFilter for crisp voxels.
   */
  World.prototype._makeBlockTexture = function (id) {
    if (this._texCache[id]) return this._texCache[id];
    var def = getBlockById(id);
    if (!def) return null;

    var base = (def.color === undefined) ? 0x222222 : def.color;
    var neon = (def.emissive === undefined) ? base : def.emissive;

    var canvas = document.createElement('canvas');
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    var ctx = canvas.getContext('2d');

    // Dark base fill.
    ctx.fillStyle = hexToCss(base);
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

    // Grain: nudge each pixel slightly toward/away from neon for texture.
    var img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    var d = img.data;
    for (var y = 0; y < TEX_SIZE; y++) {
      for (var x = 0; x < TEX_SIZE; x++) {
        var i = (y * TEX_SIZE + x) * 4;
        var n = pixelHash(id, x, y);
        var jitter = (n - 0.5) * 36; // +/- ~18 per channel
        d[i]     = clamp255(d[i] + jitter);
        d[i + 1] = clamp255(d[i + 1] + jitter);
        d[i + 2] = clamp255(d[i + 2] + jitter);
      }
    }
    ctx.putImageData(img, 0, 0);

    // Neon grid lines (a faint inner cross) drawn dim so it glows subtly.
    ctx.strokeStyle = mixCss(base, neon, 0.45);
    ctx.lineWidth = 1;
    var mid = TEX_SIZE / 2;
    ctx.beginPath();
    ctx.moveTo(mid + 0.5, 0); ctx.lineTo(mid + 0.5, TEX_SIZE);
    ctx.moveTo(0, mid + 0.5); ctx.lineTo(TEX_SIZE, mid + 0.5);
    ctx.stroke();

    // Glowing neon edge border (the bright bloom-driving part).
    ctx.strokeStyle = hexToCss(neon);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, TEX_SIZE - 2, TEX_SIZE - 2);

    // A couple of bright corner ticks for that circuit-board feel.
    ctx.fillStyle = hexToCss(neon);
    var t = 3;
    ctx.fillRect(0, 0, t, t);
    ctx.fillRect(TEX_SIZE - t, 0, t, t);
    ctx.fillRect(0, TEX_SIZE - t, t, t);
    ctx.fillRect(TEX_SIZE - t, TEX_SIZE - t, t, t);

    var tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;

    this._texCache[id] = tex;
    return tex;
  };

  /**
   * _makeEmissiveTexture — build the GLOW map: black everywhere EXCEPT the neon
   * grid/edge, so only the bright parts emit (and bloom). Mirrors the geometry
   * of the color map. Cached per id.
   */
  World.prototype._makeEmissiveTexture = function (id) {
    if (this._emissiveCache[id]) return this._emissiveCache[id];
    var def = getBlockById(id);
    if (!def) return null;
    var rawNeon = (def.emissive === undefined) ? 0xffffff : def.emissive;
    // Bake the block's per-block emissiveIntensity into the glow texture's
    // brightness (the shared material applies one base intensity), so each
    // block's `emissiveIntensity` field still drives how strongly it blooms.
    var ei = (typeof def.emissiveIntensity === 'number') ? def.emissiveIntensity : 0.8;
    var neon = scaleColor(rawNeon, Math.min(1, ei));

    var canvas = document.createElement('canvas');
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    var ctx = canvas.getContext('2d');

    // Black base = no emission.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

    // Dim inner cross.
    ctx.strokeStyle = mixCss(0x000000, neon, 0.35);
    ctx.lineWidth = 1;
    var mid = TEX_SIZE / 2;
    ctx.beginPath();
    ctx.moveTo(mid + 0.5, 0); ctx.lineTo(mid + 0.5, TEX_SIZE);
    ctx.moveTo(0, mid + 0.5); ctx.lineTo(TEX_SIZE, mid + 0.5);
    ctx.stroke();

    // Bright neon edge + corner ticks (the emissive parts).
    ctx.strokeStyle = hexToCss(neon);
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, TEX_SIZE - 2, TEX_SIZE - 2);
    ctx.fillStyle = hexToCss(neon);
    var t = 3;
    ctx.fillRect(0, 0, t, t);
    ctx.fillRect(TEX_SIZE - t, 0, t, t);
    ctx.fillRect(0, TEX_SIZE - t, t, t);
    ctx.fillRect(TEX_SIZE - t, TEX_SIZE - t, t, t);

    var tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;

    this._emissiveCache[id] = tex;
    return tex;
  };

  function clamp255(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  /**
   * _buildAtlas — compose every block id's per-id CanvasTexture (and emissive
   * texture) into a single horizontal-strip atlas so the whole chunk can render
   * as ONE mesh (preserving one-opaque + one-transparent-mesh-per-chunk) while
   * still showing per-block neon textures. Each block id owns one atlas tile;
   * `_atlasUV[id]` gives the tile's [u0,u1] range. Built once, cached.
   *
   * Returns { map: CanvasTexture, emissiveMap: CanvasTexture }.
   */
  World.prototype._buildAtlas = function () {
    if (this._atlas) return this._atlas;

    // Stable ordered list of all known block ids.
    var ids = [];
    for (var key in BLOCKS) {
      if (Object.prototype.hasOwnProperty.call(BLOCKS, key)) {
        ids.push(BLOCKS[key].id);
      }
    }
    ids.sort(function (a, b) { return a - b; });

    var n = ids.length;
    var atlasW = TEX_SIZE * n;
    var atlasH = TEX_SIZE;

    var colorCanvas = document.createElement('canvas');
    colorCanvas.width = atlasW; colorCanvas.height = atlasH;
    var cctx = colorCanvas.getContext('2d');

    var emisCanvas = document.createElement('canvas');
    emisCanvas.width = atlasW; emisCanvas.height = atlasH;
    var ectx = emisCanvas.getContext('2d');
    ectx.fillStyle = '#000000';
    ectx.fillRect(0, 0, atlasW, atlasH);

    this._atlasUV = {}; // id -> [u0, u1]
    // Tiny inset so NearestFilter never bleeds into the neighbor tile.
    var inset = 0.5 / atlasW;

    for (var i = 0; i < n; i++) {
      var id = ids[i];
      var colorTex = this._makeBlockTexture(id);
      var emisTex = this._makeEmissiveTexture(id);
      if (colorTex && colorTex.image) {
        cctx.drawImage(colorTex.image, i * TEX_SIZE, 0);
      }
      if (emisTex && emisTex.image) {
        ectx.drawImage(emisTex.image, i * TEX_SIZE, 0);
      }
      var u0 = i / n + inset;
      var u1 = (i + 1) / n - inset;
      this._atlasUV[id] = [u0, u1];
    }

    var map = new THREE.CanvasTexture(colorCanvas);
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.generateMipmaps = false;
    map.needsUpdate = true;

    var emissiveMap = new THREE.CanvasTexture(emisCanvas);
    emissiveMap.magFilter = THREE.NearestFilter;
    emissiveMap.minFilter = THREE.NearestFilter;
    emissiveMap.generateMipmaps = false;
    emissiveMap.needsUpdate = true;

    this._atlas = { map: map, emissiveMap: emissiveMap };
    return this._atlas;
  };

  // ---- Coordinate / key helpers ----

  // Floor-divide that works for negatives (JS % and / round toward zero).
  function floorDiv(a, b) {
    return Math.floor(a / b);
  }
  // Positive modulo (local coord within a chunk).
  function mod(a, b) {
    return ((a % b) + b) % b;
  }

  World.prototype._chunkKey = function (cx, cz) {
    return cx + ',' + cz;
  };

  // World X -> chunk X index.
  World.prototype._chunkCoord = function (worldXZ) {
    return floorDiv(worldXZ, CHUNK_SIZE);
  };

  // Index into a chunk's typed array from LOCAL block coords (0..CHUNK_SIZE-1,
  // 0..WORLD_HEIGHT-1). Layout: x + z*CHUNK_SIZE + y*CHUNK_SIZE*CHUNK_SIZE.
  function localIndex(lx, ly, lz) {
    return lx + lz * CHUNK_SIZE + ly * CHUNK_SIZE * CHUNK_SIZE;
  }

  // ---- Block access (WORLD coordinates) ----

  /**
   * getBlock — returns the block id at world integer coords.
   * Below the world (y<0) returns STONE (acts as bedrock floor) so the player
   * never falls through; above the world returns AIR.
   */
  World.prototype.getBlock = function (x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return (BLOCKS.STONE ? BLOCKS.STONE.id : AIR);
    if (y >= WORLD_HEIGHT) return AIR;

    var cx = floorDiv(x, CHUNK_SIZE);
    var cz = floorDiv(z, CHUNK_SIZE);
    var chunk = this.chunks[this._chunkKey(cx, cz)];
    if (!chunk) return AIR; // ungenerated chunk == air

    var lx = mod(x, CHUNK_SIZE);
    var lz = mod(z, CHUNK_SIZE);
    return chunk.blocks[localIndex(lx, y, lz)];
  };

  /**
   * setBlock — set a block at world integer coords and rebuild affected meshes.
   * Rebuilds the chunk containing (x,y,z) plus any neighbor chunk whose mesh
   * culling could change (i.e. when the edit sits on a chunk border).
   */
  World.prototype.setBlock = function (x, y, z, id) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= WORLD_HEIGHT) return;

    var cx = floorDiv(x, CHUNK_SIZE);
    var cz = floorDiv(z, CHUNK_SIZE);
    var key = this._chunkKey(cx, cz);
    var chunk = this.chunks[key];
    if (!chunk) {
      // Create a chunk on demand (e.g. editing just outside generated area).
      chunk = this._createChunk(cx, cz);
    }

    var lx = mod(x, CHUNK_SIZE);
    var lz = mod(z, CHUNK_SIZE);
    var idx = localIndex(lx, y, lz);
    if (chunk.blocks[idx] === id) return; // no change
    chunk.blocks[idx] = id;

    // Rebuild this chunk.
    this._buildChunkMesh(chunk);

    // Rebuild border neighbors whose visible faces may have changed.
    if (lx === 0) this._rebuildNeighbor(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this._rebuildNeighbor(cx + 1, cz);
    if (lz === 0) this._rebuildNeighbor(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this._rebuildNeighbor(cx, cz + 1);
  };

  World.prototype._rebuildNeighbor = function (cx, cz) {
    var n = this.chunks[this._chunkKey(cx, cz)];
    if (n) this._buildChunkMesh(n);
  };

  // ---- Chunk creation & generation ----

  World.prototype._createChunk = function (cx, cz) {
    var chunk = {
      cx: cx,
      cz: cz,
      blocks: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT),
      opaqueMesh: null,   // dense blocks (atlas material)
      glassMesh: null,    // non-water transparent blocks (glass)
      waterMesh: null     // animated neon water (own material)
    };
    this.chunks[this._chunkKey(cx, cz)] = chunk;
    return chunk;
  };

  /**
   * generate — create + populate all chunks within render distance of origin,
   * then build and add their meshes to the scene.
   */
  World.prototype.generate = function () {
    var cz, cx;
    // First pass: create chunks and fill voxel data so neighbor lookups during
    // meshing see correct (already-generated) borders.
    for (cz = -RENDER_DISTANCE; cz <= RENDER_DISTANCE; cz++) {
      for (cx = -RENDER_DISTANCE; cx <= RENDER_DISTANCE; cx++) {
        var chunk = this._createChunk(cx, cz);
        this._generateChunkData(chunk);
      }
    }
    // Second pass: build meshes (now cross-chunk culling is accurate).
    for (cz = -RENDER_DISTANCE; cz <= RENDER_DISTANCE; cz++) {
      for (cx = -RENDER_DISTANCE; cx <= RENDER_DISTANCE; cx++) {
        this._buildChunkMesh(this.chunks[this._chunkKey(cx, cz)]);
      }
    }
  };

  // Multi-octave 2D noise -> surface height. Returns an integer Y.
  World.prototype._terrainHeight = function (wx, wz) {
    var amplitude = 1.0;
    var frequency = 1.0 / 64.0; // base feature size (~64 blocks)
    var sum = 0;
    var norm = 0;
    var octaves = 4;
    for (var o = 0; o < octaves; o++) {
      // noise2D returns [-1,1]; remap to [0,1].
      var n = (this.noise.noise2D(wx * frequency, wz * frequency) + 1) * 0.5;
      sum += n * amplitude;
      norm += amplitude;
      amplitude *= 0.5;   // persistence
      frequency *= 2.0;   // lacunarity
    }
    var h01 = sum / norm; // normalized [0,1]

    // Map to a height band centered a bit above sea level for varied terrain.
    var minH = 16;
    var maxH = 48;
    var h = minH + Math.floor(h01 * (maxH - minH));
    if (h < 1) h = 1;
    if (h >= WORLD_HEIGHT) h = WORLD_HEIGHT - 1;
    return h;
  };

  // Deterministic pseudo-random in [0,1) from integer coords + seed.
  // Used for tree placement so generation is reproducible.
  World.prototype._hashRand = function (x, z, salt) {
    var h = (x * 374761393) ^ (z * 668265263) ^ (this.seed * 2147483647) ^
            ((salt || 0) * 1274126177);
    h = (h ^ (h >>> 13)) >>> 0;
    h = (h * 1274126177) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
  };

  /**
   * _generateChunkData — fill a chunk's typed array using the heightmap,
   * layered materials, water/sand, then scatter trees.
   */
  World.prototype._generateChunkData = function (chunk) {
    var b = chunk.blocks;
    var baseX = chunk.cx * CHUNK_SIZE;
    var baseZ = chunk.cz * CHUNK_SIZE;

    var GRASS = BLOCKS.GRASS.id;
    var DIRT = BLOCKS.DIRT.id;
    var STONE = BLOCKS.STONE.id;
    var SAND = BLOCKS.SAND.id;
    var WATER = BLOCKS.WATER.id;

    for (var lz = 0; lz < CHUNK_SIZE; lz++) {
      for (var lx = 0; lx < CHUNK_SIZE; lx++) {
        var wx = baseX + lx;
        var wz = baseZ + lz;
        var h = this._terrainHeight(wx, wz);

        for (var y = 0; y <= h; y++) {
          var id;
          if (y === h) {
            // Surface block.
            if (h <= SEA_LEVEL + BEACH_BAND && h >= SEA_LEVEL - BEACH_BAND) {
              id = SAND; // beaches near the shoreline
            } else if (h < SEA_LEVEL) {
              id = SAND; // sandy seabed under shallow water
            } else {
              id = GRASS;
            }
          } else if (y >= h - 3) {
            // A few blocks of dirt under the surface (sand stays sand on beaches).
            if (h < SEA_LEVEL) id = SAND;
            else id = DIRT;
          } else {
            id = STONE;
          }
          b[localIndex(lx, y, lz)] = id;
        }

        // Fill water from the surface up to sea level where land is below it.
        for (var wy = h + 1; wy <= SEA_LEVEL; wy++) {
          if (wy >= 0 && wy < WORLD_HEIGHT) {
            b[localIndex(lx, wy, lz)] = WATER;
          }
        }
      }
    }

    // Scatter trees on grassy, above-water columns.
    this._placeTrees(chunk);
  };

  World.prototype._placeTrees = function (chunk) {
    var b = chunk.blocks;
    var baseX = chunk.cx * CHUNK_SIZE;
    var baseZ = chunk.cz * CHUNK_SIZE;
    var GRASS = BLOCKS.GRASS.id;
    var WOOD = BLOCKS.WOOD.id;
    var LEAVES = BLOCKS.LEAVES.id;

    // Keep trees away from chunk borders so the whole tree fits in this chunk
    // (canopy radius is 2). This avoids cross-chunk write coordination.
    for (var lz = 2; lz < CHUNK_SIZE - 2; lz++) {
      for (var lx = 2; lx < CHUNK_SIZE - 2; lx++) {
        var wx = baseX + lx;
        var wz = baseZ + lz;
        var h = this._terrainHeight(wx, wz);

        // Only on grass and clearly above sea level.
        if (h <= SEA_LEVEL) continue;
        if (b[localIndex(lx, h, lz)] !== GRASS) continue;

        // ~3% chance per eligible column.
        if (this._hashRand(wx, wz, 7) > 0.03) continue;

        var trunkH = 4 + Math.floor(this._hashRand(wx, wz, 13) * 3); // 4..6
        var topY = h + trunkH;
        if (topY + 2 >= WORLD_HEIGHT) continue; // no room

        // Trunk.
        for (var t = 1; t <= trunkH; t++) {
          b[localIndex(lx, h + t, lz)] = WOOD;
        }

        // Leaf canopy: two wide layers, then a small cap.
        var canopyBase = h + trunkH - 2;
        for (var ly = 0; ly < 3; ly++) {
          var cy = canopyBase + ly;
          if (cy >= WORLD_HEIGHT) continue;
          var radius = (ly < 2) ? 2 : 1;
          for (var dz = -radius; dz <= radius; dz++) {
            for (var dx = -radius; dx <= radius; dx++) {
              // Trim the corners of the widest layers for a rounder look.
              if (radius === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) {
                continue;
              }
              var nx = lx + dx;
              var nz = lz + dz;
              if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) {
                continue;
              }
              var idx = localIndex(nx, cy, nz);
              // Don't overwrite the trunk.
              if (b[idx] !== WOOD) b[idx] = LEAVES;
            }
          }
        }
        // Single leaf cap on top of the trunk.
        var capY = h + trunkH + 1;
        if (capY < WORLD_HEIGHT) b[localIndex(lx, capY, lz)] = LEAVES;
      }
    }
  };

  // ---- Meshing ----

  World.prototype._isTransparent = function (id) {
    return !!this._transparent[id];
  };

  // Color (0xRRGGBB) for a block id, or null if unknown/air.
  World.prototype._blockColor = function (id) {
    if (id === AIR) return null;
    var def = getBlockById(id);
    if (!def) return null;
    return def.color;
  };

  /**
   * Decide whether a face of `id` adjacent to neighbor `neighborId` is visible.
   * - Opaque block: face hidden only if neighbor is opaque (any solid opaque).
   * - Transparent block: face hidden only if neighbor is the SAME block id
   *   (so water-to-water / glass-to-glass interiors are culled, but a glass
   *   face against air or against a different transparent type is drawn).
   * Opaque blocks always draw faces against transparent neighbors.
   */
  World.prototype._faceVisible = function (id, neighborId) {
    if (neighborId === AIR) return true;
    var neighborTransparent = this._isTransparent(neighborId);
    if (this._isTransparent(id)) {
      // Transparent self: cull only against identical neighbor.
      return neighborId !== id;
    }
    // Opaque self: hidden behind opaque neighbor; visible behind transparent.
    return neighborTransparent;
  };

  /**
   * _vertexAO — classic voxel ambient occlusion for one face corner.
   * Samples the two edge-adjacent voxels (side1/side2) and the diagonal corner
   * voxel in the layer just OUTSIDE the face. Returns occlusion level 0..3
   * (0 = open, 3 = fully tucked into a crevice). Only opaque solids occlude.
   */
  World.prototype._vertexAO = function (wx, wy, wz, face, corner) {
    var dir = face.dir;
    var ta = face.tangents[0];
    var tb = face.tangents[1];
    // Sign of each tangent axis for THIS corner (corner coords are 0 or 1).
    var sa = corner[ta] === 1 ? 1 : -1;
    var sb = corner[tb] === 1 ? 1 : -1;

    var off1 = [dir[0], dir[1], dir[2]];
    var off2 = [dir[0], dir[1], dir[2]];
    var offC = [dir[0], dir[1], dir[2]];
    off1[ta] += sa;
    off2[tb] += sb;
    offC[ta] += sa; offC[tb] += sb;

    var side1 = this._occludes(wx + off1[0], wy + off1[1], wz + off1[2]);
    var side2 = this._occludes(wx + off2[0], wy + off2[1], wz + off2[2]);
    var cornr = this._occludes(wx + offC[0], wy + offC[1], wz + offC[2]);

    // If both sides occlude, the corner is fully closed regardless of diagonal.
    if (side1 && side2) return 3;
    return (side1 ? 1 : 0) + (side2 ? 1 : 0) + (cornr ? 1 : 0);
  };

  // A voxel occludes AO only if it is a present, opaque (non-transparent) block.
  World.prototype._occludes = function (x, y, z) {
    var id = this.getBlock(x, y, z);
    if (id === AIR) return false;
    return !this._isTransparent(id);
  };

  /**
   * _buildChunkMesh — (re)build the opaque, glass, and water meshes for a chunk,
   * disposing any previously created geometry, and (re)attach to the scene.
   * Water is its own mesh so world.update(dt) can shimmer it.
   */
  World.prototype._buildChunkMesh = function (chunk) {
    var baseX = chunk.cx * CHUNK_SIZE;
    var baseZ = chunk.cz * CHUNK_SIZE;
    var WATER = BLOCKS.WATER ? BLOCKS.WATER.id : -1;

    // Accumulators (also carry uv + per-tile uv range via _emitFace).
    var opaque = { pos: [], col: [], norm: [], uv: [], idx: [], count: 0 };
    var glass  = { pos: [], col: [], norm: [], uv: [], idx: [], count: 0 };
    var water  = { pos: [], col: [], norm: [], uv: [], idx: [], count: 0 };

    var atlas = this._buildAtlas();
    var b = chunk.blocks;

    for (var ly = 0; ly < WORLD_HEIGHT; ly++) {
      for (var lz = 0; lz < CHUNK_SIZE; lz++) {
        for (var lx = 0; lx < CHUNK_SIZE; lx++) {
          var id = b[localIndex(lx, ly, lz)];
          if (id === AIR) continue;

          var color = this._blockColor(id);
          if (color === null) continue;

          var target;
          if (id === WATER) target = water;
          else if (this._isTransparent(id)) target = glass;
          else target = opaque;

          // World coords of this block's min corner.
          var wx = baseX + lx;
          var wy = ly;
          var wz = baseZ + lz;

          var uvRange = this._atlasUV[id] || [0, 1];

          for (var f = 0; f < FACES.length; f++) {
            var face = FACES[f];
            var nx = wx + face.dir[0];
            var ny = wy + face.dir[1];
            var nz = wz + face.dir[2];
            var neighborId = this.getBlock(nx, ny, nz);

            if (!this._faceVisible(id, neighborId)) continue;

            this._emitFace(target, face, wx, wy, wz, uvRange);
          }
        }
      }
    }

    // Build/attach meshes. Opaque + glass use the shared atlas materials; water
    // gets its own animatable material (tracked in _waterMeshes).
    chunk.opaqueMesh = this._commitGeometry(
      chunk.opaqueMesh, opaque, 'opaque', atlas
    );
    chunk.glassMesh = this._commitGeometry(
      chunk.glassMesh, glass, 'glass', atlas
    );
    // Untrack any previous water mesh before rebuilding.
    if (chunk.waterMesh) this._untrackWater(chunk.waterMesh);
    chunk.waterMesh = this._commitGeometry(
      chunk.waterMesh, water, 'water', atlas
    );
    if (chunk.waterMesh) this._trackWater(chunk.waterMesh);
  };

  // Push one quad (two triangles) into the accumulator. The vertex color is a
  // GRAYSCALE lighting term (top/side/bottom face shading * per-vertex AO); the
  // block's actual color comes from the atlas `map`, so map*vertexColor gives
  // the shaded, AO-darkened result without double-darkening the base color.
  World.prototype._emitFace = function (acc, face, wx, wy, wz, uvRange) {
    var shade = face.shade;
    var base = acc.count;
    var u0 = uvRange[0], u1 = uvRange[1];

    for (var c = 0; c < 4; c++) {
      var corner = face.corners[c];
      acc.pos.push(wx + corner[0], wy + corner[1], wz + corner[2]);
      acc.norm.push(face.dir[0], face.dir[1], face.dir[2]);

      // Ambient occlusion for this corner -> brightness multiplier.
      var ao = AO_LEVELS[this._vertexAO(wx, wy, wz, face, corner)];
      var m = shade * ao;
      acc.col.push(m, m, m);

      // Atlas UV: map the quad's local [0..1] into the block's tile range in U,
      // full 0..1 in V (atlas is a single horizontal strip).
      var quv = FACE_UVS[c];
      acc.uv.push(u0 + (u1 - u0) * quv[0], quv[1]);
    }
    // Two triangles: (0,1,2) and (0,2,3).
    acc.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    acc.count += 4;
  };

  /**
   * _sharedMaterial — one cached material per `kind` ('opaque' | 'glass'),
   * sharing the atlas color map + emissive map so neon parts bloom. vertexColors
   * stays true (AO + face shading) and combines with the map. Cached so meshes
   * across all chunks reuse one material and disposal never frees shared assets.
   */
  World.prototype._sharedMaterial = function (kind, atlas) {
    if (this._matCache[kind]) return this._matCache[kind];
    var mat;
    if (kind === 'glass') {
      mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        map: atlas.map,
        emissive: 0xffffff,           // emissiveMap modulates this white base
        emissiveMap: atlas.emissiveMap,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        depthWrite: false
      });
    } else { // opaque
      mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        map: atlas.map,
        emissive: 0xffffff,
        emissiveMap: atlas.emissiveMap,
        emissiveIntensity: 0.9
      });
    }
    this._matCache[kind] = mat;
    return mat;
  };

  // Water gets its OWN material (one per World) so it can be animated/pulsed
  // independently of the static opaque/glass atlas materials.
  World.prototype._waterMaterial = function (atlas) {
    if (this._matCache.water) return this._matCache.water;
    var mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: atlas.map,
      emissive: 0x18f0ff,            // electric-cyan glow
      emissiveMap: atlas.emissiveMap,
      emissiveIntensity: 0.8,
      transparent: true,
      opacity: 0.6,                  // ~0.6 per spec
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this._matCache.water = mat;
    return mat;
  };

  /**
   * _commitGeometry — turn an accumulator into a Mesh, replacing an existing
   * one. Disposes the previous GEOMETRY only (materials + atlas textures are
   * shared and cached on the World, never disposed per-chunk). Returns the new
   * mesh, or null if empty (old mesh removed + geometry disposed, not replaced).
   *
   * @param {string} kind 'opaque' | 'glass' | 'water'
   */
  World.prototype._commitGeometry = function (existingMesh, acc, kind, atlas) {
    // Remove + dispose any existing mesh's GEOMETRY first (material is shared).
    if (existingMesh) {
      this.scene.remove(existingMesh);
      if (existingMesh.geometry) existingMesh.geometry.dispose();
    }

    if (acc.count === 0) {
      return null; // nothing to render
    }

    var geom = new THREE.BufferGeometry();
    geom.setAttribute(
      'position', new THREE.BufferAttribute(new Float32Array(acc.pos), 3)
    );
    geom.setAttribute(
      'normal', new THREE.BufferAttribute(new Float32Array(acc.norm), 3)
    );
    geom.setAttribute(
      'color', new THREE.BufferAttribute(new Float32Array(acc.col), 3)
    );
    geom.setAttribute(
      'uv', new THREE.BufferAttribute(new Float32Array(acc.uv), 2)
    );
    geom.setIndex(acc.idx);
    geom.computeBoundingSphere();

    var material;
    if (kind === 'water') material = this._waterMaterial(atlas);
    else material = this._sharedMaterial(kind, atlas);

    var mesh = new THREE.Mesh(geom, material);
    mesh.frustumCulled = true;

    if (kind === 'water') {
      // Stash a copy of base Y positions so the shimmer can offset them.
      var pos = geom.attributes.position.array;
      mesh.userData.baseY = new Float32Array(pos.length / 3);
      for (var i = 0, j = 1; i < mesh.userData.baseY.length; i++, j += 3) {
        mesh.userData.baseY[i] = pos[j];
      }
    }

    this.scene.add(mesh);
    return mesh;
  };

  // ---- Animated water ----

  World.prototype._trackWater = function (mesh) {
    if (mesh && this._waterMeshes.indexOf(mesh) === -1) {
      this._waterMeshes.push(mesh);
    }
  };

  World.prototype._untrackWater = function (mesh) {
    var i = this._waterMeshes.indexOf(mesh);
    if (i !== -1) this._waterMeshes.splice(i, 1);
  };

  /**
   * update — per-frame world tick. Shimmers the animated neon water: gently
   * bobs the surface vertices on a traveling sine wave and pulses the water
   * material's emissive intensity + opacity so it shimmers like Tron liquid.
   * Safe to call with no/zero dt.
   * @param {number} dt seconds since last frame
   */
  World.prototype.update = function (dt) {
    if (typeof dt !== 'number' || !isFinite(dt)) dt = 0;
    this._time += dt;
    var t = this._time;

    // Pulse the shared water material's glow + opacity.
    var wmat = this._matCache.water;
    if (wmat) {
      wmat.emissiveIntensity = 0.7 + 0.35 * Math.sin(t * 2.0);
      wmat.opacity = 0.55 + 0.1 * Math.sin(t * 1.3 + 1.0);
    }

    // Bob the water surface vertices on a traveling wave.
    var meshes = this._waterMeshes;
    for (var m = 0; m < meshes.length; m++) {
      var mesh = meshes[m];
      if (!mesh || !mesh.geometry) continue;
      var attr = mesh.geometry.attributes.position;
      var pos = attr.array;
      var baseY = mesh.userData.baseY;
      if (!baseY) continue;
      for (var i = 0, j = 0; i < baseY.length; i++, j += 3) {
        var x = pos[j];
        var z = pos[j + 2];
        pos[j + 1] = baseY[i] +
          Math.sin(x * 0.6 + t * 1.7) * 0.05 +
          Math.cos(z * 0.5 + t * 1.3) * 0.05;
      }
      attr.needsUpdate = true;
    }
  };

  // animateWater — alias for update(dt) (spec allows either name).
  World.prototype.animateWater = function (dt) {
    this.update(dt);
  };

  // Expose globally (classic script, no modules).
  window.World = World;
})();

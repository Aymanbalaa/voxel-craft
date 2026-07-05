// Procedural texture atlas. BROWSER ONLY — uses document.createElement('canvas').
// Builds one 256x256 canvas (16x16 grid of 16px tiles) with original, Minecraft-*like*
// pixel art, plus 32x32 inventory icon rendering. No external assets, no network.
//
// Determinism: a tiny mulberry32 PRNG seeds all speckle/dither noise so the atlas
// is byte-identical on every load (stable lighting/UV across runs).

const TILE = 16;
const COLS = 16;
const ATLAS_PX = TILE * COLS; // 256

// ---- Seeded PRNG (mulberry32) ---------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(0xC0FFEE); // reseeded per-tile draw for stability regardless of draw order

// ---- TILES registry: name -> index (col + row*16) -------------------------
export const TILES = {};
let nextIndex = 0;
function allot(name) {
  const idx = nextIndex++;
  TILES[name] = idx;
  return idx;
}

// ---- Canvas + pixel helpers -------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Returns a 2D ctx for a tile at `index`, translated so (0,0) is the tile's
// top-left corner and drawing is clipped to the 16x16 cell.
function tileCtx(atlasCtx, index) {
  const col = index % COLS, row = (index / COLS) | 0;
  atlasCtx.save();
  atlasCtx.translate(col * TILE, row * TILE);
  return atlasCtx;
}

// Set one pixel (integer coords 0..15) with an "r,g,b,a" style call.
function px(ctx, x, y, r, g, b, a = 255) {
  ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
  ctx.fillRect(x, y, 1, 1);
}

// Fill the whole 16x16 tile with a flat color.
function fillTile(ctx, r, g, b, a = 255) {
  ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
  ctx.fillRect(0, 0, TILE, TILE);
}

// Clear tile to fully transparent (for cross-plants / torch / glass center).
function clearTile(ctx) { ctx.clearRect(0, 0, TILE, TILE); }

// Deterministic per-pixel speckle: base color + random variance per channel.
function speckleTile(ctx, base, variance, alpha = 255) {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const dr = (rng() - 0.5) * 2 * variance[0];
      const dg = (rng() - 0.5) * 2 * variance[1];
      const db = (rng() - 0.5) * 2 * variance[2];
      const r = clamp8(base[0] + dr), g = clamp8(base[1] + dg), b = clamp8(base[2] + db);
      px(ctx, x, y, r, g, b, alpha);
    }
  }
}
function clamp8(v) { return Math.max(0, Math.min(255, v | 0)); }

// Scatter n colored specks onto whatever's already drawn (ores/dirt clumps/etc).
function scatterSpecks(ctx, n, color, sizeMin = 1, sizeMax = 1) {
  for (let i = 0; i < n; i++) {
    const x = (rng() * TILE) | 0, y = (rng() * TILE) | 0;
    const s = sizeMin + ((rng() * (sizeMax - sizeMin + 1)) | 0);
    const jitter = 18;
    const r = clamp8(color[0] + (rng() - 0.5) * jitter);
    const g = clamp8(color[1] + (rng() - 0.5) * jitter);
    const b = clamp8(color[2] + (rng() - 0.5) * jitter);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, Math.min(s, TILE - x), Math.min(s, TILE - y));
  }
}

// ============================================================================
// Individual tile painters. Each receives a ready `ctx` (translated+clipped).
// ============================================================================

function drawStone(ctx) { speckleTile(ctx, [128, 128, 130], [10, 10, 10]); scatterSpecks(ctx, 6, [100, 100, 102], 1, 2); }
function drawCobblestone(ctx) {
  fillTile(ctx, 120, 120, 122);
  // Blocky mortar seams: draw a few dark irregular lines + light grey cobbles.
  for (let i = 0; i < 10; i++) {
    const x = (rng() * TILE) | 0, y = (rng() * TILE) | 0, w = 2 + ((rng() * 3) | 0), h = 2 + ((rng() * 3) | 0);
    const shade = 95 + ((rng() * 40) | 0);
    ctx.fillStyle = `rgb(${shade},${shade},${shade + 2})`;
    ctx.fillRect(x, y, w, h);
  }
  scatterSpecks(ctx, 8, [70, 70, 72], 1, 1);
}
function drawMossyCobble(ctx) {
  drawCobblestone(ctx);
  scatterSpecks(ctx, 10, [70, 120, 60], 1, 2);
}
function drawStoneBricks(ctx) {
  fillTile(ctx, 138, 138, 140);
  ctx.fillStyle = 'rgb(100,100,102)';
  for (let y = 0; y < TILE; y += 4) ctx.fillRect(0, y, TILE, 1);
  for (let row = 0; row < 4; row++) {
    const offset = (row % 2 === 0) ? 0 : 4;
    for (let x = offset; x < TILE; x += 8) ctx.fillRect(x, row * 4, 1, 4);
  }
  scatterSpecks(ctx, 4, [120, 120, 122], 1, 1);
}
function drawDirt(ctx) { speckleTile(ctx, [134, 96, 67], [14, 12, 10]); scatterSpecks(ctx, 5, [100, 70, 48], 1, 2); }
function drawGrassTop(ctx) { speckleTile(ctx, [95, 165, 70], [16, 18, 14]); scatterSpecks(ctx, 6, [70, 140, 55], 1, 1); }
function drawGrassSide(ctx) {
  drawDirt(ctx);
  ctx.fillStyle = 'rgb(95,165,70)';
  ctx.fillRect(0, 0, TILE, 4);
  scatterSpecksRegion(ctx, 6, [70, 140, 55], 0, 0, TILE, 4);
  // ragged bottom edge of grass strip
  for (let x = 0; x < TILE; x++) { if (rng() < 0.4) px(ctx, x, 4, 95, 165, 70, 255); }
}
function drawGrassSnowSide(ctx) {
  drawDirt(ctx);
  ctx.fillStyle = 'rgb(235,240,245)';
  ctx.fillRect(0, 0, TILE, 4);
  for (let x = 0; x < TILE; x++) { if (rng() < 0.4) px(ctx, x, 4, 235, 240, 245, 255); }
}
function scatterSpecksRegion(ctx, n, color, rx, ry, rw, rh) {
  for (let i = 0; i < n; i++) {
    const x = rx + ((rng() * rw) | 0), y = ry + ((rng() * rh) | 0);
    const jitter = 16;
    const r = clamp8(color[0] + (rng() - 0.5) * jitter);
    const g = clamp8(color[1] + (rng() - 0.5) * jitter);
    const b = clamp8(color[2] + (rng() - 0.5) * jitter);
    px(ctx, x, y, r, g, b, 255);
  }
}
function drawPlanks(ctx, base, grain) {
  fillTile(ctx, base[0], base[1], base[2]);
  // horizontal plank seams
  ctx.fillStyle = `rgb(${grain[0]},${grain[1]},${grain[2]})`;
  ctx.fillRect(0, 5, TILE, 1);
  ctx.fillRect(0, 11, TILE, 1);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (rng() < 0.12) px(ctx, x, y, grain[0], grain[1], grain[2], 160);
    }
  }
}
function drawBedrock(ctx) { speckleTile(ctx, [80, 80, 84], [22, 22, 22]); scatterSpecks(ctx, 10, [50, 50, 54], 1, 2); }
function drawSand(ctx) { speckleTile(ctx, [214, 200, 154], [10, 10, 8]); scatterSpecks(ctx, 4, [190, 175, 130], 1, 1); }
function drawGravel(ctx) { speckleTile(ctx, [130, 126, 122], [24, 24, 24]); scatterSpecks(ctx, 8, [90, 88, 86], 1, 2); }
function drawWater(ctx) { speckleTile(ctx, [60, 110, 220], [12, 12, 16], 190); scatterSpecks(ctx, 4, [120, 170, 240], 1, 2); }
function drawLava(ctx) {
  speckleTile(ctx, [230, 100, 20], [20, 20, 10]);
  scatterSpecks(ctx, 6, [120, 30, 10], 1, 2);
  scatterSpecks(ctx, 4, [255, 220, 80], 1, 1);
}
function drawLogSide(ctx, bark, streak) {
  fillTile(ctx, bark[0], bark[1], bark[2]);
  ctx.fillStyle = `rgb(${streak[0]},${streak[1]},${streak[2]})`;
  for (let x = 0; x < TILE; x++) {
    if (x % 3 === 0) ctx.fillRect(x, 0, 1, TILE);
  }
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (rng() < 0.08) px(ctx, x, y, streak[0], streak[1], streak[2], 130);
    }
  }
}
function drawLogTop(ctx, wood, ring) {
  fillTile(ctx, wood[0], wood[1], wood[2]);
  const cx = 7.5, cy = 7.5;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const ringPhase = Math.sin(d * 1.6);
      if (ringPhase > 0.55) px(ctx, x, y, ring[0], ring[1], ring[2], 200);
    }
  }
}
function drawLeaves(ctx, base) {
  speckleTile(ctx, base, [14, 14, 10], 255);
  // punch a few transparent holes for depth
  for (let i = 0; i < 10; i++) {
    const x = (rng() * TILE) | 0, y = (rng() * TILE) | 0;
    ctx.clearRect(x, y, 1, 1);
  }
}
function drawGlass(ctx) {
  clearTile(ctx);
  ctx.fillStyle = 'rgba(210,235,240,0.55)';
  ctx.fillRect(0, 0, TILE, TILE);
  ctx.clearRect(2, 2, TILE - 4, TILE - 4);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(0, 0, TILE, 1);
  ctx.fillRect(0, 0, 1, TILE);
}
function drawOre(ctx, mineral) {
  drawStone(ctx);
  scatterSpecks(ctx, 5, mineral, 1, 2);
}
function drawSnow(ctx) { speckleTile(ctx, [240, 245, 250], [6, 6, 6]); }
function drawIce(ctx) { speckleTile(ctx, [180, 215, 235], [10, 10, 8], 210); scatterSpecks(ctx, 3, [220, 240, 250], 1, 2); }
function drawSandstone(ctx, banded) {
  speckleTile(ctx, [220, 205, 160], [8, 8, 6]);
  if (banded) {
    ctx.fillStyle = 'rgba(190,175,130,0.6)';
    ctx.fillRect(0, 7, TILE, 1);
    ctx.fillRect(0, 13, TILE, 1);
  }
}
function drawCactus(ctx, isTop) {
  speckleTile(ctx, [70, 140, 70], [10, 12, 8]);
  ctx.fillStyle = 'rgba(50,110,55,0.8)';
  for (let y = 0; y < TILE; y += 4) ctx.fillRect(3, y, 1, 2);
  if (isTop) { ctx.fillStyle = 'rgb(90,160,90)'; ctx.fillRect(4, 4, 8, 8); }
}
function drawCrossPlant(ctx, painter) { clearTile(ctx); painter(ctx); }
function drawTallGrass(ctx) {
  ctx.fillStyle = 'rgb(80,150,60)';
  const blades = [[2,15,2,6],[5,15,5,3],[8,15,8,5],[11,15,11,4],[13,15,13,7]];
  for (const [x0,y0,x1,y1] of blades) ctx.fillRect(x1, y1, 1, y0 - y1 + 1);
  ctx.fillStyle = 'rgb(60,120,45)';
  ctx.fillRect(7, 9, 1, 6);
}
function drawDeadBush(ctx) {
  ctx.fillStyle = 'rgb(120,90,55)';
  const twigs = [[7,14],[6,12],[8,12],[5,10],[9,10],[7,9],[6,7],[9,7],[7,6]];
  for (const [x,y] of twigs) ctx.fillRect(x, y, 1, 1);
}
function drawFlower(ctx, petalColor) {
  ctx.fillStyle = 'rgb(70,140,55)';
  ctx.fillRect(7, 9, 1, 6);
  ctx.fillStyle = `rgb(${petalColor[0]},${petalColor[1]},${petalColor[2]})`;
  ctx.fillRect(6, 5, 3, 3);
  ctx.fillRect(5, 6, 1, 1);
  ctx.fillRect(9, 6, 1, 1);
  ctx.fillStyle = 'rgb(230,200,40)';
  ctx.fillRect(7, 6, 1, 1);
}
function drawMushroom(ctx, capColor) {
  ctx.fillStyle = 'rgb(225,225,215)';
  ctx.fillRect(7, 10, 1, 4);
  ctx.fillStyle = `rgb(${capColor[0]},${capColor[1]},${capColor[2]})`;
  ctx.fillRect(5, 7, 5, 3);
  ctx.fillRect(6, 6, 3, 1);
  if (capColor[0] > 180) { ctx.fillStyle = 'rgb(255,255,255)'; ctx.fillRect(5, 7, 1, 1); ctx.fillRect(8, 8, 1, 1); }
}
function drawTorch(ctx) {
  clearTile(ctx);
  ctx.fillStyle = 'rgb(110,80,50)';
  ctx.fillRect(7, 8, 2, 7);
  ctx.fillStyle = 'rgb(255,220,90)';
  ctx.fillRect(6, 5, 4, 3);
  ctx.fillStyle = 'rgb(255,255,220)';
  ctx.fillRect(7, 5, 2, 2);
}
function drawCraftingTop(ctx) {
  drawPlanks(ctx, [150, 108, 66], [110, 76, 44]);
  ctx.strokeStyle = 'rgba(60,40,25,0.7)';
  ctx.strokeRect(1.5, 1.5, 13, 13);
  ctx.fillStyle = 'rgba(90,60,35,0.6)';
  ctx.fillRect(2, 7, 12, 1);
}
function drawCraftingSide(ctx) {
  drawPlanks(ctx, [150, 108, 66], [110, 76, 44]);
  ctx.fillStyle = 'rgb(90,60,35)';
  ctx.fillRect(2, 3, 2, 2); ctx.fillRect(12, 3, 2, 2);
  ctx.fillRect(2, 11, 2, 2); ctx.fillRect(12, 11, 2, 2);
}
function drawFurnaceTop(ctx) { speckleTile(ctx, [110, 110, 112], [10, 10, 10]); }
function drawFurnaceSide(ctx) {
  speckleTile(ctx, [100, 100, 102], [8, 8, 8]);
  ctx.fillStyle = 'rgb(70,70,72)';
  ctx.fillRect(1, 1, 14, 2);
}
function drawFurnaceFront(ctx, lit) {
  speckleTile(ctx, [100, 100, 102], [8, 8, 8]);
  ctx.fillStyle = 'rgb(40,40,42)';
  ctx.fillRect(4, 8, 8, 6);
  ctx.fillStyle = lit ? 'rgb(255,160,40)' : 'rgb(30,30,30)';
  ctx.fillRect(5, 9, 6, 4);
}
function drawObsidian(ctx) { speckleTile(ctx, [35, 20, 55], [10, 8, 14]); scatterSpecks(ctx, 4, [70, 50, 100], 1, 1); }
function drawGlowstone(ctx) { speckleTile(ctx, [240, 200, 120], [16, 16, 12]); scatterSpecks(ctx, 6, [255, 240, 180], 1, 2); }
function drawBricks(ctx) {
  fillTile(ctx, 150, 70, 55);
  ctx.fillStyle = 'rgb(190,190,185)';
  for (let y = 0; y < TILE; y += 4) ctx.fillRect(0, y, TILE, 1);
  for (let row = 0; row < 4; row++) {
    const offset = (row % 2 === 0) ? 0 : 4;
    for (let x = offset; x < TILE; x += 8) ctx.fillRect(x, row * 4, 1, 4);
  }
  scatterSpecks(ctx, 4, [130, 55, 42], 1, 1);
}
function drawBookshelf(ctx) {
  drawPlanks(ctx, [150, 108, 66], [110, 76, 44]);
  const spineColors = [[150,40,40],[40,90,140],[60,120,60],[140,120,40]];
  let x = 1;
  let i = 0;
  while (x < TILE - 1) {
    const w = 2 + ((rng() * 2) | 0);
    const c = spineColors[i++ % spineColors.length];
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(x, 2, w, 11);
    x += w;
  }
}
function drawWool(ctx) { speckleTile(ctx, [225, 225, 225], [8, 8, 8]); }
function drawClay(ctx) { speckleTile(ctx, [160, 165, 175], [8, 8, 10]); }
function drawDirtPathTop(ctx) { speckleTile(ctx, [150, 120, 85], [10, 10, 8]); }
function drawDirtPathSide(ctx) {
  drawDirt(ctx);
  ctx.fillStyle = 'rgb(150,120,85)';
  ctx.fillRect(0, 0, TILE, 3);
}
function drawPumpkinTop(ctx) {
  speckleTile(ctx, [200, 120, 30], [10, 10, 8]);
  ctx.fillStyle = 'rgb(90,140,60)';
  ctx.fillRect(6, 6, 4, 4);
}
function drawPumpkinSide(ctx) {
  speckleTile(ctx, [210, 125, 30], [8, 8, 6]);
  ctx.fillStyle = 'rgba(170,100,20,0.7)';
  for (let x = 2; x < TILE; x += 4) ctx.fillRect(x, 0, 1, TILE);
}
function drawPumpkinFace(ctx) {
  drawPumpkinSide(ctx);
  ctx.fillStyle = 'rgb(40,30,15)';
  ctx.fillRect(3, 5, 2, 2); ctx.fillRect(10, 5, 2, 2);
  ctx.fillRect(4, 10, 7, 2);
  ctx.fillRect(3, 9, 1, 1); ctx.fillRect(11, 9, 1, 1);
}
function drawMelonTop(ctx) { speckleTile(ctx, [90, 150, 60], [10, 12, 8]); }
function drawMelonSide(ctx) {
  speckleTile(ctx, [110, 165, 60], [8, 8, 6]);
  ctx.fillStyle = 'rgba(70,120,45,0.7)';
  for (let x = 2; x < TILE; x += 4) ctx.fillRect(x, 0, 1, TILE);
}

// ============================================================================
// Flat item icon tiles (simple 16x16 pictograms on transparent background)
// ============================================================================
function drawMaterial(ctx, color, shape) {
  clearTile(ctx);
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  shape(ctx);
}
function stickShape(ctx) { ctx.fillRect(6, 2, 2, 12); ctx.fillStyle = 'rgb(90,60,35)'; ctx.fillRect(6, 2, 2, 12); }
function lumpShape(ctx) { ctx.fillRect(4, 6, 8, 6); ctx.fillRect(5, 5, 6, 1); ctx.fillRect(5, 12, 6, 1); }
function ingotShape(ctx) { ctx.fillRect(4, 6, 8, 4); ctx.fillRect(5, 5, 6, 1); ctx.fillRect(5, 10, 6, 1); }
function gemShape(ctx) { ctx.fillRect(6, 4, 4, 4); ctx.fillRect(5, 6, 6, 4); ctx.fillRect(7, 10, 2, 2); }
function roundFoodShape(ctx) { ctx.fillRect(5, 5, 6, 6); ctx.fillRect(6, 4, 4, 1); ctx.fillRect(6, 11, 4, 1); }
function slabShape(ctx) { ctx.fillRect(4, 6, 8, 4); }
function stringShape(ctx) { for (let y = 2; y < 14; y++) ctx.fillRect(7 + ((y % 2)), y, 1, 1); }
function bowlShape(ctx) { ctx.fillRect(4, 8, 8, 3); ctx.fillRect(5, 11, 6, 1); }
function ballShape(ctx) { ctx.fillRect(5, 5, 6, 6); }
function boneShape(ctx) { ctx.fillRect(3, 7, 10, 2); ctx.fillRect(2, 6, 2, 1); ctx.fillRect(2, 9, 2, 1); ctx.fillRect(12, 6, 2, 1); ctx.fillRect(12, 9, 2, 1); }
function bookShape(ctx) { ctx.fillRect(4, 3, 8, 10); ctx.fillStyle = 'rgb(230,220,190)'; ctx.fillRect(5, 4, 6, 8); }
function shearsShape(ctx) {
  ctx.fillRect(4, 3, 2, 6); ctx.fillRect(10, 3, 2, 6);
  ctx.fillRect(5, 9, 1, 1); ctx.fillRect(10, 9, 1, 1);
  ctx.fillRect(7, 10, 2, 4);
}

// Tool icon: diagonal handle + material-colored head whose shape depends on type.
function drawTool(ctx, type, matColor) {
  clearTile(ctx);
  // handle: brown diagonal stick from bottom-left to mid-center
  ctx.fillStyle = 'rgb(120,85,50)';
  const handle = [[3,13],[4,12],[5,11],[6,10],[7,9]];
  for (const [x, y] of handle) ctx.fillRect(x, y, 2, 2);
  ctx.fillStyle = `rgb(${matColor[0]},${matColor[1]},${matColor[2]})`;
  if (type === 'pickaxe') {
    ctx.fillRect(6, 2, 7, 2);
    ctx.fillRect(5, 3, 2, 2);
    ctx.fillRect(12, 3, 2, 2);
    ctx.fillRect(7, 4, 2, 2);
  } else if (type === 'axe') {
    ctx.fillRect(7, 2, 6, 3);
    ctx.fillRect(6, 5, 5, 3);
    ctx.fillRect(9, 8, 2, 2);
  } else if (type === 'shovel') {
    ctx.fillRect(7, 2, 4, 5);
    ctx.fillRect(6, 3, 1, 3);
    ctx.fillRect(11, 3, 1, 3);
  } else if (type === 'sword') {
    ctx.fillRect(8, 1, 2, 9);
    ctx.fillRect(6, 9, 6, 2);
    ctx.fillStyle = 'rgb(90,60,35)';
    ctx.fillRect(8, 11, 2, 3);
  } else if (type === 'hoe') {
    ctx.fillRect(6, 2, 6, 2);
    ctx.fillRect(6, 4, 2, 2);
  }
}

// ============================================================================
// Build spec table: name -> painter(ctx). Order defines tile index assignment.
// ============================================================================
function paintAll(ctx) {
  const def = (name, painter) => {
    const idx = allot(name);
    const c = tileCtx(ctx, idx);
    rng = mulberry32(0xC0FFEE + idx * 101); // per-tile deterministic reseed
    painter(c);
    c.restore();
  };

  // --- Terrain blocks ---
  def('stone', drawStone);
  def('grass_top', drawGrassTop);
  def('grass_side', drawGrassSide);
  def('grass_snow_side', drawGrassSnowSide);
  def('dirt', drawDirt);
  def('cobblestone', drawCobblestone);
  def('oak_planks', (c) => drawPlanks(c, [178, 140, 90], [130, 98, 58]));
  def('birch_planks', (c) => drawPlanks(c, [222, 208, 170], [190, 172, 130]));
  def('spruce_planks', (c) => drawPlanks(c, [130, 92, 55], [95, 65, 36]));
  def('bedrock', drawBedrock);
  def('sand', drawSand);
  def('gravel', drawGravel);
  def('water', drawWater);
  def('lava', drawLava);
  def('oak_log', (c) => drawLogSide(c, [120, 92, 60], [80, 58, 36]));
  def('oak_log_top', (c) => drawLogTop(c, [190, 155, 105], [140, 105, 65]));
  def('birch_log', (c) => drawLogSide(c, [225, 220, 205], [70, 65, 55]));
  def('birch_log_top', (c) => drawLogTop(c, [220, 205, 165], [180, 160, 120]));
  def('spruce_log', (c) => drawLogSide(c, [95, 68, 45], [60, 40, 25]));
  def('spruce_log_top', (c) => drawLogTop(c, [160, 125, 85], [110, 80, 50]));
  def('oak_leaves', (c) => drawLeaves(c, [60, 120, 45]));
  def('birch_leaves', (c) => drawLeaves(c, [95, 150, 55]));
  def('spruce_leaves', (c) => drawLeaves(c, [40, 90, 55]));
  def('glass', drawGlass);
  def('coal_ore', (c) => drawOre(c, [25, 25, 28]));
  def('iron_ore', (c) => drawOre(c, [200, 150, 100]));
  def('gold_ore', (c) => drawOre(c, [235, 200, 60]));
  def('diamond_ore', (c) => drawOre(c, [80, 220, 220]));
  def('redstone_ore', (c) => drawOre(c, [210, 30, 30]));
  def('snow', drawSnow);
  def('ice', drawIce);
  def('sandstone', (c) => drawSandstone(c, true));
  def('sandstone_top', (c) => drawSandstone(c, false));
  def('sandstone_bottom', (c) => drawSandstone(c, false));
  def('cactus_top', (c) => drawCactus(c, true));
  def('cactus_bottom', (c) => drawCactus(c, false));
  def('cactus_side', (c) => drawCactus(c, false));
  def('tall_grass', (c) => drawCrossPlant(c, drawTallGrass));
  def('dead_bush', (c) => drawCrossPlant(c, drawDeadBush));
  def('dandelion', (c) => drawCrossPlant(c, (cc) => drawFlower(cc, [235, 200, 40])));
  def('poppy', (c) => drawCrossPlant(c, (cc) => drawFlower(cc, [210, 40, 40])));
  def('mushroom_brown', (c) => drawCrossPlant(c, (cc) => drawMushroom(cc, [150, 100, 70])));
  def('mushroom_red', (c) => drawCrossPlant(c, (cc) => drawMushroom(cc, [200, 40, 40])));
  def('torch', drawTorch);
  def('crafting_table_top', drawCraftingTop);
  def('crafting_table_side', drawCraftingSide);
  def('furnace_top', drawFurnaceTop);
  def('furnace_side', drawFurnaceSide);
  def('furnace_front', (c) => drawFurnaceFront(c, false));
  def('stone_bricks', drawStoneBricks);
  def('mossy_cobblestone', drawMossyCobble);
  def('obsidian', drawObsidian);
  def('glowstone', drawGlowstone);
  def('bricks', drawBricks);
  def('bookshelf', drawBookshelf);
  def('wool', drawWool);
  def('clay', drawClay);
  def('dirt_path_top', drawDirtPathTop);
  def('dirt_path_side', drawDirtPathSide);
  def('pumpkin_top', drawPumpkinTop);
  def('pumpkin_side', drawPumpkinSide);
  def('pumpkin_face', drawPumpkinFace);
  def('melon_top', drawMelonTop);
  def('melon_side', drawMelonSide);

  // --- Flat item icon tiles (used via makeIcon({flat:name})) ---
  def('stick', (c) => drawMaterial(c, [140, 100, 60], stickShape));
  def('coal', (c) => drawMaterial(c, [30, 30, 32], lumpShape));
  def('charcoal', (c) => drawMaterial(c, [60, 50, 45], lumpShape));
  def('iron_ingot', (c) => drawMaterial(c, [230, 225, 215], ingotShape));
  def('gold_ingot', (c) => drawMaterial(c, [250, 215, 60], ingotShape));
  def('diamond', (c) => drawMaterial(c, [90, 230, 230], gemShape));
  def('apple', (c) => drawMaterial(c, [200, 30, 30], roundFoodShape));
  def('bread', (c) => drawMaterial(c, [195, 150, 80], slabShape));
  def('wheat', (c) => drawMaterial(c, [210, 190, 70], stickShape));
  def('porkchop', (c) => drawMaterial(c, [230, 150, 150], roundFoodShape));
  def('cooked_porkchop', (c) => drawMaterial(c, [165, 105, 70], roundFoodShape));
  def('string', (c) => drawMaterial(c, [235, 235, 225], stringShape));
  def('bowl', (c) => drawMaterial(c, [150, 110, 65], bowlShape));
  def('clay_ball', (c) => drawMaterial(c, [170, 175, 185], ballShape));
  def('brick_item', (c) => drawMaterial(c, [165, 85, 65], ingotShape));
  def('flint', (c) => drawMaterial(c, [70, 70, 75], gemShape));
  def('leather', (c) => drawMaterial(c, [160, 115, 70], slabShape));
  def('bone', (c) => drawMaterial(c, [235, 230, 210], boneShape));
  def('gunpowder', (c) => drawMaterial(c, [90, 90, 95], lumpShape));
  def('paper', (c) => drawMaterial(c, [240, 235, 220], slabShape));
  def('book', (c) => drawMaterial(c, [150, 40, 40], bookShape));
  def('shears', (c) => drawMaterial(c, [210, 210, 215], shearsShape));

  // Explicit (not generated) names below so every tool icon key matches the
  // literal item icon strings used in items.js (`wooden_pickaxe`, etc.).
  const WOOD = [150, 110, 65], STONE_M = [150, 150, 152], IRON = [230, 225, 215],
        GOLD = [250, 215, 60], DIAMOND_M = [90, 230, 230];
  def('wooden_pickaxe', (c) => drawTool(c, 'pickaxe', WOOD));
  def('wooden_axe',     (c) => drawTool(c, 'axe', WOOD));
  def('wooden_shovel',  (c) => drawTool(c, 'shovel', WOOD));
  def('wooden_sword',   (c) => drawTool(c, 'sword', WOOD));
  def('wooden_hoe',     (c) => drawTool(c, 'hoe', WOOD));
  def('stone_pickaxe',  (c) => drawTool(c, 'pickaxe', STONE_M));
  def('stone_axe',      (c) => drawTool(c, 'axe', STONE_M));
  def('stone_shovel',   (c) => drawTool(c, 'shovel', STONE_M));
  def('stone_sword',    (c) => drawTool(c, 'sword', STONE_M));
  def('stone_hoe',      (c) => drawTool(c, 'hoe', STONE_M));
  def('iron_pickaxe',   (c) => drawTool(c, 'pickaxe', IRON));
  def('iron_axe',       (c) => drawTool(c, 'axe', IRON));
  def('iron_shovel',    (c) => drawTool(c, 'shovel', IRON));
  def('iron_sword',     (c) => drawTool(c, 'sword', IRON));
  def('iron_hoe',       (c) => drawTool(c, 'hoe', IRON));
  def('gold_pickaxe',   (c) => drawTool(c, 'pickaxe', GOLD));
  def('gold_axe',       (c) => drawTool(c, 'axe', GOLD));
  def('gold_shovel',    (c) => drawTool(c, 'shovel', GOLD));
  def('gold_sword',     (c) => drawTool(c, 'sword', GOLD));
  def('gold_hoe',       (c) => drawTool(c, 'hoe', GOLD));
  def('diamond_pickaxe',(c) => drawTool(c, 'pickaxe', DIAMOND_M));
  def('diamond_axe',    (c) => drawTool(c, 'axe', DIAMOND_M));
  def('diamond_shovel', (c) => drawTool(c, 'shovel', DIAMOND_M));
  def('diamond_sword',  (c) => drawTool(c, 'sword', DIAMOND_M));
  def('diamond_hoe',    (c) => drawTool(c, 'hoe', DIAMOND_M));

  def('unknown', (c) => {
    clearTile(c);
    c.fillStyle = 'rgb(230,60,230)';
    c.fillRect(0, 0, 8, 8);
    c.fillRect(8, 8, 8, 8);
  });
}

// ---- Public API -------------------------------------------------------------

let cached = null;

export function buildAtlas() {
  if (cached) return cached;
  const canvas = makeCanvas(ATLAS_PX, ATLAS_PX);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  paintAll(ctx);
  cached = { canvas, image: canvas, TILES, tileSize: TILE, cols: COLS };
  return cached;
}

// Resolve a tile name or index to {col,row}.
function resolveTile(t) {
  const idx = typeof t === 'number' ? t : TILES[t];
  return { col: idx % COLS, row: (idx / COLS) | 0, idx };
}

// Draw one 16x16 source tile scaled into a destination rect on `ctx`, using
// the atlas canvas as source, nearest-neighbor (no smoothing).
function blitTile(ctx, atlasCanvas, tile, dx, dy, dw, dh, shade = 1) {
  const { col, row } = resolveTile(tile);
  if (shade === 1) {
    ctx.drawImage(atlasCanvas, col * TILE, row * TILE, TILE, TILE, dx, dy, dw, dh);
  } else {
    // Draw then multiply-darken via an offscreen pass for shading.
    const tmp = makeCanvas(TILE, TILE);
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(atlasCanvas, col * TILE, row * TILE, TILE, TILE, 0, 0, TILE, TILE);
    tctx.globalCompositeOperation = 'multiply';
    const g = clamp8(255 * shade);
    tctx.fillStyle = `rgb(${g},${g},${g})`;
    tctx.fillRect(0, 0, TILE, TILE);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(atlasCanvas, col * TILE, row * TILE, TILE, TILE, 0, 0, TILE, TILE);
    ctx.drawImage(tmp, dx, dy, dw, dh);
  }
}

// makeIcon(spec) -> 32x32 HTMLCanvasElement.
// spec forms:
//   { flat: tileNameOrIndex }                         -> scaled flat sprite (items/plants/tools)
//   { block: top, side }  OR  { top, side, type:'block' } -> pseudo-isometric cube
export function makeIcon(spec) {
  const atlas = buildAtlas();
  const icon = makeCanvas(32, 32);
  const ctx = icon.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  if (spec && spec.flat !== undefined) {
    blitTile(ctx, atlas.canvas, spec.flat, 0, 0, 32, 32);
    return icon;
  }

  const top = spec.top ?? spec.block;
  const side = spec.side ?? top;

  // Pseudo-isometric cube: top rhombus + left/right shaded faces.
  // Layout within 32x32: top diamond spans y 0..16, faces drop to y 32.
  const cx = 16;
  const topH = 9;   // half-height of the top rhombus
  const faceH = 15; // vertical extent of the side faces

  // TOP FACE (rhombus), lightened
  drawIsoTop(ctx, atlas.canvas, top, cx, topH, faceH);
  // LEFT FACE, medium shade
  drawIsoFace(ctx, atlas.canvas, side, cx, topH, faceH, 'left', 0.8);
  // RIGHT FACE, darker shade
  drawIsoFace(ctx, atlas.canvas, side, cx, topH, faceH, 'right', 0.6);

  return icon;
}

// Sample a tile's raw RGBA pixel data (16x16) from the atlas.
function getTilePixels(atlasCanvas, tile) {
  const { col, row } = resolveTile(tile);
  const src = makeCanvas(TILE, TILE);
  const sctx = src.getContext('2d');
  sctx.drawImage(atlasCanvas, col * TILE, row * TILE, TILE, TILE, 0, 0, TILE, TILE);
  return sctx.getImageData(0, 0, TILE, TILE).data;
}

// Draw the top rhombus by sampling the tile as a small grid mapped onto
// diamond-shaped cells (per-pixel sampling for a painterly iso look).
function drawIsoTop(ctx, atlasCanvas, tile, cx, topH, faceH) {
  const data = getTilePixels(atlasCanvas, tile);
  const originY = faceH - topH; // top vertex y-offset within the 32px icon
  const n = TILE;
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const i = (ty * n + tx) * 4;
      const a = data[i + 3];
      if (a === 0) continue;
      // lighten slightly for the top face
      const r = clamp8(data[i] * 1.08 + 10), g = clamp8(data[i + 1] * 1.08 + 10), b = clamp8(data[i + 2] * 1.08 + 10);
      // map (tx,ty) in [0,16) to diamond centered at (cx, originY+topH)
      const u = (tx + 0.5) / n - 0.5, v = (ty + 0.5) / n - 0.5; // -0.5..0.5
      const px_ = cx + (u - v) * 16;
      const py_ = originY + topH + (u + v) * topH;
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(Math.round(px_ - 0.5), Math.round(py_ - 0.5), 2, 2);
    }
  }
}

// Draw a shaded side face as a vertical parallelogram, sampling tile pixels.
function drawIsoFace(ctx, atlasCanvas, tile, cx, topH, faceH, side, shade) {
  const data = getTilePixels(atlasCanvas, tile);
  const n = TILE, originY = faceH - topH, halfW = 16;
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const i = (ty * n + tx) * 4;
      const a = data[i + 3];
      if (a === 0) continue;
      const r = clamp8(data[i] * shade), g = clamp8(data[i + 1] * shade), b = clamp8(data[i + 2] * shade);
      const u = tx / n, v = ty / n; // 0..1 across / down the face
      const slant = (side === 'left' ? (halfW / 2 - u * halfW / 2) : (u * halfW / 2)) * (topH / halfW);
      const px_ = side === 'left' ? cx - halfW / 2 + u * halfW / 2 : cx + u * halfW / 2;
      const py_ = originY + topH / 2 + v * faceH + slant;
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(Math.round(px_ - 0.5), Math.round(py_ - 0.5), 2, 2);
    }
  }
}

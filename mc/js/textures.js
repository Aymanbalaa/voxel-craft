// Atlas assembly + inventory icon rendering. BROWSER ONLY — uses
// document.createElement('canvas') and Image. The "what tiles exist / how they're
// drawn" logic lives in texture-registry.js + texture-generators.js (pure, testable).
//
// buildAtlas() is ASYNC: for each registry tile it tries to load an optional
// override PNG from assets/textures/<name>.png; if a valid 16x16 PNG loads it is
// composited into that cell, otherwise the procedural generator runs. Zero PNGs
// present ⇒ fully procedural (no behavior change for a fresh clone).

import {
  REGISTRY, TILES, TILE, COLS, ATLAS_PX, makeRng, clamp8, chooseSource,
} from './texture-registry.js';

export { TILES };

// ---- Canvas helper ----------------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Try to load a 16x16 override PNG. Resolves to an HTMLImageElement or null.
// A 404 (or file:// failure) triggers onerror → null → generator fallback.
function loadOverride(name) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `assets/textures/${name}.png`;
  });
}

// ---- Public API -------------------------------------------------------------
let cached = null;
let building = null;

export async function buildAtlas() {
  if (cached) return cached;
  if (building) return building;
  building = (async () => {
    const canvas = makeCanvas(ATLAS_PX, ATLAS_PX);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const overrides = await Promise.allSettled(REGISTRY.map((t) => loadOverride(t.name)));

    REGISTRY.forEach((t, idx) => {
      const col = idx % COLS, row = (idx / COLS) | 0;
      const png = overrides[idx].status === 'fulfilled' ? overrides[idx].value : null;
      ctx.save();
      ctx.translate(col * TILE, row * TILE);
      if (chooseSource(png, t.gen) === 'png') {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(png, 0, 0, TILE, TILE);
      } else {
        t.gen(ctx, makeRng(idx)); // generators draw in tile-local 0..15 coords
      }
      ctx.restore();
    });

    cached = { canvas, image: canvas, TILES, tileSize: TILE, cols: COLS };
    return cached;
  })();
  return building;
}

// Resolve a tile name or index to {col,row,idx}.
function resolveTile(t) {
  const idx = typeof t === 'number' ? t : TILES[t];
  return { col: idx % COLS, row: (idx / COLS) | 0, idx };
}

// Draw one 16x16 source tile scaled into a destination rect, nearest-neighbor.
function blitTile(ctx, atlasCanvas, tile, dx, dy, dw, dh, shade = 1) {
  const { col, row } = resolveTile(tile);
  if (shade === 1) {
    ctx.drawImage(atlasCanvas, col * TILE, row * TILE, TILE, TILE, dx, dy, dw, dh);
  } else {
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

// makeIcon(spec) -> 32x32 HTMLCanvasElement. Reads the already-built atlas cache;
// buildAtlas() must have been awaited during boot before any icon is requested.
//   { flat: tileNameOrIndex }                              -> scaled flat sprite
//   { block: top, side }  OR  { top, side, type:'block' }  -> pseudo-isometric cube
export function makeIcon(spec) {
  if (!cached) throw new Error('makeIcon() called before buildAtlas() resolved');
  const atlas = cached;
  const icon = makeCanvas(32, 32);
  const ctx = icon.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  if (spec && spec.flat !== undefined) {
    blitTile(ctx, atlas.canvas, spec.flat, 0, 0, 32, 32);
    return icon;
  }

  const top = spec.top ?? spec.block;
  const side = spec.side ?? top;

  const cx = 16, topH = 9, faceH = 15;
  drawIsoTop(ctx, atlas.canvas, top, cx, topH, faceH);
  drawIsoFace(ctx, atlas.canvas, side, cx, topH, faceH, 'left', 0.8);
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

function drawIsoTop(ctx, atlasCanvas, tile, cx, topH, faceH) {
  const data = getTilePixels(atlasCanvas, tile);
  const originY = faceH - topH;
  const n = TILE;
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const i = (ty * n + tx) * 4;
      const a = data[i + 3];
      if (a === 0) continue;
      const r = clamp8(data[i] * 1.08 + 10), g = clamp8(data[i + 1] * 1.08 + 10), b = clamp8(data[i + 2] * 1.08 + 10);
      const u = (tx + 0.5) / n - 0.5, v = (ty + 0.5) / n - 0.5;
      const px_ = cx + (u - v) * 16;
      const py_ = originY + topH + (u + v) * topH;
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(Math.round(px_ - 0.5), Math.round(py_ - 0.5), 2, 2);
    }
  }
}

function drawIsoFace(ctx, atlasCanvas, tile, cx, topH, faceH, side, shade) {
  const data = getTilePixels(atlasCanvas, tile);
  const n = TILE, originY = faceH - topH, halfW = 16;
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const i = (ty * n + tx) * 4;
      const a = data[i + 3];
      if (a === 0) continue;
      const r = clamp8(data[i] * shade), g = clamp8(data[i + 1] * shade), b = clamp8(data[i + 2] * shade);
      const u = tx / n, v = ty / n;
      const slant = (side === 'left' ? (halfW / 2 - u * halfW / 2) : (u * halfW / 2)) * (topH / halfW);
      const px_ = side === 'left' ? cx - halfW / 2 + u * halfW / 2 : cx + u * halfW / 2;
      const py_ = originY + topH / 2 + v * faceH + slant;
      ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      ctx.fillRect(Math.round(px_ - 0.5), Math.round(py_ - 0.5), 2, 2);
    }
  }
}

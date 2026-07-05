// Chunk mesher. PURE — imports blocks.js + lighting.js (all pure).
// Turns the center chunk of a lit slab into vertex arrays for two draw buckets:
//   opaque — solid cubes + alphaTest cutouts (leaves, glass, plants, torches, cactus)
//   water  — the water surface (separate transparent pass)
//
// Output positions are CENTER-CHUNK-LOCAL (0..16); main.js positions the mesh at
// the chunk's world origin. Vertex color packs light+shade for the shader:
//   R = blockLight * 17   (0..255)
//   G = skyLight  * 17
//   B = shade * 255       (faceDirShade × ambientOcclusion)

import { CHUNK, HEIGHT } from './config.js';
import { B, IS_OPAQUE, IS_SOLID, SHAPE_ID } from './blocks.js';
import { SLAB, sidx } from './lighting.js';

const OFF = CHUNK; // center chunk starts at slab coord 16 on x and z

// Face order: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z. base/u/v chosen so cross(u,v)=normal.
const FACES = [
  { n:[1,0,0],  base:[1,0,0], u:[0,1,0], v:[0,0,1] }, // +X
  { n:[-1,0,0], base:[0,0,0], u:[0,0,1], v:[0,1,0] }, // -X
  { n:[0,1,0],  base:[0,1,0], u:[0,0,1], v:[1,0,0] }, // +Y (top)
  { n:[0,-1,0], base:[0,0,0], u:[1,0,0], v:[0,0,1] }, // -Y (bottom)
  { n:[0,0,1],  base:[0,0,1], u:[1,0,0], v:[0,1,0] }, // +Z
  { n:[0,0,-1], base:[0,0,0], u:[0,1,0], v:[1,0,0] }, // -Z
];
// Directional face shading (Minecraft-like): top brightest, bottom darkest.
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
// AO level 0..3 → brightness factor.
const AO_FACTOR = [0.5, 0.7, 0.85, 1.0];

const SHAPE = { BLOCK:0, CROSS:1, TORCH:2, CACTUS:3, LIQUID:4 };

// Growable buffers.
function bucket() { return { pos: [], uv: [], col: [], idx: [], v: 0 }; }

function pushQuad(bk, verts, uvs, r, g, b3) {
  // verts: 4× [x,y,z]; uvs: 4× [u,v]; per-vertex b3: 4 shade bytes (AO varies), r/g flat.
  const base = bk.v;
  for (let k = 0; k < 4; k++) {
    bk.pos.push(verts[k][0], verts[k][1], verts[k][2]);
    bk.uv.push(uvs[k][0], uvs[k][1]);
    bk.col.push(r, g, b3[k]);
  }
  bk.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  bk.v += 4;
}

function tileUV(tile) {
  const col = tile & 15, row = (tile >> 4) & 15;
  const s = 1 / 16;
  // Tiny inset to avoid atlas bleed.
  const e = 0.0008;
  const u0 = col * s + e, v0 = row * s + e, u1 = (col + 1) * s - e, v1 = (row + 1) * s - e;
  // top-left origin (main sets texture.flipY=false). Corners: (0,0)=tl,(1,0),(1,1),(0,1)
  return [u0, v0, u1, v1];
}
// UV corners for vertex order (0,0),(1,0),(1,1),(0,1) → map to tile (bl,br,tr,tl) upright.
function faceUVs(tile) {
  const [u0, v0, u1, v1] = tileUV(tile);
  return [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
}

function aoValue(s1, s2, c) {
  if (s1 && s2) return 0;
  return 3 - (s1 + s2 + c);
}

export function meshChunk(slab, light, faceTiles) {
  const sky = light.sky, blk = light.block;
  const opaque = bucket();
  const water = bucket();

  const solidAt = (sx, sy, sz) => (sy < 0 || sy >= HEIGHT) ? 0 : IS_OPAQUE[slab[sidx(sx, sy, sz)]];

  for (let ly = 0; ly < HEIGHT; ly++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const sx = lx + OFF, sz = lz + OFF, sy = ly;
        const id = slab[sidx(sx, sy, sz)];
        if (id === 0) continue;
        const shape = SHAPE_ID[id];

        if (shape === SHAPE.CROSS) { emitCross(opaque, id, lx, ly, lz, sx, sy, sz, sky, blk, faceTiles); continue; }
        if (shape === SHAPE.TORCH) { emitTorch(opaque, id, lx, ly, lz, sx, sy, sz, sky, blk, faceTiles); continue; }
        if (shape === SHAPE.LIQUID) { emitLiquid(water, id, lx, ly, lz, sx, sy, sz, slab, sky, blk, faceTiles); continue; }

        // BLOCK / CACTUS: 6 face cubes with culling + AO.
        const inset = (shape === SHAPE.CACTUS) ? 0.0625 : 0;
        for (let f = 0; f < 6; f++) {
          const F = FACES[f];
          const nx = sx + F.n[0], ny = sy + F.n[1], nz = sz + F.n[2];
          const nId = (ny < 0 || ny >= HEIGHT) ? 0 : slab[sidx(nx, ny, nz)];
          // Cull if neighbor is opaque, or (for non-opaque self like glass/leaves/ice)
          // the same block id (internal faces between equal transparents).
          if (IS_OPAQUE[nId]) continue;
          if (!IS_OPAQUE[id] && nId === id && shape !== SHAPE.CACTUS) continue;

          const tile = faceTiles[id * 6 + f];
          const uvs = faceUVs(tile);
          const li = (ny < 0 || ny >= HEIGHT) ? 0 : sidx(nx, ny, nz);
          const R = (li ? blk[li] : 0) * 17;
          const G = (li ? sky[li] : 15) * 17;
          const baseShade = FACE_SHADE[f];

          // Build 4 vertices + per-vertex AO.
          const verts = [], b3 = [];
          for (let c = 0; c < 4; c++) {
            const a = (c === 1 || c === 2) ? 1 : 0;   // u coord
            const bb = (c === 2 || c === 3) ? 1 : 0;  // v coord
            let px = sx - OFF + F.base[0] + a * F.u[0] + bb * F.v[0];
            let py = sy       + F.base[1] + a * F.u[1] + bb * F.v[1];
            let pz = sz - OFF + F.base[2] + a * F.u[2] + bb * F.v[2];
            // Cactus inset on side faces (not top/bottom).
            if (inset && (f < 2 || f >= 4)) {
              px += F.n[0] ? -F.n[0] * inset : 0;
              pz += F.n[2] ? -F.n[2] * inset : 0;
            }
            verts.push([px, py, pz]);
            // AO sampling in the neighbor plane.
            const su = a ? 1 : -1, sv = bb ? 1 : -1;
            const s1 = solidAt(nx + su * F.u[0], ny + su * F.u[1], nz + su * F.u[2]);
            const s2 = solidAt(nx + sv * F.v[0], ny + sv * F.v[1], nz + sv * F.v[2]);
            const cc = solidAt(nx + su * F.u[0] + sv * F.v[0], ny + su * F.u[1] + sv * F.v[1], nz + su * F.u[2] + sv * F.v[2]);
            const ao = aoValue(s1, s2, cc);
            b3.push(Math.round(baseShade * AO_FACTOR[ao] * 255));
          }
          pushQuad(opaque, verts, uvs, R, G, b3);
        }
      }
    }
  }
  return { opaque: finalize(opaque), water: finalize(water) };
}

function emitCross(bk, id, lx, ly, lz, sx, sy, sz, sky, blk, faceTiles) {
  const tile = faceTiles[id * 6 + 2]; // use "top"/all tile
  const uvs = faceUVs(tile);
  const i = sidx(sx, sy, sz);
  const R = blk[i] * 17, G = sky[i] * 17;
  const b = [Math.round(0.9 * 255), Math.round(0.9 * 255), Math.round(0.9 * 255), Math.round(0.9 * 255)];
  const lo = 0.146, hi = 0.854; // ~ sqrt insets to fit unit cell
  // Plane A (diagonal ↗) and Plane B (↘), each emitted both-sided.
  const A = [[lo, 0, lo], [hi, 0, hi], [hi, 1, hi], [lo, 1, lo]];
  const Bp = [[lo, 0, hi], [hi, 0, lo], [hi, 1, lo], [lo, 1, hi]];
  for (const plane of [A, Bp]) {
    const v = plane.map(p => [lx + p[0], ly + p[1], lz + p[2]]);
    pushQuad(bk, v, uvs, R, G, b);                       // front
    pushQuad(bk, [v[3], v[2], v[1], v[0]], [uvs[3], uvs[2], uvs[1], uvs[0]], R, G, b); // back
  }
}

function emitTorch(bk, id, lx, ly, lz, sx, sy, sz, sky, blk, faceTiles) {
  const tile = faceTiles[id * 6 + 0];
  const uvs = faceUVs(tile);
  const i = sidx(sx, sy, sz);
  const R = blk[i] * 17, G = sky[i] * 17;
  const b = [230, 230, 230, 230];
  const r = 0.0625, h = 0.625; // thin post
  const x0 = lx + 0.5 - r, x1 = lx + 0.5 + r, z0 = lz + 0.5 - r, z1 = lz + 0.5 + r;
  const y0 = ly, y1 = ly + h;
  // 4 sides + top
  const quads = [
    [[x1,y0,z0],[x1,y0,z1],[x1,y1,z1],[x1,y1,z0]],
    [[x0,y0,z1],[x0,y0,z0],[x0,y1,z0],[x0,y1,z1]],
    [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],
    [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]],
    [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],
  ];
  for (const v of quads) pushQuad(bk, v, uvs, R, G, b);
}

function emitLiquid(bk, id, lx, ly, lz, sx, sy, sz, slab, sky, blk, faceTiles) {
  const above = (sy + 1 >= HEIGHT) ? 0 : slab[sidx(sx, sy + 1, sz)];
  const surface = above !== id;          // top of a water column
  const topY = surface ? 0.88 : 1.0;
  for (let f = 0; f < 6; f++) {
    const F = FACES[f];
    const ny = sy + F.n[1];
    const nId = (ny < 0 || ny >= HEIGHT) ? 0 : slab[sidx(sx + F.n[0], ny, sz + F.n[2])];
    if (nId === id) continue;            // no faces between water cells
    if (IS_OPAQUE[nId]) continue;        // terrain hides this face
    if (nId !== 0 && f === 3) continue;  // don't draw bottom against non-air
    const tile = faceTiles[id * 6 + f];
    const uvs = faceUVs(tile);
    const li = (ny < 0 || ny >= HEIGHT) ? 0 : sidx(sx + F.n[0], ny, sz + F.n[2]);
    const R = (li ? blk[li] : 0) * 17, G = (li ? sky[li] : 15) * 17;
    const shade = Math.round(FACE_SHADE[f] * 255);
    const b3 = [shade, shade, shade, shade];
    const verts = [];
    for (let c = 0; c < 4; c++) {
      const a = (c === 1 || c === 2) ? 1 : 0;
      const bb = (c === 2 || c === 3) ? 1 : 0;
      let py = sy + F.base[1] + a * F.u[1] + bb * F.v[1];
      // lower the whole top face / the top edge of side faces to the surface height
      if (F.n[1] === 1) py = sy + topY;
      else if (surface && py === sy + 1) py = sy + topY;
      verts.push([sx - OFF + F.base[0] + a * F.u[0] + bb * F.v[0], py, sz - OFF + F.base[2] + a * F.u[2] + bb * F.v[2]]);
    }
    pushQuad(bk, verts, uvs, R, G, b3);
  }
}

function finalize(bk) {
  return {
    position: new Float32Array(bk.pos),
    uv: new Float32Array(bk.uv),
    color: new Uint8Array(bk.col),
    index: new Uint32Array(bk.idx),
    count: bk.idx.length,
  };
}

// Build the faceTiles table (Uint16Array 256*6) from BLOCKS tex + a TILES name→index map.
// Lives here so worker + main + tests share one implementation. face 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
export function buildFaceTiles(BLOCKS, TILES) {
  const t = new Uint16Array(256 * 6);
  const tile = (name) => (TILES && name in TILES) ? TILES[name] : 0;
  for (const id in BLOCKS) {
    const tex = BLOCKS[id].tex || {};
    let top, bottom, side, front;
    if (tex.all != null) top = bottom = side = front = tile(tex.all);
    else {
      top = tile(tex.top ?? tex.side ?? tex.all);
      bottom = tile(tex.bottom ?? tex.side ?? tex.all);
      side = tile(tex.side ?? tex.all);
      front = tex.front != null ? tile(tex.front) : side;
    }
    const b = id * 6;
    t[b + 0] = side;   // +X
    t[b + 1] = side;   // -X
    t[b + 2] = top;    // +Y
    t[b + 3] = bottom; // -Y
    t[b + 4] = front;  // +Z (treat +Z as "front" face for furnace/pumpkin)
    t[b + 5] = side;   // -Z
  }
  return t;
}

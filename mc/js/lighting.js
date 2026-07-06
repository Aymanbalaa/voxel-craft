// Slab lighting. PURE — imports blocks.js (also pure).
// Operates on a 48×128×48 "slab" = 3×3 chunk neighborhood, so the center chunk's
// boundary faces can read correct light from adjacent chunks.
//
// Two channels, each 0..15:
//   skylight  — sunlight from above, flood-filled into caves/overhangs
//   blocklight — from emitters (torches, glowstone, lava)
// The mesher reads the light of the empty cell a face looks into.

import { CHUNK, HEIGHT } from './config.js';
import { IS_OPAQUE, LIGHT_EMIT } from './blocks.js';

export const SLAB = CHUNK * 3;         // 48
export const SLAB_H = HEIGHT;          // 128
const SArea = SLAB * SLAB;             // 2304
const SVol = SArea * SLAB_H;           // 294912
export const sidx = (x, y, z) => x + z * SLAB + y * SArea;

// Assemble the slab block array from 9 chunk buffers.
// chunks[(dcz+1)*3 + (dcx+1)] for dcx,dcz in -1..1; null => air. Center = index 4.
export function buildSlab(chunks) {
  const slab = new Uint8Array(SVol);
  for (let gz = 0; gz < 3; gz++) {
    for (let gx = 0; gx < 3; gx++) {
      const buf = chunks[gz * 3 + gx];
      if (!buf) continue;
      const ox = gx * CHUNK, oz = gz * CHUNK;
      // chunk idx = lx + lz*16 + y*256
      for (let y = 0; y < HEIGHT; y++) {
        const yBaseC = y * CHUNK * CHUNK;
        const yBaseS = y * SArea;
        for (let lz = 0; lz < CHUNK; lz++) {
          const cRow = yBaseC + lz * CHUNK;
          const sRow = yBaseS + (oz + lz) * SLAB + ox;
          for (let lx = 0; lx < CHUNK; lx++) {
            slab[sRow + lx] = buf[cRow + lx];
          }
        }
      }
    }
  }
  return slab;
}

// Compute skylight + blocklight for the whole slab. Returns {sky, block} Uint8Arrays.
export function computeLight(slab) {
  const sky = new Uint8Array(SVol);
  const block = new Uint8Array(SVol);

  // A fixed-capacity ring-buffer index queue with an "in-queue" dedup flag.
  // Each cell can be live in the queue at most once, so occupancy never exceeds
  // SVol and the ring index can never overflow (which previously drove an OOB
  // read -> NaN coord decode -> infinite loop, and silently dropped block-light
  // propagations). BFS relaxation still reaches the same max-light fixpoint, so
  // the resulting sky/block arrays are unchanged for all valid input.
  const CAP = SVol;                 // max distinct live cells
  const q = new Int32Array(CAP);    // ring buffer, reused for both passes
  const inQ = new Uint8Array(SVol); // 1 => cell currently queued
  let qh = 0, qt = 0, qn = 0;       // head, tail, live count
  const qpush = (idx) => {
    if (inQ[idx]) return;           // already queued -> keep occupancy bounded
    inQ[idx] = 1;
    q[qt] = idx;
    qt = (qt + 1 === CAP) ? 0 : qt + 1;
    qn++;
  };

  // --- Skylight: seed top-down columns, then BFS spread ---------------------
  for (let z = 0; z < SLAB; z++) {
    for (let x = 0; x < SLAB; x++) {
      let y = SLAB_H - 1;
      const col = x + z * SLAB;
      // Descend through non-opaque cells at full 15.
      while (y >= 0) {
        const i = col + y * SArea;
        if (IS_OPAQUE[slab[i]]) break;
        sky[i] = 15;
        qpush(i);
        y--;
      }
    }
  }
  // BFS horizontal/into-shadow spread (-1 per step).
  while (qn > 0) {
    const i = q[qh];
    qh = (qh + 1 === CAP) ? 0 : qh + 1;
    qn--;
    inQ[i] = 0;
    const lvl = sky[i];
    if (lvl <= 1) continue;
    const nl = lvl - 1;
    // decode coords
    const y = (i / SArea) | 0;
    const r = i - y * SArea;
    const z = (r / SLAB) | 0;
    const x = r - z * SLAB;
    // 6 neighbors
    if (x > 0)        trySky(slab, sky, q, i - 1, nl) && qpush(i - 1);
    if (x < SLAB - 1) trySky(slab, sky, q, i + 1, nl) && qpush(i + 1);
    if (z > 0)        trySky(slab, sky, q, i - SLAB, nl) && qpush(i - SLAB);
    if (z < SLAB - 1) trySky(slab, sky, q, i + SLAB, nl) && qpush(i + SLAB);
    if (y > 0)        trySky(slab, sky, q, i - SArea, nl) && qpush(i - SArea);
    if (y < SLAB_H-1) trySky(slab, sky, q, i + SArea, nl) && qpush(i + SArea);
  }

  // --- Blocklight: seed emitters, then BFS spread ---------------------------
  // Reuse the ring; the skylight pass fully drained it, so inQ is all-zero here.
  qh = 0; qt = 0; qn = 0;
  for (let i = 0; i < SVol; i++) {
    const e = LIGHT_EMIT[slab[i]];
    if (e > 0) { block[i] = e; qpush(i); }
  }
  while (qn > 0) {
    const i = q[qh];
    qh = (qh + 1 === CAP) ? 0 : qh + 1;
    qn--;
    inQ[i] = 0;
    const lvl = block[i];
    if (lvl <= 1) continue;
    const nl = lvl - 1;
    const y = (i / SArea) | 0;
    const r = i - y * SArea;
    const z = (r / SLAB) | 0;
    const x = r - z * SLAB;
    if (x > 0)        tryBlk(slab, block, i - 1, nl) && qpush(i - 1);
    if (x < SLAB - 1) tryBlk(slab, block, i + 1, nl) && qpush(i + 1);
    if (z > 0)        tryBlk(slab, block, i - SLAB, nl) && qpush(i - SLAB);
    if (z < SLAB - 1) tryBlk(slab, block, i + SLAB, nl) && qpush(i + SLAB);
    if (y > 0)        tryBlk(slab, block, i - SArea, nl) && qpush(i - SArea);
    if (y < SLAB_H-1) tryBlk(slab, block, i + SArea, nl) && qpush(i + SArea);
  }

  return { sky, block };
}

// Returns true if we raised the cell's light (caller enqueues).
function trySky(slab, sky, q, ni, nl) {
  if (IS_OPAQUE[slab[ni]]) return false;
  if (sky[ni] >= nl) return false;
  sky[ni] = nl;
  return true;
}
function tryBlk(slab, block, ni, nl) {
  if (IS_OPAQUE[slab[ni]]) return false;
  if (block[ni] >= nl) return false;
  block[ni] = nl;
  return true;
}

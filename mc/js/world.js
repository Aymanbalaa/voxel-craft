// World: authoritative block store on the main thread + streaming pipeline that
// drives the terrain worker (generate → mesh) and manages THREE meshes.
//
// Main thread is the source of truth for block data (physics/raycast read it).
// Meshing runs in the worker: we send COPIES of the 9-chunk neighborhood so our
// authoritative buffers stay intact, and the worker recomputes lighting each mesh
// (so edits relight automatically).

import * as THREE from '../vendor/three.module.js';
import { CHUNK, HEIGHT, RENDER_DIST } from './config.js';
import { B } from './blocks.js';

const AREA = CHUNK * CHUNK;
const key = (cx, cz) => cx + ',' + cz;
const cidx = (lx, y, lz) => lx + lz * CHUNK + y * AREA;

// Per-chunk record.
// state: 'pending-gen' | 'blocks' | 'meshing' | 'ready'
class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = null;
    this.state = 'pending-gen';
    this.rev = 0;            // bumped on edit; stale mesh results discarded
    this.meshRev = -1;       // rev the current mesh was built from
    this.opaqueMesh = null;
    this.waterMesh = null;
    this.dirty = false;
  }
}

export class World {
  constructor({ seed, scene, materials, faceTiles }) {
    this.seed = seed;
    this.scene = scene;
    this.materials = materials;   // { opaque, water }
    this.chunks = new Map();
    this.editedChunks = new Set();  // keys of chunks the player changed (for saving)
    this.savedEdits = new Map();    // key -> full Uint8Array to overlay on generation
    this.genQueue = [];           // [cx,cz] wanting generation
    this.meshQueue = [];          // chunk keys wanting (re)mesh
    this.pendingGen = new Set();
    this.pendingMesh = new Set();
    this.lastCX = Infinity; this.lastCZ = Infinity;
    this.onChunkReady = null;

    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this._onWorker(e.data);
    this.worker.postMessage({ t: 'init', seed, faceTiles });
    this.ready = false;
    this._initResolve = null;
    this.whenReady = new Promise(r => (this._initResolve = r));

    // Budgets per update tick.
    this.GEN_BUDGET = 6;
    this.MESH_BUDGET = 4;
    this.inFlightGen = 0;
    this.inFlightMesh = 0;
    this.MAX_INFLIGHT_GEN = 12;
    this.MAX_INFLIGHT_MESH = 6;
  }

  // ---- Block access (world coords) ----------------------------------------
  _chunkAt(wx, wz) { return this.chunks.get(key(Math.floor(wx / CHUNK), Math.floor(wz / CHUNK))); }

  getBlock(wx, wy, wz) {
    if (wy < 0 || wy >= HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return 0;
    const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
    return c.blocks[cidx(lx, wy, lz)];
  }

  // Returns true if a block exists and is loaded (used to avoid falling through ungenerated ground).
  isLoaded(wx, wz) {
    const c = this._chunkAt(wx, wz);
    return !!(c && c.blocks);
  }

  setBlock(wx, wy, wz, id) {
    if (wy < 0 || wy >= HEIGHT) return;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c || !c.blocks) return;
    const lx = wx - cx * CHUNK, lz = wz - cz * CHUNK;
    const i = cidx(lx, wy, lz);
    if (c.blocks[i] === id) return;
    c.blocks[i] = id;
    this.editedChunks.add(key(cx, cz));   // track for persistence
    this._markDirty(c); // bumps rev + enqueues remesh
    // Remesh neighbors if the edit is on a border (lighting/faces cross chunks).
    if (lx === 0) this._markDirtyKey(cx - 1, cz);
    if (lx === CHUNK - 1) this._markDirtyKey(cx + 1, cz);
    if (lz === 0) this._markDirtyKey(cx, cz - 1);
    if (lz === CHUNK - 1) this._markDirtyKey(cx, cz + 1);
    // Corners: also diagonal neighbors for lighting.
    if ((lx === 0 || lx === CHUNK - 1) && (lz === 0 || lz === CHUNK - 1)) {
      this._markDirtyKey(cx + (lx === 0 ? -1 : 1), cz + (lz === 0 ? -1 : 1));
    }
  }

  _markDirty(c) {
    if (!c || !c.blocks) return;
    c.rev++;
    if (!this.pendingMesh.has(key(c.cx, c.cz)) && !c.dirty) {
      c.dirty = true;
      this.meshQueue.unshift(key(c.cx, c.cz)); // edits jump the queue
    }
  }
  _markDirtyKey(cx, cz) {
    const c = this.chunks.get(key(cx, cz));
    if (c && c.blocks) this._markDirty(c);
  }

  // ---- Streaming ----------------------------------------------------------
  update(px, pz) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    if (pcx !== this.lastCX || pcz !== this.lastCZ) {
      this.lastCX = pcx; this.lastCZ = pcz;
      this._reprioritize(pcx, pcz);
      this._unloadFar(pcx, pcz);
    }
    this._pump();
  }

  _reprioritize(pcx, pcz) {
    // Spiral outward: request generation for every chunk in range not present.
    const R = RENDER_DIST;
    const want = [];
    for (let r = 0; r <= R; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
        want.push([pcx + dx, pcz + dz]);
      }
    }
    for (const [cx, cz] of want) {
      const k = key(cx, cz);
      if (!this.chunks.has(k)) {
        this.chunks.set(k, new Chunk(cx, cz));
        this.genQueue.push([cx, cz]);
      }
    }
  }

  _unloadFar(pcx, pcz) {
    const R = RENDER_DIST + 2;
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > R || Math.abs(c.cz - pcz) > R) {
        // Preserve player edits before dropping the chunk from memory, so they
        // survive unload (restored on reload) and still reach the next save.
        if (c.blocks && this.editedChunks.has(k)) this.savedEdits.set(k, c.blocks);
        this._disposeMesh(c);
        this.chunks.delete(k);
      }
    }
  }

  _pump() {
    // Kick off generation.
    while (this.genQueue.length && this.inFlightGen < this.MAX_INFLIGHT_GEN) {
      const [cx, cz] = this.genQueue.shift();
      const k = key(cx, cz);
      const c = this.chunks.get(k);
      if (!c || c.state !== 'pending-gen' || this.pendingGen.has(k)) continue;
      this.pendingGen.add(k);
      this.inFlightGen++;
      this.worker.postMessage({ t: 'gen', cx, cz });
    }
    // Kick off meshing (only chunks whose full 3×3 neighborhood has blocks).
    let started = 0;
    for (let n = 0; n < this.meshQueue.length && this.inFlightMesh < this.MAX_INFLIGHT_MESH && started < this.MESH_BUDGET;) {
      const k = this.meshQueue[n];
      const c = this.chunks.get(k);
      if (!c || !c.blocks) { this.meshQueue.splice(n, 1); continue; }
      if (this.pendingMesh.has(k)) { this.meshQueue.splice(n, 1); continue; }
      if (!this._neighborhoodReady(c.cx, c.cz)) { n++; continue; } // try later
      this.meshQueue.splice(n, 1);
      this._startMesh(c);
      started++;
    }
  }

  _neighborhoodReady(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.chunks.get(key(cx + dx, cz + dz));
      if (!c || !c.blocks) return false;
    }
    return true;
  }

  _startMesh(c) {
    const k = key(c.cx, c.cz);
    const chunks = new Array(9).fill(null);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nc = this.chunks.get(key(c.cx + dx, c.cz + dz));
      chunks[(dz + 1) * 3 + (dx + 1)] = nc && nc.blocks ? nc.blocks.buffer.slice(0) : null;
    }
    c.dirty = false;
    c.state = 'meshing';
    this.pendingMesh.add(k);
    this.inFlightMesh++;
    const transfer = chunks.filter(Boolean);
    this.worker.postMessage({ t: 'mesh', cx: c.cx, cz: c.cz, rev: c.rev, chunks }, transfer);
  }

  _onWorker(msg) {
    if (msg.t === 'ready') { this.ready = true; this._initResolve?.(); return; }
    if (msg.t === 'gen') {
      const k = key(msg.cx, msg.cz);
      this.pendingGen.delete(k);
      this.inFlightGen--;
      const c = this.chunks.get(k);
      if (!c) return; // unloaded while generating
      // Overlay any saved player edits for this chunk on top of fresh generation.
      if (this.savedEdits.has(k)) { c.blocks = this.savedEdits.get(k); this.editedChunks.add(k); }
      else c.blocks = new Uint8Array(msg.blocks);
      c.state = 'blocks';
      // This chunk and any neighbor may now have a complete neighborhood → queue mesh.
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nk = key(msg.cx + dx, msg.cz + dz);
        const nc = this.chunks.get(nk);
        if (nc && nc.blocks && nc.meshRev < 0 && !this.pendingMesh.has(nk) && !nc.dirty) {
          nc.dirty = true;
          this.meshQueue.push(nk);
        }
      }
      return;
    }
    if (msg.t === 'mesh') {
      const k = key(msg.cx, msg.cz);
      this.pendingMesh.delete(k);
      this.inFlightMesh--;
      const c = this.chunks.get(k);
      if (!c) return;
      // Discard stale results (an edit happened after this mesh was dispatched).
      if (msg.rev !== c.rev) { if (c.blocks) { c.dirty = true; this.meshQueue.unshift(k); } }
      this._applyMesh(c, msg);
      c.meshRev = msg.rev;
      c.state = 'ready';
      if (this.onChunkReady) this.onChunkReady(c.cx, c.cz);
    }
  }

  _applyMesh(c, msg) {
    this._disposeMesh(c);
    const ox = c.cx * CHUNK, oz = c.cz * CHUNK;
    if (msg.opaque.count > 0) {
      c.opaqueMesh = this._makeMesh(msg.opaque, this.materials.opaque, ox, oz);
      this.scene.add(c.opaqueMesh);
    }
    if (msg.water.count > 0) {
      c.waterMesh = this._makeMesh(msg.water, this.materials.water, ox, oz);
      this.scene.add(c.waterMesh);
    }
  }

  _makeMesh(data, material, ox, oz) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(data.color, 3, true)); // normalized
    g.setIndex(new THREE.BufferAttribute(data.index, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.position.set(ox, 0, oz);
    mesh.frustumCulled = true;
    return mesh;
  }

  _disposeMesh(c) {
    for (const m of [c.opaqueMesh, c.waterMesh]) {
      if (m) { this.scene.remove(m); m.geometry.dispose(); }
    }
    c.opaqueMesh = null; c.waterMesh = null;
  }

  // Provide saved edits (loaded from disk) to overlay onto generation. These are
  // player edits and must keep being persisted even if their chunks are never
  // revisited this session, so register their keys as edited (collectEdits only
  // walks editedChunks — otherwise unvisited saved chunks silently drop on save).
  setSavedEdits(map) {
    this.savedEdits = map || new Map();
    for (const k of this.savedEdits.keys()) this.editedChunks.add(k);
  }

  // Collect edited chunks as {cx,cz,blocks} copies for saving.
  collectEdits() {
    const out = [];
    for (const k of this.editedChunks) {
      const c = this.chunks.get(k);
      let blocks = c && c.blocks ? c.blocks : this.savedEdits.get(k);
      if (!blocks) continue;
      const [cx, cz] = k.split(',').map(Number);
      out.push({ cx, cz, blocks: blocks.slice(0) });
    }
    return out;
  }

  // How many chunks are fully ready (for a loading gate).
  readyCount() { let n = 0; for (const c of this.chunks.values()) if (c.state === 'ready') n++; return n; }

  // Force-load + mesh the spawn neighborhood synchronously-ish (returns a promise).
  dispose() { this.worker.terminate(); }
}

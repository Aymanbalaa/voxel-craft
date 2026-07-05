// Lightweight particle effects: block-break debris + landing puffs. Small textured
// cubes sampled from the block's atlas tiles, with gravity + lifetime fade.

import * as THREE from '../vendor/three.module.js';
import { IS_COLLIDE } from './blocks.js';

const GRAV = 20;

export class Particles {
  constructor({ scene, world, atlasTex, faceTiles }) {
    this.scene = scene; this.world = world; this.faceTiles = faceTiles;
    this.mat = new THREE.MeshBasicMaterial({ map: atlasTex, alphaTest: 0.5 });
    this.geoCache = new Map();   // id -> tiny cube geometry with block UVs
    this.parts = [];
  }

  _geo(id) {
    if (this.geoCache.has(id)) return this.geoCache.get(id);
    const g = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const uv = g.attributes.uv, s = 1 / 16, e = 0.002;
    for (let f = 0; f < 6; f++) {
      const tile = this.faceTiles[id * 6 + f];
      const col = tile & 15, row = (tile >> 4) & 15;
      // sample a small sub-cell of the tile so particles look varied
      const u0 = col * s + e, v0 = row * s + e, u1 = (col + 1) * s - e, v1 = (row + 1) * s - e;
      const b = f * 4;
      uv.setXY(b + 0, u0, v1); uv.setXY(b + 1, u1, v1); uv.setXY(b + 2, u0, v0); uv.setXY(b + 3, u1, v0);
    }
    uv.needsUpdate = true;
    this.geoCache.set(id, g);
    return g;
  }

  blockBreak(x, y, z, id, n = 10) {
    const geo = this._geo(id);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, this.mat);
      m.position.set(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.3) * 0.6, z + (Math.random() - 0.5) * 0.6);
      const sc = 0.5 + Math.random() * 0.8; m.scale.setScalar(sc);
      this.scene.add(m);
      this.parts.push({
        mesh: m, base: sc,
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3),
        life: 0, ttl: 0.6 + Math.random() * 0.4,
      });
      if (this.parts.length > 400) this._remove(0);
    }
  }

  _solid(x, y, z) { return IS_COLLIDE[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1; }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life += dt;
      if (p.life >= p.ttl) { this._remove(i); continue; }
      p.vel.y -= GRAV * dt;
      const m = p.mesh;
      const ny = m.position.y + p.vel.y * dt;
      if (this._solid(m.position.x, ny, m.position.z) && p.vel.y < 0) { p.vel.y = 0; p.vel.x *= 0.5; p.vel.z *= 0.5; }
      else m.position.y = ny;
      m.position.x += p.vel.x * dt; m.position.z += p.vel.z * dt;
      m.rotation.x += dt * 4; m.rotation.y += dt * 3;
      // shrink out near end of life
      const k = 1 - p.life / p.ttl;
      m.scale.setScalar(Math.max(0.05, p.base * k));
    }
  }

  _remove(i) { const p = this.parts[i]; this.scene.remove(p.mesh); this.parts.splice(i, 1); }
  clear() { for (let i = this.parts.length - 1; i >= 0; i--) this._remove(i); }
}

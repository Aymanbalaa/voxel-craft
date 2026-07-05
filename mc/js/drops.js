// Dropped-item entities: little bobbing cubes (blocks) or billboards (items) that
// fall, settle on the ground, drift toward the player, and get picked up.

import * as THREE from '../vendor/three.module.js';
import { CHUNK } from './config.js';
import { B, BLOCKS, IS_COLLIDE } from './blocks.js';
import { isBlockItem, itemIcon } from './items.js';

const GRAV = 26;
const PICKUP_R = 1.5;
const MAGNET_R = 3.2;

export class Drops {
  constructor({ scene, world, inventory, atlasTex, faceTiles, TILES, sound }) {
    this.scene = scene; this.world = world; this.inv = inventory;
    this.faceTiles = faceTiles; this.TILES = TILES; this.sound = sound;
    this.items = [];
    this.mat = new THREE.MeshBasicMaterial({ map: atlasTex, alphaTest: 0.5, side: THREE.DoubleSide });
    this._geoCache = new Map();  // id -> geometry
  }

  _blockGeo(id) {
    if (this._geoCache.has(id)) return this._geoCache.get(id);
    const g = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const uv = g.attributes.uv;
    const s = 1 / 16, e = 0.001;
    for (let f = 0; f < 6; f++) {
      const tile = this.faceTiles[id * 6 + f];
      const col = tile & 15, row = (tile >> 4) & 15;
      const u0 = col * s + e, v0 = row * s + e, u1 = (col + 1) * s - e, v1 = (row + 1) * s - e;
      const base = f * 4;
      uv.setXY(base + 0, u0, v1); uv.setXY(base + 1, u1, v1);
      uv.setXY(base + 2, u0, v0); uv.setXY(base + 3, u1, v0);
    }
    uv.needsUpdate = true;
    this._geoCache.set(id, g);
    return g;
  }

  _itemGeo(id) {
    const key = 'i' + id;
    if (this._geoCache.has(key)) return this._geoCache.get(key);
    const g = new THREE.PlaneGeometry(0.4, 0.4);
    const icon = itemIcon(id);           // { flat:'name' } for items
    const name = icon.flat;
    const tile = (this.TILES && name in this.TILES) ? this.TILES[name] : 0;
    const s = 1 / 16, e = 0.001;
    const col = tile & 15, row = (tile >> 4) & 15;
    const u0 = col * s + e, v0 = row * s + e, u1 = (col + 1) * s - e, v1 = (row + 1) * s - e;
    const uv = g.attributes.uv;
    uv.setXY(0, u0, v0); uv.setXY(1, u1, v0); uv.setXY(2, u0, v1); uv.setXY(3, u1, v1);
    uv.needsUpdate = true;
    this._geoCache.set(key, g);
    return g;
  }

  spawn(x, y, z, id, count = 1) {
    // Merge into a nearby drop of the same id to limit entity count.
    for (const d of this.items) {
      if (d.id === id && Math.abs(d.pos.x - x) < 0.8 && Math.abs(d.pos.y - y) < 0.8 && Math.abs(d.pos.z - z) < 0.8) {
        d.count += count; return;
      }
    }
    const block = isBlockItem(id);
    const geo = block ? this._blockGeo(id) : this._itemGeo(id);
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.items.push({
      id, count, mesh,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.6, 2 + Math.random(), (Math.random() - 0.5) * 1.6),
      age: 0, billboard: !block,
    });
  }

  _solidAt(x, y, z) { return IS_COLLIDE[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1; }

  update(dt, playerPos, camera) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.age += dt;

      // Physics.
      d.vel.y -= GRAV * dt;
      const ny = d.pos.y + d.vel.y * dt;
      if (this._solidAt(d.pos.x, ny, d.pos.z) && d.vel.y < 0) {
        // rest on top of the block below
        d.pos.y = Math.floor(ny) + 1.05; d.vel.y = 0; d.vel.x *= 0.6; d.vel.z *= 0.6;
      } else d.pos.y = ny;
      // horizontal with wall stop
      const nx = d.pos.x + d.vel.x * dt, nz = d.pos.z + d.vel.z * dt;
      if (!this._solidAt(nx, d.pos.y, d.pos.z)) d.pos.x = nx; else d.vel.x = 0;
      if (!this._solidAt(d.pos.x, d.pos.y, nz)) d.pos.z = nz; else d.vel.z = 0;
      d.vel.x *= 0.98; d.vel.z *= 0.98;

      // Magnet toward player (aim at chest height).
      const dx = playerPos.x - d.pos.x, dy = (playerPos.y + 0.9) - d.pos.y, dz = playerPos.z - d.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (d.age > 0.4 && dist < MAGNET_R) {
        const pull = (1 - dist / MAGNET_R) * 14 * dt;
        d.pos.x += dx / dist * pull; d.pos.y += dy / dist * pull; d.pos.z += dz / dist * pull;
      }
      if (d.age > 0.4 && dist < PICKUP_R) {
        const leftover = this.inv.addItem({ id: d.id, count: d.count });
        this.sound?.play?.('pop', { volume: 0.4, pitch: 0.9 + Math.random() * 0.3 });
        if (leftover) { d.count = leftover.count; d.age = 0.1; } // inventory full: bounce back
        else { this._remove(i); continue; }
      }

      // Visuals: bob + spin, or billboard.
      d.mesh.position.set(d.pos.x, d.pos.y + Math.sin(d.age * 3) * 0.06 + 0.1, d.pos.z);
      if (d.billboard && camera) d.mesh.quaternion.copy(camera.quaternion);
      else d.mesh.rotation.y += dt * 1.4;

      if (d.age > 300) this._remove(i); // 5-min despawn
    }
  }

  _remove(i) {
    const d = this.items[i];
    this.scene.remove(d.mesh);
    this.items.splice(i, 1);
  }

  clear() { for (let i = this.items.length - 1; i >= 0; i--) this._remove(i); }
}

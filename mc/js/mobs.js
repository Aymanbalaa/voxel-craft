// Mobs: pigs, sheep (passive wanderers) and zombies (night hostiles). Boxy THREE
// models with walk animation, swept-AABB physics against the world, simple AI,
// spawn/despawn rings around the player, and loot drops.

import * as THREE from '../vendor/three.module.js';
import { B, IS_COLLIDE } from './blocks.js';
import { I } from './items.js';

const GRAV = 26;

// ---- Boxy model builders ---------------------------------------------------
function box(w, h, d, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.MeshBasicMaterial({ color });
  return new THREE.Mesh(g, m);
}

function pigModel() {
  const g = new THREE.Group();
  const body = box(0.9, 0.6, 0.6, 0xe8a0a0); body.position.y = 0.55; body.rotation.y = Math.PI / 2; g.add(body);
  const head = box(0.5, 0.5, 0.5, 0xeaa6a6); head.position.set(0, 0.62, 0.5); g.add(head);
  const snout = box(0.25, 0.2, 0.1, 0xd98a8a); snout.position.set(0, 0.56, 0.76); g.add(snout);
  const legs = [];
  for (const [x, z] of [[-0.25,0.28],[0.25,0.28],[-0.25,-0.28],[0.25,-0.28]]) {
    const l = box(0.22, 0.4, 0.22, 0xc98a8a); l.position.set(x, 0.2, z); l.geometry.translate(0, -0.2, 0); l.position.y = 0.4; g.add(l); legs.push(l);
  }
  g.userData = { legs, height: 0.9, width: 0.7, head };
  return g;
}

function sheepModel() {
  const g = new THREE.Group();
  const body = box(1.0, 0.75, 0.7, 0xeeeeee); body.position.y = 0.7; g.add(body);
  const head = box(0.42, 0.42, 0.5, 0xd9cbb8); head.position.set(0, 0.75, 0.55); g.add(head);
  const legs = [];
  for (const [x, z] of [[-0.3,0.28],[0.3,0.28],[-0.3,-0.28],[0.3,-0.28]]) {
    const l = box(0.2, 0.5, 0.2, 0x9a8a78); l.geometry.translate(0, -0.25, 0); l.position.set(x, 0.5, z); g.add(l); legs.push(l);
  }
  g.userData = { legs, height: 1.1, width: 0.8, head };
  return g;
}

function zombieModel() {
  const g = new THREE.Group();
  const body = box(0.5, 0.7, 0.28, 0x2f6d6d); body.position.y = 1.0; g.add(body);
  const head = box(0.5, 0.5, 0.5, 0x5fa05f); head.position.set(0, 1.6, 0); g.add(head);
  const legs = [], arms = [];
  for (const x of [-0.15, 0.15]) {
    const l = box(0.22, 0.7, 0.22, 0x3a3f6b); l.geometry.translate(0, -0.35, 0); l.position.set(x, 0.7, 0); g.add(l); legs.push(l);
  }
  for (const x of [-0.35, 0.35]) {
    const a = box(0.2, 0.6, 0.2, 0x5fa05f); a.geometry.translate(0, -0.3, 0); a.position.set(x, 1.65, 0.0); a.rotation.x = -1.4; g.add(a); arms.push(a);
  }
  g.userData = { legs, arms, height: 1.9, width: 0.6, head };
  return g;
}

const BUILDERS = { pig: pigModel, sheep: sheepModel, zombie: zombieModel };
const STATS = {
  pig:    { health: 10, speed: 1.6, hostile: false, drop: { id: I.PORKCHOP, min: 1, max: 3 } },
  sheep:  { health: 8,  speed: 1.5, hostile: false, drop: { id: B.WOOL, min: 1, max: 1 } },
  zombie: { health: 20, speed: 2.2, hostile: true,  drop: { id: I.BONE ?? I.STICK, min: 0, max: 2 } },
};

class Mob {
  constructor(type, x, y, z) {
    this.type = type;
    this.model = BUILDERS[type]();
    this.model.position.set(x, y, z);
    this.pos = new THREE.Vector3(x, y, z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    const s = STATS[type];
    this.health = s.health; this.speed = s.speed; this.hostile = s.hostile;
    this.onGround = false;
    this.state = 'idle'; this.stateTime = 0;
    this.walkPhase = 0; this.hurtFlash = 0; this.attackCd = 0;
    this.width = this.model.userData.width; this.height = this.model.userData.height;
  }

  _solid(w, x, y, z) { return IS_COLLIDE[w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1; }

  _collides(w, px, py, pz) {
    const hw = this.width / 2, h = this.height;
    for (let y = Math.floor(py); y <= Math.floor(py + h - 0.01); y++)
      for (let z = Math.floor(pz - hw); z <= Math.floor(pz + hw); z++)
        for (let x = Math.floor(px - hw); x <= Math.floor(px + hw); x++)
          if (this._solid(w, x, y, z)) return true;
    return false;
  }

  _move(w, axis, d) {
    const p = this.pos, np = { x: p.x, y: p.y, z: p.z }; np[axis] += d;
    if (!this._collides(w, np.x, np.y, np.z)) { p[axis] = np[axis]; return false; }
    if (axis === 'y') { this.vel.y = 0; return d < 0; }
    // Try to step up a single block for x/z.
    if (this.onGround) {
      const up = { x: p.x, y: p.y + 1.02, z: p.z }; up[axis] += d;
      if (!this._collides(w, up.x, up.y, up.z)) { p.y += 1.02; p[axis] = up[axis]; return false; }
    }
    this.vel[axis] = 0;
    return false;
  }
}

export class Mobs {
  constructor({ scene, world, drops, sound }) {
    this.scene = scene; this.world = world; this.drops = drops; this.sound = sound;
    this.mobs = [];
    this.spawnTimer = 0;
    this.PASSIVE_CAP = 12;
    this.HOSTILE_CAP = 14;
    this._daylight = 1;
  }

  setDaylight(v) { this._daylight = v; }

  spawn(type, x, y, z) {
    if (this.mobs.length > 40) return null;
    const m = new Mob(type, x, y, z);
    this.scene.add(m.model);
    this.mobs.push(m);
    return m;
  }

  // Raycast player's look ray against mob AABBs; return nearest within reach.
  raycast(origin, dir, reach) {
    let best = null, bestT = reach;
    for (const m of this.mobs) {
      const hw = m.width / 2;
      const min = [m.pos.x - hw, m.pos.y, m.pos.z - hw];
      const max = [m.pos.x + hw, m.pos.y + m.height, m.pos.z + hw];
      const t = rayBox(origin, dir, min, max);
      if (t != null && t < bestT) { bestT = t; best = m; }
    }
    return best;
  }

  hit(mob, dmg, knockFrom) {
    mob.health -= dmg;
    mob.hurtFlash = 0.25;
    this.sound?.play?.('hurt', { volume: 0.4, pitch: 1.2 });
    // Knockback + passive flee.
    if (knockFrom) {
      const dx = mob.pos.x - knockFrom.x, dz = mob.pos.z - knockFrom.z;
      const d = Math.hypot(dx, dz) || 1;
      mob.vel.x += dx / d * 5; mob.vel.z += dz / d * 5; mob.vel.y = 5;
    }
    if (!mob.hostile) { mob.state = 'flee'; mob.stateTime = 0; }
    if (mob.health <= 0) this._kill(mob);
  }

  _kill(mob) {
    const s = STATS[mob.type];
    const n = s.drop.min + Math.floor(Math.random() * (s.drop.max - s.drop.min + 1));
    for (let i = 0; i < n; i++) this.drops?.spawn(mob.pos.x, mob.pos.y + 0.5, mob.pos.z, s.drop.id, 1);
    this._despawn(mob);
  }

  _despawn(mob) {
    this.scene.remove(mob.model);
    mob.model.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    const idx = this.mobs.indexOf(mob); if (idx >= 0) this.mobs.splice(idx, 1);
  }

  update(dt, player) {
    this._spawnTick(dt, player);
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      this._ai(m, dt, player);
      this._physics(m, dt);
      this._animate(m, dt);
      // Despawn far mobs, or any mob that tunneled below the world into the void.
      const dist = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z);
      if (dist > 80 || m.pos.y < -8) { this._despawn(m); continue; }
      // Zombies burn in daylight.
      if (m.type === 'zombie' && this._daylight > 0.85) {
        m.burnTime = (m.burnTime || 0) + dt;
        if (m.burnTime > 6) this._kill(m);
      } else m.burnTime = 0;
    }
  }

  _ai(m, dt, player) {
    m.stateTime += dt;
    if (m.attackCd > 0) m.attackCd -= dt;
    const toPlayer = { x: player.pos.x - m.pos.x, z: player.pos.z - m.pos.z };
    const pdist = Math.hypot(toPlayer.x, toPlayer.z);

    if (m.hostile) {
      // Chase player within 16 blocks.
      if (pdist < 16 && pdist > 0.9) {
        m.yaw = Math.atan2(toPlayer.x, toPlayer.z);
        m.wishX = toPlayer.x / pdist; m.wishZ = toPlayer.z / pdist;
        m.state = 'chase';
      } else if (pdist <= 1.2) {
        m.wishX = m.wishZ = 0;
        if (m.attackCd <= 0) { m.attackCd = 1.0; this._attackPlayer?.(m); }
      } else {
        this._wander(m);
      }
    } else if (m.state === 'flee') {
      if (m.stateTime > 3) { m.state = 'idle'; m.stateTime = 0; }
      else if (pdist < 10) { m.yaw = Math.atan2(-toPlayer.x, -toPlayer.z); m.wishX = -toPlayer.x / (pdist||1); m.wishZ = -toPlayer.z / (pdist||1); }
      else this._wander(m);
    } else {
      this._wander(m);
    }
  }

  _wander(m) {
    if (m.state !== 'wander' || m.stateTime > 3 + Math.random() * 3) {
      m.state = 'wander'; m.stateTime = 0;
      if (Math.random() < 0.4) { m.wishX = m.wishZ = 0; }         // pause
      else { m.yaw = Math.random() * Math.PI * 2; m.wishX = Math.sin(m.yaw); m.wishZ = Math.cos(m.yaw); }
    }
  }

  _physics(m, dt) {
    const spd = m.speed * (m.state === 'chase' || m.state === 'flee' ? 1.35 : 1);
    const wx = (m.wishX || 0), wz = (m.wishZ || 0);
    // accelerate toward wish
    m.vel.x += (wx * spd - m.vel.x) * Math.min(1, dt * 8);
    m.vel.z += (wz * spd - m.vel.z) * Math.min(1, dt * 8);
    m.vel.y -= GRAV * dt;
    // Cap fall speed so a single clamped-dt step cannot skip past the 1-block
    // bedrock floor and tunnel a mob into an endless (never-despawned) free-fall.
    if (m.vel.y < -60) m.vel.y = -60;

    const w = this.world;
    m.onGround = false;
    m._move(w, 'x', m.vel.x * dt);
    m._move(w, 'z', m.vel.z * dt);
    const landed = m._move(w, 'y', m.vel.y * dt);
    if (landed) m.onGround = true;

    // Auto-jump when walking into a wall.
    if (m.onGround && (wx || wz)) {
      const fx = m.pos.x + Math.sign(wx) * (m.width / 2 + 0.1);
      const fz = m.pos.z + Math.sign(wz) * (m.width / 2 + 0.1);
      if (m._solid(w, fx, m.pos.y + 0.2, m.pos.z) || m._solid(w, m.pos.x, m.pos.y + 0.2, fz)) m.vel.y = 6.5;
    }
    m.model.position.set(m.pos.x, m.pos.y, m.pos.z);
    m.model.rotation.y = m.yaw;
  }

  _animate(m, dt) {
    const moving = Math.hypot(m.vel.x, m.vel.z) > 0.3;
    if (moving) m.walkPhase += dt * 8; else m.walkPhase *= 0.8;
    const swing = Math.sin(m.walkPhase) * 0.5;
    const legs = m.model.userData.legs || [];
    legs.forEach((l, i) => { l.rotation.x = (i % 2 ? -swing : swing); });
    if (m.hurtFlash > 0) m.hurtFlash -= dt;
  }

  _spawnTick(dt, player) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 2;
    const passive = this.mobs.filter(m => !m.hostile).length;
    const hostile = this.mobs.filter(m => m.hostile).length;
    const night = this._daylight < 0.35;

    // Try a few candidate positions in a ring 20-40 blocks out.
    for (let attempt = 0; attempt < 6; attempt++) {
      const ang = Math.random() * Math.PI * 2, r = 24 + Math.random() * 16;
      const x = Math.floor(player.pos.x + Math.cos(ang) * r);
      const z = Math.floor(player.pos.z + Math.sin(ang) * r);
      if (!this.world.isLoaded(x, z)) continue;
      // Find surface.
      let y = 120; while (y > 1 && this.world.getBlock(x, y, z) === 0) y--;
      const ground = this.world.getBlock(x, y, z);
      const above = this.world.getBlock(x, y + 1, z);
      if (above !== 0) continue;
      if (night && hostile < this.HOSTILE_CAP && this._daylight < 0.3) {
        if (IS_COLLIDE[ground]) { this.spawn('zombie', x + 0.5, y + 1.02, z + 0.5); return; }
      } else if (!night && passive < this.PASSIVE_CAP && (ground === B.GRASS || ground === B.SNOWY_GRASS)) {
        this.spawn(Math.random() < 0.55 ? 'pig' : 'sheep', x + 0.5, y + 1.02, z + 0.5); return;
      }
    }
  }

  clear() {
    for (const m of this.mobs) {
      this.scene.remove(m.model);
      m.model.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    this.mobs = [];
  }
  count() { return this.mobs.length; }
}

// Slab-method ray/AABB intersection; returns entry distance t>=0 or null.
function rayBox(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const oi = i === 0 ? o.x : i === 1 ? o.y : o.z;
    const di = i === 0 ? d.x : i === 1 ? d.y : d.z;
    if (Math.abs(di) < 1e-8) { if (oi < min[i] || oi > max[i]) return null; }
    else {
      let t1 = (min[i] - oi) / di, t2 = (max[i] - oi) / di;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

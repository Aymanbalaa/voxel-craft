// Player: swept-AABB physics against the voxel world, plus movement modes
// (walk / sprint / sneak / swim / fly), fall damage, and water/air state.
// Pure-ish: depends on world.getBlock + block collision flags. No THREE.

import {
  GRAVITY, JUMP_VEL, WALK_SPEED, SPRINT_SPEED, SNEAK_SPEED, FLY_SPEED, SWIM_SPEED, PLAYER,
} from './config.js';
import { B, IS_COLLIDE } from './blocks.js';

const HW = PLAYER.width / 2;   // half-width
const H = PLAYER.height;

export class Player {
  constructor(world, spawn) {
    this.world = world;
    this.pos = { x: spawn.x, y: spawn.y, z: spawn.z }; // feet-center
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;    // radians, 0 = -Z
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.mode = 'survival';   // 'survival' | 'creative'
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    this.fallStart = null;     // y where the current fall began
    this.width = PLAYER.width;
    this.height = PLAYER.height;
  }

  eyeY() { return this.pos.y + PLAYER.eye; }

  setMode(m) {
    this.mode = m;
    if (m === 'survival') this.flying = false;
  }
  toggleFly() { if (this.mode === 'creative') { this.flying = !this.flying; this.vel.y = 0; } }

  // A solid (collidable) voxel test.
  _solid(x, y, z) { return IS_COLLIDE[this.world.getBlock(x, y, z)] === 1; }

  // Does the player AABB at (px,py,pz) intersect any solid voxel?
  _collides(px, py, pz) {
    const x0 = Math.floor(px - HW), x1 = Math.floor(px + HW);
    const y0 = Math.floor(py), y1 = Math.floor(py + H - 0.0001);
    const z0 = Math.floor(pz - HW), z1 = Math.floor(pz + HW);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (this._solid(x, y, z)) return true;
    return false;
  }

  _blockAtFeet() { return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z)); }

  // Advance one fixed physics step.
  update(dt, input) {
    const events = { landedDamage: 0, stepBlock: 0, enteredWater: false, brokeSprint: false };

    // Water state.
    const feetBlock = this._blockAtFeet();
    const eyeBlock = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.eyeY()), Math.floor(this.pos.z));
    const wasInWater = this.inWater;
    this.inWater = (feetBlock === B.WATER || eyeBlock === B.WATER);
    this.headInWater = (eyeBlock === B.WATER);
    if (this.inWater && !wasInWater) events.enteredWater = true;

    this.sneaking = !!input.sneak && this.onGround && !this.flying;
    this.sprinting = !!input.sprint && (input.forward) && !this.sneaking && !this.inWater;

    // Desired horizontal direction in world space from yaw.
    let ix = 0, iz = 0;
    if (input.forward) iz -= 1;
    if (input.back) iz += 1;
    if (input.left) ix -= 1;
    if (input.right) ix += 1;
    const len = Math.hypot(ix, iz) || 1;
    ix /= len; iz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // World-space move dir must match the rendered view. three.js's YXZ euler
    // (camera.rotation.set(pitch,yaw,0,'YXZ')) makes the camera look along
    // (-sin(yaw), -cos(yaw)), so forward (iz=-1) has to map there too — i.e.
    // rotate the input (ix,iz) by -yaw, not +yaw.
    const wx = ix * cos + iz * sin;
    const wz = -ix * sin + iz * cos;

    let speed = WALK_SPEED;
    if (this.flying) speed = FLY_SPEED;
    else if (this.inWater) speed = SWIM_SPEED;
    else if (this.sprinting) speed = SPRINT_SPEED;
    else if (this.sneaking) speed = SNEAK_SPEED;

    if (this.flying) {
      // Direct velocity control, no gravity.
      this.vel.x = wx * speed;
      this.vel.z = wz * speed;
      let vy = 0;
      if (input.jump) vy += 1;
      if (input.sneak) vy -= 1;
      this.vel.y = vy * speed;
    } else if (this.inWater) {
      // Swim: buoyant, draggy.
      const accel = speed * 8;
      this.vel.x += wx * accel * dt;
      this.vel.z += wz * accel * dt;
      this.vel.x *= 0.82; this.vel.z *= 0.82;
      this.vel.y -= GRAVITY * 0.28 * dt;      // reduced gravity
      this.vel.y *= 0.86;                       // water drag
      if (input.jump) this.vel.y += speed * 3.2 * dt + 0.08; // swim up / stay afloat
      if (this.vel.y < -3) this.vel.y = -3;
    } else {
      // Ground/air movement: exponentially approach the target velocity.
      // Framerate-independent (uses dt in the rate) so steady-state horizontal
      // speed equals `speed`, and ground has tighter control than air.
      const tvx = wx * speed, tvz = wz * speed;
      const rate = this.onGround ? 14 : 3.5;   // approach rate, per second
      const k = 1 - Math.exp(-rate * dt);
      this.vel.x += (tvx - this.vel.x) * k;
      this.vel.z += (tvz - this.vel.z) * k;

      this.vel.y -= GRAVITY * dt;
      if (input.jump && this.onGround) { this.vel.y = JUMP_VEL; this.onGround = false; }
    }

    // Track fall for damage.
    if (!this.flying && !this.inWater) {
      if (!this.onGround && this.vel.y < 0 && this.fallStart === null) this.fallStart = this.pos.y;
    } else { this.fallStart = null; }

    // Integrate with per-axis collision resolution.
    const wasGround = this.onGround;
    this.onGround = false;
    // Sneak edge-guard: while sneaking on the ground, veto any horizontal move
    // that would leave the player standing over a gap (classic MC ledge-guard).
    const sneakGuard = this.sneaking && wasGround && !this.flying && !this.inWater;
    const preX = this.pos.x;
    this._moveAxis('x', this.vel.x * dt);
    if (sneakGuard && !this._overGround()) { this.pos.x = preX; this.vel.x = 0; }
    const preZ = this.pos.z;
    this._moveAxis('z', this.vel.z * dt);
    if (sneakGuard && !this._overGround()) { this.pos.z = preZ; this.vel.z = 0; }
    const hitY = this._moveAxis('y', this.vel.y * dt);

    if (hitY === 'down') {
      // Landed.
      if (this.fallStart !== null && !this.inWater) {
        const dist = this.fallStart - this.pos.y;
        if (dist > 3) events.landedDamage = Math.floor(dist - 3);
        if (dist > 0.5) events.stepBlock = this._groundBlock();
      }
      this.fallStart = null;
      this.onGround = true;
    }

    return events;
  }

  _groundBlock() { return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z)); }

  // Move along one axis by d, resolving collision. Returns 'up'|'down'|'x'|'z'|null on contact.
  _moveAxis(axis, d) {
    if (d === 0) return null;
    const p = this.pos;
    const np = { x: p.x, y: p.y, z: p.z };
    np[axis] += d;
    if (!this._collides(np.x, np.y, np.z)) { p[axis] = np[axis]; return null; }
    // Collided: step toward contact in small increments.
    const step = d > 0 ? 0.01 : -0.01;
    let moved = 0;
    while (Math.abs(moved) < Math.abs(d)) {
      const test = { x: p.x, y: p.y, z: p.z };
      test[axis] += moved + step;
      if (this._collides(test.x, test.y, test.z)) break;
      moved += step;
    }
    p[axis] += moved;
    // Zero the velocity on this axis.
    this.vel[axis] = 0;
    if (axis === 'y') return d < 0 ? 'down' : 'up';
    return axis;
  }

  // Is any part of the player's footprint standing over solid ground?
  _overGround() {
    const y = Math.floor(this.pos.y - 0.05);
    const under = (x, z) => this._solid(Math.floor(x), y, Math.floor(z));
    return under(this.pos.x - HW, this.pos.z - HW) || under(this.pos.x + HW, this.pos.z - HW) ||
           under(this.pos.x - HW, this.pos.z + HW) || under(this.pos.x + HW, this.pos.z + HW) ||
           under(this.pos.x, this.pos.z);
  }
}

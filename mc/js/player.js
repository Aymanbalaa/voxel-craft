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
    // forward is -Z rotated by yaw
    const wx = ix * cos - iz * sin;
    const wz = ix * sin + iz * cos;

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
      // Ground/air movement with acceleration + friction.
      const control = this.onGround ? 1 : 0.28; // less air control
      const accel = speed * 10 * control;
      this.vel.x += wx * accel * dt;
      this.vel.z += wz * accel * dt;
      const friction = this.onGround ? 0.72 : 0.92;
      this.vel.x *= friction; this.vel.z *= friction;
      // Clamp horizontal speed.
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const max = speed;
      if (hs > max) { this.vel.x = this.vel.x / hs * max; this.vel.z = this.vel.z / hs * max; }

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
    this._moveAxis('x', this.vel.x * dt);
    this._moveAxis('z', this.vel.z * dt);
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

    // Sneak edge-guard: if on ground and sneaking, don't walk off ledges.
    if (this.sneaking && wasGround) this._sneakEdgeGuard();

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

  // Prevent walking off edges while sneaking (classic MC ledge-guard).
  _sneakEdgeGuard() {
    // If there's no ground under the full footprint after the move, roll back to over-ground.
    const under = (x, z) => this._solid(Math.floor(x), Math.floor(this.pos.y - 0.05), Math.floor(z));
    const grounded = under(this.pos.x - HW, this.pos.z - HW) || under(this.pos.x + HW, this.pos.z - HW) ||
                     under(this.pos.x - HW, this.pos.z + HW) || under(this.pos.x + HW, this.pos.z + HW) ||
                     under(this.pos.x, this.pos.z);
    if (!grounded) {
      // We only reach here if a previous ground existed; nudge back handled by zeroing velocity.
      this.vel.x = 0; this.vel.z = 0;
    }
  }
}

// Survival state: health, hunger, saturation, exhaustion, regen, starvation.
// Movement feeds exhaustion; full hunger heals; empty hunger starves (floored at
// 1 HP so you can't die of hunger — falls/mobs/lava still kill).

import { MAX_HEALTH, MAX_HUNGER } from './config.js';
import { foodValue } from './items.js';

export class Survival {
  constructor() {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 5;
    this.exhaustion = 0;
    this._regen = 0;
    this._starve = 0;
    this._hurtCooldown = 0;
    this.dead = false;
  }

  reset() {
    this.health = MAX_HEALTH; this.hunger = MAX_HUNGER; this.saturation = 5;
    this.exhaustion = 0; this._regen = 0; this._starve = 0; this._hurtCooldown = 0; this.dead = false;
  }

  addExhaustion(v) { this.exhaustion += v; }

  hurt(dmg) {
    if (this.dead || this._hurtCooldown > 0) return false;
    this.health = Math.max(0, this.health - dmg);
    this._hurtCooldown = 0.5;
    if (this.health <= 0) this.dead = true;
    return true;
  }

  heal(v) { this.health = Math.min(MAX_HEALTH, this.health + v); }

  // Eat a food item id. Returns true if consumed.
  eat(itemId) {
    const f = foodValue(itemId);
    if (!f || this.hunger >= MAX_HUNGER) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + f.hunger);
    this.saturation = Math.min(this.hunger, this.saturation + f.saturation);
    return true;
  }

  update(dt, player) {
    if (this._hurtCooldown > 0) this._hurtCooldown -= dt;

    // Movement-based exhaustion.
    const hv = Math.hypot(player.vel.x, player.vel.z);
    if (!player.flying) {
      if (player.sprinting) this.exhaustion += hv * dt * 0.1;
      else this.exhaustion += hv * dt * 0.01;
    }

    // Convert exhaustion into hunger/saturation loss.
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }

    // Natural regen when well fed.
    if (this.hunger >= 18 && this.health < MAX_HEALTH) {
      this._regen += dt;
      if (this._regen >= 3.5) { this._regen = 0; this.heal(1); this.exhaustion += 3; }
    } else this._regen = 0;

    // Starvation (floored at 1 HP).
    if (this.hunger <= 0) {
      this._starve += dt;
      if (this._starve >= 4) { this._starve = 0; if (this.health > 1) this.health -= 1; }
    } else this._starve = 0;

    if (this.health <= 0) this.dead = true;
  }
}

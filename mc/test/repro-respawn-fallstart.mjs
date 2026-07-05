// Repro: after respawn, main.js die() resets player.vel but NOT player.fallStart.
// If the player died while airborne (non-fall death: lava/void/mob) with fallStart
// set to a height ABOVE the respawn surface, the stale fallStart causes phantom
// fall damage on the very first landing after respawn.
import { Player } from '../js/player.js';

// Flat world: solid stone (id 1) for y<=64, air above.
const world = {
  getBlock(x, y, z) {
    if (y < 0 || y >= 128) return 0;
    return y <= 64 ? 1 : 0; // 1=STONE (collidable), 0=AIR
  },
};

// Respawn surface: top solid block is y=64, so feet spawn at 65.02 (dropToGround: y+1.02).
function makePlayer() {
  const p = new Player(world, { x: 8.5, y: 65.02, z: 8.5 });
  return p;
}

const STEP = 1 / 60;
const EMPTY = { forward:0, back:0, left:0, right:0, jump:0, sneak:0, sprint:0 };

function simulateLanding(p) {
  let dmg = 0;
  for (let i = 0; i < 200; i++) {
    const e = p.update(STEP, EMPTY);
    if (e.landedDamage > 0) { dmg = e.landedDamage; break; }
    if (p.onGround) break;
  }
  return dmg;
}

// --- Case A: buggy respawn — fallStart left stale from an airborne death at y=110.
const a = makePlayer();
a.onGround = false;         // was airborne at death
a.vel = { x: 0, y: 0, z: 0 }; // die() zeroes velocity
a.fallStart = 110;          // stale: died mid-air after falling from y=110 (NOT reset by die())
const dmgA = simulateLanding(a);
console.log('Case A (stale fallStart=110, respawn y=65): landedDamage =', dmgA);

// --- Case B: fixed respawn — fallStart reset to null (proposed fix).
const b = makePlayer();
b.onGround = false;
b.vel = { x: 0, y: 0, z: 0 };
b.fallStart = null;         // fix
const dmgB = simulateLanding(b);
console.log('Case B (fallStart=null, respawn y=65): landedDamage =', dmgB);

console.log(dmgA > 0 && dmgB === 0
  ? 'CONFIRMED BUG: stale fallStart inflicts phantom fall damage on respawn; resetting it fixes it.'
  : 'no repro');

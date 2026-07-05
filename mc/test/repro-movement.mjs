// Repro: measure steady-state horizontal speed vs configured speeds.
import { Player } from '../js/player.js';
import { B } from '../js/blocks.js';
import { WALK_SPEED, SPRINT_SPEED } from '../js/config.js';

// Flat world: solid stone below y=50, air above.
const world = { getBlock(x, y, z) { return y < 50 ? B.STONE : B.AIR; } };

function measure({ sprint = false } = {}) {
  const p = new Player(world, { x: 8, y: 50, z: 8 });
  const input = { forward: true, back: false, left: false, right: false, jump: false, sneak: false, sprint };
  const STEP = 1 / 60;
  // Let it settle onto the ground first.
  for (let i = 0; i < 30; i++) p.update(STEP, { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false });
  let hs = 0;
  for (let i = 0; i < 300; i++) { p.update(STEP, input); hs = Math.hypot(p.vel.x, p.vel.z); }
  return { hs, onGround: p.onGround };
}

const walk = measure({ sprint: false });
const sprintR = measure({ sprint: true });

console.log('WALK_SPEED (target)  =', WALK_SPEED.toFixed(3), 'blocks/s');
console.log('walk steady-state    =', walk.hs.toFixed(3), 'blocks/s  ->', (100 * walk.hs / WALK_SPEED).toFixed(0) + '% of target', 'onGround=' + walk.onGround);
console.log('SPRINT_SPEED (target)=', SPRINT_SPEED.toFixed(3), 'blocks/s');
console.log('sprint steady-state  =', sprintR.hs.toFixed(3), 'blocks/s  ->', (100 * sprintR.hs / SPRINT_SPEED).toFixed(0) + '% of target');

// Air control: jump and hold forward, measure air speed vs ground speed.
{
  const p = new Player(world, { x: 8, y: 50, z: 8 });
  const STEP = 1 / 60;
  const noIn = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };
  for (let i = 0; i < 30; i++) p.update(STEP, noIn);
  // build ground speed
  const fwd = { ...noIn, forward: true };
  for (let i = 0; i < 200; i++) p.update(STEP, fwd);
  const groundHS = Math.hypot(p.vel.x, p.vel.z);
  // jump then keep forward held; sample airborne
  let airHS = 0, samples = 0;
  const fwdJump = { ...fwd, jump: true };
  for (let i = 0; i < 120; i++) {
    p.update(STEP, fwdJump);
    if (!p.onGround) { airHS = Math.hypot(p.vel.x, p.vel.z); samples++; }
  }
  console.log('\nground HS =', groundHS.toFixed(3), ' last-air HS =', airHS.toFixed(3), '(air should be <= ground)');
}

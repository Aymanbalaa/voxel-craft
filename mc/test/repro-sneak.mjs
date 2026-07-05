// Repro: sneaking toward a ledge should NOT let the player fall off.
import { Player } from '../js/player.js';
import { B } from '../js/blocks.js';

// Ground: solid stone floor occupying y=0 for x in [0,6) (blocks x=0..5), air beyond.
const world = {
  getBlock(x, y, z) {
    if (y === 0 && x >= 0 && x <= 5) return B.STONE;
    return B.AIR;
  },
};

const STEP = 1 / 60;
const noIn = { forward:false, back:false, left:false, right:false, jump:false, sneak:false, sprint:false };

function run(sneak) {
  const p = new Player(world, { x: 5.0, y: 1.0, z: 0.5 });
  // settle onto ground
  for (let i = 0; i < 20; i++) p.update(STEP, noIn);
  const startY = p.pos.y;
  // walk toward +x (the cliff) while (optionally) sneaking
  const input = { ...noIn, right: true, sneak };
  let minY = p.pos.y;
  for (let i = 0; i < 240; i++) {
    p.update(STEP, input);
    minY = Math.min(minY, p.pos.y);
  }
  return { x: p.pos.x, y: p.pos.y, startY, minY, onGround: p.onGround };
}

const walk = run(false);
const sneak = run(true);
console.log('no-sneak: end x=%s y=%s minY=%s onGround=%s', walk.x.toFixed(2), walk.y.toFixed(2), walk.minY.toFixed(2), walk.onGround);
console.log('sneaking: end x=%s y=%s minY=%s onGround=%s', sneak.x.toFixed(2), sneak.y.toFixed(2), sneak.minY.toFixed(2), sneak.onGround);
// Edge of ground is x=6. Sneaking should keep the player on the ledge (y stays ~1, x < ~5.8).
if (sneak.y < sneak.startY - 0.5)
  console.log('BUG CONFIRMED: player fell off the ledge while sneaking (y dropped from', sneak.startY.toFixed(2), 'to', sneak.y.toFixed(2) + ')');
else
  console.log('OK: sneaking kept the player on the ledge');

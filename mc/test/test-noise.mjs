// Node smoke tests for noise.js — determinism, range, fbm behavior.
import { Noise } from '../js/noise.js';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  FAIL:', msg); } }

// 1. Determinism: same seed → identical sequence.
{
  const a = new Noise('hello'), b = new Noise('hello');
  let same = true;
  for (let i = 0; i < 1000; i++) {
    const x = i * 0.13, y = i * 0.07;
    if (a.simplex2(x, y) !== b.simplex2(x, y)) { same = false; break; }
    if (a.simplex3(x, y, x - y) !== b.simplex3(x, y, x - y)) { same = false; break; }
  }
  ok(same, 'same seed produces identical noise');
}

// 2. Different seeds → different output.
{
  const a = new Noise(1), b = new Noise(2);
  let diff = false;
  for (let i = 0; i < 100; i++) if (Math.abs(a.simplex2(i * 0.1, 3.3) - b.simplex2(i * 0.1, 3.3)) > 1e-9) { diff = true; break; }
  ok(diff, 'different seeds produce different noise');
}

// 3. Range: simplex2/3 stay within [-1.05, 1.05].
{
  const n = new Noise(42);
  let min2 = 1e9, max2 = -1e9, min3 = 1e9, max3 = -1e9;
  for (let i = 0; i < 20000; i++) {
    const x = (i * 12.9898) % 100, y = (i * 78.233) % 100, z = (i * 37.719) % 100;
    const v2 = n.simplex2(x, y), v3 = n.simplex3(x, y, z);
    min2 = Math.min(min2, v2); max2 = Math.max(max2, v2);
    min3 = Math.min(min3, v3); max3 = Math.max(max3, v3);
  }
  ok(min2 >= -1.05 && max2 <= 1.05, `simplex2 range [${min2.toFixed(3)}, ${max2.toFixed(3)}]`);
  ok(min3 >= -1.05 && max3 <= 1.05, `simplex3 range [${min3.toFixed(3)}, ${max3.toFixed(3)}]`);
  ok(min2 < -0.5 && max2 > 0.5, 'simplex2 uses a wide range');
}

// 4. fbm2 within range and continuous (small step → small change).
{
  const n = new Noise(7);
  let maxJump = 0;
  let prev = n.fbm2(0, 0, 4);
  for (let i = 1; i < 500; i++) {
    const v = n.fbm2(i * 0.01, 0, 4);
    maxJump = Math.max(maxJump, Math.abs(v - prev));
    prev = v;
    ok(v >= -1.01 && v <= 1.01, 'fbm2 in range') || i;
  }
  ok(maxJump < 0.2, `fbm2 is continuous (max step ${maxJump.toFixed(4)})`);
}

// 5. ridged2 in [0,1].
{
  const n = new Noise(9);
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < 5000; i++) { const v = n.ridged2(i * 0.02, i * 0.017, 4); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok(lo >= 0 && hi <= 1.01, `ridged2 range [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
}

// 6. derive() gives an independent but deterministic stream.
{
  const a = new Noise(100).derive('caves');
  const b = new Noise(100).derive('caves');
  const c = new Noise(100).derive('ore');
  ok(a.simplex2(1.5, 2.5) === b.simplex2(1.5, 2.5), 'derive is deterministic');
  ok(a.simplex2(1.5, 2.5) !== c.simplex2(1.5, 2.5), 'different salts diverge');
}

console.log(`\nnoise: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

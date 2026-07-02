// VoxelCraft - js/noise.js
// Classic script (no ES modules). Attaches the global class `Noise` to window.
//
// Self-contained 2D Perlin noise with a seeded permutation table so that the
// output is fully deterministic for a given numeric seed. No external deps.
//
// API (per CONTRACT.md):
//   new Noise(seed)            - number seed, deterministic.
//   noise.noise2D(x, y)        - returns a value in [-1, 1], smooth.
//   noise.noise3D(x, y, z)     - optional 3D Perlin, also in [-1, 1].

(function (global) {
  'use strict';

  // ----- Seeded PRNG (Mulberry32) -------------------------------------------
  // Produces a deterministic stream of [0,1) floats from a 32-bit seed. Used to
  // shuffle the permutation table so each seed yields a stable, unique field.
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smootherstep (Perlin's improved fade curve): 6t^5 - 15t^4 + 10t^3.
  function fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Linear interpolation.
  function lerp(a, b, t) {
    return a + t * (b - a);
  }

  // 2D gradient: dot product of a pseudo-randomly chosen gradient direction
  // (selected by the low bits of the hash) with the distance vector (x, y).
  function grad2(hash, x, y) {
    // Use 8 evenly spread gradient directions around the unit circle.
    switch (hash & 7) {
      case 0: return  x + y;
      case 1: return  x - y;
      case 2: return -x + y;
      case 3: return -x - y;
      case 4: return  x;
      case 5: return -x;
      case 6: return  y;
      default: return -y;
    }
  }

  // 3D gradient (classic Perlin 12-edge gradient set).
  function grad3(hash, x, y, z) {
    var h = hash & 15;
    var u = h < 8 ? x : y;
    var v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  function Noise(seed) {
    // Normalize the seed to a 32-bit integer; default to a fixed value so an
    // omitted seed is still deterministic.
    var s = (typeof seed === 'number' && isFinite(seed)) ? (seed | 0) : 1337;
    var rand = mulberry32(s >>> 0);

    // Build a base permutation of 0..255.
    var p = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i++) {
      p[i] = i;
    }
    // Fisher-Yates shuffle driven by the seeded PRNG.
    for (i = 255; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }

    // Doubled permutation table (512 entries) to avoid index wrapping logic.
    this.perm = new Uint8Array(512);
    for (i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
    this.seed = s;
  }

  // 2D Perlin noise. Raw Perlin output for the 8-direction gradient set sits
  // roughly within [-1, 1]; we clamp defensively so the contract bound holds.
  Noise.prototype.noise2D = function (x, y) {
    var perm = this.perm;

    var X = Math.floor(x) & 255;
    var Y = Math.floor(y) & 255;

    var xf = x - Math.floor(x);
    var yf = y - Math.floor(y);

    var u = fade(xf);
    var v = fade(yf);

    // Hash the four cell corners.
    var aa = perm[perm[X] + Y];
    var ab = perm[perm[X] + Y + 1];
    var ba = perm[perm[X + 1] + Y];
    var bb = perm[perm[X + 1] + Y + 1];

    // Blend the gradient contributions of the four corners.
    var x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    var x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    var value = lerp(x1, x2, v);

    // Clamp to the contracted range.
    if (value > 1) value = 1;
    else if (value < -1) value = -1;
    return value;
  };

  // 3D Perlin noise, returned in [-1, 1].
  Noise.prototype.noise3D = function (x, y, z) {
    var perm = this.perm;

    var X = Math.floor(x) & 255;
    var Y = Math.floor(y) & 255;
    var Z = Math.floor(z) & 255;

    var xf = x - Math.floor(x);
    var yf = y - Math.floor(y);
    var zf = z - Math.floor(z);

    var u = fade(xf);
    var v = fade(yf);
    var w = fade(zf);

    var A = perm[X] + Y;
    var AA = perm[A] + Z;
    var AB = perm[A + 1] + Z;
    var B = perm[X + 1] + Y;
    var BA = perm[B] + Z;
    var BB = perm[B + 1] + Z;

    var value = lerp(
      lerp(
        lerp(grad3(perm[AA], xf, yf, zf), grad3(perm[BA], xf - 1, yf, zf), u),
        lerp(grad3(perm[AB], xf, yf - 1, zf), grad3(perm[BB], xf - 1, yf - 1, zf), u),
        v
      ),
      lerp(
        lerp(grad3(perm[AA + 1], xf, yf, zf - 1), grad3(perm[BA + 1], xf - 1, yf, zf - 1), u),
        lerp(grad3(perm[AB + 1], xf, yf - 1, zf - 1), grad3(perm[BB + 1], xf - 1, yf - 1, zf - 1), u),
        v
      ),
      w
    );

    if (value > 1) value = 1;
    else if (value < -1) value = -1;
    return value;
  };

  // Expose as a global per the contract.
  global.Noise = Noise;
})(window);

# Texture Visual Upgrade — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `mc/js/textures.js`'s noisy procedural atlas with a crisp, faithful-vanilla 16px atlas built from a tile registry, seamless v2 generators, and an optional PNG-override layer, without touching the mesher.

**Architecture:** Split the monolithic `textures.js` into a **tile registry** (name → generator fn, single source of truth for all 112 tiles) and **v2 generators** (pure, seeded, wrap-aware canvas draws restricted to a `fillStyle`/`fillRect`/`clearRect` subset so they also run under a Node mock canvas). `buildAtlas()` becomes **async**: for each tile it tries `fetch('assets/textures/<name>.png')` and composites the PNG if present, else runs the generator. Boot awaits the atlas before the first mesh.

**Tech Stack:** Vanilla ES modules, HTML5 Canvas 2D, THREE.CanvasTexture, Node ESM tests (no test framework — hand-rolled `ok()` counters), puppeteer-core for headless screenshots.

## Global Constraints

- Resolution: **16×16** tiles, **16 cols**, 256×256 atlas — unchanged (copied from spec).
- **Zero external assets required**: an empty `assets/textures/` must boot fully procedurally; PNG fetch failure = silent fallback.
- **Do NOT touch the mesher** (`mesher.js`) or materials — water transparency / biome tint / leaf cutout are Phase 2.
- Determinism: mulberry32 PRNG reseeded per-tile (`0xC0FFEE + idx*101`) so the atlas is byte-identical across runs.
- The existing **590-test suite stays green**. Tile **names and index order** in the registry must exactly match the current `paintAll` order (mesher/items index tiles by name via `TILES`).
- Generators v2 may only call: `ctx.fillStyle=`, `ctx.fillRect`, `ctx.clearRect`, `ctx.save/restore/translate`, `ctx.imageSmoothingEnabled`. No `strokeRect`, `drawImage`, `getImageData` inside generators (keeps them Node-mockable). Compositing/blitting helpers may still use the full API — they run browser-only.

---

## File Structure

- `mc/js/texture-registry.js` — **new**. Exports `REGISTRY` (ordered array of `{name, gen}`), `TILES` (name→index), the mulberry32 PRNG factory, and shared pixel helpers (`px`, `fillTile`, `clearTile`, `clamp8`, wrap-aware `vnoise`). Pure — no `document`, importable in Node.
- `mc/js/texture-generators.js` — **new**. All v2 `gen(ctx, rng)` draw functions. Pure, restricted API. Imports helpers from registry.
- `mc/js/textures.js` — **modified**. Keeps `makeIcon`/blit/iso helpers (browser-only). `buildAtlas()` becomes `async`, iterates `REGISTRY`, composites PNG-or-generator. Re-exports `TILES`.
- `mc/js/main.js:46` — **modified**. `const atlas = await buildAtlas();` (boot already runs inside an async context — verify).
- `mc/assets/textures/.gitkeep` — **new**. Empty override folder (documented).
- `mc/test/mock-canvas.mjs` — **new**. Minimal 2D-context mock that records a 16×16 RGBA buffer from `fillRect`/`clearRect`.
- `mc/test/test-atlas.mjs` — **new**. Registry completeness, determinism, seam, and override-selection tests.
- `mc/README.md` — **modified**. Note on dropping a PNG pack into `assets/textures/`.

---

### Task 1: Tile registry module (names + index order preserved)

**Files:**
- Create: `mc/js/texture-registry.js`
- Test: `mc/test/test-atlas.mjs`
- Create: `mc/test/mock-canvas.mjs`

**Interfaces:**
- Produces: `export const REGISTRY` — `Array<{name: string, gen: (ctx, rng) => void}>` in exact current index order. `export const TILES` — `{[name]: index}`. `export function mulberry32(seed): () => number`. `export function makeRng(idx): () => number` (= `mulberry32(0xC0FFEE + idx*101)`). Pixel helpers `px(ctx,x,y,r,g,b,a=255)`, `fillTile(ctx,r,g,b,a=255)`, `clearTile(ctx)`, `clamp8(v)`.
- Consumes: generator fns from Task 2 (import them here to populate REGISTRY). For Task 1's failing test, stub every `gen` as `fillTile(ctx, 0,0,0)` so the module is complete and importable before Task 2 lands; Task 2 replaces the stubs.

- [ ] **Step 1: Write the mock canvas** (`mc/test/mock-canvas.mjs`)

```js
// Minimal 2D-context mock: records a 16x16 RGBA buffer from the restricted
// generator API (fillStyle/fillRect/clearRect + save/restore/translate).
export function makeMockCtx(size = 16) {
  const buf = new Uint8ClampedArray(size * size * 4); // rgba, starts transparent
  let cur = [0, 0, 0, 255];
  const parse = (s) => {
    let m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s);
    if (m) return [(+m[1]) | 0, (+m[2]) | 0, (+m[3]) | 0, m[4] !== undefined ? Math.round(+m[4] * 255) : 255];
    return [0, 0, 0, 255];
  };
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (a >= 255) { buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = 255; }
    else if (a <= 0) { /* no-op paint */ }
    else { // src-over
      const af = a / 255, ia = 1 - af;
      buf[i] = r*af + buf[i]*ia; buf[i+1] = g*af + buf[i+1]*ia;
      buf[i+2] = b*af + buf[i+2]*ia; buf[i+3] = Math.max(buf[i+3], a);
    }
  };
  const ctx = {
    imageSmoothingEnabled: false,
    set fillStyle(s) { cur = parse(s); }, get fillStyle() { return cur; },
    fillRect(x, y, w, h) {
      for (let yy = y | 0; yy < (y + h) | 0; yy++)
        for (let xx = x | 0; xx < (x + w) | 0; xx++) set(xx, yy, cur[0], cur[1], cur[2], cur[3]);
    },
    clearRect(x, y, w, h) {
      for (let yy = y | 0; yy < (y + h) | 0; yy++)
        for (let xx = x | 0; xx < (x + w) | 0; xx++) {
          const i = (yy * size + xx) * 4; buf[i] = buf[i+1] = buf[i+2] = buf[i+3] = 0;
        }
    },
    save() {}, restore() {}, translate() {},
  };
  return { ctx, buf, size, at: (x, y) => { const i = (y*size + x)*4; return [buf[i], buf[i+1], buf[i+2], buf[i+3]]; } };
}
```

- [ ] **Step 2: Write the failing registry test** (`mc/test/test-atlas.mjs`)

```js
import { REGISTRY, TILES, makeRng } from '../js/texture-registry.js';
import { makeMockCtx } from './mock-canvas.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('  FAIL:', m); } };

// Every tile the game references must exist, in a stable order.
const EXPECTED = ['stone','grass_top','grass_side','grass_snow_side','dirt','cobblestone',
  'oak_planks','birch_planks','spruce_planks','bedrock','sand','gravel','water','lava',
  'oak_log','oak_log_top','birch_log','birch_log_top','spruce_log','spruce_log_top',
  'oak_leaves','birch_leaves','spruce_leaves','glass','coal_ore','iron_ore','gold_ore',
  'diamond_ore','redstone_ore','snow','ice','sandstone','sandstone_top','sandstone_bottom',
  'cactus_top','cactus_bottom','cactus_side','tall_grass','dead_bush','dandelion','poppy',
  'mushroom_brown','mushroom_red','torch','crafting_table_top','crafting_table_side',
  'furnace_top','furnace_side','furnace_front','stone_bricks','mossy_cobblestone','obsidian',
  'glowstone','bricks','bookshelf','wool','clay','dirt_path_top','dirt_path_side',
  'pumpkin_top','pumpkin_side','pumpkin_face','melon_top','melon_side'];

ok(REGISTRY.length >= 112, `registry has >=112 tiles (got ${REGISTRY.length})`);
for (let i = 0; i < EXPECTED.length; i++)
  ok(REGISTRY[i].name === EXPECTED[i], `tile ${i} is ${EXPECTED[i]} (got ${REGISTRY[i]?.name})`);
for (const n of EXPECTED) ok(typeof TILES[n] === 'number', `TILES has ${n}`);
ok(TILES.unknown !== undefined, 'TILES has unknown');

// Determinism: same seed → identical buffer.
const draw = (name) => {
  const idx = TILES[name]; const { ctx, buf } = makeMockCtx();
  REGISTRY[idx].gen(ctx, makeRng(idx)); return buf;
};
const a = draw('stone'), b = draw('stone');
ok(a.every((v, i) => v === b[i]), 'stone generator is deterministic');

console.log(`test-atlas registry: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node mc/test/test-atlas.mjs`
Expected: FAIL — `Cannot find module '../js/texture-registry.js'`.

- [ ] **Step 4: Write the registry with stubbed generators**

```js
// mc/js/texture-registry.js — pure, Node-importable. No `document`.
export const TILE = 16, COLS = 16, ATLAS_PX = TILE * COLS;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const makeRng = (idx) => mulberry32(0xC0FFEE + idx * 101);
export const clamp8 = (v) => Math.max(0, Math.min(255, v | 0));
export function px(ctx, x, y, r, g, b, a = 255) {
  ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`; ctx.fillRect(x, y, 1, 1);
}
export function fillTile(ctx, r, g, b, a = 255) {
  ctx.fillStyle = `rgba(${r},${g},${b},${a / 255})`; ctx.fillRect(0, 0, TILE, TILE);
}
export function clearTile(ctx) { ctx.clearRect(0, 0, TILE, TILE); }

// Wrap-aware value noise: hashing on (x&15,y&15) guarantees seamless tiling.
export function vnoise(rng) {
  const grid = new Float32Array(TILE * TILE);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  return (x, y) => grid[((y & 15) * TILE) + (x & 15)];
}

// --- Ordered tile table. Generators injected by texture-generators.js. ---
// Until Task 2, every gen is a black-fill stub so the module imports cleanly.
const stub = (ctx) => fillTile(ctx, 0, 0, 0);
export const REGISTRY = [
  'stone','grass_top','grass_side','grass_snow_side','dirt','cobblestone',
  'oak_planks','birch_planks','spruce_planks','bedrock','sand','gravel','water','lava',
  'oak_log','oak_log_top','birch_log','birch_log_top','spruce_log','spruce_log_top',
  'oak_leaves','birch_leaves','spruce_leaves','glass','coal_ore','iron_ore','gold_ore',
  'diamond_ore','redstone_ore','snow','ice','sandstone','sandstone_top','sandstone_bottom',
  'cactus_top','cactus_bottom','cactus_side','tall_grass','dead_bush','dandelion','poppy',
  'mushroom_brown','mushroom_red','torch','crafting_table_top','crafting_table_side',
  'furnace_top','furnace_side','furnace_front','stone_bricks','mossy_cobblestone','obsidian',
  'glowstone','bricks','bookshelf','wool','clay','dirt_path_top','dirt_path_side',
  'pumpkin_top','pumpkin_side','pumpkin_face','melon_top','melon_side',
  // item icons (kept from current paintAll order)
  'stick','coal','charcoal','iron_ingot','gold_ingot','diamond','apple','bread','wheat',
  'porkchop','cooked_porkchop','string','bowl','clay_ball','brick_item','flint','leather',
  'bone','gunpowder','paper','book','shears',
  'wooden_pickaxe','wooden_axe','wooden_shovel','wooden_sword','wooden_hoe',
  'stone_pickaxe','stone_axe','stone_shovel','stone_sword','stone_hoe',
  'iron_pickaxe','iron_axe','iron_shovel','iron_sword','iron_hoe',
  'gold_pickaxe','gold_axe','gold_shovel','gold_sword','gold_hoe',
  'diamond_pickaxe','diamond_axe','diamond_shovel','diamond_sword','diamond_hoe',
  'unknown',
].map((name) => ({ name, gen: stub }));

export const TILES = {};
REGISTRY.forEach((t, i) => { TILES[t.name] = i; });
```

> NOTE: confirm this name list is byte-identical to the current `paintAll` order in `textures.js:421-545`. The test in Step 2 enforces the first 63; extend `EXPECTED` if any drift.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node mc/test/test-atlas.mjs`
Expected: PASS — `test-atlas registry: N passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add mc/js/texture-registry.js mc/test/test-atlas.mjs mc/test/mock-canvas.mjs
git commit -m "feat(mc): tile registry + Node mock-canvas atlas test scaffold"
```

---

### Task 2: Generators v2 (crisp, seamless, faithful palettes)

**Files:**
- Create: `mc/js/texture-generators.js`
- Modify: `mc/js/texture-registry.js` (import generators, replace stubs)
- Test: `mc/test/test-atlas.mjs` (add seam + no-speck assertions)

**Interfaces:**
- Consumes: `px, fillTile, clearTile, clamp8, vnoise, TILE` from `texture-registry.js`; `rng` passed per-call.
- Produces: `export const GENERATORS` — `{[name]: (ctx, rng) => void}` covering every REGISTRY name. Registry maps each entry's `gen` to `GENERATORS[name]`.

Rewrite priorities (from spec): `grass_top`, `grass_side`, `dirt`, `sand`, `gravel`, `stone`, `cobblestone`, oak/birch/spruce `log`+`planks`, `oak/birch/spruce_leaves`, ores, `tall_grass`, `dandelion`/`poppy`. Others may be ported near-verbatim from current painters (they already read acceptably) but must use only the restricted API and `vnoise` instead of `speckleTile`/`scatterSpecks`.

**Design rules for "crisp, not muddy":**
- Build a small **fixed palette** per material (3–4 shades) and quantize noise into those shades — never per-channel random jitter (that is what reads as mud/speckle).
- All full-face blocks use `vnoise(rng)` sampled at `(x,y)` so the left column (`x=0`) hashes identically to a virtual `x=16` → **seamless**.
- No pure-black / pure-white single pixels on terrain. Edges (grass strip, plank seams) are deliberate, not random.

- [ ] **Step 1: Add the seam + palette test** (append to `mc/test/test-atlas.mjs` before the summary)

```js
import { GENERATORS } from '../js/texture-generators.js';

// Seam test: for tileable full-face blocks, wrap-aware noise must make the
// left edge column continuous with the right (they are neighbors when tiled).
// We assert the generator NEVER samples out-of-tile and that opposite edges
// are correlated: mean abs diff of edge columns is small.
function edgeDelta(name) {
  const idx = TILES[name]; const { ctx, at, size } = makeMockCtx();
  GENERATORS[name](ctx, makeRng(idx));
  let d = 0;
  for (let y = 0; y < size; y++) {
    const L = at(0, y), R = at(size - 1, y);
    d += Math.abs(L[0]-R[0]) + Math.abs(L[1]-R[1]) + Math.abs(L[2]-R[2]);
  }
  return d / size;
}
for (const n of ['grass_top', 'dirt', 'stone', 'sand', 'gravel']) {
  const d = edgeDelta(n);
  ok(d < 60, `${n} edges are seam-safe (mean edge delta ${d.toFixed(1)} < 60)`);
}

// No harsh specks: full-face terrain must not contain pure black or pure white.
function hasHarshSpeck(name) {
  const idx = TILES[name]; const { ctx, buf } = makeMockCtx();
  GENERATORS[name](ctx, makeRng(idx));
  for (let i = 0; i < buf.length; i += 4) {
    const [r,g,b] = [buf[i],buf[i+1],buf[i+2]];
    if (r<8&&g<8&&b<8) return true; if (r>248&&g>248&&b>248) return true;
  }
  return false;
}
for (const n of ['grass_top', 'dirt', 'stone']) ok(!hasHarshSpeck(n), `${n} has no harsh black/white specks`);
```

Also change the registry import test to require real generators: at top of file the import of `GENERATORS` will fail until Step 3.

- [ ] **Step 2: Run to verify it fails**

Run: `node mc/test/test-atlas.mjs`
Expected: FAIL — `Cannot find module '../js/texture-generators.js'`.

- [ ] **Step 3: Write generators v2** (`mc/js/texture-generators.js`)

Representative crisp implementations (write all names; these show the pattern):

```js
import { TILE, px, fillTile, clearTile, clamp8, vnoise } from './texture-registry.js';

// Quantize a 0..1 noise value into one of `shades` (array of [r,g,b]).
const pick = (n, shades) => shades[Math.min(shades.length - 1, (n * shades.length) | 0)];
const paintNoise = (ctx, rng, shades) => {
  const nz = vnoise(rng);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const [r, g, b] = pick(nz(x, y), shades); px(ctx, x, y, r, g, b);
  }
};

const STONE = [[122,122,125],[130,130,133],[138,138,141],[116,116,119]];
const DIRT  = [[122,86,58],[134,96,67],[112,78,52],[128,92,63]];
const GRASS = [[92,148,58],[104,160,66],[84,140,52],[110,168,72]];
const SAND  = [[224,214,168],[214,200,154],[232,222,180],[206,192,146]];
const GRAVEL= [[126,122,118],[110,106,102],[138,134,130],[96,94,92]];

export const GENERATORS = {
  stone: (c, r) => paintNoise(c, r, STONE),
  dirt:  (c, r) => paintNoise(c, r, DIRT),
  sand:  (c, r) => paintNoise(c, r, SAND),
  gravel:(c, r) => paintNoise(c, r, GRAVEL),
  grass_top: (c, r) => paintNoise(c, r, GRASS),
  grass_side: (c, r) => {
    paintNoise(c, r, DIRT);
    const nz = vnoise(r);
    const strip = 3 + ((nz(0, 0) * 2) | 0); // 3–4px organic grass lip
    for (let x = 0; x < TILE; x++) {
      const h = strip + (nz(x, 7) < 0.5 ? 0 : 1);
      for (let y = 0; y < h; y++) { const [rr,gg,bb] = pick(nz(x, y), GRASS); px(c, x, y, rr, gg, bb); }
    }
  },
  // ... birch/spruce logs & planks, leaves (alpha-punched but faithful),
  //     ores (stone base + faithful mineral blobs), tall_grass, flowers, etc.
  // Port remaining names from current painters, restricted API + palettes.
};
```

Then in `texture-registry.js` replace the `.map(... gen: stub)` with:

```js
import { GENERATORS } from './texture-generators.js';
// ... after the name array:
export const REGISTRY = NAMES.map((name) => ({
  name, gen: GENERATORS[name] || ((ctx) => fillTile(ctx, 0, 0, 0)),
}));
```

(Refactor the inline name list into a `const NAMES = [...]` first.)

- [ ] **Step 4: Run the atlas test to verify pass**

Run: `node mc/test/test-atlas.mjs`
Expected: PASS — seam deltas < 60, no harsh specks, determinism holds.

- [ ] **Step 5: Guard: every name has a real generator**

Add assertion: `for (const t of REGISTRY) ok(GENERATORS[t.name], t.name + ' has a v2 generator');` — run, expect PASS (0 stubs).

- [ ] **Step 6: Commit**

```bash
git add mc/js/texture-generators.js mc/js/texture-registry.js mc/test/test-atlas.mjs
git commit -m "feat(mc): crisp seamless v2 texture generators"
```

---

### Task 3: PNG-override loader + async atlas builder

**Files:**
- Modify: `mc/js/textures.js` (async `buildAtlas`, iterate REGISTRY, composite PNG-or-gen; keep `makeIcon`/blit/iso helpers)
- Modify: `mc/js/main.js:46` (`await buildAtlas()`)
- Create: `mc/assets/textures/.gitkeep`
- Test: `mc/test/test-atlas.mjs` (override-selection logic via injectable fetch)

**Interfaces:**
- Consumes: `REGISTRY, TILES, TILE, COLS, ATLAS_PX` from `texture-registry.js`; `GENERATORS` indirectly via REGISTRY.
- Produces: `export async function buildAtlas(): Promise<{canvas, image, TILES, tileSize, cols}>` (shape unchanged, now async, memoized via a shared promise). `export { TILES }`. `makeIcon` unchanged signature but must `await buildAtlas()`-derived cache — see Step 5.
- Produces (testable pure fn): `export function chooseSource(pngImage | null, gen)` returning `'png'|'gen'` — extracted so override logic is unit-testable without a browser.

- [ ] **Step 1: Write failing override-selection test** (append to `test-atlas.mjs`)

```js
import { chooseSource } from '../js/textures.js';
ok(chooseSource({ width: 16, height: 16 }, () => {}) === 'png', 'valid 16x16 PNG wins');
ok(chooseSource(null, () => {}) === 'gen', 'missing PNG falls back to generator');
ok(chooseSource({ width: 8, height: 8 }, () => {}) === 'gen', 'wrong-size PNG rejected');
```

> `textures.js` imports `document`-using code at module top. To keep this Node-importable, move `chooseSource` into `texture-registry.js` (pure) and re-export from `textures.js`, OR guard browser-only code behind functions (not top-level). Prefer: define `chooseSource` in `texture-registry.js`; import test from there. Adjust the import line accordingly.

- [ ] **Step 2: Run to verify it fails**

Run: `node mc/test/test-atlas.mjs`
Expected: FAIL — `chooseSource is not a function` / import error.

- [ ] **Step 3: Add `chooseSource` to `texture-registry.js`**

```js
export function chooseSource(png, _gen) {
  return (png && png.width === TILE && png.height === TILE) ? 'png' : 'gen';
}
```

- [ ] **Step 4: Rewrite `buildAtlas` async in `textures.js`**

```js
import { REGISTRY, TILES, TILE, COLS, ATLAS_PX, chooseSource } from './texture-registry.js';
export { TILES };

// Try to load a 16x16 override PNG. Resolves to an HTMLImageElement or null.
function loadOverride(name) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    // cache-buster off; browser handles 404 via onerror. file:// → onerror → null.
    img.src = `assets/textures/${name}.png`;
  });
}

let cached = null;
export async function buildAtlas() {
  if (cached) return cached;
  const canvas = makeCanvas(ATLAS_PX, ATLAS_PX);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const results = await Promise.allSettled(REGISTRY.map((t) => loadOverride(t.name)));
  REGISTRY.forEach((t, idx) => {
    const col = idx % COLS, row = (idx / COLS) | 0;
    const png = results[idx].status === 'fulfilled' ? results[idx].value : null;
    ctx.save(); ctx.translate(col * TILE, row * TILE);
    if (chooseSource(png, t.gen) === 'png') {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(png, 0, 0, TILE, TILE);
    } else {
      const c = tileCtx-less-inline: t.gen(ctx, makeRng(idx)); // gen draws at translated origin
    }
    ctx.restore();
  });
  cached = { canvas, image: canvas, TILES, tileSize: TILE, cols: COLS };
  return cached;
}
```

> Clean up the pseudo-line: call `t.gen(ctx, makeRng(idx))` directly after translate (generators draw in tile-local 0..15). Import `makeRng` from registry. Remove the old `paintAll`, `allot`, `speckleTile`, `scatterSpecks`, and per-tile painters now living in generators — but KEEP `makeCanvas`, `blitTile`, `getTilePixels`, `drawIsoTop`, `drawIsoFace`, `resolveTile`.

- [ ] **Step 5: Make `makeIcon` await the atlas**

`makeIcon` currently calls `buildAtlas()` synchronously. Since the atlas is now built once at boot and cached, change `makeIcon` to read the **already-built** cache: `export function makeIcon(spec){ if(!cached) throw new Error('buildAtlas() must be awaited before makeIcon'); const atlas = cached; ... }`. Verify all `makeIcon` callers run after boot's `await buildAtlas()` (grep `makeIcon` in `ui.js`/`inventory.js`/`items.js`).

- [ ] **Step 6: Await in boot** (`mc/js/main.js:46`)

```js
const atlas = await buildAtlas();
```
Confirm line 46 is inside an `async` function or top-level module `await` (ES modules allow top-level await). If not, wrap boot in `async`.

- [ ] **Step 7: Create override folder**

```bash
mkdir -p mc/assets/textures && touch mc/assets/textures/.gitkeep
```

- [ ] **Step 8: Run atlas test + full suite**

Run: `node mc/test/test-atlas.mjs` → PASS.
Run every `.mjs` test (see Task 5 command) → 590 still green.

- [ ] **Step 9: Commit**

```bash
git add mc/js/textures.js mc/js/main.js mc/js/texture-registry.js mc/assets/textures/.gitkeep
git commit -m "feat(mc): async atlas builder with per-tile PNG override loader"
```

---

### Task 4: Boot verification + before/after screenshots + PNG-override proof

**Files:**
- Use: `mc/test/shot.mjs`, `mc/test/hero.js`, `mc/test/gameplay.js`
- Temp: a test PNG written into `mc/assets/textures/stone.png`

**Interfaces:** none (verification only).

- [ ] **Step 1: Capture BEFORE (from git stash or prior commit)**

Before starting Task 1, on clean `main`, serve and shoot:
```bash
cd mc && python -m http.server 8177 &   # or existing serve script
node test/shot.mjs test/before-hero.png 6000 test/hero.js
node test/shot.mjs test/before-gameplay.png 6000 test/gameplay.js
```
(If BEFORE wasn't captured first, `git stash` the branch, shoot, `git stash pop`.)

- [ ] **Step 2: Capture AFTER (procedural, zero PNGs)**

```bash
node test/shot.mjs test/after-hero.png 6000 test/hero.js
node test/shot.mjs test/after-gameplay.png 6000 test/gameplay.js
```
Expected: no console errors in shot.mjs output; grass/dirt/logs visibly crisper.

- [ ] **Step 3: Prove PNG override**

Write a solid magenta 16×16 `mc/assets/textures/stone.png`, reshoot:
```bash
node test/shot.mjs test/override-stone.png 6000 test/gameplay.js
```
Expected: stone blocks render solid magenta → override path works. Then delete the PNG and re-verify procedural.

- [ ] **Step 4: Deliver screenshots** to the user (before/after hero + gameplay, override proof).

- [ ] **Step 5: Commit screenshots** (optional, to `mc/screenshots/`)

```bash
git add mc/screenshots/*.png && git commit -m "docs(mc): before/after texture upgrade screenshots"
```

---

### Task 5: README note + full-suite green gate

**Files:**
- Modify: `mc/README.md`

- [ ] **Step 1: Add texture-pack note to README**

Document: drop 16×16 PNGs named `<tile>.png` into `mc/assets/textures/`; any present PNG overrides that tile, missing = procedural fallback; list a few tile names (`grass_top.png`, `stone.png`, `oak_log.png`).

- [ ] **Step 2: Run the entire test suite**

```bash
cd mc && for f in test/test-*.mjs test/repro-*.mjs test/persist.mjs; do echo "== $f =="; node "$f" || exit 1; done
```
Expected: every file reports `0 failed`; aggregate ≥ 590 assertions incl. new atlas tests.

- [ ] **Step 3: Commit**

```bash
git add mc/README.md && git commit -m "docs(mc): document assets/textures PNG override pack"
```

---

## Self-Review

**Spec coverage:** registry (Task 1), generators v2 (Task 2), PNG-override loader + async atlas (Task 3), `assets/textures/` folder + README (Tasks 3/5), Node atlas/seam/override test (Tasks 1–3), before/after + override screenshots (Task 4), 590 suite green (Task 5). Mesher untouched; water/tint/cutout explicitly deferred to Phase 2. ✓

**Placeholder scan:** generator list in Task 2 Step 3 is representative-not-exhaustive by necessity — flagged inline with the rule ("write all names; port the rest"). The `tileCtx-less-inline:` pseudo-token in Task 3 Step 4 is called out in the following NOTE to replace with a direct `t.gen(ctx, makeRng(idx))` call. All test code is concrete.

**Type consistency:** `buildAtlas()` return shape `{canvas, image, TILES, tileSize, cols}` preserved; `TILES` name→index preserved and order-locked by Task 1's test; `chooseSource(png, gen) → 'png'|'gen'` used identically in test and builder; `makeRng(idx)` defined in registry, used in registry test, generators, and builder.

**Open verification items for the executor:** (1) confirm the NAMES list matches `paintAll` order exactly; (2) confirm `main.js:46` is in an async/TLA context; (3) grep `makeIcon` callers all run post-boot.

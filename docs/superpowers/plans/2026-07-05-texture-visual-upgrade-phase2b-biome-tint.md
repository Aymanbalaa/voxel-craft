# Texture Visual Upgrade — Phase 2b: Per-Biome Grass Tint

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Status of the overall upgrade (as of 2026-07-05, all on `main`, pushed to origin):**
- Phase 1 (texture atlas: registry + v2 generators + PNG override) — DONE (`4220efe`)
- HUD polish + air-bubble fix — DONE (`62d3308`, `007bbb7`)
- Phase 2 water animation — DONE (`89e8dcf`)
- Phase 2 leaf alpha cutout — DONE (`d7084fd`)
- **Phase 2b per-biome grass tint — THIS PLAN (not started)**

**Goal:** Make grass color vary by biome (plains ≠ taiga ≠ savanna ≠ swamp) so the world reads as climate-zoned, without new block types.

**Why it's separate/riskier:** the atlas has ONE `grass_top` tile for the whole world, so location-varying color can't come from textures. It requires a new per-vertex **tint** attribute flowing worldgen → worker → mesher → geometry → shader. This touches the mesher and the Web Worker — the pieces Phase 1/2 deliberately left alone.

## Architecture / data flow

`worker.js` already has `seed`, `cx`, `cz` and calls `meshChunk(slab, light, faceTiles)`. It does NOT have biome data at mesh time (the slab is block ids only). Cheapest path: **recompute biome per column in the worker** from world coords (worldgen exposes a pure `biomeAt(seed, wx, wz)`), turn each biome into an RGB tint, and hand the mesher a `tintAt(lx, lz)` function. The mesher emits a new per-vertex `atint` (Uint8 RGB, normalized) attribute — **white (255,255,255) for everything except grass faces**, biome color for grass. The patched shader multiplies `diffuseColor` by the tint. Non-grass tint = white ⇒ no visual change anywhere else.

Vertex color packing is full (R=blockLight, G=skyLight, B=shade), so tint MUST be a new attribute, not squeezed into `color`.

## Global constraints

- Keep the existing 268-assertion atlas suite + mesh/lighting/worldgen/etc. green. `meshChunk`'s new `tintAt` param is **optional**, defaulting to a white-returning fn, so `test-mesh.mjs` (calls `meshChunk(slab, light, faceTiles)`) stays valid unchanged.
- Only grass gets tinted for the MVP: faces whose tile index === `TILES.grass_top`, plus the `tall_grass` cross tile. (Leave `grass_side` untinted for MVP — it's a single baked dirt+grass tile; tinting it would tint the dirt band too. Note as a follow-up.)
- No new block ids, no worldgen terrain changes.

---

### Task 1: `biomeAt` + `biomeTint` pure exports in worldgen

**Files:**
- Modify: `mc/js/worldgen.js` (export helpers; `pickBiome`/climate are currently internal)
- Test: `mc/test/test-worldgen.mjs` (add tint/biome determinism asserts)

**Interfaces produced:**
- `export function biomeAt(seed, wx, wz): number` — returns a `BIOME` enum value for a world column. Wraps the existing climate + `pickBiome` pipeline (reuse the exact same temp/humidity/height calls `generateColumn` uses so tint matches terrain).
- `export function biomeTint(biome): [number, number, number]` — RGB 0..255. Table:
  - PLAINS `[141,179,96]`, FOREST `[121,168,86]`, BIRCH_FOREST `[133,176,92]`,
  - TAIGA `[104,150,110]`, SNOWY `[128,163,120]`, MOUNTAINS `[130,168,110]`,
  - SAVANNA `[189,178,95]`, DESERT `[180,169,90]`, BEACH `[141,179,96]`, OCEAN `[130,170,120]`.
- `export const BIOME` (if not already exported).

- [ ] **Step 1** Write failing test in `test-worldgen.mjs`:

```js
import { biomeAt, biomeTint, BIOME } from '../js/worldgen.js';
ok(typeof biomeAt(SEED, 8, 8) === 'number', 'biomeAt returns a biome id');
ok(biomeAt(SEED, 8, 8) === biomeAt(SEED, 8, 8), 'biomeAt is deterministic');
{ const t = biomeTint(BIOME.SAVANNA); ok(t.length === 3 && t.every(v => v >= 0 && v <= 255), 'biomeTint returns rgb'); }
ok(biomeTint(BIOME.SAVANNA)[0] > biomeTint(BIOME.TAIGA)[0], 'savanna is warmer/yellower than taiga');
```

- [ ] **Step 2** Run `node test/test-worldgen.mjs` → FAIL (not exported).
- [ ] **Step 3** Refactor `generateColumn` so the climate→biome computation is reachable as `biomeAt(seed,wx,wz)` (extract the temp/humidity/height lines into a helper both call). Add `biomeTint` table. Export `BIOME`, `biomeAt`, `biomeTint`.
- [ ] **Step 4** Run → PASS.
- [ ] **Step 5** Commit: `feat(mc): export biomeAt + biomeTint from worldgen`.

---

### Task 2: mesher emits an optional per-vertex tint attribute

**Files:**
- Modify: `mc/js/mesher.js`
- Test: `mc/test/test-mesh.mjs`

**Interfaces:**
- `meshChunk(slab, light, faceTiles, tintAt = () => WHITE)` where `WHITE = [255,255,255]`. `tintAt(lx, lz) -> [r,g,b]`.
- Each bucket gains a `tint: []` array; `finalize` adds `tint: new Uint8Array(...)`.
- `pushQuad(bk, verts, uvs, r, g, b3, tint)` pushes `tint` rgb for all 4 verts.

- [ ] **Step 1** Add test to `test-mesh.mjs`: with default tint, a lone stone cube's `m.opaque.tint` is all 255; with `tintAt=()=>[10,20,30]` a grass-top block's top face carries `[10,20,30]`.

```js
// default tint is white
{ const chunks = emptyChunks(); chunks[4][cidx(8,40,8)] = B.STONE;
  const m = meshChunk(buildSlab(chunks), computeLight(buildSlab(chunks)), faceTiles);
  ok(m.opaque.tint && m.opaque.tint.every(v => v === 255), 'default tint all white'); }
```
(Use `B.GRASS` + a `faceTiles`/`TILES.grass_top` check for the tinted-face assertion; keep it minimal.)

- [ ] **Step 2** Run → FAIL (`m.opaque.tint` undefined).
- [ ] **Step 3** Implement: thread `tintAt` through `meshChunk`; in the BLOCK face loop compute `const isGrassTop = tile === faceTiles_grass_top_index`; simpler: pass the whole tint decision by tile — `const tint = (tile === GRASS_TOP_TILE) ? tintAt(lx,lz) : WHITE;` where `GRASS_TOP_TILE` is looked up once from a small set. For `emitCross` tint `tall_grass` tiles. Push tint in every `pushQuad`. Add `tint` to `finalize`.
  - Grass tile ids: accept a `grassTiles` Set built once in `meshChunk` from `faceTiles`? Cleanest: pass `tintAt(lx,lz,tile)` and let the WORKER decide per tile (worker knows `TILES`). So signature `tintAt(lx, lz, tile) -> [r,g,b]`, default returns WHITE. Mesher stays tile-agnostic. **Use this** — no TILES import in mesher.
- [ ] **Step 4** Run → PASS.
- [ ] **Step 5** Commit: `feat(mc): mesher emits optional per-vertex tint attribute`.

---

### Task 3: worker computes biome tint + passes it through

**Files:**
- Modify: `mc/js/worker.js`

- [ ] **Step 1** In the `mesh` handler, before `meshChunk`, build a tint fn over the center chunk:

```js
import { biomeAt, biomeTint } from './worldgen.js';
// msg.cx/cz = chunk coords; center chunk world origin:
const ox = msg.cx * CHUNK, oz = msg.cz * CHUNK;
const GRASS_TOP = TILES.grass_top, TALL = TILES.tall_grass;
const tintAt = (lx, lz, tile) => (tile === GRASS_TOP || tile === TALL)
  ? biomeTint(biomeAt(seed, ox + lx, oz + lz)) : WHITE;
const m = meshChunk(slab, light, faceTiles, tintAt);
```
Worker must have `seed`, `CHUNK`, `TILES` (import config + textures registry, or receive TILES in the init message — check how `faceTiles` is currently built in the worker and reuse that TILES source).

- [ ] **Step 2** Add `m.opaque.tint`/`m.water.tint` buffers to the `postMessage` transfer list.
- [ ] **Step 3** Manual check: worker still posts meshes without error (run the game; Task 5 screenshots confirm).
- [ ] **Step 4** Commit: `feat(mc): worker feeds per-biome grass tint to the mesher`.

---

### Task 4: geometry attribute + shader multiply

**Files:**
- Modify: `mc/js/world.js` (where BufferGeometry is built from the worker mesh message — find `setAttribute('position'...)`/`new THREE.BufferGeometry`)
- Modify: `mc/js/main.js` (`patchLight` shader)

- [ ] **Step 1** In `world.js`, wherever `color` attribute is set on the chunk geometry, also set:
```js
geo.setAttribute('atint', new THREE.BufferAttribute(mesh.tint, 3, true)); // normalized u8 rgb
```
Do it for BOTH opaque and water geometries. If tint is absent (older message), default-skip.

- [ ] **Step 2** In `main.js` `patchLight`, inject the attribute into vertex + fragment (both opaque and water branches):
  - vertex preamble: `attribute vec3 atint;\nvarying vec3 vTint;` and in `begin_vertex`: `vTint = atint;`
  - fragment preamble: `varying vec3 vTint;`
  - in the `#ifdef USE_COLOR` block, after computing `_light`: `diffuseColor.rgb *= vTint;`
  - Guard: three.js may not auto-declare a custom attribute — declaring `attribute vec3 atint;` in the injected vertex source is required. Verify no "atint redefined" error.
- [ ] **Step 3** Non-grass tint is white ⇒ `*= vec3(1.0)` no-op. Confirm opaque terrain unchanged, grass now biome-colored.
- [ ] **Step 4** Commit: `feat(mc): apply per-biome grass tint in the voxel shader`.

---

### Task 5: verify + screenshots + green gate

- [ ] **Step 1** `cd mc && for f in test/test-*.mjs test/repro-*.mjs test/persist.mjs; do node "$f" || exit 1; done` → all green.
- [ ] **Step 2** Serve (`python -m http.server 8177`), capture a wide vista crossing biomes: `node test/shot.mjs test/phase2b-biomes.png 6000 test/hero.js`. Expect grass hue to shift between biome bands; no console/shader errors.
- [ ] **Step 3** Confirm a plains vs taiga vs savanna difference is visible; deliver before/after.
- [ ] **Step 4** Merge to `main`, push origin.

---

## Self-review / gotchas
- `test-mesh.mjs` builds `faceTiles = buildFaceTiles(BLOCKS, null)` → all tiles 0. So `tile === GRASS_TOP(=?)`: with null TILES, grass_top resolves to 0, same as everything → test's tint assertion must use a real TILES map or assert only the default-white path. Keep the mesher tile-agnostic (Task 2 Step 3 "use this") so the worker owns the grass-tile decision; then `test-mesh` only checks default white + a stub `tintAt` returning a fixed color for a chosen tile.
- Normalized Uint8 attribute (`true` flag) maps 0..255 → 0..1 in-shader; tint table is authored in 0..255.
- Keep water tint white unless you also want biome-tinted water (out of scope).
- If three.js complains about the custom attribute on the DoubleSide water material, it's fine — water faces just carry white tint.

## Restart prompt (paste next session)
> Continue the voxelheim texture upgrade. Read `docs/superpowers/plans/2026-07-05-texture-visual-upgrade-phase2b-biome-tint.md` and memory `voxelcraft-texture-upgrade`. Phase 1, HUD, and Phase 2 water+leaves are already on `main` and pushed. Execute this Phase 2b plan (per-biome grass tint) task-by-task with the superpowers executing-plans skill: worldgen `biomeAt`/`biomeTint` exports → mesher optional tint attribute → worker tint fn → geometry attribute + shader multiply. Keep the full suite green, give before/after headless screenshots, then commit + push each task.

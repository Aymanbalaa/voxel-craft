# Texture / Visual Upgrade — Design & Plan

**Date:** 2026-07-05
**Project:** voxelheim (`mc/`) browser Minecraft clone
**Goal:** Raise the visual quality of the game to a faithful vanilla-Minecraft look, keeping the "runs with zero external assets" property while allowing a hand-authored texture pack to override any tile.

## Decisions (locked)

- **Route:** Hybrid — procedural generators stay as the always-present fallback; an optional PNG asset layer overrides any tile.
- **Aesthetic:** Faithful vanilla-style (recognizable grass/stone/wood, warm earthy palette).
- **Resolution:** 16×16 (matches current atlas; smallest, crispest, fastest).
- **Authoring:** Primary = hand-coded procedural canvas generators v2 (zero image-gen credits, seamless/tileable by construction, diffable in git). Bloom/AI image-gen is **not** relied on (limited credits); PNG-override path lets real PNGs be added later selectively.

## Problem (from current screenshots)

Geometry, AO, lighting, and day/night already look good. The weak layer is **textures** in `mc/js/textures.js`:
grass/dirt read noisy and muddy, leaves are flat blobs with random speckle, birch logs look like barcodes, tall-grass/flowers are crude, water is flat and static.

## Architecture

Current: `mc/js/textures.js` procedurally paints a 112-tile 16px atlas + `makeIcon`. Mesher bakes lighting into vertex colors; UVs index atlas cells. Boot builds the atlas synchronously before first mesh.

### Units (each independently testable)

1. **Tile registry** — one table mapping every tile name → `{ gen: fn(ctx,x0,y0), assetKey?: string }`. Single source of truth for the 112 tiles; decouples "what tiles exist" from "how each is drawn."
2. **Procedural generators v2** — pure canvas draw functions, seeded, **wrap-aware** (sample noise modulo 16 so tiles are seamless). Rewrite the weak ones: grass_top, grass_side overlay, dirt, sand, gravel, stone, cobble, oak/birch/spruce log + planks, leaves (oak/birch/spruce), ores, tall_grass, flowers. Faithful palettes, subtle dithering, defined edges — no random black/white specks.
3. **Asset-override loader** — at atlas-build time, for each tile try `fetch('assets/textures/<name>.png')`; if it loads (16×16), draw it into that cell; else run the generator. Per-tile fallback, `Promise.allSettled`. Zero PNGs present ⇒ fully procedural (no behavior change for a fresh clone).
4. **Atlas builder** — same 16px tiling math and UV layout; now composites each cell from PNG-or-generator. Becomes **async** (await before first mesh in boot).
5. **Rendering wins enabled by the texture work** (phased, see below): water transparency + gentle animated scroll; per-biome grass tint; leaf alpha cutout. These touch the mesher/material and are riskier, so they are **Phase 2/optional**.

### Data flow

`buildAtlas()` → for each registry tile → source = PNG (if present) else `gen()` → draw into atlas cell → `THREE.CanvasTexture`. Mesher UV indexing unchanged.

## Phases

**Phase 1 — Texture core (low risk, high value). Ship this first.**
- Tile registry + generators v2 + PNG-override loader + async atlas.
- `assets/textures/` folder documented (empty is valid). README note on dropping in a pack.
- Success: side-by-side headless screenshots show clearly crisper grass/dirt/logs/leaves; zero PNGs still boots; a test PNG override visibly replaces one tile.

**Phase 2 — Rendering polish (optional, riskier; separate approval).**
- Water: `transparent` material + animated UV/scroll driven like the existing `daylight` uniform.
- Biome grass tint: multiply grass_top / grass_side-overlay / tall_grass by a per-biome color (via vertex color channel or per-chunk uniform) so plains ≠ taiga ≠ savanna.
- Leaf alpha cutout for non-solid tree canopy (bigger mesher change — evaluate separately).

## Testing

- **Node unit** (`mc/test/test-atlas.mjs`): registry has all 112 tiles; builder produces correct atlas dimensions; override path picks the PNG when a (mocked) fetch resolves and the generator when it rejects. Generators are deterministic given a seed.
- **Seam test:** assert left edge column matches right edge / top matches bottom for tileable block faces (grass_top, dirt, stone) within tolerance.
- **Headless visual:** reuse `test/shot.mjs` + existing eval scripts to capture before/after hero+gameplay shots.
- Full existing suite (noise/worldgen/mesh/recipes/inventory, 590) stays green.

## Risks & mitigations

- **Async atlas breaks boot ordering** → await `buildAtlas()` before first mesh; keep a synchronous all-procedural fast path if any fetch infra is unavailable (e.g. file://).
- **Generator seams** → wrap-aware noise + seam unit test.
- **Scope creep into the mesher** → water/leaves/biome-tint fenced into Phase 2 with its own approval.
- **PNG fetch on `file://`** → loader treats fetch failure as "no override" and falls back silently; game still needs HTTP for modules/workers anyway.

## Out of scope

New block/item types, 3D models, custom mob skins beyond current, shaders/post-processing, sound. This is a texture-and-material visual pass only.

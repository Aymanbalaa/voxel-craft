# VoxelCraft MC — Minecraft Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (hybrid: core engine built inline by the orchestrator, separable modules dispatched to subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A faithful browser Minecraft clone in `mc/`: infinite procedural terrain with biomes/caves/ores, survival + creative modes, mining/placing, lighting, inventory + crafting, day/night, sounds, saving, and basic mobs.

**Architecture:** No-build ES modules served statically. Three.js r180 vendored at `mc/vendor/`. Main thread owns world data + gameplay; a module Worker does terrain generation and chunk meshing (including light BFS over a 3×3-chunk slab) and returns transferable typed arrays. Pure modules (noise, worldgen, mesher, lighting, crafting) have zero DOM/three imports so Node can smoke-test them.

**Tech Stack:** Three.js 0.180.0 (vendored), vanilla ES modules, Web Worker, WebAudio (procedural sounds, no assets), IndexedDB (saves), Canvas-generated 16×16 texture atlas (original Minecraft-like pixel art, no copyrighted assets).

## Global Constraints

- No build step. No npm deps. Everything runs from `mc/index.html` over any static server.
- No external network requests at runtime (three.js is vendored).
- Pure modules (`noise.js`, `worldgen.js`, `mesher.js`, `lighting.js`, `crafting.js`, `recipes.js`, `items.js`, `blocks.js`) must not import three.js or touch DOM — Node-testable and Worker-importable.
- All world data layout: `idx = x + z*16 + y*256` (x fastest), chunk 16×16, WORLD_HEIGHT 128, sea level 48.
- Face order everywhere: `0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z`.
- Item ids: blocks occupy 0–255, non-block items 256+.
- Determinism: same seed → identical chunks, always (trees use neighborhood-seeded placement).

---

## Coordinate & Data Contracts (authoritative)

- **Chunk column:** `Uint8Array(16*128*16)` = 32768 bytes. `idx = x + z*16 + y*256`, local x,z ∈ [0,16), y ∈ [0,128).
- **Chunk key:** `"cx,cz"` with `cx = Math.floor(worldX/16)`.
- **Mesh slab:** worker mesh jobs receive the 3×3 neighborhood as 9 chunk buffers `[NW,N,NE,W,C,E,SW,S,SE]` (null for ungenerated → treated as air). Worker builds a 48×128×48 padded array, computes skylight+blocklight BFS, then meshes the center 16×16.
- **Vertex attributes (worker → main):** `position: Float32Array`, `uv: Float32Array`, `color: Uint8Array ×3/vertex = (blockLight*17, skyLight*17, shade*255)` where shade = faceShade×AO, `index: Uint32Array`. Two buckets: `opaque` (includes alphaTest cutouts: leaves, glass, plants, torches) and `water`.
- **Shader lighting:** `finalLight = max(blockLight, skyLight * uDaylight) * shade`, injected via `onBeforeCompile` on MeshBasicMaterial (vertexColors), `uDaylight` global uniform 0.03–1.0.
- **faceTiles table:** `Uint16Array(256*6)`; `faceTiles[blockId*6+face] = atlas tile index (col + row*16)`. Built in main from `blocks.js` names × `textures.js` TILES, passed to worker at init.
- **blockMeta table (worker init):** `Uint8Array(256*4)`: `[flags, lightEmit, shape, hardnessQ]` where flags bit0=solid bit1=opaque bit2=transparentDraw, shape: 0=block 1=cross 2=torch 3=cactus 4=liquid 5=slabTop(waterSurface unused).

## Worker protocol

- main→worker `{t:'init', seed, faceTiles, blockMeta}`
- main→worker `{t:'gen', cx, cz}` → worker→main `{t:'gen', cx, cz, blocks}` (transfer)
- main→worker `{t:'mesh', cx, cz, rev, chunks:[9 ArrayBuffers|null]}` → worker→main `{t:'mesh', cx, cz, rev, opaque:{pos,uv,col,idx}, water:{...}}` (transfer). `rev` is the chunk's edit revision; main discards stale results.

## File Map (`mc/`)

| File | Owner | Responsibility |
|---|---|---|
| `index.html` | orchestrator | Shell, canvas container, UI roots, importmap |
| `css/style.css` | subagent (UI) | All HUD/menus styling |
| `js/config.js` | orchestrator | Constants (sizes, physics, reach, day length) |
| `js/blocks.js` | orchestrator | Block registry (pure) |
| `js/items.js` | orchestrator | Item registry: tools, food (pure) |
| `js/recipes.js` | subagent | Recipe data + `matchRecipe(grid)` (pure) |
| `js/noise.js` | orchestrator | Seeded simplex 2D/3D + fbm + ridged (pure) |
| `js/worldgen.js` | orchestrator | `generateChunk(cx,cz,seed)` biomes/caves/ores/trees (pure) |
| `js/lighting.js` | orchestrator | Slab skylight+blocklight BFS (pure) |
| `js/mesher.js` | orchestrator | Slab → vertex arrays, AO, shapes (pure) |
| `js/worker.js` | orchestrator | Worker entry: gen + light + mesh |
| `js/textures.js` | subagent | Canvas atlas: ~90 tiles pixel art + `TILES` map + block/item icon renderer |
| `js/world.js` | orchestrator | Chunk store, load radius, dirty queue, worker orchestration, edits log |
| `js/player.js` | orchestrator | AABB physics, swim, fly, fall damage, health/hunger model |
| `js/controls.js` | orchestrator | Pointer lock, keymap, action events |
| `js/interaction.js` | orchestrator | DDA raycast, break progress + cracks, place, use |
| `js/inventory.js` | orchestrator | 36 slots + cursor stack, add/move/split logic |
| `js/ui.js` | subagent (UI) | Hotbar, inventory/crafting screens, HUD bars, F3, menus, death screen |
| `js/sky.js` | orchestrator | Day cycle, sun/moon/stars/clouds, fog + daylight uniform |
| `js/sound.js` | subagent | Procedural WebAudio: dig/place/step/hurt/pop/splash/click/eat |
| `js/drops.js` | orchestrator | Item drop entities, magnet pickup |
| `js/mobs.js` | orchestrator+subagent | Phase 2: pig, sheep, zombie |
| `js/save.js` | orchestrator | IndexedDB: seed, player, time, edited chunks |
| `js/main.js` | orchestrator | Boot, materials/shader, fixed-step loop, autosave |
| `test/*.mjs` | orchestrator | Node smoke tests for pure modules |

## Key Interfaces (what subagents code against)

```js
// blocks.js
export const B = { AIR:0, STONE:1, GRASS:2, DIRT:3, COBBLE:4, OAK_PLANKS:5, BEDROCK:6,
  SAND:7, GRAVEL:8, WATER:9, OAK_LOG:10, OAK_LEAVES:11, GLASS:12, COAL_ORE:13, IRON_ORE:14,
  GOLD_ORE:15, DIAMOND_ORE:16, REDSTONE_ORE:17, SNOWY_GRASS:18, SNOW_BLOCK:19, ICE:20,
  SANDSTONE:21, CACTUS:22, BIRCH_LOG:23, BIRCH_LEAVES:24, SPRUCE_LOG:25, SPRUCE_LEAVES:26,
  TALL_GRASS:27, DANDELION:28, POPPY:29, DEAD_BUSH:30, TORCH:31, CRAFTING_TABLE:32,
  FURNACE:33, STONE_BRICKS:34, MOSSY_COBBLE:35, OBSIDIAN:36, GLOWSTONE:37, BRICKS:38,
  BOOKSHELF:39, WOOL:40, LAVA:41, MUSHROOM_BROWN:42, MUSHROOM_RED:43 };
export const BLOCKS = { [B.STONE]: { name:'Stone', solid:true, opaque:true, shape:'block',
  tex:{all:'stone'}, hardness:1.5, tool:'pickaxe', minTier:0, drops:B.COBBLE, light:0 }, ... };

// items.js
export const I = { STICK:256, COAL:257, IRON_INGOT:258, GOLD_INGOT:259, DIAMOND:260, APPLE:261,
  WOODEN_PICKAXE:270, ..., DIAMOND_SWORD:294, PORKCHOP:295, COOKED_PORKCHOP:296, ... };
export const ITEMS = { [I.STICK]: { name:'Stick', icon:'stick', maxStack:64 },
  [I.IRON_PICKAXE]: { name:'Iron Pickaxe', icon:'iron_pickaxe', maxStack:1,
    tool:{type:'pickaxe', tier:2, speed:6} }, ... };
export function itemName(id), itemIcon(id), maxStack(id), toolOf(id), foodValue(id)

// textures.js  (subagent) — 16px tiles on a 256×256 canvas (16×16 grid)
export function buildAtlas() -> { canvas, TILES /* name -> index (col+row*16) */ }
export function makeIcon(spec) -> HTMLCanvasElement(32×32)
//   spec = { type:'block', top:idx, side:idx }  → pseudo-isometric cube from atlas tiles
//   spec = { type:'flat', tile:idx }            → flat tile blit (plants, glass, items)

// recipes.js (subagent, pure)
export function matchRecipe(grid /* length 4 or 9 array of {id,count}|null */)
  -> { result:{id,count}, consumeOnePerSlot:true } | null
export function smeltResult(inputId) -> {id,count}|null
export function fuelTicks(itemId) -> number  // 0 if not fuel

// sound.js (subagent)
export const sound = { init(), play(name, {volume, pitch}={}), setMasterVolume(v) };
// names: dig_stone, dig_wood, dig_grass, dig_sand, dig_glass, place, step_stone, step_wood,
//        step_grass, step_sand, splash, swim, hurt, death, pop, click, eat, burp, level? no.

// ui.js (subagent) — full contract in dispatch brief; consumes inventory.js API + makeIcon
export function initUI(ctx), updateHUD(state), openInventory(mode), closeOverlays(), isOverlayOpen()

// world.js
export class World {
  getBlock(x,y,z) -> id (0 outside)   setBlock(x,y,z,id)  // dirties neighbors, logs edit
  getHeight(x,z) -> surface y          update(px,pz)       // stream chunks
}
```

---

### Task 1: Scaffold + config + blocks + items + noise (+ Node tests)
Files: `mc/index.html`, `mc/js/config.js`, `mc/js/blocks.js`, `mc/js/items.js`, `mc/js/noise.js`, `mc/test/test-noise.mjs`.
Verify: `node mc/test/test-noise.mjs` — determinism, output range, fbm octaves. Commit.

### Task 2: Dispatch subagents (parallel, background)
- **textures** (sonnet): full tile list + palette + icon renderer brief.
- **UI** (sonnet): DOM contract, inventory drag rules, screens, style.css.
- **recipes** (haiku/sonnet): full recipe table incl. tools ×5 tiers, smelting, fuels + tests.
- **sound** (sonnet): synth brief per sound name.
Each returns files written to `mc/js/`; orchestrator reviews + integrates.

### Task 3: worldgen.js (+ test-worldgen.mjs)
Biomes (ocean, beach, desert, plains, forest, birch forest, taiga, snowy, mountains) from temperature/humidity + continental fbm height; ridged mountains; 3D-noise caves (spaghetti ∩ + cheese), lava pools < y18; ores by depth (coal<128, iron<64, gold<32, redstone<16, diamond<16); bedrock y0; trees (oak/birch/spruce/cactus) via neighborhood-deterministic placement; snow layer on cold; flowers/grass/mushrooms.
Verify: determinism across calls, bedrock present, sea fill at level 48, tree blocks appear across chunk borders consistently. Commit.

### Task 4: lighting.js + mesher.js (+ tests)
Lighting: skylight column init + BFS spread, blocklight from emitters, both 0–15 over 48×128×48 slab. Mesher: face culling vs opaque, water surface lowering + culling between water, cutout shapes (cross, torch, cactus inset), per-vertex AO (4-sample), face shade (top 1, bottom .5, X .6, Z .8), UVs from faceTiles, output per contract.
Verify Node: single stone cube in empty slab → 6 faces/24 verts; buried cube → 0; torch light falls off 14→0; skylight 15 above ground, 0 under solid roof. Commit.

### Task 5: worker.js + world.js
Worker wires init/gen/mesh. World: chunk map, radius streaming (spiral order), gen→light→mesh pipeline gating on 3×3 ready, rev-stamped remesh, edit application + neighbor dirtying, THREE mesh lifecycle (dispose on far), materials passed in. Commit.

### Task 6: player.js + controls.js + main.js boot (first playable render)
Fixed-step 60Hz physics: walk 4.317, sprint 5.612, sneak 1.31 (+edge guard), jump v 8.4, gravity 32, air drag; swim (buoyancy, drag, drowning bubbles data), fly (creative double-space), fall damage (>3 blocks). Camera: eye 1.62, FOV 70 (+sprint FOV kick), view bob optional. main.js: renderer, shader-patched materials, sky hookup later, loop, F3 data. Verify in browser via static server + screenshot. Commit.

### Task 7: interaction.js + drops.js + inventory.js integration
DDA raycast 4.5 reach; survival break times = hardness×tool table (MC formula-ish: base 1.5×hardness, correct tool ÷ speed, wrong-tool-for-required → 5×hardness, no drop); crack decal 10 stages; creative instabreak; place with player-collision veto; torch on solid faces only; use-block (crafting table). Drops: mini-cube entities, bob+spin, gravity+ground collide, magnet <2.5, pickup→inventory+pop. Commit.

### Task 8: sky.js + integrate lighting daylight
20-min day (24000 ticks): sky/fog color curves, sun+moon billboards on pivot, stars fade, clouds plane (canvas noise texture, scrolls), uDaylight drives chunk shader + fog color; night ~0.25 min light… use 0.22. Torch relight not needed (baked). Commit.

### Task 9: UI + crafting + sound + textures integration pass
Wire subagent outputs: atlas→material, icons→UI, recipes→craft grids, furnace UI + smelt tick, sounds on events (dig per material, step by ground block, splash on water enter…). Health/hunger systems: hunger drain on sprint/jump, eat food, regen ≥18 hunger, starve at 0, death screen + respawn at spawn. Commit.

### Task 10: save.js (IndexedDB) + pause menu wiring
Store: meta {seed, time, player{pos,rot,health,hunger,mode,inventory}}, chunks store: full 32KB buffer per edited chunk. Autosave 30s + Esc menu Save. Load on boot if same world exists; "New World (seed)" resets. Commit.

### Task 11: Browser verification & performance pass
Serve, Playwright/manual screenshots: spawn render, break/place, inventory drag, craft pickaxe, night torch scene, swim, save/reload persistence. Perf: ≥50fps at RD8 on this machine; tune queue budgets. Commit.

### Task 12 (Phase 2): mobs.js
Pig/sheep (wander, flee when hit, drop porkchop/wool), zombie (night spawn, chase ≤16, melee, burn at day? → despawn at day), boxy three.Group models with walk animation, ground-snap physics reusing AABB sweep, spawn/despawn rings, cap ~20. Commit.

### Task 13: Polish to "close to Minecraft"
Sprint particles?, block break particles (small textured quads), view bobbing, held-block render in corner, name splash on title, README with run instructions. Final commit.

## Self-Review Notes
- Water flow simulation intentionally simplified to static sea-level fill + source placement (MC-accurate flow is out of scope for v1; revisit post-Task 13).
- Redstone circuits, nether, enchanting: explicitly out of scope.
- Font: UI uses a bundled pixel-style CSS font stack (no external font files).

# VoxelCraft — Module Contract (authoritative)

A browser voxel game (Minecraft-style) using **Three.js loaded as a global `THREE`** (UMD build via CDN).
ALL JS files are **classic scripts** (NOT ES modules). They attach classes/objects to the global `window`.
No bundler, no build step, no `import`/`export`, no `fetch` of local files. Goal: open `index.html` and play
(works from a local static server; avoid anything that breaks file:// such as ES module imports).

## Three.js
Loaded in index.html BEFORE everything else:
`<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>`
This exposes the global `THREE`. Use only APIs available in r128 (no `examples/jsm` ESM modules).

## Script load order (index.html)
1. three.min.js (CDN, global THREE)
2. js/noise.js
3. js/blocks.js
4. js/world.js
5. js/player.js
6. js/controls.js
7. js/interaction.js
8. js/main.js

## Coordinate system
Three.js default, **Y is up**. A block at integer coords `(x,y,z)` occupies the unit cube spanning
`(x,y,z)` to `(x+1,y+1,z+1)` and is centered at `(x+0.5, y+0.5, z+0.5)`.
Block coords from world coords: `Math.floor(worldCoord)`. Air block id is `0`.

---

## js/noise.js
Global class `Noise`.
- `new Noise(seed)` — number seed, deterministic.
- `noise2D(x, y) -> number` in `[-1, 1]`, smooth (Perlin/value/simplex). Self-contained, no deps.
- (optional) `noise3D(x,y,z)` if useful. Must be deterministic for a given seed.

## js/blocks.js
- Global `AIR = 0`.
- Global `BLOCKS`: object NAME -> `{ id, name, color (hex 0xRRGGBB), transparent? (bool) }`.
  Include at least: GRASS, DIRT, STONE, WOOD, LEAVES, SAND, PLANK, GLASS, WATER(transparent).
  Ids are unique positive integers (0 reserved for AIR).
- Global array `HOTBAR` = ordered list of selectable block **ids** (e.g. grass, dirt, stone, wood, leaves, sand, plank, glass).
- Global function `getBlockById(id) -> definition | null`.
- Flat per-block color is fine (no textures). Top/side/bottom shading variation handled in world meshing.

## js/world.js
Global class `World`.
- `new World(scene /*THREE.Scene*/, seed /*number*/)`
- Constants (static or instance): `CHUNK_SIZE = 16`, `WORLD_HEIGHT = 64`, render distance ~4 chunks.
- `getBlock(x, y, z) -> id` (integer coords). Above world or y<0 handled sensibly (air above, optional bedrock below 0).
- `setBlock(x, y, z, id)` — set block AND rebuild the affected chunk's mesh (and neighbor chunk meshes if on a border). Dispose replaced geometry/material.
- `generate()` — generate terrain for all chunks within render distance of origin and add their meshes to `scene`.
  Use `Noise` for a heightmap. Layering: grass on surface, dirt below, stone deeper, sand near sea level,
  water up to sea level, scattered trees (wood trunk + leaves canopy).
- Meshing: build one `THREE.Mesh` per chunk from a merged `BufferGeometry`. **Face-cull** (skip faces between two
  solid/opaque blocks). Apply simple shading so faces read as 3D (top brightest, sides medium, bottom darkest),
  via vertex colors (`material.vertexColors = true`) or per-face color. Transparent blocks (glass/water) render
  but do not cull neighbor faces the same way as opaque.

## js/player.js
Global class `Player`.
- `new Player(world, camera /*THREE.Camera*/)`
- `position` (THREE.Vector3, eye position; spawn above terrain at world center).
- `velocity` (THREE.Vector3).
- `update(dt, input)` where `input` is `Controls.getInput()` output. Apply: horizontal movement relative to
  `input.yaw`, gravity, jump (when `input.jump` and grounded), and **AABB collision** vs world blocks resolved
  axis-by-axis using `world.getBlock`. Player box ~0.6 wide, ~1.8 tall, eye ~1.62 from feet.
  Update `camera.position` to the eye and set camera rotation from `input.yaw`/`input.pitch`
  (use `camera.rotation.order = 'YXZ'`).

## js/controls.js
Global class `Controls`.
- `new Controls(domElement /*the renderer canvas*/)` — request pointer lock on click; listen for keydown/keyup
  and mousemove (apply look only while locked). Clamp pitch to about ±89°.
- `getInput() -> { forward, back, left, right, jump, sprint, yaw, pitch, locked }`
  (movement booleans; yaw/pitch in radians accumulated from mouse).
- Property `isLocked` (bool).

## js/interaction.js
Global class `Interaction`.
- `new Interaction(world, camera, controls)`
- Voxel **DDA raycast** from camera center forward up to ~6 blocks vs `world.getBlock`.
- Left click while locked: break the targeted block (`setBlock(..., AIR)`).
- Right click while locked: place `selectedId` on the face adjacent to the hit; never place inside the player's AABB.
- Number keys `1..8` and mouse wheel change the selected `HOTBAR` slot. Expose `selectedId` and `selectedSlot`.
- `update()` (optional) maintains a wireframe highlight box around the targeted block (added to scene).
- Allow `main.js` to observe the selected slot (e.g. callback `onSelect(slotIndex)` or a public property it can poll).

## js/main.js
- Create `THREE.WebGLRenderer({antialias:true})`, append canvas; `THREE.Scene`; `PerspectiveCamera` fov ~70.
- Sky-blue background + `THREE.Fog`. Lighting: `HemisphereLight` + `DirectionalLight` (sun).
- Instantiate `World(seed)`, call `world.generate()`, then `Player`, `Controls(renderer.domElement)`, `Interaction`.
- Animation loop with delta time: `controls.getInput()` -> `player.update(dt,input)` -> `interaction.update()` -> render.
- Handle window resize.
- DOM UI: center crosshair, a hotbar bar showing the HOTBAR blocks with the selected slot highlighted (use each
  block's color as a swatch), and an instructions overlay (click to play, WASD move, Space jump, mouse look,
  L-click break / R-click place, 1-8 select) that hides on pointer lock.

## index.html
- One page: loads THREE (CDN) then the 7 js files in the order above; contains a `<style>` for crosshair/hotbar/overlay
  and the canvas container. Minimal, clean.

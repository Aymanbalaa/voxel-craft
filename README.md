# VoxelCraft

A small browser-based voxel sandbox (Minecraft-style) built with
[Three.js](https://threejs.org/) r128. Walk around procedurally generated
terrain, break blocks, and place blocks from a hotbar. No build step, no
bundler — just plain classic `<script>` files and a CDN copy of Three.js.

## How to run

Because the game loads Three.js from a CDN and uses no ES modules or `fetch` of
local files, it runs straight from disk:

- **Double-click `index.html`** to open it in your browser, or
- Serve the folder over a tiny static server (recommended; avoids any
  file:// quirks):

  ```sh
  # from the voxel-craft directory
  python -m http.server 8000
  ```

  then open <http://localhost:8000> in your browser.

Click the page to lock the mouse and start playing. Press **Esc** to release
the mouse (the instructions overlay reappears).

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move |
| `Space` | Jump |
| `Shift` | Sprint |
| Mouse | Look around |
| Left click | Break the targeted block |
| Right click | Place the selected block |
| `1`–`8` / mouse wheel | Select hotbar slot |
| `Esc` | Release the mouse |

The white wireframe box shows the block you are currently targeting (within a
6-block reach). The hotbar at the bottom shows each placeable block as a color
swatch; the highlighted slot is the one that will be placed.

## Architecture overview

Everything is a classic script that attaches a global to `window` and is loaded
in dependency order from `index.html`:

1. **`js/noise.js`** — `Noise` class. Seeded, deterministic 2D/3D Perlin noise
   used to drive the terrain heightmap.
2. **`js/blocks.js`** — block registry. Exposes `AIR` (=0), `BLOCKS`
   (NAME → `{ id, name, color, transparent? }`), the ordered `HOTBAR` array of
   placeable block ids, and `getBlockById(id)`.
3. **`js/world.js`** — `World` class. `new World(scene, seed)` stores voxels in
   per-chunk typed arrays (`CHUNK_SIZE` 16, `WORLD_HEIGHT` 64, render distance
   ~4 chunks). `generate()` builds terrain (heightmap layers, water, sand
   beaches, scattered trees) and adds one opaque + one transparent `THREE.Mesh`
   per chunk to the scene, with face culling and per-face vertex-color shading.
   `getBlock`/`setBlock` work in world integer coordinates; edits rebuild the
   affected chunk mesh (and border neighbors) and dispose replaced geometry.
4. **`js/player.js`** — `Player` class. `new Player(world, camera)` holds the
   eye `position`/`velocity`, applies yaw-relative movement, gravity, jumping,
   and axis-by-axis AABB collision against `world.getBlock`, then drives the
   camera each frame from `update(dt, input)`.
5. **`js/controls.js`** — `Controls` class. `new Controls(canvas)` manages
   pointer lock, WASD/Space/Shift key state, and mouse-look (yaw/pitch).
   `getInput()` returns `{ forward, back, left, right, jump, sprint, yaw,
   pitch, locked }`; `isLocked` reflects pointer-lock state.
6. **`js/interaction.js`** — `Interaction` class.
   `new Interaction(world, camera, controls, player)` casts a voxel DDA ray
   from the camera, breaks (left click) / places (right click) blocks, never
   places inside the player, manages hotbar selection (`selectedId`,
   `selectedSlot`, `onSelect` callback, number keys + wheel), and maintains the
   wireframe target highlight.
7. **`js/main.js`** — bootstrap / glue. Creates the `WebGLRenderer`, `Scene`
   (sky-blue background + fog), `PerspectiveCamera` (fov 70), hemisphere + sun
   lighting; instantiates `World → generate()`, then `Player`, `Controls`,
   `Interaction`; runs the `requestAnimationFrame` loop with real delta time
   (`THREE.Clock`): `controls.getInput()` → `player.update(dt, input)` →
   `interaction.update()` → `renderer.render(scene, camera)`. It also builds the
   crosshair/hotbar/overlay HUD, wires the hotbar highlight to
   `interaction.onSelect`, and handles window resize.

### Data flow each frame

```
Controls.getInput()  ->  Player.update(dt, input)  ->  camera moves
                                                        |
Interaction.update() reads camera ----> raycast -----> highlight + (on click) World.setBlock
                                                        |
renderer.render(scene, camera) ------------------------+
```

### Coordinates

Three.js default with **Y up**. A block at integer `(x, y, z)` occupies the
unit cube from `(x, y, z)` to `(x+1, y+1, z+1)`; convert world → block coords
with `Math.floor`. Air is block id `0`.

# VoxelCraft

A browser-based Minecraft clone built with modern Three.js (r180), ES modules, and a
Web Worker for terrain. No build step, no dependencies to install to play.

## Run

Serve the `mc/` folder over any static HTTP server (ES modules + workers need HTTP, not `file://`):

```bash
cd mc
python -m http.server 8177
# then open http://localhost:8177
```

Click the screen to lock the mouse and play.

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Space | Jump / swim up |
| Shift | Sneak (ledge-safe) |
| Ctrl | Sprint |
| Mouse | Look |
| Left click | Break block / attack mob (hold to mine) |
| Right click | Place block / use table & furnace / eat (hold) |
| 1–9, wheel | Select hotbar slot |
| E | Inventory + crafting (near a table = 3×3) |
| F | Toggle fly (creative) |
| G | Toggle creative / survival |
| F3 | Debug overlay |
| Esc | Pause menu (Resume / Save) |

## Features

- Infinite procedural terrain: 10 biomes, caves, depth-gated ores, oak/birch/spruce trees
- Worker-based chunk generation + greedy-ish meshing with ambient occlusion
- Skylight + block-light flood-fill; 20-minute day/night cycle with sun, moon, stars, clouds
- Survival: health, hunger, food, regen, fall/drown/lava damage, death + respawn
- Mining with correct-tool logic, item drops with magnet pickup
- 36-slot inventory, shaped + shapeless crafting (55 recipes), furnace smelting
- Pigs, sheep, zombies (day/night spawning, AI, combat, loot)
- Procedural textures + sounds (no external assets)
- World saving to IndexedDB (autosave + manual)

## Architecture

Pure, Node-testable modules (`noise`, `worldgen`, `lighting`, `mesher`, `blocks`, `items`,
`recipes`, `inventory`) carry the game logic with no DOM/Three dependency. The worker
imports the world-gen + mesher directly; the main thread owns block data for physics and
raycasting. Lighting is baked per-mesh and combined with a day/night uniform in a patched
`MeshBasicMaterial` shader.

Run the test suite:

```bash
cd mc && for t in noise worldgen mesh recipes inventory; do node test/test-$t.mjs; done
```

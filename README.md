<div align="center">

# ⛏️ Voxelheim

### A complete Minecraft-style voxel sandbox that runs in your browser — built from scratch in vanilla JavaScript.

No game engine. No build step. No dependencies to install to play. Just ES modules, a Web Worker, and [Three.js](https://threejs.org/).

![Vanilla JS](https://img.shields.io/badge/vanilla-JavaScript-f7df1e?logo=javascript&logoColor=black)
![Three.js r180](https://img.shields.io/badge/three.js-r180-000000?logo=three.js&logoColor=white)
![No build step](https://img.shields.io/badge/build_step-none-brightgreen)
![Web Workers](https://img.shields.io/badge/terrain-Web_Worker_streamed-blue)

![Voxelheim — coastal terrain vista](mc/screenshots/hero.png)

</div>

---

> **The game lives in [`mc/`](mc/).** This repository root also contains an early neon prototype
> (`index.html` + `js/`) that has been superseded — **Voxelheim is the real, complete project.**
> See **[`mc/README.md`](mc/README.md)** for the full write-up.

## Highlights

Every system is written by hand in plain JavaScript — terrain, lighting, meshing, survival, crafting,
mobs, textures, and sound. There is no engine, no framework, and no bundler.

- **🌍 World** — infinite streamed terrain, 10 biomes, caves, ores, trees, and a 20-minute day/night cycle with sun, moon, 800 stars, and clouds.
- **❤️ Survival** — health, hunger, food, regen, fall/drown/lava damage, death & respawn.
- **🔨 Crafting** — 36-slot inventory, 55 shaped/shapeless recipes, crafting table, and furnace smelting.
- **🐷 Mobs** — pigs, sheep, and zombies with wander/flee/hunt AI, day/night spawning, combat, and loot.
- **🎨 Engine** — worker-streamed chunk meshing with ambient occlusion, baked per-mesh lighting blended with a live daylight shader uniform, and **procedurally generated textures & sound** (zero image/audio assets).
- **💾 Persistence** — worlds saved to IndexedDB (autosave + manual).

## Gallery

|  |  |
|---|---|
| ![Night sky with moon and stars](mc/screenshots/night.png) | ![Pigs and sheep in a meadow](mc/screenshots/mobs.png) |
| A living sky with a pixel moon, stars, and torchlight. | Mobs with AI roaming a flowering meadow. |
| ![First-person survival HUD](mc/screenshots/gameplay.png) | ![Inventory and crafting grid](mc/screenshots/inventory.png) |
| First-person survival with hearts, hunger, and hotbar. | A 36-slot inventory with 3×3 crafting. |

## Quick start

ES modules and Web Workers need a real HTTP origin (not `file://`):

```bash
cd mc
python -m http.server 8177
# then open http://localhost:8177
```

Click the screen to lock the mouse and play. Full controls, architecture notes, and tests are in
**[`mc/README.md`](mc/README.md)**.

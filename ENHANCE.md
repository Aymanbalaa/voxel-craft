# VoxelCraft — NEON CYBER-GRID Overhaul Contract (authoritative)

We are transforming the existing working voxel game (see CONTRACT.md for the base architecture) into a
**synthwave / Tron "Neon Cyber-Grid"** world with richer aesthetics and a signature twist. Keep the base
architecture: classic scripts, global THREE, no ES modules, runs by opening index.html.

DO NOT break what works. Edit/extend the existing files; add new files where noted. Preserve all existing
global class names and signatures from CONTRACT.md unless this document overrides them.

----------------------------------------------------------------------
## PALETTE (use consistently everywhere)
- Void background gradient: top #1a0633 (deep purple) -> horizon #3b0a5e -> #ff2e88 glow band near sun.
- Fog color: #2a0a4a (matches lower sky), moderate density so distant grid fades into haze.
- Neon accents: cyan #18f0ff, magenta #ff2bd6, lime #8cff3b, hot-orange #ff7a18, electric-purple #b14bff.
- Retro sun: vertical gradient #ffd36e (top) -> #ff5f6d -> #b14bff (bottom), crossed by dark horizontal gaps.
- Blocks are DARK bases with NEON emissive accents/edges (not flat bright colors).

----------------------------------------------------------------------
## CDN / SCRIPT LOADING (owned by index.html)
Keep the core engine on the SAME CDN that already works, then add postprocessing from unpkg (SAME version r128/0.128.0):
1. https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js   (global THREE — unchanged)
2. https://unpkg.com/three@0.128.0/examples/js/shaders/CopyShader.js
3. https://unpkg.com/three@0.128.0/examples/js/shaders/LuminosityHighPassShader.js
4. https://unpkg.com/three@0.128.0/examples/js/postprocessing/EffectComposer.js
5. https://unpkg.com/three@0.128.0/examples/js/postprocessing/RenderPass.js
6. https://unpkg.com/three@0.128.0/examples/js/postprocessing/ShaderPass.js
7. https://unpkg.com/three@0.128.0/examples/js/postprocessing/UnrealBloomPass.js
Then the game scripts IN THIS ORDER:
8. js/noise.js  9. js/blocks.js  10. js/world.js  11. js/player.js  12. js/controls.js
13. js/interaction.js  14. js/sky.js  15. js/postfx.js  16. js/trail.js  17. js/main.js
(The postprocessing globals attach to THREE: THREE.EffectComposer, THREE.RenderPass, THREE.ShaderPass,
THREE.UnrealBloomPass, THREE.CopyShader, THREE.LuminosityHighPassShader.)

----------------------------------------------------------------------
## blocks.js (owned by World agent)
Keep ids/names/HOTBAR/getBlockById. RECOLOR to the neon palette and ADD fields to each block definition:
- `color`   : dark base color (hex)
- `emissive`: neon accent color (hex)
- `emissiveIntensity`: number ~0.3..1.2 (how strongly it glows; this drives bloom)
- `transparent` (existing) — keep for GLASS/WATER.
Suggested reskin (keep the same ids): GRASS="Neon Turf" dark teal base + cyan glow top; DIRT dark slab faint
glow; STONE graphite + faint cyan grid; WOOD magenta pillar; LEAVES emissive lime; SAND amber glow;
PLANK cyan panel; GLASS translucent cyan; WATER translucent electric-cyan (animated).

## world.js (owned by World agent)
- PROCEDURAL TEXTURES: build per-block textures on a <canvas> (THREE.CanvasTexture, NearestFilter, 16x16 or 32x32):
  dark base + neon grid lines / grain / glowing edges using the block's color+emissive. Cache one texture per block id.
  Apply via material.map; set material.emissive + emissiveIntensity (and an emissiveMap = the glow texture if feasible)
  so bright parts bloom. Use MeshStandardMaterial or keep MeshLambertMaterial + emissive (Lambert supports emissive/emissiveMap).
- AMBIENT OCCLUSION: in the mesher, compute per-vertex AO (classic voxel 3-neighbor test per face corner -> 0..3 -> shade)
  and multiply it into the existing vertex colors. Keep existing top/side/bottom face shading; AO darkens crevices.
- ANIMATED WATER: water rendered as its own translucent mesh; expose `world.update(dt)` (or animateWater(dt)) that
  gently offsets water surface vertices/UV or pulses opacity/color for a wave shimmer. Neon-cyan tint, ~0.6 opacity.
- Keep getBlock/setBlock/generate and chunk rebuild/disposal exactly as before. Terrain can stay similar shape;
  the synthwave look comes from palette+textures+emissive+AO. Sea level water stays.

## js/sky.js  (NEW — owned by Atmosphere agent)
Global class `Sky`:
- `new Sky(scene, renderer)` — builds: (a) gradient void background — a large BackSide sphere using a vertical
  canvas-gradient texture per PALETTE, or set scene.background to that gradient texture; (b) a RETRO SUN on the
  horizon (plane/sprite with the banded sun gradient + additive glow, bright enough to bloom); (c) drifting
  synthwave CLOUD bands near the horizon (a few large soft additive sprites); (d) a STARFIELD (THREE.Points, small
  white/cyan points high in the dome). Sets scene.fog (THREE.Fog or FogExp2) to the PALETTE fog color.
- `update(dt, camera)` — keep dome/sun/stars centered on camera; slowly drift clouds and twinkle/rotate stars.

## js/postfx.js  (NEW — owned by Atmosphere agent)
Global class `PostFX`:
- `new PostFX(renderer, scene, camera)` — if `THREE.EffectComposer` AND `THREE.UnrealBloomPass` exist: build an
  EffectComposer with RenderPass + UnrealBloomPass (strength ~1.3, radius ~0.6, threshold ~0.15). Set this.enabled=true.
  Otherwise set this.enabled=false (graceful fallback — NEVER throw).
- `render()` — if enabled, composer.render(); else renderer.render(scene, camera).
- `setSize(w, h)` — resize composer + bloom pass (and renderer); call on window resize.
Renderer note: use renderer.outputEncoding = THREE.sRGBEncoding for nicer neon (optional).

## js/trail.js  (NEW — owned by Twist agent)  === THE SIGNATURE TWIST: "Light Ribbon" ===
Global class `Trail` (Tron light-cycle homage):
- `new Trail(scene, world)`
- `update(dt, player, opts)` where `player` has `.position` (THREE.Vector3) and `.velocity`; `opts = { sprinting:bool, selectedColorHex:number }`.
  EPHEMERAL MODE (default): while the player is moving, drop a glowing additive neon segment (small emissive box/quad)
  at the player's feet; segments fade + shrink out over ~1.5s (longer/brighter when sprinting) then are pooled/removed.
  Color = opts.selectedColorHex. Looks like a ribbon of light trailing the player. Keep a pooled cap (e.g. <=200 segments).
- `setSolidMode(bool)` / `toggleSolidMode() -> bool` : SOLID MODE — when the player enters a NEW integer block cell at
  their feet, place a real block there via `world.setBlock(x,y,z, selectedId)` so you build light-bridges as you ride.
  (Twist agent: accept selectedId via opts too: opts.selectedId.) Track last cell to avoid duplicate placements.
- Must never crash if opts fields are missing; default sensibly.

## player.js / controls.js / interaction.js (owned by Twist agent for small tweaks)
- interaction.js: recolor the targeted-block highlight to neon (cyan), thicker/glowing if easy. Keep its API.
- controls.js: ensure `sprint` is exposed in getInput() (already in CONTRACT). No breaking changes.
- Do not change Player/Controls/Interaction public signatures.

## main.js (owned by Atmosphere agent — thin glue)
- Switch renderer/scene to neon: dark void clear color, fog from Sky, sRGB encoding.
- Instantiate `Sky(scene, renderer)`, `PostFX(renderer, scene, camera)`, `Trail(scene, world)` after world/player/controls/interaction.
- Loop each frame: input=controls.getInput(); player.update(dt,input); interaction.update();
  world.update?.(dt) (animate water if present); sky.update(dt, camera);
  trail.update(dt, player, { sprinting: input.sprint, selectedColorHex: <color of interaction.selectedId from BLOCKS>, selectedId: interaction.selectedId });
  then `postfx.render()` INSTEAD OF renderer.render.
- Bind key **F** to `trail.toggleSolidMode()` and reflect state in the HUD.
- Window resize: renderer + camera + `postfx.setSize(w,h)`.
- Update the instructions overlay + add a small HUD line: "F = Light-Bridge mode: ON/OFF". Keep crosshair + hotbar.
- HOTBAR swatches should use each block's neon color so they glow on the dark UI.

----------------------------------------------------------------------
## HARD REQUIREMENTS
- No ES module import/export anywhere. Plain global THREE (r128) only.
- PostFX must degrade gracefully (no bloom -> plain render, still playable) so the game NEVER hard-fails to black.
- Preserve all base global APIs from CONTRACT.md. New globals: Sky, PostFX, Trail.
- Keep it runnable by opening index.html (online, for the CDNs).

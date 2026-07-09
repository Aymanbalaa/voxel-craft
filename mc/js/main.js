// Boot + main loop. Wires renderer, world streaming, player, controls, interaction,
// inventory, drops, UI, and sound into a playable loop.

import * as THREE from '../vendor/three.module.js';
import { CHUNK, HEIGHT, MAX_HEALTH, MAX_HUNGER } from './config.js';
import { B, BLOCKS } from './blocks.js';
import { I, isBlockItem, itemIcon, itemName, attackDamage, maxStack } from './items.js';
import { buildAtlas, makeIcon } from './textures.js';
import { buildFaceTiles } from './mesher.js';
import { surfaceHeight } from './worldgen.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Controls } from './controls.js';
import { Inventory } from './inventory.js';
import { Interaction } from './interaction.js';
import { Drops } from './drops.js';
import { matchRecipe } from './recipes.js';
import { sound } from './sound.js';
import { Sky } from './sky.js';
import { Survival } from './survival.js';
import { Furnaces } from './furnace.js';
import { Mobs } from './mobs.js';
import { Particles } from './particles.js';
import { REACH } from './config.js';
import { foodValue } from './items.js';
import { Save } from './save.js';
import * as UI from './ui.js';

const SEED = 20260705;

// ---- Renderer / scene / camera --------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fbaff);
const FOG_FAR = 13 * CHUNK;
scene.fog = new THREE.Fog(0x8fbaff, FOG_FAR * 0.5, FOG_FAR);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1000);

// ---- Texture atlas + light-injecting materials -----------------------------
const atlas = await buildAtlas();
const tex = new THREE.CanvasTexture(atlas.canvas);
tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
tex.generateMipmaps = false; tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
tex.needsUpdate = true;

const faceTiles = buildFaceTiles(BLOCKS, atlas.TILES);
const daylight = { value: 1.0 };
const waterTime = { value: 0 }; // seconds, drives animated water surface

// Injects the baked-light term into a MeshBasicMaterial. When `water` is set,
// also adds a gentle world-space surface ripple (vertex) + brightness shimmer
// (fragment) driven by the shared uTime uniform — animation without scrolling
// UVs (which would bleed across neighbouring atlas cells).
function patchLight(mat, water = false) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDaylight = daylight;
    // Per-biome grass tint rides a custom `atint` vertex attribute → fragment.
    // White (1,1,1) everywhere except grass, so it's a no-op for all other blocks.
    let vHead = 'attribute vec3 atint;\nvarying vec3 vTint;\n';
    let vBody = 'vTint = atint;';
    if (water) {
      shader.uniforms.uTime = waterTime;
      vHead += 'uniform float uTime;\nvarying vec3 vWPos;\n';
      vBody += `
         vec3 _wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
         transformed.y += 0.045 * sin(uTime * 1.6 + _wp0.x * 0.7) * cos(uTime * 1.2 + _wp0.z * 0.7);
         vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
    }
    shader.vertexShader = vHead + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\n         ${vBody}`);
    const preamble = 'uniform float uDaylight;\nvarying vec3 vTint;\n' + (water ? 'uniform float uTime;\nvarying vec3 vWPos;\n' : '');
    shader.fragmentShader = preamble + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#ifdef USE_COLOR
         float _light = max(vColor.r, vColor.g * uDaylight) * vColor.b;
         ${water
           ? 'float _sh = 0.90 + 0.10 * sin(uTime * 2.0 + vWPos.x * 1.3 + vWPos.z * 1.3);\n         diffuseColor.rgb *= max(_light, 0.05) * _sh;'
           : 'diffuseColor.rgb *= max(_light, 0.05);'}
         diffuseColor.rgb *= vTint;
       #endif`);
  };
  mat.customProgramCacheKey = () => 'voxel-light-' + (water ? 'w' : 'o');
  return mat;
}
const materials = {
  opaque: patchLight(new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5 })),
  water: patchLight(new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), true),
};

// ---- Core systems ----------------------------------------------------------
const world = new World({ seed: SEED, scene, materials, faceTiles, TILES: atlas.TILES });
const sky = new Sky({ scene, camera, daylight });
const spawnH = surfaceHeight(SEED, 8, 8);
const player = new Player(world, { x: 8.5, y: spawnH + 2, z: 8.5 });
const inventory = new Inventory();
const drops = new Drops({ scene, world, inventory, atlasTex: tex, faceTiles, TILES: atlas.TILES, sound });
const survival = new Survival();
const furnaces = new Furnaces();
const mobs = new Mobs({ scene, world, drops, sound });
const particles = new Particles({ scene, world, atlasTex: tex, faceTiles });

// First-person held-item view model (block cube or flat item), parented to camera.
const heldGroup = new THREE.Group();
camera.add(heldGroup); scene.add(camera);
heldGroup.position.set(0.55, -0.42, -0.8);
const heldMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
let heldMesh = null, heldId = -1, heldSwing = 0;
function updateHeld() {
  const id = inventory.selectedId();
  if (id === heldId) return;
  heldId = id;
  if (heldMesh) { heldGroup.remove(heldMesh); heldMesh.geometry.dispose(); heldMesh = null; }
  if (!id) return;
  let geo;
  if (isBlockItem(id)) { geo = drops._blockGeo(id).clone(); geo.scale(1.4, 1.4, 1.4); heldGroup.rotation.set(0, 0, 0); }
  else { geo = new THREE.PlaneGeometry(0.5, 0.5); const uv = geo.attributes.uv, s = 1/16, e = 0.002;
    const ic = itemIcon(id).flat, t = (atlas.TILES && ic in atlas.TILES) ? atlas.TILES[ic] : 0;
    const col = t & 15, row = (t >> 4) & 15;
    uv.setXY(0, col*s+e, row*s+e); uv.setXY(1, (col+1)*s-e, row*s+e); uv.setXY(2, col*s+e, (row+1)*s-e); uv.setXY(3, (col+1)*s-e, (row+1)*s-e); uv.needsUpdate = true; }
  heldMesh = new THREE.Mesh(geo, heldMat);
  heldGroup.add(heldMesh);
}
mobs._attackPlayer = (m) => {
  // Zombie melee: damage + knockback the player.
  const dx = player.pos.x - m.pos.x, dz = player.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
  player.vel.x += dx / d * 4; player.vel.z += dz / d * 4; player.vel.y = 4;
  hurt(3);
};

// Item-icon rendering (cached) — blocks become iso cubes, items flat tiles.
const iconCache = new Map();
function renderItemIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  let c;
  if (isBlockItem(id)) c = makeIcon({ top: faceTiles[id * 6 + 2], side: faceTiles[id * 6 + 0] });
  else c = makeIcon({ flat: itemIcon(id).flat });
  iconCache.set(id, c);
  return c;
}

// ---- UI wiring -------------------------------------------------------------
UI.initUI({
  inventory,
  renderItemIcon,
  onCraft(grid) { return matchRecipe(grid); },   // ui.js expects { result:{id,count} } | null
  takeCraftResult(grid) {
    const r = matchRecipe(grid);
    if (!r) return;
    // Give result to cursor (merge if same), then consume one per occupied cell.
    const res = r.result;
    if (!inventory.cursor) inventory.cursor = { id: res.id, count: res.count };
    else if (inventory.cursor.id === res.id && inventory.cursor.count + res.count <= maxStack(res.id)) inventory.cursor.count += res.count;
    else return; // can't hold two different stacks, or result won't fit on the cursor
    for (let i = 0; i < grid.length; i++) {
      if (grid[i]) { grid[i].count--; if (grid[i].count <= 0) grid[i] = null; }
    }
    // Reflect consumed grid back (ui reads the same array reference).
    for (let i = 0; i < grid.length; i++) if (grid[i] === undefined) grid[i] = null;
  },
  callbacks: {
    onClose() { openFurnace = null; relock(); },
  },
});
inventory.onChange = () => { UI.updateHotbar(); };

// ---- Interaction -----------------------------------------------------------
const interaction = new Interaction({ world, camera, player, inventory, scene, sound, ui: UI, atlas, drops });
interaction.onOpenTable = () => { UI.toggleInventory(true); document.exitPointerLock(); };
let openFurnace = null;   // furnace state currently shown in the UI
interaction.onOpenFurnace = (pos) => {
  const f = furnaces.get(pos[0], pos[1], pos[2]);
  openFurnace = { slots: f.slots, progress: f.progress, burn: f.burn, _f: f };
  UI.openFurnace(openFurnace);
  document.exitPointerLock();
};
interaction.onBlockBroken = (id, x, y, z) => {
  particles.blockBreak(x + 0.5, y + 0.5, z + 0.5, id);
  heldSwing = 1;
  if (id === B.FURNACE) {
    const f = furnaces.remove(x, y, z);
    if (f) for (const s of [f.slots.input, f.slots.fuel, f.slots.output])
      if (s) drops.spawn(x + 0.5, y + 0.5, z + 0.5, s.id, s.count);
  }
};

// ---- Give the player a starter kit (creative-ish convenience) --------------
inventory.set(0, { id: I.DIAMOND_PICKAXE, count: 1 });
inventory.set(1, { id: I.DIAMOND_AXE, count: 1 });
inventory.set(2, { id: I.DIAMOND_SHOVEL, count: 1 });
inventory.set(3, { id: B.OAK_LOG, count: 64 });
inventory.set(4, { id: B.TORCH, count: 64 });
inventory.set(5, { id: B.CRAFTING_TABLE, count: 1 });
inventory.set(6, { id: B.COBBLE, count: 64 });
inventory.set(7, { id: B.GLASS, count: 64 });

// ---- Controls / pointer lock ------------------------------------------------
const bootOverlay = document.getElementById('boot-overlay');
const statusEl = document.getElementById('boot-status');
const bootControls = document.getElementById('boot-controls');
const pauseActions = document.getElementById('pause-actions');
let paused = false;

document.getElementById('btn-resume').addEventListener('click', (e) => { e.stopPropagation(); canvas.requestPointerLock(); });
document.getElementById('btn-save').addEventListener('click', (e) => { e.stopPropagation(); saveGame(true); });
// Clicking the overlay (not a button) starts/resumes play by grabbing the pointer.
bootOverlay.addEventListener('click', () => { if (started) canvas.requestPointerLock(); });

function relock() { if (started) canvas.requestPointerLock(); }

// Player look ray (matches interaction's yaw/pitch convention).
const _dir = new THREE.Vector3();
function lookDir() {
  const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch), sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  return _dir.set(-sy * cp, sp, -cy * cp);
}
function eyeOrigin() { return { x: player.pos.x, y: player.eyeY(), z: player.pos.z }; }

const controls = new Controls(canvas, {
  onLockChange(locked) {
    if (locked) {
      bootOverlay.classList.add('hidden');
      pauseActions.style.display = 'none';
      paused = false;
      if (!sound.ready) sound.init();
    } else if (!UI.isOverlayOpen()) {
      // Pause (unless a menu is driving the unlock).
      if (started) {
        bootOverlay.classList.remove('hidden');
        statusEl.style.display = 'block';
        statusEl.textContent = 'Paused';
        bootControls.style.display = 'none';
        pauseActions.style.display = 'flex';
        paused = true;
      }
    }
  },
  onMouseDown(button) {
    if (UI.isOverlayOpen() || !controls.locked) return;
    if (button === 0) {
      const mob = mobs.raycast(eyeOrigin(), lookDir(), REACH);
      if (mob) { mobs.hit(mob, attackDamage(inventory.selectedId()), player.pos); }
    }
    if (button === 2) interaction.useOrPlace();
    if (button === 1) interaction.pickBlock();
  },
  onWheel(dir) { if (!UI.isOverlayOpen()) { inventory.scroll(dir); UI.setSelectedSlot(inventory.selected); } },
  onKey(code) {
    if (code.startsWith('Digit')) {
      const n = +code.slice(5); if (n >= 1 && n <= 9) { inventory.select(n - 1); UI.setSelectedSlot(inventory.selected); }
    }
    if (code === 'KeyE') {
      if (UI.isOverlayOpen()) { UI.closeOverlays(); }
      else { UI.toggleInventory(nearCraftingTable()); document.exitPointerLock(); }
    }
    if (code === 'KeyG') { player.setMode(player.mode === 'creative' ? 'survival' : 'creative'); UI.showToast(player.mode + ' mode'); }
    if (code === 'KeyF') player.toggleFly();
    if (code === 'F3') { showF3 = !showF3; }
  },
});

function nearCraftingTable() {
  const px = Math.floor(player.pos.x), py = Math.floor(player.pos.y), pz = Math.floor(player.pos.z);
  for (let dy = 0; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
    if (world.getBlock(px + dx, py + dy, pz + dz) === B.CRAFTING_TABLE) return true;
  return false;
}

let showF3 = false;

// Coerce a possibly-tampered saved value to a finite number clamped to [lo,hi];
// returns `fallback` for NaN/Infinity/non-numeric input. Guards against corrupt
// or malicious saves poisoning physics/HUD state.
function clampFinite(v, lo, hi, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : (n > hi ? hi : n);
}

// ---- Loading gate ----------------------------------------------------------
let started = false;
let loadedExisting = false;
async function boot() {
  await world.whenReady;
  // Restore a saved world if one exists for this seed.
  try {
    const saved = await Save.loadWorld(SEED);
    if (saved) {
      loadedExisting = true;
      world.setSavedEdits(saved.edits);
      const m = saved.meta;
      // Validate untrusted saved day/night time: NaN/Infinity/non-numeric would
      // make sky.setTime compute NaN, permanently poisoning lighting/color
      // uniforms with no recovery this session.
      if (m.time != null && Number.isFinite(typeof m.time === 'number' ? m.time : Number(m.time)))
        sky.setTime(typeof m.time === 'number' ? m.time : Number(m.time));
      if (m.player) {
        // Validate untrusted saved position/rotation: NaN/Infinity/strings would
        // poison physics and chunk streaming (NaN chunk coords never resolve the
        // loading gate); huge finite values would request generation far away.
        const XZ = 30_000_000;
        player.pos.x = clampFinite(m.player.x, -XZ, XZ, 8.5);
        player.pos.y = clampFinite(m.player.y, -64, HEIGHT + 256, HEIGHT);
        player.pos.z = clampFinite(m.player.z, -XZ, XZ, 8.5);
        player.yaw = clampFinite(m.player.yaw, -1e6, 1e6, 0);
        player.pitch = clampFinite(m.player.pitch, -Math.PI / 2, Math.PI / 2, 0);
        player.setMode(m.player.mode === 'creative' ? 'creative' : 'survival');
        player.flying = !!m.player.flying;
      }
      if (m.survival) {
        // Read only known fields with validation; never Object.assign untrusted
        // data (would copy exhaustion/_starve/etc — e.g. exhaustion=Infinity hangs
        // the tab in Survival.update's `while (exhaustion >= 4)` loop).
        survival.health = clampFinite(m.survival.health, 0, MAX_HEALTH, MAX_HEALTH);
        survival.hunger = clampFinite(m.survival.hunger, 0, MAX_HUNGER, MAX_HUNGER);
        survival.saturation = clampFinite(m.survival.saturation, 0, MAX_HUNGER, 5);
      }
      if (m.inventory) inventory.load(m.inventory);
      if (m.furnaces) furnaces.load(m.furnaces);
    }
  } catch (e) { console.warn('load failed', e); }

  world.update(player.pos.x, player.pos.z);
  const t0 = performance.now();
  const gate = () => {
    world.update(player.pos.x, player.pos.z);
    const n = world.readyCount();
    statusEl.textContent = `Generating world… ${n} chunks`;
    if (n >= 9 || performance.now() - t0 > 8000) {
      if (!loadedExisting) dropToGround();
      statusEl.style.display = 'none';
      bootControls.style.display = 'block';
      started = true;
      UI.setSelectedSlot(inventory.selected);
      startAutosave();
      return;
    }
    requestAnimationFrame(gate);
  };
  gate();
}

// ---- Persistence -----------------------------------------------------------
function gatherState() {
  return {
    seed: SEED, time: sky.getTime(),
    player: { x: player.pos.x, y: player.pos.y, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, mode: player.mode, flying: player.flying },
    survival: { health: survival.health, hunger: survival.hunger, saturation: survival.saturation },
    inventory: inventory.toJSON(),
    furnaces: furnaces.toJSON(),
    edits: world.collectEdits(),
    savedAt: Math.floor(Date.now() / 1000),
  };
}
let saving = false;
async function saveGame(showToast = true) {
  if (saving) return;
  saving = true;
  try { await Save.saveWorld(gatherState()); if (showToast) UI.showToast('World saved'); }
  catch (e) { console.warn('save failed', e); if (showToast) UI.showToast('Save failed'); }
  finally { saving = false; }
}
let autosaveTimer = null;
function startAutosave() {
  if (autosaveTimer) return;
  autosaveTimer = setInterval(() => saveGame(false), 30000);
  addEventListener('beforeunload', () => { try { Save.saveWorld(gatherState()); } catch {} });
}
function dropToGround() {
  let y = HEIGHT - 1;
  while (y > 1 && world.getBlock(8, y, 8) === B.AIR) y--;
  player.pos.y = y + 1.02; player.vel.y = 0;
  player.fallStart = null; // clear fall tracking so a teleport/respawn can't inflict phantom fall damage
}

// ---- Main loop -------------------------------------------------------------
const STEP = 1 / 60;
let acc = 0, last = performance.now(), fps = 0, fpsT = 0, fpsN = 0;
let air = 10, drownTimer = 0, bobPhase = 0;
const EMPTY = { forward:0,back:0,left:0,right:0,jump:0,sneak:0,sprint:0 };
// Previous physics-step position, for render interpolation. Physics runs at a
// fixed 60Hz; the display often doesn't (144Hz, or 60Hz with accumulator
// drift), so snapping the camera to player.pos each frame makes motion judder.
// Rendering at prev + (pos - prev) * (acc/STEP) restores smooth motion.
const prevPos = { x: 0, y: 0, z: 0 };
let prevValid = false;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;
  waterTime.value = now / 1000; // animate water every frame, even while paused

  const active = started && controls.locked && !UI.isOverlayOpen();
  if (active) controls.applyLook(player);

  if (started) {
    // Clamp banked sim-time to what one frame can drain (5 steps). Without
    // this, a single >83ms stall (GC, upload burst, tab switch) leaves debt in
    // acc that replays as several frames of 5x fast-forward motion — a lurch
    // that's worse than the hitch itself. Dropping the excess costs a few tens
    // of ms of sim time during a stall, which is imperceptible.
    acc = Math.min(acc + dt, STEP * 5);
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      prevPos.x = player.pos.x; prevPos.y = player.pos.y; prevPos.z = player.pos.z;
      prevValid = true;
      const evt = player.update(STEP, active ? controls.input : EMPTY);
      if (evt.enteredWater) sound.play?.('splash', { volume: 0.5 });
      if (evt.landedDamage > 0) { hurt(evt.landedDamage); }
      acc -= STEP; steps++;
    }
    // Interpolate the render position between the last two physics states.
    // Snap instead when there is no valid prev or after a teleport (respawn /
    // dropToGround moves pos several metres in one step — lerping across that
    // would streak the camera through the world for a frame).
    let rx = player.pos.x, ry = player.pos.y, rz = player.pos.z;
    if (prevValid) {
      const jump2 = (player.pos.x - prevPos.x) ** 2 + (player.pos.y - prevPos.y) ** 2 + (player.pos.z - prevPos.z) ** 2;
      if (jump2 < 4) {
        const alpha = Math.min(acc / STEP, 1);
        rx = prevPos.x + (player.pos.x - prevPos.x) * alpha;
        ry = prevPos.y + (player.pos.y - prevPos.y) * alpha;
        rz = prevPos.z + (player.pos.z - prevPos.z) * alpha;
      } else { prevPos.x = player.pos.x; prevPos.y = player.pos.y; prevPos.z = player.pos.z; }
    }
    // View bob while walking on the ground.
    const hv = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && hv > 0.5) bobPhase += dt * 10;
    const bob = player.onGround ? Math.sin(bobPhase) * Math.min(hv, 6) * 0.012 : 0;
    const bobX = Math.cos(bobPhase * 0.5) * Math.min(hv, 6) * 0.01;
    camera.position.set(rx, ry + (player.eyeY() - player.pos.y) + bob, rz);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    camera.translateX(bobX);
    sky.update(dt);
    particles.update(dt);
    updateHeld();
    // Held-item swing on use/break.
    if (controls.mouseButtons.has(0) && active) heldSwing = Math.min(1, heldSwing + dt * 6);
    heldSwing = Math.max(0, heldSwing - dt * 4);
    if (heldMesh) { heldGroup.position.y = -0.42 - Math.sin(heldSwing * Math.PI) * 0.15; heldGroup.rotation.z = Math.sin(heldSwing * Math.PI) * 0.3; }

    if (active) {
      interaction.updateTarget();
      const mobAimed = mobs.raycast(eyeOrigin(), lookDir(), REACH);
      interaction.updateBreaking(dt, controls.mouseButtons.has(0) && !mobAimed);
      handleEating(dt);
      handleFootsteps(dt);
    } else {
      interaction.selMesh.visible = false;
      interaction._cancelBreak();
      eatTimer = 0;
    }
    mobs.setDaylight(daylight.value);
    mobs.update(dt, player);
    drops.update(dt, player.pos, camera);
    furnaces.update(dt);
    if (openFurnace) { // animate gauges / reflect auto-smelt while open
      openFurnace.progress = openFurnace._f.progress;
      openFurnace.burn = openFurnace._f.burn;
      UI.updateFurnace(openFurnace);
    }
    // Breath / drowning.
    if (player.headInWater) {
      air -= dt;
      if (air <= 0) { air = 0; drownTimer += dt; if (drownTimer >= 1) { drownTimer = 0; hurt(2); } }
    } else { air = Math.min(10, air + dt * 4); drownTimer = 0; }

    if (player.mode === 'survival') {
      survival.update(dt, player);
      if (player.pos.y < -8) hurt(4);            // void damage
      const feet = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y), Math.floor(player.pos.z));
      if (feet === B.LAVA) hurt(4);
      if (survival.dead) die();
    }
    world.update(player.pos.x, player.pos.z);
  }

  renderer.render(scene, camera);

  fpsN++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }
  updateHUD();
}

function hurt(dmg) {
  if (player.mode === 'creative') return;
  if (survival.hurt(dmg)) { sound.play?.('hurt', { volume: 0.6 }); UI.flashDamage(); }
  if (survival.dead) die();
}
let dying = false;
function die() {
  if (dying) return;
  dying = true;
  sound.play?.('death', { volume: 0.7 });
  document.exitPointerLock();
  UI.showDeath(() => {
    survival.reset();
    player.pos.x = 8.5; player.pos.z = 8.5;
    dropToGround();
    player.vel.x = player.vel.y = player.vel.z = 0;
    dying = false;
    relock();
  });
}

// Hold right-click with food selected to eat.
let eatTimer = 0;
function handleEating(dt) {
  const held = inventory.hotbarStack();
  const canEat = held && foodValue(held.id) && (player.mode === 'creative' || survival.hunger < 20);
  if (canEat && controls.mouseButtons.has(2)) {
    eatTimer += dt;
    if (eatTimer % 0.3 < dt) sound.play?.('eat', { volume: 0.4 });
    if (eatTimer >= 1.3) {
      eatTimer = 0;
      if (player.mode !== 'creative') { survival.eat(held.id); inventory.consumeSelected(); }
      sound.play?.('burp', { volume: 0.4 });
    }
  } else eatTimer = 0;
}

// Footstep sounds keyed to the ground block, paced by distance travelled.
let stepDist = 0;
function handleFootsteps(dt) {
  if (!player.onGround || player.inWater) { return; }
  const hv = Math.hypot(player.vel.x, player.vel.z);
  stepDist += hv * dt;
  if (stepDist > 2.2) {
    stepDist = 0;
    const g = world.getBlock(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z));
    const name = g === B.SAND || g === B.GRAVEL ? 'step_sand'
      : (BLOCKS[g]?.tool === 'axe' ? 'step_wood'
      : (g === B.STONE || g === B.COBBLE || BLOCKS[g]?.tool === 'pickaxe' ? 'step_stone' : 'step_grass'));
    sound.play?.(name, { volume: 0.25, pitch: 0.9 + Math.random() * 0.2 });
  }
}

// Skip the ~40 DOM writes in UI.updateHUD on frames where nothing it shows
// changed (the common case). The F3 overlay changes every frame, so it always
// updates while visible.
let hudSig = '';
function updateHUD() {
  const sig = showF3 ? null : `${survival.health}|${survival.hunger}|${Math.ceil(air)}|${player.mode}`;
  if (sig !== null) {
    if (sig === hudSig) return;
    hudSig = sig;
  } else hudSig = '';
  UI.updateHUD({
    health: survival.health, hunger: survival.hunger,
    air: Math.ceil(air),
    mode: player.mode,
    showF3,
    f3lines: showF3 ? [
      `VoxelCraft ${fps} fps`,
      `xyz ${player.pos.x.toFixed(1)} ${player.pos.y.toFixed(1)} ${player.pos.z.toFixed(1)}`,
      `chunk ${Math.floor(player.pos.x/CHUNK)},${Math.floor(player.pos.z/CHUNK)}  ready ${world.readyCount()}`,
      `mode ${player.mode}${player.flying?' fly':''} ${player.onGround?'ground':'air'}${player.inWater?' water':''}`,
      `held ${itemName(inventory.selectedId())}`,
    ] : null,
  });
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

window.MC = { THREE, scene, camera, renderer, world, player, controls, inventory, interaction, drops, mobs, materials, atlas, daylight, sound, sky, survival, furnaces, UI, MCsave: Save };
window.__mc_save = () => saveGame(false);
Object.defineProperty(window, '__mc_loadedExisting', { get: () => loadedExisting });

boot();
requestAnimationFrame(frame);

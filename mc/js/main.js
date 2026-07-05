// Boot + main loop. Wires renderer, world streaming, player, controls, interaction,
// inventory, drops, UI, and sound into a playable loop.

import * as THREE from '../vendor/three.module.js';
import { CHUNK, HEIGHT } from './config.js';
import { B, BLOCKS } from './blocks.js';
import { I, isBlockItem, itemIcon, itemName } from './items.js';
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
const atlas = buildAtlas();
const tex = new THREE.CanvasTexture(atlas.canvas);
tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
tex.generateMipmaps = false; tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
tex.needsUpdate = true;

const faceTiles = buildFaceTiles(BLOCKS, atlas.TILES);
const daylight = { value: 1.0 };

function patchLight(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDaylight = daylight;
    shader.fragmentShader = 'uniform float uDaylight;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#ifdef USE_COLOR
         float _light = max(vColor.r, vColor.g * uDaylight) * vColor.b;
         diffuseColor.rgb *= max(_light, 0.05);
       #endif`);
  };
  mat.customProgramCacheKey = () => 'voxel-light-' + (mat.transparent ? 'w' : 'o');
  return mat;
}
const materials = {
  opaque: patchLight(new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5 })),
  water: patchLight(new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })),
};

// ---- Core systems ----------------------------------------------------------
const world = new World({ seed: SEED, scene, materials, faceTiles });
const sky = new Sky({ scene, camera, daylight });
const spawnH = surfaceHeight(SEED, 8, 8);
const player = new Player(world, { x: 8.5, y: spawnH + 2, z: 8.5 });
const inventory = new Inventory();
const drops = new Drops({ scene, world, inventory, atlasTex: tex, faceTiles, TILES: atlas.TILES, sound });

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
  onCraft(grid) { const r = matchRecipe(grid); return r ? r.result : null; },
  takeCraftResult(grid) {
    const r = matchRecipe(grid);
    if (!r) return;
    // Give result to cursor (merge if same), then consume one per occupied cell.
    const res = r.result;
    if (!inventory.cursor) inventory.cursor = { id: res.id, count: res.count };
    else if (inventory.cursor.id === res.id) inventory.cursor.count += res.count;
    else return; // can't hold two different stacks
    for (let i = 0; i < grid.length; i++) {
      if (grid[i]) { grid[i].count--; if (grid[i].count <= 0) grid[i] = null; }
    }
    // Reflect consumed grid back (ui reads the same array reference).
    for (let i = 0; i < grid.length; i++) if (grid[i] === undefined) grid[i] = null;
  },
  callbacks: {
    onClose() { relock(); },
  },
});
inventory.onChange = () => { UI.updateHotbar(); };

// ---- Interaction -----------------------------------------------------------
const interaction = new Interaction({ world, camera, player, inventory, scene, sound, ui: UI, atlas, drops });
interaction.onOpenTable = () => { UI.toggleInventory(true); document.exitPointerLock(); };
interaction.onOpenFurnace = () => { UI.showToast('Furnace coming soon'); };

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
let paused = false;

function relock() { if (started) canvas.requestPointerLock(); }

const controls = new Controls(canvas, {
  onLockChange(locked) {
    if (locked) {
      bootOverlay.classList.add('hidden');
      paused = false;
      if (!sound.ready) sound.init();
    } else if (!UI.isOverlayOpen()) {
      // Pause (unless a menu is driving the unlock).
      if (started) { bootOverlay.classList.remove('hidden'); statusEl.textContent = 'Paused'; paused = true; }
    }
  },
  onMouseDown(button) {
    if (UI.isOverlayOpen() || !controls.locked) return;
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

// ---- Loading gate ----------------------------------------------------------
let started = false;
async function boot() {
  await world.whenReady;
  world.update(player.pos.x, player.pos.z);
  const t0 = performance.now();
  const gate = () => {
    world.update(player.pos.x, player.pos.z);
    const n = world.readyCount();
    statusEl.textContent = `Generating world… ${n} chunks`;
    if (n >= 9 || performance.now() - t0 > 8000) {
      dropToGround();
      statusEl.style.display = 'none';
      bootControls.style.display = 'block';
      started = true;
      UI.setSelectedSlot(0);
      return;
    }
    requestAnimationFrame(gate);
  };
  gate();
}
function dropToGround() {
  let y = HEIGHT - 1;
  while (y > 1 && world.getBlock(8, y, 8) === B.AIR) y--;
  player.pos.y = y + 1.02; player.vel.y = 0;
}

// ---- Main loop -------------------------------------------------------------
const STEP = 1 / 60;
let acc = 0, last = performance.now(), fps = 0, fpsT = 0, fpsN = 0;
const EMPTY = { forward:0,back:0,left:0,right:0,jump:0,sneak:0,sprint:0 };

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;

  const active = started && controls.locked && !UI.isOverlayOpen();
  if (active) controls.applyLook(player);

  if (started) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      const evt = player.update(STEP, active ? controls.input : EMPTY);
      if (evt.enteredWater) sound.play?.('splash', { volume: 0.5 });
      if (evt.landedDamage > 0) { hurt(evt.landedDamage); }
      acc -= STEP; steps++;
    }
    camera.position.set(player.pos.x, player.eyeY(), player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    sky.update(dt);

    if (active) {
      interaction.updateTarget();
      interaction.updateBreaking(dt, controls.mouseButtons.has(0));
    } else {
      interaction.selMesh.visible = false;
      interaction._cancelBreak();
    }
    drops.update(dt, player.pos, camera);
    world.update(player.pos.x, player.pos.z);
  }

  renderer.render(scene, camera);

  fpsN++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsT = 0; fpsN = 0; }
  updateHUD();
}

function hurt(dmg) {
  health = Math.max(0, health - dmg);
  sound.play?.('hurt', { volume: 0.6 });
  UI.flashDamage();
  if (health <= 0) respawn();
}
let health = 20, hunger = 20;
function respawn() {
  health = 20; hunger = 20;
  dropToGround();
  player.pos.x = 8.5; player.pos.z = 8.5;
  player.vel.x = player.vel.y = player.vel.z = 0;
}

function updateHUD() {
  UI.updateHUD({
    health, hunger, air: player.headInWater ? 6 : 10,
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

window.MC = { THREE, scene, camera, renderer, world, player, controls, inventory, interaction, drops, materials, atlas, daylight, sound, sky, UI, get health(){return health;} };

boot();
requestAnimationFrame(frame);

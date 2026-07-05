// Boot + main loop. Wires renderer, world streaming, player physics, controls.
// Interaction / inventory / UI / sky get layered in by later tasks.

import * as THREE from '../vendor/three.module.js';
import { CHUNK, HEIGHT, PLAYER } from './config.js';
import { B, BLOCKS } from './blocks.js';
import { buildAtlas } from './textures.js';
import { buildFaceTiles } from './mesher.js';
import { surfaceHeight } from './worldgen.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Controls } from './controls.js';
import { sound } from './sound.js';

const SEED = 20260705;

// ---- Renderer / scene / camera --------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fbaff);
const FOG_NEAR = (14) * CHUNK * 0.55;
scene.fog = new THREE.Fog(0x8fbaff, FOG_NEAR * 0.4, FOG_NEAR);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 1000);

// ---- Texture atlas + light-injecting materials -----------------------------
const atlas = buildAtlas();
const tex = new THREE.CanvasTexture(atlas.canvas);
tex.magFilter = THREE.NearestFilter;
tex.minFilter = THREE.NearestFilter;
tex.generateMipmaps = false;
tex.flipY = false;                 // mesher UVs assume top-left origin
tex.colorSpace = THREE.SRGBColorSpace;
tex.needsUpdate = true;

const faceTiles = buildFaceTiles(BLOCKS, atlas.TILES);

// Shared daylight uniform (sky.js will animate .value later; flat for now).
const daylight = { value: 1.0 };

function patchLight(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDaylight = daylight;
    shader.fragmentShader = 'uniform float uDaylight;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#ifdef USE_COLOR
         float _light = max(vColor.r, vColor.g * uDaylight) * vColor.b;
         diffuseColor.rgb *= max(_light, 0.05);
       #endif`
    );
  };
  mat.customProgramCacheKey = () => 'voxel-light-' + (mat.transparent ? 'w' : 'o');
  return mat;
}

const materials = {
  opaque: patchLight(new THREE.MeshBasicMaterial({
    map: tex, vertexColors: true, alphaTest: 0.5, side: THREE.FrontSide,
  })),
  water: patchLight(new THREE.MeshBasicMaterial({
    map: tex, vertexColors: true, transparent: true, opacity: 0.85,
    depthWrite: false, side: THREE.DoubleSide,
  })),
};

// ---- World / player / controls ---------------------------------------------
const world = new World({ seed: SEED, scene, materials, faceTiles });

const spawnH = surfaceHeight(SEED, 8, 8);
const player = new Player(world, { x: 8.5, y: spawnH + 2, z: 8.5 });

const statusEl = document.getElementById('boot-status');
const bootControls = document.getElementById('boot-controls');
const bootOverlay = document.getElementById('boot-overlay');

const controls = new Controls(canvas, {
  onLockChange(locked) {
    bootOverlay.classList.toggle('hidden', locked);
    if (locked && sound && !sound.ready) sound.init();
  },
  onKey(code) {
    if (code === 'KeyG') player.setMode(player.mode === 'creative' ? 'survival' : 'creative');
    if (code === 'KeyF') player.toggleFly();
    if (code === 'F3') { showF3 = !showF3; f3El.style.display = showF3 ? 'block' : 'none'; }
  },
});

// Minimal F3 overlay (full HUD comes with UI integration).
const f3El = document.createElement('pre');
f3El.id = 'f3-basic';
f3El.style.cssText = 'position:fixed;top:6px;left:6px;margin:0;padding:6px 8px;font:12px/1.4 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.45);z-index:30;display:none;white-space:pre;pointer-events:none;';
document.body.appendChild(f3El);
let showF3 = false;

// ---- Loading gate ----------------------------------------------------------
let started = false;
async function boot() {
  await world.whenReady;
  world.update(player.pos.x, player.pos.z);
  const need = 9;
  const t0 = performance.now();
  const gate = () => {
    world.update(player.pos.x, player.pos.z);
    const n = world.readyCount();
    statusEl.textContent = `Generating world… ${n} chunks`;
    if (n >= need || performance.now() - t0 > 8000) {
      // Drop the player onto solid ground.
      dropToGround();
      statusEl.style.display = 'none';
      bootControls.style.display = 'block';
      started = true;
      return;
    }
    requestAnimationFrame(gate);
  };
  gate();
}
function dropToGround() {
  let y = HEIGHT - 1;
  while (y > 1 && world.getBlock(8, y, 8) === B.AIR) y--;
  player.pos.y = y + 1.02;
  player.vel.y = 0;
}

// ---- Main loop (fixed-step physics) ----------------------------------------
const STEP = 1 / 60;
let acc = 0, last = performance.now(), fps = 0, fpsT = 0, fpsN = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.25) dt = 0.25;

  controls.applyLook(player);

  if (started) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      const evt = player.update(STEP, controls.locked ? controls.input : EMPTY_INPUT);
      if (evt.enteredWater) sound.play?.('splash');
      acc -= STEP; steps++;
    }
    world.update(player.pos.x, player.pos.z);
  }

  // Camera follows the eye.
  camera.position.set(player.pos.x, player.eyeY(), player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');

  renderer.render(scene, camera);

  // FPS + F3.
  fpsN++; fpsT += dt;
  if (fpsT >= 0.5) { fps = Math.round(fpsN / fpsT); fpsN = 0; fpsT = 0; }
  if (showF3) {
    f3El.textContent =
      `VoxelCraft  ${fps} fps\n` +
      `xyz ${player.pos.x.toFixed(1)} ${player.pos.y.toFixed(1)} ${player.pos.z.toFixed(1)}\n` +
      `chunk ${Math.floor(player.pos.x/CHUNK)}, ${Math.floor(player.pos.z/CHUNK)}\n` +
      `chunks ${world.readyCount()} ready\n` +
      `mode ${player.mode}${player.flying?' (fly)':''}  ${player.onGround?'ground':'air'}${player.inWater?' water':''}`;
  }
}
const EMPTY_INPUT = { forward:false, back:false, left:false, right:false, jump:false, sneak:false, sprint:false };

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Expose for debugging / later modules.
window.MC = { THREE, scene, camera, renderer, world, player, controls, materials, atlas, daylight, sound };

boot();
requestAnimationFrame(frame);

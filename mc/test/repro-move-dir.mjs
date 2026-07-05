// Repro: does pressing W move the player toward where the camera looks?
// The camera view is the ground truth (that's the pixels on screen). main.js sets
//   camera.rotation.set(pitch, yaw, 0, 'YXZ')
// and interaction.js raycasts along dir = (-sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch)).
// Movement forward must point the same horizontal way, else W walks sideways/backwards.

import * as THREE from '../vendor/three.module.js';
import { Player } from '../js/player.js';
import { B } from '../js/blocks.js';

const world = { getBlock(x, y, z) { return y < 50 ? B.STONE : B.AIR; } };
const STEP = 1 / 60;

function cameraForward(yaw, pitch = 0) {
  const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  cam.rotation.set(pitch, yaw, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  const d = new THREE.Vector3();
  cam.getWorldDirection(d);
  return d;
}

function moveForward(yaw) {
  const p = new Player(world, { x: 8, y: 50, z: 8 });
  p.yaw = yaw;
  const noIn = { forward:false, back:false, left:false, right:false, jump:false, sneak:false, sprint:false };
  for (let i = 0; i < 30; i++) p.update(STEP, noIn);           // settle on ground
  const fwd = { ...noIn, forward: true };
  for (let i = 0; i < 200; i++) p.update(STEP, fwd);           // reach steady speed
  const len = Math.hypot(p.vel.x, p.vel.z) || 1;
  return { x: p.vel.x / len, z: p.vel.z / len };
}

let bad = 0;
for (const deg of [0, 45, 90, 135, 180, 225, 270]) {
  const yaw = deg * Math.PI / 180;
  const cf = cameraForward(yaw);            // true view forward
  const cfx = cf.x, cfz = cf.z;
  const cflen = Math.hypot(cfx, cfz) || 1;
  const camX = cfx / cflen, camZ = cfz / cflen;
  const mv = moveForward(yaw);
  const dot = camX * mv.x + camZ * mv.z;    // +1 = aligned, -1 = opposite
  const ok = dot > 0.99;
  if (!ok) bad++;
  console.log(
    `yaw=${String(deg).padStart(3)}°  camera-fwd=(${camX.toFixed(2)},${camZ.toFixed(2)})  ` +
    `W-move=(${mv.x.toFixed(2)},${mv.z.toFixed(2)})  dot=${dot.toFixed(2)}  ${ok ? 'OK' : 'MISMATCH'}`);
}
console.log(bad === 0 ? '\nPASS: movement matches view' : `\nFAIL: ${bad} yaw angles where W does not go toward the crosshair`);

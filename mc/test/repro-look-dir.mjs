// Repro: does moving the mouse RIGHT pan the rendered view toward screen-right?
// Ground truth = the three.js camera the game builds: camera.rotation.set(pitch,yaw,0,'YXZ').
import * as THREE from '../vendor/three.module.js';

// Minimal DOM stub so Controls can construct.
globalThis.document = { addEventListener() {}, pointerLockElement: null };
const canvas = { addEventListener() {}, requestPointerLock() {} };
const { Controls } = await import('../js/controls.js');

function camFwd(yaw) {
  const cam = new THREE.PerspectiveCamera(70, 1, 0.1, 1000);
  cam.rotation.set(0, yaw, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  const d = new THREE.Vector3(); cam.getWorldDirection(d); return d;
}

const c = new Controls(canvas, {});
const player = { yaw: 0, pitch: 0 };

// Camera's screen-right axis at yaw 0 (facing -Z) is world +X.
const rightAxis = new THREE.Vector3(1, 0, 0);

const before = camFwd(player.yaw);
// Simulate the mouse moving to the RIGHT (positive movementX).
c._look.dx = 50; c._look.dy = 0;
c.applyLook(player);
const after = camFwd(player.yaw);

const pan = after.clone().sub(before);       // how the view forward shifted
const dotRight = pan.dot(rightAxis);
console.log(`yaw ${before === after ? '' : ''}0 -> ${player.yaw.toFixed(3)} after mouse-right`);
console.log(`view forward shifted by (${pan.x.toFixed(3)}, ${pan.z.toFixed(3)})  dot(screen-right)=${dotRight.toFixed(3)}`);
console.log(dotRight > 0 ? 'OK: mouse-right pans view right' : 'BUG: mouse-right pans view LEFT (inverted horizontal look)');

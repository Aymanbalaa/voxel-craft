// Sky & day/night cycle. Drives the shared `daylight` uniform, tints sky+fog,
// and renders sun, moon, stars, and scrolling clouds that track the camera.

import * as THREE from '../vendor/three.module.js';
import { DAY_TICKS, TICKS_PER_SEC } from './config.js';

const DAY_COLOR = new THREE.Color(0x8fbaff);
const NIGHT_COLOR = new THREE.Color(0x0a0e1f);
const SUNSET_COLOR = new THREE.Color(0xffa25a);
const FOG_DAY = new THREE.Color(0xbfd8ff);
const FOG_NIGHT = new THREE.Color(0x0a0e1f);

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export class Sky {
  constructor({ scene, camera, daylight, fogFar }) {
    this.scene = scene; this.camera = camera; this.daylight = daylight;
    this.time = 1000;              // start a bit after dawn (morning)
    this.paused = false;

    // A group that follows the camera so celestial bodies stay "infinitely far".
    this.group = new THREE.Group();
    scene.add(this.group);

    this.sun = this._billboard(this._sunTex(), 60);
    this.moon = this._billboard(this._moonTex(), 42);
    this.group.add(this.sun, this.moon);

    this._buildStars();
    this._buildClouds();

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Color();
  }

  _billboard(tex, size) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(size, size, 1);
    return s;
  }

  _sunTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff7d8';
    g.fillRect(14, 14, 36, 36);          // square sun, MC-style
    g.fillStyle = '#ffe38a';
    g.fillRect(18, 18, 28, 28);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
  }
  _moonTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#dfe6f0'; g.fillRect(16, 16, 32, 32);
    g.fillStyle = '#c2ccdb'; g.fillRect(20, 22, 6, 6); g.fillRect(34, 30, 8, 8); g.fillRect(26, 40, 5, 5);
    const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; return t;
  }

  _buildStars() {
    const N = 800, pos = new Float32Array(N * 3);
    // Deterministic scatter on a big sphere (upper hemisphere biased).
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i*3] = Math.cos(th) * r * 400; pos[i*3+1] = Math.abs(u) * 400; pos[i*3+2] = Math.sin(th) * r * 400;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.group.add(this.stars);
  }

  _buildClouds() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    let seed = 987;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 22; i++) {
      const x = (rnd() * 128) | 0, y = (rnd() * 128) | 0, w = 12 + (rnd() * 30 | 0), h = 8 + (rnd() * 16 | 0);
      g.fillRect(x, y, w, h);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6); tex.magFilter = THREE.NearestFilter;
    this.cloudTex = tex;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: true });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 120;
    this.clouds = plane;
    this.cloudMat = mat;
    this.scene.add(plane);
  }

  setTime(t) { this.time = ((t % DAY_TICKS) + DAY_TICKS) % DAY_TICKS; }
  getTime() { return this.time; }

  update(dt) {
    if (!this.paused) this.time = (this.time + dt * TICKS_PER_SEC) % DAY_TICKS;
    // MC convention: 0 = dawn (sun on E horizon), 6000 = noon, 12000 = dusk, 18000 = midnight.
    const phase = this.time / DAY_TICKS;
    const e = phase * Math.PI * 2;                        // sun elevation angle
    const sunY = Math.sin(e), sunX = Math.cos(e);
    this.sunDir.set(sunX, sunY, 0.25).normalize();

    // Daylight 0.05 (night) .. 1.0 (full day).
    const day = smoothstep(-0.18, 0.28, sunY);
    this.daylight.value = 0.05 + day * 0.95;

    // Sky + fog colors: night → day, with sunset/sunrise orange near the horizon.
    const horizon = 1 - Math.min(1, Math.abs(sunY) / 0.35); // peaks when sun near horizon
    this._tmp.copy(NIGHT_COLOR).lerp(DAY_COLOR, day);
    this._tmp.lerp(SUNSET_COLOR, horizon * 0.5 * (sunY > -0.3 ? 1 : 0));
    this.scene.background.copy(this._tmp);
    if (this.scene.fog) this.scene.fog.color.copy(this._tmp);

    // Position celestial bodies around the camera.
    const cam = this.camera.position;
    this.group.position.set(cam.x, 0, cam.z);
    const R = 300;
    this.sun.position.set(this.sunDir.x * R, this.sunDir.y * R, this.sunDir.z * R);
    this.moon.position.set(-this.sunDir.x * R, -this.sunDir.y * R, -this.sunDir.z * R);
    this.sun.material.opacity = smoothstep(-0.25, 0.05, sunY);
    this.moon.material.opacity = smoothstep(-0.25, 0.05, -sunY);

    // Stars fade in at night.
    this.starMat.opacity = (1 - day) * 0.9;

    // Clouds scroll + follow camera; dim at night.
    this.clouds.position.set(cam.x, 120, cam.z);
    this.cloudTex.offset.x = (this.cloudTex.offset.x + dt * 0.005) % 1;
    this.cloudMat.opacity = 0.15 + day * 0.4;
  }
}

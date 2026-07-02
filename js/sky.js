// js/sky.js
// VoxelCraft — NEON CYBER-GRID atmosphere. Classic script (no ES modules).
// Attaches the global `Sky` class to window. Depends only on global THREE (r128).
//
// Builds the synthwave void:
//   (a) a large BackSide sphere using a vertical canvas-gradient texture (the
//       void background per PALETTE);
//   (b) a banded RETRO SUN on the horizon (additive plane, bright enough to
//       bloom) with a soft additive glow halo;
//   (c) drifting synthwave CLOUD bands near the horizon (large soft additive
//       sprites);
//   (d) a STARFIELD (THREE.Points) high in the dome.
// Also sets scene.fog to the PALETTE fog color.
//
// API:
//   new Sky(scene, renderer)
//   sky.update(dt, camera)   -- keep dome/sun/stars centered on camera; drift
//                               clouds; twinkle stars.

(function () {
  'use strict';

  // ---- PALETTE ------------------------------------------------------------
  var VOID_TOP     = '#1a0633'; // deep purple (top of dome)
  var VOID_MID     = '#3b0a5e'; // horizon purple
  var VOID_GLOW    = '#ff2e88'; // hot magenta glow band near the sun
  var FOG_COLOR    = 0x2a0a4a;  // lower-sky purple haze

  // Retro sun vertical gradient stops.
  var SUN_TOP      = '#ffd36e';
  var SUN_MID      = '#ff5f6d';
  var SUN_BOTTOM   = '#b14bff';

  // Distance of the dome/sun/star sphere from the camera. Kept well inside the
  // camera far plane (1000) so nothing gets clipped.
  var DOME_RADIUS  = 480;

  /**
   * @param {THREE.Scene}          scene
   * @param {THREE.WebGLRenderer}  renderer
   */
  function Sky(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;

    // Root group; everything follows the camera each frame so the player can
    // never reach the dome / sun / stars.
    this.group = new THREE.Group();
    this.group.renderOrder = -1; // draw behind world (alongside fog)
    scene.add(this.group);

    // Animation clocks.
    this._time = 0;

    // Fog: distant grid fades into purple haze.
    scene.fog = new THREE.Fog(FOG_COLOR, 35, DOME_RADIUS * 0.55);
    scene.background = new THREE.Color(FOG_COLOR);

    this._buildDome();
    this._buildSun();
    this._buildClouds();
    this._buildStars();
  }

  // ---------------------------------------------------------------------------
  // (a) Gradient void dome
  // ---------------------------------------------------------------------------
  Sky.prototype._buildDome = function () {
    var tex = this._makeGradientTexture();

    var geo = new THREE.SphereGeometry(DOME_RADIUS, 32, 24);
    var mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });

    this.dome = new THREE.Mesh(geo, mat);
    this.dome.renderOrder = -2;
    this.group.add(this.dome);
  };

  // Vertical canvas gradient: deep purple at top -> horizon purple -> hot
  // magenta glow band near the bottom (the horizon where the sun sits).
  Sky.prototype._makeGradientTexture = function () {
    var canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 256;
    var ctx = canvas.getContext('2d');

    var g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.00, VOID_TOP);
    g.addColorStop(0.45, VOID_MID);
    g.addColorStop(0.78, VOID_MID);
    g.addColorStop(0.90, VOID_GLOW);
    g.addColorStop(1.00, VOID_MID);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 256);

    var tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  };

  // ---------------------------------------------------------------------------
  // (b) Banded retro sun + additive glow halo
  // ---------------------------------------------------------------------------
  Sky.prototype._buildSun = function () {
    var sunTex = this._makeSunTexture();
    var glowTex = this._makeGlowTexture();

    // The sun sits low on the horizon, ahead in -Z by default. It is parented
    // to the group so it tracks the camera position.
    var SUN_SIZE = 150;
    var SUN_DIST = DOME_RADIUS * 0.92;

    var sunMat = new THREE.MeshBasicMaterial({
      map: sunTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });
    var sunGeo = new THREE.PlaneGeometry(SUN_SIZE, SUN_SIZE);
    this.sun = new THREE.Mesh(sunGeo, sunMat);
    this.sun.position.set(0, SUN_SIZE * 0.18, -SUN_DIST);
    this.sun.renderOrder = -1;

    // Soft additive glow halo behind the sun so it blooms generously.
    var glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      opacity: 0.9
    });
    var glowGeo = new THREE.PlaneGeometry(SUN_SIZE * 2.6, SUN_SIZE * 2.6);
    this.sunGlow = new THREE.Mesh(glowGeo, glowMat);
    this.sunGlow.position.copy(this.sun.position);
    this.sunGlow.position.z += 1; // just behind the sun disc
    this.sunGlow.renderOrder = -2;

    this.group.add(this.sunGlow);
    this.group.add(this.sun);
  };

  // Banded sun: vertical gradient disc crossed by dark horizontal gaps that
  // grow toward the bottom (the classic synthwave sun).
  Sky.prototype._makeSunTexture = function () {
    var S = 256;
    var canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    var ctx = canvas.getContext('2d');

    // Clip to a circle so the disc is round.
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    var g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0.00, SUN_TOP);
    g.addColorStop(0.50, SUN_MID);
    g.addColorStop(1.00, SUN_BOTTOM);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    // Dark horizontal gaps. Spacing tightens and gaps thicken toward the lower
    // half so the bands feel like they're sinking below the horizon.
    ctx.globalCompositeOperation = 'destination-out';
    var y = S * 0.55;
    var gap = 4;
    var step = 26;
    while (y < S) {
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(0, y, S, gap);
      gap += 1.6;
      step -= 2.0;
      if (step < 8) step = 8;
      y += step;
    }
    ctx.restore();

    var tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };

  // Radial soft glow used for the sun halo and the cloud bands.
  Sky.prototype._makeGlowTexture = function () {
    var S = 128;
    var canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    var ctx = canvas.getContext('2d');

    var g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.0, 'rgba(255,120,200,0.85)');
    g.addColorStop(0.4, 'rgba(255,60,160,0.40)');
    g.addColorStop(1.0, 'rgba(255,40,140,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    var tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };

  // ---------------------------------------------------------------------------
  // (c) Drifting cloud bands (large soft additive sprites near the horizon)
  // ---------------------------------------------------------------------------
  Sky.prototype._buildClouds = function () {
    this.clouds = [];
    var glowTex = this._makeCloudTexture();

    var tints = [0xff2bd6, 0x18f0ff, 0xb14bff, 0xff7a18];
    var COUNT = 6;
    for (var i = 0; i < COUNT; i++) {
      var mat = new THREE.SpriteMaterial({
        map: glowTex,
        color: tints[i % tints.length],
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.32 + Math.random() * 0.18,
        fog: false
      });
      var spr = new THREE.Sprite(mat);

      var w = 160 + Math.random() * 160;
      var h = w * (0.18 + Math.random() * 0.12);
      spr.scale.set(w, h, 1);

      // Spread around the horizon at a low elevation.
      var ang = Math.random() * Math.PI * 2;
      var r = DOME_RADIUS * 0.8;
      var y = 10 + Math.random() * 70;
      spr.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);

      // Store drift parameters.
      spr.userData.angle = ang;
      spr.userData.radius = r;
      spr.userData.y = y;
      spr.userData.speed = 0.006 + Math.random() * 0.012; // rad/sec
      spr.renderOrder = -1;

      this.clouds.push(spr);
      this.group.add(spr);
    }
  };

  // Soft horizontal cloud-band texture (elongated radial smear).
  Sky.prototype._makeCloudTexture = function () {
    var W = 256, H = 64;
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');

    var g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    // Squash vertically so it reads as a band.
    ctx.save();
    ctx.translate(0, H / 2);
    ctx.scale(1, 0.5);
    ctx.translate(0, -H / 2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    var tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };

  // ---------------------------------------------------------------------------
  // (d) Starfield
  // ---------------------------------------------------------------------------
  Sky.prototype._buildStars = function () {
    var COUNT = 900;
    var positions = new Float32Array(COUNT * 3);
    var colors = new Float32Array(COUNT * 3);

    var cyan = new THREE.Color(0x18f0ff);
    var white = new THREE.Color(0xffffff);
    var tmp = new THREE.Color();

    for (var i = 0; i < COUNT; i++) {
      // Distribute on the upper hemisphere of a slightly inner sphere.
      var u = Math.random();
      var v = Math.random() * 0.75 + 0.05; // bias upward, avoid horizon clutter
      var theta = u * Math.PI * 2;
      var phi = Math.acos(v); // 0=up
      var r = DOME_RADIUS * 0.95;

      var x = r * Math.sin(phi) * Math.cos(theta);
      var y = r * Math.cos(phi);
      var z = r * Math.sin(phi) * Math.sin(theta);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      tmp.copy(Math.random() < 0.3 ? cyan : white);
      colors[i * 3 + 0] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    var mat = new THREE.PointsMaterial({
      size: 2.2,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      fog: false
    });

    this.stars = new THREE.Points(geo, mat);
    this.stars.renderOrder = -1;
    this.group.add(this.stars);
  };

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt      seconds since last frame
   * @param {THREE.Camera} camera
   */
  Sky.prototype.update = function (dt, camera) {
    if (!dt || dt < 0) dt = 0;
    this._time += dt;

    // Keep the whole dome centered on the camera so it reads as infinitely far.
    if (camera && camera.position) {
      this.group.position.copy(camera.position);
    }

    // Drift cloud bands slowly around the horizon.
    if (this.clouds) {
      for (var i = 0; i < this.clouds.length; i++) {
        var c = this.clouds[i];
        c.userData.angle += c.userData.speed * dt;
        var a = c.userData.angle;
        var r = c.userData.radius;
        c.position.set(Math.cos(a) * r, c.userData.y, Math.sin(a) * r);
      }
    }

    // Slowly rotate the starfield and gently twinkle its overall opacity.
    if (this.stars) {
      this.stars.rotation.y += dt * 0.01;
      var tw = 0.78 + 0.18 * Math.sin(this._time * 1.7);
      this.stars.material.opacity = tw;
    }

    // Subtle sun glow pulse so the bloom shimmers.
    if (this.sunGlow) {
      this.sunGlow.material.opacity = 0.8 + 0.12 * Math.sin(this._time * 0.9);
    }
  };

  window.Sky = Sky;
})();

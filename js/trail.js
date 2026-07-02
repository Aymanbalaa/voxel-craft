// js/trail.js
// VoxelCraft — THE SIGNATURE TWIST: "Light Ribbon" (Tron light-cycle homage).
//
// Classic script: attaches the global `Trail` class to window. Relies on the
// global THREE (r128). No ES modules.
//
// Two modes:
//   EPHEMERAL (default): while the player is moving, drop glowing additive neon
//     segments at the player's feet. Each segment fades + shrinks over ~1.5s
//     (brighter/longer when sprinting) then is recycled. Pooled, capped at ~200.
//   SOLID (light-bridge): when the player enters a NEW integer feet cell, place a
//     real block via world.setBlock(x, y, z, selectedId) so you build glowing
//     light-bridges as you ride. The last cell is tracked to avoid duplicate
//     placements.
//
// API (confirmed for the wiring engineer):
//   new Trail(scene, world)
//   trail.update(dt, player, opts)
//       player: { position: THREE.Vector3, velocity: THREE.Vector3 }
//       opts:   { sprinting: bool, selectedId: number, selectedColorHex: number }
//   trail.setSolidMode(bool)
//   trail.toggleSolidMode() -> bool   (returns the NEW state)
//   trail.dispose()
//   Properties: trail.solidMode (bool)

(function () {
  'use strict';

  // --- Tunables -------------------------------------------------------------

  // Pool cap. Never exceed this many live/recycled segments.
  var MAX_SEGMENTS = 200;

  // Base lifetime of a dropped segment (seconds). Sprinting lengthens it.
  var BASE_LIFE = 1.5;
  var SPRINT_LIFE = 2.1;

  // Minimum movement speed (blocks/s) before we consider the player "moving".
  var MOVE_THRESHOLD = 0.6;

  // Minimum horizontal distance traveled between drops (blocks). Keeps the
  // ribbon evenly spaced regardless of frame rate.
  var DROP_SPACING = 0.45;

  // Eye-to-feet offset. Player.position is the EYE; segments live at the feet.
  // Prefer the value the Player class exposes; fall back to the contract value.
  var EYE_HEIGHT = (typeof Player !== 'undefined' && typeof Player.EYE_HEIGHT === 'number')
    ? Player.EYE_HEIGHT
    : 1.62;

  // Default neon color if opts.selectedColorHex is missing.
  var DEFAULT_COLOR = 0x18f0ff; // neon cyan

  // Segment box dimensions (world units). Sprinting makes them a touch longer.
  var SEG_BASE_SIZE = 0.55;
  var SEG_SPRINT_SIZE = 0.8;

  // --- Helpers --------------------------------------------------------------

  function clamp01(v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  /**
   * @param {THREE.Scene} scene
   * @param {World}       world  - exposes setBlock(x,y,z,id)
   */
  function Trail(scene, world) {
    this.scene = scene;
    this.world = world;

    // Mode flag. false = ephemeral ribbon, true = solid light-bridge.
    this.solidMode = false;

    // Pool of segment objects: { mesh, age, life, baseSize, active }.
    this._pool = [];
    // Indices of inactive (recyclable) pool entries.
    this._free = [];

    // Distance accumulated since the last ribbon drop.
    this._sinceDrop = DROP_SPACING; // start ready so the first move drops immediately

    // Last feet position used for spacing math.
    this._lastDropX = null;
    this._lastDropZ = null;

    // Last feet cell placed in SOLID mode (avoid duplicate setBlock calls).
    this._lastCellX = null;
    this._lastCellY = null;
    this._lastCellZ = null;

    // Shared unit-cube geometry for all segments (cheap; we scale per-segment).
    this._geom = new THREE.BoxGeometry(1, 1, 1);

    // Reusable color object to recolor materials without per-frame allocation.
    this._color = new THREE.Color();
  }

  // --- Pooling --------------------------------------------------------------

  // Get a recyclable segment, or create a new one if under the cap. Returns
  // null only if the cap is reached and nothing is free (then we recycle the
  // oldest live segment instead — see _drop).
  Trail.prototype._acquire = function () {
    if (this._free.length > 0) {
      var idx = this._free.pop();
      return this._pool[idx];
    }
    if (this._pool.length < MAX_SEGMENTS) {
      var mat = new THREE.MeshBasicMaterial({
        color: DEFAULT_COLOR,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      var mesh = new THREE.Mesh(this._geom, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 998; // under the interaction highlight (999)
      if (this.scene && this.scene.add) this.scene.add(mesh);
      var seg = { mesh: mesh, age: 0, life: BASE_LIFE, baseSize: SEG_BASE_SIZE, active: false };
      this._pool.push(seg);
      return seg;
    }
    return null;
  };

  // Recycle the oldest (largest age/life ratio) active segment so we can reuse it.
  Trail.prototype._reclaimOldest = function () {
    var best = null;
    var bestRatio = -1;
    for (var i = 0; i < this._pool.length; i++) {
      var s = this._pool[i];
      if (!s.active) continue;
      var r = s.life > 0 ? s.age / s.life : 1;
      if (r > bestRatio) { bestRatio = r; best = s; }
    }
    return best;
  };

  Trail.prototype._deactivate = function (seg, idx) {
    seg.active = false;
    seg.mesh.visible = false;
    this._free.push(idx);
  };

  // --- Ribbon drop (ephemeral mode) ----------------------------------------

  Trail.prototype._drop = function (fx, fy, fz, colorHex, sprinting) {
    var seg = this._acquire();
    if (!seg) {
      // Cap hit and nothing free: steal the oldest live segment.
      seg = this._reclaimOldest();
      if (!seg) return;
    }

    seg.active = true;
    seg.age = 0;
    seg.life = sprinting ? SPRINT_LIFE : BASE_LIFE;
    seg.baseSize = sprinting ? SEG_SPRINT_SIZE : SEG_BASE_SIZE;

    var mesh = seg.mesh;
    // Position the segment just above the feet so it reads as a ground ribbon.
    mesh.position.set(fx, fy + 0.06, fz);

    // Slight random spin so the ribbon shimmers rather than looking gridded.
    mesh.rotation.y = Math.random() * Math.PI;

    // Recolor.
    this._color.set(typeof colorHex === 'number' ? colorHex : DEFAULT_COLOR);
    mesh.material.color.copy(this._color);
    mesh.material.opacity = 1;

    // Flattened cube — a glowing tile/ribbon segment.
    mesh.scale.set(seg.baseSize, seg.baseSize * 0.28, seg.baseSize);
    mesh.visible = true;
  };

  // Advance all live segments: fade + shrink, recycle when expired.
  Trail.prototype._ageSegments = function (dt) {
    for (var i = 0; i < this._pool.length; i++) {
      var s = this._pool[i];
      if (!s.active) continue;
      s.age += dt;
      var t = s.life > 0 ? s.age / s.life : 1;
      if (t >= 1) {
        this._deactivate(s, i);
        continue;
      }
      var k = clamp01(1 - t); // 1 -> 0 over the lifetime
      // Ease-out fade for a softer tail.
      s.mesh.material.opacity = k * k;
      var size = s.baseSize * (0.25 + 0.75 * k); // shrink toward 25% of base
      s.mesh.scale.set(size, size * 0.28, size);
    }
  };

  // --- Solid mode (light-bridge) -------------------------------------------

  Trail.prototype._placeBridge = function (fx, fy, fz, selectedId) {
    // The cell directly under the player's feet. Feet sit on top of the floor,
    // so the supporting cell is at floor(fy - epsilon). We place AT the feet
    // cell (floor(fy)) which forms a bridge surface the player can ride across.
    var cx = Math.floor(fx);
    var cy = Math.floor(fy - 1e-4) - 0; // cell whose top the feet rest on
    var cz = Math.floor(fz);

    if (cx === this._lastCellX && cy === this._lastCellY && cz === this._lastCellZ) {
      return; // already placed here this stride
    }
    this._lastCellX = cx;
    this._lastCellY = cy;
    this._lastCellZ = cz;

    // Only place a real block into empty space. If it's already solid (e.g. the
    // ground we're standing on) leave it alone.
    if (!this.world || typeof this.world.setBlock !== 'function') return;
    var id = (typeof selectedId === 'number' && selectedId > 0) ? selectedId : null;
    if (id === null) return;

    var getBlock = (typeof this.world.getBlock === 'function') ? this.world.getBlock.bind(this.world) : null;
    if (getBlock) {
      var existing = getBlock(cx, cy, cz);
      var airId = (typeof AIR !== 'undefined') ? AIR : 0;
      if (existing !== airId && existing !== 0) return; // don't overwrite solids
    }
    this.world.setBlock(cx, cy, cz, id);
  };

  // --- Public update --------------------------------------------------------

  /**
   * @param {number} dt
   * @param {{position:THREE.Vector3, velocity:THREE.Vector3}} player
   * @param {{sprinting?:boolean, selectedId?:number, selectedColorHex?:number}} [opts]
   */
  Trail.prototype.update = function (dt, player, opts) {
    if (!dt || dt < 0) dt = 0;
    opts = opts || {};

    // Always age existing ribbon segments so they fade even when standing still.
    this._ageSegments(dt);

    if (!player || !player.position) return;

    var sprinting = !!opts.sprinting;
    var colorHex = (typeof opts.selectedColorHex === 'number') ? opts.selectedColorHex : DEFAULT_COLOR;
    var selectedId = (typeof opts.selectedId === 'number') ? opts.selectedId : null;

    // Feet position derived from the eye position.
    var fx = player.position.x;
    var fy = player.position.y - EYE_HEIGHT;
    var fz = player.position.z;

    // Determine horizontal speed for the move check.
    var vx = 0, vz = 0;
    if (player.velocity) { vx = player.velocity.x || 0; vz = player.velocity.z || 0; }
    var hSpeed = Math.sqrt(vx * vx + vz * vz);
    var moving = hSpeed > MOVE_THRESHOLD;

    if (this.solidMode) {
      // SOLID MODE: build a light-bridge as the player crosses new cells.
      if (moving) {
        this._placeBridge(fx, fy, fz, selectedId);
      }
      // While in solid mode we still allow the existing ribbon segments to fade
      // out (handled by _ageSegments above) but stop dropping new ones.
      return;
    }

    // EPHEMERAL MODE: drop spaced ribbon segments while moving.
    if (this._lastDropX === null) {
      this._lastDropX = fx;
      this._lastDropZ = fz;
    }

    if (moving) {
      var ddx = fx - this._lastDropX;
      var ddz = fz - this._lastDropZ;
      this._sinceDrop += Math.sqrt(ddx * ddx + ddz * ddz);
      this._lastDropX = fx;
      this._lastDropZ = fz;

      if (this._sinceDrop >= DROP_SPACING) {
        this._sinceDrop = 0;
        this._drop(fx, fy, fz, colorHex, sprinting);
      }
    } else {
      // Not moving: keep the spacing tracker pinned to the current spot so the
      // first step after stopping drops promptly.
      this._lastDropX = fx;
      this._lastDropZ = fz;
      this._sinceDrop = DROP_SPACING;
    }
  };

  // --- Mode control ---------------------------------------------------------

  /** Explicitly set solid (light-bridge) mode on/off. */
  Trail.prototype.setSolidMode = function (on) {
    this.solidMode = !!on;
    if (this.solidMode) {
      // Reset the last-cell tracker so re-entering solid mode places again.
      this._lastCellX = this._lastCellY = this._lastCellZ = null;
    }
    return this.solidMode;
  };

  /** Toggle solid mode. Returns the NEW state (true = solid/light-bridge). */
  Trail.prototype.toggleSolidMode = function () {
    return this.setSolidMode(!this.solidMode);
  };

  // --- Cleanup --------------------------------------------------------------

  Trail.prototype.dispose = function () {
    for (var i = 0; i < this._pool.length; i++) {
      var m = this._pool[i].mesh;
      if (this.scene && this.scene.remove) this.scene.remove(m);
      if (m.material && m.material.dispose) m.material.dispose();
    }
    this._pool.length = 0;
    this._free.length = 0;
    if (this._geom && this._geom.dispose) this._geom.dispose();
    this._geom = null;
  };

  // Attach to global (classic script style).
  window.Trail = Trail;
})();

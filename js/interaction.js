// js/interaction.js
// VoxelCraft — block interaction (targeting, breaking, placing, hotbar selection).
//
// Classic script: attaches the global `Interaction` class to `window`.
// Depends on globals provided elsewhere: THREE, World (instance passed in),
// BLOCKS, HOTBAR (ordered array of block ids), AIR (=0), getBlockById().
//
// Coordinate system (per CONTRACT.md): Y is up. A block at integer coords
// (x,y,z) occupies the unit cube from (x,y,z) to (x+1,y+1,z+1).
// Block coords from world coords use Math.floor.

(function () {
  'use strict';

  // Maximum reach distance (in blocks/world units) for the raycast.
  var REACH = 6;

  // Player AABB dimensions used to avoid placing a block inside the player.
  // Matches the player box described in the contract (~0.6 wide, ~1.8 tall,
  // eye ~1.62 from feet).
  var PLAYER_HALF_WIDTH = 0.3; // half of 0.6
  var PLAYER_HEIGHT = 1.8;
  var PLAYER_EYE_HEIGHT = 1.62; // eye offset above the feet

  /**
   * Interaction handles voxel raycasting, breaking/placing blocks, the
   * wireframe target highlight, and hotbar slot selection.
   *
   * @param {World}        world    - world instance (getBlock/setBlock).
   * @param {THREE.Camera} camera   - the player camera (provides eye pos + forward).
   * @param {Controls}     controls - controls instance (provides isLocked).
   * @param {Player}       [player] - optional player ref for accurate AABB checks.
   *                                  If omitted, the player box is derived from
   *                                  the camera position.
   */
  function Interaction(world, camera, controls, player) {
    this.world = world;
    this.camera = camera;
    this.controls = controls;
    this.player = player || null;

    // Hotbar selection state.
    this.selectedSlot = 0;
    this.selectedId = HOTBAR[this.selectedSlot];

    // Optional callback invoked when the selected slot changes: onSelect(slot).
    this.onSelect = null;

    // Current raycast target. When nothing is targeted, `target` is null.
    // target = { x, y, z, nx, ny, nz } where (x,y,z) is the hit block and
    // (nx,ny,nz) is the face normal of entry (points back toward the camera).
    this.target = null;

    // Reusable scratch vectors to avoid per-frame allocation.
    this._origin = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    // Build the wireframe highlight box (unit cube edges). It is added to the
    // scene and toggled visible depending on whether something is targeted.
    this._buildHighlight();

    // Wire up input listeners.
    this._bindEvents();
  }

  // ---------------------------------------------------------------------------
  // Highlight box
  // ---------------------------------------------------------------------------

  Interaction.prototype._buildHighlight = function () {
    // EdgesGeometry of a unit box, slightly inflated so the lines sit just
    // outside the block surface and don't z-fight with the chunk mesh.
    var box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    var edges = new THREE.EdgesGeometry(box);
    box.dispose();

    // Glowing neon-cyan target highlight (synthwave palette #18f0ff).
    // Additive blending + depthWrite off so the edges read as a bright,
    // self-lit outline that pops against dark blocks and feeds bloom.
    var mat = new THREE.LineBasicMaterial({
      color: 0x18f0ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      linewidth: 2 // honored where supported; ignored gracefully otherwise
    });

    this.highlight = new THREE.LineSegments(edges, mat);
    this.highlight.visible = false;
    // Don't let the highlight be considered for any future raycasts/culling.
    this.highlight.renderOrder = 999;

    // Add to the world's scene. The world stores its scene reference; fall back
    // gracefully if it isn't exposed.
    var scene = this.world && this.world.scene ? this.world.scene : null;
    if (scene && scene.add) {
      scene.add(this.highlight);
    }
    this._scene = scene;
  };

  // ---------------------------------------------------------------------------
  // Event binding
  // ---------------------------------------------------------------------------

  Interaction.prototype._bindEvents = function () {
    var self = this;

    // Mouse buttons: left = break, right = place. Only act while pointer-locked.
    this._onMouseDown = function (e) {
      if (!self.controls || !self.controls.isLocked) return;
      if (e.button === 0) {
        self.breakBlock();
      } else if (e.button === 2) {
        self.placeBlock();
      }
    };
    document.addEventListener('mousedown', this._onMouseDown, false);

    // Suppress the context menu so right-click can be used to place blocks.
    this._onContextMenu = function (e) {
      e.preventDefault();
    };
    document.addEventListener('contextmenu', this._onContextMenu, false);

    // Mouse wheel cycles the hotbar slot.
    this._onWheel = function (e) {
      if (!self.controls || !self.controls.isLocked) return;
      var dir = e.deltaY > 0 ? 1 : -1;
      self.cycleSlot(dir);
    };
    document.addEventListener('wheel', this._onWheel, { passive: true });

    // Number keys 1..8 select hotbar slots directly.
    this._onKeyDown = function (e) {
      // e.code like "Digit1".."Digit8"; fall back to e.key for robustness.
      var n = null;
      if (e.code && e.code.indexOf('Digit') === 0) {
        n = parseInt(e.code.slice(5), 10);
      } else if (e.key && e.key.length === 1 && e.key >= '1' && e.key <= '9') {
        n = parseInt(e.key, 10);
      }
      if (n !== null && n >= 1 && n <= HOTBAR.length && n <= 8) {
        self.setSlot(n - 1);
      }
    };
    document.addEventListener('keydown', this._onKeyDown, false);
  };

  // ---------------------------------------------------------------------------
  // Hotbar selection
  // ---------------------------------------------------------------------------

  /** Set the selected slot to an absolute index (clamped/wrapped to HOTBAR). */
  Interaction.prototype.setSlot = function (slot) {
    var n = HOTBAR.length;
    if (n <= 0) return;
    // Wrap into range.
    slot = ((slot % n) + n) % n;
    if (slot === this.selectedSlot) return;
    this.selectedSlot = slot;
    this.selectedId = HOTBAR[slot];
    if (typeof this.onSelect === 'function') {
      this.onSelect(this.selectedSlot);
    }
  };

  /** Move the selected slot by +/- steps (wrapping). */
  Interaction.prototype.cycleSlot = function (delta) {
    this.setSlot(this.selectedSlot + delta);
  };

  // ---------------------------------------------------------------------------
  // Raycasting (voxel DDA / Amanatides & Woo)
  // ---------------------------------------------------------------------------

  /**
   * Cast a ray from the camera eye along the camera forward direction and find
   * the first solid (non-air) block within REACH units.
   *
   * @returns {?{x:number,y:number,z:number,nx:number,ny:number,nz:number}}
   *   The hit block coords plus the face normal of entry, or null if nothing
   *   was hit within reach.
   */
  Interaction.prototype.raycast = function () {
    // Ray origin: camera world position (the eye).
    this.camera.getWorldPosition(this._origin);
    // Ray direction: camera forward (-Z in camera space), normalized.
    this.camera.getWorldDirection(this._dir);

    var ox = this._origin.x, oy = this._origin.y, oz = this._origin.z;
    var dx = this._dir.x, dy = this._dir.y, dz = this._dir.z;

    // Current voxel coordinates (the block containing the origin).
    var x = Math.floor(ox);
    var y = Math.floor(oy);
    var z = Math.floor(oz);

    // Step direction along each axis.
    var stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    var stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
    var stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);

    // tDelta: distance (in t, where position = origin + t*dir) to cross one
    // full voxel along each axis. tMax: distance to the next voxel boundary.
    var tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    var tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    var tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

    var tMaxX = boundaryT(ox, dx, x, stepX);
    var tMaxY = boundaryT(oy, dy, y, stepY);
    var tMaxZ = boundaryT(oz, dz, z, stepZ);

    // Face normal of the entry plane for the current voxel. Starts at zero
    // (origin voxel has no entry face); set as we step across boundaries.
    var nx = 0, ny = 0, nz = 0;

    // If the very origin voxel is already solid, target it (no entry face).
    if (this.world.getBlock(x, y, z) !== AIR) {
      return { x: x, y: y, z: z, nx: 0, ny: 0, nz: 0 };
    }

    // March until we exceed the reach distance.
    while (true) {
      // Advance to whichever axis boundary is nearest.
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        if (tMaxX > REACH) break;
        x += stepX;
        tMaxX += tDeltaX;
        nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        if (tMaxY > REACH) break;
        y += stepY;
        tMaxY += tDeltaY;
        nx = 0; ny = -stepY; nz = 0;
      } else {
        if (tMaxZ > REACH) break;
        z += stepZ;
        tMaxZ += tDeltaZ;
        nx = 0; ny = 0; nz = -stepZ;
      }

      if (this.world.getBlock(x, y, z) !== AIR) {
        return { x: x, y: y, z: z, nx: nx, ny: ny, nz: nz };
      }
    }

    return null;
  };

  /**
   * Distance (in ray parameter t) from the origin to the first voxel boundary
   * along one axis.
   */
  function boundaryT(o, d, cell, step) {
    if (d === 0) return Infinity;
    // Boundary coordinate: the next integer plane in the step direction.
    var boundary = step > 0 ? cell + 1 : cell;
    return (boundary - o) / d;
  }

  // ---------------------------------------------------------------------------
  // Break / place
  // ---------------------------------------------------------------------------

  /** Break the currently targeted block (set it to AIR). */
  Interaction.prototype.breakBlock = function () {
    var t = this.target || this.raycast();
    if (!t) return false;
    this.world.setBlock(t.x, t.y, t.z, AIR);
    // Re-target after the change so the highlight updates promptly.
    this.target = this.raycast();
    return true;
  };

  /**
   * Place the selected block on the face adjacent to the targeted block.
   * Skips placement if the destination cell overlaps the player's AABB or is
   * already occupied.
   */
  Interaction.prototype.placeBlock = function () {
    var t = this.target || this.raycast();
    if (!t) return false;

    // Destination = neighbor cell across the entry face.
    var px = t.x + t.nx;
    var py = t.y + t.ny;
    var pz = t.z + t.nz;

    // If the entry face was undefined (origin voxel), there's nowhere to place.
    if (t.nx === 0 && t.ny === 0 && t.nz === 0) return false;

    // Don't replace an existing solid block.
    if (this.world.getBlock(px, py, pz) !== AIR) return false;

    // Don't place inside the player.
    if (this._overlapsPlayer(px, py, pz)) return false;

    this.world.setBlock(px, py, pz, this.selectedId);
    this.target = this.raycast();
    return true;
  };

  /**
   * Returns true if the unit cube at integer coords (bx,by,bz) intersects the
   * player's AABB. Uses the player ref if available, otherwise derives the box
   * from the camera (eye) position.
   */
  Interaction.prototype._overlapsPlayer = function (bx, by, bz) {
    var feetX, feetY, feetZ; // feet/base position of the player box

    if (this.player && this.player.position) {
      // player.position is the eye; feet are PLAYER_EYE_HEIGHT below it.
      feetX = this.player.position.x;
      feetY = this.player.position.y - PLAYER_EYE_HEIGHT;
      feetZ = this.player.position.z;
    } else {
      // Fall back to the camera position as the eye.
      this.camera.getWorldPosition(this._origin);
      feetX = this._origin.x;
      feetY = this._origin.y - PLAYER_EYE_HEIGHT;
      feetZ = this._origin.z;
    }

    // Player AABB (world space).
    var pMinX = feetX - PLAYER_HALF_WIDTH;
    var pMaxX = feetX + PLAYER_HALF_WIDTH;
    var pMinY = feetY;
    var pMaxY = feetY + PLAYER_HEIGHT;
    var pMinZ = feetZ - PLAYER_HALF_WIDTH;
    var pMaxZ = feetZ + PLAYER_HALF_WIDTH;

    // Block AABB (the unit cube).
    var bMinX = bx, bMaxX = bx + 1;
    var bMinY = by, bMaxY = by + 1;
    var bMinZ = bz, bMaxZ = bz + 1;

    // Standard AABB overlap test on all three axes.
    return (
      pMinX < bMaxX && pMaxX > bMinX &&
      pMinY < bMaxY && pMaxY > bMinY &&
      pMinZ < bMaxZ && pMaxZ > bMinZ
    );
  };

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  /**
   * Re-cast the targeting ray and update the wireframe highlight. Call once per
   * frame from the main loop after the player/camera have been updated.
   */
  Interaction.prototype.update = function () {
    this.target = this.raycast();

    if (this.target && this.highlight) {
      // Center the unit-cube wireframe on the targeted block.
      this.highlight.position.set(
        this.target.x + 0.5,
        this.target.y + 0.5,
        this.target.z + 0.5
      );
      this.highlight.visible = true;
    } else if (this.highlight) {
      this.highlight.visible = false;
    }
  };

  // ---------------------------------------------------------------------------
  // Cleanup (optional, used if the game is torn down)
  // ---------------------------------------------------------------------------

  Interaction.prototype.dispose = function () {
    document.removeEventListener('mousedown', this._onMouseDown, false);
    document.removeEventListener('contextmenu', this._onContextMenu, false);
    document.removeEventListener('wheel', this._onWheel, false);
    document.removeEventListener('keydown', this._onKeyDown, false);
    if (this.highlight) {
      if (this._scene && this._scene.remove) this._scene.remove(this.highlight);
      if (this.highlight.geometry) this.highlight.geometry.dispose();
      if (this.highlight.material) this.highlight.material.dispose();
      this.highlight = null;
    }
  };

  // Expose globally (classic script style).
  window.Interaction = Interaction;
})();

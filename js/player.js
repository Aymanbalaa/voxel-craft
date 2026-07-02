// js/player.js
// VoxelCraft — Player physics & camera controller.
// Classic script: attaches the global `Player` class to window. Relies on global THREE.
//
// Per CONTRACT.md:
//   new Player(world, camera)
//   - position (THREE.Vector3, EYE position; spawned above terrain at world center)
//   - velocity (THREE.Vector3)
//   - update(dt, input): yaw-relative WASD movement, gravity, jump when grounded,
//     axis-by-axis AABB collision (box ~0.6 wide x 1.8 tall, eye 1.62 from feet)
//     using world.getBlock. Drives camera.position (eye) and camera.rotation
//     (order 'YXZ') from input.yaw/input.pitch.

(function () {
  'use strict';

  // --- Tunable physics / dimensions ---------------------------------------
  var PLAYER_WIDTH = 0.6;      // full width (X and Z extent)
  var PLAYER_HEIGHT = 1.8;     // full height (feet -> top of head)
  var EYE_HEIGHT = 1.62;       // eye offset from feet
  var HALF_WIDTH = PLAYER_WIDTH / 2;

  var GRAVITY = 28;            // blocks / s^2 (snappier than real gravity, feels good)
  var WALK_SPEED = 4.8;        // blocks / s
  var SPRINT_SPEED = 7.5;      // blocks / s
  var JUMP_SPEED = 9.0;        // blocks / s initial upward velocity
  var TERMINAL_VELOCITY = 60;  // cap downward speed to avoid tunnelling

  // Small epsilon to keep the AABB just shy of block faces after resolving.
  var EPS = 1e-3;

  /**
   * @param {World}  world   - voxel world exposing getBlock(x,y,z) -> id (0 = AIR)
   * @param {THREE.Camera} camera
   */
  function Player(world, camera) {
    this.world = world;
    this.camera = camera;

    // EYE position in world space.
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();

    this.onGround = false;

    // Ensure the camera uses yaw(Y) then pitch(X) rotation order.
    if (this.camera) {
      this.camera.rotation.order = 'YXZ';
    }

    this._spawn();
  }

  // --- Block solidity ------------------------------------------------------
  // A block is "solid" for collision if it is not air and not a non-colliding
  // block. WATER (if defined) is treated as passable so the player can wade/sink
  // gracefully rather than standing on the surface.
  Player.prototype._isSolid = function (x, y, z) {
    var id = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    if (id === 0 || id === (typeof AIR !== 'undefined' ? AIR : 0)) return false;

    // Treat water as non-solid (passable) if the block table is available.
    if (typeof BLOCKS !== 'undefined' && BLOCKS.WATER && id === BLOCKS.WATER.id) {
      return false;
    }
    return true;
  };

  // --- Spawn ---------------------------------------------------------------
  // Sample the column at world center downward to find the highest solid block,
  // then place the player's feet just above it (eye = feet + EYE_HEIGHT).
  Player.prototype._spawn = function () {
    var cx = 0.5; // world center (X). Origin chunk straddles 0; 0.5 centers in a block.
    var cz = 0.5; // world center (Z)

    // Determine the search ceiling from world height if exposed.
    var top = 64;
    if (this.world) {
      if (typeof this.world.WORLD_HEIGHT === 'number') top = this.world.WORLD_HEIGHT;
      else if (typeof World !== 'undefined' && typeof World.WORLD_HEIGHT === 'number') top = World.WORLD_HEIGHT;
    }

    var groundY = 0; // feet land here if nothing found
    for (var y = top; y >= 0; y--) {
      if (this._isSolid(cx, y, cz)) {
        groundY = y + 1; // feet rest on top of this block (block spans y..y+1)
        break;
      }
    }

    // position is the EYE. Feet = groundY, eye = groundY + EYE_HEIGHT.
    this.position.set(cx, groundY + EYE_HEIGHT, cz);
    this.velocity.set(0, 0, 0);
    this.onGround = false;
  };

  // --- AABB helpers --------------------------------------------------------
  // Given the current eye position, derive the feet position.
  Player.prototype._feetY = function () {
    return this.position.y - EYE_HEIGHT;
  };

  // Check whether the player's AABB (positioned with feet at feetY, centered at
  // px,pz on the horizontal plane) intersects any solid block.
  Player.prototype._collides = function (px, feetY, pz) {
    var minX = px - HALF_WIDTH;
    var maxX = px + HALF_WIDTH;
    var minY = feetY;
    var maxY = feetY + PLAYER_HEIGHT;
    var minZ = pz - HALF_WIDTH;
    var maxZ = pz + HALF_WIDTH;

    var x0 = Math.floor(minX), x1 = Math.floor(maxX);
    var y0 = Math.floor(minY), y1 = Math.floor(maxY);
    var z0 = Math.floor(minZ), z1 = Math.floor(maxZ);

    for (var bx = x0; bx <= x1; bx++) {
      for (var by = y0; by <= y1; by++) {
        for (var bz = z0; bz <= z1; bz++) {
          if (this._isSolid(bx, by, bz)) return true;
        }
      }
    }
    return false;
  };

  // --- Update --------------------------------------------------------------
  /**
   * @param {number} dt - delta time in seconds
   * @param {object} input - Controls.getInput() output
   */
  Player.prototype.update = function (dt, input) {
    if (!input) input = {};

    // Clamp dt to avoid large physics steps (e.g. after a tab switch).
    if (dt > 0.1) dt = 0.1;

    var yaw = input.yaw || 0;
    var pitch = input.pitch || 0;

    // --- Desired horizontal movement, relative to yaw -----------------------
    // Forward vector on the XZ plane derived from yaw.
    // With camera order 'YXZ', yaw rotates about +Y; "forward" (-Z in camera
    // space) maps to world (-sin(yaw), 0, -cos(yaw)).
    var sinY = Math.sin(yaw);
    var cosY = Math.cos(yaw);

    var forwardX = -sinY;
    var forwardZ = -cosY;
    // Right vector is forward rotated -90deg about Y.
    var rightX = cosY;
    var rightZ = -sinY;

    var moveX = 0;
    var moveZ = 0;
    if (input.forward) { moveX += forwardX; moveZ += forwardZ; }
    if (input.back)    { moveX -= forwardX; moveZ -= forwardZ; }
    if (input.right)   { moveX += rightX;   moveZ += rightZ; }
    if (input.left)    { moveX -= rightX;   moveZ -= rightZ; }

    // Normalize horizontal direction so diagonals aren't faster.
    var len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    var speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
    if (len > 1e-6) {
      moveX = (moveX / len) * speed;
      moveZ = (moveZ / len) * speed;
    } else {
      moveX = 0;
      moveZ = 0;
    }

    this.velocity.x = moveX;
    this.velocity.z = moveZ;

    // --- Gravity -----------------------------------------------------------
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -TERMINAL_VELOCITY) this.velocity.y = -TERMINAL_VELOCITY;

    // --- Jump --------------------------------------------------------------
    if (input.jump && this.onGround) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    // --- Axis-by-axis collision resolution ---------------------------------
    // Work in feet-space for the vertical AABB, then write the eye back.
    var px = this.position.x;
    var pz = this.position.z;
    var feetY = this._feetY();

    var dx = this.velocity.x * dt;
    var dy = this.velocity.y * dt;
    var dz = this.velocity.z * dt;

    // X axis
    if (dx !== 0) {
      var nx = px + dx;
      if (this._collides(nx, feetY, pz)) {
        // Snap flush against the block face.
        if (dx > 0) {
          nx = Math.floor(nx + HALF_WIDTH) - HALF_WIDTH - EPS;
        } else {
          nx = Math.ceil(nx - HALF_WIDTH) + HALF_WIDTH + EPS;
        }
        // Only accept the snap if it actually clears the collision.
        if (!this._collides(nx, feetY, pz)) px = nx;
        this.velocity.x = 0;
      } else {
        px = nx;
      }
    }

    // Z axis
    if (dz !== 0) {
      var nz = pz + dz;
      if (this._collides(px, feetY, nz)) {
        if (dz > 0) {
          nz = Math.floor(nz + HALF_WIDTH) - HALF_WIDTH - EPS;
        } else {
          nz = Math.ceil(nz - HALF_WIDTH) + HALF_WIDTH + EPS;
        }
        if (!this._collides(px, feetY, nz)) pz = nz;
        this.velocity.z = 0;
      } else {
        pz = nz;
      }
    }

    // Y axis
    this.onGround = false;
    if (dy !== 0) {
      var nfeetY = feetY + dy;
      if (this._collides(px, nfeetY, pz)) {
        if (dy > 0) {
          // Moving up — bonk head. Snap below the ceiling block.
          nfeetY = Math.floor(nfeetY + PLAYER_HEIGHT) - PLAYER_HEIGHT - EPS;
          if (this._collides(px, nfeetY, pz)) nfeetY = feetY; // give up, keep old
        } else {
          // Moving down — land. Snap on top of the floor block.
          nfeetY = Math.ceil(nfeetY) + EPS;
          if (this._collides(px, nfeetY, pz)) nfeetY = feetY;
          this.onGround = true;
        }
        feetY = nfeetY;
        this.velocity.y = 0;
      } else {
        feetY = nfeetY;
      }
    }

    // Commit position (eye = feet + EYE_HEIGHT).
    this.position.set(px, feetY + EYE_HEIGHT, pz);

    // --- Drive the camera --------------------------------------------------
    if (this.camera) {
      this.camera.position.copy(this.position);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = yaw;
      this.camera.rotation.x = pitch;
      this.camera.rotation.z = 0;
    }
  };

  // Expose dimensions so other modules (e.g. Interaction) can avoid placing
  // blocks inside the player.
  Player.WIDTH = PLAYER_WIDTH;
  Player.HEIGHT = PLAYER_HEIGHT;
  Player.EYE_HEIGHT = EYE_HEIGHT;

  // Attach to global.
  window.Player = Player;
})();

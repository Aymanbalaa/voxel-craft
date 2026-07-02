// js/controls.js
// VoxelCraft — Input / pointer-lock controls.
// Classic script: attaches the global `Controls` class to window.
//
// Per CONTRACT.md:
//   new Controls(domElement)  -- request pointer lock on click; keydown/keyup
//     for WASD + Space(jump) + Shift(sprint); mousemove accumulates yaw/pitch
//     ONLY while locked; pitch clamped to about +/-89 degrees.
//   getInput() -> { forward, back, left, right, jump, sprint, yaw, pitch, locked }
//   property isLocked (bool)

(function () {
  'use strict';

  // Mouse look sensitivity (radians per pixel of mouse movement).
  var SENSITIVITY = 0.0022;

  // Pitch clamp: ~89 degrees so the player can't flip over the poles.
  var MAX_PITCH = (89 * Math.PI) / 180;

  /**
   * @param {HTMLElement} domElement - typically the renderer canvas.
   */
  function Controls(domElement) {
    this.domElement = domElement;

    // Movement state (booleans set by key events).
    this.keys = {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false
    };

    // Accumulated look angles (radians).
    this.yaw = 0;
    this.pitch = 0;

    // Pointer-lock state.
    this.isLocked = false;

    // Bind handlers once so we can add/remove them and keep `this`.
    this._onClick = this._onClick.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);

    this._attach();
  }

  // --- Setup ---------------------------------------------------------------
  Controls.prototype._attach = function () {
    var el = this.domElement;

    // Click the canvas to engage pointer lock.
    el.addEventListener('click', this._onClick, false);

    // Pointer lock change (vendor-prefixed listeners for broad support).
    document.addEventListener('pointerlockchange', this._onPointerLockChange, false);
    document.addEventListener('mozpointerlockchange', this._onPointerLockChange, false);
    document.addEventListener('webkitpointerlockchange', this._onPointerLockChange, false);

    // Keyboard (document-level so focus on the canvas isn't required).
    document.addEventListener('keydown', this._onKeyDown, false);
    document.addEventListener('keyup', this._onKeyUp, false);

    // Mouse movement (only acts while locked; handler guards on isLocked).
    document.addEventListener('mousemove', this._onMouseMove, false);
  };

  // --- Pointer lock --------------------------------------------------------
  Controls.prototype._onClick = function () {
    if (this.isLocked) return;
    var el = this.domElement;
    var request = el.requestPointerLock ||
                  el.mozRequestPointerLock ||
                  el.webkitRequestPointerLock;
    if (request) request.call(el);
  };

  Controls.prototype._onPointerLockChange = function () {
    var locked = document.pointerLockElement === this.domElement ||
                 document.mozPointerLockElement === this.domElement ||
                 document.webkitPointerLockElement === this.domElement;

    this.isLocked = !!locked;

    // When we lose lock, release any held movement keys so the player doesn't
    // keep walking while the menu is up.
    if (!this.isLocked) {
      this.keys.forward = false;
      this.keys.back = false;
      this.keys.left = false;
      this.keys.right = false;
      this.keys.jump = false;
      this.keys.sprint = false;
    }
  };

  // --- Keyboard ------------------------------------------------------------
  Controls.prototype._setKey = function (code, key, pressed) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = pressed; return true;
      case 'KeyS':
      case 'ArrowDown':
        this.keys.back = pressed; return true;
      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = pressed; return true;
      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = pressed; return true;
      case 'Space':
        this.keys.jump = pressed; return true;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.keys.sprint = pressed; return true;
      default:
        break;
    }

    // Fallback for browsers / layouts that don't report `code`.
    if (key) {
      var k = key.toLowerCase();
      if (k === 'w') { this.keys.forward = pressed; return true; }
      if (k === 's') { this.keys.back = pressed; return true; }
      if (k === 'a') { this.keys.left = pressed; return true; }
      if (k === 'd') { this.keys.right = pressed; return true; }
      if (k === ' ' || key === 'Spacebar') { this.keys.jump = pressed; return true; }
      if (k === 'shift') { this.keys.sprint = pressed; return true; }
    }
    return false;
  };

  Controls.prototype._onKeyDown = function (e) {
    // Only consume movement keys while locked (avoids hijacking page input).
    if (!this.isLocked) return;
    var handled = this._setKey(e.code, e.key, true);
    if (handled) e.preventDefault(); // stop Space scrolling the page, etc.
  };

  Controls.prototype._onKeyUp = function (e) {
    // Always honor key-up so a key released after unlock doesn't stick.
    var handled = this._setKey(e.code, e.key, false);
    if (handled && this.isLocked) e.preventDefault();
  };

  // --- Mouse look ----------------------------------------------------------
  Controls.prototype._onMouseMove = function (e) {
    if (!this.isLocked) return;

    var dx = e.movementX || e.mozMovementX || e.webkitMovementX || 0;
    var dy = e.movementY || e.mozMovementY || e.webkitMovementY || 0;

    // Yaw decreases as the mouse moves right (standard FPS feel with -Z forward).
    this.yaw -= dx * SENSITIVITY;
    // Pitch decreases as the mouse moves down (look up when moving up).
    this.pitch -= dy * SENSITIVITY;

    // Clamp pitch to just under straight up/down.
    if (this.pitch > MAX_PITCH) this.pitch = MAX_PITCH;
    if (this.pitch < -MAX_PITCH) this.pitch = -MAX_PITCH;
  };

  // --- Public API ----------------------------------------------------------
  Controls.prototype.getInput = function () {
    return {
      forward: this.keys.forward,
      back: this.keys.back,
      left: this.keys.left,
      right: this.keys.right,
      jump: this.keys.jump,
      sprint: this.keys.sprint,
      yaw: this.yaw,
      pitch: this.pitch,
      locked: this.isLocked
    };
  };

  // Attach to global.
  window.Controls = Controls;
})();

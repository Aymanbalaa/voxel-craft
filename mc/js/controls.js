// Input: pointer lock, mouse look, keyboard state, hotbar wheel/number keys.
// Exposes a polled `input` object for the player + fires callbacks for discrete
// actions (clicks, key presses) that the game reacts to.

export class Controls {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.cb = callbacks;              // { onMouseDown(button), onMouseUp(button), onKey(code), onWheel(dir), onLockChange(locked) }
    this.locked = false;
    this.sensitivity = 0.0022;

    // Polled movement state (read each physics step).
    this.input = {
      forward: false, back: false, left: false, right: false,
      jump: false, sneak: false, sprint: false,
    };
    this._look = { dx: 0, dy: 0 };    // accumulated mouse delta since last consume
    this.keys = new Set();
    this.mouseButtons = new Set();

    this._bind();
  }

  _bind() {
    this.canvas.addEventListener('click', () => { if (!this.locked) this.canvas.requestPointerLock(); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this._resetInput(); }
      this.cb.onLockChange && this.cb.onLockChange(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this._look.dx += e.movementX;
      this._look.dy += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.mouseButtons.add(e.button);
      this.cb.onMouseDown && this.cb.onMouseDown(e.button);
    });
    document.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
      this.cb.onMouseUp && this.cb.onMouseUp(e.button);
    });

    document.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.cb.onWheel && this.cb.onWheel(Math.sign(e.deltaY));
    }, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._applyKeys();
      // Discrete presses (menus, hotbar, fly) always fire, even if not locked.
      this.cb.onKey && this.cb.onKey(e.code, e);
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this._applyKeys();
    });
  }

  _resetInput() {
    for (const k in this.input) this.input[k] = false;
  }

  _applyKeys() {
    const k = this.keys;
    this.input.forward = k.has('KeyW');
    this.input.back = k.has('KeyS');
    this.input.left = k.has('KeyA');
    this.input.right = k.has('KeyD');
    this.input.jump = k.has('Space');
    this.input.sneak = k.has('ShiftLeft') || k.has('ShiftRight');
    this.input.sprint = k.has('ControlLeft') || k.has('KeyR') /* run */ ;
  }

  // Consume accumulated mouse look and apply to yaw/pitch (returns updated angles).
  applyLook(player) {
    if (this._look.dx || this._look.dy) {
      player.yaw += this._look.dx * this.sensitivity;
      player.pitch -= this._look.dy * this.sensitivity;
      const lim = Math.PI / 2 - 0.001;
      if (player.pitch > lim) player.pitch = lim;
      if (player.pitch < -lim) player.pitch = -lim;
      this._look.dx = 0; this._look.dy = 0;
    }
  }
}

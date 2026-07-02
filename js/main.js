// js/main.js
// VoxelCraft — Standard Minecraft look bootstrap / glue. Classic script (no ES modules).
// Loaded last. Wires together the global classes produced by the other
// engineers: Noise, BLOCKS/HOTBAR/AIR/getBlockById, World, Player, Controls,
// Interaction, Sky — all attached to `window` by the preceding scripts.
//
// Responsibilities:
//   - WebGLRenderer({antialias:true}) appended to the page container; sky blue
//     clear color for standard Minecraft look.
//   - Scene; PerspectiveCamera (fov 70). Sky sets scene.fog + background.
//   - Natural day-time lighting (hemisphere + sun lights).
//   - World(scene, seed) -> generate(); then Player, Controls, Interaction.
//   - Sky(scene, renderer) for atmosphere.
//   - rAF loop with real dt (THREE.Clock):
//       input = controls.getInput()
//       player.update(dt, input); interaction.update();
//       world.update?.(dt); sky.update(dt, camera);
//       renderer.render(scene, camera);
//   - Window resize: camera aspect ratio update.
//   - DOM UI: standard hotbar (block colors), crosshair, instructions overlay
//     that hides on pointer lock.
//
// NOTE on the contract vs. the real module API:
//   World ships as `new World(scene, seed)` and Interaction as
//   `new Interaction(world, camera, controls, player)`. Those real signatures
//   are authoritative, so we keep them.

(function () {
  'use strict';

  // Sky blue clear color. Sky.js overrides scene.background + fog with the
  // full gradient/haze; this clear color is just a safe base.
  var VOID_COLOR = 0x87ceeb;
  var WORLD_SEED = 1337;

  // ---- Renderer -----------------------------------------------------------
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(VOID_COLOR, 1);
  // sRGB output for richer neon (optional per spec; r128 supports it).
  if (THREE.sRGBEncoding !== undefined) {
    renderer.outputEncoding = THREE.sRGBEncoding;
  }

  var container = document.getElementById('game-container') || document.body;
  container.appendChild(renderer.domElement);

  // ---- Scene + camera -----------------------------------------------------
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID_COLOR); // Sky will replace this.

  var camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.rotation.order = 'YXZ';

  // ---- Lighting -----------------------------------------------------------
  // Standard Minecraft lighting: hemisphere light with natural day/night colors
  // and a warm sun from a diagonal angle.
  var hemi = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.7);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  var sun = new THREE.DirectionalLight(0xffff99, 0.8);
  sun.position.set(0.4, 1, 0.25).normalize();
  scene.add(sun);

  // ---- World / Player / Controls / Interaction ----------------------------
  var world = new World(scene, WORLD_SEED);
  world.generate();

  var player = new Player(world, camera);
  var controls = new Controls(renderer.domElement);
  var interaction = new Interaction(world, camera, controls, player);

  // ---- Atmosphere + post-processing (disabled for standard look) -----------
  var sky = new Sky(scene, renderer);
  // PostFX (bloom/glow effects) disabled for standard Minecraft look
  var postfx = null;  // new PostFX(renderer, scene, camera);
  // Trail (neon ribbon effect) disabled
  var trail = null;   // new Trail(scene, world);

  // ---- DOM UI -------------------------------------------------------------
  buildUI(interaction, controls, trail);

  // ---- Animation loop -----------------------------------------------------
  var clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    var dt = clock.getDelta();

    var input = controls.getInput();
    player.update(dt, input);
    interaction.update();

    // Animate water / world-driven effects if the world exposes update().
    if (typeof world.update === 'function') {
      world.update(dt);
    }

    // Keep the dome/sun/stars centered and drifting.
    sky.update(dt, camera);

    // Trail disabled for standard look
    if (trail) {
      trail.update(dt, player, {
        sprinting: !!input.sprint,
        selectedId: interaction.selectedId,
        selectedColorHex: neonColorOf(interaction.selectedId)
      });
    }

    // Standard rendering (no bloom/glow effects).
    if (postfx) postfx.render();
    else renderer.render(scene, camera);
  }
  animate();

  // ---- Window resize ------------------------------------------------------
  window.addEventListener('resize', function () {
    var w = window.innerWidth;
    var h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // PostFX.setSize resizes the renderer + composer + bloom pass together.
    postfx.setSize(w, h);
  }, false);

  // ---- F key: Light-Bridge mode disabled (trail disabled) -----------------
  // For standard Minecraft look, Light-Bridge and trail features are disabled.
  // No F-key binding needed.

  // =========================================================================
  // Helpers
  // =========================================================================

  // The neon accent color for a block id (used for hotbar swatches AND the
  // light-ribbon color). Prefer the block's `emissive` (the neon glow) added by
  // the World agent; fall back to the base `color`, then to cyan.
  function neonColorOf(id) {
    var def = getBlockById(id);
    if (def) {
      if (typeof def.emissive === 'number') return def.emissive;
      if (typeof def.color === 'number') return def.color;
    }
    return 0x18f0ff; // cyan default
  }

  // =========================================================================
  // UI construction
  // =========================================================================
  function buildUI(interaction, controls, trail) {
    // --- Hotbar: one swatch per HOTBAR entry, using each block's neon color. -
    var hotbarEl = document.getElementById('hotbar');
    if (!hotbarEl) {
      hotbarEl = document.createElement('div');
      hotbarEl.id = 'hotbar';
      document.body.appendChild(hotbarEl);
    }
    hotbarEl.innerHTML = '';

    var slots = [];
    for (var i = 0; i < HOTBAR.length; i++) {
      var id = HOTBAR[i];
      var def = getBlockById(id);
      var neon = neonColorOf(id);

      var slot = document.createElement('div');
      slot.className = 'hotbar-slot';

      var swatch = document.createElement('div');
      swatch.className = 'hotbar-swatch';
      swatch.style.background = '#' + colorHex(neon);
      // Make the swatch glow on the dark UI in its own neon color.
      swatch.style.boxShadow = '0 0 8px #' + colorHex(neon) +
                               ', inset 0 0 6px rgba(255,255,255,0.25)';
      if (def) slot.title = def.name;

      var num = document.createElement('span');
      num.className = 'hotbar-num';
      num.textContent = String(i + 1);

      slot.appendChild(swatch);
      slot.appendChild(num);
      hotbarEl.appendChild(slot);
      slots.push(slot);

      (function (index) {
        slot.addEventListener('click', function (e) {
          e.stopPropagation();
          interaction.setSlot(index);
        });
      })(i);
    }

    function highlight(slotIndex) {
      for (var s = 0; s < slots.length; s++) {
        if (s === slotIndex) slots[s].classList.add('selected');
        else slots[s].classList.remove('selected');
      }
    }

    highlight(interaction.selectedSlot);
    interaction.onSelect = function (slotIndex) {
      highlight(slotIndex);
    };

    // --- Instructions overlay: hide on lock, show on unlock. ---------------
    var overlay = document.getElementById('overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'overlay';
      overlay.innerHTML =
        '<div class="overlay-card">' +
        '<h1>VoxelCraft</h1>' +
        '<p class="hint">Click to enter the grid</p>' +
        '<ul>' +
        '<li><b>WASD</b> / arrows — move</li>' +
        '<li><b>Space</b> — jump</li>' +
        '<li><b>Shift</b> — sprint</li>' +
        '<li><b>Mouse</b> — look</li>' +
        '<li><b>Left click</b> — break block</li>' +
        '<li><b>Right click</b> — place block</li>' +
        '<li><b>1–8</b> / wheel — select block</li>' +
        '<li><b>F</b> — Light-Bridge mode</li>' +
        '<li><b>Esc</b> — release mouse</li>' +
        '</ul>' +
        '</div>';
      document.body.appendChild(overlay);
    }
    overlay.addEventListener('click', function () {
      var el = renderer.domElement;
      var request = el.requestPointerLock ||
                    el.mozRequestPointerLock ||
                    el.webkitRequestPointerLock;
      if (request) request.call(el);
    });

    function syncOverlay() {
      if (controls.isLocked) overlay.classList.add('hidden');
      else overlay.classList.remove('hidden');
    }
    document.addEventListener('pointerlockchange', syncOverlay, false);
    document.addEventListener('mozpointerlockchange', syncOverlay, false);
    document.addEventListener('webkitpointerlockchange', syncOverlay, false);
    syncOverlay();
  }

  // Format a 0xRRGGBB number as a 6-digit hex string (no leading '#').
  function colorHex(num) {
    var s = (num >>> 0).toString(16);
    while (s.length < 6) s = '0' + s;
    return s.slice(-6);
  }
})();

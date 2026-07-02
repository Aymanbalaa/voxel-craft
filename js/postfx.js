// js/postfx.js
// VoxelCraft — post-processing (UnrealBloomPass) with graceful fallback.
// Classic script (no ES modules). Attaches the global `PostFX` class to window.
//
// Depends on global THREE (r128). The postprocessing classes are attached to
// THREE by the unpkg three@0.128.0 examples scripts loaded in index.html:
//   THREE.EffectComposer, THREE.RenderPass, THREE.ShaderPass,
//   THREE.UnrealBloomPass, THREE.CopyShader, THREE.LuminosityHighPassShader.
//
// If any of those are missing (offline, CDN blocked, etc.) PostFX must NEVER
// throw: it sets enabled=false and render() falls back to renderer.render.
//
// API:
//   new PostFX(renderer, scene, camera)
//   postfx.enabled            -- bool
//   postfx.render()           -- composer.render() or renderer.render fallback
//   postfx.setSize(w, h)      -- resize composer + bloom pass + renderer

(function () {
  'use strict';

  // Bloom tuning (per ENHANCE.md): strong neon glow.
  var BLOOM_STRENGTH = 1.3;
  var BLOOM_RADIUS = 0.6;
  var BLOOM_THRESHOLD = 0.15;

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene}         scene
   * @param {THREE.Camera}        camera
   */
  function PostFX(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.enabled = false;
    this.composer = null;
    this.bloomPass = null;

    // Only attempt to build the chain if the required globals exist.
    var hasComposer = !!(THREE && THREE.EffectComposer);
    var hasRenderPass = !!(THREE && THREE.RenderPass);
    var hasBloom = !!(THREE && THREE.UnrealBloomPass);

    if (!hasComposer || !hasRenderPass || !hasBloom) {
      // Graceful fallback: no bloom, plain render. Never throw.
      this.enabled = false;
      return;
    }

    try {
      var size = new THREE.Vector2();
      renderer.getSize(size);
      var w = size.x || window.innerWidth;
      var h = size.y || window.innerHeight;

      var composer = new THREE.EffectComposer(renderer);

      var renderPass = new THREE.RenderPass(scene, camera);
      composer.addPass(renderPass);

      var bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(w, h),
        BLOOM_STRENGTH,
        BLOOM_RADIUS,
        BLOOM_THRESHOLD
      );
      composer.addPass(bloomPass);

      // Ensure the final pass writes to the screen. The composer normally flags
      // the last added pass as renderToScreen; set it explicitly to be safe.
      bloomPass.renderToScreen = true;

      composer.setSize(w, h);
      if (renderer.getPixelRatio) {
        composer.setPixelRatio(renderer.getPixelRatio());
      }

      this.composer = composer;
      this.bloomPass = bloomPass;
      this.renderPass = renderPass;
      this.enabled = true;
    } catch (err) {
      // Any construction failure -> fall back to plain rendering.
      this.composer = null;
      this.bloomPass = null;
      this.enabled = false;
    }
  }

  /** Render the frame: composer (with bloom) if enabled, else plain renderer. */
  PostFX.prototype.render = function () {
    if (this.enabled && this.composer) {
      try {
        this.composer.render();
        return;
      } catch (err) {
        // If the composer ever throws at runtime, disable and fall back so the
        // game keeps rendering instead of going black.
        this.enabled = false;
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** Resize renderer, composer, and bloom pass. */
  PostFX.prototype.setSize = function (w, h) {
    if (this.renderer && this.renderer.setSize) {
      this.renderer.setSize(w, h);
    }
    if (this.enabled && this.composer) {
      this.composer.setSize(w, h);
      if (this.bloomPass && this.bloomPass.setSize) {
        this.bloomPass.setSize(w, h);
      }
    }
  };

  window.PostFX = PostFX;
})();

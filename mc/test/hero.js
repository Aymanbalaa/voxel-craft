// Clean wide vista for the README banner — no HUD, no held-item model.
(() => {
  const mc = window.MC;
  const p = mc.player;
  document.getElementById('boot-overlay').classList.add('hidden');
  document.querySelectorAll('.hud').forEach(h => h.style.display = 'none'); // hide crosshair + hotbar + bars
  mc.camera.children.forEach(c => c.visible = false);   // hide held-item view model
  mc.mobs.clear();                                       // no stray mobs in the vista
  p.mode = 'creative'; p.flying = true; p.vel.x = p.vel.y = p.vel.z = 0;
  p.pos.x = 20; p.pos.z = 20; p.pos.y = 118;
  p.pitch = -0.82; p.yaw = 0.9;
  mc.sky.setTime(1200); mc.sky.paused = true;            // clear morning light
  mc.scene.fog.far = 700; mc.scene.fog.near = 260;
  return { y: p.pos.y };
})()

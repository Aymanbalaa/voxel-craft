// Wide biome-spanning aerial for the Phase 2b tint before/after.
(() => {
  const mc = window.MC;
  const p = mc.player;
  document.getElementById('boot-overlay').classList.add('hidden');
  document.querySelectorAll('.hud').forEach(h => h.style.display = 'none');
  mc.camera.children.forEach(c => c.visible = false);
  mc.mobs.clear();
  p.mode = 'creative'; p.flying = true; p.vel.x = p.vel.y = p.vel.z = 0;
  p.pos.x = 928; p.pos.z = 120; p.pos.y = 150;
  p.pitch = -1.15; p.yaw = 0.0; // steep look down toward the plains/taiga/birch boundary bands
  mc.sky.setTime(1200); mc.sky.paused = true;
  mc.scene.fog.far = 1600; mc.scene.fog.near = 600;
  return { y: p.pos.y };
})()

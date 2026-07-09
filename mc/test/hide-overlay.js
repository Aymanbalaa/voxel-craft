// Hide the boot overlay and freeze the player for a clean terrain screenshot.
(async () => {
  const mc = window.MC;
  document.getElementById('boot-overlay').classList.add('hidden');
  mc.player.setMode('creative'); mc.player.flying = true;
  mc.player.vel.x = mc.player.vel.y = mc.player.vel.z = 0;
  mc.player.pos.y = Math.max(mc.player.pos.y, 70);
  mc.player.pitch = -0.35;
  await new Promise((r) => setTimeout(r, 600));
  return { y: mc.player.pos.y, ready: mc.world.readyCount() };
})()

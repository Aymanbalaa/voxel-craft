// Hide overlay, raise the player to a vista, tilt camera down to survey terrain.
(() => {
  document.getElementById('boot-overlay').classList.add('hidden');
  const mc = window.MC;
  const p = mc.player;
  // Move up and back for a landscape view.
  p.pos.y += 18;
  p.pitch = -0.5;      // look down ~30°
  p.yaw = 0.7;
  return { y: +p.pos.y.toFixed(1), biomeChunks: mc.world.readyCount() };
})()

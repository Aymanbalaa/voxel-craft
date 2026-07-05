// Mob group portrait: pig, sheep, zombie on a flat grass plateau, framed up close.
(() => {
  const mc = window.MC;
  const { mobs, world, player } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  document.querySelectorAll('.hud').forEach(h => h.style.display = 'none');
  mc.camera.children.forEach(c => c.visible = false);

  function surfaceY(x, z) { let y = 120; while (y > 1 && world.getBlock(x, y, z) === 0) y--; return y; }
  // Flat: a 5x5 patch of grass all at the same height, 3 air above the center.
  function flat(x, z) {
    const y0 = surfaceY(x, z);
    if (world.getBlock(x, y0, z) !== 2) return null;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (surfaceY(x + dx, z + dz) !== y0) return null;
      if (world.getBlock(x + dx, y0, z + dz) !== 2) return null;
    }
    for (let dy = 1; dy <= 3; dy++) if (world.getBlock(x, y0 + dy, z) !== 0) return null;
    return { x, y: y0, z };
  }
  let land = null;
  for (let r = 4; r < 90 && !land; r++)
    for (let a = 0; a < r * 8 && !land; a++) {
      const ang = a / (r * 8) * Math.PI * 2;
      const x = Math.round(8 + Math.cos(ang) * r), z = Math.round(8 + Math.sin(ang) * r);
      const l = flat(x, z); if (l) land = l;
    }
  if (!land) return { land: null };

  mobs.clear();
  mc.sky.setTime(3000); mc.sky.paused = true;   // bright mid-morning so mobs read clearly
  player.mode = 'creative'; player.flying = true; player.vel.x = player.vel.y = player.vel.z = 0;

  const cx = land.x + 0.5, cz = land.z + 0.5, gy = land.y + 1;
  // Spawn three mobs in a shallow arc in front of the camera (toward -Z, smaller z).
  mobs.spawn('sheep',  cx - 1.5, gy + 0.2, cz - 1.4);
  mobs.spawn('pig',    cx + 0.1, gy + 0.2, cz - 2.0);
  mobs.spawn('zombie', cx + 1.7, gy + 0.2, cz - 1.1);
  const far = { pos: { x: cx, y: gy, z: cz + 60 }, vel: { x: 0, z: 0 } };
  for (let i = 0; i < 30; i++) mobs.update(1 / 60, far);

  // Close, low, slight downward tilt toward the cluster.
  player.pos.x = cx; player.pos.z = cz + 2.6; player.pos.y = gy + 1.1;
  player.yaw = 0; player.pitch = -0.16;
  mc.scene.fog.far = 400; mc.scene.fog.near = 150;
  return { land, count: mobs.count(), y: mobs.mobs.map(m => +m.pos.y.toFixed(1)) };
})()

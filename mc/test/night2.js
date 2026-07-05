// Night scene: moon + stars over the terrain, with torch block-light glow.
(() => {
  const mc = window.MC;
  const { world, player, sky } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  document.querySelectorAll('.hud').forEach(h => h.style.display = 'none');
  mc.camera.children.forEach(c => c.visible = false);
  mc.mobs.clear();
  const SOLID = new Set([1,2,3,4,7,8,21]);
  let land = null;
  for (let r = 0; r < 60 && !land; r++)
    for (let dz = -r; dz <= r && !land; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = 8 + dx, z = 8 + dz; let y = 110;
        while (y > 1 && world.getBlock(x, y, z) === 0) y--;
        if (SOLID.has(world.getBlock(x, y, z)) && y >= 50) { land = { x, y, z }; break; }
      }
  if (!land) return { land: null };

  player.mode = 'creative'; player.flying = true; player.vel.x = player.vel.y = player.vel.z = 0;

  // Time where the moon sits ~22deg above the horizon; sky fully dark, stars out.
  const DAY_TICKS = 24000, t = 13800;
  sky.setTime(t); sky.paused = true;
  const phase = t / DAY_TICKS, e = phase * Math.PI * 2;
  const sunDir = { x: Math.cos(e), y: Math.sin(e), z: 0.25 };
  const L = Math.hypot(sunDir.x, sunDir.y, sunDir.z);
  const moon = { x: -sunDir.x / L, y: -sunDir.y / L, z: -sunDir.z / L }; // opposite the sun

  // Build a small torch-lit dirt platform in front of the camera (toward the moon)
  // so warm block-light glows in the foreground under the star field.
  const fx = Math.round(moon.x), fz = Math.round(moon.z);
  for (let dx = -2; dx <= 2; dx++) for (let dz = 0; dz <= 3; dz++) {
    const x = land.x + fx * 3 + dx, z = land.z + fz * 3 + dz;
    world.setBlock(x, land.y, z, 3); // dirt top to level the ledge
  }
  for (const [dx, dz] of [[-2,0],[2,0],[0,1],[-1,3],[1,3]]) {
    world.setBlock(land.x + fx * 3 + dx, land.y + 1, land.z + fz * 3 + dz, 31); // torch
  }

  // Low vantage, nearly level, aimed at the moon so terrain fills the lower third
  // and the moon + stars own the sky (yaw = atan2(-dx,-dz)).
  player.pos.x = land.x + 0.5 - moon.x * 2.5; player.pos.z = land.z + 0.5 - moon.z * 2.5;
  player.pos.y = land.y + 2.5;
  player.yaw = Math.atan2(-moon.x, -moon.z);
  player.pitch = 0.14;
  mc.scene.fog.far = 600; mc.scene.fog.near = 160;
  return { land, time: sky.getTime(), moon };
})()

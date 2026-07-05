// First-person survival view: HUD (health/hunger/hotbar) + held block model,
// looking out across an open meadow.
(() => {
  const mc = window.MC;
  const { world, player, inventory, UI } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  mc.mobs.clear();

  function surfaceY(x, z) { let y = 120; while (y > 1 && world.getBlock(x, y, z) === 0) y--; return y; }
  // A flat grass plateau with an open drop/horizon in the +x/+z look direction.
  function flat(x, z) {
    const y0 = surfaceY(x, z);
    if (world.getBlock(x, y0, z) !== 2) return null;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
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

  mc.sky.setTime(1400); mc.sky.paused = true;      // warm morning
  player.mode = 'survival'; player.flying = true;  // freeze physics for a clean shot
  player.vel.x = player.vel.y = player.vel.z = 0;
  player.pos.x = land.x + 0.5; player.pos.z = land.z + 0.5; player.pos.y = land.y + 2.6;
  player.pitch = -0.12; player.yaw = 0.62;

  // A full, tidy hotbar; select a grass block so a cube shows in hand.
  inventory.set(0, { id: 2,  count: 1 });   // grass block (held)
  inventory.set(1, { id: 1,  count: 42 });  // stone
  inventory.set(2, { id: 10, count: 16 });  // oak log
  inventory.set(3, { id: 16, count: 8 });   // planks
  inventory.set(4, { id: 320, count: 1 });  // diamond pickaxe
  inventory.set(5, { id: 259, count: 6 });  // torches
  inventory.set(6, { id: 261, count: 3 });
  inventory.set(7, { id: 11, count: 24 });
  inventory.select(0);
  UI.setSelectedSlot(0);

  mc.scene.fog.far = 500; mc.scene.fog.near = 220;
  return { land, held: inventory.selectedId() };
})()

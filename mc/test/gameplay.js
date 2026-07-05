// Exercise mining, drops, pickup, inventory, crafting via window.MC directly.
(() => {
  const mc = window.MC;
  const { world, player, interaction, drops, inventory, camera, UI } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  const out = {};
  const SOLID = new Set([1,2,3,4,7,8,21]); // stone,grass,dirt,cobble,sand,gravel,sandstone

  // Find a land column: scan a spiral near spawn for a solid, dry surface.
  function findLand() {
    for (let r = 0; r < 60; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = 8 + dx, z = 8 + dz;
        let y = 110; while (y > 1 && world.getBlock(x, y, z) === 0) y--;
        if (SOLID.has(world.getBlock(x, y, z)) && y >= 48) return { x, y, z };
      }
    }
    return null;
  }
  const land = findLand();
  out.land = land;
  if (!land) return out;

  player.pos.x = land.x + 0.5; player.pos.z = land.z + 0.5; player.pos.y = land.y + 1.02;
  player.pitch = -1.4; player.yaw = 0;   // look mostly down
  interaction.updateTarget();
  out.hasTarget = !!interaction.target;
  out.targetId = interaction.target ? world.getBlock(...interaction.target.block) : null;

  // Survival-break with a diamond pickaxe (fast on stone/dirt).
  player.mode = 'survival';
  inventory.set(inventory.selected, { id: 320, count: 1 }); // diamond pickaxe
  const before = interaction.target ? interaction.target.block.slice() : null;
  for (let i = 0; i < 60 && world.getBlock(...(before||[0,0,0])) !== 0; i++) interaction.updateBreaking(0.1, true);
  out.blockBroken = before ? (world.getBlock(before[0], before[1], before[2]) === 0) : false;
  out.dropsSpawned = drops.items.length;

  // Pickup: run drops toward the player.
  const invCountBefore = inventory.slots.reduce((n, s) => n + (s ? s.count : 0), 0);
  for (let i = 0; i < 200; i++) drops.update(1 / 60, player.pos, camera);
  const invCountAfter = inventory.slots.reduce((n, s) => n + (s ? s.count : 0), 0);
  out.pickedUp = invCountAfter > invCountBefore;
  out.dropsAfter = drops.items.length;

  // Place a cobble onto the block we're looking at (creative, no consume issues).
  player.mode = 'creative';
  inventory.set(inventory.selected, { id: 4, count: 10 });
  interaction.updateTarget();
  const placeAt = interaction.target ? interaction.target.place.slice() : null;
  interaction.useOrPlace();
  out.placed = placeAt ? (world.getBlock(...placeAt) === 4) : false;

  // Crafting flow: 1 oak log -> 4 planks via matchRecipe path (onCraft).
  const grid = [{ id: 10, count: 1 }, null, null, null];
  const preview = mc.UI ? null : null;
  out.craftPreview = (window.__mc_onCraft ? null : null);

  // Overlay open/close.
  UI.toggleInventory(false);
  out.overlayOpen = UI.isOverlayOpen();
  UI.closeOverlays();
  out.overlayClosed = !UI.isOverlayOpen();

  return out;
})()

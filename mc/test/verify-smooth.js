// Exercise the smoothness-pass changes end-to-end: chunk streaming with the
// rebuilt gen queue + budgeted mesh applies + buffer pool, a block edit
// (remesh path), and the incremental (delta) save.
(async () => {
  const mc = window.MC;
  const out = { errors: [] };
  try {
    // Wait for boot gate.
    const t0 = performance.now();
    while (mc.world.readyCount() < 9 && performance.now() - t0 < 15000)
      await new Promise((r) => setTimeout(r, 200));
    out.readyAfterBoot = mc.world.readyCount();

    // Fly east across several chunk boundaries to force streaming.
    mc.player.setMode('creative'); mc.player.flying = true;
    mc.player.vel.x = mc.player.vel.y = mc.player.vel.z = 0;
    const p = mc.player.pos;
    const startX = p.x;
    for (let i = 0; i < 60; i++) {
      p.x += 2;
      mc.world.update(p.x, p.z);
      await new Promise((r) => setTimeout(r, 50));
    }
    out.chunksCrossed = Math.floor((p.x - startX) / 16);
    out.readyAfterFly = mc.world.readyCount();
    out.applyQueueLen = mc.world.applyQueue.length;
    out.bufPoolLen = mc.world._bufPool.length;

    // Block edit → remesh via pooled buffers; lands in pendingSave.
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    let by = 120; while (by > 1 && mc.world.getBlock(bx, by, bz) === 0) by--;
    mc.world.setBlock(bx, by + 1, bz, 1);
    out.editApplied = mc.world.getBlock(bx, by + 1, bz) === 1;
    out.pendingBeforeSave = mc.world.pendingSave.size;

    // Delta save: pending set drains on success; a second collect is empty.
    await window.__mc_save();
    out.pendingAfterSave = mc.world.pendingSave.size;
    const delta = mc.world.collectEditsDelta();
    out.secondDeltaEdits = delta.edits.length;   // expect 0
    out.secondDeltaKeys = delta.editedKeys.length; // expect >= 1 (full key list)
    mc.world.restorePendingSave(delta.pending);

    // Let a few frames render so deferred mesh applies drain.
    await new Promise((r) => setTimeout(r, 800));
    out.applyQueueDrained = mc.world.applyQueue.length;
    out.readyFinal = mc.world.readyCount();
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  return out;
})()

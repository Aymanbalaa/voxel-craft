// Probe the mesh-dispatch buffer pool: wait for streaming quiescence, then
// force a remesh and confirm buffers cycle out and come back.
(async () => {
  const mc = window.MC;
  const w = mc.world;
  const out = {};
  const t0 = performance.now();
  while ((w.inFlightMesh > 0 || w.inFlightGen > 0 || w.meshQueue.length > 0 || w.applyQueue.length > 0)
         && performance.now() - t0 < 20000)
    await new Promise((r) => setTimeout(r, 250));
  out.quiescent = w.inFlightMesh === 0 && w.inFlightGen === 0;
  out.poolAtRest = w._bufPool.length;
  // Force one remesh (interior edit → 1 chunk, 9 buffers out).
  const p = mc.player.pos;
  const bx = Math.floor(p.x), bz = Math.floor(p.z);
  let by = 120; while (by > 1 && w.getBlock(bx, by, bz) === 0) by--;
  w.setBlock(bx, by + 1, bz, 1);
  const poolAfterDispatchSamples = [];
  for (let i = 0; i < 20; i++) {
    poolAfterDispatchSamples.push(w._bufPool.length + ':' + w.inFlightMesh);
    await new Promise((r) => setTimeout(r, 100));
  }
  out.samples = poolAfterDispatchSamples.join(' ');
  out.poolEnd = w._bufPool.length;
  return out;
})()

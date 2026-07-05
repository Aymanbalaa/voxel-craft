// evaluated in page context
(() => {
  const w = window.MC.world;
  return {
    ready: w.readyCount(),
    chunks: w.chunks.size,
    genQueue: w.genQueue.length,
    meshQueue: w.meshQueue.length,
    pendingGen: w.pendingGen.size,
    pendingMesh: w.pendingMesh.size,
    inFlightGen: w.inFlightGen,
    inFlightMesh: w.inFlightMesh,
    started: undefined,
    withBlocks: [...w.chunks.values()].filter(c => c.blocks).length,
    meshed: [...w.chunks.values()].filter(c => c.meshRev >= 0).length,
  };
})()

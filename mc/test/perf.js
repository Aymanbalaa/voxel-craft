(() => { const mc=window.MC; const r=mc.renderer.info.render;
  return { fps: mc._fps||'n/a', draws: r.calls, tris: r.triangles, chunks: mc.world.readyCount(), mobs: mc.mobs.count(), errFree:true }; })()

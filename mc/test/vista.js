(() => {
  document.getElementById('boot-overlay').classList.add('hidden');
  const p = window.MC.player;
  p.mode = 'creative'; p.flying = true; p.vel.x=p.vel.y=p.vel.z=0;
  p.pos.x = 20; p.pos.z = 20; p.pos.y = 118;
  p.pitch = -0.95; p.yaw = 0.9;
  window.MC.scene.fog.far = 600; window.MC.scene.fog.near = 200;
  return { y: p.pos.y, mode: p.mode };
})()

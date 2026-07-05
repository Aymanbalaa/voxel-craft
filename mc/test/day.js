(() => {
  const mc = window.MC;
  const { player, sky } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  player.mode='creative';player.flying=true;player.vel.x=player.vel.y=player.vel.z=0;
  player.pos.x=20;player.pos.z=40;player.pos.y=95;
  player.pitch=0.08;player.yaw=0.2;            // look slightly up toward sky
  mc.scene.fog.far=600;mc.scene.fog.near=250;
  sky.setTime(1500); sky.paused=true;          // morning, sun low-east
  return { time: sky.getTime() };
})()

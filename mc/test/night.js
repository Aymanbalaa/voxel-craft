(() => {
  const mc = window.MC;
  const { world, player, sky } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  const SOLID=new Set([1,2,3,4,7,8,21]);
  let land=null;
  for(let r=0;r<60&&!land;r++)for(let dz=-r;dz<=r&&!land;dz++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
    const x=8+dx,z=8+dz;let y=110;while(y>1&&world.getBlock(x,y,z)===0)y--;
    if(SOLID.has(world.getBlock(x,y,z))&&y>=50){land={x,y,z};break;}
  }
  if(land){player.pos.x=land.x+0.5;player.pos.z=land.z+0.5;player.pos.y=land.y+6;}
  player.mode='creative';player.flying=true;player.vel.x=player.vel.y=player.vel.z=0;
  player.pitch=-0.12;player.yaw=0.7;
  sky.setTime(18000); sky.paused=true;      // midnight
  // place a torch nearby to show block light at night
  world.setBlock(land.x+2, land.y+1, land.z, 31);
  return { land, time: sky.getTime() };
})()

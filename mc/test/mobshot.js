(() => {
  const mc = window.MC;
  const { mobs, world, player } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  function grass(x,z){ let y=110; while(y>1&&world.getBlock(x,y,z)===0)y--;
    if(world.getBlock(x,y,z)!==2)return null;
    for(let dy=1;dy<=3;dy++)if(world.getBlock(x,y+dy,z)!==0)return null; return {x,y,z}; }
  let land=null;
  for(let r=6;r<70&&!land;r++)for(let a=0;a<r*8&&!land;a++){
    const ang=a/(r*8)*Math.PI*2; const x=Math.round(8+Math.cos(ang)*r), z=Math.round(8+Math.sin(ang)*r);
    const l=grass(x,z); if(l)land=l;
  }
  if(!land) return {land:null};
  mobs.clear();
  const fakeFar={pos:{x:land.x,y:land.y,z:land.z+40},vel:{x:0,z:0}};
  mobs.spawn('pig', land.x-1.2, land.y+1.2, land.z-0.5);
  mobs.spawn('sheep', land.x+1.2, land.y+1.2, land.z+0.2);
  mobs.spawn('zombie', land.x+0.1, land.y+1.2, land.z+1.2);
  for(let i=0;i<50;i++) mobs.update(1/60, fakeFar);
  // camera: pulled back and up, looking down at the mob cluster
  player.pos.x=land.x+0.5; player.pos.z=land.z+6; player.pos.y=land.y+3.2;
  player.yaw=0; player.pitch=-0.42;
  mc.camera.position.set(player.pos.x,player.eyeY(),player.pos.z);
  mc.camera.rotation.set(player.pitch,player.yaw,0,'YXZ');
  return { land, count: mobs.count(), mobY: mobs.mobs.map(m=>+m.pos.y.toFixed(1)) };
})()

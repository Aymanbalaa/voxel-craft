(() => {
  const mc = window.MC;
  const { world, player, UI, inventory } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  const SOLID = new Set([1,2,3,4,7,8,21]);
  let land=null;
  for (let r=0;r<60&&!land;r++) for(let dz=-r;dz<=r&&!land;dz++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
    const x=8+dx,z=8+dz; let y=110; while(y>1&&world.getBlock(x,y,z)===0)y--;
    if(SOLID.has(world.getBlock(x,y,z))&&y>=50){land={x,y,z};break;}
  }
  if(land){ player.pos.x=land.x+0.5; player.pos.z=land.z+0.5; player.pos.y=land.y+1.02; }
  player.pitch=-0.15; player.yaw=0.6;
  mc.camera.position.set(player.pos.x,player.eyeY(),player.pos.z);
  mc.camera.rotation.set(player.pitch,player.yaw,0,'YXZ');
  UI.setSelectedSlot(2);
  UI.updateHUD({health:16,hunger:14,air:10,mode:'survival',showF3:false});
  return { land };
})()

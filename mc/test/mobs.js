(() => {
  const mc = window.MC;
  const { mobs, world, player, drops } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  const SOLID=new Set([1,2,3,4,7,8,21]);
  let land=null;
  for(let r=0;r<40&&!land;r++)for(let dz=-r;dz<=r&&!land;dz++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
    const x=8+dx,z=8+dz;let y=110;while(y>1&&world.getBlock(x,y,z)===0)y--;
    if(SOLID.has(world.getBlock(x,y,z))&&y>=50){land={x,y,z};break;}
  }
  player.pos.x=land.x+0.5;player.pos.z=land.z+0.5;player.pos.y=land.y+1.02;
  // Spawn a pig, sheep, zombie next to us.
  const pig=mobs.spawn('pig', land.x+2.5, land.y+1.5, land.z+0.5);
  const sheep=mobs.spawn('sheep', land.x+0.5, land.y+1.5, land.z+2.5);
  const zombie=mobs.spawn('zombie', land.x-2.5, land.y+1.5, land.z+0.5);
  const spawned = mobs.count();
  // Simulate a few seconds so they fall to ground + wander.
  for(let i=0;i<180;i++) mobs.update(1/60, player);
  const grounded = mobs.mobs.every(m=>m.pos.y <= land.y+2 && m.pos.y >= land.y-2);
  // Attack the pig to death.
  const dropsBefore = drops.items.length;
  for(let i=0;i<10 && mobs.mobs.includes(pig);i++) mobs.hit(pig, 5, player.pos);
  const pigDead = !mobs.mobs.includes(pig);
  const dropsAfter = drops.items.length;
  return { land, spawned, aliveNow: mobs.count(), grounded, pigDead, dropsGained: dropsAfter-dropsBefore, zombieHostile: zombie.hostile };
})()

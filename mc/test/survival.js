(() => {
  const mc = window.MC;
  const { survival, furnaces, inventory } = mc;
  const out = {};
  // Survival: hurt, eat, starve floor.
  survival.reset();
  survival.hurt(6); out.afterHurt = survival.health;   // expect 14
  survival.hunger = 10;
  survival.eat(266); out.afterEat = survival.hunger;   // cooked porkchop +8 -> 18
  survival.hunger = 0; survival.health = 5;
  for (let i=0;i<50;i++) survival.update(0.5, {vel:{x:0,z:0},flying:false,sprinting:false});
  out.starveFloor = survival.health;                    // floored at 1
  // Furnace: smelt iron ore with coal.
  const f = furnaces.get(0,0,0);
  f.slots.input = { id: 14, count: 2 };   // iron ore
  f.slots.fuel = { id: 257, count: 1 };   // coal
  for (let i=0;i<20;i++) furnaces.update(0.6); // 12s -> ~1 smelt
  out.furnaceOut = f.slots.output;         // expect iron ingot (id 259)
  out.furnaceInputLeft = f.slots.input ? f.slots.input.count : 0;
  out.burnStarted = f.burn >= 0;
  return out;
})()

(() => {
  const mc = window.MC;
  const { inventory, UI } = mc;
  document.getElementById('boot-overlay').classList.add('hidden');
  // Fill some inventory slots for a good screenshot.
  inventory.set(9, {id:1,count:64}); inventory.set(10,{id:2,count:32});
  inventory.set(11,{id:10,count:12}); inventory.set(12,{id:16,count:5});
  inventory.set(13,{id:259,count:8}); inventory.set(14,{id:261,count:3});
  inventory.set(15,{id:11,count:40}); inventory.set(18,{id:13,count:20});
  UI.toggleInventory(true);   // open with 3x3 crafting
  return { open: UI.isOverlayOpen() };
})()

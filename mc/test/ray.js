(() => {
  const mc = window.MC;
  const { world, player, interaction } = mc;
  let gy = 120; while (gy > 1 && world.getBlock(8, gy, 8) === 0) gy--;
  player.pos.x = 8.5; player.pos.z = 8.5; player.pos.y = gy + 1.02;
  player.pitch = -1.56; player.yaw = 0;
  interaction.updateTarget();
  const around = [];
  for (let dy = 3; dy >= -2; dy--) around.push([gy+dy, world.getBlock(8, gy+dy, 8)]);
  return {
    gy, eyeY: +player.eyeY().toFixed(2),
    dir: [interaction._dir.x.toFixed(2), interaction._dir.y.toFixed(2), interaction._dir.z.toFixed(2)],
    target: interaction.target,
    column: around,
  };
})()

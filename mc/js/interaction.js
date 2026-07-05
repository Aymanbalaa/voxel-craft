// Interaction: voxel raycast (DDA), block breaking with progress + crack overlay,
// placement with player-collision veto, and block "use" (crafting table / furnace).

import * as THREE from '../vendor/three.module.js';
import { REACH, PLAYER } from './config.js';
import { B, BLOCKS, isSolid, IS_COLLIDE, blockDrop } from './blocks.js';
import { isBlockItem, toolOf } from './items.js';

// Amanatides & Woo voxel traversal from origin along dir, up to maxDist.
// Returns { block:[x,y,z], place:[x,y,z], face } or null.
export function raycast(world, origin, dir, maxDist = REACH) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
  const distToEdge = (o, s) => s > 0 ? (Math.floor(o) + 1 - o) : (o - Math.floor(o));
  let tMaxX = stepX !== 0 ? distToEdge(origin.x, stepX) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? distToEdge(origin.y, stepY) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? distToEdge(origin.z, stepZ) * tDeltaZ : Infinity;
  let face = -1, px = x, py = y, pz = z, t = 0;

  while (t <= maxDist) {
    const id = world.getBlock(x, y, z);
    if (id !== B.AIR && id !== B.WATER && id !== B.LAVA) {
      return { block: [x, y, z], place: [px, py, pz], face, id };
    }
    px = x; py = y; pz = z;
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; face = stepX > 0 ? 1 : 0; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; face = stepY > 0 ? 3 : 2; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; face = stepZ > 0 ? 5 : 4; }
  }
  return null;
}

// Break time (seconds) per Minecraft-ish formula.
export function breakTime(blockId, heldItemId) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0) return Infinity;      // bedrock/unbreakable
  if (b.hardness === 0) return 0;
  const tool = toolOf(heldItemId);
  const correct = b.tool && tool && tool.type === b.tool;
  const canHarvest = !b.tool || b.minTier === 0 || (correct && tool.tier >= b.minTier);
  let speed = 1;
  if (correct) speed = tool.speed;
  // base: 1.5s per hardness with correct tool, 5x if unharvestable.
  let time = b.hardness * 1.5 / speed;
  if (!canHarvest) time = b.hardness * 5;
  return time;
}

export class Interaction {
  constructor({ world, camera, player, inventory, scene, sound, ui, atlas, drops }) {
    this.world = world; this.camera = camera; this.player = player;
    this.inv = inventory; this.scene = scene; this.sound = sound;
    this.ui = ui; this.atlas = atlas; this.drops = drops;

    this.target = null;         // current raycast hit
    this.breaking = false;
    this.breakProgress = 0;     // 0..1
    this.breakTotal = 0;
    this._dir = new THREE.Vector3();

    this._buildSelection();
  }

  _buildSelection() {
    // Black wireframe box around the targeted block.
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(geo);
    this.selMesh = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
    this.selMesh.visible = false;
    this.scene.add(this.selMesh);

    // Crack overlay: a slightly larger box, darkening with break progress.
    const cgeo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
    this.crackMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false });
    this.crackMesh = new THREE.Mesh(cgeo, this.crackMat);
    this.crackMesh.visible = false;
    this.scene.add(this.crackMesh);
  }

  // Called each frame: update the targeted block + selection box.
  updateTarget() {
    // Look direction straight from yaw/pitch (matches camera.rotation YXZ), so it
    // never lags a frame behind the camera matrix.
    const cp = Math.cos(this.player.pitch), sp = Math.sin(this.player.pitch);
    const sy = Math.sin(this.player.yaw), cy = Math.cos(this.player.yaw);
    this._dir.set(-sy * cp, sp, -cy * cp);
    const origin = { x: this.player.pos.x, y: this.player.eyeY(), z: this.player.pos.z };
    const hit = raycast(this.world, origin, this._dir, REACH);
    this.target = hit;
    if (hit) {
      this.selMesh.visible = true;
      this.selMesh.position.set(hit.block[0] + 0.5, hit.block[1] + 0.5, hit.block[2] + 0.5);
    } else {
      this.selMesh.visible = false;
      this._cancelBreak();
    }
  }

  // Called each frame with dt while left mouse is held.
  updateBreaking(dt, holding) {
    if (!holding || !this.target) { this._cancelBreak(); return; }
    const id = this.target.id;
    if (this.player.mode === 'creative') { this._finishBreak(); return; }

    const total = breakTime(id, this.inv.selectedId());
    if (!isFinite(total)) { this._cancelBreak(); return; }
    if (!this.breaking || this._breakKey !== keyOf(this.target.block)) {
      this.breaking = true; this.breakProgress = 0; this.breakTotal = total;
      this._breakKey = keyOf(this.target.block);
    }
    this.breakProgress += dt / (total || 0.001);
    // Crack overlay + occasional dig sound.
    this.crackMesh.visible = true;
    this.crackMesh.position.copy(this.selMesh.position);
    this.crackMat.opacity = 0.15 + 0.5 * Math.min(1, this.breakProgress);
    this._digTick = (this._digTick || 0) + dt;
    if (this._digTick > 0.22) { this._digTick = 0; this.sound?.play?.(digSound(id), { volume: 0.5 }); }
    if (this.breakProgress >= 1) this._finishBreak();
  }

  _cancelBreak() {
    this.breaking = false; this.breakProgress = 0; this._breakKey = null;
    if (this.crackMesh) this.crackMesh.visible = false;
  }

  _finishBreak() {
    const t = this.target;
    if (!t) return;
    const [x, y, z] = t.block;
    const id = this.world.getBlock(x, y, z);
    if (id === B.AIR || id === B.BEDROCK) { this._cancelBreak(); return; }
    // Determine drop.
    const tool = toolOf(this.inv.selectedId());
    const drop = blockDrop(id, tool?.type, tool?.tier ?? 0);
    this.world.setBlock(x, y, z, B.AIR);
    this.sound?.play?.('break', { volume: 0.6 });
    if (drop && this.drops) this.drops.spawn(x + 0.5, y + 0.5, z + 0.5, drop.id, drop.count);
    this.onBlockBroken?.(id, x, y, z);
    // Update lighting/supported plants above (e.g. break dirt under grass/flower).
    const above = this.world.getBlock(x, y + 1, z);
    if (above === B.TALL_GRASS || above === B.POPPY || above === B.DANDELION || above === B.DEAD_BUSH ||
        above === B.MUSHROOM_RED || above === B.MUSHROOM_BROWN || above === B.TORCH) {
      this.world.setBlock(x, y + 1, z, B.AIR);
      if (this.drops && above !== B.TALL_GRASS && above !== B.DEAD_BUSH) this.drops.spawn(x + 0.5, y + 1.5, z + 0.5, above, 1);
    }
    this._cancelBreak();
  }

  // Right click: place selected block OR use the targeted block.
  useOrPlace() {
    const t = this.target;
    if (!t) return;
    const targetId = this.world.getBlock(...t.block);
    // Use interactive blocks first (main owns pointer-lock, so route via callbacks).
    if (targetId === B.CRAFTING_TABLE) { this.onOpenTable?.(); return; }
    if (targetId === B.FURNACE) { this.onOpenFurnace?.(t.block); return; }

    const held = this.inv.hotbarStack();
    if (!held || !isBlockItem(held.id)) return;
    const [x, y, z] = t.place;
    if (this.world.getBlock(x, y, z) !== B.AIR && this.world.getBlock(x, y, z) !== B.WATER) return;
    // Torch only on top of / side of solids.
    if (held.id === B.TORCH) {
      const below = this.world.getBlock(x, y - 1, z);
      if (!isSolid(below) && t.face !== 2) { /* allow on side too */ }
    }
    // Veto if the block would intersect the player's AABB (for solid blocks).
    if (IS_COLLIDE[held.id] && this._intersectsPlayer(x, y, z)) return;

    this.world.setBlock(x, y, z, held.id);
    if (this.player.mode !== 'creative') this.inv.consumeSelected();
    this.sound?.play?.('place', { volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
  }

  _intersectsPlayer(x, y, z) {
    const p = this.player.pos, hw = PLAYER.width / 2, h = PLAYER.height;
    return (x + 1 > p.x - hw && x < p.x + hw &&
            z + 1 > p.z - hw && z < p.z + hw &&
            y + 1 > p.y && y < p.y + h);
  }

  // Pick-block (creative middle click): put targeted block into hand.
  pickBlock() {
    const t = this.target; if (!t) return;
    const id = this.world.getBlock(...t.block);
    if (id === B.AIR) return;
    // find existing in hotbar or place in selected slot
    for (let i = 0; i < 9; i++) if (this.inv.slots[i]?.id === id) { this.inv.select(i); return; }
    this.inv.set(this.inv.selected, { id, count: this.player.mode === 'creative' ? 64 : 1 });
  }
}

function keyOf(b) { return b[0] + ',' + b[1] + ',' + b[2]; }

// Map a block to its dig sound name.
function digSound(id) {
  const b = BLOCKS[id]; if (!b) return 'dig_stone';
  const t = b.tool;
  if (id === B.GLASS || id === B.ICE) return 'dig_glass';
  if (id === B.WOOL) return 'dig_wool';
  if (t === 'axe') return 'dig_wood';
  if (t === 'shovel') return id === B.SAND ? 'dig_sand' : (id === B.GRAVEL ? 'dig_gravel' : (b.name === 'Grass Block' ? 'dig_grass' : 'dig_dirt'));
  if (b.name.includes('Leaves') || b.shape === 'cross') return 'dig_grass';
  return 'dig_stone';
}
export { digSound };

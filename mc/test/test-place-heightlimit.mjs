import { HEIGHT } from '../js/config.js';
import { B } from '../js/blocks.js';
import { CHUNK } from '../js/config.js';

// Minimal world stub matching World.getBlock/setBlock semantics.
class WorldStub {
  constructor(){ this.map = new Map(); }
  _k(x,y,z){ return x+','+y+','+z; }
  getBlock(x,y,z){ if(y<0||y>=HEIGHT) return 0; return this.map.get(this._k(x,y,z))||0; }
  setBlock(x,y,z,id){ if(y<0||y>=HEIGHT) return; this.map.set(this._k(x,y,z), id); }
}

// Try importing interaction (pulls THREE) — if it throws we learn that.
let Interaction, raycast;
try {
  ({ Interaction, raycast } = await import('../js/interaction.js'));
  console.log('interaction.js imported OK');
} catch(e){ console.log('import FAILED:', e.message); process.exit(0); }

const world = new WorldStub();
// Place a solid block at the top of the world: y = HEIGHT-1 = 127.
world.setBlock(0, HEIGHT-1, 0, B.STONE);

// Fake player/inventory/scene/etc just enough for useOrPlace + constructor.
const scene = { add(){}, remove(){} };
const player = { pos:{x:0.5,y:HEIGHT-5,z:0.5}, mode:'survival', width:0.6, height:1.8, eyeY(){return this.pos.y+1.62;}, pitch:0, yaw:0 };
const inv = {
  slots:[{id:B.STONE, count:64}], selected:0,
  hotbarStack(){ return this.slots[this.selected]; },
  selectedId(){ return this.slots[this.selected]?.id ?? 0; },
  consumeSelected(){ const s=this.slots[this.selected]; if(!s)return; s.count--; if(s.count<=0) this.slots[this.selected]=null; },
};
const it = new Interaction({ world, camera:null, player, inventory:inv, scene, sound:null, ui:null, atlas:null, drops:null });

// Simulate targeting the top face of the top block: block=[0,127,0], place=[0,128,0], face=2 (+Y)
it.target = { block:[0,HEIGHT-1,0], place:[0,HEIGHT,0], face:2, id:B.STONE };

const before = inv.slots[0]?.count ?? 0;
it.useOrPlace();
const after = inv.slots[0]?.count ?? 0;
const placed = world.getBlock(0,HEIGHT,0);
console.log('count before', before, 'after', after, '| block placed at y=HEIGHT:', placed);
console.log(after < before && placed === 0 ? 'BUG CONFIRMED: item consumed but no block placed' : 'no loss');

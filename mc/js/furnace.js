// Furnace controller: one smelting state per furnace block location. Furnaces tick
// in the background (whether or not their UI is open) using recipes' smelt/fuel data.

import { smeltResult, fuelTicks } from './recipes.js';
import { maxStack } from './items.js';

const COOK_TICKS = 200;   // one item = 200 ticks (10s at 20 tps)

export class Furnaces {
  constructor() { this.map = new Map(); }   // "x,y,z" -> furnace state

  _key(x, y, z) { return x + ',' + y + ',' + z; }

  get(x, y, z) {
    const k = this._key(x, y, z);
    let f = this.map.get(k);
    if (!f) {
      f = { slots: { input: null, fuel: null, output: null }, progress: 0, burn: 0,
            _burnLeft: 0, _burnMax: 0, _cook: 0 };
      this.map.set(k, f);
    }
    return f;
  }

  remove(x, y, z) {
    const f = this.map.get(this._key(x, y, z));
    this.map.delete(this._key(x, y, z));
    return f; // caller can scatter contents as drops
  }

  _accepts(output, res) {
    if (!output) return true;
    return output.id === res.id && output.count < maxStack(res.id);
  }

  // Advance all furnaces by dt seconds.
  update(dt) {
    const ticks = dt * 20;
    for (const f of this.map.values()) this._tick(f, ticks);
  }

  _tick(f, ticks) {
    const s = f.slots;
    const res = s.input ? smeltResult(s.input.id) : null;
    const canSmelt = !!(res && this._accepts(s.output, res));

    if (f._burnLeft > 0) f._burnLeft -= ticks;

    // Light new fuel if we have something to smelt and the fire went out.
    if (f._burnLeft <= 0 && canSmelt && s.fuel && fuelTicks(s.fuel.id) > 0) {
      f._burnMax = fuelTicks(s.fuel.id);
      f._burnLeft = f._burnMax;
      s.fuel.count--;
      if (s.fuel.count <= 0) s.fuel = null;
    }

    if (f._burnLeft > 0 && canSmelt) {
      f._cook += ticks;
      if (f._cook >= COOK_TICKS) {
        f._cook -= COOK_TICKS;
        if (!s.output) s.output = { id: res.id, count: res.count };
        else s.output.count += res.count;
        s.input.count--; if (s.input.count <= 0) s.input = null;
      }
    } else {
      f._cook = Math.max(0, f._cook - ticks * 2);   // cool down when not smelting
    }

    f.progress = Math.min(1, f._cook / COOK_TICKS);
    f.burn = f._burnMax > 0 ? Math.max(0, Math.min(1, f._burnLeft / f._burnMax)) : 0;
  }

  // Any furnace currently burning? (for lit-front texture, optional)
  isLit(x, y, z) { const f = this.map.get(this._key(x, y, z)); return !!(f && f._burnLeft > 0); }

  toJSON() {
    const o = {};
    for (const [k, f] of this.map) o[k] = { slots: f.slots, _burnLeft: f._burnLeft, _burnMax: f._burnMax, _cook: f._cook };
    return o;
  }
  load(o) {
    this.map.clear();
    if (!o) return;
    for (const k in o) {
      const d = o[k];
      this.map.set(k, { slots: d.slots || { input: null, fuel: null, output: null },
        progress: 0, burn: 0, _burnLeft: d._burnLeft || 0, _burnMax: d._burnMax || 0, _cook: d._cook || 0 });
    }
  }
}

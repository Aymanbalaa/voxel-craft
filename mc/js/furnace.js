// Furnace controller: one smelting state per furnace block location. Furnaces tick
// in the background (whether or not their UI is open) using recipes' smelt/fuel data.

import { smeltResult, fuelTicks } from './recipes.js';
import { maxStack, itemDef } from './items.js';

const COOK_TICKS = 200;   // one item = 200 ticks (10s at 20 tps)
const MAX_FUEL_TICKS = 1600;   // longest single-fuel burn (coal/charcoal in recipes.js FUEL table)
const MAX_FURNACES = 8192;   // cap on restored furnace entries (mirrors save.js MAX_EDITED_KEYS = 8192)
// A valid furnace key is exactly "x,y,z" of signed integers, matching _key().
const _KEY_RE = /^-?\d+,-?\d+,-?\d+$/;

// Sanitize a restored slot from persistence: accept only null or a well-formed
// { id, count } stack with a registered integer id and an integer count in 1..maxStack.
// Malformed/tampered stacks are dropped (null) so the smelting tick can't be poisoned.
function _saneSlot(v) {
  if (!v || typeof v !== 'object') return null;
  const id = v.id;
  if (!Number.isInteger(id) || !itemDef(id)) return null;
  let count = v.count;
  if (!Number.isInteger(count) || count < 1) return null;
  const max = maxStack(id);
  if (count > max) count = max;
  return { id, count };
}

// Coerce a restored numeric counter to a finite, non-negative number.
function _saneNum(v) { return Number.isFinite(v) && v > 0 ? v : 0; }

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
    if (!o || typeof o !== 'object') return;
    let n = 0;
    for (const k in o) {
      // Drop malformed keys (must be "x,y,z" integer coords) and cap total entries
      // so a tampered save can't produce an unbounded, per-frame-ticked Map.
      if (!_KEY_RE.test(k)) continue;
      if (n >= MAX_FURNACES) break;
      n++;
      const d = o[k];
      const rs = (d && d.slots && typeof d.slots === 'object') ? d.slots : null;
      const slots = {
        input:  _saneSlot(rs && rs.input),
        fuel:   _saneSlot(rs && rs.fuel),
        output: _saneSlot(rs && rs.output),
      };
      // Clamp restored counters into one-fuel / one-smelt bounds so a tampered save
      // can't grant infinite/free burn (_burnLeft >> _burnMax) or instant cook progress.
      const burnMax = Math.min(_saneNum(d && d._burnMax), MAX_FUEL_TICKS);
      const burnLeft = Math.min(_saneNum(d && d._burnLeft), burnMax);
      const cook = Math.min(_saneNum(d && d._cook), COOK_TICKS);
      this.map.set(k, { slots,
        progress: 0, burn: 0,
        _burnLeft: burnLeft, _burnMax: burnMax, _cook: cook });
    }
  }
}

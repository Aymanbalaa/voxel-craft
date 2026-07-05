// Inventory model: 36 slots (0..8 hotbar, 9..35 main) + a cursor stack for menus.
// Implements Minecraft-style click semantics so ui.js can drive it directly.
// A stack is { id, count } or null. PURE except for maxStack lookup.

import { maxStack } from './items.js';

export class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null);
    this.selected = 0;         // hotbar index 0..8
    this.cursor = null;        // stack held by the mouse in menus
    this.onChange = null;      // callback(): UI re-render hook
  }

  _changed() { if (this.onChange) this.onChange(); }

  get(i) { return this.slots[i]; }
  set(i, stack) { this.slots[i] = stack || null; this._changed(); }

  hotbarStack() { return this.slots[this.selected]; }
  selectedId() { return this.slots[this.selected]?.id ?? 0; }

  select(i) { this.selected = ((i % 9) + 9) % 9; this._changed(); }
  scroll(dir) { this.select(this.selected + (dir > 0 ? 1 : -1)); }

  // Add a stack to the inventory, merging into existing stacks then empty slots.
  // Returns leftover {id,count}|null.
  addItem(stack) {
    if (!stack || stack.count <= 0) return null;
    const id = stack.id, max = maxStack(id);
    let n = stack.count;
    // 1) top up existing partial stacks (hotbar first, then main).
    for (let i = 0; i < 36 && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const space = max - s.count;
        const move = Math.min(space, n);
        s.count += move; n -= move;
      }
    }
    // 2) drop into empty slots (hotbar first, then main).
    for (let i = 0; i < 36 && n > 0; i++) {
      if (!this.slots[i]) {
        const move = Math.min(max, n);
        this.slots[i] = { id, count: move }; n -= move;
      }
    }
    this._changed();
    return n > 0 ? { id, count: n } : null;
  }

  // Can the whole stack fit? (used by furnace/craft output take checks)
  canFit(stack) {
    if (!stack) return true;
    const max = maxStack(stack.id);
    let n = stack.count;
    for (let i = 0; i < 36 && n > 0; i++) {
      const s = this.slots[i];
      if (!s) return true;
      if (s.id === stack.id && s.count < max) n -= (max - s.count);
    }
    return n <= 0;
  }

  // Remove `count` of item id from inventory (used when crafting consumes from grid
  // — but crafting uses its own grid; this is for programmatic removal). Returns removed count.
  removeItem(id, count) {
    let n = count;
    for (let i = 0; i < 36 && n > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, n);
        s.count -= take; n -= take;
        if (s.count === 0) this.slots[i] = null;
      }
    }
    this._changed();
    return count - n;
  }

  count(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n; }

  // Decrement the selected hotbar stack by 1 (used when placing a block).
  consumeSelected() {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this._changed();
  }

  // ---- Menu click handling (MC semantics) ---------------------------------
  // button: 'left' | 'right'. shift: quick-move between hotbar/main areas.
  clickSlot(i, button, shift) {
    if (shift) return this._shiftMove(i);
    if (button === 'right') return this._rightClick(i);
    return this._leftClick(i);
  }

  _leftClick(i) {
    const slot = this.slots[i], cur = this.cursor;
    if (!cur) {
      // Pick up the whole slot.
      this.cursor = slot; this.slots[i] = null;
    } else if (!slot) {
      this.slots[i] = cur; this.cursor = null;
    } else if (slot.id === cur.id) {
      // Merge into slot.
      const max = maxStack(slot.id);
      const move = Math.min(max - slot.count, cur.count);
      slot.count += move; cur.count -= move;
      if (cur.count <= 0) this.cursor = null;
    } else {
      // Swap.
      this.slots[i] = cur; this.cursor = slot;
    }
    this._changed();
  }

  _rightClick(i) {
    const slot = this.slots[i], cur = this.cursor;
    if (!cur) {
      // Pick up half (ceil).
      if (!slot) return;
      const half = Math.ceil(slot.count / 2);
      this.cursor = { id: slot.id, count: half };
      slot.count -= half;
      if (slot.count <= 0) this.slots[i] = null;
    } else if (!slot) {
      // Place one.
      this.slots[i] = { id: cur.id, count: 1 };
      cur.count--; if (cur.count <= 0) this.cursor = null;
    } else if (slot.id === cur.id) {
      // Add one if room.
      if (slot.count < maxStack(slot.id)) { slot.count++; cur.count--; if (cur.count <= 0) this.cursor = null; }
    } else {
      // Swap.
      this.slots[i] = cur; this.cursor = slot;
    }
    this._changed();
  }

  // Shift-click: move a whole stack to the opposite area (hotbar<->main).
  _shiftMove(i) {
    const s = this.slots[i];
    if (!s) return;
    const toMain = i < 9;
    const start = toMain ? 9 : 0, end = toMain ? 36 : 9;
    const max = maxStack(s.id);
    // merge into partials
    for (let j = start; j < end && s.count > 0; j++) {
      const d = this.slots[j];
      if (d && d.id === s.id && d.count < max) { const m = Math.min(max - d.count, s.count); d.count += m; s.count -= m; }
    }
    // empties
    for (let j = start; j < end && s.count > 0; j++) {
      if (!this.slots[j]) { this.slots[j] = { id: s.id, count: s.count }; s.count = 0; }
    }
    if (s.count <= 0) this.slots[i] = null;
    this._changed();
  }

  // Serialize for saving.
  toJSON() { return { slots: this.slots, selected: this.selected }; }
  load(data) {
    if (!data) return;
    this.slots = (data.slots || []).slice(0, 36);
    while (this.slots.length < 36) this.slots.push(null);
    this.selected = data.selected || 0;
    this._changed();
  }
}

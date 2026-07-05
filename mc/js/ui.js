// UI layer: HUD + menu screens rendered as plain DOM/CSS over the fullscreen
// <canvas> game. NO three.js here — everything is div/canvas-2d elements.
//
// Icon rendering is ALWAYS delegated to ctx.renderItemIcon(id) (see initUI).
// We defensively clone the returned canvas before inserting it into the DOM
// because a <canvas> node can only live in one place at a time — if the game
// ever returns a cached/shared canvas instance for repeated calls with the
// same id, inserting it into two slots at once would silently move it out of
// the first slot. Cloning costs nothing at 32x32 and removes that whole class
// of bug regardless of how renderItemIcon is implemented.

import { itemName, maxStack, I } from './items.js';
import { B, BLOCKS } from './blocks.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let ctx = null;               // { inventory, renderItemIcon, onCraft, takeCraftResult, onSmeltTick, callbacks }
let overlayOpen = false;      // true whenever any modal screen (inventory/creative/furnace/death) is shown
let currentMode = 'survival'; // last mode seen via updateHUD

let craftGrid = [];           // local ephemeral crafting grid (length 4 or 9)
let craftIs3x3 = false;

let furnaceRef = null;        // normalized {input,fuel,output} object (see openFurnace)
let furnaceState = null;      // the outer state object (for .progress / .burn)

let hotbarLabelTimer = null;

// DOM refs populated by initUI()
let root, hud, crosshair;
let hotbarSlots = [];
let hotbarLabel;
let heartEls = [], hungerEls = [], airEls = [];
let airBar, statusBars;
let f3;
let backdrop;
let invScreen, invCraftArea, invCraftGridEl, invResultSlot;
let creativeScreen, creativePalette;
let furnaceScreen, furnaceInputSlot, furnaceFuelSlot, furnaceOutputSlot, flameFill, furnaceArrowFill;
let deathScreen, deathRespawnBtn;
let cursorItemEl;
let toastEl, toastTimer;
let damageFlashEl;

// Every screen that embeds the 27-main/9-hotbar player grid registers its
// element arrays here so refreshInventoryScreens() can update all of them
// (inventory screen, creative screen, furnace screen) from one place instead
// of special-casing each caller.
const playerMainGridSets = [];
const playerHotGridSets = [];

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Clone the icon canvas returned by the game so we never move a shared node.
function cloneIcon(id) {
  if (!ctx || !ctx.renderItemIcon) return null;
  const src = ctx.renderItemIcon(id);
  if (!src) return null;
  const c = document.createElement('canvas');
  c.width = src.width || 32;
  c.height = src.height || 32;
  c.className = 'item-icon';
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
  }
  return c;
}

// Render a stack ({id,count}|null) into a slot element (icon + count badge).
function renderSlotEl(slotEl, stack) {
  slotEl.innerHTML = '';
  if (stack && stack.id) {
    const icon = cloneIcon(stack.id);
    if (icon) slotEl.appendChild(icon);
    if (stack.count > 1) {
      const count = el('span', 'slot-count', slotEl);
      count.textContent = String(stack.count);
    }
    slotEl.title = itemName(stack.id);
  } else {
    slotEl.removeAttribute('title');
  }
}

// ---------------------------------------------------------------------------
// Generic pick-up/place slot interaction (used for the craft grid and the
// furnace slots, none of which live inside inventory.slots so they cannot go
// through inventory.clickSlot). Mirrors the same left/right click semantics
// described for inventory.clickSlot: left picks up/places/merges/swaps a full
// stack, right picks up/places a half/single stack.
// `allowPlace:false` is used for output-only slots (furnace output) where the
// player may take items out but never place items in.
// ---------------------------------------------------------------------------
function clickManagedSlot(getStack, setStack, button, allowPlace) {
  const cursor = ctx.inventory.cursor;
  const slot = getStack();

  if (button === 'left') {
    if (!cursor && slot) { ctx.inventory.cursor = slot; setStack(null); return; }
    if (cursor && !slot) { if (allowPlace) { setStack(cursor); ctx.inventory.cursor = null; } return; }
    if (cursor && slot) {
      if (cursor.id === slot.id) {
        const max = maxStack(cursor.id);
        const total = cursor.count + slot.count;
        if (total <= max) { setStack({ id: slot.id, count: total }); ctx.inventory.cursor = null; }
        else { setStack({ id: slot.id, count: max }); ctx.inventory.cursor = { id: cursor.id, count: total - max }; }
      } else if (allowPlace) {
        setStack(cursor); ctx.inventory.cursor = slot;
      }
    }
    return;
  }

  // right click
  if (!cursor && slot) {
    const take = Math.ceil(slot.count / 2);
    const remain = slot.count - take;
    ctx.inventory.cursor = { id: slot.id, count: take };
    setStack(remain > 0 ? { id: slot.id, count: remain } : null);
    return;
  }
  if (cursor && !slot) {
    if (!allowPlace) return;
    setStack({ id: cursor.id, count: 1 });
    const remain = cursor.count - 1;
    ctx.inventory.cursor = remain > 0 ? { id: cursor.id, count: remain } : null;
    return;
  }
  if (cursor && slot && allowPlace && cursor.id === slot.id) {
    const max = maxStack(cursor.id);
    if (slot.count < max) {
      setStack({ id: slot.id, count: slot.count + 1 });
      const remain = cursor.count - 1;
      ctx.inventory.cursor = remain > 0 ? { id: cursor.id, count: remain } : null;
    }
  }
}

// ---------------------------------------------------------------------------
// initUI — build the whole DOM tree once.
// ---------------------------------------------------------------------------
export function initUI(uiCtx) {
  ctx = uiCtx;

  root = el('div', null, document.body);
  root.id = 'ui-root';

  buildHud();
  buildCursorItem();
  buildToast();
  buildDamageFlash();
  buildInventoryScreen();
  buildCreativeScreen();
  buildFurnaceScreen();
  buildDeathScreen();

  // Cursor-held-item follows the mouse whenever a menu is open.
  window.addEventListener('mousemove', (e) => {
    if (!overlayOpen) return;
    cursorItemEl.style.left = e.clientX + 'px';
    cursorItemEl.style.top = e.clientY + 'px';
  });

  // Escape closes whatever overlay screen is open (except the death screen,
  // which only closes via the Respawn button). Opening/closing on 'E' is
  // main.js's job — it should call toggleInventory()/isOverlayOpen() itself.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && overlayOpen && !deathScreen.classList.contains('open')) {
      closeOverlays();
    }
  });

  updateHotbar();
}

// ---------------------------------------------------------------------------
// HUD: crosshair, hotbar, health/hunger/air, F3
// ---------------------------------------------------------------------------
function buildHud() {
  hud = el('div', 'hud', root);
  hud.id = 'hud';

  crosshair = el('div', 'crosshair', hud);
  crosshair.id = 'crosshair';

  // Status bars (hearts / hunger / air) sit just above the hotbar.
  statusBars = el('div', 'status-bars', hud);
  const heartRow = buildMeterRow(statusBars, 'heart-row', 'heart');
  heartEls = heartRow;
  const hungerRow = buildMeterRow(statusBars, 'hunger-row', 'hunger');
  hungerEls = hungerRow;
  airBar = el('div', 'meter-row air-row hidden', statusBars);
  airEls = [];
  for (let i = 0; i < 10; i++) {
    const b = el('div', 'bubble-icon', airBar);
    airEls.push(b);
  }

  // Hotbar + fading name label.
  const hotbarWrap = el('div', 'hotbar-wrap', hud);
  hotbarLabel = el('div', 'hotbar-label', hotbarWrap);
  const hotbar = el('div', 'hotbar', hotbarWrap);
  hotbarSlots = [];
  for (let i = 0; i < 9; i++) {
    const s = el('div', 'slot hotbar-slot', hotbar);
    s.dataset.index = String(i);
    hotbarSlots.push(s);
  }

  // F3 debug overlay.
  f3 = el('pre', 'f3-overlay hidden', hud);
  f3.id = 'f3-overlay';
}

// Builds a row of 10 "meter" icons (hearts or drumsticks). Each icon is a
// background (empty) shape with an inner .meter-fill div clipped to a
// percentage width that reveals a "full" background shape underneath —
// this gives us half-icon precision without needing a 3rd sprite variant.
function buildMeterRow(parent, rowClass, kind) {
  const row = el('div', `meter-row ${rowClass}`, parent);
  const icons = [];
  for (let i = 0; i < 10; i++) {
    const icon = el('div', `meter-icon ${kind}-icon`, row);
    const fill = el('div', 'meter-fill', icon);
    icons.push({ container: icon, fill });
  }
  return icons;
}

function setMeter(icons, value /* 0..20 */) {
  for (let i = 0; i < 10; i++) {
    const v = clamp(value - i * 2, 0, 2); // 0, 1 (half) or 2 (full) for this icon
    icons[i].fill.style.width = (v / 2 * 100) + '%';
    icons[i].container.classList.toggle('empty', v === 0);
  }
}

function setBubbles(icons, value /* 0..10 */) {
  for (let i = 0; i < 10; i++) {
    icons[i].classList.toggle('full', i < value);
  }
}

// ---------------------------------------------------------------------------
// Floating cursor-held-item, toast, damage flash
// ---------------------------------------------------------------------------
function buildCursorItem() {
  cursorItemEl = el('div', 'cursor-item hidden', root);
  cursorItemEl.id = 'cursor-item';
}

function renderCursor() {
  const stack = ctx.inventory.cursor;
  cursorItemEl.innerHTML = '';
  if (stack && stack.id) {
    const icon = cloneIcon(stack.id);
    if (icon) cursorItemEl.appendChild(icon);
    if (stack.count > 1) {
      const c = el('span', 'slot-count', cursorItemEl);
      c.textContent = String(stack.count);
    }
    cursorItemEl.classList.remove('hidden');
  } else {
    cursorItemEl.classList.add('hidden');
  }
}

function buildToast() {
  toastEl = el('div', 'toast hidden', root);
  toastEl.id = 'toast';
}

export function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  // restart the fade animation
  toastEl.classList.remove('show');
  void toastEl.offsetWidth; // force reflow so the class removal/add is observed
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastEl.classList.add('hidden');
  }, 2000);
}

function buildDamageFlash() {
  damageFlashEl = el('div', 'damage-flash', root);
  damageFlashEl.id = 'damage-flash';
  // Remove the animation class once it finishes so flashDamage() can restart it later.
  damageFlashEl.addEventListener('animationend', () => damageFlashEl.classList.remove('pulse'));
}

export function flashDamage() {
  damageFlashEl.classList.remove('pulse');
  void damageFlashEl.offsetWidth; // restart animation if already running
  damageFlashEl.classList.add('pulse');
}

export function setCrosshairVisible(v) {
  if (!crosshair) return;
  crosshair.classList.toggle('hidden', !v);
}

// ---------------------------------------------------------------------------
// Public HUD API
// ---------------------------------------------------------------------------

export function updateHotbar() {
  if (!ctx) return;
  for (let i = 0; i < 9; i++) renderSlotEl(hotbarSlots[i], ctx.inventory.get(i));
}

export function setSelectedSlot(i) {
  hotbarSlots.forEach((s, idx) => s.classList.toggle('selected', idx === i));
  const stack = ctx && ctx.inventory ? ctx.inventory.hotbarStack() : null;
  hotbarLabel.textContent = stack ? itemName(stack.id) : '';
  hotbarLabel.classList.toggle('hidden', !stack);
  clearTimeout(hotbarLabelTimer);
  hotbarLabel.classList.remove('fade');
  hotbarLabelTimer = setTimeout(() => hotbarLabel.classList.add('fade'), 1500);
}

export function updateHUD(state) {
  if (!state) return;
  currentMode = state.mode || 'survival';
  const creative = currentMode === 'creative';
  statusBars.classList.toggle('hidden', creative);
  if (!creative) {
    setMeter(heartEls, clamp(state.health ?? 20, 0, 20));
    setMeter(hungerEls, clamp(state.hunger ?? 20, 0, 20));
    const showAir = state.air != null && state.air < 10;
    airBar.classList.toggle('hidden', !showAir);
    if (showAir) setBubbles(airEls, clamp(state.air, 0, 10));
  }
  f3.classList.toggle('hidden', !state.showF3);
  if (state.showF3) f3.textContent = (state.f3lines || []).join('\n');
}

// ---------------------------------------------------------------------------
// Shared "player inventory" grid builder (27 main + 9 hotbar), reused by the
// survival inventory screen, the creative screen and the furnace screen.
// ---------------------------------------------------------------------------
function buildPlayerGrids(parent) {
  const mainGrid = el('div', 'inv-main', parent);
  const mainEls = [];
  for (let i = 9; i < 36; i++) {
    const s = el('div', 'slot inv-slot', mainGrid);
    s.dataset.index = String(i);
    wireInventorySlot(s, i);
    mainEls.push(s);
  }
  const hotGrid = el('div', 'inv-hotbar', parent);
  const hotEls = [];
  for (let i = 0; i < 9; i++) {
    const s = el('div', 'slot inv-slot', hotGrid);
    s.dataset.index = String(i);
    wireInventorySlot(s, i);
    hotEls.push(s);
  }
  playerMainGridSets.push(mainEls);
  playerHotGridSets.push(hotEls);
  return { mainEls, hotEls };
}

function wireInventorySlot(slotEl, index) {
  slotEl.addEventListener('contextmenu', (e) => e.preventDefault());
  slotEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const button = e.button === 2 ? 'right' : 'left';
    ctx.inventory.clickSlot(index, button, e.shiftKey);
    refreshInventoryScreens();
    renderCursor();
  });
}

function refreshInventoryScreens() {
  if (!ctx) return;
  for (const mainEls of playerMainGridSets) {
    for (let i = 0; i < mainEls.length; i++) renderSlotEl(mainEls[i], ctx.inventory.get(i + 9));
  }
  for (const hotEls of playerHotGridSets) {
    for (let i = 0; i < hotEls.length; i++) renderSlotEl(hotEls[i], ctx.inventory.get(i));
  }
  updateHotbar();
}

// ---------------------------------------------------------------------------
// Overlay show/hide plumbing
// ---------------------------------------------------------------------------
function ensureBackdrop() {
  if (backdrop) return backdrop;
  backdrop = el('div', 'overlay-backdrop hidden', root);
  backdrop.id = 'overlay-backdrop';
  return backdrop;
}

function showOverlay(screenEl) {
  ensureBackdrop().classList.remove('hidden');
  screenEl.classList.add('open');
  screenEl.classList.remove('hidden');
  overlayOpen = true;
  renderCursor();
}

function hideOverlay(screenEl) {
  screenEl.classList.remove('open');
  screenEl.classList.add('hidden');
}

// Dumps any items sitting in the ephemeral craft grid (and the held cursor
// stack) back into the player's inventory. Assumes inventory.addItem(stack)
// exists and returns leftover|null; leftovers (inventory completely full)
// have nowhere else to go in this UI layer, so they are dropped with a
// console warning rather than silently vanishing without a trace.
function dumpCraftAndCursor() {
  if (!ctx) return;
  for (let i = 0; i < craftGrid.length; i++) {
    if (craftGrid[i]) {
      const leftover = ctx.inventory.addItem(craftGrid[i]);
      if (leftover) console.warn('[ui] inventory full, dropped', leftover);
      craftGrid[i] = null;
    }
  }
  if (ctx.inventory.cursor) {
    const leftover = ctx.inventory.addItem(ctx.inventory.cursor);
    if (leftover) console.warn('[ui] inventory full, dropped', leftover);
    ctx.inventory.cursor = null;
  }
}

export function closeOverlays() {
  const wasInventory = invScreen && invScreen.classList.contains('open');
  if (wasInventory) dumpCraftAndCursor();
  // Cursor items picked up in the creative/furnace screens also return home.
  if (ctx && ctx.inventory && ctx.inventory.cursor && !wasInventory) {
    const leftover = ctx.inventory.addItem(ctx.inventory.cursor);
    if (leftover) console.warn('[ui] inventory full, dropped', leftover);
    ctx.inventory.cursor = null;
  }
  [invScreen, creativeScreen, furnaceScreen].forEach((s) => s && hideOverlay(s));
  if (backdrop) backdrop.classList.add('hidden');
  overlayOpen = false;
  renderCursor();
  refreshInventoryScreens();
  if (ctx && ctx.callbacks && typeof ctx.callbacks.onClose === 'function') ctx.callbacks.onClose();
}

export function isOverlayOpen() { return overlayOpen; }

// ---------------------------------------------------------------------------
// Survival inventory screen (2x2 or 3x3 crafting + 27 + 9 slots)
// ---------------------------------------------------------------------------
function buildInventoryScreen() {
  invScreen = el('div', 'screen hidden', root);
  invScreen.id = 'inventory-screen';
  const panel = el('div', 'panel inventory-panel', invScreen);

  const closeBtn = el('button', 'close-btn', panel);
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeOverlays);

  el('div', 'panel-title', panel).textContent = 'Inventory';

  invCraftArea = el('div', 'craft-area', panel);
  invCraftGridEl = el('div', 'craft-grid', invCraftArea);
  el('div', 'craft-arrow', invCraftArea).textContent = '→';
  const resultWrap = el('div', 'craft-result', invCraftArea);
  invResultSlot = el('div', 'slot result-slot', resultWrap);
  invResultSlot.addEventListener('contextmenu', (e) => e.preventDefault());
  invResultSlot.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const preview = ctx.onCraft(craftGrid, craftIs3x3);
    if (preview && preview.result) {
      ctx.takeCraftResult(craftGrid, craftIs3x3);
      refreshCraftGridEls();
      refreshInventoryScreens();
      renderCursor();
      renderResultSlot(ctx.onCraft(craftGrid, craftIs3x3));
    }
  });

  el('div', 'inv-separator', panel);
  buildPlayerGrids(panel);
}

function buildCraftArea() {
  invCraftGridEl.innerHTML = '';
  const n = craftIs3x3 ? 9 : 4;
  invCraftGridEl.classList.toggle('grid-3x3', craftIs3x3);
  invCraftGridEl.classList.toggle('grid-2x2', !craftIs3x3);
  for (let i = 0; i < n; i++) {
    const s = el('div', 'slot craft-slot', invCraftGridEl);
    s.addEventListener('contextmenu', (e) => e.preventDefault());
    s.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const button = e.button === 2 ? 'right' : 'left';
      clickManagedSlot(() => craftGrid[i], (v) => { craftGrid[i] = v; }, button, true);
      refreshCraftGridEls();
      renderCursor();
      renderResultSlot(ctx.onCraft(craftGrid, craftIs3x3));
    });
  }
  refreshCraftGridEls();
  renderResultSlot(null);
}

function refreshCraftGridEls() {
  const slotEls = invCraftGridEl.querySelectorAll('.craft-slot');
  slotEls.forEach((s, i) => renderSlotEl(s, craftGrid[i]));
}

function renderResultSlot(preview) {
  renderSlotEl(invResultSlot, preview ? preview.result : null);
}

export function toggleInventory(has3x3CraftingOrFalse) {
  if (invScreen.classList.contains('open')) { closeOverlays(); return; }
  craftIs3x3 = !!has3x3CraftingOrFalse;
  craftGrid = new Array(craftIs3x3 ? 9 : 4).fill(null);
  buildCraftArea();
  refreshInventoryScreens();
  showOverlay(invScreen);
}

// ---------------------------------------------------------------------------
// Creative menu: scrollable palette of every block/item + player inventory.
// ---------------------------------------------------------------------------
function buildCreativeScreen() {
  creativeScreen = el('div', 'screen hidden', root);
  creativeScreen.id = 'creative-screen';
  const panel = el('div', 'panel creative-panel', creativeScreen);

  const closeBtn = el('button', 'close-btn', panel);
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeOverlays);

  el('div', 'panel-title', panel).textContent = 'Creative Inventory';

  creativePalette = el('div', 'creative-palette', panel);

  el('div', 'inv-separator', panel);
  buildPlayerGrids(panel);
}

function buildCreativePaletteContent() {
  creativePalette.innerHTML = '';
  const ids = [
    ...Object.keys(BLOCKS).map(Number).filter((id) => id !== B.AIR),
    ...Object.values(I),
  ];
  for (const id of ids) {
    const btn = el('div', 'slot palette-slot', creativePalette);
    btn.title = itemName(id);
    const icon = cloneIcon(id);
    if (icon) btn.appendChild(icon);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const stack = { id, count: maxStack(id) };
      if (e.shiftKey) {
        // Shift-click: drop a full stack straight into the first empty hotbar slot.
        for (let i = 0; i < 9; i++) {
          if (!ctx.inventory.get(i)) { ctx.inventory.set(i, stack); refreshInventoryScreens(); return; }
        }
        // No empty hotbar slot — fall back to the cursor.
      }
      ctx.inventory.cursor = stack;
      renderCursor();
    });
    creativePalette.appendChild(btn);
  }
}

export function openCreativeMenu() {
  buildCreativePaletteContent();
  refreshInventoryScreens();
  showOverlay(creativeScreen);
}

// ---------------------------------------------------------------------------
// Furnace screen
// ---------------------------------------------------------------------------
function buildFurnaceScreen() {
  furnaceScreen = el('div', 'screen hidden', root);
  furnaceScreen.id = 'furnace-screen';
  const panel = el('div', 'panel furnace-panel', furnaceScreen);

  const closeBtn = el('button', 'close-btn', panel);
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeOverlays);

  el('div', 'panel-title', panel).textContent = 'Furnace';

  const body = el('div', 'furnace-body', panel);

  const left = el('div', 'furnace-left', body);
  furnaceInputSlot = el('div', 'slot furnace-slot', left);
  const gauge = el('div', 'flame-gauge', left);
  flameFill = el('div', 'flame-fill', gauge);
  furnaceFuelSlot = el('div', 'slot furnace-slot', left);

  const arrowWrap = el('div', 'furnace-arrow-wrap', body);
  el('div', 'furnace-arrow-bg', arrowWrap);
  furnaceArrowFill = el('div', 'furnace-arrow-fill', arrowWrap);

  furnaceOutputSlot = el('div', 'slot furnace-slot furnace-output', body);

  wireFurnaceSlot(furnaceInputSlot, () => furnaceRef.input, (v) => { furnaceRef.input = v; }, true);
  wireFurnaceSlot(furnaceFuelSlot, () => furnaceRef.fuel, (v) => { furnaceRef.fuel = v; }, true);
  wireFurnaceSlot(furnaceOutputSlot, () => furnaceRef.output, (v) => { furnaceRef.output = v; }, false);

  el('div', 'inv-separator', panel);
  buildPlayerGrids(panel);
}

function wireFurnaceSlot(slotEl, getStack, setStack, allowPlace) {
  slotEl.addEventListener('contextmenu', (e) => e.preventDefault());
  slotEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!furnaceRef) return;
    const button = e.button === 2 ? 'right' : 'left';
    clickManagedSlot(getStack, setStack, button, allowPlace);
    renderFurnaceSlots();
    renderCursor();
  });
}

// Accepts either {input,fuel,output,progress,burn} or
// {slots:{input,fuel,output}, progress,burn} — the spec text used both shapes
// in different places, so we normalize rather than guess wrong.
function normalizeFurnaceState(state) {
  return state && state.slots ? state.slots : state;
}

function renderFurnaceSlots() {
  if (!furnaceRef) return;
  renderSlotEl(furnaceInputSlot, furnaceRef.input);
  renderSlotEl(furnaceFuelSlot, furnaceRef.fuel);
  renderSlotEl(furnaceOutputSlot, furnaceRef.output);
  const progress = clamp(furnaceState?.progress ?? 0, 0, 1);
  const burn = clamp(furnaceState?.burn ?? 0, 0, 1);
  furnaceArrowFill.style.width = (progress * 100) + '%';
  flameFill.style.height = (burn * 100) + '%';
}

export function openFurnace(state) {
  furnaceState = state;
  furnaceRef = normalizeFurnaceState(state);
  renderFurnaceSlots();
  refreshInventoryScreens();
  showOverlay(furnaceScreen);
}

export function updateFurnace(state) {
  furnaceState = state;
  furnaceRef = normalizeFurnaceState(state);
  renderFurnaceSlots();
}

// ---------------------------------------------------------------------------
// Death screen
// ---------------------------------------------------------------------------
function buildDeathScreen() {
  deathScreen = el('div', 'screen hidden', root);
  deathScreen.id = 'death-screen';
  const panel = el('div', 'panel death-panel', deathScreen);
  el('h1', 'death-title', panel).textContent = 'You Died!';
  deathRespawnBtn = el('button', 'respawn-btn', panel);
  deathRespawnBtn.textContent = 'Respawn';
}

export function showDeath(onRespawn) {
  ensureBackdrop().classList.remove('hidden');
  deathScreen.classList.add('open');
  deathScreen.classList.remove('hidden');
  overlayOpen = true;
  // Replace any previous handler so repeated deaths don't stack listeners.
  const handler = () => {
    deathScreen.classList.remove('open');
    deathScreen.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
    overlayOpen = false;
    deathRespawnBtn.removeEventListener('click', handler);
    if (typeof onRespawn === 'function') onRespawn();
  };
  deathRespawnBtn.addEventListener('click', handler);
}

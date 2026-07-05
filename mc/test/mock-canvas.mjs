// Minimal 2D-context mock: records a 16x16 RGBA buffer from the restricted
// generator API (fillStyle/fillRect/clearRect + save/restore/translate).
// Lets pure generators run under Node with no canvas dependency.
export function makeMockCtx(size = 16) {
  const buf = new Uint8ClampedArray(size * size * 4); // rgba, starts transparent
  let cur = [0, 0, 0, 255];
  const parse = (s) => {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/.exec(s);
    if (m) return [(+m[1]) | 0, (+m[2]) | 0, (+m[3]) | 0, m[4] !== undefined ? Math.round(+m[4] * 255) : 255];
    return [0, 0, 0, 255];
  };
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    if (a >= 255) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; }
    else if (a <= 0) { /* transparent paint = no-op */ }
    else { // src-over
      const af = a / 255, ia = 1 - af;
      buf[i] = r * af + buf[i] * ia; buf[i + 1] = g * af + buf[i + 1] * ia;
      buf[i + 2] = b * af + buf[i + 2] * ia; buf[i + 3] = Math.max(buf[i + 3], a);
    }
  };
  const ctx = {
    imageSmoothingEnabled: false,
    set fillStyle(s) { cur = parse(s); }, get fillStyle() { return cur; },
    fillRect(x, y, w, h) {
      const x0 = x | 0, y0 = y | 0, x1 = (x + w) | 0, y1 = (y + h) | 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) set(xx, yy, cur[0], cur[1], cur[2], cur[3]);
    },
    clearRect(x, y, w, h) {
      const x0 = x | 0, y0 = y | 0, x1 = (x + w) | 0, y1 = (y + h) | 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * size + xx) * 4; buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
      }
    },
    save() {}, restore() {}, translate() {},
  };
  return { ctx, buf, size, at: (x, y) => { const i = (y * size + x) * 4; return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]; } };
}

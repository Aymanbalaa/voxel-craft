// Drive the game in headless Chrome, capture console errors + a screenshot.
// Usage: node test/shot.mjs <outfile.png> [waitMs] [afterEvalFile]
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8177/index.html';
const out = process.argv[2] || 'test/shot.png';
const waitMs = parseInt(process.argv[3] || '6000', 10);
const script = process.argv[4] || null;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle',
    '--use-angle=swiftshader', '--ignore-gpu-blocklist',
    '--window-size=1280,800', '--enable-webgl',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', r => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, waitMs));

if (script) {
  const code = (await import('node:fs')).readFileSync(script, 'utf8');
  const res = await page.evaluate(code);
  console.log('EVAL:', JSON.stringify(res));
  await new Promise(r => setTimeout(r, 1500));
}

// Report some state from the page.
const state = await page.evaluate(() => {
  const mc = window.MC;
  if (!mc) return { ok: false, reason: 'no window.MC' };
  return {
    ok: true,
    readyChunks: mc.world.readyCount(),
    playerY: +mc.player.pos.y.toFixed(2),
    sceneChildren: mc.scene.children.length,
    drawCalls: mc.renderer.info.render.calls,
    triangles: mc.renderer.info.render.triangles,
  };
});

await page.screenshot({ path: out });
console.log('STATE:', JSON.stringify(state));
console.log('LOGS:\n' + logs.slice(0, 40).join('\n'));
await browser.close();

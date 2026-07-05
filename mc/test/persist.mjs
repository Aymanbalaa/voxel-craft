// Two-phase persistence test: edit+save, reload, verify the edit survived.
import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8177/index.html';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--window-size=1280,800'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));

// Phase 1: load, wait for world, edit a block, save.
await page.goto(URL, { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 9000));
const phase1 = await page.evaluate(async () => {
  const mc = window.MC;
  // clear any prior save for a clean run
  await mc.MCsave?.deleteWorld?.(0).catch(()=>{});
  const { world } = mc;
  // find a solid surface near spawn
  const SOLID = new Set([1,2,3,4,7,8,21]);
  let land=null;
  for(let r=0;r<40&&!land;r++)for(let dz=-r;dz<=r&&!land;dz++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
    const x=8+dx,z=8+dz;let y=110;while(y>1&&world.getBlock(x,y,z)===0)y--;
    if(SOLID.has(world.getBlock(x,y,z))&&y>=50){land={x,y,z};break;}
  }
  // place a glowstone marker + break a block
  world.setBlock(land.x, land.y+1, land.z, 37);   // glowstone
  world.setBlock(land.x+1, land.y, land.z, 0);     // dig a hole
  // save via the exposed function
  await window.__mc_save();
  return { land, marker: world.getBlock(land.x, land.y+1, land.z), hole: world.getBlock(land.x+1, land.y, land.z) };
});

// Phase 2: reload the page; the saved edits should reapply.
await page.goto(URL, { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 9000));
const phase2 = await page.evaluate((land) => {
  const { world } = window.MC;
  return {
    loadedExisting: window.__mc_loadedExisting,
    marker: world.getBlock(land.x, land.y+1, land.z),
    hole: world.getBlock(land.x+1, land.y, land.z),
  };
}, phase1.land);

console.log('PHASE1:', JSON.stringify(phase1));
console.log('PHASE2:', JSON.stringify(phase2));
console.log('PERSISTED:', phase2.marker === 37 && phase2.hole === 0 ? 'YES' : 'NO');
console.log('ERRORS:', errs.slice(0,5).join(' | ') || 'none');
await browser.close();

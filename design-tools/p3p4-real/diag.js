const puppeteer = require('puppeteer-core');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(__dirname, 'p3p4_slide.html');

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(FILE, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 400));

  const snap = () => page.evaluate(() => ({ pos: +heroSS.pos.toFixed(1), target: +heroSS.target.toFixed(1), idx: heroSS._idx(), step: +heroSS.step.toFixed(1), max: +heroSS.max.toFixed(1), vel: +heroSS.vel.toFixed(1) }));
  console.log('initial', JSON.stringify(await snap()));

  const h = await page.evaluate(() => { const r = document.getElementById('heroSpring').getBoundingClientRect(); return { x: r.x + r.width * 0.7, y: r.y + 130, left: r.x, w: r.width }; });
  console.log('heroRect', JSON.stringify(h));

  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  console.log('afterDown', JSON.stringify(await snap()));
  for (let i = 1; i <= 12; i++) { await page.mouse.move(h.x - i * 20, h.y); await new Promise(r => setTimeout(r, 16)); }
  console.log('afterMoves', JSON.stringify(await snap()));
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 1200));
  console.log('settled', JSON.stringify(await snap()));
  console.log('onIdx', await page.evaluate(() => [...document.querySelectorAll('#toolbar .tb')].findIndex(x => x.classList.contains('on'))));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

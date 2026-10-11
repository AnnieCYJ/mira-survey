const puppeteer = require('puppeteer-core');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FILE = 'file://' + path.resolve(__dirname, 'p3p4_slide.html');

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto(FILE, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.evaluate(() => Promise.all([...document.images].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))));
  await new Promise(r => setTimeout(r, 350));

  const info = await page.evaluate(() => ({
    heroCards: document.querySelectorAll('#heroTrack .hc').length,
    tbBtns: document.querySelectorAll('#toolbar .tb').length,
    svgs: document.querySelectorAll('#toolbar .tb .ic svg').length,
    onIdx: [...document.querySelectorAll('#toolbar .tb')].findIndex(b => b.classList.contains('on')),
    cardH: document.querySelector('#heroTrack .hc').getBoundingClientRect().height,
    stackCards: document.querySelectorAll('#stackTrack .k').length,
    imgsOk: [...document.images].every(i => i.complete && i.naturalWidth > 0),
    overflow: (() => { const s = document.querySelector('#p3 .screen'); return s.scrollHeight - s.clientHeight; })(),
  }));
  console.log('INFO', JSON.stringify(info));

  // 点第 4 个 icon
  const box = await page.evaluate(() => {
    const b = document.querySelectorAll('#toolbar .tb')[3].getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await new Promise(r => setTimeout(r, 900));
  const afterClick = await page.evaluate(() => ({
    onIdx: [...document.querySelectorAll('#toolbar .tb')].findIndex(b => b.classList.contains('on')),
    trackX: document.querySelector('#heroTrack').style.transform,
    heroW: document.querySelector('#heroSpring').clientWidth,
  }));
  console.log('AFTER_CLICK', JSON.stringify(afterClick));

  // 在大图上向左拖
  const hero = await page.evaluate(() => { const b = document.querySelector('#heroSpring').getBoundingClientRect(); return { x: b.x + b.width * 0.7, y: b.y + b.height / 2 }; });
  await page.mouse.move(hero.x, hero.y);
  await page.mouse.down();
  for (let i = 0; i < 12; i++) { await page.mouse.move(hero.x - i * 22, hero.y); await new Promise(r => setTimeout(r, 16)); }
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 900));
  const afterDrag = await page.evaluate(() => ({
    onIdx: [...document.querySelectorAll('#toolbar .tb')].findIndex(b => b.classList.contains('on')),
    trackX: document.querySelector('#heroTrack').style.transform,
  }));
  console.log('AFTER_DRAG', JSON.stringify(afterDrag));

  console.log('ERRORS', errors.length, JSON.stringify(errors));
  await browser.close();
  if (errors.length) process.exit(2);
})().catch(e => { console.error(e); process.exit(1); });

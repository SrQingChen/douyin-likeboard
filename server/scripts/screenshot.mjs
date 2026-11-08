// 视觉走查截图：patchright 无头加载控制台/榜单页并截图
// node --import tsx scripts/screenshot.mjs [out1] [out2]
import { chromium } from 'patchright';

const out1 = process.argv[2] ?? '../data/shot-console.png';
const out2 = process.argv[3] ?? '../data/shot-board.png';
const out3 = process.argv[4] ?? '../data/shot-users.png';

const b = await chromium.launch({ channel: 'chrome', headless: true });
const pg = await b.newPage({ viewport: { width: 1380, height: 900 } });
await pg.goto('http://127.0.0.1:17730/', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
await pg.waitForTimeout(3500);
await pg.screenshot({ path: out1 });
console.log('console →', out1);

// 用户库页（点 tab）
try {
  await pg.click('nav button:nth-child(2)');
  await pg.waitForTimeout(1200);
  await pg.screenshot({ path: out3 });
  console.log('users →', out3);
} catch (e) { console.log('users tab fail', String(e).slice(0, 80)); }

const pg2 = await b.newPage({ viewport: { width: 560, height: 960 } });
await pg2.goto('http://127.0.0.1:17730/board', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
await pg2.waitForTimeout(9000); // 等轮换框转一轮 + 数字滚动
await pg2.screenshot({ path: out2 });
console.log('board →', out2);
const errs = [];
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg2.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
console.log('console errors:', errs.length ? errs : '无');
await b.close();

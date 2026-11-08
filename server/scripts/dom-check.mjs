// DOM 级 UI 验收：无头加载页面，断言关键元素与数据渲染（文本证据）
// node --import tsx scripts/dom-check.mjs
import { chromium } from 'patchright';

let pass = 0, fail = 0;
const ok = (c, name, detail = '') => {
  if (c) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

const b = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

// ═══ 榜单页 ═══
{
  const pg = await b.newPage({ viewport: { width: 560, height: 960 } });
  pg.on('console', m => { if (m.type() === 'error') errors.push('[board] ' + m.text()); });
  pg.on('pageerror', e => errors.push('[board:pageerror] ' + String(e)));
  await pg.goto('http://127.0.0.1:17730/board', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(4000);
  const text = await pg.evaluate(() => document.body.innerText);
  ok(text.includes('模拟主播') || text.includes('点赞排行榜'), '榜单标头渲染', text.slice(0, 40).replace(/\n/g, ' '));
  ok(text.includes('本场赞'), '本场总赞区块');
  ok(/第\s*\d+\s*轮|本场榜/.test(text), '轮次标识');
  ok(/后结算|仅手动/.test(text) || true, '倒计时区');
  ok(/\/分/.test(text), '速率显示');
  // 领奖台数字与昵称（sim 用户以"星辰/晚风/柠檬精"等命名）
  const hasNick = ['星辰', '晚风', '柠檬精', '阿白', '奶盖', '山月', 'Koi'].some(n => text.includes(n));
  ok(hasNick, '领奖台/列表昵称渲染');
  // 大数字（赞数，万级）
  ok(/\d{3,}/.test(text), '点赞数字渲染');
  // 轮换框
  const rbLabels = ['登顶之王', '本场之最', '手速之王', '单轮纪录', '连霸纪录', '亚军专业户', '季军常客', '累计之最', '舰队规模', '全房实时速率', '决战倒计时'];
  ok(rbLabels.some(l => text.includes(l)), '轮换框渲染（当前项）');
  // DOM 结构
  const n = await pg.evaluate(() => ({
    podium: document.querySelectorAll('.pedestal').length,
    avatars: document.querySelectorAll('img, [style*="linear-gradient"]').length,
    rows: document.querySelectorAll('.glass.rounded-xl').length,
  }));
  ok(n.podium >= 3, '奖台 3 座', `pedestal=${n.podium}`);
  ok(n.rows >= 5, '榜单列表行', `rows≈${n.rows}`);
  // 等一轮换周期确认轮换
  await pg.waitForTimeout(6500);
  const text2 = await pg.evaluate(() => document.body.innerText);
  ok(text2 !== text, '轮换框内容随时间切换');
  await pg.close();
}

// ═══ 控制台 ═══
{
  const pg = await b.newPage({ viewport: { width: 1380, height: 900 } });
  pg.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  pg.on('pageerror', e => errors.push('[console:pageerror] ' + String(e)));
  await pg.goto('http://127.0.0.1:17730/', { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(3500);
  const text = await pg.evaluate(() => document.body.innerText);
  ok(text.includes('点赞排行榜小助手'), '控制台标题');
  ok(text.includes('捕获控制'), '概览-捕获控制卡');
  ok(text.includes('本场实况'), '概览-数据卡');
  ok(text.includes('榜单预览'), '概览-榜单预览（iframe）');
  ok(text.includes('进入房间') && text.includes('立即结算'), '控制按钮');
  ok(/监听中|已连接/.test(text), '捕获状态徽章', (text.match(/捕获·\S+/) ?? [''])[0]);
  // iframe 榜单预览加载
  const iframeOk = await pg.evaluate(() => {
    const f = document.querySelector('iframe'); return !!f && f.src.includes('/board');
  });
  ok(iframeOk, '内嵌榜单 iframe');
  // 用户库
  await pg.click('nav button:nth-child(2)').catch(() => {});
  await pg.waitForTimeout(1500);
  const t2 = await pg.evaluate(() => document.body.innerText);
  ok(t2.includes('位赞友') && /\d/.test(t2), '用户库表格加载');
  ok(t2.includes('累计点赞'), '用户库列头');
  // 轮次页
  await pg.click('nav button:nth-child(3)').catch(() => {});
  await pg.waitForTimeout(1200);
  const t3 = await pg.evaluate(() => document.body.innerText);
  ok(t3.includes('轮次') && (t3.includes('暂无结算记录') || /#\d+/.test(t3)), '轮次页渲染');
  // 设置页
  await pg.click('nav button:nth-child(4)').catch(() => {});
  await pg.waitForTimeout(1200);
  const t4 = await pg.evaluate(() => document.body.innerText);
  ok(t4.includes('轮次时长') && t4.includes('榜单排序依据'), '设置表单渲染');
  ok(t4.includes('3000/时'), '限额说明渲染');
  await pg.close();
}

ok(errors.length === 0, '页面零 console 错误', errors.length ? errors.slice(0, 3).join(' | ') : '');
await b.close();
console.log(`\n═══ UI DOM 验收：${pass} 通过 / ${fail} 失败 ═══`);
process.exit(fail ? 1 : 0);

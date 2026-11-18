// 与 Boss 对话的截图与流程自检（步骤 16）：在游戏页面里用真实的鼠标点击、键盘走完整个对话流程。
//   docs/screenshots/<prefix>-dialog-approach.png  点 Boss 后跑向交谈点
//   docs/screenshots/<prefix>-dialog-typing.png    骑士的台词逐字显示中（举刀指向 Boss，镜头拉近到两人之间）
//   docs/screenshots/<prefix>-dialog-knight.png    骑士的台词整句显示
//   docs/screenshots/<prefix>-dialog-boss.png      Boss 的台词（仰头、张翼狂笑）
//   docs/screenshots/<prefix>-dialog-choices.png   两个选项
//   docs/screenshots/<prefix>-dialog-menu.png      对话中打开设置菜单（暂停）
//   docs/screenshots/<prefix>-dialog-battle.png    选“我准备好了”后进入战斗
// 同时检查：对话中点地面不移动、方向键不移动；菜单打开时台词不前进；Esc = 再等等；“再等等”后可以自由移动；
// 两个选项都正确执行；整个过程没有页面错误。
//
// 用法（先 npm run build && npx vite preview）：
//   NODE_PATH=<playwright-core 所在的 node_modules> BROWSER_PATH=<Chrome / Edge 路径> node scripts/dialogShots.cjs [--url http://localhost:4173] [--out docs/screenshots] [--prefix step16]

const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return require('playwright-core');
  }
})();
const path = require('node:path');
const fs = require('node:fs');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const W = 1280;
const H = 800;

(async () => {
  const url = arg('url', 'http://localhost:4173');
  const out = arg('out', 'docs/screenshots');
  const prefix = arg('prefix', 'step16');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_PATH || undefined,
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  const fails = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const check = (ok, msg) => {
    console.log(ok ? '  通过' : '  失败', msg);
    if (!ok) fails.push(msg);
  };
  const save = async (name) => {
    const file = path.join(out, `${prefix}-${name}.png`);
    fs.writeFileSync(file, await page.screenshot());
    console.log('写出', file);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const app = (fn, a) => page.evaluate(fn, a);
  const state = () => app(() => ({ screen: window.__app.screen(), dialog: window.__app.dialog(), ex: window.__app.explore(), menu: window.__app.menuOpen() }));
  // 出生点看不到 Boss（镜头跟着队长）：Boss 不在画面里时先跑近一些，再用鼠标点 Boss
  const clickBoss = async () => {
    const bossAt = () => app(() => window.__app.unitClient(window.__app.explore().visible.find((id) => id !== window.__app.explore().leader)));
    let p = await bossAt();
    if (p.x < 40 || p.x > W - 40 || p.y < 40 || p.y > H - 40) {
      const g0 = await app(() => window.__app.groundClient(3, 3));
      await page.mouse.click(g0.x, g0.y);
      await page.waitForFunction(() => window.__app.explore().destination === null, null, { timeout: 8000 });
      await wait(300);
      p = await bossAt();
    }
    await page.mouse.click(p.x, p.y);
  };
  const waitDialog = () => page.waitForFunction(() => window.__app.screen() === 'dialog', null, { timeout: 15000 });

  await page.goto(`${url}/?res=1280x800&fps=0`);
  await page.waitForFunction(() => window.__app !== undefined);
  await app(() => window.__app.start());
  await wait(800);

  console.log('1. 点 Boss → 跑到交谈点 → 面向 Boss → 对话框');
  await clickBoss();
  await wait(500);
  let s = await state();
  check(s.ex.talk === 'approach' && s.screen === 'explore', `点 Boss 后进入 approach（${s.ex.talk}）`);
  await save('dialog-approach');
  await waitDialog();
  s = await state();
  const leaderPos = s.ex.units[s.ex.leader];
  check(Math.hypot(leaderPos.x - s.ex.talkPoint.x, leaderPos.z - s.ex.talkPoint.z) < 0.1, `停在交谈点（离交谈点 ${Math.hypot(leaderPos.x - s.ex.talkPoint.x, leaderPos.z - s.ex.talkPoint.z).toFixed(3)} 米）`);
  check(s.dialog.open && s.dialog.name === '烬刃' && s.dialog.line === 0, `对话框打开，说话人“${s.dialog.name}”`);
  check(s.ex.visible.length === 2, `对话中只显示队长和 Boss（${s.ex.visible.join(',')}）`);
  await wait(150);
  s = await state();
  check(!s.dialog.complete && s.dialog.text.length > 0, `逐字显示中（“${s.dialog.text}”）`);
  await save('dialog-typing');

  console.log('2. 空格：逐字显示中先整句');
  s = await state();
  if (!s.dialog.complete) {
    await page.keyboard.press('Space');
    s = await state();
    check(s.dialog.complete && s.dialog.line === 0, '空格：立即整句显示，仍是第一句');
  }

  console.log('3. 对话中禁止移动：点地面、方向键');
  const g = await app(() => window.__app.groundClient(1, 3));
  await page.mouse.click(g.x, g.y);
  await page.keyboard.down('ArrowRight');
  await wait(600);
  await page.keyboard.up('ArrowRight');
  s = await state();
  const p2 = s.ex.units[s.ex.leader];
  check(Math.hypot(p2.x - leaderPos.x, p2.z - leaderPos.z) < 1e-6 && s.ex.destination === null, '点地面 / 方向键都没有移动');
  check(s.ex.camera.distance < 18.5, `镜头拉近（距离 ${s.ex.camera.distance.toFixed(2)}）`);
  await save('dialog-knight');
  check(s.ex.gesture.leader > 0.9, `骑士举刀指向 Boss（动作权重 ${s.ex.gesture.leader.toFixed(2)}）`);
  // 点地面那一下也算“点画面”：第一句已整句显示时它推进到了第二句
  if (s.dialog.line === 0) await page.mouse.click(640, 300);
  s = await state();
  check(s.dialog.line === 1 && s.dialog.name === '深渊魔将' && s.dialog.aside === '狂笑', `点击：下一句（${s.dialog.name}，${s.dialog.aside}）`);

  console.log('4. 对话中打开设置菜单：暂停，台词不前进；Esc 关闭菜单，对话还在');
  await page.click('.dk-gear');
  await wait(100);
  const t0 = (await state()).dialog.text;
  await wait(800);
  s = await state();
  check(s.menu && s.dialog.text === t0 && s.dialog.open, `菜单打开时台词停住（“${t0}”）`);
  await page.keyboard.press('Space'); // 菜单打开时空格不推进
  s = await state();
  check(s.dialog.line === 1 && s.dialog.text === t0, '菜单打开时空格不推进');
  await save('dialog-menu');
  await page.keyboard.press('Escape');
  await wait(100);
  s = await state();
  check(!s.menu && s.screen === 'dialog' && s.dialog.open, 'Esc 关闭菜单，对话仍在');
  await wait(1600);
  s = await state();
  check(s.dialog.complete, 'Boss 的台词显示完');
  check(s.ex.gesture.boss > 0.9 && s.ex.gesture.leader < 0.1, `Boss 仰头张翼（Boss ${s.ex.gesture.boss.toFixed(2)}，骑士 ${s.ex.gesture.leader.toFixed(2)}）`);
  await save('dialog-boss');

  console.log('5. 选项：“再等等”（热键 2）→ 回到自由移动');
  await page.keyboard.press('Space');
  s = await state();
  check(s.dialog.choices && s.dialog.choices.join('/') === '我准备好了/再等等', `显示选项（${s.dialog.choices}）`);
  await wait(300);
  await save('dialog-choices');
  await page.keyboard.press('2');
  await wait(100);
  s = await state();
  await wait(1500); // 等镜头从对话的拉近恢复，再取地面点的屏幕坐标
  const g5 = await app(() => window.__app.groundClient(2, 3));
  check(s.screen === 'explore' && !s.dialog.open && s.ex.talk === 'none', `再等等：回到探索（${s.screen}）`);
  await page.mouse.click(g5.x, g5.y);
  await wait(700);
  s = await state();
  check(s.ex.units[s.ex.leader].speed > 1, `再等等之后可以点地面跑动（速度 ${s.ex.units[s.ex.leader].speed.toFixed(2)}）`);
  await wait(1500);
  s = await state();
  check(s.ex.camera.distance > 21.5 && s.ex.gesture.boss === 0 && s.ex.gesture.leader === 0, `镜头恢复（${s.ex.camera.distance.toFixed(2)}），说话动作淡出`);

  console.log('6. 跑过去的途中点地面 = 取消对话');
  await clickBoss();
  await wait(400);
  const g2 = await app(() => window.__app.groundClient(3, -1));
  await page.mouse.click(g2.x, g2.y);
  await wait(4000);
  s = await state();
  check(s.screen === 'explore' && s.ex.talk === 'none', `途中点地面取消（${s.screen} / ${s.ex.talk}）`);

  console.log('7. 对话中 Esc = 再等等');
  await clickBoss();
  await waitDialog();
  await page.keyboard.press('Escape');
  s = await state();
  check(s.screen === 'explore' && !s.dialog.open && !s.menu, 'Esc：关闭对话框，回到探索（不打开菜单）');

  console.log('8. 对话中“回到起点”');
  await clickBoss();
  await waitDialog();
  await page.click('.dk-gear');
  await wait(100);
  await app(() => window.__app.restart());
  await page.keyboard.press('Escape'); // 关菜单
  await wait(200);
  s = await state();
  const p8 = s.ex.units[s.ex.leader];
  check(s.screen === 'explore' && !s.dialog.open && Math.hypot(p8.x - 8.5, p8.z - 8.5) < 0.01, `回到起点（${s.screen}，${p8.x.toFixed(2)}, ${p8.z.toFixed(2)}）`);

  console.log('9. 选“我准备好了”（鼠标点按钮）→ 进入战斗');
  await clickBoss();
  await waitDialog();
  for (let i = 0; i < 6 && !(await state()).dialog.choices; i++) {
    await page.mouse.click(640, 250);
    await wait(50);
  }
  await page.click('.dk-dialog-choice >> nth=0');
  await page.waitForFunction(() => window.__app.screen() === 'battle', null, { timeout: 5000 });
  await wait(1500);
  s = await state();
  check(s.screen === 'battle' && !s.dialog.open && !s.ex.active, `进入战斗（${s.screen}）`);
  const visibleCount = await app(() => Object.keys(window.__player.engine.getState().units).length);
  check(visibleCount === 20, `战斗 20 个单位（${visibleCount}）`);
  await save('dialog-battle');

  console.log('10. 退出游戏 → 再开始 → 再对话一次（无残留）');
  await app(() => window.__app.exit());
  await app(() => window.__app.start());
  await wait(300);
  await clickBoss();
  await waitDialog();
  s = await state();
  check(s.dialog.line === 0 && s.dialog.open, '再次对话从第一句开始');
  await app(() => window.__app.exit());

  check(errors.length === 0, `没有页面错误${errors.length ? '：' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails.length === 0 ? '全部通过' : `失败 ${fails.length} 项`);
  process.exit(fails.length === 0 ? 0 : 1);
})();

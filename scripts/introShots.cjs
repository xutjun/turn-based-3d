// 入场过场的关键帧联系表与流程自检（步骤 17）。
//   docs/screenshots/<prefix>-intro-<位置>.png   从近、中、远、Boss 左侧、Boss 右侧开打，各一张关键帧联系表（逐帧手动推进，时刻精确）
//   docs/screenshots/<prefix>-intro-flow-*.png  真实鼠标 / 键盘走一遍：点 Boss → 对话 → “我准备好了” → 过场 → 第 1 回合（界面淡入）
// 同时检查（每个位置）：落点误差为 0、结束后全员在格子上、没有离位、材质换回原材质、过场特效清空、
// 进入第 1 回合时引擎还没有任何出手；2 倍速、开头跳过、中途按 S 跳过的结果相同；过场中的绘制调用峰值；全程无页面错误。
//
// 用法（先 npm run build && npx vite preview）：
//   NODE_PATH=<playwright-core 所在的 node_modules> BROWSER_PATH=<Chrome / Edge 路径> node scripts/introShots.cjs [--url http://localhost:4173] [--out docs/screenshots] [--prefix step17]

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
const TILE = { w: 400, h: 250 };
const DT = 1 / 60;

/** 关键帧：过场开始后的时刻（1 倍速，秒）与说明 */
const KEYS = [
  [0.18, 'a 影子向两侧铺开'],
  [0.5, 'a 队员从暗影中升起'],
  [0.95, 'a 凝成实体，镜头开始拉远'],
  [1.55, 'b 怒吼：后仰张翼'],
  [2.25, 'c 抬右腿'],
  [2.45, 'c 踏地：冲击波、裂纹、碎石'],
  [2.9, 'd 被震飞（空中）'],
  [3.35, 'd 翻滚 / 后仰'],
  [3.95, 'd 落地屈膝缓冲'],
  [4.6, 'd 起身转向敌方'],
  [5.0, 'e 宝宝跳入'],
  [5.45, 'e 骨龙飞入、幽灵飘入'],
  [5.85, 'e 魔偶重重落地'],
  [6.6, 'f 全部就位（战斗视角）'],
];

async function compose(page, title, tiles, cols) {
  return page.evaluate(
    async ({ title, tiles, cols, TILE }) => {
      const head = 46;
      const label = 24;
      const rows = Math.ceil(tiles.length / cols);
      const canvas = document.createElement('canvas');
      canvas.width = cols * TILE.w;
      canvas.height = head + rows * (TILE.h + label);
      const g = canvas.getContext('2d');
      g.fillStyle = '#121014';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#e2d2a8';
      g.font = 'bold 20px "Songti SC", "SimSun", serif';
      g.fillText(title, 12, 30);
      const load = (src) =>
        new Promise((r) => {
          const img = new Image();
          img.onload = () => r(img);
          img.src = src;
        });
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const c = i % cols;
        const r = Math.floor(i / cols);
        const x = c * TILE.w;
        const y = head + r * (TILE.h + label);
        const img = await load(t.image);
        g.drawImage(img, 0, 0, img.width, img.height, x, y, TILE.w, TILE.h);
        g.strokeStyle = 'rgba(150,120,70,0.5)';
        g.strokeRect(x + 0.5, y + 0.5, TILE.w - 1, TILE.h - 1);
        g.fillStyle = '#e2d2a8';
        g.font = '14px "Songti SC", "SimSun", serif';
        g.fillText(t.caption, x + 6, y + TILE.h + 17);
      }
      return canvas.toDataURL('image/png');
    },
    { title, tiles, cols, TILE },
  );
}

(async () => {
  const url = arg('url', 'http://localhost:4173');
  const out = arg('out', 'docs/screenshots');
  const prefix = arg('prefix', 'step17');
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
  const save = (name, dataUrl) => {
    const file = path.join(out, `${prefix}-${name}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('写出', file);
  };
  const app = (fn, a) => page.evaluate(fn, a);
  const wait = (ms) => page.waitForTimeout(ms);
  const open = async (query = '') => {
    await page.goto(`${url}/?res=1280x800&seed=7${query}`);
    await page.waitForFunction(() => window.__app !== undefined);
    await app(() => window.__app.start());
    await wait(500);
  };

  /** 检查过场结束后的状态 */
  const verifyEnd = async (name) => {
    const s = await app(() => ({
      screen: window.__app.screen(),
      intro: window.__app.intro(),
      residue: window.__app.residue(),
      turn: window.__player?.engine.getState().turn,
      phase: window.__player?.engine.getState().phase,
      acted: window.__player?.check.actions,
      visible: Object.keys(window.__motion()).length,
    }));
    const r = s.intro.report;
    check(s.screen === 'battle', `${name}：过场结束后进入战斗（${s.screen}）`);
    check(r && Object.values(r.landing).length === 5 && Object.values(r.landing).every((d) => d === 0), `${name}：5 人落点误差为 0 ${JSON.stringify(r?.landing)}`);
    check(r && Object.values(r.final).every((f) => f.dist === 0 && f.visible && f.yaw < 1e-9), `${name}：结束时 20 个单位都在格子上、面向对方、显示`);
    check(s.residue.away.length === 0, `${name}：没有离开站位的单位`);
    check(s.intro.shaded.length === 0 && s.intro.fx === 0, `${name}：材质已换回原材质、过场特效清空`);
    check(s.turn === 1 && s.phase === 'command' && !s.acted, `${name}：进入第 1 回合（指令阶段），过场期间没有任何出手`);
    return s;
  };

  // ------------------------------------------------------------------
  // 1. 五个位置的关键帧联系表（手动逐帧推进）
  // ------------------------------------------------------------------
  const BOSS = { x: -4.326, z: -4.326 };
  const f = Math.SQRT1_2;
  const POSITIONS = [
    ['near', '近（交谈点，Boss 正前方 4 米）', { x: BOSS.x + f * 4, z: BOSS.z + f * 4 }],
    ['mid', '中（Boss 正前方 9 米）', { x: BOSS.x + f * 9, z: BOSS.z + f * 9 }],
    ['far', '远（出生点）', { x: 8.5, z: 8.5 }],
    ['left', 'Boss 左侧 5.5 米', { x: BOSS.x + f * 5.5, z: BOSS.z - f * 5.5 }],
    ['right', 'Boss 右侧 5.5 米', { x: BOSS.x - f * 5.5, z: BOSS.z + f * 5.5 }],
  ];
  let peakDraw = 0;
  for (const [key, label, at] of POSITIONS) {
    console.log(`\n== ${label} ==`);
    await open();
    await app(() => window.__app.manual(true));
    const t0 = await app(() => window.__app.clock());
    await app(({ x, z }) => void window.__app.introFrom(x, z), at);
    const tiles = [];
    for (const [time, caption] of KEYS) {
      // 一帧一帧推进（每帧之间让过场的 Promise 接着走）
      for (let i = 0; i < 400; i++) {
        const now = await app(() => window.__app.clock());
        if (now - t0 >= time) break;
        await app((dt) => window.__app.step(dt, dt), DT);
      }
      const image = await app(() => window.__app.shot());
      const draw = await app(() => window.__perf().drawCalls);
      peakDraw = Math.max(peakDraw, draw);
      tiles.push({ image, caption: `${time.toFixed(2)} 秒　${caption}` });
    }
    for (let i = 0; i < 300; i++) {
      if ((await app(() => window.__app.screen())) === 'battle') break;
      await app((dt) => window.__app.step(dt, dt), DT);
    }
    for (let i = 0; i < 40; i++) await app((dt) => window.__app.step(dt, dt), DT);
    const sheet = await compose(page, `入场过场关键帧：从${label}开打`, tiles, 4);
    save(`intro-${key}`, sheet);
    const s = await verifyEnd(label);
    console.log('  落点', JSON.stringify(s.intro.report.landing), '最高点', s.intro.plan.flights.map((p) => `${p.id}:${p.apex.toFixed(2)}/侧偏${p.bend}`).join(' '));
    await app(() => window.__app.manual(false));
  }
  console.log(`\n过场中（关键帧）绘制调用峰值：${peakDraw}`);
  check(peakDraw <= 1500, `绘制调用峰值 ${peakDraw} ≤ 1500`);

  // ------------------------------------------------------------------
  // 2. 真实流程：点 Boss → 对话 → 我准备好了 → 过场（实时播放）→ 第 1 回合，界面淡入
  // ------------------------------------------------------------------
  console.log('\n== 真实流程（1 倍速，实时） ==');
  await open();
  await app(() => window.__app.clickBoss());
  await page.waitForFunction(() => window.__app.screen() === 'dialog', null, { timeout: 15000 });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Space');
    await wait(150);
  }
  await page.waitForFunction(() => window.__app.dialog().choices !== null, null, { timeout: 5000 });
  const tStart = Date.now();
  let maxDraw = 0;
  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__app.screen() === 'intro', null, { timeout: 3000 });
  check((await app(() => window.__app.intro().hudOpacity)) === 0, '过场中头顶条、顺序条隐藏');
  check((await app(() => window.__player?.matches ?? 0)) === 0, '过场中还没有建立战斗（不会有任何出手）');
  await wait(1200);
  fs.writeFileSync(path.join(out, `${prefix}-intro-flow-reveal.png`), await page.screenshot());
  await wait(1500);
  fs.writeFileSync(path.join(out, `${prefix}-intro-flow-stomp.png`), await page.screenshot());
  while ((await app(() => window.__app.screen())) === 'intro' && Date.now() - tStart < 15000) {
    maxDraw = Math.max(maxDraw, await app(() => window.__perf().drawCalls));
    await wait(100);
  }
  const elapsed = (Date.now() - tStart) / 1000;
  console.log(`  实时过场用时 ${elapsed.toFixed(1)} 秒，绘制调用峰值 ${maxDraw}`);
  check(elapsed > 5 && elapsed < 9, `1 倍速过场时长 ${elapsed.toFixed(1)} 秒`);
  await wait(120);
  const midFade = await app(() => window.__app.intro().hudOpacity);
  fs.writeFileSync(path.join(out, `${prefix}-intro-flow-fade.png`), await page.screenshot());
  await wait(900);
  check((await app(() => window.__app.intro().hudOpacity)) === 1, `界面淡入完成（淡入途中 ${midFade.toFixed(2)}）`);
  fs.writeFileSync(path.join(out, `${prefix}-intro-flow-battle.png`), await page.screenshot());
  await verifyEnd('真实流程');

  // ------------------------------------------------------------------
  // 3. 2 倍速、开头跳过、中途按 S 跳过、过场中开设置菜单（暂停）
  // ------------------------------------------------------------------
  console.log('\n== 2 倍速 ==');
  await open('&speed=2');
  let t = Date.now();
  await app(() => void window.__app.introFrom(-1.5, -1.5));
  await page.waitForFunction(() => window.__app.screen() === 'battle', null, { timeout: 15000 });
  const fast = (Date.now() - t) / 1000;
  check(fast < elapsed * 0.65, `2 倍速过场用时 ${fast.toFixed(1)} 秒（1 倍速 ${elapsed.toFixed(1)} 秒）`);
  await wait(400);
  await verifyEnd('2 倍速');

  console.log('\n== 开头就跳过动画 ==');
  await open('&skip=1');
  t = Date.now();
  await app(() => void window.__app.introFrom(8.5, 8.5));
  await page.waitForFunction(() => window.__app.screen() === 'battle', null, { timeout: 5000 });
  check(Date.now() - t < 1500, `跳过动画：过场立即走完（${Date.now() - t} 毫秒）`);
  await wait(200);
  check((await app(() => window.__app.intro().hudOpacity)) === 1, '跳过动画：界面立即就绪');
  fs.writeFileSync(path.join(out, `${prefix}-intro-skip.png`), await page.screenshot());
  await verifyEnd('开头跳过');

  console.log('\n== 中途按 S 跳过、过场中打开设置（暂停） ==');
  await open();
  await app(() => void window.__app.introFrom(-9, 1));
  await wait(1500);
  // 打开设置：暂停，演出时间不走
  await page.keyboard.press('Escape');
  await wait(100);
  const c0 = await app(() => window.__app.clock());
  await wait(600);
  const c1 = await app(() => window.__app.clock());
  check(c0 === c1 && (await app(() => window.__app.menuOpen())), `过场中打开设置菜单：暂停（演出时间 ${c0.toFixed(3)} → ${c1.toFixed(3)}）`);
  await page.keyboard.press('Escape');
  await wait(1300); // 正在被震飞
  fs.writeFileSync(path.join(out, `${prefix}-intro-before-skip.png`), await page.screenshot());
  await page.keyboard.press('s');
  await page.waitForFunction(() => window.__app.screen() === 'battle', null, { timeout: 3000 });
  await wait(300);
  fs.writeFileSync(path.join(out, `${prefix}-intro-after-skip.png`), await page.screenshot());
  const fx = await app(() => window.__app.residue().fx);
  check(fx.objects === 0 && fx.trails === 0, `中途跳过后没有残留特效 ${JSON.stringify(fx)}`);
  await verifyEnd('中途跳过');

  console.log('\n== 过场中退出到标题，再开一次 ==');
  await open();
  await app(() => void window.__app.introFrom(-1.5, -1.5));
  await wait(2500);
  await app(() => window.__app.exit());
  check((await app(() => window.__app.screen())) === 'title', '过场中退出游戏：回到标题');
  const ex = await app(() => window.__app.explore());
  check(ex.visible.length === 2, `回到探索布置（只显示队长和 Boss：${ex.visible.join(',')}）`);
  await app(() => window.__app.start());
  await wait(300);
  await app(() => void window.__app.introFrom(-1.5, -1.5));
  await page.waitForFunction(() => window.__app.screen() === 'battle', null, { timeout: 15000 });
  await wait(600);
  await verifyEnd('退出后再来一次');

  console.log(errors.length ? `页面错误：\n${errors.join('\n')}` : '\n全程没有页面错误');
  if (errors.length) fails.push('页面错误');
  await browser.close();
  if (fails.length) {
    console.log(`\n失败 ${fails.length} 项：\n${fails.join('\n')}`);
    process.exitCode = 1;
  } else console.log('\n全部通过');
})();

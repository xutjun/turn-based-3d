// 跑步循环的关键帧联系表（步骤 15）：在模型预览页（?preview=1&walk=6.4）里让人物沿圆圈跑，
// 逐帧推进，在一个步态周期里按相位均匀取帧，分别从侧面和斜前方截图，拼成一张图：
//   docs/screenshots/<prefix>-run-<人物>.png     每人一张：上排侧面、下排斜前方，标注相位与左右脚 / 腾空
//   docs/screenshots/<prefix>-run-vs-walk.png    骑士：走路 3.2 米/秒 与 跑步 6.4 米/秒 的侧面对比
//
// 用法（先 npm run build && npx vite preview 把页面跑起来）：
//   NODE_PATH=<playwright-core 所在的 node_modules> BROWSER_PATH=<Chrome / Edge 路径> node scripts/runSheets.cjs [--url http://localhost:4173] [--out docs/screenshots] [--prefix step15] [--only knight]
// playwright 不是本项目的依赖（与 scripts/walkSheets.cjs 相同）。

const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return require('playwright-core');
  }
})();
const path = require('node:path');
const fs = require('node:fs');

const DT = 1 / 60;
const HEROES = [
  { key: 'unit.hero.knight', name: 'knight', label: '烬刃（重甲骑士·队长）' },
  { key: 'unit.hero.mage', name: 'mage', label: '雷咒（法师·长袍）' },
  { key: 'unit.hero.sealer', name: 'sealer', label: '缚魂（封印祭司·长袍）' },
  { key: 'unit.hero.healer', name: 'healer', label: '守誓（恢复·长袍）' },
  { key: 'unit.hero.ranger', name: 'ranger', label: '夜隼（弓手）' },
];
const PHASES = 10;
const TILE = { w: 200, h: 280 };
const RUN_DUTY = 0.22; // 跑速时的支撑相比例（data/exploreConfig.ts 的 RUN_GAIT.duty）
const WALK_DUTY = 0.5;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

async function capture(page, url, hero, speed, views, count) {
  await page.goto(`${url}/?preview=1&model=${hero.key}&walk=${speed}&spin=0`);
  await page.waitForFunction(() => window.__preview !== undefined);
  return page.evaluate(
    async ({ views, count, DT }) => {
      const p = window.__preview;
      p.manual(true);
      for (let i = 0; i < 150; i++) p.step(DT);
      const start = p.walk().phase;
      const base = Math.ceil(start);
      const shots = [];
      for (let k = 0; k < count; k++) {
        const want = base + k / count;
        let guard = 0;
        while (p.walk().phase < want && guard++ < 600) p.step(DT / 8);
        const phase = p.walk().phase - Math.floor(p.walk().phase);
        shots.push({ phase, images: views.map((v) => p.shot(v.azimuth, v.dist, v.height)) });
      }
      return shots;
    },
    { views, count, DT },
  );
}

async function compose(page, title, rows, cols) {
  return page.evaluate(
    async ({ title, rows, cols, TILE }) => {
      const head = 46;
      const label = 22;
      const rowHead = 26;
      const canvas = document.createElement('canvas');
      canvas.width = cols * TILE.w;
      canvas.height = head + rows.length * (TILE.h + label + rowHead);
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
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const y0 = head + r * (TILE.h + label + rowHead);
        g.fillStyle = '#c8b68a';
        g.font = '16px "Songti SC", "SimSun", serif';
        g.fillText(row.title, 12, y0 + 18);
        for (let c = 0; c < row.tiles.length; c++) {
          const t = row.tiles[c];
          const img = await load(t.image);
          const sw = img.width * 0.62;
          const sh = sw * (TILE.h / TILE.w);
          g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, c * TILE.w, y0 + rowHead, TILE.w, TILE.h);
          g.strokeStyle = 'rgba(150,120,70,0.5)';
          g.strokeRect(c * TILE.w + 0.5, y0 + rowHead + 0.5, TILE.w - 1, TILE.h - 1);
          g.fillStyle = '#e2d2a8';
          g.font = '13px "Songti SC", "SimSun", serif';
          g.fillText(t.caption, c * TILE.w + 6, y0 + rowHead + TILE.h + 16);
        }
      }
      return canvas.toDataURL('image/png');
    },
    { title, rows, cols, TILE },
  );
}

/** 相位 → 说明：左脚在相位 0 落地，右脚晚半个周期；两脚都没着地 = 腾空 */
function caption(phase, duty) {
  const pct = Math.round(phase * 100);
  const l = phase < duty;
  const r = (phase + 0.5) % 1 < duty;
  const what = l ? '左脚着地' : r ? '右脚着地' : '腾空';
  return `${pct}%  ${what}`;
}

(async () => {
  const url = arg('url', 'http://localhost:4173');
  const out = arg('out', 'docs/screenshots');
  const prefix = arg('prefix', 'step15');
  const only = arg('only', '');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_PATH || undefined,
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const save = (name, dataUrl) => {
    const file = path.join(out, `${prefix}-${name}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('写出', file);
  };
  const views = [
    { azimuth: 90, dist: 5.6, height: 0.9 },
    { azimuth: 35, dist: 5.8, height: 0.95 },
  ];
  for (const hero of HEROES) {
    if (only && hero.name !== only) continue;
    const shots = await capture(page, url, hero, 6.4, views, PHASES);
    const rows = views.map((_, v) => ({
      title: v === 0 ? '侧面' : '斜前方',
      tiles: shots.map((s) => ({ image: s.images[v], caption: caption(s.phase, RUN_DUTY) })),
    }));
    save(`run-${hero.name}`, await compose(page, `跑步循环 6.4 米/秒：${hero.label}`, rows, PHASES));
  }
  if (!only || only === 'knight') {
    const rows = [];
    for (const [speed, duty, name] of [
      [3.2, WALK_DUTY, '走路 3.2 米/秒（步骤 14）'],
      [6.4, RUN_DUTY, '跑步 6.4 米/秒（步骤 15）'],
    ]) {
      const shots = await capture(page, url, HEROES[0], speed, [views[0]], PHASES);
      rows.push({ title: name, tiles: shots.map((s) => ({ image: s.images[0], caption: caption(s.phase, duty) })) });
    }
    save('run-vs-walk', await compose(page, '烬刃：走路与跑步（侧面，一个周期 = 左右各一步）', rows, PHASES));
  }
  if (errors.length > 0) console.log('页面错误：', errors);
  await browser.close();
})();

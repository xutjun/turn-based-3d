// 行走循环的关键帧联系表（步骤 14）：在模型预览页（?preview=1&walk=速度）里让 5 名人物沿圆圈行走，
// 逐帧推进，在一个步态周期里按相位均匀取 8 帧，分别从侧面和斜前方截图，拼成一张图：
//   docs/screenshots/<prefix>-walk-<人物>.png    每人一张：上排侧面、下排斜前方，标注相位与左右脚
//   docs/screenshots/<prefix>-walk-speeds.png     骑士在 1.2 / 2.2 / 3.2 米/秒下的侧面（步幅、步频随速度变化）
//
// 用法（先 npm run dev 或 npm run build && npx vite preview 把页面跑起来）：
//   NODE_PATH=<playwright-core 所在的 node_modules> BROWSER_PATH=<Chrome / Edge 路径> node scripts/walkSheets.cjs [--url http://localhost:5173] [--out docs/screenshots] [--prefix step14]
// playwright 不是本项目的依赖（与 scripts/contactSheets.cjs 相同）。

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
const PHASES = 8;
const TILE = { w: 220, h: 300 };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** 打开某个人物的行走演示，走到满速，然后在一个周期里按相位取 count 帧，每帧按 views 里的角度各截一张 */
async function capture(page, url, hero, speed, views, count) {
  await page.goto(`${url}/?preview=1&model=${hero.key}&walk=${speed}&spin=0`);
  await page.waitForFunction(() => window.__preview !== undefined);
  return page.evaluate(
    async ({ views, count, DT }) => {
      const p = window.__preview;
      p.manual(true);
      for (let i = 0; i < 150; i++) p.step(DT); // 2.5 秒：到满速、满权重
      const start = p.walk().phase;
      const base = Math.ceil(start);
      const shots = [];
      for (let k = 0; k < count; k++) {
        const want = base + k / count;
        let guard = 0;
        while (p.walk().phase < want && guard++ < 600) p.step(DT / 4);
        const phase = p.walk().phase - Math.floor(p.walk().phase);
        shots.push({ phase, images: views.map((v) => p.shot(v.azimuth, v.dist, v.height)) });
      }
      return shots;
    },
    { views, count, DT },
  );
}

/** 在页面里把截图拼成一张联系表，返回 PNG（data URL） */
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
      const load = (src) => new Promise((r) => {
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
          // 截图是整个画布：取中间一块（人物在画面中央）
          const sw = img.width * 0.62;
          const sh = sw * (TILE.h / TILE.w);
          g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, c * TILE.w, y0 + rowHead, TILE.w, TILE.h);
          g.strokeStyle = 'rgba(150,120,70,0.5)';
          g.strokeRect(c * TILE.w + 0.5, y0 + rowHead + 0.5, TILE.w - 1, TILE.h - 1);
          g.fillStyle = '#e2d2a8';
          g.font = '14px "Songti SC", "SimSun", serif';
          g.fillText(t.caption, c * TILE.w + 8, y0 + rowHead + TILE.h + 16);
        }
      }
      return canvas.toDataURL('image/png');
    },
    { title, rows, cols, TILE },
  );
}

/** 相位 → 说明：左脚在相位 0 落地，右脚晚半个周期 */
function caption(phase, duty) {
  const pct = Math.round(phase * 100);
  const left = phase < duty ? '左脚着地' : '左脚摆动';
  const right = (phase + 0.5) % 1 < duty ? '右脚着地' : '右脚摆动';
  return `${pct}%  ${left} · ${right}`;
}

(async () => {
  const url = arg('url', 'http://localhost:5173');
  const out = arg('out', 'docs/screenshots');
  const prefix = arg('prefix', 'step14');
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
    { azimuth: 90, dist: 5.2, height: 0.85 }, // 侧面（人物的左手侧）
    { azimuth: 35, dist: 5.4, height: 0.9 }, // 斜前方
  ];
  const DUTY_FAST = 0.5; // 满速（3.2 米/秒）时的支撑相比例，见 data/exploreConfig.ts
  for (const hero of HEROES) {
    const shots = await capture(page, url, hero, 3.2, views, PHASES);
    const rows = views.map((_, v) => ({
      title: v === 0 ? '侧面' : '斜前方',
      tiles: shots.map((s) => ({ image: s.images[v], caption: caption(s.phase, DUTY_FAST) })),
    }));
    save(`walk-${hero.name}`, await compose(page, `行走循环 3.2 米/秒：${hero.label}`, rows, PHASES));
  }
  // 骑士在三种速度下的侧面：速度越快步幅越大、步频越高（相位按走过的距离推进，所以每种速度都不滑步）
  const speedRows = [];
  for (const speed of [1.2, 2.2, 3.2]) {
    const shots = await capture(page, url, HEROES[0], speed, [views[0]], PHASES);
    speedRows.push({ title: `${speed} 米/秒`, tiles: shots.map((s) => ({ image: s.images[0], caption: `${Math.round(s.phase * 100)}%` })) });
  }
  save('walk-speeds', await compose(page, '烬刃：不同速度下的行走循环（侧面）', speedRows, PHASES));
  if (errors.length > 0) console.log('页面错误：', errors);
  await browser.close();
})();

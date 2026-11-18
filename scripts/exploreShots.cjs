// 探索模式的截图与路线图（步骤 15）：在游戏页面里用真实的鼠标点击让队长跑动，
//   docs/screenshots/<prefix>-explore-run.png     游戏视角下跑步的连续帧（点击标记、披风、腾空）
//   docs/screenshots/<prefix>-explore-hover.png   鼠标悬停 Boss 前后（轮廓高亮）
//   docs/screenshots/<prefix>-explore-routes.png  路线图：俯视的障碍物（实线 = 碰撞体，虚线 = 再加上单位半径）、
//                                                  每次点击的位置（×）、实际终点（○）和队长逐帧的轨迹
//   docs/screenshots/<prefix>-explore-scene.png   探索画面全景（只有队长和 Boss）
// 轨迹是在页面里每一帧读 __app.explore() 记下的真实位置，同时检查每一帧离障碍物表面的最小距离。
//
// 用法（先 npm run build && npx vite preview）：
//   NODE_PATH=<playwright-core 所在的 node_modules> BROWSER_PATH=<Chrome / Edge 路径> node scripts/exploreShots.cjs [--url http://localhost:4173] [--out docs/screenshots] [--prefix step15]

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
  const prefix = arg('prefix', 'step15');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_PATH || undefined,
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const save = (name, buf) => {
    const file = path.join(out, `${prefix}-${name}.png`);
    fs.writeFileSync(file, buf);
    console.log('写出', file);
  };
  const saveData = (name, dataUrl) => save(name, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const wait = (ms) => page.waitForTimeout(ms);

  await page.goto(`${url}/?res=1280x800&fps=0`);
  await page.waitForFunction(() => window.__app !== undefined);
  await page.evaluate(() => window.__app.start());
  await wait(800);
  save('explore-scene', await page.screenshot());

  // 每一帧记下队长的位置
  await page.evaluate(() => {
    const log = (window.__trace = []);
    const tick = () => {
      const s = window.__app.explore();
      const u = s.units[s.leader];
      log.push({ x: u.x, z: u.z, speed: u.speed, walk: u.walk });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  /** 点地面：点在画面里就用真实鼠标，否则走调试接口；返回实际终点 */
  const click = async (x, z) => {
    const c = await page.evaluate(([x, z]) => window.__app.groundClient(x, z), [x, z]);
    let how = 'api';
    if (c.x > 10 && c.x < W - 10 && c.y > 10 && c.y < H - 10) {
      await page.mouse.click(c.x, c.y);
      how = 'mouse';
    } else {
      await page.evaluate(([x, z]) => window.__app.exploreClick(x, z), [x, z]);
    }
    await wait(30);
    const s = await page.evaluate(() => window.__app.explore());
    return { x, z, how, goal: s.destination };
  };
  const untilStopped = async (ms = 9000) => {
    const t0 = Date.now();
    await wait(200);
    while (Date.now() - t0 < ms) {
      const s = await page.evaluate(() => window.__app.explore());
      if (!s.destination && s.units[s.leader].speed === 0 && s.units[s.leader].walk === 0) return;
      await wait(100);
    }
  };

  // 1) 跑步的连续帧（游戏视角）：从出生点横着往左跑（侧面看得到腿），途中每 70 毫秒截一张，裁出队长附近
  const frames = [];
  const first = await click(-2.0, 8.0);
  for (let i = 0; i < 10; i++) {
    await wait(70);
    const p = await page.evaluate(() => {
      const s = window.__app.explore();
      const u = s.units[s.leader];
      return { c: window.__app.groundClient(u.x, u.z), speed: u.speed };
    });
    const clip = { x: Math.round(p.c.x - 110), y: Math.round(p.c.y - 220), width: 220, height: 280 };
    if (clip.x < 0 || clip.y < 0 || clip.x + clip.width > W || clip.y + clip.height > H) continue;
    frames.push({ img: 'data:image/png;base64,' + (await page.screenshot({ clip })).toString('base64'), caption: `${p.speed.toFixed(1)} 米/秒` });
  }
  await untilStopped();
  const routes = [{ ...first }];

  // 2) 各种点击：点进火盆、绕过 Boss 到它背后、点骨堆、点石柱、点断柱、点场景外、快速连点
  const plan = [
    [12.4, 3.4], // 火盆（点在障碍里 → 最近的可达点）
    [-8.2, -8.6], // Boss 背后（绕过 Boss）
    [-9.6, 5.0], // 骨堆
    [-6.6, 6.4], // 火盆
    [-11.2, 2.6], // 断柱
    [-14.5, -8.5], // 石柱
    [-24, -20], // 场景外
    [3.6, -10.2], // 骨堆
    [15.0, -5.8], // 石柱
  ];
  for (const [x, z] of plan) {
    routes.push(await click(x, z));
    await untilStopped();
  }
  // 快速连点：0.15 秒内点三次，最后一次算数
  routes.push(await click(0, 10));
  await wait(150);
  routes.push(await click(6, 12));
  await wait(150);
  routes.push(await click(START_X(), 13));
  await untilStopped();

  // 3) 悬停 Boss：先跑到 Boss 附近（Boss 进入画面），再比较鼠标指着 / 不指着
  await click(1.5, 1.5);
  await untilStopped();
  const boss = await page.evaluate(() => {
    const s = window.__app.explore();
    const id = s.visible.find((v) => v !== s.leader);
    return { box: window.__app.unitClient(id), s };
  });
  await page.mouse.move(5, 5);
  await wait(400);
  const bossClip = { x: Math.round(boss.box.x - 150), y: Math.round(boss.box.y - 170), width: 300, height: 300 };
  const clamp = (c) => ({ ...c, x: Math.max(0, Math.min(W - c.width, c.x)), y: Math.max(0, Math.min(H - c.height, c.y)) });
  const before = (await page.screenshot({ clip: clamp(bossClip) })).toString('base64');
  await page.mouse.move(boss.box.x, boss.box.y);
  await wait(400);
  const hover = await page.evaluate(() => ({ s: window.__app.explore(), cursor: document.querySelector('.dk-ui')?.parentElement?.style.cursor ?? '' }));
  const after = (await page.screenshot({ clip: clamp(bossClip) })).toString('base64');
  await page.mouse.move(5, 5);

  // 拼图
  const trace = await page.evaluate(() => window.__trace);
  const world = await page.evaluate(() => window.__app.exploreWorld());
  const images = await page.evaluate(
    async ({ frames, before, after, routes, trace, world, hoverState }) => {
      const load = (src) =>
        new Promise((r) => {
          const img = new Image();
          img.onload = () => r(img);
          img.src = src;
        });
      const font = (px, bold) => `${bold ? 'bold ' : ''}${px}px "Songti SC", "SimSun", serif`;
      // --- 跑步连续帧 ---
      const tw = 220;
      const th = 280;
      const run = document.createElement('canvas');
      run.width = frames.length * tw;
      run.height = 46 + th + 24;
      let g = run.getContext('2d');
      g.fillStyle = '#121014';
      g.fillRect(0, 0, run.width, run.height);
      g.fillStyle = '#e2d2a8';
      g.font = font(20, true);
      g.fillText('游戏视角：点击后队长起跑（每 70 毫秒一帧，下方为实际速度）', 12, 30);
      for (let i = 0; i < frames.length; i++) {
        const img = await load(frames[i].img);
        g.drawImage(img, i * tw, 46);
        g.strokeStyle = 'rgba(150,120,70,0.5)';
        g.strokeRect(i * tw + 0.5, 46.5, tw - 1, th - 1);
        g.fillStyle = '#e2d2a8';
        g.font = font(14);
        g.fillText(frames[i].caption, i * tw + 8, 46 + th + 17);
      }
      const runUrl = run.toDataURL('image/png');
      // --- 悬停 ---
      const hv = document.createElement('canvas');
      hv.width = 600;
      hv.height = 46 + 300 + 24;
      g = hv.getContext('2d');
      g.fillStyle = '#121014';
      g.fillRect(0, 0, hv.width, hv.height);
      g.fillStyle = '#e2d2a8';
      g.font = font(20, true);
      g.fillText('鼠标悬停 Boss：轮边光换成暗金色（轮廓高亮）', 12, 30);
      g.drawImage(await load('data:image/png;base64,' + before), 0, 46);
      g.drawImage(await load('data:image/png;base64,' + after), 300, 46);
      g.font = font(14);
      g.fillText('鼠标不在 Boss 上', 8, 46 + 300 + 17);
      g.fillText(`鼠标指着 Boss（高亮 ${hoverState.bossHighlight.toFixed(2)}）`, 308, 46 + 300 + 17);
      const hoverUrl = hv.toDataURL('image/png');
      // --- 路线图（俯视，+x 向右、+z 向下，与游戏画面的方位一致） ---
      const S = 22; // 像素 / 米
      const b = world.bounds;
      const pad = 30;
      const mapW = (b.maxX - b.minX) * S + pad * 2;
      const mapH = (b.maxZ - b.minZ) * S + pad * 2 + 70;
      const map = document.createElement('canvas');
      map.width = mapW;
      map.height = mapH;
      g = map.getContext('2d');
      g.fillStyle = '#16131a';
      g.fillRect(0, 0, mapW, mapH);
      const X = (x) => pad + (x - b.minX) * S;
      const Z = (z) => 70 + pad + (z - b.minZ) * S;
      g.fillStyle = '#e2d2a8';
      g.font = font(20, true);
      g.fillText('路线图：点击处 ×、实际终点 ○、队长逐帧轨迹', 12, 30);
      g.font = font(14);
      g.fillText('实线圆 = 障碍物碰撞体；虚线 = 再加单位半径 0.4（队长中心进不去的范围）', 12, 54);
      g.strokeStyle = 'rgba(200,180,140,0.5)';
      g.strokeRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * S, (b.maxZ - b.minZ) * S);
      const colors = { pillar: '#8b8f99', drum: '#8b8f99', brazier: '#e0782c', banner: '#a04a4a', bonePile: '#cfc6a8', boss: '#b02a2a' };
      const shape = (o, extra, dash) => {
        g.setLineDash(dash ? [4, 4] : []);
        g.beginPath();
        if (o.kind === 'circle') g.arc(X(o.x), Z(o.z), (o.r + extra) * S, 0, Math.PI * 2);
        else {
          const ang = Math.atan2(o.bz - o.az, o.bx - o.ax);
          const r = (o.r + extra) * S;
          g.arc(X(o.bx), Z(o.bz), r, ang - Math.PI / 2, ang + Math.PI / 2);
          g.arc(X(o.ax), Z(o.az), r, ang + Math.PI / 2, ang + (3 * Math.PI) / 2);
          g.closePath();
        }
        g.stroke();
      };
      for (const o of world.obstacles) {
        g.strokeStyle = colors[o.tag] || '#888';
        g.lineWidth = 2;
        g.fillStyle = 'rgba(255,255,255,0.06)';
        shape(o, 0, false);
        g.lineWidth = 1;
        shape(o, world.unitRadius, true);
      }
      g.setLineDash([]);
      // 轨迹：按速度着色（慢 = 暗、快 = 亮）
      let minGap = Infinity;
      const gapOf = (x, z) => {
        let best = Infinity;
        for (const o of world.obstacles) {
          let cx = o.x;
          let cz = o.z;
          if (o.kind === 'capsule') {
            const dx = o.bx - o.ax;
            const dz = o.bz - o.az;
            const t = Math.max(0, Math.min(1, ((x - o.ax) * dx + (z - o.az) * dz) / (dx * dx + dz * dz)));
            cx = o.ax + dx * t;
            cz = o.az + dz * t;
          }
          best = Math.min(best, Math.hypot(x - cx, z - cz) - o.r - world.unitRadius);
        }
        return best;
      };
      g.lineWidth = 2;
      for (let i = 1; i < trace.length; i++) {
        const a = trace[i - 1];
        const c = trace[i];
        if (Math.hypot(c.x - a.x, c.z - a.z) > 1.5) continue; // 回到起点之类的瞬移不画
        minGap = Math.min(minGap, gapOf(c.x, c.z));
        const k = Math.min(1, c.speed / 6.4);
        g.strokeStyle = `rgba(${Math.round(120 + 135 * k)}, ${Math.round(170 + 60 * k)}, ${Math.round(255 - 80 * k)}, 0.9)`;
        g.beginPath();
        g.moveTo(X(a.x), Z(a.z));
        g.lineTo(X(c.x), Z(c.z));
        g.stroke();
      }
      routes.forEach((r, i) => {
        g.strokeStyle = '#ffd36a';
        g.lineWidth = 2;
        const cx = X(Math.max(b.minX - 1, Math.min(b.maxX + 1, r.x)));
        const cz = Z(Math.max(b.minZ - 1, Math.min(b.maxZ + 1, r.z)));
        g.beginPath();
        g.moveTo(cx - 6, cz - 6);
        g.lineTo(cx + 6, cz + 6);
        g.moveTo(cx + 6, cz - 6);
        g.lineTo(cx - 6, cz + 6);
        g.stroke();
        g.fillStyle = '#ffd36a';
        g.font = font(13);
        g.fillText(String(i + 1), cx + 7, cz - 7);
        if (r.goal) {
          g.strokeStyle = '#7dffb0';
          g.beginPath();
          g.arc(X(r.goal.x), Z(r.goal.z), 5, 0, Math.PI * 2);
          g.stroke();
        }
      });
      g.fillStyle = '#e2d2a8';
      g.font = font(14);
      g.fillText(`轨迹 ${trace.length} 帧，离障碍物表面的最小距离（扣除单位半径）：${minGap.toFixed(3)} 米（≥ 0 = 没有穿模）`, 12, mapH - 10);
      return { runUrl, hoverUrl, mapUrl: map.toDataURL('image/png'), minGap };
    },
    { frames, before, after, routes, trace, world, hoverState: hover.s },
  );
  saveData('explore-run', images.runUrl);
  saveData('explore-hover', images.hoverUrl);
  saveData('explore-routes', images.mapUrl);
  console.log('最小间隙（米）：', images.minGap.toFixed(4), '帧数：', trace.length);
  console.log('点击：', routes.map((r, i) => `${i + 1}:${r.how}(${r.x},${r.z})→${r.goal ? `${r.goal.x.toFixed(2)},${r.goal.z.toFixed(2)}` : '无'}`).join(' '));
  console.log('悬停：bossHover=', hover.s.bossHover, 'highlight=', hover.s.bossHighlight.toFixed(2), 'cursor=', hover.cursor);
  const perf = await page.evaluate(() => (window.__perf ? window.__perf() : null));
  if (perf) console.log('绘制调用：', JSON.stringify(perf));
  if (errors.length > 0) console.log('页面错误：', errors);
  await browser.close();
})();

function START_X() {
  return 8.5;
}

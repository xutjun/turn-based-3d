// 关键帧联系表：把技能演示页（?demo=skills）里的每种进攻逐帧推进，在各个阶段取 8~12 帧，
// 拼成一张按时间排列、标出“预备 / 发力 / 命中 / 收招”的大图，输出到 docs/screenshots/step11-sheet-<名字>.png。
//
// 用法（先 npm run dev 或 npm run preview 把页面跑起来）：
//   NODE_PATH=<playwright 所在的 node_modules> node scripts/contactSheets.cjs [--url http://localhost:5173] [--only blade,wolf] [--out docs/screenshots]
// playwright 不是本项目的依赖：用 npx playwright 装过一次后，把 NODE_PATH 指到它所在的 node_modules 即可。
//
// 做法：页面进入“手动逐帧”模式（window.__skillDemo.manual），第一遍只推进动画不画，记录出手者每一帧所处的阶段；
// 按下面每张表的 picks 选出要截的帧；第二遍重放，到这些帧时以出手者为中心放大截图。演出是确定性的，两遍完全一致。

const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const DT = 1 / 60;
const LABELS = {
  idle: '站姿',
  brace: '蓄势',
  approach: '冲刺',
  anticipation: '预备',
  strike: '发力',
  hold: '命中',
  follow: '余势',
  recover: '收招',
  return: '回位',
};

/**
 * 每张联系表：demo = 演示 id，actor = 出手者，zoom = 放大倍数，
 * picks = [阶段, 第几次出现（负数从后往前数）, 在这一段里的位置 0~1, 可选的说明]。
 */
const SHEETS = [
  {
    name: 'blade', title: '刀普攻：斜劈 + 收刀（烬刃）', demo: 'basic_blade', actor: 'A1', zoom: 4.2,
    picks: [['idle', 0, 0.5], ['approach', 0, 0.45], ['approach', 0, 0.97, '刹车'], ['anticipation', 0, 1], ['strike', 0, 0.55], ['hold', 0, 0.2], ['follow', 0, 0.6], ['recover', 0, 0.45, '收刀'], ['return', 0, 0.5], ['idle', -1, 0.6]],
  },
  {
    name: 'sword', title: '剑普攻：横斩（缚魂）', demo: 'basic_sword', actor: 'A3', zoom: 4.2,
    picks: [['idle', 0, 0.5], ['approach', 0, 0.45], ['anticipation', 0, 0.5], ['anticipation', 0, 1], ['strike', 0, 0.55], ['hold', 0, 0.2], ['follow', 0, 0.6], ['recover', 0, 0.4], ['return', 0, 0.5], ['idle', -1, 0.6]],
  },
  {
    name: 'spear', title: '枪普攻：蓄力突刺 + 回撤（守誓）', demo: 'basic_spear', actor: 'A4', zoom: 4.2,
    picks: [['idle', 0, 0.5], ['approach', 0, 0.45], ['anticipation', 0, 0.55], ['anticipation', 0, 1, '蓄满'], ['strike', 0, 0.6], ['hold', 0, 0.2], ['follow', 0, 0.3], ['follow', 0, 1, '回撤'], ['return', 0, 0.5], ['idle', -1, 0.6]],
  },
  {
    name: 'combo', title: '连斩 ×3：斜劈 → 反手横斩 → 跃起重劈（烬刃）', demo: 'combo', actor: 'A1', zoom: 4.2,
    picks: [['approach', 0, 0.5], ['anticipation', 0, 1, '第 1 击'], ['hold', 0, 0.2, '第 1 击'], ['anticipation', 1, 1, '第 2 击'], ['strike', 1, 0.6, '第 2 击'], ['hold', 1, 0.2, '第 2 击'], ['anticipation', 2, 0.3, '第 3 击·沉身'], ['anticipation', 2, 1, '第 3 击·跃起'], ['hold', 2, 0.2, '第 3 击'], ['follow', 2, 0.8], ['recover', 0, 0.5], ['return', 0, 0.5]],
  },
  {
    name: 'whirlwind', title: '旋风斩 ×7：弧线跃进 + 旋身横扫，最后一击旋转砸地（烬刃）', demo: 'whirlwind', actor: 'A1', zoom: 3.2,
    picks: [['approach', 0, 0.5], ['anticipation', 0, 1, '第 1 击'], ['hold', 0, 0.2, '第 1 击'], ['approach', 1, 0.35, '蹬地跃起'], ['approach', 1, 0.7, '空中旋身'], ['hold', 1, 0.2, '第 2 击'], ['approach', 4, 0.6, '空中旋身'], ['anticipation', -1, 1, '最后一击·蓄势'], ['strike', -1, 0.45, '最后一击·旋转'], ['strike', -1, 0.9, '最后一击·劈下'], ['hold', -1, 0.5, '冲击波'], ['recover', 0, 0.5], ['return', 0, 0.5]],
  },
  {
    name: 'arrow-rain', title: '箭雨：站姿调整 → 举弓拉满、后仰 → 射出、弓身回弹（夜隼）', demo: 'arrow_rain', actor: 'A0', zoom: 4.6,
    picks: [['idle', 0, 0.5], ['anticipation', 0, 0.2, '站姿调整'], ['anticipation', 0, 0.55, '举弓'], ['anticipation', 0, 1, '蓄满后仰'], ['strike', 0, 0.9, '松弦'], ['hold', 0, 0.5], ['follow', 0, 0.3, '弓身回弹'], ['follow', 0, 1], ['recover', 0, 0.5], ['idle', -1, 0.5]],
  },
  {
    name: 'bow', title: '弓箭普攻：拉弓 → 松弦 → 后坐（夜隼）', demo: 'basic_bow', actor: 'A0', zoom: 4.6,
    picks: [['idle', 0, 0.5], ['anticipation', 0, 0.25, '站姿调整'], ['anticipation', 0, 1, '拉满'], ['strike', 0, 0.9], ['hold', 0, 0.5], ['follow', 0, 0.35, '后坐'], ['follow', 0, 1], ['recover', 0, 0.5], ['idle', -1, 0.5]],
  },
  {
    name: 'wolf', title: '影狼：下伏蓄力 → 扑跃 → 撕咬甩头 → 连击爪击 → 跳回', demo: 'double_strike', actor: 'A5', zoom: 5,
    picks: [['brace', 0, 1, '下伏'], ['approach', 0, 0.2, '蹬地'], ['approach', 0, 0.6, '腾空'], ['anticipation', 0, 1, '张嘴'], ['hold', 0, 0.2, '咬住'], ['follow', 0, 0.3, '甩头'], ['follow', 0, 0.65, '甩头'], ['anticipation', 1, 1, '连击·举爪'], ['hold', 1, 0.2, '连击·爪击'], ['recover', 0, 0.5], ['return', 0, 0.5, '跳回'], ['idle', -1, 0.6]],
  },
  {
    name: 'golem', title: '魔偶：举臂蓄力 → 踏步靠近 → 砸拳（冲击波）→ 缓慢退回', demo: 'golem_basic', actor: 'A9', zoom: 4.6,
    picks: [['idle', 0, 0.5], ['brace', 0, 1, '举臂'], ['approach', 0, 0.3, '踏步'], ['approach', 0, 0.7, '踏步'], ['anticipation', 0, 1, '后仰蓄满'], ['strike', 0, 0.6], ['hold', 0, 0.5, '冲击波'], ['follow', 0, 0.7], ['recover', 0, 0.5], ['return', 0, 0.5], ['idle', -1, 0.6]],
  },
  {
    name: 'dragon', title: '骨龙施法：后仰、双翼张开、张口蓄火 → 探头喷吐', demo: 'triple_spell', actor: 'A7', zoom: 5,
    picks: [['idle', 0, 0.5], ['anticipation', 0, 0.3, '后仰'], ['anticipation', 0, 0.7, '张翼'], ['anticipation', 0, 1, '张口蓄火'], ['strike', 0, 0.7], ['hold', 0, 0.5, '喷吐'], ['follow', 0, 0.5], ['recover', 0, 0.5], ['idle', -1, 0.5]],
  },
  {
    name: 'ghost', title: '幽灵施法：上浮、双臂展开、魂火汇聚 → 双手前推', demo: 'ghost_spell', actor: 'A8', zoom: 5,
    picks: [['idle', 0, 0.5], ['anticipation', 0, 0.3, '上浮'], ['anticipation', 0, 0.7, '展臂'], ['anticipation', 0, 1, '魂火汇聚'], ['strike', 0, 0.7], ['hold', 0, 0.5, '前推'], ['follow', 0, 0.5], ['recover', 0, 0.5], ['idle', -1, 0.5]],
  },
  {
    name: 'cast', title: '群体法术：举杖高举、后仰蓄力 → 杖向下一顿（雷咒）', demo: 'group_spell', actor: 'A2', zoom: 4.6,
    picks: [['idle', 0, 0.5], ['anticipation', 0, 0.25], ['anticipation', 0, 0.6, '举杖'], ['anticipation', 0, 1, '蓄满后仰'], ['strike', 0, 0.7], ['hold', 0, 0.5], ['follow', 0, 0.5], ['recover', 0, 0.5], ['idle', -1, 0.5]],
  },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** 把每帧的阶段记录压成一段一段：[{ phase, start, end }] */
function segmentsOf(timeline) {
  const segs = [];
  timeline.forEach((p, i) => {
    const last = segs[segs.length - 1];
    if (last && last.phase === p.phase) last.end = i;
    else segs.push({ phase: p.phase, move: p.move, start: i, end: i });
  });
  return segs;
}

/** 在页面里启动一个演示并逐帧推进；frames 为要截图的帧号（空 = 只记录阶段） */
async function run(page, sheet, frames) {
  return page.evaluate(
    async ({ sheet, frames, DT }) => {
      const demo = window.__skillDemo;
      demo.manual(true);
      let done = false;
      void demo.play(sheet.demo).then(() => (done = true));
      const tick = () => new Promise((r) => setTimeout(r, 0));
      const timeline = [];
      const shots = {};
      // 演示开始前有几帧复位和铺垫：等出手者离开站姿之前也算在时间线里
      for (let i = 0; i < 4000 && !done; i++) {
        demo.step(DT, false);
        await tick();
        const p = demo.phase(sheet.actor);
        timeline.push({ phase: demo.playing ? p.phase : 'idle', move: p.move });
        if (frames.includes(i)) shots[i] = demo.shot(sheet.actor, sheet.zoom, sheet.offsetX ?? 0, sheet.offsetY ?? 0);
      }
      demo.manual(false);
      return { timeline, shots };
    },
    { sheet, frames, DT },
  );
}

async function main() {
  const url = arg('url', 'http://localhost:5173');
  const outDir = arg('out', path.join(__dirname, '..', 'docs', 'screenshots'));
  const only = arg('only', '');
  const quality = arg('quality', '');
  const sheets = SHEETS.filter((s) => !only || only.split(',').includes(s.name));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('页面报错：', e.message));
  await page.goto(`${url}/?demo=skills&fps=0${quality ? `&quality=${quality}` : ''}`);
  await page.waitForFunction(() => window.__skillDemo !== undefined);
  await page.waitForTimeout(1500);

  const composer = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const sheet of sheets) {
    // 第一遍：记录阶段
    const { timeline } = await run(page, sheet, []);
    const segs = segmentsOf(timeline);
    const picked = [];
    for (const [phase, nth, pos, note] of sheet.picks) {
      const list = segs.filter((s) => s.phase === phase);
      const seg = list[nth < 0 ? list.length + nth : nth];
      if (!seg) {
        console.warn(`  ${sheet.name}：没有找到 ${phase}#${nth}`);
        continue;
      }
      const frame = Math.round(seg.start + (seg.end - seg.start) * pos);
      picked.push({ frame, phase, note, move: seg.move });
    }
    // 第二遍：重放并截图
    const { shots } = await run(page, sheet, picked.map((p) => p.frame));
    const cells = picked
      .filter((p) => shots[p.frame])
      .map(
        (p) => `<figure><img src="${shots[p.frame]}"><figcaption><b class="${p.phase}">${LABELS[p.phase]}</b>${p.note ? ` · ${p.note}` : ''}<i>${(p.frame * DT).toFixed(2)}s</i></figcaption></figure>`,
      )
      .join('');
    if (process.argv.includes('--frames')) {
      // 调姿态用：把每一帧单独存成大图
      picked.forEach((p, i) => {
        const data = shots[p.frame];
        if (data) fs.writeFileSync(path.join(outDir, `frame-${sheet.name}-${String(i).padStart(2, '0')}-${p.phase}.png`), Buffer.from(data.split(',')[1], 'base64'));
      });
    }
    const cols = picked.length > 10 ? Math.ceil(picked.length / 2) : Math.min(5, picked.length);
    const html = `<html><body style="margin:0;background:#0d0c0f;font-family:'Noto Serif CJK SC','Noto Sans CJK SC',serif;color:#d8c690">
      <style>
        h1{font-size:20px;margin:0;padding:12px 16px 4px;letter-spacing:1px}
        p{margin:0;padding:0 16px 10px;font-size:13px;color:#9a8f72}
        .grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:6px;padding:0 10px 10px}
        figure{margin:0;background:#17151a;border:1px solid #3a3020}
        img{display:block;width:100%}
        figcaption{padding:5px 8px;font-size:14px;display:flex;gap:6px;align-items:baseline}
        figcaption i{margin-left:auto;font-style:normal;font-size:12px;color:#8a8068}
        b{padding:0 6px;border-radius:2px;color:#111}
        .idle,.return,.approach,.brace{background:#8a8f9a}.anticipation{background:#e0b84a}.strike{background:#ff7a3a}.hold{background:#ff4a4a}.follow{background:#c98aff}.recover{background:#6ac8a0}
      </style>
      <h1>${sheet.title}</h1>
      <p>演示 ${sheet.demo} · 出手者 ${sheet.actor} · 时间为 1 倍速下从演示开始算起的秒数 · 色块：灰 = 移动 / 站姿，黄 = 预备（蓄力），橙 = 发力，红 = 命中（顿住），紫 = 余势，绿 = 收招</p>
      <div class="grid">${cells}</div></body></html>`;
    await composer.setViewportSize({ width: cols * 330 + 20, height: 400 });
    await composer.setContent(html);
    await composer.waitForFunction(() => [...document.images].every((img) => img.complete));
    const file = path.join(outDir, `step11-sheet-${sheet.name}.png`);
    fs.mkdirSync(outDir, { recursive: true });
    await composer.screenshot({ path: file, fullPage: true });
    const phases = segs.map((s) => `${s.phase}(${((s.end - s.start + 1) * DT).toFixed(2)})`).join(' → ');
    console.log(`${sheet.name}: ${picked.length} 帧 → ${file}\n  ${phases}`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

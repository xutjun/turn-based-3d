// 暗黑风格界面主题：石质面板、金属包边、衬线字体，全部用 CSS 渐变和阴影画出来，
// 不使用任何外部图片和字体文件。所有面板共用这一份样式，保证风格统一。

const STYLE_ID = 'dk-theme-style';

/** 系统衬线字体栈（DESIGN §1.1）；没有安装 Cinzel 时自动落到后面的系统字体 */
export const SERIF_FONT = '"Cinzel","Times New Roman","Songti SC","SimSun","Noto Serif CJK SC",serif';

const CSS = `
.dk-ui { position:absolute; inset:0; pointer-events:none; overflow:hidden; user-select:none; z-index:8;
  font-family:${SERIF_FONT}; color:#d8c690; font-size:14px; line-height:1.35; }

/* ---------- 石质面板 + 金属包边 ---------- */
.dk-panel { position:absolute; box-sizing:border-box; pointer-events:auto; padding:10px 12px;
  background:
    radial-gradient(ellipse at 18% 0%, rgba(255,240,200,.07), transparent 55%),
    repeating-linear-gradient(118deg, rgba(255,255,255,.022) 0 2px, transparent 2px 9px),
    repeating-linear-gradient(28deg, rgba(0,0,0,.16) 0 3px, transparent 3px 13px),
    linear-gradient(#262320, #131110);
  border:1px solid #0a0908;
  box-shadow:0 0 0 1px #7a6338, 0 0 0 3px #1a1714, 0 0 0 4px #43361f,
    inset 0 0 22px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,235,180,.08), 0 8px 22px rgba(0,0,0,.75); }
/* 四角铆钉 */
.dk-panel::before { content:""; position:absolute; inset:3px; pointer-events:none;
  background:
    radial-gradient(circle at 4px 4px, #c9a85a 0 1.6px, #3a2f1b 2.2px, transparent 3px),
    radial-gradient(circle at calc(100% - 4px) 4px, #c9a85a 0 1.6px, #3a2f1b 2.2px, transparent 3px),
    radial-gradient(circle at 4px calc(100% - 4px), #c9a85a 0 1.6px, #3a2f1b 2.2px, transparent 3px),
    radial-gradient(circle at calc(100% - 4px) calc(100% - 4px), #c9a85a 0 1.6px, #3a2f1b 2.2px, transparent 3px); }
.dk-title { margin:0 0 8px; padding-bottom:6px; font-size:15px; letter-spacing:3px; text-align:center; color:#e8d49a;
  text-shadow:0 1px 2px #000; border-bottom:1px solid transparent;
  border-image:linear-gradient(90deg, transparent, #7a6338 20%, #c9a85a 50%, #7a6338 80%, transparent) 1; }

/* ---------- 金属按钮 ---------- */
.dk-btn { position:relative; box-sizing:border-box; padding:6px 12px; font:inherit; font-size:15px; letter-spacing:2px;
  color:#e2cf98; cursor:pointer; text-shadow:0 1px 1px #000;
  background:linear-gradient(#4a4238, #2a2520 48%, #1c1916 52%, #26221d);
  border:1px solid #0b0a09; border-radius:1px;
  box-shadow:0 0 0 1px #6b5731, inset 0 1px 0 rgba(255,235,180,.18), inset 0 -1px 0 rgba(0,0,0,.6); }
.dk-btn:hover { color:#fff1c4; background:linear-gradient(#5d5140, #352d24 48%, #231e19 52%, #2f2921);
  box-shadow:0 0 0 1px #c9a85a, 0 0 10px rgba(201,168,90,.35), inset 0 1px 0 rgba(255,235,180,.25); }
.dk-btn:active { transform:translateY(1px); background:linear-gradient(#1c1916, #2a2520); }
.dk-btn.is-on { color:#1a1408; text-shadow:none; background:linear-gradient(#e2c170, #b08a3c);
  box-shadow:0 0 0 1px #f2d98a, 0 0 10px rgba(242,200,90,.45); }
.dk-btn.is-disabled { color:#6d675c; cursor:not-allowed; filter:grayscale(.8);
  background:linear-gradient(#2c2925, #1b1917); box-shadow:0 0 0 1px #3a3530; }
.dk-btn.is-disabled:hover { color:#857d6e; box-shadow:0 0 0 1px #5a3a30; }
.dk-btn.is-danger { color:#f0b9a8; box-shadow:0 0 0 1px #7a3324, inset 0 1px 0 rgba(255,200,180,.15); }
.dk-key { margin-left:6px; font-size:11px; letter-spacing:0; color:#8f8468; }
.dk-btn.is-on .dk-key { color:#5a4418; }

/* ---------- 指令面板 ---------- */
.dk-command { left:14px; bottom:14px; width:318px; }
.dk-command.is-hidden { display:none; }
.dk-unit { display:flex; align-items:baseline; gap:8px; margin-bottom:6px; }
.dk-unit-name { font-size:19px; letter-spacing:2px; color:#ffe08a; text-shadow:0 0 8px rgba(201,150,44,.7),0 1px 2px #000; }
.dk-unit-class { font-size:12px; color:#a99a72; }
.dk-unit-step { margin-left:auto; font-size:12px; color:#8f8468; }
.dk-gauge { position:relative; height:13px; margin-top:4px; background:#0b0a0a; border:1px solid #4a3d24; }
.dk-gauge > i { position:absolute; left:0; top:0; bottom:0; }
.dk-gauge.hp > i { background:linear-gradient(#c8342a,#7a1410); }
.dk-gauge.mp > i { background:linear-gradient(#3f7fe0,#1c3f96); }
.dk-gauge > span { position:absolute; inset:0; font-size:11px; line-height:13px; text-align:center; color:#f4ead0;
  text-shadow:0 0 2px #000,0 1px 1px #000; }
.dk-sealed { margin-top:5px; font-size:12px; color:#d9a6ff; text-shadow:0 0 4px #7a2cff; }
.dk-passive { margin-top:5px; font-size:12px; line-height:1.45; color:#e0a060; }
.dk-actions { display:flex; gap:6px; margin-top:10px; }
.dk-actions .dk-btn { flex:1; padding:8px 0; }
.dk-sub { display:flex; gap:6px; margin-top:8px; align-items:center; }
.dk-sub .dk-btn { font-size:13px; padding:4px 10px; }
.dk-hint { flex:1; font-size:12px; color:#9c8f6c; }
.dk-skills { margin-top:8px; max-height:210px; overflow-y:auto; display:flex; flex-direction:column; gap:5px; }
.dk-skill { display:block; width:100%; text-align:left; letter-spacing:0; padding:6px 9px; }
.dk-skill-head { display:flex; align-items:baseline; gap:8px; }
.dk-skill-name { font-size:15px; letter-spacing:2px; }
.dk-skill-cost { margin-left:auto; font-size:12px; color:#7fb0f0; white-space:nowrap; }
.dk-skill-tag { font-size:11px; color:#e0705a; white-space:nowrap; }
.dk-skill-desc { margin-top:2px; font-size:12px; line-height:1.3; color:#a99a72; white-space:normal; }
.dk-skill.is-disabled .dk-skill-cost, .dk-skill.is-disabled .dk-skill-desc { color:#6d675c; }
.dk-empty { padding:10px 0; text-align:center; font-size:13px; color:#8f8468; }
.dk-target { margin-top:8px; padding:7px 9px; background:rgba(0,0,0,.35); border:1px solid #4a3d24; }
.dk-target-skill { font-size:15px; letter-spacing:2px; color:#ffe08a; }
.dk-target-desc { margin-top:2px; font-size:12px; color:#a99a72; }
.dk-target-preview { margin-top:5px; font-size:13px; color:#f1c7b8; min-height:36px; }
.dk-target-preview.friendly { color:#b9f59a; }
.dk-target-preview b { color:#fff1c4; }
.dk-status { left:14px; bottom:14px; padding:7px 16px; font-size:14px; letter-spacing:3px; color:#b8a878; }
.dk-shake { animation:dk-shake .28s linear; }
@keyframes dk-shake { 20% { transform:translateX(-5px); } 40% { transform:translateX(5px); }
  60% { transform:translateX(-3px); } 80% { transform:translateX(3px); } }

/* ---------- 非法操作提示 ---------- */
.dk-toast { position:absolute; left:14px; bottom:0; max-width:420px; box-sizing:border-box; padding:7px 14px;
  font-size:14px; color:#ffd9cc; text-shadow:0 1px 2px #000; pointer-events:none; opacity:0;
  background:linear-gradient(#3a1612, #1e0c0a); border:1px solid #0a0908;
  box-shadow:0 0 0 1px #a8402c, 0 0 14px rgba(200,50,30,.45), 0 4px 12px rgba(0,0,0,.7); }
.dk-toast.info { color:#e8d9a8; background:linear-gradient(#2c2820, #171411);
  box-shadow:0 0 0 1px #7a6338, 0 4px 12px rgba(0,0,0,.7); }
.dk-toast { transition:opacity .45s ease-out; }
/* 出现时不做过渡，保证帧率很低时提示也能立刻看到；消失时淡出 */
.dk-toast.show { opacity:1; transition:none; }

/* ---------- 设置条（宝宝自动 / 手动） ---------- */
.dk-settings { right:12px; top:80px; padding:6px 9px; display:flex; align-items:center; gap:6px; font-size:13px; }
.dk-settings .dk-btn { font-size:13px; padding:3px 9px; letter-spacing:1px; }
.dk-settings-note { position:absolute; right:0; top:100%; margin-top:6px; font-size:11px; color:#9c8f6c; white-space:nowrap;
  text-shadow:0 1px 2px #000; }

/* ---------- 战斗日志 ---------- */
.dk-log { right:12px; top:128px; width:252px; padding:8px 4px 8px 10px; }
.dk-log .dk-title { margin-bottom:5px; padding-bottom:4px; font-size:13px; cursor:pointer; }
.dk-log-body { height:150px; overflow-y:auto; padding-right:6px; font-size:12px; line-height:1.45; user-select:text; }
.dk-log.is-collapsed .dk-log-body { display:none; }
.dk-log.is-collapsed .dk-title { margin-bottom:0; padding-bottom:0; border-bottom:none; }
.dk-log-line { color:#c9bb94; }
.dk-log-line.detail { padding-left:14px; }
.dk-log-line.turn { margin:5px 0 2px; text-align:center; letter-spacing:3px; color:#e8d49a;
  border-bottom:1px solid rgba(122,99,56,.6); }
.dk-log-line.action { color:#e6dcc0; }
.dk-log-line.damage { color:#d9a08c; }
.dk-log-line.crit { color:#ffb02e; }
.dk-log-line.miss { color:#8f96a0; }
.dk-log-line.heal { color:#8fe26a; }
.dk-log-line.status { color:#c98cff; }
.dk-log-line.death { color:#e0503c; }
.dk-log-line.revive { color:#ffe08a; }
.dk-log-line.info { color:#9cb4cc; }
.dk-log-line.end { margin-top:5px; text-align:center; letter-spacing:2px; color:#ffe08a; }
.dk-skills::-webkit-scrollbar, .dk-log-body::-webkit-scrollbar, .dk-result-table::-webkit-scrollbar { width:7px; }
.dk-skills::-webkit-scrollbar-thumb, .dk-log-body::-webkit-scrollbar-thumb, .dk-result-table::-webkit-scrollbar-thumb {
  background:#5a4a2a; border:1px solid #1a1714; }
.dk-skills::-webkit-scrollbar-track, .dk-log-body::-webkit-scrollbar-track, .dk-result-table::-webkit-scrollbar-track {
  background:#0e0d0c; }

/* ---------- 结算界面 ---------- */
.dk-result-veil { position:absolute; inset:0; pointer-events:auto; display:flex; align-items:center; justify-content:center;
  background:radial-gradient(ellipse at center, rgba(0,0,0,.45), rgba(0,0,0,.82)); z-index:4;
  animation:dk-fade .5s ease-out; }
@keyframes dk-fade { from { opacity:0; } to { opacity:1; } }
.dk-result { position:relative; width:min(620px, calc(100% - 32px)); max-height:calc(100% - 32px); padding:18px 22px 16px;
  display:flex; flex-direction:column; }
.dk-result-head { font-size:40px; letter-spacing:14px; text-indent:14px; text-align:center; }
.dk-result.win .dk-result-head { color:#ffe08a; text-shadow:0 0 18px rgba(242,200,90,.6),0 2px 4px #000; }
.dk-result.lose .dk-result-head { color:#c8483a; text-shadow:0 0 18px rgba(160,30,20,.7),0 2px 4px #000; }
.dk-result-sub { margin:2px 0 10px; text-align:center; font-size:13px; letter-spacing:2px; color:#a99a72; }
.dk-result-facts { display:flex; gap:8px; margin-bottom:10px; }
.dk-fact { flex:1; padding:6px 4px; text-align:center; background:rgba(0,0,0,.35); border:1px solid #4a3d24; }
.dk-fact b { display:block; font-size:20px; font-weight:normal; color:#fff1c4; }
.dk-fact span { font-size:11px; letter-spacing:1px; color:#9c8f6c; }
.dk-result-table { overflow-y:auto; min-height:0; }
.dk-result table { width:100%; border-collapse:collapse; font-size:13px; }
.dk-result th { padding:3px 6px; font-weight:normal; font-size:12px; letter-spacing:1px; color:#9c8f6c; text-align:right;
  border-bottom:1px solid #5a4a2a; }
.dk-result td { padding:3px 6px; text-align:right; color:#d8c690; border-bottom:1px solid rgba(74,61,36,.45);
  font-variant-numeric:tabular-nums; }
.dk-result th:first-child, .dk-result td:first-child { text-align:left; }
.dk-result tr.is-dead td { color:#7d766a; }
.dk-result tr.is-mvp td:first-child { color:#ffe08a; }
.dk-result-actions { margin-top:14px; text-align:center; }
.dk-result-actions .dk-btn { padding:9px 34px; font-size:18px; letter-spacing:6px; text-indent:6px; }
`;

/** 把主题样式注入页面（重复调用只注入一次） */
export function injectTheme(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** 创建元素的小工具 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

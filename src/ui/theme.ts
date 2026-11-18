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
.dk-settings { right:12px; top:56px; padding:6px 9px; display:flex; align-items:center; gap:6px; font-size:13px; }
.dk-settings .dk-btn { font-size:13px; padding:3px 9px; letter-spacing:1px; }
.dk-settings-note { position:absolute; right:0; top:100%; margin-top:6px; font-size:11px; color:#9c8f6c; white-space:nowrap;
  text-shadow:0 1px 2px #000; }

/* ---------- 战斗日志 ---------- */
.dk-log { right:12px; top:104px; width:252px; padding:8px 4px 8px 10px; }
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

/* ---------- 步骤 12：菜单层（设置按钮、设置面板、确认框、标题界面） ---------- */
.dk-menu-layer { position:absolute; inset:0; pointer-events:none; overflow:hidden; user-select:none; z-index:20;
  font-family:${SERIF_FONT}; color:#d8c690; font-size:14px; line-height:1.35; }
.dk-gear { position:absolute; right:12px; top:8px; width:38px; height:38px; padding:0; pointer-events:auto;
  display:flex; align-items:center; justify-content:center; letter-spacing:0; }
.dk-gear svg { width:24px; height:24px; display:block; transition:transform .35s ease-out; }
.dk-gear:hover svg { transform:rotate(60deg); }
.dk-gear.is-hidden { display:none; }
.dk-menu-veil { position:absolute; inset:0; pointer-events:auto; display:flex; align-items:center; justify-content:center;
  background:radial-gradient(ellipse at center, rgba(0,0,0,.5), rgba(0,0,0,.85)); animation:dk-fade .18s ease-out; }
.dk-menu { position:relative; width:480px; padding:16px 24px 18px; }
.dk-menu .dk-title { font-size:20px; letter-spacing:8px; text-indent:8px; margin-bottom:12px; }
.dk-menu-paused { margin:-6px 0 10px; text-align:center; font-size:12px; letter-spacing:3px; color:#9c8f6c; }
.dk-row { display:flex; align-items:center; gap:12px; min-height:34px; margin:4px 0; }
.dk-row-label { width:84px; flex:none; font-size:15px; letter-spacing:2px; color:#e2cf98; }
.dk-row-body { flex:1; display:flex; align-items:center; gap:8px; }
.dk-row-body .dk-btn { font-size:14px; padding:4px 16px; }
.dk-row-value { width:42px; text-align:right; font-size:13px; color:#c9bb94; font-variant-numeric:tabular-nums; }
.dk-sep { height:1px; margin:10px 0; background:linear-gradient(90deg, transparent, #7a6338 20%, #c9a85a 50%, #7a6338 80%, transparent); }
.dk-select { flex:1; height:30px; padding:0 8px; font:inherit; font-size:14px; color:#e2cf98; cursor:pointer;
  background:linear-gradient(#2a2520, #1a1714); border:1px solid #0b0a09; box-shadow:0 0 0 1px #6b5731; outline:none; }
.dk-select:focus { box-shadow:0 0 0 1px #c9a85a; }
.dk-select option { color:#e2cf98; background:#1a1714; }
.dk-range { flex:1; -webkit-appearance:none; appearance:none; height:18px; margin:0; background:transparent; cursor:pointer; }
.dk-range::-webkit-slider-runnable-track { height:6px; background:linear-gradient(90deg, #8a6a2c var(--fill,50%), #0b0a0a var(--fill,50%));
  border:1px solid #4a3d24; box-shadow:inset 0 1px 2px #000; }
.dk-range::-moz-range-track { height:6px; background:#0b0a0a; border:1px solid #4a3d24; }
.dk-range::-moz-range-progress { height:6px; background:#8a6a2c; }
.dk-range::-webkit-slider-thumb { -webkit-appearance:none; width:12px; height:18px; margin-top:-7px; border:1px solid #0b0a09;
  background:linear-gradient(#e2c170, #8a6a2c); box-shadow:0 0 0 1px #6b5731, 0 0 6px rgba(201,168,90,.45); }
.dk-range::-moz-range-thumb { width:12px; height:18px; border:1px solid #0b0a09; border-radius:0;
  background:linear-gradient(#e2c170, #8a6a2c); }
.dk-range:disabled { opacity:.4; cursor:default; }
.dk-menu-note { font-size:12px; color:#9c8f6c; }
.dk-menu-actions { display:flex; gap:10px; margin-top:6px; }
.dk-menu-actions .dk-btn { flex:1; padding:8px 0; font-size:15px; }
.dk-menu-close { display:block; width:100%; margin-top:12px; padding:9px 0; font-size:17px; letter-spacing:6px; }
/* 操作说明（v0.7-hud3）：与设置菜单同一个石质面板，居中，分“探索”“战斗”两栏 */
.dk-menu-help { display:block; width:100%; padding:7px 0; font-size:15px; letter-spacing:4px; }
.dk-help { width:880px; max-height:820px; overflow-y:auto; }
.dk-help-cols { display:flex; gap:26px; }
.dk-help-col { flex:1; min-width:0; }
.dk-help-section { margin:2px 0 6px; padding-bottom:4px; text-align:center; font-size:17px; letter-spacing:8px; text-indent:8px; color:#ffe08a;
  text-shadow:0 0 8px rgba(201,150,44,.6), 0 1px 2px #000; border-bottom:1px solid rgba(122,99,56,.6); }
.dk-help-group { margin:10px 0 3px; font-size:13px; letter-spacing:3px; color:#9c8f6c; }
.dk-help-line { display:flex; gap:10px; padding:3px 0; font-size:14px; line-height:1.4; border-bottom:1px solid rgba(74,61,36,.35); }
.dk-help-keys { flex:none; width:150px; color:#e2cf98; }
.dk-help-action { flex:1; color:#c9bb94; }
.dk-confirm-veil { position:absolute; inset:0; pointer-events:auto; display:flex; align-items:center; justify-content:center;
  background:rgba(0,0,0,.55); z-index:2; animation:dk-fade .15s ease-out; }
.dk-confirm { position:relative; width:380px; padding:18px 22px 16px; text-align:center; }
.dk-confirm-text { margin:4px 0 16px; font-size:16px; line-height:1.6; letter-spacing:1px; color:#e8d9a8; }
.dk-confirm-actions { display:flex; gap:12px; }
.dk-confirm-actions .dk-btn { flex:1; padding:8px 0; }

.dk-title-screen { position:absolute; inset:0; pointer-events:auto; display:flex; flex-direction:column; align-items:center;
  justify-content:center; animation:dk-fade .5s ease-out;
  background:
    radial-gradient(ellipse 70% 60% at 50% 48%, rgba(0,0,0,.25), rgba(0,0,0,.72) 70%, rgba(0,0,0,.94)),
    linear-gradient(rgba(6,5,8,.35), rgba(6,5,8,.55)); }
.dk-title-screen.is-hidden { display:none; }
.dk-game-name { font-size:76px; letter-spacing:22px; text-indent:22px; color:#e8cf86; line-height:1.1;
  text-shadow:0 0 24px rgba(201,150,44,.55), 0 0 2px #000, 0 4px 8px #000; }
.dk-game-sub { margin-top:10px; font-size:16px; letter-spacing:8px; text-indent:8px; color:#a99a72; text-shadow:0 1px 3px #000; }
.dk-title-rule { width:420px; height:1px; margin:26px 0 30px;
  background:linear-gradient(90deg, transparent, #7a6338 20%, #c9a85a 50%, #7a6338 80%, transparent); }
.dk-title-menu { display:flex; flex-direction:column; gap:14px; width:240px; }
.dk-title-menu .dk-btn { padding:11px 0; font-size:20px; letter-spacing:10px; text-indent:10px; }
.dk-title-hint { position:absolute; bottom:22px; font-size:12px; letter-spacing:2px; color:#6f6650; }

/* ---------- 对话框（步骤 16）：盖住游戏画面的透明层，点任意处推进；石质面板 + 金属铭牌 ---------- */
.dk-dialog-layer { position:absolute; inset:0; pointer-events:auto; z-index:12; cursor:pointer; user-select:none;
  font-family:${SERIF_FONT}; color:#d8c690;
  background:linear-gradient(to top, rgba(0,0,0,.55), rgba(0,0,0,0) 38%); animation:dk-fade .25s ease-out; }
.dk-dialog-layer.is-hidden { display:none; }
.dk-dialog { left:50%; bottom:34px; width:820px; min-height:150px; transform:translateX(-50%); padding:30px 34px 22px;
  cursor:pointer; animation:dk-dialog-in .3s ease-out; }
@keyframes dk-dialog-in { from { opacity:0; transform:translate(-50%, 14px); } to { opacity:1; transform:translate(-50%, 0); } }
/* 内圈的暗金细线：第二道金属包边 */
.dk-dialog::after { content:""; position:absolute; inset:8px; pointer-events:none; border:1px solid rgba(122,99,56,.45);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.6); }
.dk-dialog-name { position:absolute; left:26px; top:-17px; min-width:120px; padding:5px 22px 6px; text-align:center;
  font-size:19px; letter-spacing:5px; text-indent:5px; color:#ffe08a; text-shadow:0 0 8px rgba(201,150,44,.7), 0 1px 2px #000;
  background:linear-gradient(#4a4238, #2a2520 48%, #1c1916 52%, #26221d); border:1px solid #0b0a09;
  box-shadow:0 0 0 1px #8a6f3c, 0 0 0 3px #1a1714, 0 0 0 4px #43361f, inset 0 1px 0 rgba(255,235,180,.2), 0 4px 10px rgba(0,0,0,.7); }
.dk-dialog-name.is-boss { color:#ff9a7a; text-shadow:0 0 10px rgba(200,40,20,.8), 0 1px 2px #000;
  box-shadow:0 0 0 1px #8a3a2c, 0 0 0 3px #1a1714, 0 0 0 4px #4a2018, inset 0 1px 0 rgba(255,200,180,.18), 0 4px 10px rgba(0,0,0,.7); }
.dk-dialog-text { position:relative; min-height:62px; font-size:22px; line-height:1.6; letter-spacing:2px; color:#eadcb4;
  text-shadow:0 1px 2px #000; white-space:pre-wrap; }
.dk-dialog-aside { margin-right:6px; font-style:italic; color:#b9a77a; }
.dk-dialog-more { position:absolute; right:30px; bottom:14px; font-size:14px; color:#c9a85a; animation:dk-dialog-blink 1s ease-in-out infinite; }
.dk-dialog-more.is-hidden { visibility:hidden; }
@keyframes dk-dialog-blink { 0%,100% { opacity:.25; transform:translateY(0); } 50% { opacity:1; transform:translateY(3px); } }
.dk-dialog-choices { display:flex; justify-content:center; gap:22px; margin-top:16px; }
.dk-dialog-choices.is-hidden { display:none; }
.dk-dialog-choices .dk-btn { min-width:200px; padding:10px 18px; font-size:18px; letter-spacing:4px; }
.dk-dialog-hint { position:absolute; right:34px; top:-14px; font-size:12px; letter-spacing:1px; color:#8f8468; text-shadow:0 1px 2px #000; }

/* ---------- 探索界面（步骤 21）：左下角血蓝圆球 + 按钮栏 + 面板（居中）。跑向 Boss、对话中淡出（v0.7-hud2） ---------- */
.dk-explore-hud { position:absolute; inset:0; pointer-events:none; z-index:13; user-select:none;
  font-family:${SERIF_FONT}; color:#d8c690; font-size:14px; line-height:1.35; opacity:1; transition:opacity .3s ease-out; }
.dk-explore-hud > * { pointer-events:auto; }
.dk-explore-hud.is-faded { opacity:0; }
.dk-explore-hud.is-faded > *, .dk-explore-hud.is-faded .dk-hud-panels > * { pointer-events:none; }
.dk-explore-hud > .dk-hud-panels { pointer-events:none; position:absolute; inset:0; }
.dk-hud-panels > * { pointer-events:auto; }
/* 圆球：外框是多层金属环，里面是玻璃球；左右两半各自裁剪，液体从下往上填 */
.dk-orb { position:absolute; left:18px; bottom:16px; width:128px; height:128px; border-radius:50%;
  background:radial-gradient(circle at 50% 30%, #5a4c36, #2a231a 55%, #120f0c 72%);
  box-shadow:0 0 0 2px #0b0a09, 0 0 0 4px #7a6338, 0 0 0 6px #1a1714, 0 0 0 7px #c9a85a55, 0 8px 18px rgba(0,0,0,.8),
    inset 0 2px 3px rgba(255,235,180,.25), inset 0 -3px 5px rgba(0,0,0,.8); }
.dk-orb::before { content:""; position:absolute; inset:-5px; border-radius:50%; pointer-events:none;
  background:
    radial-gradient(circle at 50% 2px, #e2c170 0 2px, #3a2f1b 3px, transparent 4px),
    radial-gradient(circle at 50% calc(100% - 2px), #e2c170 0 2px, #3a2f1b 3px, transparent 4px),
    radial-gradient(circle at 2px 50%, #e2c170 0 2px, #3a2f1b 3px, transparent 4px),
    radial-gradient(circle at calc(100% - 2px) 50%, #e2c170 0 2px, #3a2f1b 3px, transparent 4px); }
.dk-orb-glass { position:absolute; inset:9px; border-radius:50%; overflow:hidden; background:#070506;
  box-shadow:inset 0 0 14px #000, inset 0 0 0 1px #000; }
.dk-orb-half { position:absolute; top:0; bottom:0; width:50%; overflow:hidden; cursor:default; }
.dk-orb-half.is-hp { left:0; }
.dk-orb-half.is-mp { right:0; }
.dk-orb-liquid { position:absolute; left:0; right:0; bottom:0; transition:height .3s ease-out; overflow:hidden; }
.dk-orb-half.is-hp .dk-orb-liquid { background:radial-gradient(ellipse 120% 90% at 100% 80%, #d8261a, #8a0d08 55%, #3a0302); }
.dk-orb-half.is-mp .dk-orb-liquid { background:radial-gradient(ellipse 120% 90% at 0% 80%, #2c64e0, #0e2a8a 55%, #030b3a); }
/* 液面：一道亮波纹缓慢横向流动 */
.dk-orb-wave { position:absolute; left:-100%; top:-3px; width:300%; height:8px; opacity:.75;
  background:repeating-radial-gradient(ellipse 18px 5px at 50% 100%, rgba(255,255,255,.35), rgba(255,255,255,0) 70%);
  animation:dk-orb-wave 6s linear infinite; }
.dk-orb-half.is-mp .dk-orb-wave { animation-duration:7.5s; animation-direction:reverse; }
@keyframes dk-orb-wave { from { transform:translateX(0); } to { transform:translateX(33.333%); } }
.dk-orb-divider { position:absolute; left:50%; top:0; bottom:0; width:4px; margin-left:-2px; pointer-events:none;
  background:linear-gradient(90deg, #1a1408, #c9a85a 45%, #5a4320 55%, #120e08); box-shadow:0 0 4px #000; }
.dk-orb-shine { position:absolute; inset:0; border-radius:50%; pointer-events:none;
  background:
    radial-gradient(ellipse 55% 35% at 38% 22%, rgba(255,255,255,.38), rgba(255,255,255,0) 70%),
    radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 58%, rgba(0,0,0,.55) 100%); }
/* 按钮栏 */
.dk-hud-bar { position:absolute; left:158px; bottom:22px; display:flex; gap:6px; }
.dk-hud-btn { position:relative; width:46px; height:46px; padding:0; cursor:pointer; color:#d9c38a;
  display:flex; align-items:center; justify-content:center;
  background:
    repeating-linear-gradient(118deg, rgba(255,255,255,.03) 0 2px, transparent 2px 7px),
    linear-gradient(#3a342c, #1f1b17 52%, #15120f);
  border:1px solid #0b0a09; border-radius:2px;
  box-shadow:0 0 0 1px #6b5731, 0 0 0 3px #15120f, inset 0 1px 0 rgba(255,235,180,.18), inset 0 -2px 4px rgba(0,0,0,.7), 0 4px 10px rgba(0,0,0,.7); }
.dk-hud-btn svg { width:26px; height:26px; display:block; filter:drop-shadow(0 1px 1px #000); }
.dk-hud-btn:hover { color:#fff1c4; box-shadow:0 0 0 1px #c9a85a, 0 0 0 3px #15120f, 0 0 12px rgba(201,168,90,.4), inset 0 1px 0 rgba(255,235,180,.25); }
.dk-hud-btn:active { transform:translateY(1px); }
.dk-hud-btn.is-active { color:#ffe08a; background:linear-gradient(#5a4a2c, #2e2516 52%, #1c160c);
  box-shadow:0 0 0 1px #f2d98a, 0 0 0 3px #15120f, 0 0 14px rgba(242,200,90,.5), inset 0 0 8px rgba(255,210,120,.25); }
.dk-hud-btn.is-disabled { color:#5f594f; cursor:not-allowed; filter:grayscale(.9); }
.dk-hud-btn.is-disabled:hover { color:#7a7264; box-shadow:0 0 0 1px #4a3a30, 0 0 0 3px #15120f; }
/* 提示框 */
.dk-tip { position:absolute; z-index:5; transform:translate(-50%, calc(-100% - 8px)); padding:4px 10px; white-space:nowrap;
  pointer-events:none; font-size:13px; letter-spacing:1px; color:#eadcb4; background:rgba(14,12,10,.94);
  border:1px solid #0b0a09; box-shadow:0 0 0 1px #7a6338, 0 4px 10px rgba(0,0,0,.8); }
/* 面板框架 */
/* 石质底子在单独的一层（.dk-game-panel-bg），面板本身只留外圈金属环；有 3D 预览的面板在底子上挖窗口（mask） */
.dk-game-panel { left:50%; top:50%; transform:translate(-50%, -50%); width:640px; padding:0; isolation:isolate; animation:dk-fade .15s ease-out;
  background:none; box-shadow:0 0 0 1px #7a6338, 0 0 0 3px #1a1714, 0 0 0 4px #43361f, 0 8px 22px rgba(0,0,0,.75); }
.dk-game-panel-bg { position:absolute; inset:0; z-index:0; pointer-events:none;
  background:
    radial-gradient(ellipse at 18% 0%, rgba(255,240,200,.07), transparent 55%),
    repeating-linear-gradient(118deg, rgba(255,255,255,.022) 0 2px, transparent 2px 9px),
    repeating-linear-gradient(28deg, rgba(0,0,0,.16) 0 3px, transparent 3px 13px),
    linear-gradient(#262320, #131110);
  box-shadow:inset 0 0 22px rgba(0,0,0,.85), inset 0 1px 0 rgba(255,235,180,.08); }
.dk-game-panel.has-window .dk-game-panel-bg {
  -webkit-mask:linear-gradient(#000 0 0), linear-gradient(#000 0 0) var(--win-x) var(--win-y) / var(--win-w) var(--win-h) no-repeat;
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0), linear-gradient(#000 0 0) var(--win-x) var(--win-y) / var(--win-w) var(--win-h) no-repeat;
  mask-composite:exclude; }
.dk-game-panel::before, .dk-game-panel::after { z-index:2; }
.dk-game-panel::after { content:""; position:absolute; inset:6px; pointer-events:none; border:1px solid rgba(122,99,56,.4); }
.dk-game-panel-head { position:relative; z-index:1; display:flex; align-items:center; justify-content:center; height:38px;
  border-bottom:1px solid #0b0a09; box-shadow:0 1px 0 #43361f;
  background:linear-gradient(#3a332a, #221e19 55%, #191613); }
.dk-game-panel-title { font-size:17px; letter-spacing:8px; text-indent:8px; color:#e8d49a; text-shadow:0 1px 2px #000, 0 0 8px rgba(201,150,44,.4); }
.dk-game-panel-close { position:absolute; right:8px; top:6px; width:26px; height:26px; padding:0; font-size:18px; line-height:1; letter-spacing:0; z-index:1; }
.dk-game-panel-body { position:relative; z-index:1; padding:14px 16px 16px; }
.dk-game-panel-empty { padding:70px 0; text-align:center; font-size:16px; letter-spacing:4px; color:#8f8468; }
/* 角色面板：左侧 3D 预览（透明窗口，下面的画布上画模型），右侧属性 */
.dk-char-layout { display:flex; gap:16px; }
.dk-preview-view { position:relative; flex:none; width:260px; height:340px; cursor:grab; touch-action:none;
  border:1px solid #0b0a09; box-shadow:0 0 0 1px #6b5731, inset 0 0 18px rgba(0,0,0,.9); }
.dk-preview-view.is-dragging { cursor:grabbing; }
.dk-char-info { flex:1; min-width:0; }
.dk-char-head { display:flex; align-items:baseline; gap:10px; margin:2px 0 10px; }
.dk-char-name { font-size:24px; letter-spacing:4px; color:#ffe08a; text-shadow:0 0 8px rgba(201,150,44,.7), 0 1px 2px #000; }
.dk-char-class { font-size:13px; color:#a99a72; }
.dk-char-row { display:flex; align-items:baseline; justify-content:space-between; min-height:26px; font-size:15px; }
.dk-char-label { letter-spacing:2px; color:#b9a77a; }
.dk-char-value { font-variant-numeric:tabular-nums; color:#eadcb4; }
.dk-char-row.is-level .dk-char-value { font-size:18px; color:#ffe08a; }
.dk-exp-bar { position:relative; height:9px; margin:2px 0 4px; background:#0b0a0a; border:1px solid #4a3d24; box-shadow:inset 0 1px 2px #000; }
.dk-exp-bar > i { position:absolute; left:0; top:0; bottom:0; background:linear-gradient(#e2c170, #8a6a2c); }
.dk-char-stats .dk-char-row { border-bottom:1px solid rgba(74,61,36,.45); }
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

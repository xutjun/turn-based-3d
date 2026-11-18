// 战斗界面层（DOM）：头顶血条 / 魔法条 / 名字 / 封印标记、飘字、屏幕上方的出手顺序条、提示横幅、
// 以及战斗速度和“跳过动画”的开关。实现 render/director/types.ts 的 DirectorHud 接口。
//
// 血条缓动、飘字上升、横幅淡出都用 Scheduler 的演出时间推进（每帧由 update() 驱动），
// 所以会跟着倍速和跳过动画一起变化，不使用 setTimeout。

import { Vector3 } from 'three';
import type { UnitSnapshot } from '../../core/events';
import type { StatusType, UnitId } from '../../core/types';
import { FLOATER_STYLES, STAGING, TIMING, type FloaterStyle } from '../../data/presentationConfig';
import type { Scheduler } from '../../render/director/Scheduler';
import type { DirectorHud } from '../../render/director/types';
import { UI_CONFIG } from '../../data/uiConfig';
import { clientToLocal } from '../layout/viewportMath';
import { layoutNames, pointedHead, type HeadBox } from './nameLayout';

/** 把世界坐标投影到容器内的像素坐标；visible 为 false 表示在镜头外 */
export type Projector = (world: Vector3) => { x: number; y: number; visible: boolean };

export interface HudDeps {
  container: HTMLElement;
  scheduler: Scheduler;
  project: Projector;
  /** 取某单位头顶条的世界坐标 */
  headPosition(id: UnitId, out: Vector3): Vector3;
  /** 音效（可选）：提供后右上角多出音效开关和音量滑块，界面按钮带点击音 */
  sound?: {
    readonly volume: number;
    readonly muted: boolean;
    readonly supported: boolean;
    setVolume(volume: number): void;
    setMuted(muted: boolean): void;
    play(name: 'click'): void;
  };
  /** 画质开关（可选）：提供后右上角多一个“画质”按钮 */
  quality?: { isLow(): boolean; setLow(on: boolean): void };
  /**
   * 画质和音量由设置菜单管理（步骤 12，玩家战斗页）：右上角只留倍速和跳过动画，
   * 并给右侧的设置按钮让出位置。不传时（演示页）沿用原来的画质按钮和音量滑块。
   */
  settingsMenu?: boolean;
}

/** 头顶条上的标记 */
export interface HeadMark {
  kind: 'commander' | 'hostile' | 'friendly';
  /** 鼠标指着的主目标 */
  primary?: boolean;
}

const STYLE_ID = 'battle-hud-style';
const CSS = `
.hud { position:absolute; inset:0; pointer-events:none; overflow:hidden; user-select:none;
  font-family:"Times New Roman","Songti SC","SimSun",serif; color:#d8c690; }
.hud-head { position:absolute; left:0; top:0; width:62px; margin-left:-31px; text-align:center;
  will-change:transform; transition:opacity .25s; }
.hud-head.boss { width:120px; margin-left:-60px; }
.hud-name { display:block; width:max-content; font-size:11px; line-height:14px; white-space:nowrap; text-shadow:0 0 3px #000,0 1px 2px #000;
  opacity:0; transition:opacity .15s; will-change:transform,opacity; position:relative; left:50%; transform:translateX(-50%); }
.hud-head.show-name .hud-name { opacity:1; }
.hud-head.show-name { z-index:2; }
.hud-head.ally .hud-name { color:#cfe2f5; }
.hud-head.enemy .hud-name { color:#f1c7b8; }
.hud-bar { position:relative; height:6px; margin-top:2px; background:rgba(8,8,10,.85);
  border:1px solid rgba(150,120,70,.85); box-sizing:border-box; }
.hud-bar.mp { height:4px; margin-top:1px; }
.hud-fill { position:absolute; left:0; top:0; bottom:0; width:100%; transform-origin:left center; }
.hud-fill.hp { background:linear-gradient(#d2342a,#8a1410); }
.hud-fill.mp { background:linear-gradient(#3f7fe0,#1c3f96); }
.hud-status { margin-top:2px; min-height:0; display:flex; justify-content:center; gap:3px; }
.hud-seal { display:inline-flex; align-items:center; gap:2px; padding:0 4px 0 0; font-size:11px; line-height:16px; color:#ecd2ff;
  background:rgba(34,10,58,.85); border:1px solid #9a4cff; border-radius:9px; box-shadow:0 0 6px rgba(154,76,255,.8); }
.hud-seal i { display:inline-block; width:16px; height:16px; margin:-1px 0 -1px -1px; border-radius:50%; font-style:normal; font-size:10px;
  line-height:16px; text-align:center; color:#1a0630; background:radial-gradient(circle at 35% 30%,#f0d8ff,#a04cff 60%,#5a1ca8);
  border:1px solid #d9a6ff; box-sizing:border-box; }
.hud-seal b { font-weight:bold; text-shadow:0 0 3px #000; }
.hud-head.dead { opacity:.55; }
.hud-head.dead .hud-name::after { content:" · 倒地"; color:#9aa0a8; }
.hud-head.gone { opacity:0; }
.hud-head.mark-commander .hud-name { color:#ffe08a; text-shadow:0 0 6px #c9962c,0 0 2px #000; }
.hud-head.mark-commander .hud-name::before { content:"◆ "; }
.hud-head.mark-hostile .hud-name { color:#ff8a70; text-shadow:0 0 6px #c2220c,0 0 2px #000; }
.hud-head.mark-friendly .hud-name { color:#b9f59a; text-shadow:0 0 6px #3f9a1c,0 0 2px #000; }
.hud-head.mark-hostile .hud-bar, .hud-head.mark-friendly .hud-bar, .hud-head.mark-commander .hud-bar { border-color:#f2c85a; }
.hud-head.mark-primary { z-index:3; }
.hud-head.mark-primary .hud-name { font-size:13px; font-weight:bold; }
.hud-head.mark-primary .hud-name::before { content:"▼ "; }
.hud-floater { position:absolute; left:0; top:0; white-space:nowrap; font-weight:bold; font-size:20px;
  text-shadow:0 0 4px #000,0 2px 3px #000,0 0 8px rgba(0,0,0,.8); will-change:transform,opacity; }
.hud-order { position:absolute; top:10px; left:50%; transform:translateX(-50%); display:flex; align-items:center;
  gap:3px; max-width:calc(100% - 300px); flex-wrap:wrap; justify-content:center; padding:5px 8px; z-index:5;
  background:rgba(10,10,12,.72); border:1px solid rgba(150,120,70,.7); }
.hud-turn { margin-right:6px; font-size:14px; white-space:nowrap; color:#e8d9a8; }
.hud-chip { min-width:30px; padding:1px 4px; font-size:11px; line-height:15px; text-align:center; white-space:nowrap;
  background:rgba(34,32,30,.95); border:1px solid #555; box-sizing:border-box; transition:transform .15s,opacity .2s; }
.hud-chip.ally { border-color:#3f8fc0; color:#cfe6f8; }
.hud-chip.enemy { border-color:#b04a36; color:#f3cfc2; }
.hud-chip.acted { opacity:.4; }
.hud-chip.dead { opacity:.3; text-decoration:line-through; filter:grayscale(1); }
.hud-chip.active { opacity:1; transform:scale(1.22); border-color:#f2c85a; color:#1a1408; background:#d6b25e;
  box-shadow:0 0 10px rgba(242,200,90,.8); }
.hud-banner { position:absolute; left:50%; top:30%; z-index:6; transform:translate(-50%,-50%); padding:8px 46px; font-size:30px;
  letter-spacing:6px; white-space:nowrap; color:#f0dfae; text-shadow:0 0 8px #000,0 2px 4px #000;
  background:linear-gradient(90deg,rgba(10,10,12,0),rgba(10,10,12,.82) 20%,rgba(10,10,12,.82) 80%,rgba(10,10,12,0));
  border-top:1px solid rgba(150,120,70,.7); border-bottom:1px solid rgba(150,120,70,.7); opacity:0; }
.hud-controls { position:absolute; right:12px; top:10px; width:262px; display:flex; flex-wrap:wrap; justify-content:flex-end;
  align-items:center; gap:4px; pointer-events:auto; z-index:5; }
.hud-volume { width:78px; height:4px; margin:0 2px 0 4px; accent-color:#c9a85a; cursor:pointer; }
.hud-volume:disabled { opacity:.4; cursor:default; }
.hud-btn { padding:4px 10px; font:inherit; font-size:14px; cursor:pointer; color:#d8c690; background:rgba(40,36,30,.92);
  border:1px solid rgba(150,120,70,.7); }
.hud-btn.on { color:#1a1408; background:#c9a85a; }
.hud-controls.with-menu { right:58px; width:auto; flex-wrap:nowrap; }
.hud-controls.is-hidden { display:none; }
`;

interface HeadBar {
  el: HTMLDivElement;
  hpFill: HTMLDivElement;
  mpFill: HTMLDivElement | null;
  statusEl: HTMLDivElement;
  maxHp: number;
  maxMp: number;
  hp: number; // 目标值（事件给出的最新值）
  mp: number;
  shownHp: number; // 当前显示值，向目标值平滑靠拢
  shownMp: number;
  statuses: Map<StatusType, number>;
  nameEl: HTMLDivElement;
  nameWidth: number; // 名字的像素宽度（创建时量一次）
  boss: boolean;
  ally: boolean;
  lift: number; // 名字当前上抬的像素
  x: number; // 最近一帧头顶挂点的屏幕坐标
  y: number;
  onScreen: boolean;
}

interface Floater {
  el: HTMLDivElement;
  world: Vector3;
  age: number;
  offsetX: number;
  lane: number; // 同一单位连续飘字时错开的层数
}

const STATUS_LABEL: Record<StatusType, string> = { seal: '封印' };
const STATUS_ICON: Record<StatusType, string> = { seal: '封' };

export class BattleHud implements DirectorHud {
  private readonly root: HTMLDivElement;
  private readonly heads = new Map<UnitId, HeadBar>();
  private readonly chips = new Map<UnitId, HTMLDivElement>();
  private readonly dead = new Set<UnitId>();
  private readonly floaters: Floater[] = [];
  private readonly orderEl: HTMLDivElement;
  private readonly turnEl: HTMLSpanElement;
  private readonly bannerEl: HTMLDivElement;
  private readonly controlsEl: HTMLDivElement;
  private readonly tmp = new Vector3();
  private names = new Map<UnitId, { name: string; side: string }>();
  private bannerAge = Infinity;
  private bannerSticky = false;
  private activeId: UnitId | null = null;
  private floaterSerial = 0;

  constructor(private readonly deps: HudDeps) {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.orderEl = document.createElement('div');
    this.orderEl.className = 'hud-order';
    this.turnEl = document.createElement('span');
    this.turnEl.className = 'hud-turn';
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'hud-banner';
    this.controlsEl = document.createElement('div');
    this.controlsEl.className = `hud-controls${deps.settingsMenu ? ' with-menu' : ''}`;
    this.root.append(this.orderEl, this.bannerEl, this.controlsEl);
    deps.container.appendChild(this.root);
    this.renderControls();
    addEventListener('keydown', this.onKey);
    deps.container.addEventListener('pointermove', this.onPointerMove);
    deps.container.addEventListener('click', this.onClickSound, true);
    deps.container.addEventListener('pointerleave', this.onPointerLeave);
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    this.deps.container.removeEventListener('pointermove', this.onPointerMove);
    this.deps.container.removeEventListener('click', this.onClickSound, true);
    this.deps.container.removeEventListener('pointerleave', this.onPointerLeave);
    this.root.remove();
  }

  // ------------------------------------------------------------------
  // 战斗速度 / 跳过动画
  // ------------------------------------------------------------------

  /** 鼠标在战场上的位置（容器内像素）：指着谁就显示谁的名字 */
  private pointer: { x: number; y: number } | null = null;

  private readonly onPointerMove = (e: PointerEvent): void => {
    // 游戏区域可能被整体缩放（固定 16:10 画面）：换算回排版坐标
    const c = this.deps.container;
    this.pointer = clientToLocal(e.clientX, e.clientY, c.getBoundingClientRect(), c.clientWidth, c.clientHeight);
  };

  /** 点到任何界面按钮都响一声 */
  private readonly onClickSound = (e: MouseEvent): void => {
    if ((e.target as Element | null)?.closest?.('button')) this.deps.sound?.play('click');
  };

  private readonly onPointerLeave = (): void => {
    this.pointer = null;
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const { scheduler } = this.deps;
    if (e.key === '1' || e.key === '2') scheduler.setTimeScale(Number(e.key));
    else if (e.key === 's' || e.key === 'S') scheduler.setSkip(!scheduler.skip);
    else if ((e.key === 'm' || e.key === 'M') && this.deps.sound) this.deps.sound.setMuted(!this.deps.sound.muted);
    else return;
    this.renderControls();
  };

  /** 头顶条、出手顺序条的不透明度（步骤 17：入场过场中隐藏，开战时淡入）；速度 / 跳过按钮不受影响 */
  private layerOpacity = 1;

  setBattleOpacity(a: number): void {
    this.layerOpacity = Math.max(0, Math.min(1, a));
    const v = this.layerOpacity >= 1 ? '' : this.layerOpacity.toFixed(3);
    this.orderEl.style.opacity = v;
    for (const head of this.heads.values()) head.el.style.opacity = v;
  }

  /** 当前的头顶条 / 顺序条不透明度（调试） */
  get battleOpacity(): number {
    return this.layerOpacity;
  }

  /** 显示 / 隐藏右上角的速度按钮和顶部的出手顺序条（标题界面上隐藏） */
  setControlsVisible(on: boolean): void {
    this.controlsEl.classList.toggle('is-hidden', !on);
    this.orderEl.style.display = on ? '' : 'none';
  }

  /** 重画右上角的速度按钮（外部改了速度或跳过状态后也可以调用） */
  renderControls(): void {
    const { scheduler } = this.deps;
    this.controlsEl.replaceChildren();
    const button = (text: string, on: boolean, title: string, onClick: () => void): void => {
      const b = document.createElement('button');
      b.className = `hud-btn${on ? ' on' : ''}`;
      b.textContent = text;
      b.title = title;
      b.onclick = () => {
        onClick();
        this.renderControls();
      };
      this.controlsEl.append(b);
    };
    for (const speed of STAGING.speeds) {
      button(`${speed}×`, scheduler.timeScale === speed, `战斗速度 ${speed} 倍（按键 ${speed}）`, () => scheduler.setTimeScale(speed));
    }
    button('跳过动画', scheduler.skip, '跳过动画（按键 S）', () => scheduler.setSkip(!scheduler.skip));
    if (this.deps.settingsMenu) return; // 画质、音量在设置菜单里
    const { quality } = this.deps;
    if (quality) {
      const low = quality.isLow();
      button(
        low ? '画质 低' : '画质 高',
        low,
        '低画质：关闭辉光、降低阴影、减少粒子（卡顿时打开）',
        () => quality.setLow(!low),
      );
    }
    const { sound } = this.deps;
    if (sound?.supported) {
      button(sound.muted ? '音效 关' : '音效 开', !sound.muted, '音效开关（按键 M）', () => sound.setMuted(!sound.muted));
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'hud-volume';
      slider.min = '0';
      slider.max = '100';
      slider.value = String(Math.round(sound.volume * 100));
      slider.title = `音量 ${slider.value}%`;
      slider.disabled = sound.muted;
      slider.oninput = () => {
        sound.setVolume(Number(slider.value) / 100);
        slider.title = `音量 ${slider.value}%`;
      };
      this.controlsEl.append(slider);
    }
  }

  // ------------------------------------------------------------------
  // 指令界面用：目标标记、复位
  // ------------------------------------------------------------------

  /**
   * 标出头顶条：当前待下令单位、会被命中的目标、鼠标指着的主目标。
   * 不在表里的单位清除标记。
   */
  setMarks(marks: ReadonlyMap<UnitId, HeadMark>): void {
    for (const [id, head] of this.heads) {
      const mark = marks.get(id);
      const list = head.el.classList;
      list.toggle('mark-commander', mark?.kind === 'commander');
      list.toggle('mark-hostile', mark?.kind === 'hostile');
      list.toggle('mark-friendly', mark?.kind === 'friendly');
      list.toggle('mark-primary', mark?.primary === true);
    }
  }

  /** 清空飘字、横幅、出手顺序条（再战一次时调用；头顶条由下一次 init() 重建） */
  reset(): void {
    for (const f of this.floaters) f.el.remove();
    this.floaters.length = 0;
    this.bannerAge = Infinity;
    this.bannerSticky = false;
    this.bannerEl.style.opacity = '0';
    this.activeId = null;
    this.chips.clear();
    this.orderEl.replaceChildren();
  }

  // ------------------------------------------------------------------
  // DirectorHud
  // ------------------------------------------------------------------

  init(units: readonly UnitSnapshot[]): void {
    for (const head of this.heads.values()) head.el.remove();
    this.heads.clear();
    this.dead.clear();
    this.names = new Map(units.map((u) => [u.id, { name: u.name, side: u.side }]));
    for (const u of units) {
      const el = document.createElement('div');
      el.className = `hud-head ${u.side}${u.rank === 'boss' ? ' boss' : ''}`;
      const name = document.createElement('div');
      name.className = 'hud-name';
      name.textContent = u.name;
      const bar = (kind: 'hp' | 'mp'): HTMLDivElement => {
        const wrap = document.createElement('div');
        wrap.className = `hud-bar ${kind}`;
        const fill = document.createElement('div');
        fill.className = `hud-fill ${kind}`;
        wrap.append(fill);
        el.append(wrap);
        return fill;
      };
      el.append(name);
      const hpFill = bar('hp');
      // 魔法条只有友方显示
      const mpFill = u.side === 'ally' ? bar('mp') : null;
      const statusEl = document.createElement('div');
      statusEl.className = 'hud-status';
      el.append(statusEl);
      if (this.layerOpacity < 1) el.style.opacity = this.layerOpacity.toFixed(3);
      this.root.append(el);
      this.heads.set(u.id, {
        el,
        hpFill,
        mpFill,
        statusEl,
        maxHp: u.stats.maxHp,
        maxMp: u.stats.maxMp,
        hp: u.hp,
        mp: u.mp,
        shownHp: u.hp,
        shownMp: u.mp,
        statuses: new Map(),
        nameEl: name,
        nameWidth: name.offsetWidth + 20, // 留出标记符号（◆ ▼）和加粗的余量
        boss: u.rank === 'boss',
        ally: u.side === 'ally',
        lift: -1,
        x: 0,
        y: 0,
        onScreen: false,
      });
    }
  }

  setHp(id: UnitId, hp: number): void {
    const head = this.heads.get(id);
    if (head) head.hp = hp;
  }

  setMp(id: UnitId, mp: number): void {
    const head = this.heads.get(id);
    if (head) head.mp = mp;
  }

  setDead(id: UnitId, dead: boolean, vanish: boolean): void {
    const head = this.heads.get(id);
    if (dead) this.dead.add(id);
    else this.dead.delete(id);
    if (head) {
      head.el.classList.toggle('dead', dead && !vanish);
      head.el.classList.toggle('gone', dead && vanish);
      if (dead) {
        head.statuses.clear();
        this.renderStatus(head);
      }
    }
    this.chips.get(id)?.classList.toggle('dead', dead);
  }

  setStatus(id: UnitId, status: StatusType, turns: number | null): void {
    const head = this.heads.get(id);
    if (!head) return;
    if (turns === null || turns <= 0) head.statuses.delete(status);
    else head.statuses.set(status, turns);
    this.renderStatus(head);
  }

  private renderStatus(head: HeadBar): void {
    // 封印图标：圆形符印 + 剩余回合数
    head.statusEl.replaceChildren(
      ...[...head.statuses].map(([s, n]) => {
        const badge = document.createElement('span');
        badge.className = 'hud-seal';
        badge.title = `${STATUS_LABEL[s]}：剩余 ${n} 回合`;
        const icon = document.createElement('i');
        icon.textContent = STATUS_ICON[s];
        const turns = document.createElement('b');
        turns.textContent = String(n);
        badge.append(icon, turns);
        return badge;
      }),
    );
  }

  floater(id: UnitId, text: string, style: FloaterStyle): void {
    const s = FLOATER_STYLES[style];
    const el = document.createElement('div');
    el.className = 'hud-floater';
    el.textContent = text;
    el.style.color = s.color;
    el.style.fontSize = `${Math.round(20 * s.size)}px`;
    el.style.opacity = '0'; // 位置要到下一帧 update() 才算出来，在那之前先不显示（否则会在左上角闪一下）
    this.root.append(el);
    // 同一单位身上还没消失的飘字越多，新飘字起点越高，避免叠在一起
    const world = this.deps.headPosition(id, new Vector3()).clone();
    const lane = this.floaters.filter((f) => f.world.distanceToSquared(world) < 0.01 && f.age < 0.5).length;
    this.floaterSerial += 1;
    this.floaters.push({ el, world, age: 0, offsetX: ((this.floaterSerial % 3) - 1) * 14, lane });
  }

  setTurn(turn: number, order: readonly UnitId[]): void {
    this.turnEl.textContent = `第 ${turn} 回合`;
    this.chips.clear();
    this.orderEl.replaceChildren(this.turnEl);
    for (const id of order) {
      const info = this.names.get(id);
      const chip = document.createElement('div');
      chip.className = `hud-chip ${info?.side ?? ''}${this.dead.has(id) ? ' dead' : ''}`;
      chip.textContent = info?.name ?? id;
      this.chips.set(id, chip);
      this.orderEl.append(chip);
    }
  }

  setActive(id: UnitId | null): void {
    if (this.activeId) this.chips.get(this.activeId)?.classList.remove('active');
    this.activeId = id;
    if (id) this.chips.get(id)?.classList.add('active');
  }

  setActed(id: UnitId): void {
    this.chips.get(id)?.classList.add('acted');
  }

  queueLate(id: UnitId): void {
    // 把它的头像挪到出手顺序条的最后
    const chip = this.chips.get(id);
    if (chip) this.orderEl.append(chip);
  }

  banner(text: string, sticky = false): void {
    this.bannerEl.textContent = text;
    this.bannerAge = 0;
    this.bannerSticky = sticky;
  }

  // ------------------------------------------------------------------
  // 每帧
  // ------------------------------------------------------------------

  /** 每帧调用：更新头顶条位置与数值、飘字、横幅 */
  update(): void {
    const { scheduler, project, headPosition } = this.deps;
    const dt = scheduler.delta;
    // 血条向目标值平滑靠拢；跳过动画时直接到位
    const k = scheduler.skip ? 1 : Math.min(1, dt * 7);

    for (const [id, head] of this.heads) {
      head.shownHp += (head.hp - head.shownHp) * k;
      head.shownMp += (head.mp - head.shownMp) * k;
      head.hpFill.style.transform = `scaleX(${Math.max(0, Math.min(1, head.shownHp / head.maxHp))})`;
      if (head.mpFill) {
        const ratio = head.maxMp > 0 ? head.shownMp / head.maxMp : 0;
        head.mpFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
      }
      const p = project(headPosition(id, this.tmp));
      head.x = p.x;
      head.y = p.y;
      head.onScreen = p.visible && !head.el.classList.contains('gone');
      head.el.style.visibility = p.visible ? 'visible' : 'hidden';
      // 条的底边对齐头顶挂点
      head.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translateY(-100%)`;
    }
    this.updateNames();

    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i]!;
      f.age += dt / TIMING.floater;
      if (f.age >= 1 || scheduler.skip) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const p = project(f.world);
      const rise = 26 + 46 * (1 - (1 - f.age) * (1 - f.age)) + f.lane * 22;
      const pop = f.age < 0.12 ? 0.6 + (f.age / 0.12) * 0.55 : 1.15 - Math.min(0.15, (f.age - 0.12) * 0.6);
      f.el.style.opacity = String(f.age < 0.7 ? 1 : (1 - f.age) / 0.3);
      f.el.style.transform = `translate(${(p.x + f.offsetX).toFixed(1)}px,${(p.y - rise).toFixed(1)}px) translate(-50%,-100%) scale(${pop.toFixed(3)})`;
    }

    if (this.bannerAge !== Infinity) {
      this.bannerAge += dt / TIMING.turnBanner;
      const a = this.bannerAge;
      const fade = this.bannerSticky ? Math.min(1, a * 4) : a < 0.2 ? a / 0.2 : a < 0.75 ? 1 : Math.max(0, (1 - a) / 0.25);
      this.bannerEl.style.opacity = String(fade);
      if (!this.bannerSticky && a >= 1) this.bannerAge = Infinity;
    }
  }

  /**
   * 名字的显示与错开：平时只显示血条；Boss、正在出手的单位、被选中 / 会被命中的单位、
   * 鼠标指着的单位才显示名字，并且互相不重叠、不压住别的血条。
   */
  private updateNames(): void {
    const cfg = UI_CONFIG.headName;
    const boxes: HeadBox[] = [];
    const points: { id: UnitId; x: number; y: number; scale: number }[] = [];
    for (const [id, head] of this.heads) {
      if (head.onScreen) points.push({ id, x: head.x, y: head.y, scale: head.boss ? 2 : 1 });
    }
    const pointed = this.pointer ? pointedHead(points, this.pointer.x, this.pointer.y, cfg.hover) : null;
    for (const [id, head] of this.heads) {
      const list = head.el.classList;
      const marked = list.contains('mark-commander') || list.contains('mark-hostile') || list.contains('mark-friendly');
      const show =
        head.onScreen && ((cfg.alwaysShowBoss && head.boss) || marked || id === this.activeId || id === pointed);
      list.toggle('show-name', show);
      if (!head.onScreen) continue;
      boxes.push({
        id,
        x: head.x,
        y: head.y,
        barWidth: head.boss ? 120 : 62,
        barHeight: (head.ally ? 13 : 8) + (head.statuses.size > 0 ? 20 : 0),
        nameWidth: head.nameWidth,
        showName: show,
        priority: (list.contains('mark-primary') ? 4 : 0) + (head.boss ? 2 : 0) + (id === this.activeId ? 1 : 0),
      });
    }
    const lifts = layoutNames(boxes, cfg);
    for (const [id, head] of this.heads) {
      const lift = lifts.get(id) ?? 0;
      if (lift === head.lift) continue;
      head.lift = lift;
      head.nameEl.style.transform = `translateX(-50%) translateY(${-lift}px)`;
    }
  }

  /** 当前显示着名字的单位（自检用） */
  shownNames(): UnitId[] {
    return [...this.heads].filter(([, h]) => h.el.classList.contains('show-name')).map(([id]) => id);
  }

  /** 还在飘的飘字数量（自检用：重新开始 / 退出后应为 0） */
  get floaterCount(): number {
    return this.floaters.length;
  }

  /** 头顶条当前的目标气血（自检用：与逻辑层状态对比） */
  targetHp(id: UnitId): number | undefined {
    return this.heads.get(id)?.hp;
  }

  /** 头顶条当前的目标魔法（自检用） */
  targetMp(id: UnitId): number | undefined {
    return this.heads.get(id)?.mp;
  }
}

// 技能演示模式（地址带 ?demo=skills）：左下角一组按钮，每个按钮单独触发一个技能的演出，便于逐个验收。
// 每次演示都先把战场复位到满状态，再把该技能的事件喂给和正式战斗同一个 BattleDirector。
// 演示结束后在面板底部显示这次演出期间的帧率和特效用量。
//
// 地址参数：
//   play=<id>   打开页面后自动播放某个演示（id 见 skillDemoScripts.ts，例如 play=whirlwind）
//   summon=<种类> 打开页面后自动播放召唤演示（bones / soul / wisps / rise / all，步骤 18）
//   all=1       依次自动播放全部演示
//   speed=2     初始两倍速；skip=1 一开始就跳过动画
// 快捷键：1 / 2 切换速度，S 跳过动画（和正式战斗相同）。

import { Vector3 } from 'three';
import { EventBus, type BattleEvent, type BattleEventInput } from '../../core/events';
import { ENEMY_TEMPLATES } from '../../data/enemies';
import { ALLY_TEMPLATES } from '../../data/heroes';
import { STAGING } from '../../data/presentationConfig';
import { BattleScene } from '../../render/BattleScene';
import { hudSettingsAdapters, loadPageSettings, sceneOptionsOf } from '../settings/sceneSettings';
import { BattleDirector } from '../../render/director/BattleDirector';
import { BattleHud } from '../hud/BattleHud';
import { el, injectTheme } from '../theme';
import { snapshotOf } from './showcaseScript';
import { buildSkillDemos, DEMO_SKILLS, type SkillDemo } from './skillDemoScripts';
import { SummonCutscene } from '../../render/cutscene/summonCutscene';
import { SummonFx } from '../../render/cutscene/summonFx';
import type { SummonStyle } from '../../data/cutsceneConfig';

/** 召唤演示（步骤 18）：每种小怪单独播放出场动画，或播放完整召唤（Boss 举臂 + 9 个小怪分批出场 + 短吼） */
const SUMMON_DEMOS: { id: SummonStyle | 'all'; label: string; note: string }[] = [
  { id: 'bones', label: '骷髅兵', note: '地面裂开，骨头飞起拼合（脊椎、肋骨、头骨、四肢），盔甲武器落下，眼火点亮，站起' },
  { id: 'soul', label: '堕落骑士', note: '地面升起黑烟，半透明的灵魂轮廓浮现，凝成实体，盔甲由暗到亮，眼光亮起' },
  { id: 'wisps', label: '亡灵法师', note: '绿色鬼火汇聚，灵魂显现后凝成实体，骨杖最后出现在手中' },
  { id: 'rise', label: '恶魔祭司', note: '脚下升起暗影法阵，身影从法阵中升起成形' },
  { id: 'all', label: '完整召唤', note: 'Boss 短促举臂召唤后回到待机，9 个小怪分批在各自阵位出场，最后一声短吼' },
];

/** 一次演示的性能与一致性记录 */
export interface DemoResult {
  id: string;
  frames: number;
  seconds: number;
  avgFps: number;
  minFps: number; // 最慢的一帧折算的帧率
  low1Fps: number; // 最慢 1% 的帧折算的帧率
  peakParticles: number;
  peakObjects: number; // 同时在场的特效对象（精灵、光柱、贴花 …）最大数
  pooledObjects: number; // 对象池里累计创建的对象数（多次播放后不应继续增长）
  idleDrawCalls: number; // 演示开始前（没有特效时）一帧的绘制调用数
  peakDrawCalls: number; // 演示期间一帧最多的绘制调用数
  avgUpdateMs: number; // 每帧逻辑部分（动画、特效、界面，不含渲染）的平均耗时
  maxUpdateMs: number;
  hpMismatches: string[]; // 头顶条与脚本数值不一致（应为空）
  displaced: string[]; // 演示结束后不在站位上的单位（应为空）
  concurrentActions: number; // 同时行动次数（应为 0）
  leftover: { objects: number; particles: number; trails: number }; // 演示结束、粒子散尽后仍在场的特效（应全为 0）
}

/** 自检数据（window.__skillDemo） */
export interface SkillDemoCheck {
  ids: string[];
  playing: string | null;
  results: DemoResult[];
  play(id: string): Promise<DemoResult | null>;
  fx(): { objects: number; particles: number; trails: number };
  /** 调试用：任意演出速度（例如 0.25 慢放逐帧检查） */
  timeScale(scale: number): void;
  /** 调试用：停掉自动渲染，改为用 step(dt) 手动逐帧推进（逐帧检查演出）；render 为 false 时只推进不画 */
  manual(on: boolean): void;
  step(dt: number, render?: boolean): void;
  /** 联系表用：某个单位当前的动作阶段和动作名 */
  phase(id: string): { phase: string; move: string | null };
  /** 联系表用：以某个单位当前的位置为中心、放大 zoom 倍画一帧，返回 PNG（data URL）。不推进时间 */
  shot(id: string, zoom: number, offsetX?: number, offsetY?: number): string;
  /** 联系表用：锁定机位（演出镜头的推近 / 平移不再移动镜头），出手者始终在画面里 */
  lockCamera(on: boolean): void;
}

declare global {
  interface Window {
    __skillDemo?: SkillDemoCheck;
  }
}

const STYLE_ID = 'skill-demo-style';
const CSS = `
.sd-panel { left:12px; bottom:12px; width:572px; padding:8px 10px; }
.sd-panel .dk-title { margin-bottom:4px; padding-bottom:4px; }
.sd-row { display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-top:4px; }
.sd-group { width:50px; font-size:12px; letter-spacing:1px; color:#a99a72; }
.sd-row .dk-btn { padding:3px 8px; font-size:13px; letter-spacing:0; }
.sd-row .dk-btn.is-on { color:#1a1408; background:#c9a85a; }
.sd-row .dk-btn:disabled { opacity:.55; cursor:default; }
.sd-note { min-height:17px; margin-top:6px; padding-top:5px; font-size:12px; line-height:1.35; color:#cdbf98; border-top:1px solid #4a3d24; }
.sd-stats { margin-top:3px; font-size:12px; line-height:1.4; color:#9fb6c9; white-space:pre-line; }
.sd-stats.bad { color:#ff8a70; }
`;

export class SkillDemoApp {
  private readonly scene: BattleScene;
  private readonly hud: BattleHud;
  private readonly uiRoot: HTMLDivElement;
  private readonly noteEl: HTMLDivElement;
  private readonly statsEl: HTMLDivElement;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly units = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES].map(snapshotOf);
  private readonly demos: SkillDemo[];
  private readonly check: SkillDemoCheck;
  private readonly tmp = new Vector3();
  private director: BattleDirector | null = null;
  private readonly summon: SummonCutscene;
  private readonly summonFx = new SummonFx();
  private summoning = false;
  private stopped = false;
  /** 正在统计的帧耗时（秒）；null = 没有在统计 */
  private frameTimes: number[] | null = null;
  private peakObjects = 0;
  private peakDrawCalls = 0;
  private updateMs: number[] = [];

  constructor(container: HTMLElement) {
    const query = new URLSearchParams(location.search);
    const settings = loadPageSettings();
    this.scene = new BattleScene(container, sceneOptionsOf(settings.value));
    const { scheduler, stage } = this.scene;
    const speed = Number(query.get('speed'));
    if (STAGING.speeds.includes(speed)) scheduler.setTimeScale(speed);
    if (query.get('skip') === '1') scheduler.setSkip(true);

    this.hud = new BattleHud({
      container,
      scheduler,
      project: (world) => this.scene.worldToScreen(world),
      headPosition: (id, out) => stage.unit(id).headPosition(out),
      ...hudSettingsAdapters(this.scene, settings),
    });
    this.scene.onFrame(() => {
      this.hud.update();
      if (this.frameTimes) {
        this.frameTimes.push(this.scene.lastFrameDt);
        this.peakObjects = Math.max(this.peakObjects, this.scene.fx.activeCount().objects);
        // 这两个数是上一帧的（本回调在渲染之前执行）
        this.peakDrawCalls = Math.max(this.peakDrawCalls, this.scene.lastDrawCalls);
        this.updateMs.push(this.scene.lastUpdateMs);
      }
    });

    this.demos = buildSkillDemos(this.units);
    this.scene.scene.add(this.summonFx.group);
    const boss = ENEMY_TEMPLATES.find((t) => t.rank === 'boss')!;
    this.summon = new SummonCutscene({
      stage,
      scheduler,
      fx: this.scene.fx,
      rig: this.scene.cameraRig,
      sound: this.scene.sound,
      summonFx: this.summonFx,
      bossId: boss.id,
    });

    injectTheme();
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.uiRoot = el('div', 'dk-ui');
    container.appendChild(this.uiRoot);
    const panel = el('div', 'dk-panel sd-panel');
    const list = el('div', 'sd-list');
    let group = '';
    let row = list;
    for (const demo of this.demos) {
      if (demo.group !== group) {
        group = demo.group;
        row = el('div', 'sd-row');
        row.append(el('span', 'sd-group', group));
        list.append(row);
      }
      const b = el('button', 'dk-btn', demo.label);
      b.type = 'button';
      b.title = demo.note;
      b.onclick = () => void this.play(demo.id);
      this.buttons.set(demo.id, b);
      row.append(b);
    }
    // 召唤演示（步骤 18）
    const summonRow = el('div', 'sd-row');
    summonRow.append(el('span', 'sd-group', '召唤'));
    for (const demo of SUMMON_DEMOS) {
      const b = el('button', 'dk-btn', demo.label);
      b.type = 'button';
      b.title = demo.note;
      b.onclick = () => void this.playSummon(demo.id);
      this.buttons.set(`summon:${demo.id}`, b);
      summonRow.append(b);
    }
    list.append(summonRow);
    this.noteEl = el('div', 'sd-note', '点上面的按钮单独播放一个技能的演出。右上角可切换 1× / 2× 和跳过动画。');
    this.statsEl = el('div', 'sd-stats');
    panel.append(el('div', 'dk-title', '技能演示'), list, this.noteEl, this.statsEl);
    this.uiRoot.append(panel);

    this.check = {
      ids: this.demos.map((d) => d.id),
      playing: null,
      results: [],
      play: (id) => this.play(id),
      fx: () => this.scene.fx.activeCount(),
      timeScale: (scale) => scheduler.setTimeScale(scale),
      manual: (on) => this.scene.setManual(on),
      step: (dt, render = true) => this.scene.stepFrame(dt, render),
      phase: (id) => {
        const m = stage.unit(id).motionSnapshot();
        return { phase: m.phase, move: m.move };
      },
      shot: (id, zoom, offsetX = 0, offsetY = 0) => this.shot(id, zoom, offsetX, offsetY),
      lockCamera: (on) => {
        this.scene.stage.camera.locked = on;
        if (on) this.scene.stage.camera.resetNow();
      },
    };
    window.__skillDemo = this.check;
  }

  start(): void {
    // 召唤用的材质副本和特效先编译一次，第一次播放不卡顿
    this.scene.stage.reset();
    this.scene.renderOnce();
    this.summon.prewarm(() => this.scene.renderOnce());
    this.scene.start();
    void this.reset().then(async () => {
      const query = new URLSearchParams(location.search);
      const first = query.get('play');
      if (query.get('all') === '1') {
        for (const demo of this.demos) {
          if (this.stopped) return;
          await this.play(demo.id);
        }
      } else if (first) await this.play(first);
      const summon = query.get('summon');
      if (summon && SUMMON_DEMOS.some((d) => d.id === summon)) await this.playSummon(summon as SummonStyle | 'all');
    });
  }

  dispose(): void {
    this.stopped = true;
    this.director?.dispose();
    this.uiRoot.remove();
    this.hud.dispose();
    this.scene.dispose();
  }

  /**
   * 联系表：把画面裁剪到以某个单位为中心的一块（放大 zoom 倍）并画一帧。
   * offsetX / offsetY 把取景框沿画面方向挪一点（占取景框宽 / 高的比例），让目标也在框内。
   */
  private shot(id: string, zoom: number, offsetX: number, offsetY: number): string {
    const { stage } = this.scene;
    this.scene.setCrop(null);
    const camera = this.scene.battleCamera.camera;
    camera.updateMatrixWorld(); // 上一帧没有画的话，相机矩阵还是旧的
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    const unit = stage.unit(id);
    const head = unit.headPosition(this.tmp);
    // 取站在地面时的身体中部（不跟着跳跃升高），这样联系表里看得出跳了多高
    head.y = (head.y - unit.airHeight) * 0.5;
    const p = this.scene.worldToScreen(head);
    const size = 1 / Math.max(1, zoom);
    const w = this.uiRoot.parentElement?.clientWidth || 1;
    const h = this.uiRoot.parentElement?.clientHeight || 1;
    const x = Math.min(1 - size, Math.max(0, p.x / w - size / 2 + offsetX * size));
    const y = Math.min(1 - size, Math.max(0, p.y / h - size / 2 + offsetY * size));
    this.scene.setCrop({ x, y, w: size, h: size });
    const png = this.scene.snapshot();
    this.scene.setCrop(null);
    return png;
  }

  /** 战场复位到满状态，换一个新的导演 */
  private async reset(): Promise<{ emit(events: BattleEventInput[]): void; director: BattleDirector }> {
    const { scheduler, stage } = this.scene;
    this.director?.dispose();
    stage.reset();
    this.hud.reset();
    const bus = new EventBus();
    const director = new BattleDirector(bus, stage, this.hud, scheduler, {
      skillName: (id) => DEMO_SKILLS[id]?.name ?? id,
      isBasicSkill: (id) => id.startsWith('basic_'),
    });
    this.director = director;
    let seq = 0;
    let turn = 1;
    const emit = (events: BattleEventInput[]): void => {
      for (const e of events) {
        if (e.type === 'TurnStart') turn += 1;
        bus.emit({ ...e, seq: (seq += 1), turn } as BattleEvent);
      }
    };
    emit([{ type: 'BattleStart', units: this.units }]);
    await director.idle();
    return { emit, director };
  }

  /**
   * 召唤演示（步骤 18）：战场复位后，把这一种小怪（或全部）藏起来再播放出场；“完整召唤”含 Boss 举臂和短吼。
   * 结束后显示绘制调用峰值与残留检查。
   */
  async playSummon(kind: SummonStyle | 'all'): Promise<void> {
    if (this.check.playing || this.summoning || this.stopped) return;
    const demo = SUMMON_DEMOS.find((d) => d.id === kind)!;
    const { scheduler, fx } = this.scene;
    this.summoning = true;
    this.check.playing = `summon:${kind}`;
    for (const [key, b] of this.buttons) {
      b.disabled = true;
      b.classList.toggle('is-on', key === `summon:${kind}`);
    }
    this.noteEl.textContent = `${demo.label}：${demo.note}`;
    this.statsEl.textContent = '';
    try {
      await this.reset();
      const ids = this.summon.minions.filter((v) => kind === 'all' || this.summon.styleOf(v) === kind).map((v) => v.id);
      this.summon.hide(ids);
      this.hud.setBattleOpacity(0); // 头顶条在出场时不挡画面
      await scheduler.nextFrame();
      this.peakDrawCalls = 0;
      const idleDrawCalls = this.scene.lastDrawCalls;
      this.frameTimes = [];
      const full = kind === 'all';
      await this.summon.play({ ids, cast: full, roar: full });
      this.frameTimes = null;
      this.hud.setBattleOpacity(1);
      for (let i = 0; i < 400 && fx.activeCount().particles + fx.activeCount().objects > 0; i++) await scheduler.nextFrame();
      const left = fx.activeCount().objects + fx.activeCount().particles + this.summonFx.activeCount;
      const bad = left > 0 || this.summon.shadedUnits().length > 0 || this.summon.unrestoredUnits().length > 0;
      this.statsEl.textContent = [
        `绘制调用 ${idleDrawCalls} → 峰值 ${this.peakDrawCalls}`,
        `结束后残留特效 ${left} · 未换回原材质 ${this.summon.shadedUnits().length} · 部件未复位 ${this.summon.unrestoredUnits().length}`,
      ].join('\n');
      this.statsEl.classList.toggle('bad', bad);
    } finally {
      this.frameTimes = null;
      this.summoning = false;
      this.check.playing = null;
      for (const b of this.buttons.values()) b.disabled = false;
    }
  }

  /** 播放一个演示；正在播放别的演示时忽略 */
  async play(id: string): Promise<DemoResult | null> {
    const demo = this.demos.find((d) => d.id === id);
    if (!demo || this.check.playing || this.summoning || this.stopped) return null;
    const { scheduler, stage, fx } = this.scene;
    this.check.playing = id;
    for (const [key, b] of this.buttons) {
      b.disabled = true;
      b.classList.toggle('is-on', key === id);
    }
    this.noteEl.textContent = `${demo.label}：${demo.note}`;
    this.statsEl.textContent = '';

    const { emit, director } = await this.reset();
    // 铺垫事件瞬间演完
    if (demo.setup.length > 0) {
      const wasSkipping = scheduler.skip;
      scheduler.setSkip(true);
      emit(demo.setup);
      await director.idle();
      await scheduler.nextFrame(); // 让铺垫产生的飘字在跳过状态下被清掉
      scheduler.setSkip(wasSkipping);
    }
    await scheduler.nextFrame();
    await scheduler.nextFrame();

    // 正式演示：统计这段时间的帧耗时
    fx.particles.peak = 0;
    this.peakObjects = 0;
    this.peakDrawCalls = 0;
    this.updateMs = [];
    const idleDrawCalls = this.scene.lastDrawCalls;
    this.frameTimes = [];
    emit(demo.events);
    await director.idle();
    const times = this.frameTimes;
    this.frameTimes = null;

    // 核对：头顶条数值与脚本一致、没有单位留在站位之外
    const expected = new Map(this.units.map((u) => [u.id, u.hp]));
    for (const e of [...demo.setup, ...demo.events]) {
      if (e.type === 'HitResolved' || e.type === 'HealResolved') expected.set(e.targetId, e.hpAfter);
      else if (e.type === 'UnitRevived') expected.set(e.unitId, e.hpAfter);
    }
    const hpMismatches: string[] = [];
    for (const [unitId, hp] of expected) {
      const shown = this.hud.targetHp(unitId);
      if (shown !== hp) hpMismatches.push(`${unitId} 界面 ${shown} / 脚本 ${hp}`);
    }

    // 等粒子自然散尽（最多 3 秒演出时间），再看有没有残留
    for (let i = 0; i < 400 && fx.activeCount().particles + fx.activeCount().objects + fx.activeCount().trails > 0; i++) {
      await scheduler.nextFrame();
    }

    const sorted = [...times].sort((a, b) => b - a);
    const seconds = times.reduce((sum, t) => sum + t, 0);
    const worst1 = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 100)));
    const result: DemoResult = {
      id,
      frames: times.length,
      seconds,
      avgFps: times.length > 0 && seconds > 0 ? times.length / seconds : 0,
      minFps: sorted[0] ? 1 / sorted[0] : 0,
      low1Fps: worst1.length / (worst1.reduce((sum, t) => sum + t, 0) || 1),
      peakParticles: fx.particles.peak,
      peakObjects: this.peakObjects,
      pooledObjects: fx.pooledCount(),
      idleDrawCalls,
      peakDrawCalls: this.peakDrawCalls,
      avgUpdateMs: this.updateMs.reduce((sum, t) => sum + t, 0) / Math.max(1, this.updateMs.length),
      maxUpdateMs: Math.max(0, ...this.updateMs),
      hpMismatches,
      displaced: stage.unitsAway(),
      concurrentActions: director.stats.concurrentActions,
      leftover: fx.activeCount(),
    };
    this.check.results.push(result);
    this.showResult(result);

    this.check.playing = null;
    for (const b of this.buttons.values()) b.disabled = false;
    return result;
  }

  private showResult(r: DemoResult): void {
    const left = r.leftover.objects + r.leftover.particles + r.leftover.trails;
    const bad = left > 0 || r.hpMismatches.length > 0 || r.displaced.length > 0 || r.concurrentActions > 0;
    const lines = [
      r.frames > 2
        ? `帧率 平均 ${r.avgFps.toFixed(0)} · 最低 ${r.minFps.toFixed(0)}（${r.frames} 帧 / ${r.seconds.toFixed(1)} 秒） · 粒子峰值 ${r.peakParticles} · 特效对象峰值 ${r.peakObjects}`
        : '已跳过动画',
      `绘制调用 ${r.idleDrawCalls} → 峰值 ${r.peakDrawCalls} · 每帧逻辑耗时 平均 ${r.avgUpdateMs.toFixed(2)} ms / 最大 ${r.maxUpdateMs.toFixed(2)} ms`,
      `结束后残留特效 ${left} · 数值不一致 ${r.hpMismatches.length} · 未归位 ${r.displaced.length}`,
    ];
    this.statsEl.textContent = lines.join('\n');
    this.statsEl.classList.toggle('bad', bad);
  }
}

// 玩家战斗页面：把逻辑引擎、三维场景、演出导演、头顶条和指令界面装配在一起。
// 玩家亲自指挥 5 个人物（宝宝按设置自动或手动）；一场打完后可以“再战一次”。
//
// 步骤 12：
// - 画面固定 16:10（ui/layout/Viewport）：画布和所有界面都在舞台里，整体等比缩放、居中，窗口多出来的部分是黑边。
// - 页面打开先显示标题界面（背景是压暗的战场）；点“开始游戏”进入战斗（同时解锁音频）。
// - 右上角齿轮 / Esc 打开设置菜单：分辨率、画质、音量、静音，战斗中还有“重新开始”“退出游戏”。
//   菜单打开时战斗暂停（演出时间、待机动画、特效、战斗音效都停住），键盘快捷键不触发战斗指令。
// - 设置保存在本地存储（ui/settings/settingsStore），地址参数优先。
//
// 地址参数：
//   seed=数字   随机种子（相同种子、相同指令战斗过程完全相同）；不填则用当前时间
//   speed=2     初始战斗速度
//   skip=1      一开始就跳过动画
//   pet=auto    宝宝一开始就自动出手
//   quality=low / high、res=1920x1200 / fit、mute=1 / 0   临时覆盖保存的设置（不写回）
//   start=1     跳过标题界面，直接开始战斗（自检用）

import { Vector3 } from 'three';
import { BattleEngine } from '../core/battle';
import { DEFAULT_SETTINGS } from '../data/battleConfig';
import { createDefaultSetup } from '../data/defaultSetup';
import { STAGING } from '../data/presentationConfig';
import { QUALITY_CONFIG } from '../data/renderConfig';
import { SKILLS } from '../data/skills';
import { BattleScene } from '../render/BattleScene';
import { BattleDirector } from '../render/director/BattleDirector';
import type { BattleCheck } from './AutoBattleController';
import type { CommandSession } from './command/CommandSession';
import { BattleHud } from './hud/BattleHud';
import { TargetingInput } from './input/TargetingInput';
import { Viewport } from './layout/Viewport';
import type { ViewportLayout } from './layout/viewportMath';
import { CommandPanel } from './panels/CommandPanel';
import { drainMatch } from './matchLifecycle';
import { LogPanel } from './panels/LogPanel';
import { ResultPanel } from './panels/ResultPanel';
import { SettingsBar } from './panels/SettingsBar';
import { PlayerBattleController } from './PlayerBattleController';
import { createGearIcon } from './settings/gearIcon';
import { SettingsMenu } from './settings/SettingsMenu';
import { browserStorage, SettingsStore, type GameSettings } from './settings/settingsStore';
import { el, injectTheme } from './theme';
import { TitleScreen } from './title/TitleScreen';

/** 页面处在哪个界面 */
export type AppScreen = 'title' | 'battle';

/** 调试 / 自检用（window.__player） */
export interface PlayerDebug {
  seed: number;
  matches: number; // 已开始的场次（再战一次 / 重新开始后加一）
  check: BattleCheck;
  engine: BattleEngine;
  session: CommandSession;
  logLines(): number;
  resultVisible(): boolean;
  /** 立刻再战一次（自检用：连续开很多场，看内存是否持续增长） */
  rematch(): Promise<void>;
}

/** 页面级自检（window.__app）：界面状态、设置、暂停、渲染尺寸、场上残留 */
export interface AppDebug {
  screen(): AppScreen;
  menuOpen(): boolean;
  paused(): boolean;
  settings(): Readonly<GameSettings>;
  layout(): Readonly<ViewportLayout>;
  renderSize(): { width: number; height: number };
  /** 开始游戏 / 重新开始 / 退出到标题（与点按钮相同，但不经过确认框） */
  start(): Promise<void>;
  restart(): Promise<void>;
  exit(): Promise<void>;
  /** 演出时间（暂停时不变） */
  clock(): number;
  /** 某单位身体中部在窗口里的坐标（鼠标选目标自检用：已含黑边和缩放） */
  unitClient(id: string): { x: number; y: number };
  /** 场上残留检查：离开站位的单位、进行中的动画、飘字数量、特效数量 */
  residue(): {
    away: string[];
    pending: number;
    floaters: number;
    fx: { objects: number; particles: number; trails: number };
    pooled: number;
    logLines: number;
    resultVisible: boolean;
  };
}

declare global {
  interface Window {
    __player?: PlayerDebug;
    __app?: AppDebug;
  }
}

/** 一场战斗用到的对象；再战一次时整组换新 */
interface Match {
  engine: BattleEngine;
  director: BattleDirector;
  controller: PlayerBattleController;
  panel: CommandPanel;
  targeting: TargetingInput;
}

export class PlayerBattleApp {
  private readonly store: SettingsStore;
  private readonly viewport: Viewport;
  private readonly scene: BattleScene;
  private readonly hud: BattleHud;
  private readonly uiRoot: HTMLDivElement;
  private readonly menuLayer: HTMLDivElement;
  private readonly gear: HTMLButtonElement;
  private readonly log: LogPanel;
  private readonly petBar: SettingsBar;
  private readonly result: ResultPanel;
  private readonly menu: SettingsMenu;
  private readonly title: TitleScreen;
  private readonly unsubscribeStore: () => void;
  private match: Match | null = null;
  private seed: number;
  private matches = 0;
  private screen: AppScreen = 'title';
  /** 正在拆掉上一场（重新开始 / 退出 / 再战一次进行中）：期间忽略重复操作 */
  private busy = false;
  /** 玩家的偏好：再战一次时保留 */
  private petAuto: boolean;
  private readonly autoStart: boolean;

  constructor(container: HTMLElement) {
    const query = new URLSearchParams(location.search);
    const seedParam = Number(query.get('seed'));
    this.seed = query.has('seed') && Number.isFinite(seedParam) ? seedParam >>> 0 : Date.now() >>> 0;
    this.petAuto = query.has('pet') ? query.get('pet') === 'auto' : DEFAULT_SETTINGS.petAutoCommand;
    this.autoStart = query.get('start') === '1';

    // 设置：本地存储 + 地址参数覆盖
    this.store = new SettingsStore(browserStorage(), query);
    const s = this.store.value;

    // 固定 16:10 的舞台：画布和所有界面都放在里面
    this.viewport = new Viewport(container, (layout) => this.scene?.setViewport(layout));
    this.viewport.setMaxPixelRatio(s.lowQuality ? QUALITY_CONFIG.low.maxPixelRatio : QUALITY_CONFIG.maxPixelRatio);
    this.viewport.setResolution(s.resolution);
    const stageEl = this.viewport.stage;

    this.scene = new BattleScene(stageEl, {
      lowQuality: s.lowQuality,
      audio: { volume: s.master, sfx: s.sfx, ambient: s.ambient, muted: s.muted },
    });
    this.scene.setViewport(this.viewport.layout);
    const { scheduler, stage, sound } = this.scene;
    const speed = Number(query.get('speed'));
    if (STAGING.speeds.includes(speed)) scheduler.setTimeScale(speed);
    if (query.get('skip') === '1') scheduler.setSkip(true);

    this.hud = new BattleHud({
      container: stageEl,
      scheduler,
      project: (world) => this.scene.worldToScreen(world),
      headPosition: (id, out) => stage.unit(id).headPosition(out),
      // 按 M 静音也走设置（保存、刷新菜单）
      sound: {
        get volume() {
          return sound.volume;
        },
        get muted() {
          return sound.muted;
        },
        supported: sound.supported,
        setVolume: (v) => this.store.set('master', v),
        setMuted: (m) => this.store.set('muted', m),
        play: (name) => sound.play(name),
      },
      settingsMenu: true,
    });
    this.scene.onFrame(() => this.hud.update());

    injectTheme();
    this.uiRoot = el('div', 'dk-ui');
    stageEl.appendChild(this.uiRoot);
    this.log = new LogPanel(this.uiRoot);
    this.petBar = new SettingsBar({
      root: this.uiRoot,
      petAuto: this.petAuto,
      onPetAuto: (on) => {
        this.petAuto = on;
        return this.match?.controller.setPetAuto(on) ?? false;
      },
    });
    this.result = new ResultPanel(this.uiRoot, () => void this.rematch());

    // 菜单层：齿轮按钮、设置面板、标题界面。挡住的鼠标事件不再往下传到战场
    this.menuLayer = el('div', 'dk-menu-layer');
    for (const type of ['click', 'pointermove', 'pointerdown', 'contextmenu'] as const) {
      this.menuLayer.addEventListener(type, (e) => {
        if (e.target !== this.menuLayer) e.stopPropagation();
      });
    }
    stageEl.appendChild(this.menuLayer);
    this.title = new TitleScreen({
      root: this.menuLayer,
      onStart: () => void this.startGame(),
      onSettings: () => this.menu.open('title'),
    });
    this.gear = el('button', 'dk-btn dk-gear');
    this.gear.type = 'button';
    this.gear.title = '设置（Esc）';
    this.gear.append(createGearIcon());
    this.gear.onclick = () => this.menu.open('battle');
    this.menuLayer.append(this.gear);
    this.menu = new SettingsMenu({
      root: this.menuLayer,
      store: this.store,
      soundSupported: sound.supported,
      preview: (channel) => sound.preview(channel),
      onOpenChange: (open) => this.onMenuOpenChange(open),
      onRestart: () => void this.restart(),
      onExit: () => void this.exitToTitle(),
    });
    this.unsubscribeStore = this.store.onChange((value, key) => this.applySetting(value, key));
    addEventListener('keydown', this.onKeyCapture, true);

    this.installDebug();
  }

  start(): void {
    this.scene.start();
    if (this.autoStart) void this.startGame();
    else this.showTitle();
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyCapture, true);
    this.unsubscribeStore();
    this.endMatch();
    this.menu.dispose();
    this.title.dispose();
    this.menuLayer.remove();
    this.result.dispose();
    this.petBar.dispose();
    this.log.dispose();
    this.uiRoot.remove();
    this.hud.dispose();
    this.scene.dispose();
    this.viewport.dispose();
  }

  // ------------------------------------------------------------------
  // 界面切换
  // ------------------------------------------------------------------

  private showTitle(): void {
    this.screen = 'title';
    this.title.show();
    this.gear.classList.add('is-hidden');
    this.uiRoot.style.display = 'none';
    this.hud.setControlsVisible(false);
  }

  /** 标题界面点“开始游戏”：解锁音频（浏览器自动播放限制），进入战斗 */
  async startGame(): Promise<void> {
    if (this.busy || this.screen === 'battle') return;
    this.scene.sound.unlock();
    this.menu.close();
    this.title.hide();
    this.gear.classList.remove('is-hidden');
    this.uiRoot.style.display = '';
    this.hud.setControlsVisible(true);
    this.screen = 'battle';
    this.startMatch();
  }

  /** 设置里“重新开始”：放弃当前战斗，状态完全重置后重开一局（同“再战一次”） */
  async restart(): Promise<void> {
    if (this.screen !== 'battle') return;
    await this.rematch();
  }

  /** 设置里“退出游戏”：结束当前战斗，场上复位，回到标题界面 */
  async exitToTitle(): Promise<void> {
    if (this.busy || this.screen !== 'battle') return;
    this.busy = true;
    try {
      await this.teardown();
      this.showTitle();
    } finally {
      this.busy = false;
    }
  }

  /** 再战一次：丢弃上一场的全部状态，场上单位、头顶条、日志、统计全部重置 */
  async rematch(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.teardown();
      // 换一个种子，新的一场不会和上一场一模一样
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      this.startMatch();
    } finally {
      this.busy = false;
    }
  }

  // ------------------------------------------------------------------
  // 设置与暂停
  // ------------------------------------------------------------------

  private onMenuOpenChange(open: boolean): void {
    // 只在战斗中暂停；标题界面上打开设置时背景里的待机动画照常
    this.scene.setPaused(open && this.screen === 'battle');
  }

  /** 设置变化后立即生效（不重开战斗） */
  private applySetting(s: Readonly<GameSettings>, key: keyof GameSettings): void {
    const { sound } = this.scene;
    switch (key) {
      case 'resolution':
        this.viewport.setResolution(s.resolution);
        break;
      case 'lowQuality':
        this.scene.setLowQuality(s.lowQuality);
        this.viewport.setMaxPixelRatio(s.lowQuality ? QUALITY_CONFIG.low.maxPixelRatio : QUALITY_CONFIG.maxPixelRatio);
        break;
      case 'master':
        sound.setVolume(s.master);
        break;
      case 'sfx':
        sound.setSfxVolume(s.sfx);
        break;
      case 'ambient':
        sound.setAmbientVolume(s.ambient);
        break;
      case 'muted':
        sound.setMuted(s.muted);
        break;
    }
  }

  /**
   * 键盘总闸（捕获阶段，先于其他快捷键）：
   * - Esc：菜单打开时关闭菜单（或取消确认框）；选目标 / 技能列表里交给指令面板当“返回”；其余情况打开菜单。
   * - 菜单打开时，其他按键一律不往下传（A / W / D、1 / 2、S、M 等都不触发）；滑块、下拉框的方向键照常可用。
   */
  private readonly onKeyCapture = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (this.menu.escape()) {
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      if (this.busy) return;
      const mode = this.match?.controller.session.mode;
      if (this.screen === 'battle' && (mode === 'target' || mode === 'skills')) return;
      this.menu.open(this.screen === 'title' ? 'title' : 'battle');
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if (this.menu.isOpen || this.screen === 'title' || this.busy) e.stopImmediatePropagation();
  };

  // ------------------------------------------------------------------
  // 一场战斗
  // ------------------------------------------------------------------

  /**
   * 拆掉当前这一场：停掉流程和输入，让还没演完的那一段演出立即走完（打开“跳过动画”），
   * 再把场上单位、特效、镜头、头顶条、日志、结算全部复位。中途重开 / 退出时不会留下残影。
   */
  private async teardown(): Promise<void> {
    const m = this.match;
    this.match = null;
    this.menu.close(false);
    this.scene.setPaused(false);
    if (m) {
      m.targeting.dispose();
      m.panel.dispose();
      // 跳过动画下所有等待立即完成：正在播的那次出手几个微任务内就演完
      await drainMatch(m, this.scene.scheduler);
    }
    this.scene.stage.reset();
    this.hud.reset();
    this.log.clear();
    this.result.hide();
  }

  /** 停掉当前这一场的流程和输入（不等演出；页面关闭时用） */
  private endMatch(): void {
    const m = this.match;
    if (!m) return;
    this.match = null;
    m.controller.stop();
    m.director.dispose();
    m.targeting.dispose();
    m.panel.dispose();
  }

  private startMatch(): void {
    const { scheduler, stage, rings } = this.scene;
    const engine = new BattleEngine(createDefaultSetup(this.seed, { petAutoCommand: this.petAuto }));
    const director = new BattleDirector(engine.events, stage, this.hud, scheduler, {
      skillName: (id) => SKILLS[id]?.name ?? id,
      isBasicSkill: (id) => SKILLS[id]?.classId === 'common',
    });

    // 控制器、面板、鼠标输入互相引用：回调里通过 match 取对象
    const controller = new PlayerBattleController({
      engine,
      skills: SKILLS,
      idle: () => director.idle(),
      nextFrame: () => scheduler.nextFrame(),
      petAuto: this.petAuto,
      onPhase: (phase, turn) => {
        if (phase === 'command') this.petBar.clearNote();
        this.match?.panel.setPhase(phase, turn);
      },
      onSessionChange: () => {
        this.match?.panel.render();
        this.match?.targeting.sync();
      },
      onNotice: (notice) => this.match?.panel.notice(notice),
      onLog: (lines) => this.log.append(lines),
      onResult: (summary) => this.result.show(summary),
      verify: (check) => this.verify(engine, director, check),
    });
    const unitName = (id: string): string => engine.getState().units[id]?.name ?? id;
    const panel = new CommandPanel({ root: this.uiRoot, session: controller.session, unitName });
    const targeting = new TargetingInput({
      container: this.viewport.stage,
      session: controller.session,
      getState: () => engine.getState(),
      project: (world) => this.scene.worldToScreen(world),
      footPosition: (id, out: Vector3) => {
        const home = stage.unit(id).home;
        return out.set(home.x, 0, home.z);
      },
      headPosition: (id, out) => stage.unit(id).headPosition(out),
      setRings: (marks) => rings.set(marks),
      setHeadMarks: (marks) => this.hud.setMarks(marks),
    });
    const match: Match = { engine, director, controller, panel, targeting };
    this.match = match;

    this.matches += 1;
    window.__player = {
      seed: this.seed,
      matches: this.matches,
      check: controller.check,
      engine,
      session: controller.session,
      logLines: () => this.log.lineCount,
      resultVisible: () => this.result.visible,
      rematch: () => this.rematch(),
    };

    controller.run().catch((err: unknown) => {
      // 已经被拆掉的旧一场不再报错
      if (this.match === match) console.error('战斗中断：', err);
    });
  }

  /** 演出追上逻辑之后，核对头顶条数值与逻辑层状态是否一致、有没有单位留在站位之外 */
  private verify(engine: BattleEngine, director: BattleDirector, c: BattleCheck): void {
    const state = engine.getState();
    c.actions = director.stats.actions;
    c.concurrentActions = director.stats.concurrentActions;
    for (const id of state.unitIds) {
      const u = state.units[id]!;
      const hp = this.hud.targetHp(id);
      const mp = this.hud.targetMp(id);
      if (hp !== u.hp) c.hpMismatches.push(`#${director.stats.lastSeq} ${id} 气血 界面 ${hp} / 逻辑 ${u.hp}`);
      if (mp !== u.mp) c.hpMismatches.push(`#${director.stats.lastSeq} ${id} 魔法 界面 ${mp} / 逻辑 ${u.mp}`);
    }
    const away = this.scene.stage.unitsAway();
    if (away.length > 0) c.displaced.push(`#${director.stats.lastSeq} ${away.join(',')}`);
  }

  private installDebug(): void {
    window.__app = {
      screen: () => this.screen,
      menuOpen: () => this.menu.isOpen,
      paused: () => this.scene.paused,
      settings: () => this.store.value,
      layout: () => this.viewport.layout,
      renderSize: () => this.scene.renderSize,
      start: () => this.startGame(),
      restart: () => this.restart(),
      exit: () => this.exitToTitle(),
      clock: () => this.scene.scheduler.time,
      unitClient: (id) => {
        const unit = this.scene.stage.unit(id);
        const head = this.scene.worldToScreen(unit.headPosition(new Vector3()));
        const foot = this.scene.worldToScreen(new Vector3(unit.home.x, 0, unit.home.z));
        const l = this.viewport.layout;
        return { x: l.left + ((head.x + foot.x) / 2) * l.scale, y: l.top + ((head.y + foot.y) / 2) * l.scale };
      },
      residue: () => ({
        away: this.scene.stage.unitsAway(),
        pending: this.scene.scheduler.pending,
        floaters: this.hud.floaterCount,
        fx: this.scene.fx.activeCount(),
        pooled: this.scene.fx.pooledCount(),
        logLines: this.log.lineCount,
        resultVisible: this.result.visible,
      }),
    };
  }
}

// 玩家战斗页面：把逻辑引擎、三维场景、演出导演、头顶条和指令界面装配在一起。
// 玩家亲自指挥 5 个人物（宝宝按设置自动或手动）；一场打完后可以“再战一次”。
//
// 步骤 12：
// - 画面固定 16:10（ui/layout/Viewport）：画布和所有界面都在舞台里，整体等比缩放、居中，窗口多出来的部分是黑边。
// - 页面打开先显示标题界面（背景是压暗的战场）；点“开始游戏”时解锁音频。
// - 右上角齿轮 / Esc 打开设置菜单：分辨率、画质、音量、静音，战斗中还有“重新开始”“退出游戏”。
//   菜单打开时战斗暂停（演出时间、待机动画、特效、战斗音效都停住），键盘快捷键不触发战斗指令。
// - 设置保存在本地存储（ui/settings/settingsStore），地址参数优先。
//
// 步骤 14：
// - “开始游戏”进入探索模式（render/explore/ExploreStage）：只显示 5 名人物和 Boss，人物在右下方出生点列队，
//   相机跟随队长；头顶条、顺序条、指令面板都不显示。标题界面的背景也是这个布置。
// - 方向键 / WASD 让队长直线行走（临时调试，步骤 15 换成点击移动），Tab 切换被控制的人物（调试）。
// - 设置菜单在探索中同样暂停，“重新开始”改为“回到起点”。
// - 探索还不能进入战斗（对话、过场在步骤 16、17）；地址加 start=1 仍可跳过标题直接开战（自检用）。
//
// 步骤 16：
// - 点击 Boss：队长跑到 Boss 正前方的交谈点（exploreConfig.talkDistance），停下后面向 Boss，弹出对话框（ui/dialog/DialogBox）；
//   跑过去的途中点地面 = 取消。对话内容在 data/dialogues.ts，进度在 explore/dialogueSession.ts。
// - 对话中禁止点击移动和方向键；镜头注视点移到队长与 Boss 之间并略微拉近；说话人做小动作（骑士举刀指向 Boss、Boss 仰头张翼狂笑）。
// - 点击 / 空格：先显示整句，再下一句；最后显示选项（热键 1 / 2）。Esc = “再等等”。设置菜单（齿轮）照常可开，打开时对话停住。
// - “我准备好了”：关闭对话框，发出“进入战斗”信号——本步直接进入现有的战斗流程（入场过场在步骤 17、18）；
//   “再等等”：关闭对话框，回到自由移动。
//
// 步骤 17：
// - “我准备好了”之后播放入场过场（render/cutscene/introCutscene）：队员从队长的影子里显形 → Boss 怒吼、跺地 →
//   我方 5 人被震飞、落到战斗格子 → 宝宝跳入 → 相机过渡到战斗视角；过场结束才建引擎、开第 1 回合，头顶条、顺序条、界面淡入。
//   过场中可开设置（暂停）、切倍速、跳过动画；设置里“重新开始”= 跳过过场直接开战，“退出游戏”= 立即走完过场后回到标题。
// - 新阵型：人物在前排（骑士烬刃居中），宝宝在主人身后一排（data/heroes.ts 的 ALLY_LINEUP）。
//
// 地址参数：
//   seed=数字   随机种子（相同种子、相同指令战斗过程完全相同）；不填则用当前时间
//   speed=2     初始战斗速度
//   skip=1      一开始就跳过动画
//   pet=auto    宝宝一开始就自动出手
//   quality=low / high、res=1920x1200 / fit、mute=1 / 0   临时覆盖保存的设置（不写回）
//   start=1     跳过标题界面和探索，直接开始战斗（自检用）

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
import { ExploreInput } from './explore/ExploreInput';
import { ExplorePointer } from './explore/ExplorePointer';
import { screenBoxOf, type ScreenBox } from './input/picking';
import { ExploreStage, type ExploreSnapshot } from '../render/explore/ExploreStage';
import type { Obstacle } from '../explore/collision';
import type { Bounds } from '../explore/walker';
import { ALLY_TEMPLATES } from '../data/heroes';
import { ENEMY_TEMPLATES } from '../data/enemies';
import type { MenuContext } from './settings/SettingsMenu';
import { BOSS_DIALOGUE_ID, DIALOGUE_EMOTES, DIALOGUES, type DialogueAction } from '../data/dialogues';
import { EXPLORE_CONFIG } from '../data/exploreConfig';
import { DialogueSession } from '../explore/dialogueSession';
import { DialogBox } from './dialog/DialogBox';
import { IntroCutscene, type IntroPlan, type IntroReport } from '../render/cutscene/introCutscene';
import { IntroFx } from '../render/cutscene/introFx';
import { INTRO_CONFIG } from '../data/cutsceneConfig';

/** 页面处在哪个界面 */
export type AppScreen = 'title' | 'explore' | 'dialog' | 'intro' | 'battle';

/** 调试：对话的状态（window.__app.dialog()） */
export interface DialogSnapshot {
  open: boolean;
  line: number;
  speaker: string;
  name: string;
  aside: string;
  text: string;
  complete: boolean;
  choices: string[] | null;
}

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
  /** 开始游戏（进入探索）/ 重新开始（探索中 = 回到起点）/ 退出到标题（与点按钮相同，但不经过确认框） */
  start(): Promise<void>;
  restart(): Promise<void>;
  exit(): Promise<void>;
  /** 自检：跳过探索直接开战（同地址参数 start=1） */
  battle(): Promise<void>;
  /** 探索模式的状态：队长位置、朝向、速度、行走权重，终点与路径，显示的单位，Boss 悬停，相机注视点 */
  explore(): ExploreSnapshot;
  /** 自检 / 联系表：代替方向键给出跑动方向（地面向量，0 = 停下） */
  exploreMove(x: number, z: number): void;
  /** 自检：代替鼠标点地面（世界坐标）；返回实际要去的终点，没有可去的地方返回 null */
  exploreClick(x: number, z: number): { x: number; z: number; exact: boolean } | null;
  /** 自检：地面上某点在窗口里的坐标（已含黑边和缩放），用来模拟真实的鼠标点击 */
  groundClient(x: number, z: number): { x: number; y: number };
  /** 自检 / 路线图：探索的障碍物（碰撞用的圆和胶囊）、可走边界、单位碰撞半径 */
  exploreWorld(): { obstacles: readonly Obstacle[]; bounds: Bounds; unitRadius: number };
  /** 对话（步骤 16）：当前状态；代替点击推进；代替点选项；代替点 Boss（返回要去的交谈点，没有返回 null） */
  dialog(): DialogSnapshot;
  dialogAdvance(): void;
  dialogChoose(index: number): void;
  clickBoss(): { x: number; z: number } | null;
  /** 入场过场（步骤 17）：是否在播、这一次的走位、上一次的检查结果、残留 */
  intro(): { active: boolean; plan: IntroPlan | null; report: IntroReport | null; shaded: string[]; fx: number; hudOpacity: number };
  /** 验收：把队长放到 (x, z)、面向 Boss，直接开始入场过场（代替“我准备好了”）；返回过场结束的 Promise */
  introFrom(x: number, z: number): Promise<void>;
  /** 演出时间（暂停时不变） */
  clock(): number;
  /** 联系表：停掉自动渲染改为手动逐帧推进（manual），推进 seconds 秒（每帧 dt），取当前画面（PNG data URL） */
  manual(on: boolean): void;
  step(seconds: number, dt?: number): void;
  shot(): string;
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
  /** 探索模式（步骤 14、15）：场景布置、方向键（调试）与鼠标输入、操作提示 */
  private readonly explore: ExploreStage;
  private readonly exploreInput: ExploreInput;
  private readonly explorePointer: ExplorePointer;
  private readonly exploreHint: HTMLDivElement;
  /** 与 Boss 的对话（步骤 16）：对话框与当前进度（没在对话为 null） */
  private readonly dialogBox: DialogBox;
  private dialogue: DialogueSession | null = null;
  /** 入场过场（步骤 17）与它自己的地面特效；introRun = 正在播放的那一次 */
  private readonly introFx: IntroFx;
  private readonly intro: IntroCutscene;
  private introRun: Promise<unknown> | null = null;
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
    this.gear.onclick = () => this.menu.open(this.menuContext());
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

    // 探索模式：同一个场景、同一批单位，按模式切换布置；每帧在单位摆姿态之前推进移动
    this.explore = new ExploreStage(stage, this.scene.battleCamera, [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES], this.scene.scene);
    this.scene.onUpdate((dt) => this.explore.update(dt));
    this.exploreInput = new ExploreInput((x, z) => this.explore.setInput(x, z));
    // 鼠标：左键点地面跑过去，点到 Boss 按 Boss 脚下处理；悬停 Boss 高亮（步骤 15）
    this.explorePointer = new ExplorePointer({
      container: stageEl,
      enabled: () => this.screen === 'explore' && !this.menu.isOpen && !this.busy,
      groundAt: (x, y) => this.scene.groundAt(x, y),
      bossBox: () => this.bossScreenBox(),
      onGround: (x, z) => void this.explore.clickGround(x, z),
      onBoss: () => void this.explore.clickBoss(), // 跑到交谈点，到了弹出对话框（步骤 16）
      onBossHover: (on) => this.explore.setBossHover(on),
    });
    this.exploreHint = el('div', 'dk-explore-hint', '左键：移动　点击 Boss：对话　方向键 / WASD：移动（调试）　Esc：设置');
    this.exploreHint.style.cssText =
      'position:absolute;left:50%;bottom:22px;transform:translateX(-50%);padding:6px 16px;pointer-events:none;' +
      'font-size:15px;letter-spacing:1px;color:rgba(222,206,170,0.82);background:rgba(10,8,8,0.55);' +
      'border:1px solid rgba(150,120,70,0.35);border-radius:3px;white-space:nowrap;display:none;';
    stageEl.insertBefore(this.exploreHint, this.menuLayer); // 在菜单层下面

    // 对话（步骤 16）：到达交谈点后弹出；逐字显示用场景时间（设置菜单打开时暂停，台词也停住）
    this.dialogBox = new DialogBox({
      root: stageEl,
      onAdvance: () => this.advanceDialog(),
      onChoose: (i) => this.chooseDialog(i),
    });
    this.explore.onTalk = () => this.openDialog();

    // 入场过场（步骤 17）：地面特效常驻场景（不用时隐藏）；启动时预热显形用的着色器，第一次过场不卡顿
    this.introFx = new IntroFx();
    this.scene.scene.add(this.introFx.group);
    this.intro = new IntroCutscene({
      stage,
      scheduler,
      camera: this.scene.battleCamera,
      rig: this.scene.cameraRig,
      fx: this.scene.fx,
      sound,
      introFx: this.introFx,
      world: this.explore.world,
      leaderId: this.explore.leaderId,
      bossId: this.explore.bossId,
    });
    this.scene.onUpdate((dt) => {
      if (!this.dialogue) return;
      this.dialogue.update(dt);
      this.dialogBox.render();
    });

    addEventListener('keydown', this.onKeyCapture, true);
    addEventListener('keyup', this.onKeyUpCapture, true);
    addEventListener('blur', this.onBlur);

    this.installDebug();
  }

  start(): void {
    this.prewarm();
    this.scene.start();
    if (this.autoStart) void this.startBattle();
    else this.showTitle();
  }

  dispose(): void {
    removeEventListener('keydown', this.onKeyCapture, true);
    removeEventListener('keyup', this.onKeyUpCapture, true);
    removeEventListener('blur', this.onBlur);
    this.explorePointer.dispose();
    this.dialogBox.dispose();
    this.explore.dispose();
    this.exploreHint.remove();
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

  /**
   * 启动预热（步骤 17）：用战斗视角、20 个单位全部显示的状态画一帧，再换上显形用的材质副本画一帧，
   * 把所有着色器（含阴影、半透明）提前编译好。否则入场过场里镜头从对话视角拉到战斗视角时，
   * 大量第一次进入画面的物体逐帧编译着色器（实测每帧卡 4~5 秒，演出时钟几乎停住）。
   */
  private prewarm(): void {
    const { stage } = this.scene;
    stage.reset(); // 全部显示、回到格子
    this.scene.battleCamera.setFrame(null);
    this.scene.renderOnce();
    this.intro.prewarm(() => this.scene.renderOnce());
  }

  /** 探索中 Boss 在屏幕上的可点范围（与战斗选目标同一套拾取，步骤 15） */
  private bossScreenBox(): ScreenBox | null {
    const id = this.explore.bossId;
    const view = this.scene.stage.unit(id);
    if (!view.model.visible) return null;
    const home = view.home;
    const foot = this.scene.worldToScreen(this.tmpFoot.set(home.x, 0, home.z));
    if (!foot.visible) return null;
    const head = this.scene.worldToScreen(view.headPosition(this.tmpHead));
    return screenBoxOf(id, { x: foot.x, y: foot.y }, { x: head.x, y: head.y });
  }

  private readonly tmpFoot = new Vector3();
  private readonly tmpHead = new Vector3();

  // ------------------------------------------------------------------
  // 界面切换
  // ------------------------------------------------------------------

  /** 标题界面：背景是探索模式的初始布置（队长在出生点，Boss 待机），不能操作 */
  private showTitle(): void {
    this.dismissDialog();
    this.screen = 'title';
    this.exploreInput.clear();
    this.explorePointer.clear();
    this.explore.enter();
    this.title.show();
    this.gear.classList.add('is-hidden');
    this.exploreHint.style.display = 'none';
    this.uiRoot.style.display = 'none';
    this.hud.setControlsVisible(false);
  }

  /** 设置菜单从哪里打开（决定有没有“重新开始 / 回到起点”“退出游戏”） */
  private menuContext(): MenuContext {
    // 对话中与探索相同（“回到起点”“退出游戏”，DESIGN §9.10 F7）
    if (this.screen === 'dialog') return 'explore';
    // 入场过场中与战斗相同（“重新开始”= 跳过过场直接开战，“退出游戏”）
    if (this.screen === 'intro') return 'battle';
    return this.screen === 'title' ? 'title' : this.screen;
  }

  /** 标题界面点“开始游戏”：解锁音频（浏览器自动播放限制），进入探索模式（步骤 14） */
  async startGame(): Promise<void> {
    if (this.busy || this.screen !== 'title') return;
    this.scene.sound.unlock();
    this.menu.close();
    this.title.hide();
    this.gear.classList.remove('is-hidden');
    this.uiRoot.style.display = 'none'; // 日志、宝宝指令、结算只在战斗中显示
    this.hud.setControlsVisible(false); // 倍速、跳过、顺序条只在战斗中显示
    this.exploreHint.style.display = '';
    this.screen = 'explore';
    if (!this.explore.active) this.explore.enter();
  }

  /** 跳过标题和探索，直接开战（地址参数 start=1、自检用；正式流程在步骤 16、17 由对话和入场过场进入） */
  async startBattle(): Promise<void> {
    if (this.busy || this.screen === 'battle' || this.screen === 'intro') return;
    this.dismissDialog();
    this.scene.sound.unlock();
    this.menu.close();
    this.title.hide();
    this.exploreInput.clear();
    this.explorePointer.clear();
    this.explore.leave();
    this.exploreHint.style.display = 'none';
    this.gear.classList.remove('is-hidden');
    this.uiRoot.style.display = '';
    this.hud.setControlsVisible(true);
    this.hud.setBattleOpacity(1);
    this.uiRoot.style.opacity = '';
    this.screen = 'battle';
    this.startMatch();
  }

  /**
   * 入场过场（步骤 17）：从对话视角接着演——队员显形、Boss 怒吼跺地、我方震飞落位、宝宝跳入、相机过渡；
   * 播完才建引擎开第 1 回合（过场期间不会有任何战斗行动），然后头顶条、顺序条、战斗界面淡入。
   */
  async startIntro(): Promise<void> {
    if (this.busy || this.screen === 'battle' || this.screen === 'intro' || this.introRun) return;
    this.dismissDialog();
    this.scene.sound.unlock();
    this.menu.close();
    this.title.hide();
    this.exploreInput.clear();
    this.explorePointer.clear();
    this.exploreHint.style.display = 'none';
    this.gear.classList.remove('is-hidden');
    this.uiRoot.style.display = 'none'; // 日志、宝宝指令在开战后淡入
    this.hud.setBattleOpacity(0); // 头顶条、顺序条先藏起来
    this.hud.setControlsVisible(true); // 倍速、跳过动画在过场中就能用
    this.screen = 'intro';
    const start = this.explore.beginIntro();
    const run = this.intro.play(start);
    this.introRun = run;
    try {
      await run;
    } catch (err) {
      console.error('入场过场中断：', err);
    } finally {
      this.introRun = null;
    }
    if (this.screen !== 'intro') return; // 过场中途退出到标题
    // g. 开战：第 1 回合；头顶条、顺序条、战斗界面淡入（随倍速，跳过动画时立即出现）
    this.screen = 'battle';
    this.uiRoot.style.display = '';
    this.uiRoot.style.opacity = '0';
    this.startMatch();
    void this.scene.scheduler.tween(INTRO_CONFIG.uiFade, (t) => {
      this.hud.setBattleOpacity(t);
      this.uiRoot.style.opacity = t >= 1 ? '' : t.toFixed(3);
    });
  }

  /** 立即走完正在播的过场（打开“跳过动画”直到它结束，再恢复原来的设置） */
  private async skipIntro(): Promise<void> {
    const run = this.introRun;
    if (!run) return;
    const s = this.scene.scheduler;
    const was = s.skip;
    this.menu.close(false);
    this.scene.setPaused(false);
    s.setSkip(true);
    try {
      await run.catch(() => undefined);
    } finally {
      s.setSkip(was);
    }
  }

  /** 设置里“重新开始”：战斗中放弃当前战斗、状态完全重置后重开一局（同“再战一次”）；探索中回到起点 */
  async restart(): Promise<void> {
    if (this.screen === 'intro') {
      // 过场中“重新开始”：过场立即走完，直接开战
      await this.skipIntro();
      return;
    }
    if (this.screen === 'dialog') {
      // 对话中“回到起点”：关掉对话框，回到探索再回到起点
      this.dismissDialog();
      this.screen = 'explore';
      this.exploreHint.style.display = '';
    }
    if (this.screen === 'explore') {
      this.exploreInput.clear();
      this.explorePointer.clear();
      this.explore.returnToStart();
      return;
    }
    if (this.screen !== 'battle') return;
    await this.rematch();
  }

  /** 设置里“退出游戏”：结束当前战斗或探索，场上复位，回到标题界面 */
  async exitToTitle(): Promise<void> {
    if (this.busy || this.screen === 'title') return;
    this.busy = true;
    try {
      if (this.screen === 'intro') {
        // 过场中退出：先让过场立即走完（所有单位复位、特效清空），不开战
        this.screen = 'title';
        await this.skipIntro();
      }
      if (this.screen === 'battle') await this.teardown();
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
  // 与 Boss 对话（步骤 16）
  // ------------------------------------------------------------------

  /** 队长到达交谈点、面向 Boss 后：弹出对话框（探索的移动已被锁定） */
  private openDialog(): void {
    if (this.screen !== 'explore' || this.dialogue) return;
    const def = DIALOGUES[BOSS_DIALOGUE_ID];
    if (!def) throw new Error(`没有对话 ${BOSS_DIALOGUE_ID}`);
    const names = {
      leader: ALLY_TEMPLATES.find((t) => t.id === this.explore.leaderId)?.name ?? '队长',
      boss: ENEMY_TEMPLATES.find((t) => t.id === this.explore.bossId)?.name ?? 'Boss',
    };
    this.screen = 'dialog';
    this.exploreInput.clear();
    this.explorePointer.clear();
    this.exploreHint.style.display = 'none';
    this.dialogue = new DialogueSession(def, names, EXPLORE_CONFIG.dialog.typeSpeed);
    this.dialogBox.open(this.dialogue);
    this.applyEmote();
  }

  /** 点击 / 空格：先显示整句，再下一句，最后显示选项（菜单打开、切换中无效） */
  private advanceDialog(): void {
    const d = this.dialogue;
    if (!d || this.menu.isOpen || this.busy) return;
    if (d.advance() === 'next') this.applyEmote();
    this.dialogBox.render();
  }

  /** 选第 i 个选项 */
  private chooseDialog(i: number): void {
    const d = this.dialogue;
    if (!d || this.menu.isOpen || this.busy) return;
    const action = d.choose(i);
    if (action) this.finishDialog(action);
  }

  /** 当前这句的说话人做小动作，另一方的动作淡出 */
  private applyEmote(): void {
    const line = this.dialogue?.line;
    if (!line) return;
    const pose = line.emote === 'none' ? null : DIALOGUE_EMOTES[line.emote];
    this.explore.setGesture(line.speaker, pose);
    this.explore.setGesture(line.speaker === 'leader' ? 'boss' : 'leader', null);
  }

  /**
   * 对话结束：关闭对话框，按选项走——
   * 'startBattle'（我准备好了）= “进入战斗”信号：本步直接进入现有的战斗流程（步骤 17 换成入场过场）；
   * 'close'（再等等）= 回到自由移动。
   */
  private finishDialog(action: DialogueAction): void {
    this.dialogue?.cancel(action);
    this.dialogue = null;
    this.dialogBox.close();
    const next = this.explore.endDialog(action);
    this.screen = 'explore';
    if (next === 'battle') {
      // 我准备好了：入场过场（步骤 17）
      void this.startIntro();
      return;
    }
    this.exploreHint.style.display = '';
  }

  /** 不经选项直接关掉对话（回到起点、退出游戏、自检直接开战）：等同“再等等”，但不改界面状态 */
  private dismissDialog(): void {
    if (!this.dialogue) return;
    this.dialogue = null;
    this.dialogBox.close();
    this.explore.endDialog('close');
  }

  // ------------------------------------------------------------------
  // 设置与暂停
  // ------------------------------------------------------------------

  private onMenuOpenChange(open: boolean): void {
    // 战斗和探索中暂停；标题界面上打开设置时背景里的待机动画照常
    if (open) {
      this.exploreInput.clear();
      this.explorePointer.clear();
    }
    this.scene.setPaused(open && this.screen !== 'title');
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
      if (this.screen === 'dialog') {
        // 对话中 Esc = “再等等”（DESIGN §11.1）；设置菜单用右上角齿轮打开
        this.finishDialog('close');
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      const mode = this.match?.controller.session.mode;
      if (this.screen === 'battle' && (mode === 'target' || mode === 'skills')) return;
      this.menu.open(this.menuContext());
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }
    if (this.menu.isOpen || this.screen === 'title' || this.busy) {
      e.stopImmediatePropagation();
      return;
    }
    if (this.screen === 'dialog') {
      // 对话：空格 / 回车推进，1 / 2 选选项；方向键等其余按键一律不生效（禁止移动），M 静音照常
      const d = this.dialogue;
      if (d && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault(); // 不让空格“按下”获得焦点的按钮（齿轮）
        if (!e.repeat) this.advanceDialog();
      } else if (d && d.showingChoices && !e.repeat) {
        const action = d.chooseHotkey(e.key);
        if (action) this.finishDialog(action);
      }
      if (e.key !== 'm' && e.key !== 'M') e.stopImmediatePropagation();
      return;
    }
    if (this.screen === 'explore') {
      // 探索模式：方向键 / WASD 交给探索输入（调试）；战斗快捷键（倍速、跳过）不生效，M 静音照常
      this.exploreInput.handle(e, true);
      if (e.key !== 'm' && e.key !== 'M') e.stopImmediatePropagation();
    }
  };

  /** 松开按键：探索模式里停下（菜单、标题界面上不处理） */
  private readonly onKeyUpCapture = (e: KeyboardEvent): void => {
    if (this.screen === 'explore') this.exploreInput.handle(e, false);
  };

  /** 窗口失焦：松开的按键收不到 keyup，全部当作松开 */
  private readonly onBlur = (): void => {
    this.exploreInput.clear();
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
      battle: () => this.startBattle(),
      explore: () => this.explore.snapshot(),
      exploreMove: (x, z) => this.explore.setInput(x, z),
      exploreClick: (x, z) => {
        const r = this.explore.clickGround(x, z);
        return r ? { x: r.goal.x, z: r.goal.z, exact: r.exact } : null;
      },
      exploreWorld: () => ({ obstacles: this.explore.world.obstacles, bounds: this.explore.world.bounds, unitRadius: this.explore.world.unitRadius }),
      groundClient: (x, z) => {
        const p = this.scene.worldToScreen(new Vector3(x, 0, z));
        const l = this.viewport.layout;
        return { x: l.left + p.x * l.scale, y: l.top + p.y * l.scale };
      },
      exit: () => this.exitToTitle(),
      dialog: () => {
        const d = this.dialogue;
        if (!d) return { open: false, line: -1, speaker: '', name: '', aside: '', text: '', complete: false, choices: null };
        return {
          open: this.dialogBox.visible,
          line: d.lineIndex,
          speaker: d.line.speaker,
          name: d.line.name,
          aside: d.line.aside,
          text: d.visibleText,
          complete: d.lineComplete,
          choices: d.showingChoices ? d.choices.map((c) => c.label) : null,
        };
      },
      dialogAdvance: () => this.advanceDialog(),
      dialogChoose: (i) => this.chooseDialog(i),
      clickBoss: () => {
        if (this.screen !== 'explore' || this.menu.isOpen || this.busy) return null;
        const r = this.explore.clickBoss();
        return r ? { x: r.goal.x, z: r.goal.z } : null;
      },
      intro: () => ({
        active: this.intro.active,
        plan: this.intro.plan,
        report: this.intro.lastReport,
        shaded: this.intro.shadedUnits(),
        fx: this.introFx.activeCount,
        hudOpacity: this.hud.battleOpacity,
      }),
      introFrom: async (x, z) => {
        if (this.screen !== 'explore' && this.screen !== 'dialog') return;
        this.dismissDialog();
        this.screen = 'explore';
        this.explore.placeLeader(x, z);
        await this.startIntro();
      },
      clock: () => this.scene.scheduler.time,
      manual: (on) => this.scene.setManual(on),
      step: (seconds, dt = 1 / 60) => {
        const n = Math.max(1, Math.round(seconds / dt));
        for (let i = 0; i < n; i++) this.scene.stepFrame(dt, i === n - 1);
      },
      shot: () => this.scene.snapshot(),
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

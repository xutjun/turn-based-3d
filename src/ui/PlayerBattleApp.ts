// 玩家战斗页面：把逻辑引擎、三维场景、演出导演、头顶条和指令界面装配在一起。
// 玩家亲自指挥 5 个人物（宝宝按设置自动或手动）；一场打完后可以“再战一次”。
//
// 地址参数：
//   seed=数字   随机种子（相同种子、相同指令战斗过程完全相同）；不填则用当前时间
//   speed=2     初始战斗速度
//   skip=1      一开始就跳过动画
//   pet=auto    宝宝一开始就自动出手

import type { Vector3 } from 'three';
import { BattleEngine } from '../core/battle';
import { DEFAULT_SETTINGS } from '../data/battleConfig';
import { createDefaultSetup } from '../data/defaultSetup';
import { STAGING } from '../data/presentationConfig';
import { SKILLS } from '../data/skills';
import { BattleScene } from '../render/BattleScene';
import { BattleDirector } from '../render/director/BattleDirector';
import type { BattleCheck } from './AutoBattleController';
import type { CommandSession } from './command/CommandSession';
import { BattleHud } from './hud/BattleHud';
import { TargetingInput } from './input/TargetingInput';
import { CommandPanel } from './panels/CommandPanel';
import { LogPanel } from './panels/LogPanel';
import { ResultPanel } from './panels/ResultPanel';
import { SettingsBar } from './panels/SettingsBar';
import { PlayerBattleController } from './PlayerBattleController';
import { el, injectTheme } from './theme';

/** 调试 / 自检用（window.__player） */
export interface PlayerDebug {
  seed: number;
  matches: number; // 已开始的场次（再战一次后加一）
  check: BattleCheck;
  engine: BattleEngine;
  session: CommandSession;
  logLines(): number;
  resultVisible(): boolean;
  /** 立刻再战一次（自检用：连续开很多场，看内存是否持续增长） */
  rematch(): void;
}

declare global {
  interface Window {
    __player?: PlayerDebug;
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
  private readonly scene: BattleScene;
  private readonly hud: BattleHud;
  private readonly uiRoot: HTMLDivElement;
  private readonly log: LogPanel;
  private readonly settings: SettingsBar;
  private readonly result: ResultPanel;
  private match: Match | null = null;
  private seed: number;
  private matches = 0;
  /** 玩家的偏好：再战一次时保留 */
  private petAuto: boolean;

  constructor(container: HTMLElement) {
    const query = new URLSearchParams(location.search);
    const seedParam = Number(query.get('seed'));
    this.seed = query.has('seed') && Number.isFinite(seedParam) ? seedParam >>> 0 : Date.now() >>> 0;
    this.petAuto = query.has('pet') ? query.get('pet') === 'auto' : DEFAULT_SETTINGS.petAutoCommand;

    this.scene = new BattleScene(container);
    const { scheduler, stage } = this.scene;
    const speed = Number(query.get('speed'));
    if (STAGING.speeds.includes(speed)) scheduler.setTimeScale(speed);
    if (query.get('skip') === '1') scheduler.setSkip(true);

    this.hud = new BattleHud({
      container,
      scheduler,
      project: (world) => this.scene.worldToScreen(world),
      headPosition: (id, out) => stage.unit(id).headPosition(out),
      quality: this.scene.quality,
      sound: this.scene.sound,
    });
    this.scene.onFrame(() => this.hud.update());

    injectTheme();
    this.uiRoot = el('div', 'dk-ui');
    container.appendChild(this.uiRoot);
    this.log = new LogPanel(this.uiRoot);
    this.settings = new SettingsBar({
      root: this.uiRoot,
      petAuto: this.petAuto,
      onPetAuto: (on) => {
        this.petAuto = on;
        return this.match?.controller.setPetAuto(on) ?? false;
      },
    });
    this.result = new ResultPanel(this.uiRoot, () => this.rematch());
  }

  start(): void {
    this.scene.start();
    this.startMatch();
  }

  dispose(): void {
    this.endMatch();
    this.result.dispose();
    this.settings.dispose();
    this.log.dispose();
    this.uiRoot.remove();
    this.hud.dispose();
    this.scene.dispose();
  }

  /** 再战一次：丢弃上一场的全部状态，场上单位、头顶条、日志、统计全部重置 */
  rematch(): void {
    this.endMatch();
    this.scene.stage.reset();
    this.hud.reset();
    this.log.clear();
    this.result.hide();
    // 换一个种子，新的一场不会和上一场一模一样
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    this.startMatch();
  }

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
        if (phase === 'command') this.settings.clearNote();
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
      container: this.uiRoot.parentElement!,
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
    this.match = { engine, director, controller, panel, targeting };

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
      console.error('战斗中断：', err);
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
}

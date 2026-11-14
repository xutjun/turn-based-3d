// 玩家战斗控制器：按 DESIGN.md §3.1 的主循环驱动引擎，指令阶段等玩家通过指令会话下指令，
// 执行阶段每结算一次出手就等演出播完再结算下一次。
// 不依赖 DOM 和 three：界面通过回调接收阶段变化、日志和结算数据，方便做单元测试。

import type { BattleEngine } from '../core/battle';
import type { BattleEvent } from '../core/events';
import type { SkillDef, SkillId, UnitId } from '../core/types';
import type { BattleCheck } from './AutoBattleController';
import { CommandSession, type Notice } from './command/CommandSession';
import { formatLogLines, type LogLine } from './log/battleLog';
import { BattleStats, type BattleSummary } from './stats/BattleStats';

/** 界面显示的阶段 */
export type UiPhase = 'command' | 'execution' | 'ended';

export interface PlayerBattleDeps {
  engine: BattleEngine;
  skills: Readonly<Record<SkillId, SkillDef>>;
  /** 演出队列全部播完时完成 */
  idle(): Promise<void>;
  /** 等到下一帧（跳过动画时避免一口气算完整场战斗） */
  nextFrame(): Promise<void>;
  /** 宝宝是否自动出手（初始值） */
  petAuto: boolean;
  onPhase?(phase: UiPhase, turn: number): void;
  onSessionChange?(): void;
  onNotice?(notice: Notice): void;
  onLog?(lines: LogLine[]): void;
  onResult?(summary: BattleSummary): void;
  /** 每次出手演完后调用，用于核对演出与逻辑是否一致（可选） */
  verify?(check: BattleCheck): void;
}

export class PlayerBattleController {
  readonly session: CommandSession;
  readonly stats = new BattleStats();
  /** 自检数据（window.__battle） */
  readonly check: BattleCheck = {
    finished: false,
    winner: null,
    turns: 0,
    actions: 0,
    hpMismatches: [],
    displaced: [],
    concurrentActions: 0,
  };

  private readonly unsubscribe: () => void;
  /** 引擎已发出、演出还没播完的事件：播完后再写进日志和统计，避免日志“剧透” */
  private buffer: BattleEvent[] = [];
  private names = new Map<UnitId, string>();
  private stopped = false;
  private petAuto: boolean;
  private phase: UiPhase = 'execution';

  constructor(private readonly deps: PlayerBattleDeps) {
    this.petAuto = deps.petAuto;
    this.session = new CommandSession(deps.engine, deps.skills, {
      onChange: () => deps.onSessionChange?.(),
      onNotice: (n) => deps.onNotice?.(n),
    });
    this.unsubscribe = deps.engine.events.onAny((e) => {
      if (e.type === 'BattleStart') this.names = new Map(e.units.map((u) => [u.id, u.name]));
      this.buffer.push(e);
    });
  }

  /** 停止战斗循环（页面关闭、再战一次时） */
  stop(): void {
    this.stopped = true;
    this.unsubscribe();
    this.session.abort();
  }

  get uiPhase(): UiPhase {
    return this.phase;
  }

  get petAutoCommand(): boolean {
    return this.petAuto;
  }

  /**
   * 切换宝宝自动 / 手动。指令阶段立即生效；执行阶段先记下，下一回合的指令阶段开始时生效。
   * 返回是否已经立即生效。
   */
  setPetAuto(on: boolean): boolean {
    this.petAuto = on;
    return this.applyPetAuto();
  }

  private applyPetAuto(): boolean {
    const { engine } = this.deps;
    const state = engine.getState();
    if (state.phase !== 'command') return false;
    if (state.settings.petAutoCommand !== this.petAuto) {
      engine.setSettings({ petAutoCommand: this.petAuto });
      this.session.refresh();
    }
    return true;
  }

  /** 跑完整场战斗 */
  async run(): Promise<void> {
    const { engine } = this.deps;
    engine.start();
    await this.present();

    while (engine.getState().phase !== 'ended' && !this.stopped) {
      // 指令阶段：等玩家给所有待指令单位下完指令
      this.applyPetAuto();
      this.setPhase('command');
      await this.session.begin();
      if (this.stopped) return;
      engine.beginExecution();
      this.setPhase('execution');
      await this.present();

      // 执行阶段：一次结算一个单位的出手，演完再结算下一个
      while (engine.getState().phase === 'execution' && !this.stopped) {
        // 刚复活的单位轮到出手：暂停，等玩家现场下指令
        const waiting = engine.getState().awaitingCommandFor;
        if (waiting !== null) {
          this.setPhase('command');
          await this.session.beginFor(waiting);
          if (this.stopped) return;
          this.setPhase('execution');
        }
        engine.stepAction();
        await this.present();
        this.deps.verify?.(this.check);
        await this.deps.nextFrame();
      }
    }
    if (this.stopped) return;

    await this.present();
    const state = engine.getState();
    this.check.finished = state.phase === 'ended';
    this.check.winner = state.winner;
    this.check.turns = state.turn;
    this.setPhase('ended');
    this.deps.onResult?.(this.stats.summary());
  }

  private setPhase(phase: UiPhase): void {
    this.phase = phase;
    this.deps.onPhase?.(phase, this.deps.engine.getState().turn);
  }

  /** 等演出播完，再把这批事件写进日志和统计 */
  private async present(): Promise<void> {
    await this.deps.idle();
    if (this.stopped) return;
    const events = this.buffer;
    this.buffer = [];
    if (events.length === 0) return;
    this.stats.consume(events);
    const { skills } = this.deps;
    const lines = formatLogLines(events, {
      unitName: (id) => this.names.get(id) ?? id,
      skillName: (id) => skills[id]?.name ?? id,
      isBasicSkill: (id) => skills[id]?.classId === 'common',
    });
    if (lines.length > 0) this.deps.onLog?.(lines);
  }
}

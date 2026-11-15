// 自动战斗控制器：双方都由 AI 下指令，按 DESIGN.md §3.1 的主循环驱动引擎，
// 每结算一次出手就等演出播完再结算下一次，所以画面上任意时刻只有一个单位在行动。
// 玩家亲自下指令的版本见 PlayerBattleController。

import type { BattleEngine } from '../core/battle';
import type { BattleDirector } from '../render/director/BattleDirector';
import type { Scheduler } from '../render/director/Scheduler';

/** 演出与逻辑的一致性自检结果（验收用，可在控制台查看 window.__battle） */
export interface BattleCheck {
  finished: boolean;
  winner: string | null;
  turns: number;
  actions: number; // 已演出的出手次数
  hpMismatches: string[]; // 头顶条数值与逻辑层不一致的记录（应为空）
  displaced: string[]; // 出手结束后仍不在站位上的单位记录（应为空）
  concurrentActions: number; // 同时行动的次数（应为 0）
}

export interface AutoBattleDeps {
  engine: BattleEngine;
  director: BattleDirector;
  scheduler: Scheduler;
  /** 界面当前显示的气血 / 魔法目标值 */
  shownHp(id: string): number | undefined;
  shownMp(id: string): number | undefined;
  /** 当前离开站位的单位 */
  unitsAway(): string[];
}

export class AutoBattleController {
  readonly check: BattleCheck = {
    finished: false,
    winner: null,
    turns: 0,
    actions: 0,
    hpMismatches: [],
    displaced: [],
    concurrentActions: 0,
  };

  private stopped = false;

  constructor(private readonly deps: AutoBattleDeps) {}

  stop(): void {
    this.stopped = true;
  }

  /** 跑完整场战斗 */
  async run(): Promise<void> {
    const { engine, director, scheduler } = this.deps;
    engine.start();
    await director.idle();

    while (engine.getState().phase !== 'ended' && !this.stopped) {
      // 指令阶段：代替玩家，采用引擎的 AI 建议
      for (const id of engine.getPendingCommandUnits()) {
        const result = engine.submitCommand(id, engine.suggestCommand(id));
        if (!result.ok) throw new Error(`指令被拒绝：${id}（${result.reason}）`);
      }
      engine.beginExecution();
      await director.idle();

      // 执行阶段：一次结算一个单位的出手，演完再结算下一个
      while (engine.getState().phase === 'execution' && !this.stopped) {
        // 刚复活的单位轮到出手：同样代替玩家现场下指令
        const waiting = engine.getState().awaitingCommandFor;
        if (waiting !== null) {
          const result = engine.submitCommand(waiting, engine.suggestCommand(waiting));
          if (!result.ok) throw new Error(`指令被拒绝：${waiting}（${result.reason}）`);
        }
        engine.stepAction();
        await director.idle();
        this.verify();
        // 让出一帧：跳过动画时也不会一口气算完整场战斗而卡住页面
        await scheduler.nextFrame();
      }
    }

    await director.idle();
    const state = engine.getState();
    this.check.finished = state.phase === 'ended';
    this.check.winner = state.winner;
    this.check.turns = state.turn;
  }

  /** 演出追上逻辑之后，核对界面数值与逻辑层状态是否一致、有没有单位留在站位之外 */
  private verify(): void {
    const { engine, director, shownHp, shownMp, unitsAway } = this.deps;
    const state = engine.getState();
    const c = this.check;
    c.actions = director.stats.actions;
    c.concurrentActions = director.stats.concurrentActions;
    for (const id of state.unitIds) {
      const u = state.units[id]!;
      const hp = shownHp(id);
      const mp = shownMp(id);
      if (hp !== u.hp) c.hpMismatches.push(`#${director.stats.lastSeq} ${id} 气血 界面 ${hp} / 逻辑 ${u.hp}`);
      if (mp !== u.mp) c.hpMismatches.push(`#${director.stats.lastSeq} ${id} 魔法 界面 ${mp} / 逻辑 ${u.mp}`);
    }
    const away = unitsAway();
    if (away.length > 0) c.displaced.push(`#${director.stats.lastSeq} ${away.join(',')}`);
  }
}

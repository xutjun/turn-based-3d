// BattleDirector：把逻辑层的事件变成按顺序播放的演出（对应 DESIGN.md §3.5）。
//
// - 订阅事件总线，事件先进队列，再一条一条（或一组一组）串行播放；
//   控制器等 idle() 完成后才让引擎结算下一次出手，所以任意时刻只有一个单位在行动。
// - 只使用事件里的字段（hpAfter、mpAfter 等），不读取引擎的实时状态。
// - 冲锋 / 返回不是逻辑事件：看到 SkillCast.meleeCharge 时在命中前插入“冲到目标面前”，结束前插入“跑回原位”。
// - 同一个 stepIndex 的结算同帧表现，不同 stepIndex 依次表现。
// - 所有等待都走 Scheduler，倍速和跳过动画在那里统一生效。
//
// - 每次出手具体怎么演（镜头、特效、顿帧、各技能的专属动作）在 ./Choreographer 里。
//
// 本文件只依赖 ./types 里的接口，不依赖 three 和 DOM。

import type { BattleEvent, EventBus, SkillCastEvent, UnitSnapshot } from '../../core/events';
import type { SkillId, UnitId } from '../../core/types';
import { TIMING } from '../../data/presentationConfig';
import { Choreographer, groupSteps } from './Choreographer';
import type { Scheduler } from './Scheduler';
import type { DirectorHud, Stage } from './types';

export { approachPoint, groupSteps } from './Choreographer';

export interface DirectorOptions {
  /** 技能显示名（飘字用） */
  skillName(id: SkillId): string;
  /** 哪些技能出手时不显示技能名（普攻） */
  isBasicSkill(id: SkillId): boolean;
}

/** 演出过程中的自检数据：验收“一次只有一个单位行动” */
export interface DirectorStats {
  actions: number; // 已演出的出手次数
  eventsPlayed: number; // 已演出的事件数
  concurrentActions: number; // 发现同时行动的次数（应为 0）
  lastSeq: number; // 最近演出的事件序号
}

export class BattleDirector {
  readonly stats: DirectorStats = { actions: 0, eventsPlayed: 0, concurrentActions: 0, lastSeq: 0 };

  private readonly queue: BattleEvent[] = [];
  private draining: Promise<void> | null = null;
  private readonly unsubscribe: () => void;
  private readonly snapshots = new Map<UnitId, UnitSnapshot>();
  private readonly defending = new Set<UnitId>();
  private activeActor: UnitId | null = null;
  private disposed = false;
  private readonly choreographer: Choreographer;

  constructor(
    bus: EventBus,
    private readonly stage: Stage,
    private readonly hud: DirectorHud,
    private readonly scheduler: Scheduler,
    private readonly options: DirectorOptions,
  ) {
    this.choreographer = new Choreographer(stage, hud, scheduler, (id) => this.defending.delete(id));
    this.unsubscribe = bus.onAny((e) => this.enqueue(e));
  }

  /** 队列里的事件全部演完时完成 */
  idle(): Promise<void> {
    return this.draining ?? Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.queue.length = 0;
  }

  private enqueue(e: BattleEvent): void {
    if (this.disposed) return;
    this.queue.push(e);
    // 引擎是同步发事件的：等这一批事件都进了队列再开始播放
    this.draining ??= Promise.resolve().then(() => this.drain());
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0 && !this.disposed) {
        const e = this.queue.shift()!;
        await this.play(e);
      }
    } finally {
      this.draining = null;
    }
  }

  private mark(e: BattleEvent): void {
    this.stats.eventsPlayed += 1;
    this.stats.lastSeq = e.seq;
  }

  /** 从队首连续取出满足条件的事件 */
  private takeWhile(pred: (e: BattleEvent) => boolean): BattleEvent[] {
    const out: BattleEvent[] = [];
    while (this.queue.length > 0 && pred(this.queue[0]!)) out.push(this.queue.shift()!);
    return out;
  }

  // ------------------------------------------------------------------
  // 回合级事件
  // ------------------------------------------------------------------

  private async play(e: BattleEvent): Promise<void> {
    const { hud, scheduler } = this;
    this.mark(e);
    switch (e.type) {
      case 'BattleStart':
        for (const u of e.units) this.snapshots.set(u.id, u);
        hud.init(e.units);
        break;

      case 'TurnStart':
        hud.setTurn(e.turn, e.turnOrder);
        hud.banner(`第 ${e.turn} 回合`);
        await scheduler.wait(TIMING.turnBanner);
        break;

      case 'DefendApplied': {
        // 所有防御单位同时摆出防御姿态
        const batch = [e, ...this.takeWhile((x) => x.type === 'DefendApplied')];
        for (const d of batch) {
          if (d.type !== 'DefendApplied') continue;
          if (d !== e) this.mark(d);
          this.defending.add(d.unitId);
          this.stage.unit(d.unitId).setDefending(true);
          hud.floater(d.unitId, '防御', 'defend');
        }
        await scheduler.wait(TIMING.defendNotice);
        break;
      }

      case 'UnitActStart': {
        // 一次出手的全部事件此时都已在队列里，一直取到 UnitActEnd
        const body = this.takeWhile((x) => x.type !== 'UnitActEnd');
        const end = this.queue[0]?.type === 'UnitActEnd' ? this.queue.shift()! : null;
        for (const x of body) this.mark(x);
        if (end) this.mark(end);
        await this.playAction(e.actorId, body);
        break;
      }

      case 'StatusTicked':
        hud.setStatus(e.unitId, e.status, e.remainingTurns);
        break;

      case 'StatusRemoved':
        hud.setStatus(e.unitId, e.status, null);
        if (e.status === 'seal') this.stage.unit(e.unitId).setSealed(false);
        break;

      case 'TurnEnd':
        // 防御只持续一回合
        for (const id of this.defending) this.stage.unit(id).setDefending(false);
        this.defending.clear();
        break;

      case 'BattleEnd':
        hud.setActive(null);
        hud.banner(e.winner === 'ally' ? `胜利 · 共 ${e.turns} 回合` : `战败 · 共 ${e.turns} 回合`, true);
        await scheduler.wait(TIMING.battleEndBanner);
        break;

      default:
        // CommandPhaseStart / CommandRequested / ExecutionPhaseStart：步骤 6 的指令界面使用，这里不需要演出
        break;
    }
  }

  // ------------------------------------------------------------------
  // 一次出手
  // ------------------------------------------------------------------

  private async playAction(actorId: UnitId, events: BattleEvent[]): Promise<void> {
    const { hud, scheduler, stage } = this;
    if (this.activeActor !== null) this.stats.concurrentActions += 1;
    this.activeActor = actorId;
    this.stats.actions += 1;
    hud.setActive(actorId);
    const actor = stage.unit(actorId);

    let cast: SkillCastEvent | null = null;
    const results: BattleEvent[] = [];
    for (const e of events) {
      if (cast) {
        results.push(e);
      } else if (e.type === 'SkillCast') {
        cast = e;
      } else if (e.type === 'CommandFallback') {
        hud.floater(actorId, e.reason === 'sealed' ? '被封印 · 改为普攻' : '魔法不足 · 改为普攻', 'info');
        await scheduler.wait(TIMING.notice);
      } else if (e.type === 'ActionFizzled') {
        hud.floater(actorId, '没有目标', 'info');
        await scheduler.wait(TIMING.notice);
      }
      // TargetRetargeted：演出直接使用 SkillCast.targets，不需要单独表现
    }

    if (cast) {
      hud.setMp(actorId, cast.mpAfter);
      if (!this.options.isBasicSkill(cast.skillId)) hud.floater(actorId, this.options.skillName(cast.skillId), 'info');
      await this.choreographer.play(actor, cast, groupSteps(results));
    }
    // 防御等没有 SkillCast 的出手：只高亮一下出手者

    hud.setActed(actorId);
    hud.setActive(null);
    this.activeActor = null;
    await scheduler.wait(TIMING.actionGap);
  }
}

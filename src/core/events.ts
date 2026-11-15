// 逻辑层 → 表现层的事件定义与事件总线（对应 DESIGN.md §3）。
// 表现层和界面只能通过这些事件了解战斗过程，逻辑层不直接操作任何画面。

import type {
  AnimType,
  AttackMode,
  ClassId,
  Command,
  DamageType,
  Delivery,
  Element,
  EnemyRank,
  PassiveId,
  Side,
  SkillId,
  Slot,
  Stats,
  StatusType,
  UnitId,
  UnitKind,
  WeaponId,
} from './types';

/** 所有事件的公共字段 */
export interface EventBase {
  seq: number; // 全局自增序号
  turn: number; // 发出时的回合号
}

/** 单位的只读快照，表现层用它创建模型 */
export interface UnitSnapshot {
  id: UnitId;
  templateId: string;
  name: string;
  side: Side;
  kind: UnitKind;
  classId: ClassId;
  rank?: EnemyRank;
  slot: Slot;
  weaponId?: WeaponId;
  attackMode: AttackMode;
  stats: Stats;
  hp: number;
  mp: number;
}

export interface BattleStartEvent extends EventBase {
  type: 'BattleStart';
  units: UnitSnapshot[];
}
export interface TurnStartEvent extends EventBase {
  type: 'TurnStart';
  turnOrder: UnitId[];
}
export interface CommandPhaseStartEvent extends EventBase {
  type: 'CommandPhaseStart';
  pending: UnitId[];
}
export interface CommandRequestedEvent extends EventBase {
  type: 'CommandRequested';
  unitId: UnitId;
}
export interface ExecutionPhaseStartEvent extends EventBase {
  type: 'ExecutionPhaseStart';
  commands: Record<UnitId, Command>;
}
export interface DefendAppliedEvent extends EventBase {
  type: 'DefendApplied';
  unitId: UnitId;
}
export interface UnitActStartEvent extends EventBase {
  type: 'UnitActStart';
  actorId: UnitId;
  command: Command;
}
export interface CommandFallbackEvent extends EventBase {
  type: 'CommandFallback';
  actorId: UnitId;
  fromSkillId: SkillId;
  toSkillId: SkillId;
  reason: 'sealed' | 'noMp';
}
export interface TargetRetargetedEvent extends EventBase {
  type: 'TargetRetargeted';
  actorId: UnitId;
  fromId: UnitId;
  toId: UnitId;
}
export interface ActionFizzledEvent extends EventBase {
  type: 'ActionFizzled';
  actorId: UnitId;
  skillId: SkillId;
  reason: 'noValidTarget';
}
export interface SkillCastEvent extends EventBase {
  type: 'SkillCast';
  actorId: UnitId;
  skillId: SkillId;
  delivery: Delivery;
  animation: AnimType;
  meleeCharge: boolean; // 已结合 delivery 计算
  element: Element;
  targets: UnitId[]; // 执行顺序
  mpCost: number;
  mpBefore: number;
  mpAfter: number;
}
export interface HitResolvedEvent extends EventBase {
  type: 'HitResolved';
  actorId: UnitId;
  targetId: UnitId;
  skillId: SkillId;
  stepIndex: number; // 相同 stepIndex 的结算同帧表现
  stepCount: number;
  hitIndex: number;
  hitCount: number;
  damageType: DamageType;
  isMiss: boolean;
  isCrit: boolean;
  defended: boolean;
  damage: number;
  hpBefore: number;
  hpAfter: number;
  killed: boolean;
}
export interface HealResolvedEvent extends EventBase {
  type: 'HealResolved';
  actorId: UnitId;
  targetId: UnitId;
  skillId: SkillId;
  stepIndex: number;
  stepCount: number;
  isCrit: boolean;
  amount: number; // 实际回复量
  hpBefore: number;
  hpAfter: number;
}
export interface UnitDiedEvent extends EventBase {
  type: 'UnitDied';
  unitId: UnitId;
  killerId: UnitId;
  vanish: boolean; // 敌方为 true：死亡后消失；友方为 false：倒地保持
}
export interface UnitRevivedEvent extends EventBase {
  type: 'UnitRevived';
  unitId: UnitId;
  actorId: UnitId;
  hpAfter: number;
  maxHp: number;
  actsThisTurn: boolean; // 本回合是否还会出手（已经出过手的单位为 false）
  queuedAtEnd: boolean; // 速度位置已过，排到本回合队尾出手
}
/** 被动技能生效的那一刻（连击：第二击之前） */
export interface PassiveTriggeredEvent extends EventBase {
  type: 'PassiveTriggered';
  unitId: UnitId;
  passiveId: PassiveId;
  name: string; // 飘字
  targetId: UnitId;
}
export interface StatusAppliedEvent extends EventBase {
  type: 'StatusApplied';
  unitId: UnitId;
  sourceId: UnitId;
  status: StatusType;
  remainingTurns: number;
}
export interface StatusResistedEvent extends EventBase {
  type: 'StatusResisted';
  unitId: UnitId;
  sourceId: UnitId;
  status: StatusType;
}
export interface StatusTickedEvent extends EventBase {
  type: 'StatusTicked';
  unitId: UnitId;
  status: StatusType;
  remainingTurns: number;
}
export interface StatusRemovedEvent extends EventBase {
  type: 'StatusRemoved';
  unitId: UnitId;
  status: StatusType;
  reason: 'expired' | 'death';
}
export interface UnitActEndEvent extends EventBase {
  type: 'UnitActEnd';
  actorId: UnitId;
}
export interface TurnEndEvent extends EventBase {
  type: 'TurnEnd';
}
export interface BattleEndEvent extends EventBase {
  type: 'BattleEnd';
  winner: Side;
  turns: number;
}

export type BattleEvent =
  | BattleStartEvent
  | TurnStartEvent
  | CommandPhaseStartEvent
  | CommandRequestedEvent
  | ExecutionPhaseStartEvent
  | DefendAppliedEvent
  | UnitActStartEvent
  | CommandFallbackEvent
  | TargetRetargetedEvent
  | ActionFizzledEvent
  | SkillCastEvent
  | HitResolvedEvent
  | HealResolvedEvent
  | UnitDiedEvent
  | UnitRevivedEvent
  | PassiveTriggeredEvent
  | StatusAppliedEvent
  | StatusResistedEvent
  | StatusTickedEvent
  | StatusRemovedEvent
  | UnitActEndEvent
  | TurnEndEvent
  | BattleEndEvent;

export type BattleEventType = BattleEvent['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** 发出事件时填写的内容（seq 和 turn 由引擎自动补上） */
export type BattleEventInput = DistributiveOmit<BattleEvent, 'seq' | 'turn'>;

type AnyHandler = (e: BattleEvent) => void;

/** 事件总线：同步分发，订阅者按订阅顺序收到事件 */
export class EventBus {
  private readonly handlers = new Map<BattleEventType, Set<AnyHandler>>();
  private readonly anyHandlers = new Set<AnyHandler>();

  /** 订阅某一类事件，返回取消订阅函数 */
  on<T extends BattleEventType>(
    type: T,
    fn: (e: Extract<BattleEvent, { type: T }>) => void,
  ): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const handler = fn as AnyHandler;
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  /** 订阅全部事件，返回取消订阅函数 */
  onAny(fn: (e: BattleEvent) => void): () => void {
    this.anyHandlers.add(fn);
    return () => {
      this.anyHandlers.delete(fn);
    };
  }

  /** 发出事件（仅逻辑层内部调用） */
  emit(e: BattleEvent): void {
    for (const fn of [...this.anyHandlers]) fn(e);
    const set = this.handlers.get(e.type);
    if (set) for (const fn of [...set]) fn(e);
  }
}

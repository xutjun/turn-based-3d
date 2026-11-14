// BattleDirector 依赖的接口：舞台上的单位、特效、头顶条与飘字。
// Director 只依赖这些接口，不直接依赖 three 或 DOM，方便做单元测试，也方便以后换表现方式。

import type { UnitSnapshot } from '../../core/events';
import type { Side, StatusType, UnitId, UnitKind } from '../../core/types';
import type { FloaterStyle } from '../../data/presentationConfig';

/** 空间中的一个点 */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 地面上的一个点 */
export interface GroundPoint {
  x: number;
  z: number;
}

/** 出手动作的种类 */
export type AttackStyle = 'melee' | 'bow' | 'cast';

/** 单位身上的挂点 */
export type AnchorName = 'ground' | 'chest' | 'head' | 'weapon';

/** 舞台上的一个单位。所有动画方法都返回 Promise，在动画播完（或被跳过）时完成 */
export interface StageUnit {
  readonly id: UnitId;
  readonly side: Side;
  readonly kind: UnitKind;
  readonly radius: number; // 身体半径，冲锋时用来算停步位置
  /** 站位（固定不动） */
  readonly home: GroundPoint;
  /** 面向对方的单位向量 */
  readonly facing: GroundPoint;

  anchor(name: AnchorName): Point3;
  /** 离开站位移动到某点（只有近战冲锋会调用） */
  moveTo(point: GroundPoint, duration: number): Promise<void>;
  /** 回到站位 */
  returnHome(duration: number): Promise<void>;
  /** 出手动作三段：蓄力 → 出手 → 收招 */
  windup(style: AttackStyle, duration: number): Promise<void>;
  release(style: AttackStyle, duration: number): Promise<void>;
  recover(duration: number): Promise<void>;
  /** 受击：闪白 + 后仰 */
  hit(duration: number, heavy: boolean): Promise<void>;
  /** 对方未命中时的闪避 */
  dodge(duration: number): Promise<void>;
  /** 倒地；vanish 为 true 时倒地后从场上消失 */
  die(vanish: boolean, fallDuration: number, vanishDuration: number): Promise<void>;
  /** 复活起身 */
  revive(duration: number): Promise<void>;
  /** 防御姿态 */
  setDefending(on: boolean): void;
}

/** 特效种类（步骤 5 只有基础光效，华丽特效在步骤 7） */
export type ProjectileKind = 'arrow' | 'bolt';
export type BurstKind = 'impact' | 'pillarDown' | 'pillarUp';

export interface Stage {
  unit(id: UnitId): StageUnit;
  /** 一个光效从 from 飞到 to */
  projectile(kind: ProjectileKind, from: Point3, to: Point3, color: number, duration: number): Promise<void>;
  /** 在某点爆开 / 落下 / 升起的光效 */
  burst(kind: BurstKind, at: Point3, color: number, duration: number): Promise<void>;
}

/** 头顶条、飘字、出手顺序条、提示横幅 */
export interface DirectorHud {
  init(units: readonly UnitSnapshot[]): void;
  setHp(id: UnitId, hp: number): void;
  setMp(id: UnitId, mp: number): void;
  setDead(id: UnitId, dead: boolean, vanish: boolean): void;
  /** turns 为 null 表示移除该状态 */
  setStatus(id: UnitId, status: StatusType, turns: number | null): void;
  floater(id: UnitId, text: string, style: FloaterStyle): void;
  setTurn(turn: number, order: readonly UnitId[]): void;
  /** 当前出手者；null 表示没有人在出手 */
  setActive(id: UnitId | null): void;
  /** 标记某单位本回合已出手 */
  setActed(id: UnitId): void;
  banner(text: string, sticky?: boolean): void;
}

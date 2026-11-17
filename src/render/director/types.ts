// BattleDirector 依赖的接口：舞台上的单位、特效、头顶条与飘字。
// Director 只依赖这些接口，不直接依赖 three 或 DOM，方便做单元测试，也方便以后换表现方式。

import type { UnitSnapshot } from '../../core/events';
import type { Side, StatusType, UnitId, UnitKind } from '../../core/types';
import type { GaitId, MotionId } from '../../data/attackAnimConfig';
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
export type AttackStyle = 'melee' | 'bow' | 'bowUp' | 'cast';

/** 单位身上的挂点；muzzle = 施法点（骨龙的嘴前、幽灵的双手之间；人形等同于武器） */
export type AnchorName = 'ground' | 'chest' | 'head' | 'weapon' | 'muzzle';

/** 移动方式（步态见 data/attackAnimConfig.ts 的 GAITS） */
export interface MoveOptions {
  /** 步态；不传则用该单位动作档案里的默认步态 */
  gait?: GaitId;
  /** 弧线路径往哪一侧偏：1 / −1（只对带弧线的步态有意义） */
  side?: number;
  /**
   * 离地的一瞬间（下蹲蓄力结束、开始腾空时）调用一次；没有下蹲的步态在出发时调用。
   * 旋风斩用它在空中摆好横扫的预备姿态。跳过动画时也会调用。
   */
  onAirborne?: () => void;
  /**
   * false = 跳劈（步骤 11c）：没有单独的落地缓冲，腾空占满下蹲之后的全部时间，落地的一瞬间身体被压下去再弹回，
   * 和同时进行的挥击叠加。默认 true（落地后缓冲回到站姿）。
   */
  land?: boolean;
}

/** 舞台上的一个单位。所有动画方法都返回 Promise，在动画播完（或被跳过）时完成 */
export interface StageUnit {
  readonly id: UnitId;
  readonly side: Side;
  readonly kind: UnitKind;
  readonly radius: number; // 身体半径，冲锋时用来算停步位置
  /** 这个单位出手时光效的颜色（有武器取武器的发光色） */
  readonly fxColor: number;
  /** 站位（固定不动） */
  readonly home: GroundPoint;
  /** 面向对方的单位向量 */
  readonly facing: GroundPoint;
  /** 动作档案：这个单位用哪一套进攻动作（data/attackAnimConfig.ts 的 MOTION_PROFILES） */
  readonly motion: MotionId;

  anchor(name: AnchorName): Point3;
  /**
   * 离开站位移动到某点（只有近战冲锋会调用）。途中平滑转向跑动方向，
   * 到位时正对 face（要攻击的目标所在的位置）；不传 face 则保持跑动方向。
   */
  moveTo(point: GroundPoint, duration: number, face?: GroundPoint, options?: MoveOptions): Promise<void>;
  /** 回到站位，途中平滑转回原来的朝向 */
  returnHome(duration: number, options?: MoveOptions): Promise<void>;
  /** 出发前在原地蓄势（狼压低身体、魔偶举臂）；动作档案里没有蓄势姿态的单位立即完成 */
  brace(duration: number): Promise<void>;
  /**
   * 出手动作的各个阶段：预备（蓄力）→ 发力 → 命中顿住 → 余势 → 收招。
   * variant 是动作编号（data/attackAnimConfig.ts 的 MELEE / BOW / CAST）：
   * 近战 0 = 普攻（各武器自己的招式），1 = 第二式，2 = 跃起重劈，3 = 旋身横扫，4 = 旋风斩收尾。
   */
  windup(style: AttackStyle, duration: number, variant?: number): Promise<void>;
  release(style: AttackStyle, duration: number, variant?: number): Promise<void>;
  /** 命中后顿住：姿态停在命中的一瞬 */
  hold(duration: number): Promise<void>;
  /** 余势：顺着力道过冲、回弹 */
  follow(duration: number): Promise<void>;
  /** 收招：回到自然站姿 */
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
  /** 武器发光倍率（1 = 常态），在 duration 秒内过渡过去；没有武器的单位忽略 */
  setWeaponGlow(scale: number, duration: number): void;
  /** 武器发光颜色（法杖按施法元素变色）；null = 恢复武器本来的颜色 */
  setWeaponColor(color: number | null): void;
  /** 武器拖尾光轨的开关 */
  setTrail(on: boolean): void;
  /** 被封印时身上常驻的锁链 */
  setSealed(on: boolean): void;
}

/** 演出镜头 */
export interface StageCamera {
  /** 朝地面上的某点平移 pan 比例（0~1），并推近到 zoom 倍 */
  focus(point: GroundPoint, zoom: number, pan: number, duration: number): Promise<void>;
  /** 回到原始机位 */
  reset(duration: number): Promise<void>;
  /** 抖动一下，amount 为幅度（米） */
  shake(amount: number): void;
}

/** 飞行物：普通箭矢 / 法术光弹 / 火球 / 射向天空的光箭 / 从天而降的光箭 */
export type ProjectileKind = 'arrow' | 'bolt' | 'fireball' | 'skyArrow' | 'rainArrow';
/**
 * 爆发类光效：命中火花 / 重击 / 落雷 / 火柱 / 治疗光柱 / 复活光芒 / 箭雨落点 / 锁链崩碎 / 爆炸 / 尘土 / 冲击波
 */
export type BurstKind =
  | 'impact'
  | 'heavyImpact'
  | 'thunder'
  | 'pillarDown'
  | 'pillarUp'
  | 'reviveLight'
  | 'landing'
  | 'shatter'
  | 'explosion'
  | 'dust' // 脚下的尘土（scale = 尘土量）
  | 'shockwave'; // 地面冲击波环（scale = 半径，米）
/** 持续一段时间的范围光效：地面符文阵 / 施法者脚下的蓄力光环 / 缠绕目标的锁链 / 在空中一点汇聚的光团（宝宝施法） */
export type AuraKind = 'runeCircle' | 'charge' | 'bind' | 'gather';

export interface Stage {
  unit(id: UnitId): StageUnit;
  /** 一个光效从 from 飞到 to */
  projectile(kind: ProjectileKind, from: Point3, to: Point3, color: number, duration: number): Promise<void>;
  /** 在某点爆开 / 落下 / 升起的光效；scale 为规模倍率（火柱、尘土、冲击波支持，默认 1） */
  burst(kind: BurstKind, at: Point3, color: number, duration: number, scale?: number): Promise<void>;
  /** 斩击光弧；variant 决定光弧的角度（与挥砍轨迹对应），scale 为大小倍率 */
  slash(at: Point3, variant: number, color: number, duration: number, scale: number): Promise<void>;
  /** 锁链光束：travel 秒后到达 to，再停留 linger 秒；Promise 在整段结束时完成 */
  beam(from: Point3, to: Point3, color: number, travel: number, linger: number): Promise<void>;
  /** 范围光效，radius 为半径（米） */
  aura(kind: AuraKind, at: Point3, color: number, duration: number, radius: number): Promise<void>;
  readonly camera: StageCamera;
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
  /** 本回合被复活、速度位置已过的单位：在出手顺序条里排到队尾 */
  queueLate(id: UnitId): void;
  banner(text: string, sticky?: boolean): void;
}

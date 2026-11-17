// 探索模式与行走动画的配置（步骤 14，DESIGN §11）。纯数据，调手感只改这里。
//
// 坐标系与 formation.ts 相同：+x 向右，+z 朝向相机（屏幕下方），地面 y = 0。
// 长度单位米，角度弧度，时间秒。

import type { UnitId } from '../core/types';

export interface GroundXZ {
  x: number;
  z: number;
}

export const EXPLORE_CONFIG = {
  /** 队长：烬刃（重甲骑士，DESIGN §9.10 F1） */
  leaderId: 'A1' as UnitId,
  /** 出生点（队长站的位置），面向 Boss */
  start: { x: 8.5, z: 8.5 } as GroundXZ,
  /**
   * 队员在队长身后的站位（队长局部坐标：x 向队长的左手侧，z 向前；DESIGN §11.4）。
   * 步骤 15 的跟随也用这张表。
   */
  lineup: [
    { id: 'A3', x: 0.9, z: -1.3 }, // 缚魂
    { id: 'A2', x: -0.9, z: -1.3 }, // 雷咒
    { id: 'A0', x: 0.9, z: -2.6 }, // 夜隼
    { id: 'A4', x: -0.9, z: -2.6 }, // 守誓
  ] as { id: UnitId; x: number; z: number }[],
  /** 交谈距离：队长停在 Boss 前方多远（步骤 16 用） */
  talkDistance: 4,
  /** 战败复位点离 Boss 的距离（步骤 19 用） */
  respawnDistance: 9,
  /** 可走区域（矩形，月光阴影覆盖 ±18 以内） */
  bounds: { minX: -17, maxX: 17, minZ: -17, maxZ: 17 },
  /** 角色的移动 */
  move: {
    walkSpeed: 3.2, // 走速（米/秒）
    accel: 9, // 起步加速度（米/秒²）
    decel: 12, // 停步减速度（米/秒²）
    turnRate: 9, // 转身角速度（弧度/秒）
  },
  /** 探索相机：与战斗相同的俯角、FOV、方位角，只是更近、跟随队长 */
  camera: {
    distance: 22, // 相机到注视点的距离（战斗为 32.5）
    lead: 0.8, // 注视点沿行进方向前移（米）
    smoothTime: 0.35, // 跟随的平滑时间（临界阻尼弹簧，秒）
    margin: 4, // 注视点离可走区域边界至少这么远（米），相机看不到地面以外
    height: 1.2, // 注视点离地高度（米）
  },
};

/**
 * 行走步态（render/units/walkGait.ts）：相位按走过的距离推进，所以步频天然跟着速度变，支撑脚不在地上滑。
 * “一个周期” = 左右脚各迈一步。
 */
export const WALK_GAIT = {
  /** 一个周期走过的距离（米）= cycleBase + cycleK × 速度，夹在 [cycleMin, cycleMax] 之间 */
  cycleBase: 0.86,
  cycleK: 0.17,
  cycleMin: 0.9,
  cycleMax: 1.45,
  /** 支撑相占一个周期的比例（每只脚着地的时间）：慢走 0.62，快走降到 0.5（没有腾空） */
  dutySlow: 0.62,
  dutyFast: 0.5,
  dutySpeed: [0.8, 3.2] as [number, number], // 在这两个速度之间从 dutySlow 过渡到 dutyFast
  /** 摆动脚离地的最大高度（米）= liftBase + liftK × 速度 */
  liftBase: 0.06,
  liftK: 0.025,
  /** 腿伸直程度的上限：髋到踝的距离不超过腿长 × reach，膝盖始终微屈，不会“锁死”成一根棍 */
  reach: 0.985,
  /** 后跟离地（推离）：支撑相最后 heelLiftSpan 比例里，脚跟抬起到 heelLift 弧度（绕脚尖转） */
  heelLift: 0.42,
  heelLiftSpan: 0.4,
  /** 脚尖到踝的水平距离（米，绕脚尖转时用） */
  toeLength: 0.13,
  /** 落地时脚尖翘起（弧度），在支撑相前 toeUpSpan 比例里放平 */
  toeUp: 0.22,
  toeUpSpan: 0.25,
  /** 双臂与对侧腿同步前后摆：肩的摆角 = armSwing × 对侧髋角；持武器的那只手乘 heldArmScale */
  armSwing: 0.85,
  heldArmScale: 0.35,
  /** 手臂前摆时肘多弯一些（弧度 / 弧度） */
  elbowFollow: 0.45,
  /** 躯干：前倾（满速时，弧度）、腰随步伐反向扭转、左右重心摆动 */
  lean: 0.07,
  twist: 0.1,
  roll: 0.035,
  shift: 0.018, // 重心左右移（米）
  /** 起停：行走权重向目标靠拢的速率（1/秒）；速度低于 stopSpeed 视为停下 */
  blendIn: 12,
  blendOut: 8,
  stopSpeed: 0.15,
  /**
   * 袍摆、裙甲、战袍被腿顶开（防穿模）：腿（髋 → 膝 → 踝）加上腿的粗细 robeClearance（米）碰到布料时，
   * 把布料推开刚好那么多；腿没碰到的地方不动。走路迈腿、战斗中下蹲屈膝都生效。
   */
  robeClearance: 0.11,
};

/**
 * 腿的“踩地”（render/units/legPose.ts）：人形单位的身体下沉（下蹲蓄力、落地缓冲、跳劈落地 …）时，
 * 膝盖弯曲让脚留在地面上，而不是陷进地里；腾空时收腿。
 */
export const LEG_PLANT = {
  /** 腾空时最多把脚收起腿长的这个比例（离地 tuckHeight 米以上收满） */
  tuck: 0.3,
  tuckHeight: 0.6,
};

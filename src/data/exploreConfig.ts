// 探索模式与行走 / 跑步动画的配置（步骤 14、15，DESIGN §11）。纯数据，调手感只改这里。
//
// 坐标系与 formation.ts 相同：+x 向右，+z 朝向相机（屏幕下方），地面 y = 0。
// 长度单位米，角度弧度，时间秒。

import type { UnitId } from '../core/types';

export interface GroundXZ {
  x: number;
  z: number;
}

export const EXPLORE_CONFIG = {
  /** 队长：烬刃（重甲骑士，DESIGN §9.10 F1）。步骤 15 起探索和对话中只显示队长，4 名队员隐藏（§9.12 H1） */
  leaderId: 'A1' as UnitId,
  /** 出生点（队长站的位置），面向 Boss */
  start: { x: 8.5, z: 8.5 } as GroundXZ,
  /** 交谈距离：队长停在 Boss 前方多远（步骤 16 用） */
  talkDistance: 4,
  /** 战败复位点离 Boss 的距离（步骤 19 用） */
  respawnDistance: 9,
  /** 可走区域（矩形，月光阴影覆盖 ±18 以内） */
  bounds: { minX: -17, maxX: 17, minZ: -17, maxZ: 17 },
  /** 队长的移动（步骤 15：跑步；DESIGN §9.12 H4） */
  move: {
    runSpeed: 6.4, // 跑速（米/秒）：点击移动和方向键都用它
    walkSpeed: 3.2, // 走速（米/秒）：走路步态保留，目前探索里不用
    accel: 9, // 起跑加速度（米/秒²）：约 0.7 秒、两三步跑到满速
    decel: 12, // 松开方向键 / 急转弯时的减速度（米/秒²）
    arriveDecel: 7, // 到达终点前的减速度（米/秒²）：满速时约 2.9 米、0.9 秒停下，最后一两步是小跑 / 快走
    turnRate: 10, // 身体转身角速度（弧度/秒）
    maxHeadingRate: 14, // 跑动方向的最大转向角速度（弧度/秒，低速时）
    lateralAccel: 40, // 转弯的侧向加速度上限（米/秒²）：满速时转向角速度 = 40 / 6.4 ≈ 6.3 弧度/秒，转弯半径约 1 米
    cornerSlow: 0.35, // 要转的角度很大（掉头）时目标速度降到满速的这个比例
    waypointRadius: 0.35, // 离拐点这么近就算经过
    arriveRadius: 0.01, // 离终点这么近就停下
    stuckTime: 0.6, // 这么久几乎没动（且离终点还远）就算卡住，从当前位置重算路径
    stuckSpeed: 0.5, // “几乎没动”的速度（米/秒）
    stuckRetries: 3, // 连续卡住这么多次就放弃，停下
  },
  /**
   * 碰撞半径（步骤 15，DESIGN §11.3）：单位与障碍物都是圆，倒地断柱是胶囊。
   * 石柱 = 柱身半径 + pillarPad（含脚下碎石堆），断柱 = 断柱半径 + drumPad。
   */
  collision: {
    unitRadius: 0.4, // 队长（人物）的碰撞半径
    pillarPad: 0.3,
    drumPad: 0,
    brazier: 0.7, // 碗沿实际半径 0.67（DESIGN 原定 0.6，§9.12 H10）
    banner: 0.3,
    bonePile: 1.1,
    boss: 1.4,
    maxStep: 0.15, // 每帧的位移按这个长度分小步做碰撞，最细的旗杆（0.3 + 0.4）也跨不过去
  },
  /** 导航网格（DESIGN §11.3） */
  nav: {
    cellSize: 0.25, // 格子边长（米）
    clearance: 0.15, // 障碍物在“半径 + 单位半径”之外再膨胀这么多：路径与碰撞体之间留的余量
  },
  /** 点击标记：暗金色光圈，从小到大扩开并淡出 */
  clickMarker: {
    color: 0xc9973f,
    radius: 0.55, // 最终半径（米）
    startScale: 0.35, // 开始时的大小（× radius）
    width: 0.16, // 环宽（× radius）
    duration: 0.7, // 淡出时长（秒）
    opacity: 0.9,
  },
  /** 鼠标悬停 Boss：轮边光换成暗金色并加强（等效于轮廓高亮，DESIGN §9.12 H8） */
  bossHover: {
    color: 0xd9a54a,
    strength: 1.35,
    power: 2.2,
    fade: 0.15, // 淡入淡出（秒）
  },
  /** 探索相机：与战斗相同的俯角、FOV、方位角，只是更近、跟随队长 */
  camera: {
    distance: 22, // 相机到注视点的距离（战斗为 32.5）
    lead: 0.8, // 注视点沿行进方向前移（米）
    smoothTime: 0.35, // 跟随的平滑时间（临界阻尼弹簧，秒）
    margin: 4, // 注视点离可走区域边界至少这么远（米），相机看不到地面以外
    height: 1.2, // 注视点离地高度（米）
  },
  /** 与 Boss 对话（步骤 16，SPEC §14.2） */
  dialog: {
    arriveTolerance: 1.0, // 跑到离交谈点这么近才开始对话（被挡住停在半路时取消，米）
    faceTolerance: 0.04, // 面向 Boss 的误差小于这个角度（弧度）才弹出对话框
    typeSpeed: 24, // 逐字显示的速度（字/秒）
    /** 对话中的镜头：注视点移到队长与 Boss 之间（bossBias = 0 在队长身上，1 在 Boss 身上），距离略微拉近 */
    camera: { distance: 17, bossBias: 0.5, smoothTime: 0.6 },
    gestureFade: 0.25, // 说话动作淡入 / 淡出（秒）
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
 * 跑步步态（步骤 15，DESIGN §11.5）：同一个 WalkGait 的第二套参数。跑步权重 run 随速度从 runFrom 到 runFull 平滑升到 1，
 * 各参数在走路（WALK_GAIT）与跑步之间按 run 插值；速度 ≤ runFrom 时与走路完全一致。
 * 速度、长度都是模型坐标（米，未乘单位缩放）。
 */
export const RUN_GAIT = {
  /** 跑步权重：速度从 runFrom 升到 runFull 时由 0 平滑升到 1 */
  runFrom: 3.2,
  runFull: 5.0,
  /** 一个周期走过的距离 = cycleK × 速度（即每个周期的时长固定约 cycleK 秒），不小于 cycleMin */
  cycleK: 0.52,
  cycleMin: 1.6,
  /** 支撑相比例：小于 0.5 的部分就是两脚都离地的腾空 */
  duty: 0.22,
  /** 摆动脚离地的最大高度（米）：脚跟上踢收到臀下 */
  lift: 0.3,
  /** 最高点在摆动相的位置（比例；走路是 0.5 的正弦拱） */
  liftPeak: 0.4,
  /** 推离时脚跟抬起、落地时脚尖翘起（弧度） */
  heelLift: 0.7,
  toeUp: 0.12,
  /** 摆动曲线两端“速度匹配”的衰减宽度（摆动相比例）：越小，离地后继续后退、落地前回扒的距离越短 */
  swingSnap: 0.08,
  /** 身体起伏：支撑中段下沉 sink + bob（屈膝缓冲），腾空中段 sink − bob − flightLift（米，负数 = 比站立时高） */
  sink: 0.025,
  bob: 0.03,
  /** 腾空中段身体再上抛（米）：比站立时还高，起伏比走路明显得多 */
  flightLift: 0.03,
  /** 前倾（弧度）；着地范围以髋的投影为中心：脚的前后位置整体前移 髋的前移量 × center */
  lean: 0.2,
  center: 0.6,
  /**
   * 手臂：肩的摆角 = armSwing × 对侧腿的摆角；肘固定屈起 elbowBend（弧度），前摆时再多弯 elbowFollow。
   * 持武器的手：摆幅 × heldArmScale、屈肘 × heldElbowScale——武器压低、贴着身体，不会每步都扫过脸前（刀光泛光一闪一闪）
   */
  armSwing: 1.25,
  elbowBend: 1.3,
  elbowFollow: 0.3,
  heldArmScale: 0.3,
  heldElbowScale: 0.3,
  /** 腰的扭转、左右晃动、重心左右移 */
  twist: 0.2,
  roll: 0.02,
  shift: 0.01,
  /** 披风、袍摆的甩动：次级运动的偏移上限 × (1 + capeOffset·run)、飘动上限 × (1 + capeFlutter·run) */
  capeOffset: 0.35,
  capeFlutter: 1.5,
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

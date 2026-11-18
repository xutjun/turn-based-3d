// 入场过场的配置（步骤 17，DESIGN §11.4、§11.8）。纯数据，调演出只改这里。
//
// 时间单位秒（1 倍速下），长度米，角度弧度。时间轴全部走 Scheduler，所以倍速、跳过动画、暂停自动生效。
// 坐标系与 formation.ts 相同：+x 向右，+z 朝向相机，地面 y = 0。

import type { UnitId } from '../core/types';

/** 人物被震飞时空中的姿态：flip = 向后翻滚一整圈，lean = 后仰再收回 */
export type TumbleStyle = 'flip' | 'lean';
/** 宝宝入场方式：狼跃入、骨龙飞入、幽灵飘入、魔偶重重落地 */
export type PetEntryStyle = 'leap' | 'fly' | 'float' | 'slam';

export const INTRO_CONFIG = {
  /**
   * a. 队员暗影显形（DESIGN §11.4）：站位是队长局部坐标（x 向队长的左手侧，z 向前），左右各两人，略靠后。
   * 谁站哪个位置不写死：按“战斗中的列号”分配，保证震飞时各自的路线不交叉（见 explore/introPlan.ts）。
   */
  reveal: {
    spots: [
      { x: 1.2, z: -0.3 },
      { x: -1.2, z: -0.3 },
      { x: 2.4, z: -0.7 },
      { x: -2.4, z: -0.7 },
    ],
    /** 显形的单位离障碍物表面、彼此之间至少这么远（落在障碍里时取最近的可走点） */
    minGap: 1.0,
    spread: 0.25, // 队长的影子向两侧铺开成两片暗影池
    start: 0.1, // 第一名队员开始升起（相对过场开始）
    stagger: 0.08, // 队员之间的间隔
    rise: 0.55, // 每人从暗影里升起、凝成实体的时长
    sink: 0.6, // 开始时埋在地下多深（米）
    poolFade: 0.3, // 暗影池收缩消失
    poolRadius: 1.15, // 暗影池半径
    poolOpacity: 0.85,
    tint: 0x2a1240, // 幽影的颜色（暗紫黑）
    glow: 0x6a2fb0, // 幽影的自发光（暗紫），凝成实体时转为原值
    glowStrength: 0.9,
    smoke: 0x3a2850, // 凝成实体时脚下的暗色烟尘
  },
  /** 相机从对话视角过渡到战斗视角（DESIGN §11.6） */
  camera: { at: 0.6, duration: 1.6 },
  /** Boss 转身正对小队 */
  bossTurn: { at: 0.6, duration: 0.45 },
  /** b. Boss 怒吼：后仰、双翼张开、仰天咆哮，屏幕轻微震动 */
  roar: {
    at: 1.1,
    duration: 0.9,
    rise: 0.25, // 姿态淡入
    shake: 0.07, // 轻微震屏（米）
    shakeEvery: 0.12, // 咆哮期间持续轻震
  },
  /** c. Boss 跺地：抬右腿 → 重踏；冲击波环扩散、地面裂纹发光、尘土碎石飞溅、大幅震屏 */
  stomp: {
    at: 2.0,
    lift: 0.28, // 抬腿
    drop: 0.1, // 重踏下去
    recover: 0.45, // 收回站姿
    shake: 0.55, // 踏地瞬间的大幅震屏（米）
    waveSpeed: 14, // 冲击波扩散速度（米/秒）：到达某人的时刻 = 距离 / 速度
    waveRadius: 16, // 冲击波环最终半径
    waveColor: 0xff6a2a,
    crackColor: 0xff5a1e,
    crackRadius: 4.2, // 地面裂纹的范围（半径）
    crackHold: 1.4, // 裂纹发光保持
    crackFade: 1.2, // 裂纹淡出
    dustColor: 0x8a7a68,
    rubble: 1.6, // 碎石飞溅的量
  },
  /** d. 我方 5 人被震飞：沿抛物线飞向各自的战斗位置 */
  flight: {
    /** 飞行时长 = 按水平距离在 [min, max] 之间（近的短、远的长） */
    duration: { min: 1.0, max: 1.3, nearDist: 4, farDist: 14 },
    /** 最高点高度（根节点离地）：按距离在 [min, max] 之间，各人再错开 heightJitter，避免整齐划一 */
    apex: { min: 2.5, max: 3.5 },
    heightJitter: [0, 0.35, -0.25, 0.2, -0.15],
    /** 被冲击波击中后到离地的延迟（身体先被推得一缩） */
    launchDelay: 0.05,
    /** 规划路线时允许的最大侧偏（米）与最高点上限：直线被挡住时先加侧偏、再加高 */
    maxBend: 4.5,
    maxApex: 5.5,
    /** 身体离障碍物（地面投影）至少这么远；从上方越过时脚下至少高出这么多 */
    clearance: 0.25,
    overClear: 0.35,
    /** 两人在空中的最小间距（同一时刻，三维距离） */
    separation: 1.0, // 两人身体半径各 0.45，留 0.1 米空隙
    bodyRadius: 0.45,
    /** 空中姿态：每人一种（翻滚一圈 / 后仰） */
    tumble: { A0: 'flip', A1: 'lean', A2: 'lean', A3: 'flip', A4: 'lean' } as Record<UnitId, TumbleStyle>,
    leanBack: 0.75, // 后仰的最大角度
    /** 落地：下蹲缓冲（根节点下沉，膝盖由 IK 弯曲）→ 起身 */
    crouchDepth: 0.32,
    crouchDown: 0.12,
    crouchUp: 0.28,
    landDust: 1.2,
    /** 起身后转向敌方（弧度/秒的平滑转身） */
    turn: 0.4,
  },
  /** e. 宝宝入场：全员落地后开始，从主人身后跳入阵型 */
  pets: {
    after: 0.2, // 最后一人落地后多久开始
    stagger: 0.12, // 每只之间的间隔
    behind: 4, // 从主人身后多远出现
    aside: 1.4, // 斜着进来（沿排方向偏开），就位后要转身
    styles: { pet_wolf_grey: 'leap', pet_wolf_red: 'leap', pet_bone_dragon: 'fly', pet_ghost: 'float', pet_golem: 'slam' } as Record<string, PetEntryStyle>,
    leap: { duration: 0.7, apex: 1.4 },
    fly: { duration: 1.0, height: 3.2, flap: 7, flapAmp: 0.55 },
    float: { duration: 1.1, height: 0.9, sway: 0.25 },
    slam: { duration: 0.75, height: 5.5, squash: 0.35, shake: 0.35 },
    turn: 0.35,
    landDust: 1,
  },
  /** g. 头顶血条、顺序条、战斗界面淡入 */
  uiFade: 0.5,
  /**
   * 飞行路线避让的障碍物高度（米）：地面投影离得够远，或从上方越过且脚下高出 overClear，才算不穿模。
   * 石柱、旗杆按无限高处理（只能绕开，不能越过）。
   */
  obstacleHeight: { pillar: Infinity, banner: Infinity, brazier: 1.4, drum: 1.2, bonePile: 0.9, boss: 4.4 } as Record<string, number>,
};

export type IntroConfig = typeof INTRO_CONFIG;

/**
 * 过场里的关节姿态（相对站姿的偏移，通道名与进攻动作相同；没有该关节的模型自动忽略）。
 * 由过场时间轴按权重写进 UnitView 的特技层（stunt.pose）。
 */
export const INTRO_POSES = {
  /** Boss 怒吼：后仰、仰头、双翼向两侧张开并上扬、双臂张开（Boss 的翼 y 为负 = 展开，见 dialogues.ts） */
  roar: {
    'head.x': -0.75,
    'chest.x': -0.3,
    'spine.x': -0.2,
    'wingL.y': -0.8,
    'wingR.y': 0.8,
    'wingL.z': 0.4,
    'wingR.z': -0.4,
    'shoulderL.z': 0.55,
    'shoulderR.z': -0.5,
    'shoulderL.x': -0.35,
    'shoulderR.x': -0.3,
    'elbowL.x': -0.5,
    'elbowR.x': -0.4,
  } as Record<string, number>,
  /** 怒吼时头和胸口的颤动（× sin(2π·hz·t)） */
  roarShiver: { pose: { 'head.y': 0.05, 'chest.x': 0.03, 'head.x': 0.04 } as Record<string, number>, hz: 9 },
  /** Boss 抬右腿（髋为负 = 大腿前抬，膝为正 = 屈膝），身体略后靠、双臂张开保持平衡 */
  stompLift: {
    'hipR.x': -1.15,
    'kneeR.x': 1.55,
    'footR.x': 0.35,
    'spine.x': -0.12,
    'chest.x': -0.05,
    'shoulderL.z': 0.35,
    'shoulderR.z': -0.35,
    'wingL.y': -0.5,
    'wingR.y': 0.5,
    'root.roll': 0.05,
  } as Record<string, number>,
  /** 重重踏下：右腿踩实、全身下沉前压、低头，双翼猛地向前一扇 */
  stompDown: {
    'hipR.x': -0.2,
    'kneeR.x': 0.35,
    'root.lift': -0.12,
    'spine.x': 0.28,
    'chest.x': 0.12,
    'head.x': 0.2,
    'shoulderL.z': 0.2,
    'shoulderR.z': -0.2,
    'wingL.y': -0.2,
    'wingR.y': 0.2,
  } as Record<string, number>,
  /** 被震飞：双臂甩向前上方、仰头、胸口后仰（人物） */
  blown: {
    'shoulderL.x': -1.2,
    'shoulderR.x': -1.0,
    'shoulderL.z': 0.5,
    'shoulderR.z': -0.45,
    'elbowL.x': -0.4,
    'elbowR.x': -0.3,
    'head.x': -0.35,
    'chest.x': -0.2,
  } as Record<string, number>,
  /** 空中收腿（腿离地后不再踩地，由这层把膝盖收起来） */
  tuck: { 'hipL.x': -0.9, 'kneeL.x': 1.5, 'hipR.x': -0.6, 'kneeR.x': 1.2 } as Record<string, number>,
  /** 宝宝入场：狼腾空时前腿前伸、后腿后蹬 */
  wolfLeap: { 'foreLegL.x': -0.7, 'foreLegR.x': -0.6, 'hindLegL.x': 0.7, 'hindLegR.x': 0.6, 'head.x': -0.2 } as Record<string, number>,
  /** 魔偶下落：双臂高举，落地砸下 */
  golemFall: { 'shoulderL.x': -2.2, 'shoulderR.x': -2.2, 'head.x': -0.2 } as Record<string, number>,
};

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
    rimGlow: 0x8a3ce0, // 暗影池的发光边与符文（暗紫，叠加发光）
    runeSpin: 0.9, // 符文旋转速度（弧度/秒）
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
    rise: 0.2, // 姿态淡入
    shake: 0.22, // 咆哮期间的震屏（米）：起声那一下最重，之后持续
    shakeFirst: 0.32,
    shakeEvery: 0.1,
    /** 向外扩散的暗红气浪：两道，间隔 every 秒，每道 duration 秒扩到 radius 米，离地 height 米 */
    wave: { color: 0xa01c12, radius: 9, duration: 0.75, every: 0.3, height: 0.6, opacity: 0.9 },
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
  /**
   * e. 宝宝入场：全员落地后开始。宝宝从主人身后起跳，越过主人头顶落到主人正前方的前排格子
   * （狼跃过、骨龙飞越、幽灵飘过）；魔偶跳得低，从主人身侧绕到前方（侧偏用 render/units/detour.ts 的同一套计算）。
   */
  pets: {
    after: 0.2, // 最后一人落地后多久开始
    stagger: 0.12, // 每只之间的间隔
    styles: { pet_wolf_grey: 'leap', pet_wolf_red: 'leap', pet_bone_dragon: 'fly', pet_ghost: 'float', pet_golem: 'slam' } as Record<string, PetEntryStyle>,
    /** 越过主人头顶时，身体最低点比主人头顶至少高出这么多（米） */
    overClear: 0.35,
    /** 宝宝身体半径（判断是否碰到主人用） */
    bodyRadius: 0.4,
    /** behind = 起跳点在主人身后多远；apex = 最高点（越顶时按主人身高自动加高） */
    leap: { duration: 0.8, behind: 1.8, apex: 2.6 },
    fly: { duration: 1.1, behind: 3.0, apex: 3.4, flap: 7, flapAmp: 0.55 },
    float: { duration: 1.2, behind: 2.0, apex: 2.7, sway: 0.25 },
    slam: { duration: 0.8, behind: 1.6, apex: 0.9, squash: 0.35, shake: 0.35 },
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
    'root.pitch': -0.18, // 整个身体向后仰
    'head.x': -1.05, // 仰天
    'chest.x': -0.5,
    'spine.x': -0.38,
    'wingL.y': -1.25, // 双翼完全展开并上扬
    'wingR.y': 1.25,
    'wingL.z': 0.65,
    'wingR.z': -0.65,
    'shoulderL.z': 0.95, // 双臂向两侧大张
    'shoulderR.z': -0.9,
    'shoulderL.x': -0.6,
    'shoulderR.x': -0.55,
    'elbowL.x': -0.7,
    'elbowR.x': -0.6,
  } as Record<string, number>,
  /** 怒吼时头和胸口的颤动（× sin(2π·hz·t)） */
  roarShiver: { pose: { 'head.y': 0.07, 'chest.x': 0.05, 'head.x': 0.06, 'wingL.z': 0.06, 'wingR.z': -0.06 } as Record<string, number>, hz: 9 },
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

/** 小怪出场方式（步骤 18）：骷髅兵拼骨架、堕落骑士灵魂凝聚、亡灵法师鬼火汇聚、恶魔祭司暗影法阵升起 */
export type SummonStyle = 'bones' | 'soul' | 'wisps' | 'rise';

/**
 * 召唤演出（步骤 18，SPEC §14.3，DESIGN §11.8）：宝宝开始起跳时同时开始，与宝宝入场并行。时刻相对召唤开始（1 倍速，秒）。
 *   Boss 一次短促的举臂召唤（约 1 秒，做完回到待机）→ 小怪按批次直接在各自阵位出场 → 全部就位后 Boss 短吼 → 战斗界面淡入。
 */
export const SUMMON_CONFIG = {
  /** 宝宝开始起跳后多久开始召唤（0 = 同时） */
  after: 0,
  /** 各种小怪的出场方式（按模板） */
  styles: {
    enemy_skeleton: 'bones',
    enemy_fallen_knight: 'soul',
    enemy_necromancer: 'wisps',
    enemy_demon_priest: 'rise',
  } as Record<string, SummonStyle>,
  /** Boss 一次短促的召唤动作：举臂 raise 秒、停 hold 秒、平滑放下回到待机 lower 秒（合计约 1 秒，不等小怪出场完） */
  cast: { raise: 0.35, hold: 0.25, lower: 0.4 },
  /**
   * 出场批次：按顺序依次出场，at = 这一批开始出场的时刻（相对召唤开始），同一批内每只再错开 stagger 秒。
   * 小怪直接在各自的阵位开始出场动画。
   */
  batches: [
    { templates: ['enemy_skeleton'], at: 0.3, stagger: 0.1 },
    { templates: ['enemy_fallen_knight'], at: 1.2, stagger: 0.12 },
    { templates: ['enemy_necromancer'], at: 1.85, stagger: 0 },
    { templates: ['enemy_demon_priest'], at: 2.4, stagger: 0.12 },
  ] as { templates: string[]; at: number; stagger: number }[],
  /**
   * 骷髅兵：地面裂开 → 骨头从地里冒出、飞起拼合（按部件依次：脊椎骨盆、肋骨、头骨、双臂、双腿）→
   * 盔甲和武器落到身上 → 眼火点亮 → 从佝偻站直。
   */
  bones: {
    duration: 2.0,
    crackColor: 0xb8361e,
    /** 各部件开始飞的时刻（相对这只开始）与飞行时长；骨头从阵位周围 scatter 米、地下 depth 米处冒出，最高飞到 arc 米 */
    parts: { spine: 0.12, ribs: 0.26, skull: 0.4, arms: 0.52, legs: 0.62 } as Record<string, number>,
    stagger: 0.03, // 同一部件里的几块骨头依次错开
    fly: 0.5,
    scatter: { min: 0.5, max: 1.1 },
    depth: 0.25,
    arc: 0.9,
    tumble: 4.5, // 飞行中翻转的角度（弧度，落位时归零）
    /** 盔甲和武器从上方 drop 米落下 */
    gearAt: 1.3,
    gearFall: 0.22,
    drop: 0.9,
    eyesAt: 1.6,
    /** 站起：从佝偻（SUMMON_POSES.hunch）站直，同时脚从裂缝里拔出（根节点从 -sink 回到 0） */
    standAt: 1.6,
    stand: 0.4,
    sink: 0.12,
    boneColor: 0xd8d2bc,
    eyeColor: 0x9fe8ff,
  },
  /** 堕落骑士：地面升起黑烟 → 半透明的灵魂轮廓浮现 → 逐渐凝成实体（盔甲由暗到亮）→ 眼光亮起、一次光爆 */
  soul: {
    duration: 1.6,
    smoke: 0x1a1418,
    smokeFor: 0.9, // 黑烟持续冒的时长
    appearAt: 0.25, // 灵魂开始浮现
    condense: 1.25, // 浮现到凝成实体的时长
    rise: 0.35, // 灵魂从地面下浮起的高度（米）
    look: { tint: 0x16202c, glow: 0x5a86b8, glowStrength: 1.0 },
    burst: 0xffa02a,
  },
  /** 亡灵法师：绿色鬼火从四周汇聚 → 灵魂显现、凝成实体 → 骨杖最后出现在手中 */
  wisps: {
    duration: 1.7,
    color: 0x6cff8a,
    gather: 0.6, // 鬼火汇聚
    radius: 2.2,
    appearAt: 0.45,
    condense: 0.9,
    look: { tint: 0x0e2a16, glow: 0x3cd86a, glowStrength: 1.1 },
    staffAt: 1.35,
    staffGrow: 0.25,
  },
  /** 恶魔祭司：脚下升起暗影法阵 → 身影从法阵中自下而上升起成形 → 法阵收缩消失 */
  rise: {
    duration: 1.6,
    circleIn: 0.3,
    radius: 1.2,
    color: 0x3a0c3a,
    glow: 0xd2368a,
    riseAt: 0.2,
    rise: 1.05,
    depth: 2.3, // 开始时身影在地下多深（米）
    look: { tint: 0x2a0a26, glow: 0xb0247a, glowStrength: 0.9 },
    circleOut: 0.3,
  },
  /** 全部就位后 Boss 的短吼 */
  roar: { after: 0.15, duration: 0.65, shake: 0.18 },
};

export type SummonConfig = typeof SUMMON_CONFIG;

/** 召唤演出里的姿态（通道名与进攻动作相同，没有该关节的模型自动忽略） */
export const SUMMON_POSES = {
  /** Boss 短促的召唤动作：双臂（连同武器）高举过头、挺胸仰头、双翼展开（Boss 的翼 y 为负 = 展开），约 1 秒后回到待机 */
  cast: {
    'shoulderL.x': -2.5,
    'shoulderR.x': -2.6,
    'shoulderL.z': 0.35,
    'shoulderR.z': -0.35,
    'elbowL.x': -0.35,
    'elbowR.x': -0.25,
    'chest.x': -0.22,
    'spine.x': -0.1,
    'head.x': -0.35,
    'wingL.y': -0.85,
    'wingR.y': 0.85,
    'wingL.z': 0.35,
    'wingR.z': -0.35,
  } as Record<string, number>,
  /** 骷髅兵拼合时的佝偻：弯腰、低头、双臂下垂 */
  hunch: {
    'spine.x': 0.45,
    'chest.x': 0.3,
    'head.x': 0.45,
    'shoulderL.x': 0.25,
    'shoulderR.x': 0.45,
    'elbowR.x': 0.5,
  } as Record<string, number>,
  /** 短吼：后仰、仰头、双翼张开（比入场怒吼小） */
  roar: {
    'root.pitch': -0.1,
    'head.x': -0.7,
    'chest.x': -0.3,
    'wingL.y': -0.9,
    'wingR.y': 0.9,
    'wingL.z': 0.4,
    'wingR.z': -0.4,
    'shoulderL.z': 0.6,
    'shoulderR.z': -0.6,
  } as Record<string, number>,
};

// ----------------------------------------------------------------------
// 战后过场（步骤 19，SPEC §14.4，DESIGN §11.4、§11.8）
// ----------------------------------------------------------------------

/**
 * 战后过场：玩家在结算画面上点按钮之后播放。时间单位秒（1 倍速），全部走 Scheduler（倍速、跳过动画、暂停自动生效）。
 * 胜利（“重新开始”）：倒地的队员站起 → 宝宝跳回主人身后淡出、4 名队员化入暗影（同时）→ 黑场复位（队长到出生点、Boss 在原位）→ 淡入 → 相机回到探索视角。
 * 失败（“再来一次”）：黑场淡出 → 黑场中复位（队长到离 Boss respawnDistance 米的复位点，队员、宝宝、小怪隐藏，Boss 回原位）→ 淡入 → 相机回到探索视角。
 */
export const OUTRO_CONFIG = {
  victory: {
    stand: 0.8, // 倒地的队员用复活动画站起（没人倒地时跳过这一段）
    after: 0.15, // 站起后多久开始隐去
  },
  /** 4 名队员化入暗影（入场显形的反向：实体 → 幽影 → 沉入地面），颜色与显形相同 */
  vanish: {
    stagger: 0.08, // 队员之间的间隔
    spread: 0.25, // 脚下的暗影池展开
    duration: 0.7, // 化入暗影、沉入地面
    sink: 0.6, // 最后沉到地下多深（米）
    poolFade: 0.3, // 暗影池收缩消失
    poolRadius: 1.0,
    poolOpacity: 0.85,
    tint: INTRO_CONFIG.reveal.tint,
    glow: INTRO_CONFIG.reveal.glow,
    rimGlow: INTRO_CONFIG.reveal.rimGlow,
    glowStrength: INTRO_CONFIG.reveal.glowStrength,
    runeSpin: INTRO_CONFIG.reveal.runeSpin,
  },
  /** 宝宝沿入场路线倒着跳回主人身后，然后淡出（幽影外观，不透明度到 0 后隐藏） */
  pets: {
    turn: 0.2, // 先转身朝向主人身后
    speed: 1.0, // 路线时长 × speed（1 = 与入场相同）
    fade: 0.35,
    look: { tint: 0x1c1428, glow: 0x4a2c80, glowStrength: 0.6 },
  },
  /** 黑场复位（胜利、失败共用） */
  blackout: {
    fadeOut: 0.5, // 黑场淡出
    hold: 0.1, // 全黑停留（期间复位）
    fadeIn: 0.5,
    camera: 1.6, // 相机从战斗视角回到探索视角
  },
};

export type OutroConfig = typeof OUTRO_CONFIG;

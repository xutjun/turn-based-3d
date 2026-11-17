// 进攻动画配置（步骤 11 · v0.4）。纯数据：每种进攻动作的关键姿态、各阶段时长、缓动曲线，
// 冲刺 / 扑跃 / 踏步的步态，旋风斩的节奏，次级运动（披风、袍摆、链条的惯性）的弹簧参数。
// 调手感只改这里；逻辑在 render/units/UnitMotion.ts（纯计算）和 render/director/Choreographer.ts（编排）。
//
// 一次进攻的节奏（每个阶段的时长都在 MoveTiming 里）：
//   预备 anticipation（蓄力）→ 发力 strike → 命中 hold（顿住 2~4 帧）→ 余势 follow（过冲、回弹）
//   → beat（停顿一拍）→ 收招 recover（收刀 / 回撤，回到站姿）
//
// 姿态（BodyPose）是“相对自然站姿的偏移量”，没写的通道为 0。通道名：
//   root.forward / root.side / root.lift   整体位移（米，未乘模型缩放）：沿朝向前移 / 向左 / 离地
//   root.pitch / root.roll / root.turn     整体转动（弧度）：前倾为正 / 侧倾 / 绕竖轴转身（正 = 向左转）
//   root.stretch / root.squash             整体形变：沿前后方向拉长 / 压扁（0.2 = 20%）
//   <关节>.x / .y / .z                     关节转动（弧度）。关节名见 render/units/animatedJoints.ts：
//       人形：shoulderR elbowR shoulderL elbowL spine chest head（肩 x 负 = 手臂向前上抬；右肩 z 负 = 外展）
//       狼：neck head jaw tail foreLegL/R hindLegL/R（腿 x 负 = 向前摆）
//       魔偶：torso head shoulderL/R legL/R      骨龙：head jaw wingL/R foreL/R      幽灵：head shoulderL/R
//   weapon.x / .y / .z                     武器相对手的附加转动
//   weapon.aim                             0~1：把武器尖端拧向正前方（突刺时枪 / 剑保持指向目标）
//   weapon.aimPitch                        瞄准时的上扬角（弧度）
// 模型上没有的关节会被忽略，所以同一套动作可以给骨架略有不同的模型共用。

export type EaseName = 'linear' | 'in' | 'out' | 'inOut' | 'inCubic' | 'outCubic' | 'inBack' | 'outBack' | 'outElastic';

export type BodyPose = Readonly<Record<string, number>>;

/** 一个关键姿态：span 是它在所属阶段里占的时长比例（同一阶段内各 span 会被归一化） */
export interface PoseKey {
  pose: BodyPose;
  span?: number;
  ease?: EaseName;
}

/** 一个动作各阶段的时长（秒，1 倍速；倍速和跳过动画由调度器统一处理） */
export interface MoveTiming {
  anticipation: number; // 预备（蓄力）
  strike: number; // 发力
  hold: number; // 命中后顿住（2~4 帧 ≈ 0.033~0.066 秒）
  follow: number; // 余势：过冲、回弹
  beat: number; // 余势后的停顿一拍（只在这次出手的最后一击之后）
  recover: number; // 收招：回到站姿
}

/** 动作附带的效果 */
export interface MoveFx {
  heavy?: boolean; // 重击：目标受击反馈更重（重击火花、更大的抖动和顿帧）
  shockwave?: number; // 命中时地面冲击波环的半径（米）；不填 = 没有
  shake?: number; // 命中时额外的镜头抖动（米）
  groundDust?: number; // 发力结束（落地 / 踏地）时脚下的尘土量
  slash?: number; // 斩击光弧的样式：0 斜劈 / 1 横斩 / 2 竖劈；−1 = 不画光弧
  slashScale?: number; // 斩击光弧的大小倍率（默认 1）
  trail?: boolean; // 发力时是否拖出武器光轨（默认 true）
  loud?: boolean; // 挥击声更重
}

export interface MoveDef {
  label: string; // 给联系表和调试用的名字
  timing: MoveTiming;
  ready: PoseKey[]; // 预备阶段依次经过的姿态（最后一个 = 蓄满）
  strike: PoseKey[]; // 发力阶段依次经过的姿态（最后一个 = 命中瞬间）
  follow: PoseKey[]; // 余势阶段依次经过的姿态
  recover?: PoseKey[]; // 收招途中经过的姿态（收刀、回撤）；之后回到站姿
  fx?: MoveFx;
}

/** 近战动作的编号（StageUnit.windup / release 的 variant） */
export const MELEE = {
  basic: 0, // 普攻（各武器自己的招式）；连斩第 1 击
  second: 1, // 第二式：连斩第 2 击、被动“连击”的第二击
  heavy: 2, // 跃起重劈：连斩第 3 击
  spin: 3, // 旋身横扫：旋风斩途中的每一击
  spinFinish: 4, // 旋风斩最后一击：大幅度旋转后砸地
} as const;

/** 弓的动作编号 */
export const BOW = { shot: 0, quick: 1 } as const;
/**
 * 施法动作编号（步骤 11b 按法术区分挥杖轨迹）：point = 法术普攻（挑指），invoke = 群体召唤（通用），bless = 治疗 / 复活，
 * seal = 封印（画圈前指），fire / thunder = 单体火 / 雷，groupFire / groupThunder = 群体火 / 雷。
 * 没有这么多动作的档案（宝宝）回退到第 0 个。
 */
export const CAST = { point: 0, invoke: 1, bless: 2, seal: 3, fire: 4, thunder: 5, groupFire: 6, groupThunder: 7 } as const;

// ---------------------------------------------------------------------------
// 人形：刀 / 剑 / 枪的普攻
// ---------------------------------------------------------------------------

const T_BASIC: MoveTiming = { anticipation: 0.26, strike: 0.09, hold: 0.055, follow: 0.16, beat: 0.12, recover: 0.32 };

/** 刀：右上到左下的斜劈，劈完顺势收刀到左腰 */
const BLADE_CHOP: MoveDef = {
  label: '刀·斜劈收刀',
  timing: T_BASIC,
  ready: [
    {
      // 举刀过右肩，躯干向右拧、略后仰，左手前探配重
      pose: {
        'shoulderR.x': -2.25, 'shoulderR.z': -0.55, 'elbowR.x': -0.55, 'shoulderL.x': -0.55, 'elbowL.x': -0.3,
        'spine.y': -0.6, 'spine.x': -0.14, 'chest.x': -0.1, 'head.y': 0.35,
        'root.turn': -0.28, 'root.pitch': -0.1, 'root.forward': -0.14, 'root.lift': 0.03,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      // 重心前压，躯干向左拧，刀从右上劈到左下
      pose: {
        'shoulderR.x': -0.6, 'shoulderR.z': 0.6, 'elbowR.x': 0.5, 'shoulderL.x': 0.45, 'elbowL.x': -0.2,
        'spine.y': 0.62, 'spine.x': 0.3, 'chest.x': 0.1, 'head.y': -0.25, 'head.x': 0.08,
        'root.turn': 0.22, 'root.pitch': 0.24, 'root.forward': 0.4, 'root.lift': -0.07, 'weapon.x': 0.35,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      // 过冲：刀继续扫到身体左侧
      pose: {
        'shoulderR.x': -0.05, 'shoulderR.z': 0.85, 'elbowR.x': 0.55, 'shoulderL.x': 0.6, 'elbowL.x': -0.2,
        'spine.y': 0.9, 'spine.x': 0.36, 'chest.x': 0.12, 'head.y': -0.4, 'head.x': 0.1,
        'root.turn': 0.3, 'root.pitch': 0.3, 'root.forward': 0.46, 'root.lift': -0.11, 'weapon.x': 0.6,
      },
      span: 0.6,
      ease: 'outCubic',
    },
    {
      // 回弹
      pose: {
        'shoulderR.x': -0.2, 'shoulderR.z': 0.75, 'elbowR.x': 0.35, 'shoulderL.x': 0.4, 'elbowL.x': -0.2,
        'spine.y': 0.72, 'spine.x': 0.26, 'head.y': -0.3,
        'root.turn': 0.24, 'root.pitch': 0.22, 'root.forward': 0.4, 'root.lift': -0.08, 'weapon.x': 0.5,
      },
      span: 0.4,
      ease: 'inOut',
    },
  ],
  recover: [
    {
      // 收刀：刀尖向后下，收到左腰，左手扶鞘，身体直起
      pose: {
        'shoulderR.x': -0.5, 'shoulderR.z': 0.95, 'elbowR.x': -0.85, 'shoulderL.x': -0.25, 'elbowL.x': -0.95, 'shoulderL.z': -0.2,
        'spine.y': 0.3, 'spine.x': 0.06, 'head.y': -0.1,
        'root.turn': 0.1, 'root.pitch': 0.04, 'root.forward': 0.12, 'weapon.x': 1.5, 'weapon.z': 0.5,
      },
      span: 0.55,
      ease: 'inOut',
    },
  ],
  fx: { slash: 0 },
};

/** 剑：从右向左的横斩 */
const SWORD_SLASH: MoveDef = {
  label: '剑·横斩',
  timing: T_BASIC,
  ready: [
    {
      // 剑平拉到身体右后方，躯干大幅右拧
      pose: {
        'shoulderR.x': -0.55, 'shoulderR.z': -1.15, 'shoulderR.y': -0.75, 'elbowR.x': 0.35, 'shoulderL.x': -0.7, 'elbowL.x': -0.5,
        'spine.y': -0.95, 'spine.x': 0.05, 'head.y': 0.6,
        'root.turn': -0.35, 'root.forward': -0.12, 'root.lift': -0.04, 'weapon.x': 0.9,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      // 腰带动手臂横扫到正前
      pose: {
        'shoulderR.x': -0.75, 'shoulderR.z': -1.15, 'shoulderR.y': 1.35, 'elbowR.x': 0.55, 'shoulderL.x': 0.5, 'elbowL.x': -0.3,
        'spine.y': 0.75, 'spine.x': 0.2, 'head.y': -0.35,
        'root.turn': 0.25, 'root.pitch': 0.14, 'root.forward': 0.36, 'root.lift': -0.08, 'weapon.x': 0.9,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -0.7, 'shoulderR.z': -1.0, 'shoulderR.y': 2.0, 'elbowR.x': 0.5, 'shoulderL.x': 0.65, 'elbowL.x': -0.3,
        'spine.y': 1.05, 'spine.x': 0.24, 'head.y': -0.5,
        'root.turn': 0.34, 'root.pitch': 0.18, 'root.forward': 0.42, 'root.lift': -0.1, 'weapon.x': 0.9,
      },
      span: 0.6,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderR.x': -0.7, 'shoulderR.z': -0.9, 'shoulderR.y': 1.75, 'elbowR.x': 0.3, 'shoulderL.x': 0.45, 'elbowL.x': -0.3,
        'spine.y': 0.85, 'spine.x': 0.16, 'head.y': -0.4,
        'root.turn': 0.26, 'root.pitch': 0.12, 'root.forward': 0.36, 'root.lift': -0.07, 'weapon.x': 0.8,
      },
      span: 0.4,
      ease: 'inOut',
    },
  ],
  recover: [
    {
      // 剑收回身前，立剑
      pose: {
        'shoulderR.x': -0.7, 'shoulderR.z': 0.2, 'elbowR.x': -0.7, 'spine.y': 0.2, 'root.forward': 0.1, 'root.turn': 0.06,
      },
      span: 0.5,
      ease: 'inOut',
    },
  ],
  fx: { slash: 1 },
};

/** 剑：直刺（剑的第二式） */
const SWORD_THRUST: MoveDef = {
  label: '剑·直刺',
  timing: { anticipation: 0.2, strike: 0.08, hold: 0.05, follow: 0.14, beat: 0.1, recover: 0.26 },
  ready: [
    {
      pose: {
        'shoulderR.x': 0.55, 'elbowR.x': -0.95, 'shoulderL.x': -1.0, 'elbowL.x': 0.1, 'spine.y': -0.55, 'head.y': 0.4,
        'root.turn': -0.3, 'root.forward': -0.16, 'root.lift': -0.06, 'weapon.aim': 1,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderR.x': -1.2, 'elbowR.x': 0.72, 'shoulderL.x': 0.5, 'elbowL.x': -0.3, 'spine.y': 0.5, 'spine.x': 0.22, 'head.y': -0.3,
        'root.turn': 0.2, 'root.pitch': 0.18, 'root.forward': 0.5, 'root.lift': -0.09, 'weapon.aim': 1,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -1.28, 'elbowR.x': 0.75, 'shoulderL.x': 0.6, 'elbowL.x': -0.3, 'spine.y': 0.6, 'spine.x': 0.26,
        'root.turn': 0.24, 'root.pitch': 0.22, 'root.forward': 0.56, 'root.lift': -0.11, 'weapon.aim': 1,
      },
      span: 0.45,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderR.x': -0.3, 'elbowR.x': -0.5, 'spine.y': 0.1, 'root.forward': 0.2, 'root.lift': -0.03, 'weapon.aim': 0.6,
      },
      span: 0.55,
      ease: 'inOut',
    },
  ],
  fx: { slash: 2, slashScale: 0.7 },
};

/** 枪：沉身蓄力 → 突刺 → 回撤 */
const SPEAR_THRUST: MoveDef = {
  label: '枪·蓄力突刺',
  timing: { anticipation: 0.34, strike: 0.08, hold: 0.06, follow: 0.2, beat: 0.12, recover: 0.3 },
  ready: [
    {
      // 侧身，枪拉到右腰后，左手前探扶枪
      pose: {
        'shoulderR.x': 0.55, 'elbowR.x': -0.6, 'shoulderL.x': -0.95, 'elbowL.x': -0.25, 'shoulderL.z': -0.35,
        'spine.y': -0.6, 'spine.x': 0.1, 'head.y': 0.5,
        'root.turn': -0.38, 'root.forward': -0.16, 'root.lift': -0.07, 'root.pitch': 0.05, 'weapon.aim': 1,
      },
      span: 0.6,
      ease: 'outCubic',
    },
    {
      // 蓄满：再沉一点、再拧一点
      pose: {
        'shoulderR.x': 0.78, 'elbowR.x': -0.75, 'shoulderL.x': -1.05, 'elbowL.x': -0.2, 'shoulderL.z': -0.35,
        'spine.y': -0.78, 'spine.x': 0.14, 'head.y': 0.6,
        'root.turn': -0.46, 'root.forward': -0.24, 'root.lift': -0.12, 'root.pitch': 0.08, 'weapon.aim': 1,
      },
      span: 0.4,
      ease: 'inOut',
    },
  ],
  strike: [
    {
      // 蹬地前冲，右臂送直，枪尖直取目标
      pose: {
        'shoulderR.x': -1.3, 'elbowR.x': 0.72, 'shoulderL.x': -0.35, 'elbowL.x': -0.5, 'spine.y': 0.5, 'spine.x': 0.28, 'head.y': -0.3,
        'root.turn': 0.18, 'root.pitch': 0.24, 'root.forward': 0.62, 'root.lift': -0.12, 'weapon.aim': 1,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -1.36, 'elbowR.x': 0.75, 'shoulderL.x': -0.3, 'elbowL.x': -0.5, 'spine.y': 0.58, 'spine.x': 0.32,
        'root.turn': 0.22, 'root.pitch': 0.28, 'root.forward': 0.7, 'root.lift': -0.14, 'weapon.aim': 1,
      },
      span: 0.35,
      ease: 'outCubic',
    },
    {
      // 回撤：枪抽回腰侧，重心后移
      pose: {
        'shoulderR.x': 0.4, 'elbowR.x': -0.55, 'shoulderL.x': -0.8, 'elbowL.x': -0.3, 'shoulderL.z': -0.3, 'spine.y': -0.3, 'spine.x': 0.05,
        'root.turn': -0.2, 'root.forward': 0.1, 'root.lift': -0.05, 'weapon.aim': 1,
      },
      span: 0.65,
      ease: 'inOut',
    },
  ],
  fx: { slash: 2, slashScale: 0.75 },
};

// ---------------------------------------------------------------------------
// 人形：连斩第 2、3 击与旋风斩（各武器共用）
// ---------------------------------------------------------------------------

/** 第二式：从左向右的反手横斩（接在斜劈之后，刀正好在身体左侧） */
const CROSS_SLASH: MoveDef = {
  label: '反手横斩',
  timing: { anticipation: 0.17, strike: 0.08, hold: 0.045, follow: 0.13, beat: 0.1, recover: 0.26 },
  ready: [
    {
      pose: {
        'shoulderR.x': -1.0, 'shoulderR.z': 1.0, 'elbowR.x': -0.55, 'shoulderL.x': 0.3, 'spine.y': 0.95, 'head.y': -0.6,
        'root.turn': 0.34, 'root.forward': 0.05, 'root.lift': -0.05, 'weapon.x': 0.8,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderR.x': -0.85, 'shoulderR.z': -1.1, 'shoulderR.y': 0.9, 'elbowR.x': 0.6, 'shoulderL.x': -0.5, 'spine.y': -0.55, 'spine.x': 0.16, 'head.y': 0.35,
        'root.turn': -0.2, 'root.pitch': 0.12, 'root.forward': 0.36, 'root.lift': -0.08, 'weapon.x': 0.9,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -0.7, 'shoulderR.z': -1.3, 'shoulderR.y': 0.1, 'elbowR.x': 0.6, 'shoulderL.x': -0.7, 'spine.y': -0.95, 'spine.x': 0.2, 'head.y': 0.6,
        'root.turn': -0.32, 'root.pitch': 0.14, 'root.forward': 0.4, 'root.lift': -0.1, 'weapon.x': 0.9,
      },
      ease: 'outCubic',
    },
  ],
  fx: { slash: 1 },
};

/** 跃起重劈：先沉身，再跃起双手举过头顶，全力砸下 */
const HEAVY_CHOP: MoveDef = {
  label: '跃起重劈',
  timing: { anticipation: 0.36, strike: 0.1, hold: 0.066, follow: 0.2, beat: 0.14, recover: 0.32 },
  ready: [
    {
      pose: {
        'shoulderR.x': -0.9, 'shoulderL.x': -0.8, 'elbowR.x': -0.4, 'elbowL.x': -0.6, 'spine.x': 0.25,
        'root.lift': -0.16, 'root.pitch': 0.1, 'root.forward': -0.05,
      },
      span: 0.35,
      ease: 'out',
    },
    {
      pose: {
        'shoulderR.x': -2.6, 'shoulderR.z': 0.25, 'shoulderL.x': -2.45, 'shoulderL.z': -0.3, 'elbowR.x': -0.35, 'elbowL.x': -0.6,
        'spine.x': -0.32, 'chest.x': -0.15, 'head.x': -0.2,
        'root.lift': 0.6, 'root.pitch': -0.2, 'root.forward': -0.1,
      },
      span: 0.65,
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderR.x': -0.5, 'shoulderR.z': 0.3, 'shoulderL.x': -0.6, 'shoulderL.z': -0.3, 'elbowR.x': 0.5, 'elbowL.x': 0.3,
        'spine.x': 0.55, 'chest.x': 0.15, 'head.x': 0.15,
        'root.lift': -0.14, 'root.pitch': 0.4, 'root.forward': 0.5, 'weapon.x': 0.4,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -0.3, 'shoulderR.z': 0.3, 'shoulderL.x': -0.4, 'shoulderL.z': -0.3, 'elbowR.x': 0.5, 'elbowL.x': 0.3,
        'spine.x': 0.66, 'chest.x': 0.18, 'root.lift': -0.22, 'root.pitch': 0.46, 'root.forward': 0.54, 'weapon.x': 0.55,
      },
      span: 0.45,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderR.x': -0.45, 'shoulderR.z': 0.25, 'shoulderL.x': -0.5, 'shoulderL.z': -0.25, 'elbowR.x': 0.3, 'elbowL.x': 0.2,
        'spine.x': 0.45, 'root.lift': -0.15, 'root.pitch': 0.34, 'root.forward': 0.48, 'weapon.x': 0.45,
      },
      span: 0.55,
      ease: 'inOut',
    },
  ],
  fx: { slash: 2, slashScale: 1.2, groundDust: 1.3, loud: true },
};

/** 旋身横扫：手臂平伸、武器向外，落地瞬间腰身带着武器扫过目标（旋风斩途中的每一击） */
const SPIN_SLASH: MoveDef = {
  label: '旋身横扫',
  timing: { anticipation: 0.1, strike: 0.075, hold: 0.04, follow: 0.1, beat: 0.06, recover: 0.2 },
  ready: [
    {
      pose: {
        'shoulderR.x': -0.35, 'shoulderR.z': -1.35, 'shoulderR.y': -0.5, 'elbowR.x': 0.62, 'shoulderL.x': -0.3, 'shoulderL.z': 0.9, 'elbowL.x': 0.1,
        'spine.y': -0.6, 'head.y': 0.4, 'root.turn': -0.9, 'root.lift': -0.05, 'root.roll': -0.12, 'weapon.x': 1.35,
      },
      ease: 'out',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderR.x': -0.5, 'shoulderR.z': -1.3, 'shoulderR.y': 1.2, 'elbowR.x': 0.62, 'shoulderL.x': 0.3, 'shoulderL.z': 0.7, 'elbowL.x': 0.1,
        'spine.y': 0.7, 'spine.x': 0.15, 'head.y': -0.3, 'root.turn': 0.5, 'root.lift': -0.1, 'root.roll': 0.14, 'root.forward': 0.25, 'weapon.x': 1.35,
      },
      ease: 'in',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -0.5, 'shoulderR.z': -1.2, 'shoulderR.y': 1.7, 'elbowR.x': 0.55, 'shoulderL.x': 0.4, 'shoulderL.z': 0.6,
        'spine.y': 0.95, 'spine.x': 0.18, 'head.y': -0.45, 'root.turn': 0.75, 'root.lift': -0.13, 'root.roll': 0.1, 'root.forward': 0.28, 'weapon.x': 1.35,
      },
      ease: 'outCubic',
    },
  ],
  fx: { slash: 1, slashScale: 1.15 },
};

/** 旋风斩最后一击：沉身拧转 → 平伸武器连转两圈并腾起 → 砸地，地面冲击波 */
const SPIN_FINISH: MoveDef = {
  label: '旋风收尾',
  timing: { anticipation: 0.3, strike: 0.44, hold: 0.07, follow: 0.26, beat: 0.2, recover: 0.4 },
  ready: [
    {
      pose: {
        'shoulderR.x': -0.3, 'shoulderR.z': -1.3, 'shoulderR.y': -0.7, 'elbowR.x': 0.6, 'shoulderL.x': -0.4, 'shoulderL.z': 0.8,
        'spine.y': -0.85, 'spine.x': 0.2, 'head.y': 0.5, 'root.turn': -1.1, 'root.lift': -0.2, 'root.pitch': 0.1, 'weapon.x': 1.35,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      // 第一圈半：平伸武器旋转并腾起
      pose: {
        'shoulderR.x': -0.45, 'shoulderR.z': -1.4, 'shoulderR.y': 0.2, 'elbowR.x': 0.65, 'shoulderL.x': -0.2, 'shoulderL.z': 1.1,
        'spine.y': 0.1, 'root.turn': 9.4, 'root.lift': 0.38, 'root.roll': 0.12, 'weapon.x': 1.4,
      },
      span: 0.72,
      ease: 'in',
    },
    {
      // 最后半圈：双手合握，随落势劈下
      pose: {
        'shoulderR.x': -0.55, 'shoulderR.z': 0.3, 'shoulderL.x': -0.65, 'shoulderL.z': -0.3, 'elbowR.x': 0.5, 'elbowL.x': 0.3,
        'spine.y': 0.5, 'spine.x': 0.5, 'head.x': 0.12,
        'root.turn': 12.85, 'root.lift': -0.16, 'root.pitch': 0.38, 'root.forward': 0.4, 'weapon.x': 0.5,
      },
      span: 0.28,
      ease: 'linear',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -0.35, 'shoulderR.z': 0.4, 'shoulderL.x': -0.45, 'shoulderL.z': -0.3, 'elbowR.x': 0.5, 'elbowL.x': 0.3,
        'spine.y': 0.65, 'spine.x': 0.62, 'root.turn': 0.36, 'root.lift': -0.24, 'root.pitch': 0.44, 'root.forward': 0.44, 'weapon.x': 0.6,
      },
      span: 0.4,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderR.x': -0.45, 'shoulderR.z': 0.35, 'shoulderL.x': -0.5, 'shoulderL.z': -0.25, 'elbowR.x': 0.35, 'elbowL.x': 0.25,
        'spine.y': 0.5, 'spine.x': 0.46, 'root.turn': 0.28, 'root.lift': -0.17, 'root.pitch': 0.34, 'root.forward': 0.4, 'weapon.x': 0.5,
      },
      span: 0.6,
      ease: 'inOut',
    },
  ],
  fx: { slash: 2, slashScale: 1.5, shockwave: 2.6, shake: 0.12, groundDust: 1.6, loud: true },
};

// ---------------------------------------------------------------------------
// 人形：弓（步骤 11b 重做）
// ---------------------------------------------------------------------------
//
// 拉弓的节奏：侧身站定 → 举弓、右手搭上弓弦 → 右手把弦拉到脸侧（弓弦被拉成 V 形，弓臂弯曲）
// → 瞄准停顿一拍（ATTACK_ANIM.bowFullDrawPause）→ 放箭：弦向前弹回、弓身后坐上扬 → 收弓。
// 双臂的角度由 scripts/solveBowPose.ts 在真实骨架上求出：左手持弓伸向瞄准方向，右手正好落在箭的延长线上。
// 弓的专用通道（render/units/UnitView.ts 的 applyBowPose）：
//   bow.aim  0~1：把弓摆正（竖直、弓背朝瞄准方向）；weapon.aimPitch 是上扬角
//   bow.draw −1~1：弦的中点跟着右手（1 = 搭在手上）；负值 = 松弦后向前弹出

/** 侧身：右转约 60°，头转回来看着目标 */
const BOW_SIDE: BodyPose = { 'root.turn': -1.0, 'spine.y': -0.15, 'head.y': 0.95, 'head.x': 0.05, 'root.side': 0.04 };
/** 平射 · 举弓搭弦（右手离握把约 0.26 米） */
const BOW_NOCK: BodyPose = {
  ...BOW_SIDE,
  'shoulderL.x': -1.0, 'shoulderL.y': -0.41, 'shoulderL.z': 0.27, 'elbowL.x': -0.6,
  'shoulderR.x': -1.33, 'shoulderR.y': 1.17, 'shoulderR.z': 0.4, 'elbowR.x': -0.35,
  'bow.aim': 1, 'bow.draw': 1, 'weapon.aimPitch': 0.02,
};
/** 平射 · 拉满：右手把弦拉到脸侧（离握把约 0.63 米） */
const BOW_FULL: BodyPose = {
  ...BOW_SIDE, 'spine.x': -0.08,
  'shoulderL.x': -0.44, 'shoulderL.y': -0.23, 'shoulderL.z': 1.38, 'elbowL.x': -0.6,
  'shoulderR.x': -1.16, 'shoulderR.y': 1.6, 'shoulderR.z': -1.38, 'elbowR.x': -1.35,
  'bow.aim': 1, 'bow.draw': 1, 'weapon.aimPitch': 0.02,
};
/** 松弦的一瞬：右手向后弹开，弦向前弹过原位 */
const BOW_LOOSE: BodyPose = {
  ...BOW_FULL, 'shoulderR.y': 1.75, 'shoulderR.z': -1.5, 'elbowR.x': -1.1, 'bow.draw': -1,
};

/** 平射：侧身站定 → 举弓搭弦 → 拉到脸侧 → 松弦 → 弦回弹、弓身后坐 → 收弓 */
const BOW_SHOT: MoveDef = {
  label: '弓·平射',
  timing: { anticipation: 0.72, strike: 0.05, hold: 0.05, follow: 0.26, beat: 0.12, recover: 0.36 },
  ready: [
    {
      // 侧身站定：转身、沉重心，弓先提到身前（还没摆正）
      pose: { ...BOW_SIDE, 'shoulderL.x': -0.55, 'shoulderL.z': 0.25, 'elbowL.x': -0.3, 'shoulderR.x': -0.35, 'elbowR.x': -0.4, 'root.lift': -0.03, 'bow.aim': 0.4 },
      span: 0.25,
      ease: 'inOut',
    },
    { pose: BOW_NOCK, span: 0.3, ease: 'outCubic' }, // 举弓、右手搭弦
    { pose: BOW_FULL, span: 0.45, ease: 'inOut' }, // 拉弦到脸侧
  ],
  strike: [{ pose: BOW_LOOSE, ease: 'out' }],
  follow: [
    {
      // 弓身后坐：弓向上一扬、左臂被震得一沉，身体微微后坐
      pose: { ...BOW_LOOSE, 'weapon.aimPitch': 0.2, 'shoulderL.x': -0.3, 'root.forward': -0.06, 'root.pitch': -0.05, 'bow.draw': 0.0 },
      span: 0.35,
      ease: 'outCubic',
    },
    // 弓弦来回振一下后停住，弓身回正
    { pose: { ...BOW_LOOSE, 'weapon.aimPitch': 0.04, 'bow.draw': 0, 'shoulderR.x': -0.8, 'elbowR.x': -0.9 }, span: 0.65, ease: 'outElastic' },
  ],
  recover: [
    // 收弓：弓垂到身侧，转回正面
    { pose: { 'shoulderL.x': -0.3, 'shoulderL.z': 0.15, 'elbowL.x': -0.2, 'shoulderR.x': -0.2, 'root.turn': -0.3, 'head.y': 0.3, 'bow.aim': 0.2 }, span: 0.55, ease: 'inOut' },
  ],
};

/** 速射：三连射的第 2、3 箭——右手快速回到弦上、再拉满，每一箭都有完整的拉弦和放箭 */
const BOW_QUICK: MoveDef = {
  label: '弓·速射',
  timing: { anticipation: 0.34, strike: 0.05, hold: 0.04, follow: 0.16, beat: 0.12, recover: 0.36 },
  ready: [
    { pose: BOW_NOCK, span: 0.4, ease: 'outCubic' },
    { pose: BOW_FULL, span: 0.6, ease: 'inOut' },
  ],
  strike: BOW_SHOT.strike,
  follow: [
    { pose: { ...BOW_LOOSE, 'weapon.aimPitch': 0.16, 'shoulderL.x': -0.32, 'root.forward': -0.05, 'bow.draw': 0 }, span: 0.4, ease: 'outCubic' },
    { pose: { ...BOW_LOOSE, 'weapon.aimPitch': 0.04, 'bow.draw': 0 }, span: 0.6, ease: 'outElastic' },
  ],
  recover: BOW_SHOT.recover,
};

/** 仰射（箭雨）：侧身 → 弓举向天空 → 拉满、身体深深后仰 → 放箭，弓身回弹 → 收弓 */
const BOW_SKY_SIDE: BodyPose = { 'root.turn': -0.95, 'spine.y': -0.15, 'head.y': 0.8, 'head.x': -0.35, 'root.pitch': -0.32, 'spine.x': -0.15, 'root.side': 0.05 };
const BOW_SKY_NOCK: BodyPose = {
  ...BOW_SKY_SIDE,
  'shoulderL.x': -0.71, 'shoulderL.y': -1.14, 'shoulderL.z': 1.42, 'elbowL.x': -0.6,
  'shoulderR.x': -2.03, 'shoulderR.y': 1.26, 'shoulderR.z': 0.4, 'elbowR.x': -0.65,
  'bow.aim': 1, 'bow.draw': 1, 'weapon.aimPitch': 0.95,
};
const BOW_SKY_FULL: BodyPose = {
  ...BOW_SKY_SIDE, 'root.pitch': -0.45, 'chest.x': -0.1,
  'shoulderL.x': -1.37, 'shoulderL.y': -0.04, 'shoulderL.z': 0.25, 'elbowL.x': -0.6,
  'shoulderR.x': 0.33, 'shoulderR.y': 1.36, 'shoulderR.z': 0.4, 'elbowR.x': -1.41,
  'bow.aim': 1, 'bow.draw': 1, 'weapon.aimPitch': 1.0,
};
const BOW_SKY_LOOSE: BodyPose = { ...BOW_SKY_FULL, 'shoulderR.y': 1.5, 'elbowR.x': -1.15, 'bow.draw': -1 };

const BOW_SKY: MoveDef = {
  label: '弓·仰射',
  timing: { anticipation: 1.0, strike: 0.06, hold: 0.07, follow: 0.32, beat: 0.12, recover: 0.42 },
  ready: [
    {
      pose: { ...BOW_SIDE, 'shoulderL.x': -0.6, 'shoulderL.z': 0.25, 'elbowL.x': -0.3, 'shoulderR.x': -0.4, 'elbowR.x': -0.45, 'root.lift': -0.05, 'bow.aim': 0.4 },
      span: 0.22,
      ease: 'inOut',
    },
    { pose: BOW_SKY_NOCK, span: 0.33, ease: 'outCubic' }, // 举弓朝天、搭弦
    { pose: BOW_SKY_FULL, span: 0.45, ease: 'inOut' }, // 拉满、后仰
  ],
  strike: [{ pose: BOW_SKY_LOOSE, ease: 'out' }],
  follow: [
    { pose: { ...BOW_SKY_LOOSE, 'weapon.aimPitch': 1.2, 'shoulderL.x': -1.1, 'root.pitch': -0.52, 'root.forward': -0.08, 'bow.draw': 0 }, span: 0.35, ease: 'outCubic' },
    { pose: { ...BOW_SKY_LOOSE, 'weapon.aimPitch': 1.0, 'root.pitch': -0.38, 'bow.draw': 0 }, span: 0.65, ease: 'outElastic' },
  ],
  recover: BOW_SHOT.recover,
};

// ---------------------------------------------------------------------------
// 人形：施法（步骤 11b 重做：法杖挥舞轨迹）
// ---------------------------------------------------------------------------
//
// 法杖施法的节奏：双手握杖（grip.left = 1：左手自动握到杖身上，见 UnitView 的左手 IK）
// → 挥杖画弧 / 画圈，杖顶拖出发光轨迹（fx.trail），身体随之扭转、袍摆被带动
// → 释放：杖向目标用力前指（weapon.aim）或向上高举，身体前倾，杖顶光芒暴涨 → 收招：杖回落到身侧。
// 不同法术的挥杖轨迹不同：火系 = 挥弧后劈下，雷系 = 画圈后高举，封印 = 身前画圈后前指，普攻 = 短促一挑再前指。
// 群体法术幅度最大（举杖过头），封印和单体法术较简短。

/** 双手在身前握住法杖（杖竖在胸前） */
const STAFF_GRIP: BodyPose = {
  'shoulderR.x': -1.05, 'shoulderR.z': 0.1, 'elbowR.x': -0.55, 'spine.x': 0.04, 'grip.left': 1,
};

/**
 * 杖尖画圈：右手在身前绕圈（左手握着杖身跟着走），杖身随之倾斜，腰随之扭转。
 * @param center 圈心处的姿态
 * @param size 圈的大小：arm = 肩的摆幅（弧度），tilt = 杖身的倾斜幅度，twist = 腰的扭转幅度
 * @param turns 圈数；steps = 每圈几个关键姿态；from = 起始相位（弧度）；dir = 1 顺时针 / −1 逆时针（从出手者身后看）
 */
function staffOrbit(
  center: BodyPose,
  size: { arm: number; tilt: number; twist: number },
  turns: number,
  span: number,
  options: { steps?: number; from?: number; dir?: number } = {},
): PoseKey[] {
  const steps = Math.max(2, Math.round((options.steps ?? 4) * turns));
  const from = options.from ?? 0;
  const dir = options.dir ?? 1;
  const keys: PoseKey[] = [];
  const c = (k: string): number => center[k] ?? 0;
  for (let i = 1; i <= steps; i++) {
    const phi = from + dir * ((Math.PI * 2 * turns * i) / steps);
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    keys.push({
      pose: {
        ...center,
        'shoulderR.x': c('shoulderR.x') + size.arm * sin,
        'shoulderR.z': c('shoulderR.z') + size.arm * 0.8 * cos,
        'weapon.x': c('weapon.x') + size.tilt * sin,
        'weapon.z': c('weapon.z') - size.tilt * cos,
        'spine.y': c('spine.y') + size.twist * cos,
        'head.y': c('head.y') - size.twist * 0.5 * cos,
      },
      span: span / steps,
      ease: 'linear',
    });
  }
  return keys;
}

/** 收招：杖回落到身侧，左手松开 */
const STAFF_DOWN: PoseKey = {
  pose: { 'shoulderR.x': -0.15, 'shoulderR.z': 0.05, 'elbowR.x': 0.15, 'weapon.x': 0.15, 'grip.left': 0 },
  span: 0.5,
  ease: 'inOut',
};

/** 释放 · 前指：杖尖指向目标（weapon.aim），身体前倾 */
const STAFF_POINT: BodyPose = {
  'shoulderR.x': -1.45, 'shoulderR.z': 0.12, 'elbowR.x': 0.55, 'weapon.aim': 1, 'weapon.aimPitch': 0.05, 'grip.left': 0.7,
  'spine.x': 0.26, 'spine.y': 0.2, 'chest.x': 0.08, 'head.x': 0.05, 'root.pitch': 0.16, 'root.forward': 0.16, 'root.lift': -0.03,
};
const STAFF_POINT_FOLLOW: PoseKey[] = [
  { pose: { ...STAFF_POINT, 'spine.x': 0.32, 'root.pitch': 0.2, 'root.forward': 0.2, 'shoulderR.x': -1.5 }, span: 0.4, ease: 'outCubic' },
  { pose: { ...STAFF_POINT, 'spine.x': 0.14, 'root.pitch': 0.08, 'root.forward': 0.1, 'weapon.aim': 0.6, 'grip.left': 0.5 }, span: 0.6, ease: 'inOut' },
];

/** 法术普攻：双手握杖，杖尖短促地向右上挑一道弧，再向前一指 */
const CAST_POINT: MoveDef = {
  label: '施法·挑指',
  timing: { anticipation: 0.5, strike: 0.1, hold: 0.05, follow: 0.2, beat: 0.1, recover: 0.36 },
  ready: [
    { pose: STAFF_GRIP, span: 0.3, ease: 'outCubic' },
    { pose: { ...STAFF_GRIP, 'shoulderR.x': -1.25, 'shoulderR.z': 0.18, 'weapon.z': 0.5, 'spine.y': -0.55, 'head.y': 0.25, 'root.turn': -0.14 }, span: 0.35, ease: 'inOut' },
    { pose: { ...STAFF_GRIP, 'shoulderR.x': -1.9, 'shoulderR.z': -0.2, 'weapon.x': -0.4, 'weapon.z': 0.3, 'spine.y': -0.3, 'spine.x': -0.1, 'root.pitch': -0.06 }, span: 0.35, ease: 'outCubic' },
  ],
  strike: [{ pose: STAFF_POINT, ease: 'inCubic' }],
  follow: STAFF_POINT_FOLLOW,
  recover: [STAFF_DOWN],
  fx: { trail: true },
};

/** 封印：杖尖在身前画一个圈（锁链的形状），再向目标前指 */
const CAST_SEAL: MoveDef = {
  label: '施法·画圈封印',
  timing: CAST_POINT.timing,
  ready: [
    { pose: STAFF_GRIP, span: 0.22, ease: 'outCubic' },
    ...staffOrbit({ ...STAFF_GRIP, 'shoulderR.x': -1.3, 'shoulderR.z': 0.3, 'weapon.x': -0.2 }, { arm: 0.42, tilt: 0.45, twist: 0.35 }, 1, 0.62, { from: 0, dir: -1 }),
    { pose: { ...STAFF_GRIP, 'shoulderR.x': -1.6, 'weapon.x': -0.35, 'spine.x': -0.08, 'root.pitch': -0.05 }, span: 0.16, ease: 'inOut' },
  ],
  strike: [{ pose: STAFF_POINT, ease: 'inCubic' }],
  follow: STAFF_POINT_FOLLOW,
  recover: [STAFF_DOWN],
  fx: { trail: true },
};

/** 火系（单体）：双手握杖从右下向后上挥一道大弧，举过头顶、身体后仰 → 向前劈下，杖尖直指目标 */
const CAST_FIRE: MoveDef = {
  label: '施法·挥弧劈下（火）',
  timing: { anticipation: 0.7, strike: 0.1, hold: 0.06, follow: 0.22, beat: 0.12, recover: 0.38 },
  ready: [
    { pose: STAFF_GRIP, span: 0.2, ease: 'outCubic' },
    {
      // 杖拉到身体右下后方，腰向右拧
      pose: { ...STAFF_GRIP, 'shoulderR.x': -0.75, 'shoulderR.z': 0.12, 'elbowR.x': -0.5, 'weapon.x': 0.8, 'spine.y': -0.95, 'head.y': 0.55, 'root.turn': -0.22, 'root.lift': -0.04 },
      span: 0.3,
      ease: 'inOut',
    },
    {
      // 挥过右侧举过头顶，身体后仰
      pose: {
        ...STAFF_GRIP, 'shoulderR.x': -2.75, 'shoulderR.z': -0.3, 'elbowR.x': -0.25, 'weapon.x': -0.5, 'spine.y': -0.2, 'spine.x': -0.22, 'chest.x': -0.1,
        'head.x': -0.15, 'root.pitch': -0.12, 'root.lift': 0.04,
      },
      span: 0.5,
      ease: 'outCubic',
    },
  ],
  strike: [{ pose: { ...STAFF_POINT, 'weapon.aimPitch': -0.12, 'spine.x': 0.36, 'root.pitch': 0.24, 'root.forward': 0.22 }, ease: 'inCubic' }],
  follow: STAFF_POINT_FOLLOW,
  recover: [STAFF_DOWN],
  fx: { trail: true },
};

/** 释放 · 高举：双手把杖举过头顶、杖身竖直，身体略前倾、踮起 */
const STAFF_RAISE: BodyPose = {
  'shoulderR.x': -2.75, 'shoulderR.z': 0.4, 'elbowR.x': 0.45, 'weapon.x': 0.25, 'grip.left': 1,
  'spine.x': 0.1, 'chest.x': -0.05, 'head.x': -0.25, 'root.pitch': 0.08, 'root.lift': 0.08, 'root.forward': 0.06,
};

/** 雷系（单体）：双手握杖在身前画一圈，压低 → 向上高举 */
const CAST_THUNDER: MoveDef = {
  label: '施法·画圈高举（雷）',
  timing: { anticipation: 0.7, strike: 0.1, hold: 0.06, follow: 0.24, beat: 0.12, recover: 0.4 },
  ready: [
    { pose: STAFF_GRIP, span: 0.18, ease: 'outCubic' },
    ...staffOrbit({ ...STAFF_GRIP, 'shoulderR.x': -1.35, 'shoulderR.z': 0.38 }, { arm: 0.38, tilt: 0.45, twist: 0.45 }, 1, 0.6, { from: Math.PI / 2 }),
    { pose: { ...STAFF_GRIP, 'shoulderR.x': -0.85, 'elbowR.x': -0.7, 'root.lift': -0.06, 'spine.x': 0.15, 'root.pitch': 0.06 }, span: 0.22, ease: 'inOut' },
  ],
  strike: [{ pose: STAFF_RAISE, ease: 'inCubic' }],
  follow: [
    { pose: { ...STAFF_RAISE, 'root.lift': 0.1, 'spine.x': 0.14 }, span: 0.4, ease: 'outCubic' },
    { pose: { ...STAFF_RAISE, 'shoulderR.x': -2.6, 'root.lift': 0.03, 'spine.x': 0.06 }, span: 0.6, ease: 'inOut' },
  ],
  recover: [STAFF_DOWN],
  fx: { trail: true },
};

/** 群体·火：幅度最大——杖在身侧抡一整圈、举过头顶深深后仰 → 全力向前劈下 */
const CAST_GROUP_FIRE: MoveDef = {
  label: '施法·抡圈劈下（群体火）',
  timing: { anticipation: 1.2, strike: 0.12, hold: 0.07, follow: 0.28, beat: 0.14, recover: 0.42 },
  ready: [
    { pose: STAFF_GRIP, span: 0.12, ease: 'outCubic' },
    ...staffOrbit({ ...STAFF_GRIP, 'shoulderR.x': -1.6, 'shoulderR.z': 0.38 }, { arm: 0.5, tilt: 0.55, twist: 0.65 }, 1, 0.5, { from: Math.PI, steps: 6 }),
    {
      pose: {
        ...STAFF_GRIP, 'shoulderR.x': -2.9, 'shoulderR.z': -0.2, 'elbowR.x': -0.2, 'weapon.x': -0.6, 'spine.x': -0.3, 'chest.x': -0.14, 'head.x': -0.3,
        'root.pitch': -0.18, 'root.lift': 0.08, 'root.forward': -0.08,
      },
      span: 0.38,
      ease: 'outCubic',
    },
  ],
  strike: [{ pose: { ...STAFF_POINT, 'weapon.aimPitch': -0.25, 'spine.x': 0.42, 'root.pitch': 0.28, 'root.forward': 0.24, 'root.lift': -0.08 }, ease: 'inCubic' }],
  follow: STAFF_POINT_FOLLOW,
  recover: [STAFF_DOWN],
  fx: { trail: true },
};

/** 群体·雷：幅度最大——在头顶上方画两圈、举杖过头后仰蓄满 → 向上高举，符文阵亮起 */
const CAST_GROUP_THUNDER: MoveDef = {
  label: '施法·双圈高举（群体雷）',
  timing: { anticipation: 1.2, strike: 0.12, hold: 0.07, follow: 0.3, beat: 0.14, recover: 0.42 },
  ready: [
    { pose: STAFF_GRIP, span: 0.1, ease: 'outCubic' },
    ...staffOrbit({ ...STAFF_GRIP, 'shoulderR.x': -1.9, 'shoulderR.z': 0.4, 'spine.x': -0.08 }, { arm: 0.45, tilt: 0.5, twist: 0.5 }, 2, 0.62, { from: Math.PI / 2, steps: 5 }),
    {
      pose: {
        ...STAFF_GRIP, 'shoulderR.x': -2.7, 'elbowR.x': -0.2, 'weapon.x': -0.1, 'spine.x': -0.3, 'chest.x': -0.14, 'head.x': -0.35,
        'root.pitch': -0.16, 'root.lift': 0.04, 'root.forward': -0.06,
      },
      span: 0.28,
      ease: 'outCubic',
    },
  ],
  strike: [{ pose: { ...STAFF_RAISE, 'root.lift': 0.12, 'root.pitch': 0.12 }, ease: 'inCubic' }],
  follow: [
    { pose: { ...STAFF_RAISE, 'root.lift': 0.14, 'spine.x': 0.16, 'root.pitch': 0.14 }, span: 0.4, ease: 'outCubic' },
    { pose: { ...STAFF_RAISE, 'shoulderR.x': -2.6, 'root.lift': 0.04, 'spine.x': 0.06 }, span: 0.6, ease: 'inOut' },
  ],
  recover: [STAFF_DOWN],
  fx: { trail: true },
};

/** 群体召唤（没有专门轨迹的群体法术）：双臂高举、踮起后仰 → 杖向下一顿 */
const CAST_INVOKE: MoveDef = {
  ...CAST_GROUP_FIRE,
  label: '施法·召唤',
};

/** 祝祷（治疗、复活）：双臂向两侧展开上举、仰头 → 双手向前下方轻送 */
const CAST_BLESS: MoveDef = {
  label: '施法·祝祷',
  timing: { anticipation: 0.42, strike: 0.16, hold: 0.06, follow: 0.24, beat: 0.14, recover: 0.38 },
  ready: [
    {
      pose: {
        'shoulderR.x': -1.5, 'shoulderR.z': -0.85, 'elbowR.x': 0.3, 'shoulderL.x': -1.5, 'shoulderL.z': 0.85, 'elbowL.x': -0.1,
        'spine.x': -0.18, 'chest.x': -0.1, 'head.x': -0.28, 'root.lift': 0.07, 'root.pitch': -0.06,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderR.x': -1.15, 'shoulderR.z': -0.2, 'elbowR.x': 0.45, 'shoulderL.x': -1.15, 'shoulderL.z': 0.2, 'elbowL.x': 0.1,
        'spine.x': 0.14, 'head.x': 0.05, 'root.pitch': 0.08, 'root.forward': 0.06,
      },
      ease: 'inOut',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -0.9, 'shoulderR.z': -0.2, 'elbowR.x': 0.3, 'shoulderL.x': -0.9, 'shoulderL.z': 0.2, 'spine.x': 0.18, 'head.x': 0.1, 'root.pitch': 0.1, 'root.forward': 0.06,
      },
      ease: 'outCubic',
    },
  ],
};

// ---------------------------------------------------------------------------
// 宝宝：狼
// ---------------------------------------------------------------------------

/** 狼 · 撕咬：张嘴扑咬 → 咬住甩头 → 松口后撤 */
const WOLF_BITE: MoveDef = {
  label: '狼·撕咬',
  timing: { anticipation: 0.1, strike: 0.07, hold: 0.05, follow: 0.34, beat: 0.08, recover: 0.3 },
  ready: [
    {
      // 空中（步骤 11c 起在扑跃途中摆出）：张大嘴、前爪向前伸出、后腿拖在身后，身体拉长
      pose: {
        'neck.x': -0.5, 'head.x': -0.3, 'jaw.x': 0.95, 'root.pitch': -0.08, 'root.forward': -0.05, 'root.lift': 0.02, 'root.stretch': 0.16,
        'foreLegL.x': -0.75, 'foreLegR.x': -0.65, 'hindLegL.x': 0.6, 'hindLegR.x': 0.6, 'tail.x': -0.3,
      },
      ease: 'out',
    },
  ],
  strike: [
    {
      pose: {
        'neck.x': 0.4, 'head.x': 0.3, 'jaw.x': -0.2, 'root.pitch': 0.2, 'root.forward': 0.34, 'root.lift': -0.05, 'root.stretch': 0.1,
        'foreLegL.x': -0.27, 'foreLegR.x': -0.27, 'hindLegL.x': 0.27, 'hindLegR.x': 0.27, 'tail.x': -0.2,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    // 咬住甩头：左、右、左
    {
      pose: {
        'neck.x': 0.3, 'neck.y': 0.5, 'head.x': 0.25, 'head.y': 0.6, 'head.z': 0.3, 'jaw.x': -0.2, 'root.roll': 0.16, 'root.pitch': 0.16, 'root.forward': 0.3, 'root.turn': 0.12,
        'foreLegL.x': -0.24, 'foreLegR.x': -0.24, 'hindLegL.x': 0.24, 'hindLegR.x': 0.24, 'tail.y': -0.6,
      },
      span: 0.3,
      ease: 'inOut',
    },
    {
      pose: {
        'neck.x': 0.3, 'neck.y': -0.5, 'head.x': 0.25, 'head.y': -0.6, 'head.z': -0.3, 'jaw.x': -0.2, 'root.roll': -0.16, 'root.pitch': 0.16, 'root.forward': 0.26, 'root.turn': -0.12,
        'foreLegL.x': -0.24, 'foreLegR.x': -0.24, 'hindLegL.x': 0.24, 'hindLegR.x': 0.24, 'tail.y': 0.6,
      },
      span: 0.35,
      ease: 'inOut',
    },
    {
      pose: {
        'neck.x': 0.2, 'neck.y': 0.3, 'head.x': 0.15, 'head.y': 0.35, 'jaw.x': 0.1, 'root.roll': 0.08, 'root.pitch': 0.1, 'root.forward': 0.22,
        'foreLegL.x': -0.21, 'foreLegR.x': -0.21, 'hindLegL.x': 0.18, 'hindLegR.x': 0.18, 'tail.y': -0.3,
      },
      span: 0.35,
      ease: 'inOut',
    },
  ],
  recover: [
    {
      // 松口后撤一小步
      pose: {
        'root.forward': -0.2, 'root.lift': 0.1, 'root.pitch': -0.1, 'jaw.x': 0.5, 'neck.x': -0.2,
        'foreLegL.x': -0.3, 'foreLegR.x': -0.3, 'hindLegL.x': -0.12, 'hindLegR.x': -0.12, 'tail.x': 0.3,
      },
      span: 0.5,
      ease: 'out',
    },
  ],
  fx: { slash: -1 },
};

/** 狼 · 爪击（连击的第二击）：人立而起，前爪自上而下拍落 */
const WOLF_CLAW: MoveDef = {
  label: '狼·爪击',
  timing: { anticipation: 0.18, strike: 0.08, hold: 0.05, follow: 0.16, beat: 0.1, recover: 0.28 },
  ready: [
    {
      pose: {
        'root.pitch': -0.5, 'root.lift': 0.14, 'root.forward': -0.04, 'root.roll': -0.14,
        'foreLegL.x': -1.05, 'foreLegR.x': -0.54, 'hindLegL.x': 0.24, 'hindLegR.x': 0.24,
        'neck.x': 0.35, 'head.x': 0.15, 'jaw.x': 0.6, 'tail.x': -0.3,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      pose: {
        'root.pitch': 0.26, 'root.lift': -0.06, 'root.forward': 0.32, 'root.roll': 0.22, 'root.turn': 0.2,
        'foreLegL.x': 0.12, 'foreLegR.x': -0.3, 'hindLegL.x': 0.21, 'hindLegR.x': 0.21,
        'neck.x': 0.1, 'head.x': 0.1, 'jaw.x': 0.3, 'tail.x': 0.3,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'root.pitch': 0.3, 'root.lift': -0.1, 'root.forward': 0.34, 'root.roll': 0.26, 'root.turn': 0.28,
        'foreLegL.x': 0.27, 'foreLegR.x': -0.27, 'hindLegL.x': 0.18, 'hindLegR.x': 0.18, 'neck.x': 0.15, 'jaw.x': 0.2, 'tail.y': -0.4,
      },
      ease: 'outCubic',
    },
  ],
  fx: { slash: 0, slashScale: 0.8 },
};

// ---------------------------------------------------------------------------
// 宝宝：魔偶
// ---------------------------------------------------------------------------

/** 魔偶 · 砸拳：双拳自头顶砸向地面，冲击波环 */
const GOLEM_SLAM: MoveDef = {
  label: '魔偶·砸拳',
  timing: { anticipation: 0.3, strike: 0.11, hold: 0.066, follow: 0.26, beat: 0.2, recover: 0.5 },
  ready: [
    {
      pose: {
        'shoulderL.x': -2.95, 'shoulderR.x': -2.95, 'shoulderL.z': -0.32, 'shoulderR.z': 0.32,
        'torso.x': -0.42, 'head.x': -0.3, 'root.pitch': -0.14, 'root.lift': 0.09, 'root.forward': -0.08,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderL.x': -0.85, 'shoulderR.x': -0.85, 'shoulderL.z': -0.3, 'shoulderR.z': 0.3,
        'torso.x': 0.6, 'head.x': 0.2, 'root.pitch': 0.3, 'root.lift': -0.1, 'root.forward': 0.26, 'root.squash': 0.08,
        'legL.x': -0.2, 'legR.x': -0.2,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderL.x': -0.7, 'shoulderR.x': -0.7, 'shoulderL.z': -0.3, 'shoulderR.z': 0.3,
        'torso.x': 0.7, 'head.x': 0.25, 'root.pitch': 0.34, 'root.lift': -0.15, 'root.forward': 0.28, 'root.squash': 0.14,
        'legL.x': -0.25, 'legR.x': -0.25,
      },
      span: 0.35,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderL.x': -0.8, 'shoulderR.x': -0.8, 'shoulderL.z': -0.25, 'shoulderR.z': 0.25,
        'torso.x': 0.5, 'head.x': 0.1, 'root.pitch': 0.26, 'root.lift': -0.08, 'root.forward': 0.24, 'root.squash': 0.04,
        'legL.x': -0.15, 'legR.x': -0.15,
      },
      span: 0.65,
      ease: 'inOut',
    },
  ],
  fx: { heavy: true, shockwave: 1.9, shake: 0.1, groundDust: 1.5, slash: -1, loud: true, trail: false },
};

/** 魔偶 · 横扫（连击的第二击）：拧身，右臂抡圆横扫 */
const GOLEM_SWEEP: MoveDef = {
  label: '魔偶·横扫',
  timing: { anticipation: 0.3, strike: 0.12, hold: 0.066, follow: 0.24, beat: 0.2, recover: 0.5 },
  ready: [
    {
      pose: {
        'torso.y': -0.95, 'torso.x': -0.1, 'shoulderR.x': -1.3, 'shoulderR.z': -0.9, 'shoulderL.x': -0.6, 'head.y': 0.6,
        'root.turn': -0.3, 'root.lift': -0.04, 'root.forward': 0.1,
      },
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      pose: {
        'torso.y': 0.75, 'torso.x': 0.25, 'shoulderR.x': -1.45, 'shoulderR.z': 0.5, 'shoulderL.x': 0.5, 'head.y': -0.4,
        'root.turn': 0.3, 'root.pitch': 0.14, 'root.lift': -0.08, 'root.forward': 0.3,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'torso.y': 1.0, 'torso.x': 0.3, 'shoulderR.x': -1.3, 'shoulderR.z': 0.8, 'shoulderL.x': 0.6, 'head.y': -0.5,
        'root.turn': 0.4, 'root.pitch': 0.16, 'root.lift': -0.1, 'root.forward': 0.32,
      },
      ease: 'outCubic',
    },
  ],
  fx: { heavy: true, shake: 0.06, groundDust: 0.8, slash: 1, slashScale: 1.1, loud: true, trail: false },
};

// ---------------------------------------------------------------------------
// 宝宝：骨龙、幽灵（法术型，原地施法）
// ---------------------------------------------------------------------------

/** 骨龙：后仰、双翼张开、张口蓄火 → 探头喷吐，双翼后收 */
const DRAGON_BREATH: MoveDef = {
  label: '骨龙·吐息',
  timing: { anticipation: 0.5, strike: 0.12, hold: 0.07, follow: 0.24, beat: 0.14, recover: 0.4 },
  ready: [
    {
      pose: {
        'root.pitch': -0.28, 'root.lift': 0.04, 'root.forward': -0.08,
        'wingL.y': -0.55, 'wingR.y': 0.55, 'wingL.z': 0.25, 'wingR.z': -0.25,
        'head.x': -0.35, 'jaw.x': 0.25, 'foreL.x': -0.3, 'foreR.x': -0.3,
      },
      span: 0.5,
      ease: 'outCubic',
    },
    {
      pose: {
        'root.pitch': -0.4, 'root.lift': 0.07, 'root.forward': -0.12,
        'wingL.y': -0.8, 'wingR.y': 0.8, 'wingL.z': 0.4, 'wingR.z': -0.4,
        'head.x': -0.55, 'jaw.x': 0.8, 'foreL.x': -0.6, 'foreR.x': -0.6,
      },
      span: 0.5,
      ease: 'inOut',
    },
  ],
  strike: [
    {
      pose: {
        'root.pitch': 0.3, 'root.lift': -0.04, 'root.forward': 0.22, 'root.stretch': 0.08,
        'wingL.y': 0.25, 'wingR.y': -0.25, 'wingL.z': -0.1, 'wingR.z': 0.1,
        'head.x': 0.45, 'jaw.x': 0.95, 'foreL.x': 0.3, 'foreR.x': 0.3,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'root.pitch': 0.36, 'root.lift': -0.06, 'root.forward': 0.26,
        'wingL.y': 0.35, 'wingR.y': -0.35, 'head.x': 0.5, 'jaw.x': 0.7, 'foreL.x': 0.3, 'foreR.x': 0.3,
      },
      span: 0.4,
      ease: 'outCubic',
    },
    {
      pose: {
        'root.pitch': 0.16, 'root.forward': 0.12, 'wingL.y': -0.2, 'wingR.y': 0.2, 'head.x': 0.2, 'jaw.x': 0.3,
      },
      span: 0.6,
      ease: 'inOut',
    },
  ],
};

/** 幽灵：上浮、双臂展开、魂火在身前汇聚 → 双手前推 */
const GHOST_INVOKE: MoveDef = {
  label: '幽灵·魂火',
  timing: { anticipation: 0.5, strike: 0.12, hold: 0.07, follow: 0.24, beat: 0.14, recover: 0.42 },
  ready: [
    {
      pose: {
        'root.lift': 0.24, 'root.pitch': -0.1, 'shoulderL.z': 0.75, 'shoulderR.z': -0.75, 'shoulderL.x': 0.2, 'shoulderR.x': 0.2, 'head.x': -0.2,
      },
      span: 0.5,
      ease: 'outCubic',
    },
    {
      pose: {
        'root.lift': 0.36, 'root.pitch': -0.18, 'root.forward': -0.06, 'shoulderL.z': 1.15, 'shoulderR.z': -1.15, 'shoulderL.x': 0.1, 'shoulderR.x': 0.1, 'head.x': -0.3,
      },
      span: 0.5,
      ease: 'inOut',
    },
  ],
  strike: [
    {
      pose: {
        'root.lift': 0.2, 'root.pitch': 0.28, 'root.forward': 0.2, 'shoulderL.z': -0.25, 'shoulderR.z': 0.25, 'shoulderL.x': -0.55, 'shoulderR.x': -0.55, 'head.x': 0.15,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'root.lift': 0.16, 'root.pitch': 0.34, 'root.forward': 0.24, 'shoulderL.z': -0.3, 'shoulderR.z': 0.3, 'shoulderL.x': -0.65, 'shoulderR.x': -0.65, 'head.x': 0.2,
      },
      span: 0.4,
      ease: 'outCubic',
    },
    {
      pose: {
        'root.lift': 0.1, 'root.pitch': 0.14, 'root.forward': 0.1, 'shoulderL.z': 0.2, 'shoulderR.z': -0.2, 'shoulderL.x': -0.2, 'shoulderR.x': -0.2,
      },
      span: 0.6,
      ease: 'inOut',
    },
  ],
};

// ---------------------------------------------------------------------------
// 其他非人形（占位体等）：只用整体的前扑、后仰
// ---------------------------------------------------------------------------

const BEAST_LUNGE: MoveDef = {
  label: '扑击',
  timing: T_BASIC,
  ready: [{ pose: { 'root.forward': -0.14, 'root.pitch': -0.14, 'root.lift': 0.03 }, ease: 'outCubic' }],
  strike: [{ pose: { 'root.forward': 0.42, 'root.pitch': 0.3, 'root.lift': -0.04 }, ease: 'inCubic' }],
  follow: [{ pose: { 'root.forward': 0.46, 'root.pitch': 0.34, 'root.lift': -0.06 }, ease: 'outCubic' }],
  fx: { slash: 0 },
};
const BEAST_SWIPE: MoveDef = {
  ...BEAST_LUNGE,
  label: '横扑',
  ready: [{ pose: { 'root.forward': -0.12, 'root.roll': -0.35, 'root.turn': -0.3 }, ease: 'outCubic' }],
  strike: [{ pose: { 'root.forward': 0.4, 'root.roll': 0.35, 'root.turn': 0.3, 'root.pitch': 0.2 }, ease: 'inCubic' }],
  follow: [{ pose: { 'root.forward': 0.42, 'root.roll': 0.45, 'root.turn': 0.4, 'root.pitch': 0.22 }, ease: 'outCubic' }],
  fx: { slash: 1 },
};
const BEAST_CAST: MoveDef = {
  label: '施法',
  timing: CAST_POINT.timing,
  ready: [{ pose: { 'root.lift': 0.1, 'root.pitch': -0.12 }, ease: 'outCubic' }],
  strike: [{ pose: { 'root.lift': 0.05, 'root.pitch': 0.2, 'root.forward': 0.1 }, ease: 'inCubic' }],
  follow: [{ pose: { 'root.lift': 0.02, 'root.pitch': 0.24, 'root.forward': 0.12 }, ease: 'outCubic' }],
};

// ---------------------------------------------------------------------------
// 步态：离开站位 / 回到站位时怎么移动
// ---------------------------------------------------------------------------

export type GaitId = 'jump' | 'jumpBack' | 'hop' | 'whirlHop' | 'pounce' | 'pounceBack' | 'slamJump' | 'slamJumpBack';

/**
 * 步态。步骤 11b 起近战全部改为“大跳跃”：原地下蹲蓄力（crouch）→ 高抛物线腾空（hop = 最高点）
 * → 落地（尘土 + 轻微震屏）→ 落地缓冲（land）。总时长 = 编排给的移动时长（MotionProfile.approach / retreat.duration），
 * 其中 crouch、land 各占配置的秒数，剩下的是腾空时间。
 */
export interface GaitDef {
  accel: number; // 起步加速占全程时间的比例
  brake: number; // 到位前刹车减速占的比例
  lean: number; // 前倾（弧度），随速度变化
  brakeLean: number; // 刹车时的后仰（弧度）
  stride: number; // 步幅（米）：决定途中起伏几次、落几次脚
  bob: number; // 每一步的起伏高度（米）
  sway: number; // 重心左右摆动：每一步的侧倾（弧度）
  hop: number; // 整段路程的腾空高度（米）：扑跃、跃击
  arc: number; // 弧线路径：最大侧向偏移占路程的比例（0 = 直线）
  spin: number; // 途中绕竖轴旋转的圈数（旋风斩的旋身）
  spinWindow: readonly [number, number]; // 旋转发生在全程的哪一段
  dust: { start: number; step: number; end: number }; // 起步 / 每一步 / 到位（刹车或落地）的尘土量，0 = 没有
  sparks: boolean; // 落脚时带几点火星（金属靴）
  shake: number; // 每一步的镜头轻震（米）：魔偶的沉重踏步
  legs?: { joints: readonly [string, string]; swing: number }; // 随步伐前后摆动的两条腿（关节名）
  poses?: readonly { at: number; pose: BodyPose; ease?: EaseName }[]; // 腾空途中依次摆出的姿态（at = 腾空进度 0~1）
  /** 起跳前原地下蹲蓄力：duration 秒内摆到 pose（步骤 11b） */
  crouch?: { duration: number; pose: BodyPose; ease?: EaseName };
  /** 落地缓冲：先在前 35% 的时间压到 pose，再平滑回到站姿（步骤 11b） */
  land?: { duration: number; pose: BodyPose };
}

const NO_SPIN: readonly [number, number] = [0, 1];

// ---- 跳跃用到的姿态（相对站姿的偏移量）----

/** 人形 · 起跳前下蹲蓄力：身体压低（整体压扁，人形的腿没有关节）、前倾，双臂后摆，武器后收 */
const HUMAN_CROUCH: BodyPose = {
  'root.squash': 0.16, 'root.lift': -0.04, 'root.pitch': 0.2, 'spine.x': 0.28, 'chest.x': 0.1, 'head.x': -0.18,
  'shoulderR.x': 0.65, 'elbowR.x': -0.35, 'shoulderL.x': 0.6, 'elbowL.x': -0.3, 'weapon.x': 0.35,
};
/** 人形 · 落地缓冲：膝下沉（整体压扁）、身体前压，左臂外张保持平衡 */
const HUMAN_LAND: BodyPose = {
  'root.squash': 0.18, 'root.lift': -0.05, 'root.pitch': 0.24, 'spine.x': 0.32, 'chest.x': 0.08, 'head.x': -0.12,
  'shoulderR.x': -0.45, 'shoulderL.x': 0.15, 'shoulderL.z': 0.5, 'elbowL.x': -0.4,
};
/** 人形 · 腾空途中：蹬地伸展 → 最高点举起武器 → 落地前前送 */
const HUMAN_AIR: GaitDef['poses'] = [
  {
    at: 0.18,
    pose: {
      'root.squash': -0.08, 'root.pitch': -0.04, 'spine.x': -0.12, 'shoulderR.x': -1.5, 'elbowR.x': -0.3, 'shoulderL.x': -1.1, 'elbowL.x': -0.2,
      'head.x': 0.05, 'weapon.x': -0.2,
    },
    ease: 'out',
  },
  {
    at: 0.55,
    pose: {
      'root.squash': -0.03, 'spine.x': -0.18, 'chest.x': -0.1, 'shoulderR.x': -2.25, 'shoulderR.z': -0.2, 'elbowR.x': -0.45,
      'shoulderL.x': -0.75, 'shoulderL.z': 0.35, 'elbowL.x': -0.3, 'head.x': 0.1, 'weapon.x': 0.3,
    },
    ease: 'inOut',
  },
  {
    at: 1,
    pose: {
      'spine.x': 0.12, 'shoulderR.x': -1.2, 'elbowR.x': -0.3, 'shoulderL.x': -0.5, 'shoulderL.z': 0.4, 'elbowL.x': -0.3, 'head.x': -0.05,
    },
    ease: 'inOut',
  },
];
/** 人形 · 跳回：面朝对手向后跃起，双臂前伸保持平衡 */
const HUMAN_AIR_BACK: GaitDef['poses'] = [
  { at: 0.2, pose: { 'root.squash': -0.06, 'spine.x': -0.1, 'shoulderR.x': -1.0, 'shoulderL.x': -1.1, 'elbowL.x': -0.2, 'weapon.x': -0.2 }, ease: 'out' },
  { at: 0.6, pose: { 'spine.x': 0.1, 'shoulderR.x': -0.9, 'shoulderL.x': -0.8, 'shoulderL.z': 0.4, 'elbowL.x': -0.3 }, ease: 'inOut' },
  { at: 1, pose: { 'spine.x': 0.15, 'shoulderR.x': -0.6, 'shoulderL.x': -0.3, 'shoulderL.z': 0.45 }, ease: 'inOut' },
];

/** 狼 · 起跳前蓄势：前爪下伏、后腿收到身下，身体压低 */
const WOLF_CROUCH: BodyPose = {
  'root.lift': -0.1, 'root.pitch': 0.16, 'root.forward': -0.16, 'root.squash': 0.1,
  'foreLegL.x': -0.51, 'foreLegR.x': -0.51, 'hindLegL.x': -0.33, 'hindLegR.x': -0.33,
  'neck.x': -0.35, 'head.x': -0.1, 'tail.x': 0.5, 'jaw.x': 0.1,
};

/** 魔偶 · 起跳前蓄力：双臂举过头顶、上身后仰，整个身子往下一沉 */
const GOLEM_CROUCH: BodyPose = {
  'shoulderL.x': -2.75, 'shoulderR.x': -2.75, 'shoulderL.z': -0.3, 'shoulderR.z': 0.3,
  'torso.x': -0.22, 'head.x': -0.2, 'root.pitch': -0.06, 'root.squash': 0.16, 'root.lift': -0.05,
};
/** 魔偶 · 落地：重重砸进地面，身体压扁，双臂仍举着 */
const GOLEM_LAND: BodyPose = {
  'shoulderL.x': -2.5, 'shoulderR.x': -2.5, 'shoulderL.z': -0.4, 'shoulderR.z': 0.4,
  'torso.x': 0.18, 'head.x': 0.1, 'root.pitch': 0.12, 'root.squash': 0.22, 'root.lift': -0.06, 'legL.z': 0.12, 'legR.z': -0.12,
};

/** 跳跃的水平位移基本匀速（加速、刹车的比例很小），竖直方向是抛物线 */
const JUMP_FLOW = { accel: 0.03, brake: 0.03, stride: 99, bob: 0, sway: 0, arc: 0, spin: 0, spinWindow: NO_SPIN } as const;

export const GAITS: Record<GaitId, GaitDef> = {
  // 人形大跳跃：下蹲蓄力 → 高抛物线、腾空时身体略前倾 → 落在目标面前（尘土、火星、轻微震屏）→ 落地缓冲
  jump: {
    ...JUMP_FLOW, lean: 0.2, brakeLean: 0, hop: 1.35,
    dust: { start: 1.0, step: 0, end: 1.3 }, sparks: true, shake: 0.03,
    crouch: { duration: 0.22, pose: HUMAN_CROUCH, ease: 'outCubic' },
    land: { duration: 0.22, pose: HUMAN_LAND },
    poses: HUMAN_AIR,
  },
  // 人形跳回原位：面朝对手向后的大跳跃（略低），落地缓冲后恢复待机
  jumpBack: {
    ...JUMP_FLOW, lean: 0.12, brakeLean: 0, hop: 1.1,
    dust: { start: 0.8, step: 0, end: 1.1 }, sparks: false, shake: 0.02,
    crouch: { duration: 0.2, pose: HUMAN_CROUCH, ease: 'outCubic' },
    land: { duration: 0.24, pose: HUMAN_LAND },
    poses: HUMAN_AIR_BACK,
  },
  // 换目标的小跳（普通的多目标近战）
  hop: {
    accel: 0.15, brake: 0.3, lean: 0.2, brakeLean: 0.1, stride: 9, bob: 0, sway: 0, hop: 0.22, arc: 0, spin: 0, spinWindow: NO_SPIN,
    dust: { start: 0.6, step: 0, end: 0.8 }, sparks: false, shake: 0,
  },
  // 旋风斩：在目标之间连续的短跳跃——短促下蹲、蹬地，沿弧线切向下一个目标，途中旋身一圈（高度比大跳跃低）
  whirlHop: {
    accel: 0.05, brake: 0.12, lean: 0.24, brakeLean: 0.08, stride: 99, bob: 0, sway: 0, hop: 0.7, arc: 0.22, spin: 1, spinWindow: [0.1, 0.95],
    dust: { start: 1.0, step: 0, end: 1.2 }, sparks: true, shake: 0.015,
    crouch: { duration: 0.1, pose: { 'root.squash': 0.12, 'root.pitch': 0.16, 'spine.x': 0.2, 'shoulderR.z': -0.6, 'shoulderL.z': 0.5 }, ease: 'out' },
  },
  // 狼：轻快的扑跃——下伏蓄势、蹬地、腾空拉长身体、落在目标面前
  pounce: {
    ...JUMP_FLOW, lean: 0, brakeLean: 0, hop: 1.0,
    dust: { start: 1.1, step: 0, end: 1.0 }, sparks: false, shake: 0.012,
    crouch: { duration: 0.3, pose: WOLF_CROUCH, ease: 'outCubic' },
    land: {
      duration: 0.12,
      pose: { 'root.squash': 0.08, 'root.pitch': 0.12, 'foreLegL.x': -0.3, 'foreLegR.x': -0.3, 'hindLegL.x': -0.1, 'hindLegR.x': -0.1, 'neck.x': -0.3, 'jaw.x': 0.6 },
    },
    poses: [
      {
        at: 0.16,
        pose: {
          'root.pitch': -0.42, 'root.stretch': 0.12, 'foreLegL.x': -0.54, 'foreLegR.x': -0.54, 'hindLegL.x': 0.6, 'hindLegR.x': 0.6,
          'neck.x': 0.15, 'tail.x': -0.4,
        },
        ease: 'out',
      },
      {
        at: 0.6,
        pose: {
          'root.pitch': -0.06, 'root.stretch': 0.24, 'foreLegL.x': -0.69, 'foreLegR.x': -0.69, 'hindLegL.x': 0.72, 'hindLegR.x': 0.72,
          'neck.x': 0.1, 'jaw.x': 0.5, 'tail.x': -0.6,
        },
        ease: 'inOut',
      },
      {
        at: 1,
        pose: {
          'root.pitch': 0.2, 'root.stretch': 0, 'root.squash': 0.06, 'foreLegL.x': -0.3, 'foreLegR.x': -0.3, 'hindLegL.x': 0.06, 'hindLegR.x': 0.06,
          'neck.x': -0.35, 'head.x': -0.2, 'jaw.x': 0.8, 'tail.x': 0.3,
        },
        ease: 'inOut',
      },
    ],
  },
  // 狼：下伏、一跃跳回原位
  pounceBack: {
    ...JUMP_FLOW, lean: 0, brakeLean: 0, hop: 0.8,
    dust: { start: 0.8, step: 0, end: 0.9 }, sparks: false, shake: 0.01,
    crouch: {
      duration: 0.16,
      pose: { 'root.squash': 0.08, 'root.lift': -0.06, 'root.pitch': -0.1, 'foreLegL.x': -0.2, 'foreLegR.x': -0.2, 'hindLegL.x': -0.3, 'hindLegR.x': -0.3, 'tail.x': 0.4 },
      ease: 'out',
    },
    land: { duration: 0.16, pose: { 'root.squash': 0.08, 'root.lift': -0.05, 'foreLegL.x': -0.18, 'foreLegR.x': -0.18, 'hindLegL.x': -0.12, 'hindLegR.x': -0.12 } },
    poses: [
      { at: 0.2, pose: { 'root.pitch': 0.22, 'root.stretch': 0.1, 'foreLegL.x': 0.3, 'foreLegR.x': 0.3, 'hindLegL.x': -0.3, 'hindLegR.x': -0.3, 'tail.x': 0.5 }, ease: 'out' },
      { at: 0.7, pose: { 'root.pitch': -0.1, 'root.stretch': 0.14, 'foreLegL.x': 0.18, 'foreLegR.x': 0.18, 'hindLegL.x': -0.42, 'hindLegR.x': -0.42, 'tail.x': 0.3 }, ease: 'inOut' },
      { at: 1, pose: { 'root.squash': 0.04, 'foreLegL.x': -0.2, 'foreLegR.x': -0.2, 'hindLegL.x': -0.1, 'hindLegR.x': -0.1 }, ease: 'inOut' },
    ],
  },
  // 魔偶：沉重的跳跃——双臂举过头顶下沉蓄力，跳得低、腾空慢，落地地面震动、尘土大
  slamJump: {
    ...JUMP_FLOW, lean: 0.08, brakeLean: 0, hop: 0.6,
    dust: { start: 1.2, step: 0, end: 2.0 }, sparks: false, shake: 0.09,
    crouch: { duration: 0.5, pose: GOLEM_CROUCH, ease: 'inOut' },
    land: { duration: 0.3, pose: GOLEM_LAND },
    poses: [
      { at: 0.3, pose: { ...GOLEM_CROUCH, 'root.squash': -0.06, 'root.lift': 0, 'torso.x': -0.3, 'legL.x': -0.3, 'legR.x': 0.15 }, ease: 'out' },
      { at: 1, pose: { ...GOLEM_CROUCH, 'root.squash': 0, 'root.lift': 0, 'torso.x': -0.1, 'legL.x': -0.1, 'legR.x': -0.1 }, ease: 'inOut' },
    ],
  },
  // 魔偶：缓慢沉稳地跳回
  slamJumpBack: {
    ...JUMP_FLOW, lean: 0.05, brakeLean: 0, hop: 0.45,
    dust: { start: 0.9, step: 0, end: 1.6 }, sparks: false, shake: 0.065,
    crouch: { duration: 0.36, pose: { 'root.squash': 0.16, 'root.lift': -0.05, 'torso.x': 0.2, 'shoulderL.x': 0.4, 'shoulderR.x': 0.4 }, ease: 'inOut' },
    land: {
      duration: 0.32,
      pose: { 'root.squash': 0.2, 'root.lift': -0.06, 'torso.x': 0.2, 'shoulderL.z': -0.5, 'shoulderR.z': 0.5, 'legL.z': 0.12, 'legR.z': -0.12 },
    },
    poses: [
      { at: 0.35, pose: { 'root.squash': -0.05, 'torso.x': -0.1, 'shoulderL.x': -0.6, 'shoulderR.x': -0.6, 'legL.x': 0.2, 'legR.x': -0.1 }, ease: 'out' },
      { at: 1, pose: { 'torso.x': 0.05, 'shoulderL.x': -0.3, 'shoulderR.x': -0.3, 'legL.x': 0, 'legR.x': 0 }, ease: 'inOut' },
    ],
  },
};

// ---------------------------------------------------------------------------
// 动作档案：每类单位用哪一套动作
// ---------------------------------------------------------------------------

export type MotionId = 'blade' | 'sword' | 'spear' | 'bow' | 'staff' | 'wolf' | 'golem' | 'dragon' | 'ghost' | 'beast';

export interface MotionProfile {
  melee: readonly MoveDef[]; // 下标见 MELEE；缺的回退到 0
  bow: readonly MoveDef[]; // 下标见 BOW
  bowUp: readonly MoveDef[];
  cast: readonly MoveDef[]; // 下标见 CAST
  /** 出发前的蓄势（狼压低身体、魔偶举臂）；没有则直接起步 */
  brace?: { pose: BodyPose; duration: number; ease?: EaseName };
  approach: { gait: GaitId; duration: number }; // 冲向第一个目标
  retreat: { gait: GaitId; duration: number }; // 回到站位
  next: { gait: GaitId; duration: number }; // 普通多目标近战换目标
  /** 施法蓄力时在“施法点”汇聚的光团大小（米）；0 = 没有（人形靠武器发光） */
  gather: number;
  /**
   * 施法点（光团汇聚、光弹飞出的位置）：从 joint 关节（不填 = 模型脚下的原点）出发，
   * 沿朝向前移 forward、上移 up（米，未乘模型缩放）。不填 = 用武器挂点。
   */
  muzzle?: { joint?: string; forward: number; up: number };
}

const HUMAN_MELEE_SHARED = [CROSS_SLASH, HEAVY_CHOP, SPIN_SLASH, SPIN_FINISH] as const;
const HUMAN_BASE = {
  bow: [BOW_SHOT, BOW_QUICK],
  bowUp: [BOW_SKY],
  cast: [CAST_POINT, CAST_INVOKE, CAST_BLESS, CAST_SEAL, CAST_FIRE, CAST_THUNDER, CAST_GROUP_FIRE, CAST_GROUP_THUNDER],
  // 大跳跃（步骤 11b）：总时长 = 下蹲 0.22 + 腾空 + 落地缓冲 0.22（各段见 GAITS.jump / jumpBack）
  approach: { gait: 'jump', duration: 1.04 },
  retreat: { gait: 'jumpBack', duration: 1.02 },
  next: { gait: 'hop', duration: 0.24 },
  gather: 0,
} satisfies Omit<MotionProfile, 'melee'>;
const BEAST_BASE = {
  bow: [BEAST_CAST],
  bowUp: [BEAST_CAST],
  cast: [BEAST_CAST],
  approach: { gait: 'hop', duration: 0.38 },
  retreat: { gait: 'hop', duration: 0.36 },
  next: { gait: 'hop', duration: 0.24 },
  gather: 0,
} satisfies Omit<MotionProfile, 'melee'>;

export const MOTION_PROFILES: Record<MotionId, MotionProfile> = {
  blade: { ...HUMAN_BASE, melee: [BLADE_CHOP, ...HUMAN_MELEE_SHARED] },
  sword: { ...HUMAN_BASE, melee: [SWORD_SLASH, SWORD_THRUST, HEAVY_CHOP, SPIN_SLASH, SPIN_FINISH] },
  spear: { ...HUMAN_BASE, melee: [SPEAR_THRUST, ...HUMAN_MELEE_SHARED] },
  bow: { ...HUMAN_BASE, melee: [BLADE_CHOP, ...HUMAN_MELEE_SHARED] },
  staff: { ...HUMAN_BASE, melee: [BLADE_CHOP, ...HUMAN_MELEE_SHARED] },
  wolf: {
    ...BEAST_BASE,
    melee: [WOLF_BITE, WOLF_CLAW],
    // 轻快：下伏 0.3 + 腾空 0.42 + 落地 0.12；跳回 0.16 + 0.5 + 0.16
    approach: { gait: 'pounce', duration: 0.84 },
    retreat: { gait: 'pounceBack', duration: 0.82 },
  },
  golem: {
    ...BEAST_BASE,
    melee: [GOLEM_SLAM, GOLEM_SWEEP],
    // 沉重：举臂下沉 0.5 + 腾空 0.62 + 落地 0.3；跳回 0.36 + 0.6 + 0.32
    approach: { gait: 'slamJump', duration: 1.42 },
    retreat: { gait: 'slamJumpBack', duration: 1.28 },
  },
  dragon: { ...BEAST_BASE, melee: [BEAST_LUNGE, BEAST_SWIPE], cast: [DRAGON_BREATH], gather: 0.55, muzzle: { joint: 'head', forward: 0.34, up: -0.03 } },
  ghost: { ...BEAST_BASE, melee: [BEAST_LUNGE, BEAST_SWIPE], cast: [GHOST_INVOKE], gather: 0.6, muzzle: { forward: 0.46, up: 0.8 } },
  beast: { ...BEAST_BASE, melee: [BEAST_LUNGE, BEAST_SWIPE] },
};

/** 单位模板 → 动作档案。人物按武器（WeaponId 与 MotionId 同名），其余在这里指定；没列出的：人形按 blade，非人形按 beast */
export const MOTION_OF_TEMPLATE: Record<string, MotionId> = {
  pet_wolf_grey: 'wolf',
  pet_wolf_red: 'wolf',
  pet_golem: 'golem',
  pet_bone_dragon: 'dragon',
  pet_ghost: 'ghost',
  // 敌方的法杖施法者（杖长在模型上，不是装备的武器）：用法杖的挥杖动作
  enemy_demon_priest: 'staff',
  enemy_necromancer: 'staff',
};

/**
 * 左手握杖的位置（步骤 11b，grip.left 用）：沿右手武器 +y 方向离握持点多远（米，武器的局部坐标）。
 * 装备了武器的人物按武器取；没有装备武器、杖长在模型上的（敌方祭司、亡灵法师）按 mount 取，坐标是右手武器挂点的局部坐标。
 */
export const LEFT_GRIP: { weapon: Record<string, number>; mount: number } = {
  weapon: { staff: 0.3, sword: -0.12, spear: 0.4, blade: -0.1 },
  mount: 0.32,
};

/** 杖长在模型上的施法者：拖尾取样的两端、杖顶（施法光芒暴涨处）离右手武器挂点多远（米，挂点局部 +y） */
export const MOUNTED_STAFF: Record<string, { trail: readonly [number, number]; tip: number }> = {
  enemy_demon_priest: { trail: [0.55, 1.0], tip: 0.95 },
  enemy_necromancer: { trail: [0.55, 1.0], tip: 0.95 },
};

/**
 * 一次移动（总时长 duration）里下蹲、腾空、落地缓冲各占多少秒（UnitMotion 和编排共用，保证两边算出来一样）。
 * withLand = false：不要单独的落地缓冲（跳劈：落地即命中），腾空占满剩下的时间。
 */
export function jumpSplit(gaitId: GaitId, duration: number, withLand = true): { crouch: number; air: number; land: number } {
  const g = GAITS[gaitId];
  const crouch = g.crouch ? Math.min(g.crouch.duration, duration * 0.4) : 0;
  const land = withLand && g.land ? Math.min(g.land.duration, duration * 0.4) : 0;
  return { crouch, air: Math.max(0.05, duration - crouch - land), land };
}

/** 取某个动作；编号越界时回退到第 0 个 */
export function moveOf(motion: MotionId, style: 'melee' | 'bow' | 'bowUp' | 'cast', variant = 0): MoveDef {
  const list = MOTION_PROFILES[motion][style];
  return list[variant] ?? list[0]!;
}

// ---------------------------------------------------------------------------
// 编排用的全局参数
// ---------------------------------------------------------------------------

export const ATTACK_ANIM = {
  /** 旋风斩 */
  whirlwind: {
    /** 每一击的节奏倍率（乘在跃进和出手各阶段的时长上）：前几下快，越往后越沉；最后一击用 MELEE.spinFinish 自己的时长 */
    tempo: [0.9, 0.8, 0.8, 0.85, 0.95, 1.1, 1.25],
    /**
     * 整体放慢倍率（步骤 11b）：乘在旋风斩途中所有时长上（短跳、落地停顿、每一击的预备 / 发力 / 顿住 / 余势、
     * 击后停顿、最后一击）。1 = v0.4 的速度；想再快一点就调小。
     */
    pace: 1.2,
    /**
     * 跃向下一个目标：连续的短跳跃（含 0.1 秒的短促下蹲，见 GAITS.whirlHop），乘 tempo 和 pace。
     * 步骤 11c 起每一跳都是“跳劈”（见 jumpStrike）：空中蓄力、落地即斩；腾空时间不够放下预备和发力时自动加长。
     * （v0.4.1 的落地停顿、击后停顿、最后一击前的蓄势停顿都去掉了：命中顿帧是唯一的停顿）
     */
    leap: { gait: 'whirlHop' as GaitId, duration: 0.34 },
    shockwaveTime: 0.6, // 冲击波环持续时间
  },
  /**
   * 跳劈（步骤 11c）：近战的“起跳 → 空中蓄力 → 下落时挥下 → 落地即命中”，各阶段互相重叠，不再有站定的空档。
   *   windupAt     腾空进行到这个比例时开始攻击预备（举刀、扭身、蓄力）；预备一直持续到发力开始，
   *                发力（动作自己的 strike 时长）在下落段完成，落地的一瞬间正好命中。腾空时间不够放下预备 + 发力时自动加长腾空。
   *   chainOverlap 同一目标的下一击（连斩第 2、3 击、连击）：上一击的余势进行到这个比例之后就开始下一击的预备（0 = 等余势播完）
   *   hopOverlap   旋风斩：余势进行到这个比例之后就开始下一次短跳的下蹲
   *   returnOverlap 最后一击：余势进行到这个比例之后就开始回程的下蹲（收招和下蹲合成一个动作），没有单独的收招和停一拍
   *   landSquash / landSquashTime  落地即命中时身体被压下去的幅度和回弹时长（落地缓冲和发力合成一个动作）
   */
  jumpStrike: {
    windupAt: 0.3,
    chainOverlap: 0.55,
    hopOverlap: 0.5,
    returnOverlap: 0.45,
    landSquash: 0.14,
    landSquashTime: 0.22,
  },
  /** 连击（被动）的第二击：出手各阶段的时长倍率 */
  chainTempo: 0.85,
  /** 冲击波环、尘土的时长 */
  shockwaveTime: 0.55,
  dustColor: 0x9a8a72, // 尘土的颜色
  sparkColor: 0xffb060, // 落脚火星的颜色
  /** 命中顿住时出手者身体的轻微震颤（米 / 弧度），让“顿住”不是死的 */
  holdShudder: 0.012,
  /** 弓：拉满后瞄准停顿一拍，再松弦（步骤 11b 加长，拉弓过程更清楚） */
  bowFullDrawPause: 0.22,
  /**
   * 弓弦（步骤 11b）：maxPull = 弦的中点最远拉开多少（米，弓的局部坐标，拉满时弓臂弯到最大）；
   * snap = 松弦回弹时弦向前弹出的距离（米，乘 bow.draw 的负值）
   */
  bow: { maxPull: 0.62, snap: 0.08 },
  /** 双手握杖：默认握点（LEFT_GRIP）够不着时，左手可以沿杖身滑动的范围（米，相对默认握点：向下 / 向上） */
  gripSlide: [-0.95, 0.4] as const,
  /** 低画质：关闭次级运动（披风惯性），尘土等粒子按 QUALITY_CONFIG.low.particleScale 减少；主要动作不变 */
  lowQuality: { secondary: false },
};

/**
 * 次级运动：披风、袍摆、链条、挂饰被身体的运动带动，惯性甩出再回落。
 * 做法：每个单位一个“拖在身后的质点”，用弹簧阻尼跟随身体；质点相对身体的偏移量喂给布料的顶点着色器
 * （带飘动权重的顶点按偏移量位移），同时按质点的速度加大布料的飘动幅度。狼的尾巴用同一个偏移量甩动。
 */
export const SECONDARY_MOTION = {
  stiffness: 70, // 弹簧刚度（越大跟得越紧、回落越快）
  damping: 5.5, // 阻尼（越小甩得越久）
  maxOffset: 0.34, // 偏移量上限（米）
  backOffset: 0.3, // 质点挂在身体后方多远（米，乘模型缩放）：转身时披风被甩向外侧
  liftFactor: 0.5, // 竖直方向的跟随比例（跳起落下时下摆的滞后）
  flutterGain: 0.025, // 飘动幅度随质点速度增加的比例（米 / (米/秒)）
  flutterMax: 0.07, // 飘动幅度的增量上限（米）
  tailGain: 2.2, // 尾巴：偏移量 → 关节转角的比例
  tailMax: 0.8, // 尾巴甩动的转角上限（弧度）
  /**
   * 收尾（步骤 11b）：身体停下后，甩动在这么多秒内平滑衰减到 0 并清空弹簧，演出结束时精确回到基准姿态。
   * 要短于镜头复位的时长（TIMING.cameraOut），这样一次出手演完时所有单位都已静止。
   */
  settle: 0.28,
};

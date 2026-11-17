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
/** 施法动作编号 */
export const CAST = { point: 0, invoke: 1, bless: 2 } as const;

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
// 人形：弓
// ---------------------------------------------------------------------------

/** 平射：调整站姿 → 拉弓、身体后仰 → 松弦，弓身回弹、身体后坐 */
const BOW_SHOT: MoveDef = {
  label: '弓·平射',
  timing: { anticipation: 0.42, strike: 0.06, hold: 0.05, follow: 0.2, beat: 0.1, recover: 0.28 },
  ready: [
    {
      // 站姿调整：侧身、沉重心，弓先抬到一半
      pose: {
        'shoulderL.x': -0.7, 'elbowL.x': 0.05, 'shoulderR.x': -0.5, 'elbowR.x': -0.5, 'spine.y': 0.25, 'head.y': -0.15,
        'root.turn': -0.22, 'root.lift': -0.05, 'root.side': 0.04,
      },
      span: 0.32,
      ease: 'inOut',
    },
    {
      // 拉满：左手持弓前举，右手后拉，上身后仰
      pose: {
        'shoulderL.x': -1.25, 'elbowL.x': 0.15, 'shoulderR.x': -1.05, 'elbowR.x': -1.05, 'spine.y': 0.48, 'spine.x': -0.14, 'chest.x': -0.08, 'head.y': -0.3,
        'root.turn': -0.3, 'root.lift': -0.03, 'root.pitch': -0.07, 'root.forward': -0.07, 'root.side': 0.04,
      },
      span: 0.68,
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      // 松弦：右手弹开
      pose: {
        'shoulderL.x': -1.25, 'elbowL.x': 0.15, 'shoulderR.x': -0.85, 'elbowR.x': -0.3, 'spine.y': 0.4, 'spine.x': -0.08, 'head.y': -0.3,
        'root.turn': -0.3, 'root.pitch': -0.02, 'root.forward': 0.02, 'root.side': 0.04, 'weapon.x': -0.12,
      },
      ease: 'out',
    },
  ],
  follow: [
    {
      // 弓身回弹：弓向前一栽再弹回，身体后坐
      pose: {
        'shoulderL.x': -1.12, 'elbowL.x': 0.1, 'shoulderR.x': -0.75, 'elbowR.x': -0.1, 'spine.y': 0.34, 'spine.x': -0.16, 'head.y': -0.28,
        'root.turn': -0.28, 'root.pitch': -0.1, 'root.forward': -0.1, 'root.side': 0.04, 'weapon.x': 0.3,
      },
      span: 0.4,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderL.x': -1.2, 'elbowL.x': 0.12, 'shoulderR.x': -0.6, 'elbowR.x': -0.2, 'spine.y': 0.3, 'spine.x': -0.06, 'head.y': -0.25,
        'root.turn': -0.26, 'root.pitch': -0.03, 'root.forward': -0.05, 'root.side': 0.04, 'weapon.x': 0,
      },
      span: 0.6,
      ease: 'outElastic',
    },
  ],
};

/** 速射：三连射的第 2、3 箭，只有很短的再拉弓 */
const BOW_QUICK: MoveDef = {
  label: '弓·速射',
  timing: { anticipation: 0.17, strike: 0.05, hold: 0.04, follow: 0.12, beat: 0.1, recover: 0.28 },
  ready: [BOW_SHOT.ready[1]!],
  strike: BOW_SHOT.strike,
  follow: BOW_SHOT.follow,
};

/** 仰射（箭雨）：站姿调整 → 举弓向天、拉满 → 蓄满时身体深深后仰 → 射出，弓身回弹 */
const BOW_SKY: MoveDef = {
  label: '弓·仰射',
  timing: { anticipation: 0.72, strike: 0.07, hold: 0.07, follow: 0.26, beat: 0.12, recover: 0.34 },
  ready: [
    {
      pose: {
        'shoulderL.x': -0.6, 'elbowL.x': 0.05, 'shoulderR.x': -0.4, 'elbowR.x': -0.5, 'spine.y': 0.25, 'head.y': -0.15,
        'root.turn': -0.24, 'root.lift': -0.09, 'root.pitch': 0.06, 'root.side': 0.05,
      },
      span: 0.24,
      ease: 'inOut',
    },
    {
      pose: {
        'shoulderL.x': -1.25, 'elbowL.x': 0.15, 'shoulderR.x': -1.0, 'elbowR.x': -1.0, 'spine.y': 0.45, 'spine.x': -0.12, 'head.x': -0.2, 'head.y': -0.25,
        'root.turn': -0.3, 'root.lift': -0.03, 'root.pitch': -0.5, 'root.forward': -0.05, 'root.side': 0.05,
      },
      span: 0.46,
      ease: 'outCubic',
    },
    {
      // 蓄满：再后仰一点
      pose: {
        'shoulderL.x': -1.3, 'elbowL.x': 0.15, 'shoulderR.x': -1.1, 'elbowR.x': -1.15, 'spine.y': 0.5, 'spine.x': -0.2, 'chest.x': -0.1, 'head.x': -0.28, 'head.y': -0.25,
        'root.turn': -0.32, 'root.lift': -0.05, 'root.pitch': -0.66, 'root.forward': -0.09, 'root.side': 0.05,
      },
      span: 0.3,
      ease: 'inOut',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderL.x': -1.3, 'elbowL.x': 0.15, 'shoulderR.x': -0.85, 'elbowR.x': -0.3, 'spine.y': 0.42, 'spine.x': -0.14, 'head.x': -0.28, 'head.y': -0.25,
        'root.turn': -0.32, 'root.pitch': -0.6, 'root.forward': -0.04, 'root.side': 0.05, 'weapon.x': -0.15,
      },
      ease: 'out',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderL.x': -1.1, 'elbowL.x': 0.1, 'shoulderR.x': -0.7, 'elbowR.x': -0.1, 'spine.y': 0.35, 'spine.x': -0.22, 'head.x': -0.3, 'head.y': -0.25,
        'root.turn': -0.3, 'root.pitch': -0.7, 'root.forward': -0.14, 'root.lift': -0.06, 'root.side': 0.05, 'weapon.x': 0.4,
      },
      span: 0.35,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderL.x': -1.1, 'elbowL.x': 0.1, 'shoulderR.x': -0.5, 'elbowR.x': -0.2, 'spine.y': 0.3, 'spine.x': -0.08, 'head.x': -0.25, 'head.y': -0.2,
        'root.turn': -0.26, 'root.pitch': -0.4, 'root.forward': -0.06, 'root.side': 0.05, 'weapon.x': 0,
      },
      span: 0.65,
      ease: 'outElastic',
    },
  ],
};

// ---------------------------------------------------------------------------
// 人形：施法
// ---------------------------------------------------------------------------

/** 指向施法（法术普攻、单体法术、封印）：举杖后仰蓄力，左手起手势 → 杖向前一送 */
const CAST_POINT: MoveDef = {
  label: '施法·指向',
  timing: { anticipation: 0.42, strike: 0.12, hold: 0.06, follow: 0.2, beat: 0.12, recover: 0.34 },
  ready: [
    {
      pose: {
        'shoulderR.x': -1.25, 'shoulderR.z': -0.3, 'elbowR.x': -0.3, 'shoulderL.x': -0.7, 'shoulderL.z': 0.55, 'elbowL.x': -0.7,
        'spine.x': -0.16, 'chest.x': -0.08, 'head.x': -0.12, 'root.pitch': -0.08, 'root.lift': 0.03, 'root.forward': -0.06,
      },
      span: 0.5,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderR.x': -1.75, 'shoulderR.z': -0.35, 'elbowR.x': -0.35, 'shoulderL.x': -1.0, 'shoulderL.z': 0.7, 'elbowL.x': -0.9,
        'spine.x': -0.26, 'chest.x': -0.12, 'head.x': -0.18, 'root.pitch': -0.13, 'root.lift': 0.06, 'root.forward': -0.1,
      },
      span: 0.5,
      ease: 'inOut',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderR.x': -1.2, 'shoulderR.z': 0.1, 'elbowR.x': 0.6, 'shoulderL.x': -1.3, 'shoulderL.z': 0.1, 'elbowL.x': 0.15,
        'spine.x': 0.26, 'chest.x': 0.08, 'head.x': 0.06, 'root.pitch': 0.18, 'root.lift': -0.03, 'root.forward': 0.18,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -1.3, 'shoulderR.z': 0.1, 'elbowR.x': 0.65, 'shoulderL.x': -1.4, 'shoulderL.z': 0.1, 'elbowL.x': 0.2,
        'spine.x': 0.32, 'root.pitch': 0.22, 'root.lift': -0.05, 'root.forward': 0.22,
      },
      span: 0.4,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderR.x': -1.0, 'elbowR.x': 0.3, 'shoulderL.x': -0.9, 'elbowL.x': -0.1, 'spine.x': 0.14, 'root.pitch': 0.1, 'root.forward': 0.12,
      },
      span: 0.6,
      ease: 'inOut',
    },
  ],
};

/** 群体召唤（群体法术）：双臂高举、踮起后仰 → 杖向下一顿 */
const CAST_INVOKE: MoveDef = {
  label: '施法·召唤',
  timing: { anticipation: 0.85, strike: 0.12, hold: 0.07, follow: 0.24, beat: 0.14, recover: 0.38 },
  ready: [
    {
      pose: {
        'shoulderR.x': -1.3, 'shoulderL.x': -1.0, 'shoulderL.z': 0.5, 'elbowL.x': -0.6, 'spine.x': -0.1, 'root.lift': -0.05, 'root.pitch': 0.04,
      },
      span: 0.3,
      ease: 'inOut',
    },
    {
      pose: {
        'shoulderR.x': -2.45, 'shoulderR.z': -0.3, 'elbowR.x': 0.2, 'shoulderL.x': -2.2, 'shoulderL.z': 0.55, 'elbowL.x': -0.2,
        'spine.x': -0.3, 'chest.x': -0.14, 'head.x': -0.3, 'root.pitch': -0.14, 'root.lift': 0.1, 'root.forward': -0.08,
      },
      span: 0.7,
      ease: 'outCubic',
    },
  ],
  strike: [
    {
      pose: {
        'shoulderR.x': -0.75, 'elbowR.x': 0.4, 'shoulderL.x': -0.6, 'shoulderL.z': 0.3, 'elbowL.x': 0.1,
        'spine.x': 0.36, 'chest.x': 0.1, 'head.x': 0.1, 'root.pitch': 0.2, 'root.lift': -0.09, 'root.forward': 0.1,
      },
      ease: 'inCubic',
    },
  ],
  follow: [
    {
      pose: {
        'shoulderR.x': -0.6, 'elbowR.x': 0.45, 'shoulderL.x': -0.45, 'shoulderL.z': 0.3, 'spine.x': 0.44, 'root.pitch': 0.25, 'root.lift': -0.13, 'root.forward': 0.12,
      },
      span: 0.4,
      ease: 'outCubic',
    },
    {
      pose: {
        'shoulderR.x': -0.65, 'elbowR.x': 0.3, 'shoulderL.x': -0.4, 'shoulderL.z': 0.2, 'spine.x': 0.26, 'root.pitch': 0.14, 'root.lift': -0.07, 'root.forward': 0.08,
      },
      span: 0.6,
      ease: 'inOut',
    },
  ],
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

/** 狼 · 出发前蓄势：前爪下伏、后腿收到身下，身体压低 */
const WOLF_CROUCH: BodyPose = {
  'root.lift': -0.1, 'root.pitch': 0.16, 'root.forward': -0.16, 'root.squash': 0.1,
  'foreLegL.x': -0.51, 'foreLegR.x': -0.51, 'hindLegL.x': -0.33, 'hindLegR.x': -0.33,
  'neck.x': -0.35, 'head.x': -0.1, 'tail.x': 0.5, 'jaw.x': 0.1,
};

/** 狼 · 撕咬：张嘴扑咬 → 咬住甩头 → 松口后撤 */
const WOLF_BITE: MoveDef = {
  label: '狼·撕咬',
  timing: { anticipation: 0.1, strike: 0.07, hold: 0.05, follow: 0.34, beat: 0.08, recover: 0.3 },
  ready: [
    {
      pose: {
        'neck.x': -0.5, 'head.x': -0.3, 'jaw.x': 0.95, 'root.pitch': -0.08, 'root.forward': -0.05, 'root.lift': 0.02,
        'foreLegL.x': -0.18, 'foreLegR.x': -0.18, 'hindLegL.x': 0.09, 'hindLegR.x': 0.09, 'tail.x': 0.4,
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

/** 魔偶 · 出发前蓄势：双臂举过头顶，上身后仰 */
const GOLEM_RAISE: BodyPose = {
  'shoulderL.x': -2.75, 'shoulderR.x': -2.75, 'shoulderL.z': -0.3, 'shoulderR.z': 0.3,
  'torso.x': -0.22, 'head.x': -0.2, 'root.pitch': -0.06, 'root.lift': 0.03,
};

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

export type GaitId = 'run' | 'runBack' | 'hop' | 'leap' | 'pounce' | 'pounceBack' | 'stomp' | 'stompBack';

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
  poses?: readonly { at: number; pose: BodyPose; ease?: EaseName }[]; // 途中依次摆出的姿态（at = 全程进度 0~1）
}

const NO_SPIN: readonly [number, number] = [0, 1];

export const GAITS: Record<GaitId, GaitDef> = {
  // 人形冲刺：身体前倾、每步有起伏和重心摆动，到位前刹车后仰，脚下带尘土和火星
  run: {
    accel: 0.16, brake: 0.36, lean: 0.34, brakeLean: 0.28, stride: 1.15, bob: 0.09, sway: 0.07, hop: 0, arc: 0, spin: 0, spinWindow: NO_SPIN,
    dust: { start: 0.9, step: 0.45, end: 1.1 }, sparks: true, shake: 0,
  },
  // 跑回原位：面朝对手后撤，幅度小一些
  runBack: {
    accel: 0.2, brake: 0.4, lean: 0.2, brakeLean: 0.08, stride: 1.2, bob: 0.07, sway: 0.05, hop: 0, arc: 0, spin: 0, spinWindow: NO_SPIN,
    dust: { start: 0.6, step: 0.3, end: 0.7 }, sparks: false, shake: 0,
  },
  // 换目标的小跳（普通的多目标近战）
  hop: {
    accel: 0.15, brake: 0.3, lean: 0.2, brakeLean: 0.1, stride: 9, bob: 0, sway: 0, hop: 0.22, arc: 0, spin: 0, spinWindow: NO_SPIN,
    dust: { start: 0.6, step: 0, end: 0.8 }, sparks: false, shake: 0,
  },
  // 旋风斩：蹬地跃起，沿弧线切向下一个目标，途中旋身一圈
  leap: {
    accel: 0.12, brake: 0.22, lean: 0.26, brakeLean: 0.12, stride: 9, bob: 0, sway: 0, hop: 0.42, arc: 0.22, spin: 1, spinWindow: [0.12, 0.96],
    dust: { start: 1.0, step: 0, end: 1.2 }, sparks: true, shake: 0,
  },
  // 狼：扑跃——蹬地、腾空拉长身体、落在目标面前
  pounce: {
    accel: 0.1, brake: 0.2, lean: 0, brakeLean: 0, stride: 9, bob: 0, sway: 0, hop: 0.75, arc: 0, spin: 0, spinWindow: NO_SPIN,
    dust: { start: 1.1, step: 0, end: 1.0 }, sparks: false, shake: 0,
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
        at: 0.62,
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
  // 狼：跳回原位
  pounceBack: {
    accel: 0.12, brake: 0.25, lean: 0, brakeLean: 0, stride: 9, bob: 0, sway: 0, hop: 0.5, arc: 0, spin: 0, spinWindow: NO_SPIN,
    dust: { start: 0.8, step: 0, end: 0.9 }, sparks: false, shake: 0,
    poses: [
      { at: 0.2, pose: { 'root.pitch': 0.22, 'root.stretch': 0.1, 'foreLegL.x': 0.3, 'foreLegR.x': 0.3, 'hindLegL.x': -0.3, 'hindLegR.x': -0.3, 'tail.x': 0.5 }, ease: 'out' },
      { at: 0.7, pose: { 'root.pitch': -0.1, 'root.stretch': 0.14, 'foreLegL.x': 0.18, 'foreLegR.x': 0.18, 'hindLegL.x': -0.42, 'hindLegR.x': -0.42, 'tail.x': 0.3 }, ease: 'inOut' },
      { at: 1, pose: { 'root.squash': 0.08, 'root.lift': -0.05, 'foreLegL.x': -0.18, 'foreLegR.x': -0.18, 'hindLegL.x': -0.12, 'hindLegR.x': -0.12 }, ease: 'inOut' },
    ],
  },
  // 魔偶：沉重的踏步，每一步落地带尘土和镜头轻震
  stomp: {
    accel: 0.2, brake: 0.25, lean: 0.08, brakeLean: 0.04, stride: 0.95, bob: 0.13, sway: 0.13, hop: 0, arc: 0, spin: 0, spinWindow: NO_SPIN,
    dust: { start: 0.5, step: 1.1, end: 1.2 }, sparks: false, shake: 0.045, legs: { joints: ['legL', 'legR'], swing: 0.55 },
  },
  // 魔偶：缓慢沉稳地退回
  stompBack: {
    accel: 0.25, brake: 0.3, lean: 0.05, brakeLean: 0.02, stride: 0.85, bob: 0.1, sway: 0.11, hop: 0, arc: 0, spin: 0, spinWindow: NO_SPIN,
    dust: { start: 0.4, step: 0.8, end: 0.9 }, sparks: false, shake: 0.03, legs: { joints: ['legL', 'legR'], swing: 0.45 },
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
  cast: [CAST_POINT, CAST_INVOKE, CAST_BLESS],
  approach: { gait: 'run', duration: 0.42 },
  retreat: { gait: 'runBack', duration: 0.42 },
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
    brace: { pose: WOLF_CROUCH, duration: 0.32, ease: 'outCubic' },
    approach: { gait: 'pounce', duration: 0.42 },
    retreat: { gait: 'pounceBack', duration: 0.44 },
  },
  golem: {
    ...BEAST_BASE,
    melee: [GOLEM_SLAM, GOLEM_SWEEP],
    brace: { pose: GOLEM_RAISE, duration: 0.5, ease: 'inOut' },
    approach: { gait: 'stomp', duration: 0.9 },
    retreat: { gait: 'stompBack', duration: 0.85 },
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
};

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
    leap: { gait: 'leap' as GaitId, duration: 0.24 }, // 跃向下一个目标
    landPause: 0.03, // 落地后到出手之间的一点停顿
    finisherPause: 0.1, // 最后一击出手前的蓄势停顿（配合慢镜头）
    shockwaveTime: 0.6, // 冲击波环持续时间
  },
  /** 连击（被动）的第二击：出手各阶段的时长倍率 */
  chainTempo: 0.85,
  /** 冲击波环、尘土的时长 */
  shockwaveTime: 0.55,
  dustColor: 0x9a8a72, // 尘土的颜色
  sparkColor: 0xffb060, // 落脚火星的颜色
  /** 命中顿住时出手者身体的轻微震颤（米 / 弧度），让“顿住”不是死的 */
  holdShudder: 0.012,
  /** 弓：拉满后到松弦之间的停顿 */
  bowFullDrawPause: 0.08,
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
};

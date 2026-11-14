// 战斗演出配置：动画时长、距离、飘字与特效颜色。纯数据，调手感只改这里。
// 时长单位为秒，都是 1 倍速下的数值；倍速和“跳过动画”由调度器统一缩放。

import type { Element, Side, WeaponId } from '../core/types';

export const TIMING = {
  turnBanner: 0.7, // 回合开始提示停留
  defendNotice: 0.35, // 防御提示
  actionGap: 0.12, // 两次出手之间的间隔
  notice: 0.4, // “技能改为普攻”“没有目标”等提示
  run: 0.38, // 近战冲到目标面前
  runBack: 0.34, // 跑回原位
  hopNext: 0.22, // 顺序攻击时冲向下一个目标
  meleeWindup: 0.2, // 近战举刀
  meleeStrike: 0.1, // 近战挥下
  bowDraw: 0.34, // 拉弓
  bowRelease: 0.08, // 松弦
  castWindup: 0.42, // 施法蓄力
  castRelease: 0.12, // 施法出手
  recover: 0.22, // 收招
  arrowFlight: 0.24, // 箭矢飞行
  boltFlight: 0.3, // 法术光弹飞行
  pillar: 0.3, // 光柱落下/升起
  hit: 0.28, // 受击后仰
  dodge: 0.26, // 闪避
  die: 0.5, // 倒地
  vanish: 0.4, // 敌方倒地后消失
  revive: 1.15, // 复活起身（缓缓站起）
  afterImpact: 0.12, // 命中后的短暂停顿
  floater: 1.05, // 飘字寿命
  battleEndBanner: 1.2,

  // ---- 步骤 7：技能演出 ----
  slash: 0.22, // 斩击光弧停留
  comboWindup: 0.15, // 连斩前两击的举刀
  comboRecover: 0.1, // 连斩两击之间的收招
  heavyWindup: 0.3, // 连斩第 3 击 / 旋风斩最后一击的蓄力
  dash: 0.15, // 旋风斩冲向下一个目标
  dashWindup: 0.07, // 旋风斩每一击的举刀
  dashRecover: 0.05, // 旋风斩两击之间的收招
  tripleDraw: 0.16, // 三连射第 2、3 箭的拉弓
  rainDraw: 0.62, // 箭雨：拉满弓
  skyShot: 0.34, // 箭雨：光箭射向天空
  rainPause: 0.22, // 箭雨：升空后到第一支箭落下的间隔
  rainInterval: 0.13, // 箭雨：相邻两支箭落下的间隔
  rainFall: 0.2, // 箭雨：一支箭从天而降
  landing: 0.5, // 落点光圈
  spellCharge: 0.85, // 群体法术蓄力
  singleCharge: 0.55, // 单体法术蓄力
  strikeDelay: 0.1, // 雷柱 / 火柱出现到命中结算的间隔
  strike: 0.6, // 雷柱 / 火柱持续
  fireball: 0.34, // 火球飞行
  explosion: 0.55, // 爆炸
  chainTravel: 0.26, // 封印锁链飞到目标
  chainLinger: 0.4, // 锁链命中后停留
  bind: 0.75, // 锁链缠绕目标
  healPillar: 0.95, // 治疗光柱
  healDelay: 0.22, // 治疗光柱升起到回血的间隔
  reviveLight: 1.5, // 复活光芒
  reviveDelay: 0.4, // 光芒降下到单位开始起身的间隔
  cameraIn: 0.3, // 镜头推近
  cameraOut: 0.32, // 镜头复位
  cameraFollow: 0.26, // 旋风斩时镜头追上出手者
};

/** 镜头语言与顿帧（步骤 7）。时长单位为秒 */
export const CAMERA_FX = {
  focusZoom: 1.07, // 出手时的推近倍率（1 = 不推近）
  focusPan: 0.3, // 推近时镜头朝关注点平移的比例（0 = 不动，1 = 关注点到画面中心）
  followZoom: 1.1, // 旋风斩跟随时的推近倍率
  followPan: 0.42, // 旋风斩跟随时的平移比例
  groupZoom: 1.03, // 群体技能看向目标群时的推近倍率
  groupPan: 0.4,
  shake: { hit: 0.05, crit: 0.11, heavy: 0.2, spell: 0.16 }, // 镜头抖动幅度（米）
  shakeDecay: 7, // 抖动衰减速度（越大停得越快）
  hitStop: { crit: 0.06, kill: 0.08, heavy: 0.12 }, // 顿帧时长
  hitStopFactor: 0.03, // 顿帧期间的时间流速
  slowMo: { factor: 0.3, duration: 0.55 }, // 旋风斩最后一击的慢镜头
};

/** 武器发光随演出变化的倍率（1 = 常态，对接 WeaponGlow.setScale） */
export const GLOW_FX = {
  combo: [1.5, 2.1, 3.0], // 连斩逐击递增
  whirlwind: 2.0,
  bowFull: 2.4, // 箭雨拉满弓
  spellCharge: 3.2, // 群体法术蓄力时宝珠光芒暴涨
  singleCharge: 2.4,
  cast: 1.6, // 其他施法
};

/** 特效用量与尺寸（步骤 7）。性能不够时先调小 maxParticles 和各 count */
export const FX_CONFIG = {
  maxParticles: 1600, // 粒子池容量（场上同时存在的粒子上限）
  skyHeight: 9, // 箭雨、落雷从多高落下
  pillarHeight: 5.5,
  trailLife: 0.2, // 武器拖尾停留时间
  trailSamples: 22,
  /** 没有武器的单位（宝宝、敌人）出手时的光效颜色 */
  sideColor: { ally: 0xcfe4ff, enemy: 0xff5a3a } satisfies Record<Side, number>,
  /** 武器拖尾：握持点到拖尾两端的距离（米，沿武器 +y） */
  trailSpan: {
    blade: [0.25, 1.0],
    sword: [0.25, 1.05],
    spear: [1.2, 2.2],
    staff: [1.0, 1.6],
    bow: [-0.6, 0.6],
  } satisfies Record<WeaponId, readonly [number, number]>,
};

export const STAGING = {
  meleeGap: 0.35, // 近战时双方身体之间留的空隙
  unitRadius: { hero: 0.45, pet: 0.5, enemy: 0.45, boss: 1.25 }, // 冲锋时用来计算停步位置
  runHopHeight: 0.12, // 冲锋时的小跳高度
  speeds: [1, 2] as readonly number[], // 可选战斗速度
};

/** 特效与飘字按元素取色 */
export const ELEMENT_COLORS: Record<Element, number> = {
  none: 0xfff0d0,
  fire: 0xff7a2a,
  thunder: 0x9a7bff,
  seal: 0xb04cff,
  heal: 0xc8ee6a,
};

export const FX_COLORS = {
  arrow: 0x8dffe0, // 箭矢
  physicalImpact: 0xfff0d0, // 物理命中火花
  revive: 0xffe9a0, // 复活光芒
  chainCore: 0x3a1466, // 封印锁链的暗紫底色
};

/** 飘字样式（CSS 颜色与相对字号） */
export const FLOATER_STYLES = {
  damage: { color: '#f4ead0', size: 1 }, // 物理伤害
  magicDamage: { color: '#a9c8ff', size: 1 }, // 法术伤害
  crit: { color: '#ffb02e', size: 1.45 }, // 暴击
  miss: { color: '#9aa0a8', size: 0.95 }, // 未命中
  heal: { color: '#8fe26a', size: 1.05 }, // 治疗
  seal: { color: '#c06bff', size: 1.1 }, // 封印
  resist: { color: '#8f86a8', size: 0.95 }, // 封印被抵抗
  revive: { color: '#ffe08a', size: 1.2 }, // 复活
  defend: { color: '#8fb4d8', size: 0.95 }, // 防御
  info: { color: '#d8c690', size: 0.9 }, // 其他提示
} as const;

export type FloaterStyle = keyof typeof FLOATER_STYLES;

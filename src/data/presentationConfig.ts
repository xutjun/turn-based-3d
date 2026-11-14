// 战斗演出配置：动画时长、距离、飘字与特效颜色。纯数据，调手感只改这里。
// 时长单位为秒，都是 1 倍速下的数值；倍速和“跳过动画”由调度器统一缩放。

import type { Element } from '../core/types';

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
  revive: 0.75, // 复活起身
  afterImpact: 0.12, // 命中后的短暂停顿
  floater: 1.05, // 飘字寿命
  battleEndBanner: 1.2,
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

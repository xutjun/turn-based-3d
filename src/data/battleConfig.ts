// 全局战斗数值（对应 DESIGN.md §2 BattleConfig、§5）。调平衡时只改这里，不改公式。

import type { BattleConfig, BattleSettings } from '../core/types';

export const BATTLE_CONFIG: BattleConfig = {
  // 暴击：物理伤害、法术伤害、治疗分别配置
  crit: {
    physical: { rate: 0.1, multiplier: 1.5 },
    magic: { rate: 0.1, multiplier: 1.5 },
    heal: { rate: 0.1, multiplier: 1.5 },
  },
  magicDefenseCoef: 0.5, // 法术伤害只吃一半防御
  varianceMin: 0.9, // 伤害随机浮动下限
  varianceMax: 1.1, // 伤害随机浮动上限
  defendDamageMult: 0.5, // “防御”指令：本回合受到伤害 ×0.5
};

export const DEFAULT_SETTINGS: BattleSettings = {
  petAutoCommand: false, // 宝宝默认手动下指令
};

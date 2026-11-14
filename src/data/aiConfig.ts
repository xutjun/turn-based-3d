// AI 阈值（对应 DESIGN.md §8.4）。敌方与自动出手的宝宝共用。

import type { AiConfig } from '../core/types';

export const AI_CONFIG: AiConfig = {
  healHpThreshold: 0.6, // 友军气血比例低于该值时治疗
  aoeMinTargets: 3, // 存活对方单位 ≥ 该值时优先用群体技能
};

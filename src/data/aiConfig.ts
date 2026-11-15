// AI 阈值和选目标的权重（对应 DESIGN.md §8.4）。敌方与自动出手的宝宝共用。

import type { AiConfig } from '../core/types';

export const AI_CONFIG: AiConfig = {
  healHpThreshold: 0.4, // 友军气血比例低于该值时治疗（v0.2 由 0.6 下调：敌方火力分散后总有人轻伤，阈值太高会一直治疗、从不复活）
  aoeMinTargets: 3, // 存活对方单位 ≥ 该值时优先用群体技能
  // 选目标的方式：敌方用带权重的随机并分散火力（不集火）；友方的自动出手仍然固定打残血
  targetMode: { enemy: 'spread', ally: 'focus' },
  spread: {
    baseWeight: 1, // 每个候选目标的基础权重
    repeatDecay: 0.5, // 同一回合内每被选中一次，权重 × 0.5
    lowHpBonus: 0.3, // 残血小幅加权：权重 × (1 + 0.3 × 已损失气血比例)，最多 ×1.3
    sealCasterBonus: 2, // 封印时法术 / 恢复职业的权重 × 2
  },
};

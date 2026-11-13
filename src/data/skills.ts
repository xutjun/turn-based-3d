// 技能配置表（对应 DESIGN.md §4）。
// 步骤 1 只有两种普攻；连斩、旋风斩、群体法术、封印、治疗、复活在步骤 2 加入。

import type { SkillDef, SkillId } from '../core/types';

const SKILL_LIST: SkillDef[] = [
  {
    id: 'basic_physical',
    name: '普攻',
    description: '对一个敌人造成物理伤害。近战武器冲到目标面前攻击，弓箭在原地射击。',
    classId: 'common',
    mpCost: 0,
    effect: 'damage',
    damageType: 'physical',
    targetSide: 'enemy',
    targetState: 'alive',
    targetCount: 1,
    pattern: 'single',
    hits: 1,
    multiplier: 1.0,
    hitRate: 0.95,
    meleeCharge: true,
    animation: { melee: 'meleeStrike', ranged: 'bowShot' },
    element: 'none',
  },
  {
    id: 'basic_magic',
    name: '法术普攻',
    description: '在原地施法，对一个敌人造成法术伤害。',
    classId: 'common',
    mpCost: 0,
    effect: 'damage',
    damageType: 'magic',
    targetSide: 'enemy',
    targetState: 'alive',
    targetCount: 1,
    pattern: 'single',
    hits: 1,
    multiplier: 1.0,
    hitRate: 0.95,
    meleeCharge: false,
    animation: { cast: 'castBolt' },
    element: 'fire',
  },
];

export const SKILLS: Record<SkillId, SkillDef> = Object.fromEntries(
  SKILL_LIST.map((s) => [s.id, s]),
);

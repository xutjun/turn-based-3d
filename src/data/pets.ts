// 宝宝类型（对应 DESIGN.md §4.6）。
// 宝宝只有物理型和法术型两种，不属于封印系或恢复系；类型决定职业、主动技能和被动技能。
// 每只宝宝属于哪一型写在 PET_ASSIGNMENT 里，改这里就能重新分配。

import type { ClassId, PassiveId, SkillId, UnitId } from '../core/types';

export type PetType = 'physical' | 'magic';

export interface PetTypeDef {
  label: string;
  classId: ClassId;
  skillIds: SkillId[]; // 主动技能
  passiveIds: PassiveId[]; // 被动技能
}

export const PET_TYPES: Record<PetType, PetTypeDef> = {
  // 物理型：没有主动技能（指令只有普攻、防御），被动“连击”
  physical: { label: '物理型', classId: 'physical', skillIds: [], passiveIds: ['double_strike'] },
  // 法术型：一个主动技能，一次同时攻击 3 个单位
  magic: { label: '法术型', classId: 'magic', skillIds: ['triple_spell'], passiveIds: [] },
};

/** 5 只宝宝各属于哪一型 */
export const PET_ASSIGNMENT: Record<UnitId, PetType> = {
  A5: 'physical', // 影狼·灰
  A6: 'physical', // 影狼·赤
  A7: 'magic', // 骨龙幼崽
  A8: 'magic', // 幽灵
  A9: 'physical', // 魔偶
};

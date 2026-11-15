// 职业技能库（对应 DESIGN.md §4.3）：职业只决定能用哪些技能，武器只决定出手方式和外观。

import type { AttackMode, ClassId, SkillId } from '../core/types';

/** 每个职业可以拥有的全部技能（不含普攻）。宝宝和敌人的技能必须是所属职业技能库的子集 */
export const CLASS_SKILLS: Record<ClassId, SkillId[]> = {
  physical: ['combo_slash', 'whirlwind', 'triple_shot', 'arrow_rain'],
  magic: ['group_spell', 'single_spell', 'triple_spell'], // triple_spell 只有法术型宝宝使用
  seal: ['seal'],
  heal: ['group_heal', 'revive'],
};

/** 只有远程（弓箭）单位才能用的技能，以及它们对应的近战版本 */
export const RANGED_VARIANTS: Record<SkillId, SkillId> = {
  triple_shot: 'combo_slash',
  arrow_rain: 'whirlwind',
};

/** 友方人物的技能：物理系按武器的出手方式取近战版或弓箭版，其余职业取职业技能库里的标准技能 */
export function heroSkillIds(classId: ClassId, attackMode: AttackMode): SkillId[] {
  switch (classId) {
    case 'physical':
      return attackMode === 'ranged' ? ['triple_shot', 'arrow_rain'] : ['combo_slash', 'whirlwind'];
    case 'magic':
      return ['group_spell', 'single_spell'];
    case 'seal':
      return ['seal'];
    case 'heal':
      return ['group_heal', 'revive'];
  }
}

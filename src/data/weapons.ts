// 武器配置（对应 DESIGN.md §4.4）。
// 武器只决定出手方式和普攻类型；步骤 4 会在这里加入发光颜色、强度、呼吸频率等外观参数。

import type { AttackMode, SkillId, WeaponId } from '../core/types';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  attackMode: AttackMode; // 近战冲锋 / 原地射击 / 原地施法
  basicAttackSkillId: SkillId; // 持该武器时的普攻
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  blade: { id: 'blade', name: '刀', attackMode: 'melee', basicAttackSkillId: 'basic_physical' },
  sword: { id: 'sword', name: '剑', attackMode: 'melee', basicAttackSkillId: 'basic_physical' },
  spear: { id: 'spear', name: '枪', attackMode: 'melee', basicAttackSkillId: 'basic_physical' },
  staff: { id: 'staff', name: '法杖', attackMode: 'cast', basicAttackSkillId: 'basic_magic' },
  bow: { id: 'bow', name: '弓', attackMode: 'ranged', basicAttackSkillId: 'basic_physical' },
};

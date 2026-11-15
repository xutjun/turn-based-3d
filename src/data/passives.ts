// 被动技能配置表（对应 DESIGN.md §4.5）。
// 被动技能不需要下指令、不消耗魔法，满足触发条件时按概率自动生效；触发条件、概率、效果都在这里配置。
// 新增被动技能：在这里加一行；需要新的触发条件或效果时，扩展 core/types.ts 的 PassiveTrigger / PassiveEffect，
// 并在 core/passives.ts 加对应的判定。

import type { PassiveDef, PassiveId } from '../core/types';

const DOUBLE_STRIKE: PassiveDef = {
  id: 'double_strike',
  name: '连击',
  description: '普攻时有 50% 的概率紧接着再攻击同一个目标一次，两次攻击各自独立计算伤害和暴击。',
  trigger: 'basicAttack',
  chance: 0.5,
  effect: { kind: 'extraHit', hits: 1 },
};

const PASSIVE_LIST: PassiveDef[] = [DOUBLE_STRIKE];

export const PASSIVES: Record<PassiveId, PassiveDef> = Object.fromEntries(
  PASSIVE_LIST.map((p) => [p.id, p]),
);

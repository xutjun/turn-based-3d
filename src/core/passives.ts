// 被动技能的触发判定（对应 DESIGN.md §4.5）。
// 被动技能不出现在指令里、不消耗魔法、不受封印影响；满足触发条件时按概率自动生效。
// 配置表（data/passives.ts）由引擎注入，逻辑层不直接引用。

import type { Rng } from './rng';
import type { PassiveDef, PassiveId, PassiveTrigger, Unit } from './types';

export type PassiveTable = Record<PassiveId, PassiveDef>;

/** 一次出手中被触发的“追加攻击” */
export interface ExtraHits {
  passive: PassiveDef;
  hits: number;
}

/**
 * 判定单位在某个触发点上是否触发“追加攻击”类被动（连击）。
 * 按 passiveIds 的顺序逐个判定，第一个触发的生效；每个符合触发条件的被动消耗一次随机数。
 * 没有对应被动的单位不消耗随机数。
 */
export function rollExtraHits(
  passives: PassiveTable,
  unit: Unit,
  trigger: PassiveTrigger,
  rng: Rng,
): ExtraHits | null {
  for (const id of unit.passiveIds) {
    const def = passives[id];
    if (!def || def.trigger !== trigger || def.effect.kind !== 'extraHit') continue;
    if (rng.next() < def.chance) return { passive: def, hits: def.effect.hits };
  }
  return null;
}

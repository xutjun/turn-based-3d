// 目标规则（对应 DESIGN.md §6）。
// 步骤 1 实现：目标合法性、速度顺序、主目标失效时的重选。
// 多目标补足与执行顺序在步骤 2 实现。

import { isSealed } from './status';
import type { BattleState, SkillDef, Unit, UnitId } from './types';

/** 目标对该技能是否合法（DESIGN §6.1） */
export function isValidTarget(actor: Unit, skill: SkillDef, target: Unit): boolean {
  const sameSide = actor.side === target.side;
  if (skill.targetSide === 'enemy' ? sameSide : !sameSide) return false;
  if (skill.targetState === 'alive' ? !target.alive : target.alive) return false;
  // 已被封印的单位不能再被封印
  if (skill.effect === 'seal' && isSealed(target)) return false;
  return true;
}

/**
 * 速度顺序（DESIGN §6.2）：按单位在本回合 turnOrder 中的位置升序，即速度由快到慢，
 * 同速时沿用回合开始时的随机结果。不在 turnOrder 中的单位排最后，再按速度降序、id 升序。
 */
export function sortBySpeedOrder(state: BattleState, ids: readonly UnitId[]): UnitId[] {
  const pos = new Map<UnitId, number>();
  state.turnOrder.forEach((id, i) => pos.set(id, i));
  return [...ids].sort((a, b) => {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    const sa = state.units[a]!.stats.speed;
    const sb = state.units[b]!.stats.speed;
    if (sa !== sb) return sb - sa;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** 该技能当前所有合法目标，按速度顺序排列 */
export function listValidTargets(state: BattleState, actor: Unit, skill: SkillDef): UnitId[] {
  const ids = state.unitIds.filter((id) => isValidTarget(actor, skill, state.units[id]!));
  return sortBySpeedOrder(state, ids);
}

/** 主目标失效时重选：按速度顺序取第一个合法目标；没有则返回 null（DESIGN §6.5） */
export function pickRetarget(state: BattleState, actor: Unit, skill: SkillDef): UnitId | null {
  return listValidTargets(state, actor, skill)[0] ?? null;
}

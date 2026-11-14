// 目标规则（对应 DESIGN.md §6）。
// 目标合法性、速度顺序、主目标失效时的重选、多目标补足与执行顺序。

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

/**
 * 一次出手的全部目标，按执行顺序排列（DESIGN §6.3、§6.4）。界面预览和实际执行都调用本函数。
 * - 主目标一定在内并排第一；其余合法单位按速度由快到慢补足到 targetCount，不足则全部命中。
 * - 复活和单目标技能不补足，只取主目标。
 * - 依次攻击的技能若配置为 leftToRight，主目标之后按列从左到右（同列前排在先）。
 * 主目标不合法时返回空数组。
 */
export function resolveTargets(
  state: BattleState,
  actor: Unit,
  skill: SkillDef,
  primaryId: UnitId,
): UnitId[] {
  const primary = state.units[primaryId];
  if (!primary || !isValidTarget(actor, skill, primary)) return [];
  if (skill.targetCount <= 1 || skill.effect === 'revive') return [primaryId];

  const rest = listValidTargets(state, actor, skill)
    .filter((id) => id !== primaryId)
    .slice(0, skill.targetCount - 1);
  if (skill.pattern === 'sequential' && skill.sequenceOrder === 'leftToRight') {
    rest.sort((a, b) => {
      const sa = state.units[a]!.slot;
      const sb = state.units[b]!.slot;
      return sa.col !== sb.col ? sa.col - sb.col : sa.row - sb.row;
    });
  }
  return [primaryId, ...rest];
}

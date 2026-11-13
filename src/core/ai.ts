// 自动指令决策（对应 DESIGN.md §8.4）。敌方与自动宝宝共用，阵营相对。
// 步骤 1 只实现最基础的一条：普攻残血目标。按职业使用技能的规则在步骤 2 实现。

import type { SkillTable } from './commands';
import { listValidTargets } from './targeting';
import type { AiConfig, BattleState, Command, UnitId } from './types';

/** 在候选中选“残血”目标：hp / maxHp 最低，相同时取 id 字典序更小的 */
export function pickLowestHpRatio(state: BattleState, ids: readonly UnitId[]): UnitId | null {
  let best: UnitId | null = null;
  let bestRatio = Infinity;
  for (const id of ids) {
    const u = state.units[id]!;
    const ratio = u.hp / u.stats.maxHp;
    if (ratio < bestRatio || (ratio === bestRatio && best !== null && id < best)) {
      best = id;
      bestRatio = ratio;
    }
  }
  return best;
}

/** 为一个单位决定本回合指令 */
export function decideCommand(
  state: BattleState,
  skills: SkillTable,
  _ai: AiConfig,
  unitId: UnitId,
): Command {
  const unit = state.units[unitId]!;
  const basic = skills[unit.basicAttackSkillId]!;
  const targetId = pickLowestHpRatio(state, listValidTargets(state, unit, basic));
  // 没有任何可攻击目标时（正常不会出现）改为防御
  if (targetId === null) return { kind: 'defend' };
  return { kind: 'attack', targetId };
}

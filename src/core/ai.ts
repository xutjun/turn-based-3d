// 自动指令决策（对应 DESIGN.md §8.4）。敌方与自动宝宝共用，阵营相对。
// 只考虑当前可用（魔法足够且未被封印）的技能；AI 不使用防御。
//
// - 恢复系：有友军气血比例低于阈值 → 群体治疗（主目标为比例最低者）；否则有倒地友军且会复活 → 复活；否则普攻残血敌人。
// - 封印系：优先封印对方的法术 / 恢复职业，其次封印任意拥有技能的单位（都取法术伤害最高者）；否则普攻残血敌人。
// - 其他：对方存活单位够多时用群体技能，否则用单体技能，否则普攻；主目标都是残血敌人。

import { getSkillDisabledReason, type SkillTable } from './commands';
import { listValidTargets } from './targeting';
import type { AiConfig, BattleState, Command, SkillDef, Unit, UnitId } from './types';

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

/** 在候选中选法术伤害最高的，相同时取 id 字典序更小的 */
function pickHighestMagAtk(state: BattleState, ids: readonly UnitId[]): UnitId | null {
  let best: UnitId | null = null;
  let bestAtk = -Infinity;
  for (const id of ids) {
    const atk = state.units[id]!.stats.magAtk;
    if (atk > bestAtk || (atk === bestAtk && best !== null && id < best)) {
      best = id;
      bestAtk = atk;
    }
  }
  return best;
}

const useSkill = (skill: SkillDef, targetId: UnitId): Command => ({
  kind: 'skill',
  skillId: skill.id,
  targetId,
});

/** 恢复系的技能选择；没有合适的技能时返回 null */
function decideHeal(
  state: BattleState,
  ai: AiConfig,
  unit: Unit,
  usable: readonly SkillDef[],
): Command | null {
  const heal = usable.find((s) => s.effect === 'heal');
  if (heal) {
    const wounded = listValidTargets(state, unit, heal).filter((id) => {
      const u = state.units[id]!;
      return u.hp / u.stats.maxHp < ai.healHpThreshold;
    });
    const targetId = pickLowestHpRatio(state, wounded);
    if (targetId !== null) return useSkill(heal, targetId);
  }
  const revive = usable.find((s) => s.effect === 'revive');
  if (revive) {
    // 倒地友军里取 id 最小的
    const fallen = listValidTargets(state, unit, revive).sort();
    if (fallen[0] !== undefined) return useSkill(revive, fallen[0]);
  }
  return null;
}

/** 封印系的技能选择；没有合适的目标时返回 null */
function decideSeal(state: BattleState, unit: Unit, usable: readonly SkillDef[]): Command | null {
  const seal = usable.find((s) => s.effect === 'seal');
  if (!seal) return null;
  const candidates = listValidTargets(state, unit, seal); // 存活且未被封印的对方单位
  const casters = candidates.filter((id) => {
    const c = state.units[id]!.classId;
    return c === 'magic' || c === 'heal';
  });
  const skilled = candidates.filter((id) => state.units[id]!.skillIds.length > 0);
  const targetId = pickHighestMagAtk(state, casters) ?? pickHighestMagAtk(state, skilled);
  return targetId === null ? null : useSkill(seal, targetId);
}

/** 为一个单位决定本回合指令 */
export function decideCommand(
  state: BattleState,
  skills: SkillTable,
  ai: AiConfig,
  unitId: UnitId,
): Command {
  const unit = state.units[unitId]!;
  const basic = skills[unit.basicAttackSkillId]!;
  const usable = unit.skillIds
    .map((id) => skills[id])
    .filter((s): s is SkillDef => s !== undefined && getSkillDisabledReason(unit, s) === undefined);

  if (unit.classId === 'heal') {
    const cmd = decideHeal(state, ai, unit, usable);
    if (cmd) return cmd;
  } else if (unit.classId === 'seal') {
    const cmd = decideSeal(state, unit, usable);
    if (cmd) return cmd;
  }

  const enemies = listValidTargets(state, unit, basic);
  const targetId = pickLowestHpRatio(state, enemies);
  // 没有任何可攻击目标时（正常不会出现）改为防御
  if (targetId === null) return { kind: 'defend' };

  if (unit.classId === 'physical' || unit.classId === 'magic') {
    const damaging = usable.filter((s) => s.effect === 'damage' && s.targetSide === 'enemy');
    const group = damaging.find((s) => s.targetCount > 1);
    if (group && enemies.length >= ai.aoeMinTargets) return useSkill(group, targetId);
    const single = damaging.find((s) => s.targetCount === 1);
    if (single) return useSkill(single, targetId);
  }
  return { kind: 'attack', targetId };
}

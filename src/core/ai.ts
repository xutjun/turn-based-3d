// 自动指令决策（对应 DESIGN.md §8.4）。敌方与自动宝宝共用，阵营相对。
// 只考虑当前可用（魔法足够且未被封印）的技能；AI 不使用防御。
//
// 选什么技能：
// - 恢复系：有友军气血比例低于阈值 → 群体治疗；否则有倒地友军且会复活 → 复活；否则攻击。
// - 封印系：有可封印且拥有主动技能的对方单位 → 封印；否则攻击。
// - 其他：对方存活单位够多时用群体技能，否则用单体技能，否则普攻。
//
// 选哪个目标：由 AiConfig.targetMode[阵营] 决定。
// - focus ：固定选“最优”目标（残血、法伤最高……），步骤 8 及之前的规则。
// - spread：带权重的随机。同一回合内已经被己方 AI 选为同类目标的单位，每次权重 × repeatDecay，
//           以分散火力；残血只有小幅加权。随机数用 AI 专用的带种子序列，结果可复现。

import { getSkillDisabledReason, type SkillTable } from './commands';
import type { Rng } from './rng';
import { listValidTargets } from './targeting';
import type { AiConfig, AiTargetKind, BattleState, Command, SkillDef, Unit, UnitId } from './types';

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

const isCaster = (u: Unit): boolean => u.classId === 'magic' || u.classId === 'heal';

/** AI 决策需要的上下文，由引擎提供 */
export interface AiContext {
  state: BattleState;
  skills: SkillTable;
  ai: AiConfig;
  rng: Rng; // AI 专用的随机序列
}

/**
 * spread 模式：在候选里做一次带权重的随机抽取，并把选中的单位计入本回合的被选次数。
 * 权重 = baseWeight × repeatDecay ^ 已被选次数 × bonus(单位)。
 * 候选的排列顺序必须是确定的（调用方传入按速度顺序排好的列表）。
 */
export function pickSpread(
  ctx: AiContext,
  side: Unit['side'],
  kind: AiTargetKind,
  candidates: readonly UnitId[],
  bonus: (u: Unit) => number,
): UnitId | null {
  if (candidates.length === 0) return null;
  const { baseWeight, repeatDecay } = ctx.ai.spread;
  const counts = ctx.state.aiTargetCounts[side][kind];
  const weights = candidates.map(
    (id) => baseWeight * Math.pow(repeatDecay, counts[id] ?? 0) * bonus(ctx.state.units[id]!),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let picked = candidates[candidates.length - 1]!;
  if (total > 0) {
    let r = ctx.rng.next() * total;
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i]!;
      if (r < 0) {
        picked = candidates[i]!;
        break;
      }
    }
  }
  counts[picked] = (counts[picked] ?? 0) + 1;
  return picked;
}

/** 残血小幅加权：1 + lowHpBonus × 已损失气血比例 */
const lowHpBonus =
  (ai: AiConfig) =>
  (u: Unit): number =>
    1 + ai.spread.lowHpBonus * (1 - u.hp / u.stats.maxHp);

/**
 * 为某单位的某个技能选主目标（决定指令时，以及 spread 一方出手时目标失效的重选都用它）。
 * candidates 不传时取该技能当前的全部合法目标。没有候选返回 null。
 */
export function pickAiTarget(
  ctx: AiContext,
  unit: Unit,
  skill: SkillDef,
  candidates?: readonly UnitId[],
): UnitId | null {
  const { state, ai } = ctx;
  const pool = candidates ?? listValidTargets(state, unit, skill);
  const spread = ai.targetMode[unit.side] === 'spread';

  if (skill.effect === 'seal') {
    if (spread) {
      return pickSpread(ctx, unit.side, 'seal', pool, (u) => (isCaster(u) ? ai.spread.sealCasterBonus : 1));
    }
    // focus：优先法术 / 恢复职业里法伤最高者；没有则在拥有主动技能的单位里取法伤最高者
    const casters = pool.filter((id) => isCaster(state.units[id]!));
    const skilled = pool.filter((id) => state.units[id]!.skillIds.length > 0);
    return pickHighestMagAtk(state, casters) ?? pickHighestMagAtk(state, skilled);
  }
  if (skill.effect === 'revive') {
    if (spread) return pickSpread(ctx, unit.side, 'heal', pool, () => 1);
    return [...pool].sort()[0] ?? null; // 倒地友军里取 id 最小的
  }
  if (skill.effect === 'heal') {
    if (spread) return pickSpread(ctx, unit.side, 'heal', pool, lowHpBonus(ai));
    return pickLowestHpRatio(state, pool);
  }
  if (spread) return pickSpread(ctx, unit.side, 'attack', pool, lowHpBonus(ai));
  return pickLowestHpRatio(state, pool);
}

const useSkill = (skill: SkillDef, targetId: UnitId): Command => ({
  kind: 'skill',
  skillId: skill.id,
  targetId,
});

/** 恢复系的技能选择；没有合适的技能时返回 null */
function decideHeal(ctx: AiContext, unit: Unit, usable: readonly SkillDef[]): Command | null {
  const { state, ai } = ctx;
  const heal = usable.find((s) => s.effect === 'heal');
  if (heal) {
    const wounded = listValidTargets(state, unit, heal).filter((id) => {
      const u = state.units[id]!;
      return u.hp / u.stats.maxHp < ai.healHpThreshold;
    });
    const targetId = pickAiTarget(ctx, unit, heal, wounded);
    if (targetId !== null) return useSkill(heal, targetId);
  }
  const revive = usable.find((s) => s.effect === 'revive');
  if (revive) {
    const targetId = pickAiTarget(ctx, unit, revive);
    if (targetId !== null) return useSkill(revive, targetId);
  }
  return null;
}

/** 封印系的技能选择；没有合适的目标时返回 null */
function decideSeal(ctx: AiContext, unit: Unit, usable: readonly SkillDef[]): Command | null {
  const { state, ai } = ctx;
  const seal = usable.find((s) => s.effect === 'seal');
  if (!seal) return null;
  const valid = listValidTargets(state, unit, seal); // 存活且未被封印的对方单位
  // spread：只在拥有主动技能的单位里随机（封印没有技能的单位没有意义）；focus 的筛选在 pickAiTarget 里
  const candidates =
    ai.targetMode[unit.side] === 'spread'
      ? valid.filter((id) => state.units[id]!.skillIds.length > 0)
      : valid;
  const targetId = pickAiTarget(ctx, unit, seal, candidates);
  return targetId === null ? null : useSkill(seal, targetId);
}

/** 为一个单位决定本回合指令 */
export function decideCommand(ctx: AiContext, unitId: UnitId): Command {
  const { state, skills, ai } = ctx;
  const unit = state.units[unitId]!;
  const basic = skills[unit.basicAttackSkillId]!;
  const usable = unit.skillIds
    .map((id) => skills[id])
    .filter((s): s is SkillDef => s !== undefined && getSkillDisabledReason(unit, s) === undefined);

  if (unit.classId === 'heal') {
    const cmd = decideHeal(ctx, unit, usable);
    if (cmd) return cmd;
  } else if (unit.classId === 'seal') {
    const cmd = decideSeal(ctx, unit, usable);
    if (cmd) return cmd;
  }

  const enemies = listValidTargets(state, unit, basic);
  // 没有任何可攻击目标时（正常不会出现）改为防御
  if (enemies.length === 0) return { kind: 'defend' };
  const targetId = pickAiTarget(ctx, unit, basic, enemies)!;

  if (unit.classId === 'physical' || unit.classId === 'magic') {
    const damaging = usable.filter((s) => s.effect === 'damage' && s.targetSide === 'enemy');
    const group = damaging.find((s) => s.targetCount > 1);
    if (group && enemies.length >= ai.aoeMinTargets) return useSkill(group, targetId);
    const single = damaging.find((s) => s.targetCount === 1);
    if (single) return useSkill(single, targetId);
  }
  return { kind: 'attack', targetId };
}

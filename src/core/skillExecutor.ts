// 技能执行：按技能的 pattern 结算并产出事件（对应 DESIGN.md §3.3、§6.6）。
//
// 四种执行模式（SkillDef.pattern）：
//   single        单目标单段（普攻、单体法术、封印、复活）
//   multiHit      单目标多段（连斩 / 三连射）：目标中途死亡，剩余段数取消
//   sequential    多目标依次（旋风斩 / 箭雨）：每个目标一步，已死亡的目标跳过
//   simultaneous  多目标同时（群体法术、群体治疗）：全部目标同一步结算
// 每个目标、每一段的命中、暴击、伤害都独立判定。

import { resolveDamage, resolveHeal, rollHit } from './damage';
import type { BattleEventInput } from './events';
import type { Rng } from './rng';
import { applyStatus } from './status';
import type { AnimType, BattleConfig, BattleState, Delivery, SkillDef, Unit, UnitId } from './types';

/** 执行技能时需要的上下文，由引擎提供 */
export interface ExecContext {
  state: BattleState;
  config: BattleConfig;
  rng: Rng;
  emit(e: BattleEventInput): void;
}

/** 一段伤害在整个技能中的位置 */
interface HitPosition {
  stepIndex: number;
  stepCount: number;
  hitIndex: number;
  hitCount: number;
}

/** 一次治疗在整个技能中的位置 */
type StepPosition = Pick<HitPosition, 'stepIndex' | 'stepCount'>;

/**
 * 实际出手方式（DESIGN §4.4）：
 * 法术类技能固定原地施放；物理技能取单位的出手方式，原地施法型单位按近战处理。
 */
export function resolveDelivery(skill: SkillDef, unit: Unit): Delivery {
  if (skill.damageType === 'magic') return 'cast';
  return unit.attackMode === 'ranged' ? 'ranged' : 'melee';
}

/** 取技能在该出手方式下的动画类型；配置缺失时报错 */
export function resolveAnimation(skill: SkillDef, delivery: Delivery): AnimType {
  const anim = skill.animation[delivery];
  if (!anim) throw new Error(`技能 ${skill.id} 缺少出手方式 ${delivery} 的动画配置`);
  return anim;
}

/** 单位死亡：标记倒地、清除状态和防御、作废本回合指令，并发出事件 */
export function killUnit(ctx: ExecContext, unit: Unit, killerId: UnitId): void {
  unit.hp = 0;
  unit.alive = false;
  unit.defending = false;
  const statuses = unit.statuses;
  unit.statuses = [];
  delete ctx.state.commands[unit.id];
  // 敌方被击败后消失；友方倒地保持，可被复活
  ctx.emit({ type: 'UnitDied', unitId: unit.id, killerId, vanish: unit.side === 'enemy' });
  for (const s of statuses) {
    ctx.emit({ type: 'StatusRemoved', unitId: unit.id, status: s.type, reason: 'death' });
  }
}

/** 结算一段伤害并发出 HitResolved；返回目标是否被这一段击杀（击杀事件由调用方决定何时发出） */
function resolveHit(
  ctx: ExecContext,
  actor: Unit,
  target: Unit,
  skill: SkillDef,
  pos: HitPosition,
): boolean {
  const result = resolveDamage(
    actor.stats,
    { defense: target.stats.defense, defending: target.defending },
    skill,
    ctx.config,
    ctx.rng,
  );
  const hpBefore = target.hp;
  const hpAfter = Math.max(0, hpBefore - result.damage);
  target.hp = hpAfter;
  const killed = !result.isMiss && hpAfter === 0;
  ctx.emit({
    type: 'HitResolved',
    actorId: actor.id,
    targetId: target.id,
    skillId: skill.id,
    ...pos,
    damageType: skill.damageType,
    isMiss: result.isMiss,
    isCrit: result.isCrit,
    defended: result.defended,
    damage: result.damage,
    hpBefore,
    hpAfter,
    killed,
  });
  return killed;
}

/** 结算一个目标的治疗并发出 HealResolved；倒地的单位不能被治疗 */
function resolveHealOn(
  ctx: ExecContext,
  actor: Unit,
  target: Unit,
  skill: SkillDef,
  pos: StepPosition,
): void {
  if (!target.alive) return;
  const result = resolveHeal(actor.stats, skill, ctx.config, ctx.rng);
  const hpBefore = target.hp;
  const hpAfter = Math.min(target.stats.maxHp, hpBefore + result.amount);
  target.hp = hpAfter;
  ctx.emit({
    type: 'HealResolved',
    actorId: actor.id,
    targetId: target.id,
    skillId: skill.id,
    ...pos,
    isCrit: result.isCrit,
    amount: hpAfter - hpBefore, // 实际回复量
    hpBefore,
    hpAfter,
  });
}

/** 封印：按命中率判定，命中则加上状态 */
function resolveSeal(ctx: ExecContext, actor: Unit, target: Unit, skill: SkillDef): void {
  const def = skill.status;
  if (!def) throw new Error(`技能 ${skill.id} 缺少 status 配置`);
  if (!target.alive) return;
  const landed = rollHit(skill.hitRate, ctx.rng);
  const status = landed
    ? applyStatus(target, def.type, def.duration, actor.id, ctx.state.turn)
    : null;
  if (status) {
    ctx.emit({
      type: 'StatusApplied',
      unitId: target.id,
      sourceId: actor.id,
      status: status.type,
      remainingTurns: status.remainingTurns,
    });
  } else {
    ctx.emit({ type: 'StatusResisted', unitId: target.id, sourceId: actor.id, status: def.type });
  }
}

/**
 * 复活（DESIGN §5.5）：恢复部分气血，魔法保持倒地时的值，不带任何状态。
 * 被复活者在本回合出手顺序里排在施法者之后，本回合还能出手；排在之前则位置已过，本回合不出手。
 */
function resolveRevive(ctx: ExecContext, actor: Unit, target: Unit, skill: SkillDef): void {
  if (target.alive) return;
  const ratio = skill.reviveHpRatio;
  if (ratio === undefined) throw new Error(`技能 ${skill.id} 缺少 reviveHpRatio 配置`);
  target.hp = Math.min(target.stats.maxHp, Math.max(1, Math.floor(target.stats.maxHp * ratio)));
  target.alive = true;
  target.statuses = [];
  target.defending = false;
  const order = ctx.state.turnOrder;
  const actorIndex = order.indexOf(actor.id);
  const targetIndex = order.indexOf(target.id);
  ctx.emit({
    type: 'UnitRevived',
    unitId: target.id,
    actorId: actor.id,
    hpAfter: target.hp,
    maxHp: target.stats.maxHp,
    actsThisTurn: actorIndex !== -1 && targetIndex > actorIndex,
  });
}

/** 对一个目标施加技能的一步效果（非伤害类） */
function applyEffect(
  ctx: ExecContext,
  actor: Unit,
  target: Unit,
  skill: SkillDef,
  pos: StepPosition,
): void {
  if (skill.effect === 'heal') resolveHealOn(ctx, actor, target, skill, pos);
  else if (skill.effect === 'seal') resolveSeal(ctx, actor, target, skill);
  else if (skill.effect === 'revive') resolveRevive(ctx, actor, target, skill);
}

/**
 * 执行技能。调用前引擎已经完成：指令回退、目标重选与补足、扣除魔法、发出 SkillCast。
 * @param targets 已确定的目标列表（执行顺序，即 SkillCast.targets）
 */
export function executeSkill(
  ctx: ExecContext,
  actor: Unit,
  skill: SkillDef,
  targets: readonly UnitId[],
): void {
  const units = targets.map((id) => ctx.state.units[id]!);
  const hits = Math.max(1, skill.hits);

  if (skill.pattern === 'simultaneous') {
    // 所有目标同一步结算；死亡事件等这一步的结算全部发出后再统一发出
    const pos = { stepIndex: 0, stepCount: 1 };
    if (skill.effect !== 'damage') {
      for (const target of units) applyEffect(ctx, actor, target, skill, pos);
      return;
    }
    const killed: Unit[] = [];
    for (const target of units) {
      if (!target.alive) continue;
      if (resolveHit(ctx, actor, target, skill, { ...pos, hitIndex: 0, hitCount: 1 })) {
        killed.push(target);
      }
    }
    for (const target of killed) killUnit(ctx, target, actor.id);
    return;
  }

  if (skill.pattern === 'multiHit' || skill.pattern === 'single') {
    // 单目标：每一段是一步；目标死亡后剩余段数取消
    const target = units[0];
    if (!target) return;
    if (skill.effect !== 'damage') {
      applyEffect(ctx, actor, target, skill, { stepIndex: 0, stepCount: 1 });
      return;
    }
    for (let i = 0; i < hits && target.alive; i++) {
      const killed = resolveHit(ctx, actor, target, skill, {
        stepIndex: i,
        stepCount: hits,
        hitIndex: i,
        hitCount: hits,
      });
      if (killed) killUnit(ctx, target, actor.id);
    }
    return;
  }

  // sequential：每个目标一步，stepIndex = 目标在列表中的下标；轮到时已经死亡的目标直接跳过
  units.forEach((target, stepIndex) => {
    const pos = { stepIndex, stepCount: units.length };
    if (skill.effect !== 'damage') {
      applyEffect(ctx, actor, target, skill, pos);
      return;
    }
    for (let i = 0; i < hits && target.alive; i++) {
      const killed = resolveHit(ctx, actor, target, skill, { ...pos, hitIndex: i, hitCount: hits });
      if (killed) killUnit(ctx, target, actor.id);
    }
  });
}

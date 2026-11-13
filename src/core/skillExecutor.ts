// 技能执行：按技能的 pattern 结算并产出事件（对应 DESIGN.md §3.3、§6.6）。
// 步骤 1 只实现“单目标单段伤害”（普攻就是这种技能）。
// 连斩、旋风斩、群体法术、封印、治疗、复活的执行在步骤 2 实现。

import { resolveDamage } from './damage';
import type { BattleEventInput } from './events';
import type { Rng } from './rng';
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

/** 该技能的执行方式本步骤是否已经支持 */
export function isSkillSupported(skill: SkillDef): boolean {
  return skill.pattern === 'single' && skill.effect === 'damage';
}

/**
 * 执行技能。调用前引擎已经完成：指令回退、目标重选、扣除魔法、发出 SkillCast。
 * @param targets 已确定的目标列表（执行顺序）
 */
export function executeSkill(
  ctx: ExecContext,
  actor: Unit,
  skill: SkillDef,
  targets: readonly UnitId[],
): void {
  if (!isSkillSupported(skill)) {
    throw new Error(`技能 ${skill.id}（${skill.pattern}/${skill.effect}）的执行将在步骤 2 实现`);
  }
  // 单目标单段伤害
  const target = ctx.state.units[targets[0]!]!;
  const killed = resolveHit(ctx, actor, target, skill, {
    stepIndex: 0,
    stepCount: 1,
    hitIndex: 0,
    hitCount: 1,
  });
  if (killed) killUnit(ctx, target, actor.id);
}

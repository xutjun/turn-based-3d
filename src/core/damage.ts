// 伤害公式（对应 DESIGN.md §5.1 ~ §5.3、§5.6、§5.7）。
// 所有伤害计算集中在本文件，系数全部来自 BattleConfig，不写死任何数值。
//
// 物理伤害（近战和远程完全相同）：
//   base   = max(1, 攻击者物理伤害 × 技能倍率 − 目标防御)
//   damage = max(1, round(base × 随机浮动 × 暴击倍率 × 防御指令倍率))
//
// 法术伤害：
//   base   = max(1, 攻击者法术伤害 × 技能倍率 − 目标防御 × 法术防御系数)
//   damage = max(1, round(base × 随机浮动 × 暴击倍率 × 防御指令倍率))
//
// 治疗：
//   amount = round(施法者法术伤害 × 技能倍率 × 随机浮动 × 暴击倍率)，不受防御影响
//
// 每一段伤害的随机数消耗顺序固定为：命中 → 浮动 → 暴击。
// 未命中时只消耗“命中”这一个随机数，伤害为 0。

import { randRange, type Rng } from './rng';
import type { BattleConfig, CritConfig, DamageType } from './types';

/** 攻击方参与计算的属性 */
export interface DamageSource {
  physAtk: number;
  magAtk: number;
}

/** 受击方参与计算的属性 */
export interface DamageTarget {
  defense: number;
  defending: boolean; // 本回合是否下了“防御”指令
}

/** 技能参与计算的字段 */
export interface DamageSkill {
  damageType: DamageType;
  multiplier: number;
  hitRate: number;
}

/** 一段伤害的结算结果 */
export interface DamageResult {
  isMiss: boolean;
  isCrit: boolean;
  defended: boolean; // 这一段是否被防御指令减半
  damage: number; // 未命中时为 0，命中时至少为 1
}

/** 物理基础伤害：max(1, 物理伤害 × 倍率 − 防御) */
export function physicalBase(physAtk: number, multiplier: number, defense: number): number {
  return Math.max(1, physAtk * multiplier - defense);
}

/** 法术基础伤害：max(1, 法术伤害 × 倍率 − 防御 × 法术防御系数) */
export function magicBase(
  magAtk: number,
  multiplier: number,
  defense: number,
  config: BattleConfig,
): number {
  return Math.max(1, magAtk * multiplier - defense * config.magicDefenseCoef);
}

/** 命中判定：随机数小于命中率即命中 */
export function rollHit(hitRate: number, rng: Rng): boolean {
  return rng.next() < hitRate;
}

/** 随机浮动系数：在 [varianceMin, varianceMax) 内均匀取值 */
export function rollVariance(config: BattleConfig, rng: Rng): number {
  return randRange(rng, config.varianceMin, config.varianceMax);
}

/** 暴击判定：返回是否暴击 */
export function rollCrit(crit: CritConfig, rng: Rng): boolean {
  return rng.next() < crit.rate;
}

/**
 * 结算一段伤害。
 * 多段、多目标技能对每一段分别调用本函数，所以命中、浮动、暴击都是各段独立判定。
 */
export function resolveDamage(
  source: DamageSource,
  target: DamageTarget,
  skill: DamageSkill,
  config: BattleConfig,
  rng: Rng,
): DamageResult {
  // 1. 命中
  if (!rollHit(skill.hitRate, rng)) {
    return { isMiss: true, isCrit: false, defended: false, damage: 0 };
  }

  // 2. 基础伤害（物理和法术只有这一步不同）
  const base =
    skill.damageType === 'physical'
      ? physicalBase(source.physAtk, skill.multiplier, target.defense)
      : magicBase(source.magAtk, skill.multiplier, target.defense, config);

  // 3. 随机浮动
  const variance = rollVariance(config, rng);

  // 4. 暴击（物理、法术各用自己的暴击率和倍率）
  const critConfig = config.crit[skill.damageType];
  const isCrit = rollCrit(critConfig, rng);
  const critMult = isCrit ? critConfig.multiplier : 1;

  // 5. 防御指令：本回合受到的伤害乘以 defendDamageMult
  const defendMult = target.defending ? config.defendDamageMult : 1;

  const damage = Math.max(1, Math.round(base * variance * critMult * defendMult));
  return { isMiss: false, isCrit, defended: target.defending, damage };
}

/** 一个治疗目标的结算结果 */
export interface HealResult {
  isCrit: boolean;
  amount: number; // 治疗量（还没有按气血上限截断）
}

/**
 * 结算一次治疗（DESIGN §5.4）：治疗量 = round(法术伤害 × 倍率 × 随机浮动 × 暴击倍率)。
 * 治疗不判定命中、不受防御影响；随机数消耗顺序为：浮动 → 暴击。
 */
export function resolveHeal(
  source: DamageSource,
  skill: Pick<DamageSkill, 'multiplier'>,
  config: BattleConfig,
  rng: Rng,
): HealResult {
  const variance = rollVariance(config, rng);
  const isCrit = rollCrit(config.crit.heal, rng);
  const critMult = isCrit ? config.crit.heal.multiplier : 1;
  return { isCrit, amount: Math.round(source.magAtk * skill.multiplier * variance * critMult) };
}

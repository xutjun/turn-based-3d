// 出手排序（对应 DESIGN.md §8.2 的 TurnStart）。
// 每回合开始时重新排序：速度从高到低；速度相同的单位之间随机。

import { shuffleInPlace, type Rng } from './rng';
import type { Unit, UnitId } from './types';

/** 该单位是否参与本回合排序：存活单位，以及倒地的友方（本回合可能被复活）。敌方被击败即消失，不参与。 */
export function isInTurnOrder(unit: Unit): boolean {
  return unit.alive || unit.side === 'ally';
}

/**
 * 生成本回合出手顺序。
 * @param units 按固定顺序（unitIds 顺序）传入的全部单位
 */
export function buildTurnOrder(units: readonly Unit[], rng: Rng): UnitId[] {
  // 按速度分组
  const groups = new Map<number, UnitId[]>();
  for (const u of units) {
    if (!isInTurnOrder(u)) continue;
    const g = groups.get(u.stats.speed);
    if (g) g.push(u.id);
    else groups.set(u.stats.speed, [u.id]);
  }
  // 速度从高到低；同速组内洗牌（只有 1 个单位的组不消耗随机数）
  const speeds = [...groups.keys()].sort((a, b) => b - a);
  const order: UnitId[] = [];
  for (const s of speeds) {
    const g = groups.get(s)!;
    if (g.length > 1) shuffleInPlace(rng, g);
    order.push(...g);
  }
  return order;
}

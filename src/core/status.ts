// 状态（封印）相关：查询、施加、回合递减（对应 DESIGN.md §5.8）。

import type { BattleEventInput } from './events';
import type { Status, StatusType, Unit, UnitId } from './types';

/** 单位当前是否被封印（被封印时不能使用技能，仍可普攻和防御） */
export function isSealed(unit: Unit): boolean {
  return unit.statuses.some((s) => s.type === 'seal' && s.remainingTurns > 0);
}

/**
 * 给单位加上一个状态。同类型状态不叠加：单位身上已有该状态时不做任何事并返回 null
 * （目标规则已经禁止重复封印，这里是防御性处理）。
 */
export function applyStatus(
  unit: Unit,
  type: StatusType,
  duration: number,
  sourceId: UnitId,
  turn: number,
): Status | null {
  if (unit.statuses.some((s) => s.type === type && s.remainingTurns > 0)) return null;
  const status: Status = { type, remainingTurns: duration, sourceId, appliedTurn: turn };
  unit.statuses.push(status);
  return status;
}

/**
 * 回合结算时的状态递减：所有存活单位的状态剩余回合减一，
 * 减到 0 的移除并发出 StatusRemoved(expired)，否则发出 StatusTicked。施加的那个回合也计入递减。
 */
export function tickStatuses(units: readonly Unit[], emit: (e: BattleEventInput) => void): void {
  for (const unit of units) {
    if (!unit.alive || unit.statuses.length === 0) continue;
    const remaining: Status[] = [];
    for (const s of unit.statuses) {
      s.remainingTurns -= 1;
      if (s.remainingTurns > 0) {
        remaining.push(s);
        emit({ type: 'StatusTicked', unitId: unit.id, status: s.type, remainingTurns: s.remainingTurns });
      } else {
        emit({ type: 'StatusRemoved', unitId: unit.id, status: s.type, reason: 'expired' });
      }
    }
    unit.statuses = remaining;
  }
}

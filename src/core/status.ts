// 状态（封印）相关。
// 步骤 1 只提供数据结构的查询；封印的施加、回合递减、解除在步骤 2 实现。

import type { Unit } from './types';

/** 单位当前是否被封印（被封印时不能使用技能，仍可普攻和防御） */
export function isSealed(unit: Unit): boolean {
  return unit.statuses.some((s) => s.type === 'seal' && s.remainingTurns > 0);
}

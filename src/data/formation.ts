// 阵型格子（对应 DESIGN.md §7）。
// 步骤 1 只有格子部分；世界坐标（间距、中心点、朝向）在步骤 3 加入。

import type { Slot } from '../core/types';

export const FORMATION_ROWS = 2; // 0 = 前排（靠近对方），1 = 后排
export const FORMATION_COLS = 5; // 0 = 屏幕最左，4 = 屏幕最右

/** 格子的唯一键，例如 '0,2' */
export function slotKey(slot: Slot): string {
  return `${slot.row},${slot.col}`;
}

/** 格子是否在阵型范围内 */
export function isValidSlot(slot: Slot): boolean {
  return (
    Number.isInteger(slot.row) &&
    Number.isInteger(slot.col) &&
    slot.row >= 0 &&
    slot.row < FORMATION_ROWS &&
    slot.col >= 0 &&
    slot.col < FORMATION_COLS
  );
}

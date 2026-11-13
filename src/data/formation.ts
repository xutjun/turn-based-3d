// 阵型配置（对应 DESIGN.md §7）：格子定义 + 世界坐标。
// 纯数据和纯数学，不依赖渲染库。改这里的参数，场上单位位置会同步变化。
//
// 世界坐标系：+x 向右，+y 向上，+z 朝向相机。
// 相机默认在 +z 一侧斜俯视原点，所以屏幕左上 ≈ (−x, −z)，右下 ≈ (+x, +z)。

import type { Side, Slot } from '../core/types';

export const FORMATION_ROWS = 2; // 0 = 前排（靠近对方），1 = 后排
export const FORMATION_COLS = 5; // 0 = 屏幕最左，4 = 屏幕最右

export const FORMATION = {
  colSpacing: 2.2, // 同排相邻格子间距
  rowSpacing: 2.0, // 前后排间距
  allyFrontCenter: { x: 4.5, z: 4.5 }, // 友方前排中心（col 2），画面右下
  enemyFrontCenter: { x: -4.5, z: -4.5 }, // 敌方前排中心（col 2），画面左上
};

/** 地面上的二维向量（世界坐标的 x、z 分量） */
export interface GroundVec {
  x: number;
  z: number;
}

const INV_SQRT2 = Math.SQRT1_2;

/** 排方向（col 增大的方向），双方相同：从屏幕左下指向右上 */
export const ROW_DIRECTION: GroundVec = { x: INV_SQRT2, z: -INV_SQRT2 };

/** 某一方的朝向（单位向量）：友方面朝左上的敌人，敌方面朝右下的友方 */
export function facingOf(side: Side): GroundVec {
  return side === 'ally' ? { x: -INV_SQRT2, z: -INV_SQRT2 } : { x: INV_SQRT2, z: INV_SQRT2 };
}

/** 某一方朝向对应的绕 y 轴旋转角（弧度）。模型默认面朝 +z。 */
export function facingYawOf(side: Side): number {
  const f = facingOf(side);
  return Math.atan2(f.x, f.z);
}

/**
 * 格子的世界坐标：
 * 前排中心 + 排方向 × (col − 中间列) × 列间距 − 朝向 × row × 排间距（后排远离对方）
 */
export function slotPosition(side: Side, slot: Slot): GroundVec {
  const center = side === 'ally' ? FORMATION.allyFrontCenter : FORMATION.enemyFrontCenter;
  const f = facingOf(side);
  const colOffset = (slot.col - (FORMATION_COLS - 1) / 2) * FORMATION.colSpacing;
  const rowOffset = slot.row * FORMATION.rowSpacing;
  return {
    x: center.x + ROW_DIRECTION.x * colOffset - f.x * rowOffset,
    z: center.z + ROW_DIRECTION.z * colOffset - f.z * rowOffset,
  };
}

/** 一方的全部格子，按前排到后排、从左到右 */
export function allSlots(): Slot[] {
  const slots: Slot[] = [];
  for (let row = 0; row < FORMATION_ROWS; row++) {
    for (let col = 0; col < FORMATION_COLS; col++) {
      slots.push({ row, col } as Slot);
    }
  }
  return slots;
}

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

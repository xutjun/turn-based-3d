// 鼠标拾取：根据单位在屏幕上的位置判断鼠标指着谁。纯计算，不依赖 DOM 和 three。

import type { UnitId } from '../../core/types';
import { UI_CONFIG } from '../../data/uiConfig';

/** 一个单位在屏幕上的可点范围（像素） */
export interface ScreenBox {
  id: UnitId;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** 脚底的屏幕 y：越大越靠近镜头，重叠时优先选靠前的单位 */
  depth: number;
}

/** 由脚底和头顶的屏幕坐标算出可点范围 */
export function screenBoxOf(
  id: UnitId,
  foot: { x: number; y: number },
  head: { x: number; y: number },
  pick: typeof UI_CONFIG.pick = UI_CONFIG.pick,
): ScreenBox {
  const height = Math.max(0, foot.y - head.y);
  const half = Math.max(pick.minHalfWidth, height * pick.widthRatio);
  const cx = (foot.x + head.x) / 2;
  return {
    id,
    left: cx - half,
    right: cx + half,
    top: head.y - pick.headPadding,
    bottom: foot.y + pick.footPadding,
    depth: foot.y,
  };
}

/**
 * 鼠标在 (x, y) 时指着的单位；没有指着任何单位返回 null。
 * 多个范围重叠时，优先水平方向更靠近中心的；一样近时取更靠近镜头的。
 */
export function pickUnitAt(x: number, y: number, boxes: readonly ScreenBox[]): UnitId | null {
  let best: ScreenBox | null = null;
  let bestScore = Infinity;
  for (const b of boxes) {
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) continue;
    const half = (b.right - b.left) / 2;
    const score = Math.abs(x - (b.left + b.right) / 2) / half;
    if (score < bestScore - 1e-6 || (Math.abs(score - bestScore) <= 1e-6 && best !== null && b.depth > best.depth)) {
      best = b;
      bestScore = score;
    }
  }
  return best?.id ?? null;
}

/** 界面面板的选择器：落在这些元素上的鼠标事件不算选目标 */
export const PANEL_SELECTOR = '.dk-panel, .dk-result-veil, .hud-controls, .dk-menu-layer > *';

/**
 * 一次鼠标事件是否发生在界面面板上。
 * 必须用事件派发时的路径（event.composedPath()）判断，不能用 target.closest()：
 * 点技能按钮会让面板立刻重画，按钮随即脱离文档，closest() 找不到面板，
 * 这次点击就会被当成点在战场上——按钮背后正好有单位时会直接把它选为目标。
 */
export function eventOnPanel(path: readonly unknown[]): boolean {
  return path.some((node) => {
    const el = node as { matches?: (selector: string) => boolean };
    return typeof el.matches === 'function' && el.matches(PANEL_SELECTOR);
  });
}

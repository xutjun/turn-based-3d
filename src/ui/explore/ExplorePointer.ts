// 探索模式的鼠标输入（步骤 15）：左键点地面 = 队长跑过去；鼠标指着 Boss 时光标变成手形、Boss 轮廓高亮。
// 点到 Boss 身上按 Boss 脚下的地面处理（跑到 Boss 身边最近的可达点；对话在步骤 16）。
// 鼠标坐标先过 clientToLocal（固定 16:10 画面被整体缩放，步骤 12 E3）；落在界面面板上的事件不算。

import { clientToLocal } from '../layout/viewportMath';
import { eventOnPanel, pickUnitAt, type ScreenBox } from '../input/picking';

export interface ExplorePointerDeps {
  container: HTMLElement;
  /** 现在是否接受探索的鼠标操作（探索界面、菜单没开、没在切换中） */
  enabled(): boolean;
  /** 排版坐标 → 地面（y = 0）上的点；射线碰不到地面返回 null */
  groundAt(x: number, y: number): { x: number; z: number } | null;
  /** Boss 在屏幕上的可点范围（不在场 / 看不见时为 null） */
  bossBox(): ScreenBox | null;
  /** 点了地面上的某点 */
  onGround(x: number, z: number): void;
  /** 点了 Boss */
  onBoss(): void;
  /** 鼠标开始 / 不再指着 Boss */
  onBossHover(on: boolean): void;
}

/** 一次点击落在哪里（纯函数，可测）：先看是否点在 Boss 上，否则求地面上的点；都不是返回 null */
export function resolveExploreClick(
  x: number,
  y: number,
  bossBox: ScreenBox | null,
  groundAt: (x: number, y: number) => { x: number; z: number } | null,
): { kind: 'boss' } | { kind: 'ground'; x: number; z: number } | null {
  if (bossBox && pickUnitAt(x, y, [bossBox]) !== null) return { kind: 'boss' };
  const g = groundAt(x, y);
  return g ? { kind: 'ground', x: g.x, z: g.z } : null;
}

export class ExplorePointer {
  private hovering = false;

  constructor(private readonly deps: ExplorePointerDeps) {
    const c = deps.container;
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('click', this.onClick);
  }

  dispose(): void {
    const c = this.deps.container;
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('click', this.onClick);
    this.setHover(false);
  }

  /** 离开探索、打开菜单时：取消悬停 */
  clear(): void {
    this.setHover(false);
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const c = this.deps.container;
    return clientToLocal(e.clientX, e.clientY, c.getBoundingClientRect(), c.clientWidth, c.clientHeight);
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.deps.enabled() || eventOnPanel(e.composedPath())) {
      this.setHover(false);
      return;
    }
    const p = this.local(e);
    const box = this.deps.bossBox();
    this.setHover(box !== null && pickUnitAt(p.x, p.y, [box]) !== null);
  };

  private readonly onLeave = (): void => this.setHover(false);

  private readonly onClick = (e: MouseEvent): void => {
    if (e.button !== 0 || !this.deps.enabled() || eventOnPanel(e.composedPath())) return;
    const p = this.local(e);
    const hit = resolveExploreClick(p.x, p.y, this.deps.bossBox(), (x, y) => this.deps.groundAt(x, y));
    if (!hit) return;
    if (hit.kind === 'boss') this.deps.onBoss();
    else this.deps.onGround(hit.x, hit.z);
  };

  private setHover(on: boolean): void {
    if (on === this.hovering) return;
    this.hovering = on;
    this.deps.container.style.cursor = on ? 'pointer' : '';
    this.deps.onBossHover(on);
  }
}

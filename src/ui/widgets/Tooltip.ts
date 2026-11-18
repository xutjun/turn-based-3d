// 通用悬停提示框（步骤 21，DESIGN §12.3）：圆球的数值、按钮名称、禁用按钮的“敬请期待”、装备提示（步骤 22）共用一个提示框。
// 提示框放在界面层里（舞台排版坐标）。位置按目标元素的窗口矩形换算回排版坐标（舞台被整体缩放，步骤 12），
// 默认放在目标正上方居中；上方放不下就放到下方，左右超出画面时贴边（placeTooltip，步骤 22：不超出屏幕边缘）。

import { el } from '../theme';

export interface TooltipDeps {
  /** 提示框挂在哪一层（与目标元素同在舞台里） */
  root: HTMLElement;
  /** 舞台：用它的窗口矩形与排版宽度换算坐标 */
  stage: HTMLElement;
}

/** 提示框的内容：纯文字，或一个排好版的元素（装备提示） */
export type TooltipContent = string | HTMLElement;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 提示框放在哪里（纯函数，可测；单位都是舞台排版像素）：
 * 目标上方居中、间隔 gap；上方不够就放到目标下方；左右、上下都夹在 [margin, 边界 − margin] 内。
 */
export function placeTooltip(
  anchor: Box,
  size: { width: number; height: number },
  bounds: { width: number; height: number },
  margin = 6,
  gap = 8,
): { left: number; top: number; below: boolean } {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(Math.max(lo, hi), v));
  const left = clamp(anchor.left + anchor.width / 2 - size.width / 2, margin, bounds.width - margin - size.width);
  let top = anchor.top - gap - size.height;
  let below = false;
  if (top < margin) {
    top = anchor.top + anchor.height + gap;
    below = true;
  }
  top = clamp(top, margin, bounds.height - margin - size.height);
  return { left, top, below };
}

export class Tooltip {
  private readonly box: HTMLDivElement;
  private target: HTMLElement | null = null;
  private content: () => TooltipContent = () => '';
  private shown: TooltipContent | null = null;

  constructor(private readonly deps: TooltipDeps) {
    this.box = el('div', 'dk-tip');
    this.box.style.display = 'none';
    deps.root.append(this.box);
  }

  /** 当前显示的文字（没显示时为 null；内容是元素时为 ''） */
  get shownText(): string | null {
    if (!this.target) return null;
    return typeof this.shown === 'string' ? this.shown : '';
  }

  /** 当前显示的内容（没显示时为 null） */
  get shownContent(): TooltipContent | null {
    return this.target ? this.shown : null;
  }

  /** 让 target 在悬停时显示 content() 返回的内容（每次悬停重新取，数值会变） */
  attach(target: HTMLElement, content: () => TooltipContent): void {
    target.addEventListener('pointerenter', () => this.show(target, content));
    target.addEventListener('pointerleave', () => this.hide(target));
  }

  show(target: HTMLElement, content: () => TooltipContent): void {
    this.target = target;
    this.content = content;
    this.fill();
    this.box.style.display = '';
    this.place();
  }

  /** 隐藏（只隐藏 target 的提示；不传则无条件隐藏） */
  hide(target?: HTMLElement): void {
    if (target && target !== this.target) return;
    this.target = null;
    this.shown = null;
    this.box.style.display = 'none';
  }

  /** 内容可能变化（数值更新）时刷新 */
  refresh(): void {
    if (!this.target) return;
    this.fill();
    this.place();
  }

  dispose(): void {
    this.box.remove();
  }

  private fill(): void {
    const c = this.content();
    this.shown = c;
    const rich = typeof c !== 'string';
    this.box.classList.toggle('is-rich', rich);
    if (rich) this.box.replaceChildren(c);
    else {
      this.box.replaceChildren();
      this.box.textContent = c;
    }
  }

  /** 按目标位置摆放，不超出画面（舞台排版坐标） */
  private place(): void {
    const t = this.target;
    if (!t) return;
    const stage = this.deps.stage;
    const sr = stage.getBoundingClientRect();
    const scale = sr.width > 0 && stage.clientWidth > 0 ? sr.width / stage.clientWidth : 1;
    const r = t.getBoundingClientRect();
    const anchor = { left: (r.left - sr.left) / scale, top: (r.top - sr.top) / scale, width: r.width / scale, height: r.height / scale };
    const size = { width: this.box.offsetWidth || 0, height: this.box.offsetHeight || 0 };
    const p = placeTooltip(anchor, size, { width: stage.clientWidth, height: stage.clientHeight });
    this.box.style.left = `${p.left.toFixed(1)}px`;
    this.box.style.top = `${p.top.toFixed(1)}px`;
  }
}

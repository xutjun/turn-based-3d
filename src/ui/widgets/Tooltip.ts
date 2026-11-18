// 通用悬停提示框（步骤 21，DESIGN §12.3）：圆球的数值、按钮名称、禁用按钮的“敬请期待”共用一个提示框。
// 提示框放在界面层里（舞台坐标），位置按目标元素的窗口矩形换算回舞台排版坐标（舞台被整体缩放，步骤 12）。

import { el } from '../theme';

export interface TooltipDeps {
  /** 提示框挂在哪一层（与目标元素同在舞台里） */
  root: HTMLElement;
  /** 舞台：用它的窗口矩形与排版宽度换算坐标 */
  stage: HTMLElement;
}

export class Tooltip {
  private readonly box: HTMLDivElement;
  private target: HTMLElement | null = null;
  private text: () => string = () => '';

  constructor(private readonly deps: TooltipDeps) {
    this.box = el('div', 'dk-tip');
    this.box.style.display = 'none';
    deps.root.append(this.box);
  }

  /** 当前显示的文字（没显示时为 null） */
  get shownText(): string | null {
    return this.target ? this.box.textContent : null;
  }

  /** 让 target 在悬停时显示 text() 返回的文字（每次悬停重新取，数值会变） */
  attach(target: HTMLElement, text: () => string): void {
    target.addEventListener('pointerenter', () => this.show(target, text));
    target.addEventListener('pointerleave', () => this.hide(target));
  }

  show(target: HTMLElement, text: () => string): void {
    this.target = target;
    this.text = text;
    this.box.textContent = text();
    this.box.style.display = '';
    this.place();
  }

  /** 隐藏（只隐藏 target 的提示；不传则无条件隐藏） */
  hide(target?: HTMLElement): void {
    if (target && target !== this.target) return;
    this.target = null;
    this.box.style.display = 'none';
  }

  /** 文字可能变化（数值更新）时刷新 */
  refresh(): void {
    if (!this.target) return;
    this.box.textContent = this.text();
    this.place();
  }

  dispose(): void {
    this.box.remove();
  }

  /** 放在目标正上方（舞台排版坐标） */
  private place(): void {
    const t = this.target;
    if (!t) return;
    const stage = this.deps.stage;
    const sr = stage.getBoundingClientRect();
    const scale = sr.width > 0 && stage.clientWidth > 0 ? sr.width / stage.clientWidth : 1;
    const r = t.getBoundingClientRect();
    const x = (r.left + r.width / 2 - sr.left) / scale;
    const y = (r.top - sr.top) / scale;
    this.box.style.left = `${x.toFixed(1)}px`;
    this.box.style.top = `${y.toFixed(1)}px`;
  }
}

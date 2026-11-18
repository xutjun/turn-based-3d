// 血蓝圆球（步骤 21，SPEC §15.3、DESIGN §12.3）：左半边气血（红）、右半边魔法（蓝），液面高度 = 当前 / 上限。
// 全部用 CSS 画：暗金属外框（多层阴影 + 铆钉）、竖直金属分隔、液体竖直渐变、液面一道缓慢流动的亮波纹（CSS 动画）、
// 表面一层玻璃高光。数值变化时液面高度 0.3 秒过渡。鼠标悬停左 / 右半边分别显示“气血 950 / 950”“魔法 600 / 600”。
// 探索 / 对话中显示当前队长（步骤 21）；战斗中的圆球在步骤 24 接入（同一个类）。

import { el } from '../theme';
import type { Tooltip } from '../widgets/Tooltip';

export interface OrbValues {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
}

/** 液面高度（0~1）：上限为 0 时按空 */
export function orbLevel(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(1, value / max));
}

export class Orb {
  readonly root: HTMLDivElement;
  private readonly hpHalf: HTMLDivElement;
  private readonly mpHalf: HTMLDivElement;
  private readonly hpLiquid: HTMLDivElement;
  private readonly mpLiquid: HTMLDivElement;
  private values: OrbValues = { hp: 0, maxHp: 0, mp: 0, maxMp: 0 };

  constructor(parent: HTMLElement, tooltip?: Tooltip) {
    this.root = el('div', 'dk-orb');
    const glass = el('div', 'dk-orb-glass');
    this.hpHalf = el('div', 'dk-orb-half is-hp');
    this.mpHalf = el('div', 'dk-orb-half is-mp');
    this.hpLiquid = el('div', 'dk-orb-liquid');
    this.mpLiquid = el('div', 'dk-orb-liquid');
    this.hpLiquid.append(el('i', 'dk-orb-wave'));
    this.mpLiquid.append(el('i', 'dk-orb-wave'));
    this.hpHalf.append(this.hpLiquid);
    this.mpHalf.append(this.mpLiquid);
    glass.append(this.hpHalf, this.mpHalf, el('div', 'dk-orb-divider'), el('div', 'dk-orb-shine'));
    this.root.append(glass);
    parent.append(this.root);
    tooltip?.attach(this.hpHalf, () => this.tipText('hp'));
    tooltip?.attach(this.mpHalf, () => this.tipText('mp'));
    this.render();
  }

  get current(): Readonly<OrbValues> {
    return this.values;
  }

  set(v: OrbValues): void {
    this.values = { ...v };
    this.render();
  }

  /** 悬停提示的文字 */
  tipText(side: 'hp' | 'mp'): string {
    const v = this.values;
    return side === 'hp' ? `气血 ${Math.round(v.hp)} / ${Math.round(v.maxHp)}` : `魔法 ${Math.round(v.mp)} / ${Math.round(v.maxMp)}`;
  }

  /** 两半当前的液面高度（0~1） */
  levels(): { hp: number; mp: number } {
    return { hp: orbLevel(this.values.hp, this.values.maxHp), mp: orbLevel(this.values.mp, this.values.maxMp) };
  }

  private render(): void {
    const l = this.levels();
    this.hpLiquid.style.height = `${(l.hp * 100).toFixed(1)}%`;
    this.mpLiquid.style.height = `${(l.mp * 100).toFixed(1)}%`;
  }
}

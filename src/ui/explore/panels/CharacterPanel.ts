// 角色面板（步骤 21，SPEC §15.3）：左侧当前队长的 3D 模型（待机动画，左键拖拽 360 度旋转，松开有轻微惯性），
// 右侧名称、等级、经验条和 6 项属性。步骤 22 起属性读计算后的最终属性（growth/stats.ts 的 heroFinalStats，与战斗引擎同一个函数），
// 悬停某项属性时显示“基础 + 装备 = 合计”。

import type { UnitId, UnitTemplate } from '../../../core/types';
import { expToNext, heroProgress } from '../../../growth/progression';
import { heroFinalStats, statBreakdown } from '../../../growth/stats';
import type { Tooltip } from '../../widgets/Tooltip';
import { el } from '../../theme';
import { createPanelFrame, cutPanelWindow, type GamePanel } from '../PanelHost';
import { Spin } from '../spin';

/** 预览视口的最小接口（render/preview/PanelPreview 满足它） */
export interface PreviewHost {
  open(id: UnitId, element: HTMLElement): { yaw: number; close(): void };
}

export interface CharacterPanelDeps {
  /** 当前队长 */
  leader(): UnitTemplate;
  /** 3D 预览（没有则只显示空的视口，测试用） */
  preview: PreviewHost | null;
  /** 属性组成的悬停提示（测试里可为 null） */
  tooltip?: Tooltip | null;
  onClose(): void;
  /** 当前时刻（秒），拖拽测速用 */
  now?(): number;
}

const CLASS_LABEL: Record<string, string> = { physical: '物理系', magic: '法术系', seal: '封印系', heal: '恢复系' };

/** 某项属性悬停时的文字：基础 + 装备 = 合计 */
export function statBreakdownText(heroId: string, key: keyof UnitTemplate['stats']): string {
  const b = statBreakdown(heroId, key);
  return `基础 ${b.base} + 装备 ${b.equipment} = ${b.total}`;
}

/** 属性行（顺序与 SPEC §15.1 相同） */
export const CHARACTER_STAT_ROWS: readonly { key: keyof UnitTemplate['stats']; label: string }[] = [
  { key: 'maxHp', label: '气血' },
  { key: 'maxMp', label: '魔法' },
  { key: 'physAtk', label: '物理攻击力' },
  { key: 'magAtk', label: '法术攻击力' },
  { key: 'defense', label: '防御力' },
  { key: 'speed', label: '速度' },
];

export class CharacterPanel implements GamePanel {
  readonly id = 'character' as const;
  readonly root: HTMLDivElement;
  /** 透明的“窗口”：3D 预览画在它下面的画布上 */
  readonly viewport: HTMLDivElement;
  private readonly info: HTMLDivElement;
  readonly spin = new Spin();
  private view: { yaw: number; close(): void } | null = null;
  private pointerId: number | null = null;

  constructor(private readonly deps: CharacterPanelDeps) {
    const frame = createPanelFrame('角色', 'dk-panel-character', deps.onClose);
    this.root = frame.root;
    const layout = el('div', 'dk-char-layout');
    this.viewport = el('div', 'dk-preview-view');
    this.viewport.title = '按住左键拖动旋转';
    this.info = el('div', 'dk-char-info');
    layout.append(this.viewport, this.info);
    frame.body.append(layout);
    this.viewport.addEventListener('pointerdown', this.onDown);
    this.viewport.addEventListener('pointermove', this.onMove);
    this.viewport.addEventListener('pointerup', this.onUp);
    this.viewport.addEventListener('pointercancel', this.onUp);
  }

  /** 预览视口是否打开着 */
  get previewOpen(): boolean {
    return this.view !== null;
  }

  onOpen(): void {
    this.render();
    cutPanelWindow(this.root, this.viewport);
    this.spin.reset();
    const leader = this.deps.leader();
    this.view = this.deps.preview?.open(leader.id, this.viewport) ?? { yaw: 0, close: () => undefined };
    this.view.yaw = 0;
  }

  onClose(): void {
    this.deps.tooltip?.hide();
    this.view?.close();
    this.view = null;
    this.pointerId = null;
  }

  update(dt: number): void {
    this.spin.step(dt);
    if (this.view) this.view.yaw = this.spin.yaw;
  }

  /** 刷新右侧的文字（队长或数值变化时） */
  render(): void {
    const t = this.deps.leader();
    const progress = heroProgress(t.id);
    const need = expToNext(progress.level);
    const head = el('div', 'dk-char-head');
    head.append(el('span', 'dk-char-name', t.name), el('span', 'dk-char-class', CLASS_LABEL[t.classId] ?? ''));
    const level = el('div', 'dk-char-row is-level');
    level.append(el('span', 'dk-char-label', '等级'), el('span', 'dk-char-value', String(progress.level)));
    const exp = el('div', 'dk-char-exp');
    const expHead = el('div', 'dk-char-row');
    expHead.append(el('span', 'dk-char-label', '经验'), el('span', 'dk-char-value', `${progress.exp} / ${need}`));
    const bar = el('div', 'dk-exp-bar');
    const fill = el('i');
    fill.style.width = `${need > 0 ? Math.min(100, (progress.exp / need) * 100).toFixed(1) : 0}%`;
    bar.append(fill);
    exp.append(expHead, bar);
    const stats = el('div', 'dk-char-stats');
    const final = heroFinalStats(t.id);
    for (const row of CHARACTER_STAT_ROWS) {
      const r = el('div', 'dk-char-row is-stat');
      r.dataset['stat'] = row.key;
      r.append(el('span', 'dk-char-label', row.label), el('span', 'dk-char-value', String(final[row.key])));
      this.deps.tooltip?.attach(r, () => statBreakdownText(t.id, row.key));
      stats.append(r);
    }
    this.info.replaceChildren(head, level, exp, el('div', 'dk-sep'), stats);
  }

  private now(): number {
    return this.deps.now?.() ?? performance.now() / 1000;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.viewport.setPointerCapture?.(e.pointerId);
    this.viewport.classList.add('is-dragging');
    this.spin.begin(e.clientX, this.now());
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    this.spin.move(e.clientX, this.now());
    if (this.view) this.view.yaw = this.spin.yaw;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    this.viewport.classList.remove('is-dragging');
    this.spin.end(this.now());
  };
}

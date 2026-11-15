// 指令面板（左下角）：显示当前待下令的单位，提供 攻击 / 技能 / 防御，
// 技能列表显示魔法消耗与说明（魔法不足或被封印时置灰），选目标时显示会命中的目标预览。
// 面板只显示该单位真正拥有的选项：没有主动技能的单位（物理型宝宝）不显示“技能”；被动技能只作为说明显示。
// 面板只读取指令会话的状态并把点击转给会话，不包含任何规则判断。

import type { ClassId, Unit, UnitId } from '../../core/types';
import { PASSIVES } from '../../data/passives';
import { UI_CONFIG } from '../../data/uiConfig';
import { disabledLabel, type CommandSession, type Notice } from '../command/CommandSession';
import type { UiPhase } from '../PlayerBattleController';
import { el } from '../theme';

const CLASS_LABEL: Record<ClassId, string> = {
  physical: '物理系',
  magic: '法术系',
  seal: '封印系',
  heal: '恢复系',
};

export interface CommandPanelDeps {
  root: HTMLElement;
  session: CommandSession;
  unitName(id: UnitId): string;
}

export class CommandPanel {
  private readonly panel: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private phase: UiPhase = 'execution';
  private turn = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: CommandPanelDeps) {
    this.panel = el('div', 'dk-panel dk-command is-hidden');
    this.status = el('div', 'dk-panel dk-status');
    this.toast = el('div', 'dk-toast');
    deps.root.append(this.panel, this.status, this.toast);
    addEventListener('keydown', this.onKey);
    this.render();
  }

  dispose(): void {
    removeEventListener('keydown', this.onKey);
    clearTimeout(this.toastTimer);
    this.panel.remove();
    this.status.remove();
    this.toast.remove();
  }

  setPhase(phase: UiPhase, turn: number): void {
    this.phase = phase;
    this.turn = turn;
    this.render();
  }

  /** 显示一条提示（非法操作等），并让面板抖一下 */
  notice(notice: Notice): void {
    const t = this.toast;
    t.textContent = notice.text;
    t.className = `dk-toast ${notice.kind === 'info' ? 'info' : ''}`;
    // 提示浮在面板上方
    const anchor = this.panel.classList.contains('is-hidden') ? this.status : this.panel;
    t.style.bottom = `${anchor.offsetHeight + 30}px`;
    t.classList.add('show');
    // 界面提示按真实时间消失（不随战斗倍速变化）
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), UI_CONFIG.toastSeconds * 1000);
    if (notice.kind === 'error') {
      this.panel.classList.remove('dk-shake');
      void this.panel.offsetWidth;
      this.panel.classList.add('dk-shake');
    }
  }

  // ------------------------------------------------------------------
  // 键盘
  // ------------------------------------------------------------------

  private readonly onKey = (e: KeyboardEvent): void => {
    const { session } = this.deps;
    if (session.mode === 'idle' || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') session.back();
    else if (session.mode !== 'menu') return;
    else if (key === 'a') session.chooseAttack();
    else if (key === 'w' && session.hasSkills) session.openSkills();
    else if (key === 'd') session.chooseDefend();
  };

  // ------------------------------------------------------------------
  // 绘制
  // ------------------------------------------------------------------

  /** 按会话当前状态重画 */
  render(): void {
    const { session } = this.deps;
    const unit = session.unit;
    const commanding = session.mode !== 'idle' && unit !== null;
    this.panel.classList.toggle('is-hidden', !commanding);
    this.status.style.display = commanding || this.phase === 'ended' ? 'none' : '';
    this.status.textContent =
      this.turn === 0
        ? '战斗开始'
        : this.phase === 'execution'
          ? `第 ${this.turn} 回合 · 出手阶段`
          : `第 ${this.turn} 回合 · 准备中`;
    if (!commanding) {
      this.panel.replaceChildren();
      return;
    }

    const parts: HTMLElement[] = [this.renderUnit(unit)];
    if (session.mode === 'target') parts.push(this.renderTarget(unit));
    else {
      parts.push(this.renderActions());
      if (session.mode === 'skills') parts.push(this.renderSkills());
    }
    parts.push(this.renderFooter());
    this.panel.replaceChildren(...parts);
  }

  private renderUnit(unit: Unit): HTMLElement {
    const { session } = this.deps;
    const wrap = el('div');
    const head = el('div', 'dk-unit');
    const { index, total } = session.progress;
    head.append(
      el('span', 'dk-unit-name', unit.name),
      // 宝宝只分物理型 / 法术型
      el('span', 'dk-unit-class', unit.kind === 'pet' ? `${unit.classId === 'magic' ? '法术型' : '物理型'}宝宝` : CLASS_LABEL[unit.classId]),
      el('span', 'dk-unit-step', `指令 ${index} / ${total}`),
    );
    wrap.append(head, gauge('hp', '气血', unit.hp, unit.stats.maxHp), gauge('mp', '魔法', unit.mp, unit.stats.maxMp));
    if (session.sealed && session.hasSkills) wrap.append(el('div', 'dk-sealed', '被封印：不能使用技能，仍可攻击或防御'));
    // 被动技能：只是说明，不能点击
    for (const id of unit.passiveIds) {
      const passive = PASSIVES[id];
      if (passive) wrap.append(el('div', 'dk-passive', `被动 · ${passive.name}：${passive.description}`));
    }
    return wrap;
  }

  private renderActions(): HTMLElement {
    const { session } = this.deps;
    const row = el('div', 'dk-actions');
    row.append(button('攻击', 'A', () => session.chooseAttack()));
    // 没有主动技能的单位不显示“技能”
    if (session.hasSkills) {
      row.append(
        button('技能', 'W', () => (session.mode === 'skills' ? session.back() : session.openSkills()), {
          on: session.mode === 'skills',
          disabled: session.sealed,
        }),
      );
    }
    row.append(button('防御', 'D', () => session.chooseDefend()));
    return row;
  }

  private renderSkills(): HTMLElement {
    const { session } = this.deps;
    const list = el('div', 'dk-skills');
    const rows = session.skillRows;
    if (rows.length === 0) {
      list.append(el('div', 'dk-empty', '该单位没有可用的技能'));
      return list;
    }
    for (const row of rows) {
      const b = el('button', `dk-btn dk-skill${row.enabled ? '' : ' is-disabled'}`);
      b.type = 'button';
      b.setAttribute('aria-disabled', String(!row.enabled));
      const head = el('div', 'dk-skill-head');
      head.append(el('span', 'dk-skill-name', row.skill.name));
      if (row.disabledReason) head.append(el('span', 'dk-skill-tag', disabledLabel(row.disabledReason)));
      head.append(el('span', 'dk-skill-cost', `魔法 ${row.skill.mpCost}`));
      b.append(head, el('div', 'dk-skill-desc', row.skill.description));
      // 置灰的技能仍可点击：点了会提示不能用的原因
      b.onclick = () => session.chooseSkill(row.skill.id);
      list.append(b);
    }
    return list;
  }

  private renderTarget(unit: Unit): HTMLElement {
    const { session, unitName } = this.deps;
    const skill = session.targetingSkill!;
    const box = el('div', 'dk-target');
    const cost = skill.mpCost > 0 ? ` · 魔法 ${skill.mpCost}` : '';
    box.append(
      el('div', 'dk-target-skill', `${skill.classId === 'common' ? '攻击' : skill.name}${cost}`),
      el('div', 'dk-target-desc', skill.description),
    );
    const friendly = skill.targetSide === 'ally';
    const preview = el('div', `dk-target-preview${friendly ? ' friendly' : ''}`);
    const hit = session.preview;
    if (hit.length > 0) {
      const count = el('b', '', `${hit.length}`);
      preview.append('将命中 ', count, ` 个目标：${hit.map(unitName).join('、')}`);
    } else {
      const who =
        skill.targetState === 'dead' ? '倒地的队友' : friendly ? '我方单位' : unit.side === 'ally' ? '敌方单位' : '目标';
      const max = skill.targetCount > 1 ? `（最多命中 ${skill.targetCount} 个）` : '';
      preview.textContent = `请点选${who}${max}，可选 ${session.candidates.length} 个`;
    }
    box.append(preview);
    return box;
  }

  private renderFooter(): HTMLElement {
    const { session } = this.deps;
    const row = el('div', 'dk-sub');
    const hint =
      session.mode === 'target'
        ? '悬停预览 · 点击确认 · 右键 / Esc 返回'
        : session.mode === 'skills'
          ? '选择一个技能'
          : '选择指令';
    row.append(el('span', 'dk-hint', hint));
    if (session.canGoBack) {
      row.append(button(session.mode === 'menu' ? '上一个' : '返回', 'Esc', () => session.back()));
    }
    return row;
  }
}

function gauge(kind: 'hp' | 'mp', label: string, value: number, max: number): HTMLElement {
  const wrap = el('div', `dk-gauge ${kind}`);
  const fill = el('i');
  fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%`;
  wrap.append(fill, el('span', '', `${label} ${value} / ${max}`));
  return wrap;
}

function button(
  text: string,
  key: string,
  onClick: () => void,
  flags: { on?: boolean; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = el('button', `dk-btn${flags.on ? ' is-on' : ''}${flags.disabled ? ' is-disabled' : ''}`, text);
  b.type = 'button';
  if (flags.disabled) b.setAttribute('aria-disabled', 'true');
  b.append(el('span', 'dk-key', key));
  b.onclick = onClick;
  return b;
}

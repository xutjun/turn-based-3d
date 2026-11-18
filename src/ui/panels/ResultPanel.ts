// 结算界面：胜负、回合数与统计，提供“再战一次”。
// 步骤 19：从探索进入的战斗结束时改用“战后提示”（show 的 options.brief）：胜负、几项简单统计和“继续”按钮，
// 点“继续”后由页面播放战后过场、回到探索。

import type { BattleSummary } from '../stats/BattleStats';
import { el } from '../theme';

/** 结算界面的显示方式 */
export interface ResultOptions {
  /** 简要模式（战后提示）：只显示几项统计，不显示每个单位的表格 */
  brief?: boolean;
  /** 按钮文字与点击（不传 = “再战一次”） */
  action?: { label: string; onClick: () => void };
}

export class ResultPanel {
  private veil: HTMLDivElement | null = null;
  private actionFn: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onRematch: () => void,
  ) {}

  dispose(): void {
    this.hide();
  }

  get visible(): boolean {
    return this.veil !== null;
  }

  hide(): void {
    this.veil?.remove();
    this.veil = null;
    this.actionFn = null;
  }

  /** 按下按钮（点击、键盘回车 / 空格）；没显示时什么都不做，返回 false */
  activate(): boolean {
    const fn = this.actionFn;
    if (!this.veil || !fn) return false;
    fn();
    return true;
  }

  show(summary: BattleSummary, options: ResultOptions = {}): void {
    this.hide();
    const win = summary.winner === 'ally';
    const veil = el('div', 'dk-result-veil');
    const panel = el('div', `dk-panel dk-result ${win ? 'win' : 'lose'}`);

    const facts = el('div', 'dk-result-facts');
    const fact = (value: string | number, label: string): void => {
      const f = el('div', 'dk-fact');
      f.append(el('b', '', String(value)), el('span', '', label));
      facts.append(f);
    };
    fact(summary.turns, '回合数');
    if (options.brief) {
      fact(summary.allyDamage, '我方总伤害');
      fact(summary.allyHealing, '治疗量');
      fact(summary.enemyDamage, '承受伤害');
      fact(`${summary.enemies.length - summary.enemySurvivors} / ${summary.enemies.length}`, '击败敌人');
      fact(`${summary.allySurvivors} / ${summary.allies.length}`, '我方存活');
    } else {
      fact(summary.actions, '出手次数');
      fact(summary.allyDamage, '我方总伤害');
      fact(summary.enemyDamage, '承受总伤害');
      fact(`${summary.allySurvivors} / ${summary.allies.length}`, '我方存活');
      fact(`${summary.enemies.length - summary.enemySurvivors} / ${summary.enemies.length}`, '击败敌人');
    }

    const actions = el('div', 'dk-result-actions');
    const action = options.action ?? { label: '再战一次', onClick: () => this.onRematch() };
    const button = el('button', 'dk-btn', action.label);
    button.type = 'button';
    button.onclick = () => void this.activate();
    actions.append(button);

    panel.append(el('div', 'dk-result-head', win ? '胜利' : '战败'), el('div', 'dk-result-sub', win ? '敌人已全部倒下' : '我方全员倒地'), facts);
    if (!options.brief) panel.append(this.table(summary));
    panel.append(actions);
    veil.append(panel);
    this.root.append(veil);
    this.veil = veil;
    this.actionFn = action.onClick;
  }

  /** 每个我方单位的统计表 */
  private table(summary: BattleSummary): HTMLDivElement {
    const tableWrap = el('div', 'dk-result-table');
    const table = el('table');
    const head = el('tr');
    for (const h of ['单位', '造成伤害', '承受伤害', '治疗', '击败', '暴击', '状态']) head.append(el('th', '', h));
    table.append(head);
    for (const u of summary.allies) {
      const row = el('tr', `${u.alive ? '' : 'is-dead'}${u.id === summary.mvp ? ' is-mvp' : ''}`);
      const name = u.id === summary.mvp ? `${u.name} ★` : u.name;
      for (const cell of [name, u.damageDealt, u.damageTaken, u.healing, u.kills, u.crits, u.alive ? '存活' : '倒地']) {
        row.append(el('td', '', String(cell)));
      }
      table.append(row);
    }
    tableWrap.append(table);
    return tableWrap;
  }
}

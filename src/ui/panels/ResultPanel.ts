// 结算界面：胜负、回合数与统计，提供“再战一次”。

import type { BattleSummary } from '../stats/BattleStats';
import { el } from '../theme';

export class ResultPanel {
  private veil: HTMLDivElement | null = null;

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
  }

  show(summary: BattleSummary): void {
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
    fact(summary.actions, '出手次数');
    fact(summary.allyDamage, '我方总伤害');
    fact(summary.enemyDamage, '承受总伤害');
    fact(`${summary.allySurvivors} / ${summary.allies.length}`, '我方存活');
    fact(`${summary.enemies.length - summary.enemySurvivors} / ${summary.enemies.length}`, '击败敌人');

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

    const actions = el('div', 'dk-result-actions');
    const again = el('button', 'dk-btn', '再战一次');
    again.type = 'button';
    again.onclick = () => this.onRematch();
    actions.append(again);

    panel.append(
      el('div', 'dk-result-head', win ? '胜利' : '战败'),
      el('div', 'dk-result-sub', win ? '敌人已全部倒下' : '我方全员倒地'),
      facts,
      tableWrap,
      actions,
    );
    veil.append(panel);
    this.root.append(veil);
    this.veil = veil;
  }
}

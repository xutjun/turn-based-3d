// 结算界面：胜负、回合数与统计，提供“再战一次”。
// 步骤 19：从探索进入的战斗结束时改用简要模式（show 的 options.brief）：自定义标题、几项简单统计和自定义按钮
// （胜利：“重新开始” + 禁用的“前往下一关”；失败：“再来一次”），点按钮后由页面播放战后过场、回到探索。

import type { BattleSummary } from '../stats/BattleStats';
import { el } from '../theme';

/** 结算画面上的一个按钮 */
export interface ResultAction {
  label: string;
  /** 不传 = 禁用（灰色、不可点击，为以后的功能预留） */
  onClick?: () => void;
  /** 鼠标悬停提示 */
  hint?: string;
}

/** 结算界面的显示方式 */
export interface ResultOptions {
  /** 简要模式：只显示几项统计，不显示每个单位的表格 */
  brief?: boolean;
  /** 标题（不传 = “胜利” / “战败”，下面再加一行说明） */
  title?: string;
  /** 按钮（不传 = 一个“再战一次”）。回车 / 空格 = 第一个可用的按钮 */
  actions?: ResultAction[];
}

/**
 * 从探索进入的战斗的结算画面（步骤 19 / v0.6.1）：
 * 胜利 = “恭喜你，击败了{Boss}！” + “重新开始” + 禁用的“前往下一关”（敬请期待，以后扩展关卡时接上）；
 * 失败 = “你被击败了” + “再来一次”。回车 / 空格对应第一个按钮。
 */
export function postBattleOptions(winner: 'ally' | 'enemy' | null, bossName: string, on: { restart: () => void; retry: () => void }): ResultOptions {
  if (winner === 'ally') {
    return {
      brief: true,
      title: `恭喜你，击败了${bossName}！`,
      actions: [
        { label: '重新开始', onClick: on.restart },
        { label: '前往下一关', hint: '敬请期待' }, // 预留：以后有多个关卡时在这里接上
      ],
    };
  }
  return { brief: true, title: '你被击败了', actions: [{ label: '再来一次', onClick: on.retry }] };
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
    const list: ResultAction[] = options.actions ?? [{ label: '再战一次', onClick: () => this.onRematch() }];
    for (const a of list) {
      const button = el('button', a.onClick ? 'dk-btn' : 'dk-btn is-disabled', a.label);
      button.type = 'button';
      if (a.hint) button.title = a.hint;
      if (a.onClick) {
        const fn = a.onClick;
        button.onclick = () => {
          if (this.veil) fn();
        };
      } else {
        // 禁用：灰色、不可点击；不用 disabled 属性，否则浏览器不显示悬停提示
        button.setAttribute('aria-disabled', 'true');
        button.tabIndex = -1;
        button.style.opacity = '0.45';
        button.style.filter = 'grayscale(1)';
        button.style.cursor = 'not-allowed';
        button.onclick = (e) => e.preventDefault();
      }
      actions.append(button);
    }

    if (options.title) panel.append(el('div', 'dk-result-head', options.title));
    else panel.append(el('div', 'dk-result-head', win ? '胜利' : '战败'), el('div', 'dk-result-sub', win ? '敌人已全部倒下' : '我方全员倒地'));
    panel.append(facts);
    if (!options.brief) panel.append(this.table(summary));
    panel.append(actions);
    veil.append(panel);
    this.root.append(veil);
    this.veil = veil;
    this.actionFn = list.find((a) => a.onClick)?.onClick ?? null;
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

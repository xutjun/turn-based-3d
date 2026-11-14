// 战斗日志面板（右上角）：记录每一次出手和结算。点标题可以收起 / 展开。

import { UI_CONFIG } from '../../data/uiConfig';
import type { LogLine } from '../log/battleLog';
import { el } from '../theme';

export class LogPanel {
  private readonly panel: HTMLDivElement;
  private readonly body: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.panel = el('div', 'dk-panel dk-log');
    const title = el('div', 'dk-title', '战斗日志');
    title.title = '点击收起 / 展开';
    title.onclick = () => this.panel.classList.toggle('is-collapsed');
    this.body = el('div', 'dk-log-body');
    this.panel.append(title, this.body);
    root.append(this.panel);
  }

  dispose(): void {
    this.panel.remove();
  }

  clear(): void {
    this.body.replaceChildren();
  }

  /** 行数（自检用） */
  get lineCount(): number {
    return this.body.childElementCount;
  }

  append(lines: readonly LogLine[]): void {
    const body = this.body;
    // 玩家往上翻看旧记录时不强行拉回底部
    const stick = body.scrollHeight - body.scrollTop - body.clientHeight < 24;
    for (const line of lines) {
      body.append(el('div', `dk-log-line ${line.tone}${line.detail ? ' detail' : ''}`, line.text));
    }
    while (body.childElementCount > UI_CONFIG.logMaxLines) body.firstElementChild?.remove();
    if (stick) body.scrollTop = body.scrollHeight;
  }
}

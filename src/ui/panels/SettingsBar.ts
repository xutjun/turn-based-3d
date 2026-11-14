// 设置条（右上角，速度按钮下方）：宝宝指令 自动 / 手动。

import { el } from '../theme';

export interface SettingsBarDeps {
  root: HTMLElement;
  petAuto: boolean;
  /** 切换宝宝自动 / 手动；返回是否已立即生效（执行阶段切换要到下回合才生效） */
  onPetAuto(on: boolean): boolean;
}

export class SettingsBar {
  private readonly panel: HTMLDivElement;
  private readonly note: HTMLDivElement;
  private petAuto: boolean;

  constructor(private readonly deps: SettingsBarDeps) {
    this.petAuto = deps.petAuto;
    this.panel = el('div', 'dk-panel dk-settings');
    this.note = el('div', 'dk-settings-note');
    deps.root.append(this.panel);
    this.render();
  }

  dispose(): void {
    this.panel.remove();
  }

  /** 新回合的指令阶段开始：之前“下回合生效”的提示可以去掉了 */
  clearNote(): void {
    this.note.textContent = '';
  }

  private render(): void {
    const option = (text: string, value: boolean, title: string): HTMLButtonElement => {
      const b = el('button', `dk-btn${this.petAuto === value ? ' is-on' : ''}`, text);
      b.type = 'button';
      b.title = title;
      b.onclick = () => {
        if (this.petAuto === value) return;
        this.petAuto = value;
        const applied = this.deps.onPetAuto(value);
        this.note.textContent = applied ? '' : '下回合生效';
        this.render();
      };
      return b;
    };
    this.panel.replaceChildren(
      el('span', '', '宝宝指令'),
      option('手动', false, '宝宝由你逐个下指令'),
      option('自动', true, '宝宝自动出手，不需要下指令'),
      this.note,
    );
  }
}

// 标题界面（步骤 12）：游戏名、“开始游戏”“设置”两个按钮。
// 背景就是战场本身（单位在原位待机），盖一层暗角和压暗，不新增任何素材。

import { TITLE_CONFIG } from '../../data/uiConfig';
import { el } from '../theme';

export interface TitleScreenDeps {
  root: HTMLElement;
  onStart(): void;
  onSettings(): void;
}

export class TitleScreen {
  private readonly screen: HTMLDivElement;

  constructor(deps: TitleScreenDeps) {
    this.screen = el('div', 'dk-title-screen is-hidden');
    const menu = el('div', 'dk-title-menu');
    const button = (text: string, onClick: () => void): HTMLButtonElement => {
      const b = el('button', 'dk-btn', text);
      b.type = 'button';
      b.onclick = onClick;
      return b;
    };
    const start = button('开始游戏', () => deps.onStart());
    start.dataset['action'] = 'start';
    const settings = button('设置', () => deps.onSettings());
    settings.dataset['action'] = 'settings';
    menu.append(start, settings);
    this.screen.append(
      el('div', 'dk-game-name', TITLE_CONFIG.name),
      el('div', 'dk-game-sub', TITLE_CONFIG.subtitle),
      el('div', 'dk-title-rule'),
      menu,
      el('div', 'dk-title-hint', 'Esc 打开设置'),
    );
    deps.root.append(this.screen);
  }

  get visible(): boolean {
    return !this.screen.classList.contains('is-hidden');
  }

  show(): void {
    this.screen.classList.remove('is-hidden');
  }

  hide(): void {
    this.screen.classList.add('is-hidden');
  }

  dispose(): void {
    this.screen.remove();
  }
}

// 设置菜单（步骤 12）：右上角齿轮按钮 / Esc 打开。
// 设置项：分辨率、画质、主音量 / 音效 / 环境音、静音；战斗中另有“重新开始”“退出游戏”（都要二次确认）。
// 面板只负责显示和把操作写进 SettingsStore；真正生效（改渲染尺寸、改音量）由订阅 store 的页面完成。
// 打开时通过 onOpenChange 通知页面暂停战斗；面板盖住整个游戏区域，点击不会穿透到战场。

import type { SoundChannel } from '../../assets/audio/SoundEngine';
import { RESOLUTION_IDS, resolutionLabel, type ResolutionId } from '../layout/viewportMath';
import { el } from '../theme';
import type { GameSettings, SettingsStore } from './settingsStore';

/** 菜单从哪里打开：战斗中有“重新开始”“退出游戏”，标题界面上没有 */
export type MenuContext = 'battle' | 'title';

export interface SettingsMenuDeps {
  /** 菜单层（在游戏区域里，盖在所有界面之上） */
  root: HTMLElement;
  store: SettingsStore;
  /** 浏览器能不能合成声音（不能时音量项置灰） */
  soundSupported: boolean;
  /** 拖动音量滑块时播放一声提示音 */
  preview(channel: SoundChannel): void;
  /** 菜单打开 / 关闭（页面据此暂停 / 继续战斗） */
  onOpenChange(open: boolean): void;
  /** 确认“重新开始”后调用 */
  onRestart(): void;
  /** 确认“退出游戏”后调用 */
  onExit(): void;
}

const VOLUME_ROWS: readonly { key: 'master' | 'sfx' | 'ambient'; label: string; channel: SoundChannel }[] = [
  { key: 'master', label: '主音量', channel: 'master' },
  { key: 'sfx', label: '音效', channel: 'sfx' },
  { key: 'ambient', label: '环境音', channel: 'ambient' },
];

export class SettingsMenu {
  private veil: HTMLDivElement | null = null;
  private confirmVeil: HTMLDivElement | null = null;
  private context: MenuContext = 'battle';
  private readonly unsubscribe: () => void;

  constructor(private readonly deps: SettingsMenuDeps) {
    // 设置在别处被改（例如按 M 静音）时，打开着的面板跟着刷新
    this.unsubscribe = deps.store.onChange((_s, key) => {
      if (this.veil && key !== 'master' && key !== 'sfx' && key !== 'ambient') this.render();
    });
  }

  get isOpen(): boolean {
    return this.veil !== null;
  }

  get confirming(): boolean {
    return this.confirmVeil !== null;
  }

  dispose(): void {
    this.unsubscribe();
    this.close(false);
  }

  open(context: MenuContext): void {
    if (this.veil) return;
    this.context = context;
    const veil = el('div', 'dk-menu-veil');
    // 点到面板外的暗处也算点在菜单上：不穿透到战场，也不关闭（避免误触）
    this.veil = veil;
    this.deps.root.append(veil);
    this.render();
    this.deps.onOpenChange(true);
  }

  /** 关闭菜单（同时关掉确认框） */
  close(notify = true): void {
    if (!this.veil) return;
    this.confirmVeil = null;
    this.veil.remove();
    this.veil = null;
    if (notify) this.deps.onOpenChange(false);
  }

  toggle(context: MenuContext): void {
    if (this.veil) this.close();
    else this.open(context);
  }

  /**
   * Esc：有确认框时取消确认框，否则关闭菜单。返回是否处理了这次按键（菜单没打开时不处理）。
   */
  escape(): boolean {
    if (this.confirmVeil) {
      this.confirmVeil.remove();
      this.confirmVeil = null;
      return true;
    }
    if (this.veil) {
      this.close();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // 绘制
  // ------------------------------------------------------------------

  private render(): void {
    const veil = this.veil;
    if (!veil) return;
    const s = this.deps.store.value;
    const panel = el('div', 'dk-panel dk-menu');
    panel.append(el('div', 'dk-title', '设置'));
    if (this.context === 'battle') panel.append(el('div', 'dk-menu-paused', '战斗已暂停'));

    panel.append(this.resolutionRow(s), this.qualityRow(s), el('div', 'dk-sep'));
    for (const row of VOLUME_ROWS) panel.append(this.volumeRow(s, row));
    panel.append(this.muteRow(s));
    if (!this.deps.soundSupported) panel.append(el('div', 'dk-menu-note', '当前浏览器不支持合成音效'));

    if (this.context === 'battle') {
      const actions = el('div', 'dk-menu-actions');
      actions.append(
        this.button('重新开始', 'dk-btn is-danger', () =>
          this.confirm('确定放弃当前战斗并重新开始吗？', () => {
            this.close();
            this.deps.onRestart();
          }),
        ),
        this.button('退出游戏', 'dk-btn is-danger', () =>
          this.confirm('确定退出当前战斗，回到标题界面吗？', () => {
            this.close();
            this.deps.onExit();
          }),
        ),
      );
      panel.append(el('div', 'dk-sep'), actions);
    }
    const close = this.button(this.context === 'battle' ? '返回游戏' : '关闭', 'dk-btn dk-menu-close', () => this.close());
    close.append(el('span', 'dk-key', 'Esc'));
    panel.append(close);

    const confirm = this.confirmVeil;
    veil.replaceChildren(panel);
    if (confirm) veil.append(confirm);
  }

  private row(label: string, ...body: HTMLElement[]): HTMLDivElement {
    const row = el('div', 'dk-row');
    const b = el('div', 'dk-row-body');
    b.append(...body);
    row.append(el('span', 'dk-row-label', label), b);
    return row;
  }

  private button(text: string, className: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', className, text);
    b.type = 'button';
    b.onclick = onClick;
    return b;
  }

  private resolutionRow(s: Readonly<GameSettings>): HTMLDivElement {
    const select = el('select', 'dk-select');
    select.title = '渲染分辨率：固定分辨率时画面居中显示，窗口不够大时等比缩小';
    for (const id of RESOLUTION_IDS) {
      const option = el('option', '', resolutionLabel(id));
      option.value = id;
      option.selected = id === s.resolution;
      select.append(option);
    }
    select.onchange = () => this.deps.store.set('resolution', select.value as ResolutionId);
    return this.row('分辨率', select);
  }

  private qualityRow(s: Readonly<GameSettings>): HTMLDivElement {
    const option = (text: string, low: boolean, title: string): HTMLButtonElement => {
      const b = this.button(text, `dk-btn${s.lowQuality === low ? ' is-on' : ''}`, () => this.deps.store.set('lowQuality', low));
      b.title = title;
      return b;
    };
    return this.row(
      '画质',
      option('高', false, '完整的辉光、阴影和粒子'),
      option('低', true, '关闭辉光、降低阴影、减少粒子（卡顿时选这个）'),
    );
  }

  private volumeRow(s: Readonly<GameSettings>, row: (typeof VOLUME_ROWS)[number]): HTMLDivElement {
    const slider = el('input', 'dk-range');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = String(Math.round(s[row.key] * 100));
    slider.disabled = !this.deps.soundSupported;
    slider.dataset['channel'] = row.key;
    const value = el('span', 'dk-row-value', `${slider.value}%`);
    const paint = (): void => slider.style.setProperty('--fill', `${slider.value}%`);
    paint();
    // 拖动时实时生效，并播放一声提示音方便试听
    slider.oninput = () => {
      this.deps.store.set(row.key, Number(slider.value) / 100);
      value.textContent = `${slider.value}%`;
      paint();
      this.deps.preview(row.channel);
    };
    return this.row(row.label, slider, value);
  }

  private muteRow(s: Readonly<GameSettings>): HTMLDivElement {
    const option = (text: string, muted: boolean): HTMLButtonElement => {
      const b = this.button(text, `dk-btn${s.muted === muted ? ' is-on' : ''}`, () => this.deps.store.set('muted', muted));
      b.title = '静音（按键 M 切换）';
      b.disabled = !this.deps.soundSupported;
      return b;
    };
    return this.row('静音', option('关', false), option('开', true));
  }

  /** 二次确认框：确认后执行 onYes，取消（或按 Esc）只关闭确认框 */
  private confirm(text: string, onYes: () => void): void {
    if (!this.veil) return;
    const veil = el('div', 'dk-confirm-veil');
    const box = el('div', 'dk-panel dk-confirm');
    const actions = el('div', 'dk-confirm-actions');
    const cancel = (): void => {
      veil.remove();
      if (this.confirmVeil === veil) this.confirmVeil = null;
    };
    actions.append(
      this.button('确定', 'dk-btn is-danger', () => {
        cancel();
        onYes();
      }),
      this.button('取消', 'dk-btn', cancel),
    );
    box.append(el('div', 'dk-confirm-text', text), actions);
    veil.append(box);
    this.confirmVeil = veil;
    this.veil.append(veil);
  }
}

// 探索界面（步骤 21，SPEC §15.3、DESIGN §12.3）：左下角血蓝圆球（当前队长）+ 圆球右侧一排按钮
// （角色、道具、技能、宝宝、队友、设置）+ 面板框架（同一时间只开一个）。
//
// - 只在探索和对话中显示；入场过场、战斗、结算、战后过场、标题界面中整个隐藏（并关掉打开着的面板）。
// - 对话中只有“设置”可用，其余按钮置灰（DESIGN §9.17 M4）。
// - 技能按钮始终禁用，悬停提示“敬请期待”；道具、宝宝、队友本步打开空面板（“下一步实现”）。
// - “设置”打开原来的设置菜单（内容不变），探索中右上角的齿轮由页面隐藏。
// - Esc 优先级：设置菜单打开 → 交给菜单；对话中 → “再等等”；有面板 → 关闭面板；否则打开设置（resolveExploreEscape）。
// - 整个界面层带 .dk-explore-hud，层里的元素在 PANEL_SELECTOR 里：点击、悬停不穿透到地面和 Boss。

import type { UnitTemplate } from '../../core/types';
import { Orb } from '../hud/Orb';
import { el } from '../theme';
import { Tooltip } from '../widgets/Tooltip';
import { hudIconSvg, type HudButtonId } from './hudIcons';
import { PanelHost, PlaceholderPanel, type PanelId } from './PanelHost';
import { CharacterPanel, type PreviewHost } from './panels/CharacterPanel';

/** 页面处在哪个界面（与 PlayerBattleApp 的 AppScreen 相同） */
export type HudScreen = 'title' | 'explore' | 'dialog' | 'intro' | 'battle' | 'result' | 'outro';

/** 探索界面显示在哪些界面上 */
export function exploreHudVisibleOn(screen: HudScreen): boolean {
  return screen === 'explore' || screen === 'dialog';
}

/**
 * Esc 在探索 / 对话中做什么（纯函数，可测）：
 * 'menu' = 交给设置菜单（关闭菜单或取消确认框）；'dialog' = “再等等”；'panel' = 关闭面板；'openMenu' = 打开设置。
 * 其他界面返回 null（交给原来的处理）。
 */
export function resolveExploreEscape(s: { screen: HudScreen; menuOpen: boolean; panelOpen: boolean }): 'menu' | 'dialog' | 'panel' | 'openMenu' | null {
  if (s.menuOpen) return 'menu';
  if (s.screen === 'dialog') return 'dialog';
  if (s.screen !== 'explore') return null;
  return s.panelOpen ? 'panel' : 'openMenu';
}

interface ButtonDef {
  id: HudButtonId;
  label: string;
  /** 打开的面板；没有则是特殊按钮（技能、设置） */
  panel?: PanelId;
}

export const HUD_BUTTONS: readonly ButtonDef[] = [
  { id: 'character', label: '角色', panel: 'character' },
  { id: 'inventory', label: '道具', panel: 'inventory' },
  { id: 'skills', label: '技能' },
  { id: 'pet', label: '宝宝', panel: 'pet' },
  { id: 'party', label: '队友', panel: 'party' },
  { id: 'settings', label: '设置' },
];

export interface ExploreHudDeps {
  /** 舞台（界面层挂在这里；提示框按它换算坐标） */
  stage: HTMLElement;
  /** 界面层插在哪个元素前面（菜单层之下） */
  before?: HTMLElement | null;
  /** 当前队长 */
  leader(): UnitTemplate;
  /** 3D 预览（测试里可为 null） */
  preview: PreviewHost | null;
  /** 点“设置” */
  onSettings(): void;
  /** 面板打开 / 关闭 */
  onPanelChange?(open: PanelId | null): void;
  now?(): number;
}

export class ExploreHud {
  readonly root: HTMLDivElement;
  readonly orb: Orb;
  readonly tooltip: Tooltip;
  readonly panels: PanelHost;
  readonly character: CharacterPanel;
  private readonly bar: HTMLDivElement;
  private readonly buttons = new Map<HudButtonId, HTMLButtonElement>();
  private screen: HudScreen = 'title';

  constructor(private readonly deps: ExploreHudDeps) {
    this.root = el('div', 'dk-explore-hud');
    this.root.style.display = 'none';
    deps.stage.insertBefore(this.root, deps.before ?? null);
    this.tooltip = new Tooltip({ root: this.root, stage: deps.stage });
    this.orb = new Orb(this.root, this.tooltip);
    this.bar = el('div', 'dk-hud-bar');
    this.root.append(this.bar);
    const panelLayer = el('div', 'dk-hud-panels');
    this.root.append(panelLayer);
    this.panels = new PanelHost(panelLayer, (open) => {
      this.renderButtons();
      deps.onPanelChange?.(open);
    });
    const close = (): void => void this.panels.close();
    this.character = new CharacterPanel({ leader: () => deps.leader(), preview: deps.preview, onClose: close, now: deps.now });
    this.panels.register(this.character);
    this.panels.register(new PlaceholderPanel('inventory', '道具', close));
    this.panels.register(new PlaceholderPanel('pet', '宝宝', close));
    this.panels.register(new PlaceholderPanel('party', '队友', close));

    for (const def of HUD_BUTTONS) {
      const b = el('button', `dk-hud-btn is-${def.id}`);
      b.type = 'button';
      b.innerHTML = hudIconSvg(def.id);
      b.setAttribute('aria-label', def.label);
      b.onclick = () => this.press(def.id);
      this.tooltip.attach(b, () => this.tipOf(def));
      this.buttons.set(def.id, b);
      this.bar.append(b);
    }
    this.renderButtons();
  }

  get visible(): boolean {
    return this.root.style.display !== 'none';
  }

  /** 当前打开的面板 */
  get openPanel(): PanelId | null {
    return this.panels.openId;
  }

  /** 页面切换界面时调用：决定显示 / 隐藏、对话模式；离开探索时关闭面板 */
  syncScreen(screen: HudScreen): void {
    this.screen = screen;
    const show = exploreHudVisibleOn(screen);
    if (screen !== 'explore') this.panels.close();
    this.root.style.display = show ? '' : 'none';
    if (!show) this.tooltip.hide();
    this.renderButtons();
    if (show) this.refresh();
  }

  /** 按钮能不能点（技能始终不能；对话中只有设置能点） */
  isEnabled(id: HudButtonId): boolean {
    if (id === 'skills') return false;
    if (this.screen === 'dialog') return id === 'settings';
    return this.screen === 'explore';
  }

  /** 点按钮（与鼠标点击相同；不能点时什么都不做） */
  press(id: HudButtonId): void {
    if (!this.isEnabled(id)) return;
    if (id === 'settings') {
      this.panels.close();
      this.deps.onSettings();
      return;
    }
    const panel = HUD_BUTTONS.find((b) => b.id === id)?.panel;
    if (panel) this.panels.toggle(panel);
  }

  /** 关闭打开着的面板；返回是否关了 */
  closePanel(): boolean {
    return this.panels.close();
  }

  /** 队长或数值变化时刷新圆球和打开着的面板 */
  refresh(): void {
    const s = this.deps.leader().stats;
    // 探索中每场战斗都是全新状态、不保留伤势：气血魔法都是满的（DESIGN §12.1）
    this.orb.set({ hp: s.maxHp, maxHp: s.maxHp, mp: s.maxMp, maxMp: s.maxMp });
    if (this.panels.openId === 'character') this.character.render();
    this.tooltip.refresh();
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.panels.update(dt);
  }

  dispose(): void {
    this.panels.close();
    this.tooltip.dispose();
    this.root.remove();
  }

  private tipOf(def: ButtonDef): string {
    if (def.id === 'skills') return '技能：敬请期待';
    if (this.screen === 'dialog' && def.id !== 'settings') return `${def.label}（对话中不可用）`;
    return def.id === 'settings' ? '设置（Esc）' : def.label;
  }

  private renderButtons(): void {
    for (const def of HUD_BUTTONS) {
      const b = this.buttons.get(def.id);
      if (!b) continue;
      const enabled = this.isEnabled(def.id);
      b.classList.toggle('is-disabled', !enabled);
      // 不用 disabled 属性：否则浏览器不显示悬停提示（与结算画面的“前往下一关”相同，v0.6.1）
      b.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      b.classList.toggle('is-active', def.panel !== undefined && def.panel === this.panels.openId);
    }
  }
}

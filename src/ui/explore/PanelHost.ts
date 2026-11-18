// 探索界面的面板框架（步骤 21，DESIGN §12.3）：统一的暗黑石质面板（标题栏、双层金属包边、关闭叉），
// 同一时间只开一个；再点同一个按钮 / Esc / 关闭叉关闭；打开另一个时先关掉当前的。
// 面板带 .dk-panel，探索的鼠标输入（ExplorePointer）遇到面板上的点击、悬停一律不处理：不穿透到地面。

import { el } from '../theme';

export type PanelId = 'character' | 'inventory' | 'pet' | 'party';

/** 一个面板：open / close 时由框架挂上 / 摘下 root */
export interface GamePanel {
  readonly id: PanelId;
  readonly root: HTMLElement;
  /** 挂上之后调用（刷新内容、打开 3D 预览） */
  onOpen?(): void;
  /** 摘下之前调用（关闭 3D 预览） */
  onClose?(): void;
  /** 每帧（场景时间，暂停时不调用） */
  update?(dt: number): void;
}

/** 面板外框：标题栏 + 关闭叉 + 内容区 */
export function createPanelFrame(title: string, className: string, onClose: () => void): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = el('div', `dk-panel dk-game-panel ${className}`);
  // 石质底子单独一层：有 3D 预览的面板在这一层上挖一个“窗口”（CSS mask），露出下面画布上画的模型（cutPanelWindow）
  root.append(el('div', 'dk-game-panel-bg'));
  const head = el('div', 'dk-game-panel-head');
  head.append(el('div', 'dk-game-panel-title', title));
  const close = el('button', 'dk-btn dk-game-panel-close', '×');
  close.type = 'button';
  close.title = '关闭（Esc）';
  close.onclick = () => onClose();
  head.append(close);
  const body = el('div', 'dk-game-panel-body');
  root.append(head, body);
  return { root, body };
}

/**
 * 在面板的石质底子上给 3D 预览挖窗口（步骤 21）：画布在所有界面元素下面，面板底子不透明会挡住画在画布上的模型。
 * 窗口位置按视口元素相对面板的位置算（排版像素，与舞台缩放无关），写成 CSS 变量给 mask 用。面板挂上之后调用。
 */
export function cutPanelWindow(root: HTMLElement, viewport: HTMLElement): void {
  const r = root.getBoundingClientRect();
  const v = viewport.getBoundingClientRect();
  const scale = r.width > 0 && root.offsetWidth > 0 ? r.width / root.offsetWidth : 1;
  const px = (n: number): string => `${Number.isFinite(n) ? Math.round(n) : 0}px`;
  root.classList.add('has-window');
  root.style.setProperty?.('--win-x', px((v.left - r.left) / scale - (root.clientLeft || 0)));
  root.style.setProperty?.('--win-y', px((v.top - r.top) / scale - (root.clientTop || 0)));
  root.style.setProperty?.('--win-w', px(v.width / scale));
  root.style.setProperty?.('--win-h', px(v.height / scale));
}

/** 还没实现的面板（步骤 21：道具、宝宝、队友先打开一个空面板） */
export class PlaceholderPanel implements GamePanel {
  readonly root: HTMLDivElement;
  constructor(
    readonly id: PanelId,
    title: string,
    onClose: () => void,
  ) {
    const frame = createPanelFrame(title, `dk-panel-${id} is-placeholder`, onClose);
    frame.body.append(el('div', 'dk-game-panel-empty', '下一步实现'));
    this.root = frame.root;
  }
}

export class PanelHost {
  private readonly panels = new Map<PanelId, GamePanel>();
  private current: GamePanel | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: (open: PanelId | null) => void = () => undefined,
  ) {}

  register(panel: GamePanel): void {
    this.panels.set(panel.id, panel);
  }

  /** 当前打开的面板（没有为 null） */
  get openId(): PanelId | null {
    return this.current?.id ?? null;
  }

  open(id: PanelId): void {
    if (this.current?.id === id) return;
    const panel = this.panels.get(id);
    if (!panel) throw new Error(`没有登记面板 ${id}`);
    this.close();
    this.current = panel;
    this.root.append(panel.root);
    panel.onOpen?.();
    this.onChange(id);
  }

  /** 关闭当前面板；返回是否真的关了一个 */
  close(): boolean {
    const panel = this.current;
    if (!panel) return false;
    this.current = null;
    panel.onClose?.();
    panel.root.remove();
    this.onChange(null);
    return true;
  }

  /** 按钮：没开就打开，开着就关闭 */
  toggle(id: PanelId): void {
    if (this.current?.id === id) this.close();
    else this.open(id);
  }

  update(dt: number): void {
    this.current?.update?.(dt);
  }
}

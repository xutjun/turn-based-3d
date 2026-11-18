// 对话框（步骤 16，SPEC §14.2）：暗黑风格的石质面板 + 金属铭牌（说话人名字），衬线字体，文字逐字显示。
// 只负责显示和把点击 / 选项交给页面；对话进度在 explore/dialogueSession.ts（纯逻辑）。
//
// - 对话框下面是一层盖住整个游戏画面的透明层：点画面任意处 = 推进（先显示整句，再下一句），
//   点击不会穿透到战场（对话中禁止点击移动）；
// - 最后一句之后显示选项按钮（带热键提示），点按钮 = 选择；
// - 层级在设置菜单之下：对话中打开设置时菜单盖在对话框上面。

import type { DialogueSession } from '../../explore/dialogueSession';
import { el } from '../theme';

export interface DialogBoxDeps {
  /** 放对话层的容器（游戏舞台） */
  root: HTMLElement;
  /** 点击画面 / 对话框：推进 */
  onAdvance(): void;
  /** 点选项按钮 */
  onChoose(index: number): void;
}

export class DialogBox {
  private readonly layer: HTMLDivElement;
  private readonly box: HTMLDivElement;
  private readonly nameEl: HTMLDivElement;
  private readonly asideEl: HTMLSpanElement;
  private readonly textEl: HTMLSpanElement;
  private readonly moreEl: HTMLDivElement;
  private readonly choicesEl: HTMLDivElement;
  /** 上一次画出来的内容（没变就不改 DOM） */
  private shown = { line: -1, text: '', choices: false, more: false };
  private session: DialogueSession | null = null;

  constructor(private readonly deps: DialogBoxDeps) {
    this.layer = el('div', 'dk-dialog-layer is-hidden');
    this.box = el('div', 'dk-panel dk-dialog');
    this.nameEl = el('div', 'dk-dialog-name');
    const text = el('div', 'dk-dialog-text');
    this.asideEl = el('span', 'dk-dialog-aside');
    this.textEl = el('span', 'dk-dialog-body');
    text.append(this.asideEl, this.textEl);
    this.moreEl = el('div', 'dk-dialog-more is-hidden', '▼');
    this.choicesEl = el('div', 'dk-dialog-choices is-hidden');
    const hint = el('div', 'dk-dialog-hint', '点击 / 空格：继续　Esc：再等等');
    this.box.append(this.nameEl, hint, text, this.moreEl, this.choicesEl);
    this.layer.append(this.box);
    this.layer.addEventListener('click', this.onClick);
    // 鼠标在对话层上移动、按下都不传到战场（悬停 Boss 高亮、点击移动都不触发）
    for (const type of ['pointermove', 'pointerdown', 'contextmenu'] as const) this.layer.addEventListener(type, stop);
    deps.root.append(this.layer);
  }

  get visible(): boolean {
    return this.session !== null;
  }

  /** 打开：显示这个对话的当前进度 */
  open(session: DialogueSession): void {
    this.session = session;
    this.shown = { line: -1, text: '', choices: false, more: false };
    this.layer.classList.remove('is-hidden');
    this.renderChoices(session);
    this.render();
  }

  close(): void {
    this.session = null;
    this.layer.classList.add('is-hidden');
  }

  /** 按会话的当前状态刷新（每帧调用；内容没变就什么都不做） */
  render(): void {
    const s = this.session;
    if (!s) return;
    const line = s.line;
    if (this.shown.line !== s.lineIndex) {
      this.shown.line = s.lineIndex;
      this.nameEl.textContent = line.name;
      this.nameEl.classList.toggle('is-boss', line.speaker === 'boss');
      this.asideEl.textContent = line.aside ? `（${line.aside}）` : '';
      this.asideEl.style.display = line.aside ? '' : 'none';
    }
    const text = s.visibleText;
    if (text !== this.shown.text) {
      this.shown.text = text;
      this.textEl.textContent = text;
    }
    const more = s.lineComplete && !s.showingChoices;
    if (more !== this.shown.more) {
      this.shown.more = more;
      this.moreEl.classList.toggle('is-hidden', !more);
    }
    if (s.showingChoices !== this.shown.choices) {
      this.shown.choices = s.showingChoices;
      this.choicesEl.classList.toggle('is-hidden', !s.showingChoices);
      this.box.style.cursor = s.showingChoices ? 'default' : '';
      this.layer.style.cursor = s.showingChoices ? 'default' : '';
    }
  }

  dispose(): void {
    this.layer.removeEventListener('click', this.onClick);
    this.layer.remove();
    this.session = null;
  }

  private renderChoices(s: DialogueSession): void {
    this.choicesEl.replaceChildren();
    s.choices.forEach((c, i) => {
      const b = el('button', 'dk-btn dk-dialog-choice');
      b.type = 'button';
      b.append(document.createTextNode(c.label));
      if (c.hotkey) b.append(el('span', 'dk-key', c.hotkey));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.session?.showingChoices) this.deps.onChoose(i);
      });
      this.choicesEl.append(b);
    });
  }

  private readonly onClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (e.button !== 0 || !this.session) return;
    this.deps.onAdvance();
  };
}

function stop(e: Event): void {
  e.stopPropagation();
}

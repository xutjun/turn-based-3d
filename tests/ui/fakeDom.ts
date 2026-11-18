// 测试用的最小假 DOM（步骤 17）：只够 BattleHud 创建、更新、删除它的元素（Node 环境里没有 document）。
// 元素记录父子关系、className / classList、style，remove() 真的把自己从父元素里摘掉，
// 这样可以检查“战斗界面层里还剩哪些元素”。

export class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  className = '';
  textContent = '';
  title = '';
  id = '';
  type = '';
  onclick: (() => void) | null = null;
  offsetWidth = 40;
  clientWidth = 1280;
  clientHeight = 800;
  readonly style: Record<string, string> = Object.defineProperty({} as Record<string, string>, 'setProperty', {
    value(this: Record<string, string>, name: string, value: string) {
      this[name] = value;
    },
  });
  readonly attrs: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  value = '';
  min = '';
  max = '';
  step = '';
  disabled = false;
  selected = false;
  oninput: (() => void) | null = null;
  onchange: (() => void) | null = null;
  tabIndex = 0;
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  readonly classList = {
    add: (...c: string[]) => this.setClasses([...this.classes(), ...c]),
    remove: (...c: string[]) => this.setClasses(this.classes().filter((x) => !c.includes(x))),
    contains: (c: string) => this.classes().includes(c),
    toggle: (c: string, on?: boolean) => {
      const want = on ?? !this.classes().includes(c);
      if (want) this.classList.add(c);
      else this.classList.remove(c);
      return want;
    },
  };
  constructor(readonly tagName: string) {}
  private classes(): string[] {
    return this.className.split(/\s+/).filter(Boolean);
  }
  private setClasses(list: string[]): void {
    this.className = [...new Set(list)].join(' ');
  }
  append(...nodes: FakeElement[]): void {
    for (const n of nodes) this.appendChild(n);
  }
  appendChild(n: FakeElement): FakeElement {
    n.remove();
    n.parent = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n: FakeElement, ref: FakeElement | null): FakeElement {
    n.remove();
    n.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const c of [...this.children]) c.remove();
    this.append(...nodes);
  }
  remove(): void {
    if (!this.parent) return;
    const list = this.parent.children;
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
    this.parent = null;
  }
  innerHTML = '';
  /** 登记的事件监听（步骤 21：测试里可以手动触发） */
  readonly listeners: Record<string, ((e: unknown) => void)[]> = {};
  addEventListener(type: string, fn: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners[type];
    if (list) this.listeners[type] = list.filter((f) => f !== fn);
  }
  /** 触发一个事件（只调用登记在自己身上的监听，不冒泡） */
  dispatch(type: string, e: unknown = {}): void {
    for (const fn of [...(this.listeners[type] ?? [])]) fn(e);
  }
  /** 只支持本项目用到的选择器：逗号分隔的“.类名”和“.父类名 > *” */
  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const s = part.trim();
      const child = /^\.([\w-]+)\s*>\s*\*$/.exec(s);
      if (child) return this.parent?.classList.contains(child[1]!) ?? false;
      const cls = /^\.([\w-]+)$/.exec(s);
      return cls ? this.classList.contains(cls[1]!) : false;
    });
  }
  /** 自己和所有祖先（模拟 composedPath） */
  path(): FakeElement[] {
    const out: FakeElement[] = [];
    for (let n: FakeElement | null = this; n; n = n.parent) out.push(n);
    return out;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800 };
  }
  /** 子孙里所有元素（含自己） */
  all(): FakeElement[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
}

/** 安装假的 document 和全局事件函数，返回 body（界面挂载的容器） */
export function installFakeDom(): FakeElement {
  const g = globalThis as Record<string, unknown>;
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  g['document'] = {
    head,
    body,
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (text: string) => Object.assign(new FakeElement('#text'), { textContent: text }),
    getElementById: (id: string) => [...head.all(), ...body.all()].find((e) => e.id === id) ?? null,
  };
  g['addEventListener'] = () => undefined;
  g['removeEventListener'] = () => undefined;
  return body;
}

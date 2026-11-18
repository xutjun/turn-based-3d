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
  readonly style: Record<string, string> = {};
  readonly attrs: Record<string, string> = {};
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
  addEventListener(): void {}
  removeEventListener(): void {}
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

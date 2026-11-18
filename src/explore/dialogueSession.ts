// 对话进度（步骤 16，DESIGN §11.9）：当前第几句、逐字显示到第几个字、是否在显示选项。纯计算，不依赖 three.js 和 DOM。
//
// - update(dt)：逐字显示推进（场景时间：打开设置菜单暂停时不调用，台词也停住）；
// - advance()（点击 / 空格）：正在逐字显示 → 立即显示整句；整句已显示 → 下一句；最后一句之后 → 显示选项；显示选项时无效；
// - choose(i) / chooseHotkey(key)：只在显示选项时有效，返回选项的动作，对话随之结束。
// 另有对话数据的校验（validateDialogue）和台词解析（resolveLine：说话人 → 显示名、神态说明）。

import {
  DIALOGUE_ACTIONS,
  DIALOGUE_EMOTE_IDS,
  DIALOGUE_SPEAKERS,
  type DialogueAction,
  type DialogueChoice,
  type DialogueDef,
  type DialogueEmote,
  type DialogueLine,
  type DialogueSpeaker,
} from '../data/dialogues';

/** 一句台词解析后的显示内容 */
export interface ResolvedLine {
  speaker: DialogueSpeaker;
  /** 对话框上的说话人名字 */
  name: string;
  /** 神态说明（不带括号），没有为空串 */
  aside: string;
  /** 正文（逐字显示的部分） */
  text: string;
  /** 正文按“字”切开（按 Unicode 码点，不会把一个字劈成两半） */
  chars: readonly string[];
  emote: DialogueEmote;
}

/**
 * 解析一句台词：显示名优先用台词里写的 name，否则用说话人对应的单位名；
 * 正文开头若写了全角 / 半角括号的神态（“（狂笑）……”）且没有单独给 aside，也拆出来。
 */
export function resolveLine(line: DialogueLine, names: Readonly<Record<DialogueSpeaker, string>>): ResolvedLine {
  let text = line.text.trim();
  let aside = (line.aside ?? '').trim();
  const m = /^[（(]([^）)]+)[）)]\s*/.exec(text);
  if (m) {
    if (!aside) aside = m[1]!.trim();
    text = text.slice(m[0].length);
  }
  const name = (line.name ?? '').trim() || names[line.speaker];
  return { speaker: line.speaker, name, aside, text, chars: Array.from(text), emote: line.emote ?? 'none' };
}

/** 校验一个对话：返回问题列表（空 = 合法）。每个对话至少一句、至少一个选项、取值合法、热键不重复 */
export function validateDialogue(def: DialogueDef, key?: string): string[] {
  const errs: string[] = [];
  const tag = def.id || '(无 id)';
  if (!def.id) errs.push('对话缺少 id');
  if (key !== undefined && key !== def.id) errs.push(`${tag}：表里的键 ${key} 与 id 不一致`);
  if (!Array.isArray(def.lines) || def.lines.length === 0) errs.push(`${tag}：至少要有一句台词`);
  if (!Array.isArray(def.choices) || def.choices.length === 0) errs.push(`${tag}：至少要有一个选项`);
  (def.lines ?? []).forEach((l, i) => {
    if (!DIALOGUE_SPEAKERS.includes(l.speaker)) errs.push(`${tag} 第 ${i + 1} 句：说话人 ${String(l.speaker)} 不合法`);
    if (typeof l.text !== 'string' || resolveLine(l, { leader: 'x', boss: 'x' }).text.length === 0) errs.push(`${tag} 第 ${i + 1} 句：正文为空`);
    if (l.emote !== undefined && !DIALOGUE_EMOTE_IDS.includes(l.emote)) errs.push(`${tag} 第 ${i + 1} 句：动作 ${String(l.emote)} 不合法`);
  });
  const keys = new Set<string>();
  (def.choices ?? []).forEach((c, i) => {
    if (!c.label || !c.label.trim()) errs.push(`${tag} 选项 ${i + 1}：文字为空`);
    if (!DIALOGUE_ACTIONS.includes(c.action)) errs.push(`${tag} 选项 ${i + 1}：动作 ${String(c.action)} 不合法`);
    if (c.hotkey !== undefined) {
      const k = c.hotkey.toLowerCase();
      if (k.length !== 1 || k === ' ') errs.push(`${tag} 选项 ${i + 1}：热键 ${JSON.stringify(c.hotkey)} 应是单个可见字符`);
      if (keys.has(k)) errs.push(`${tag} 选项 ${i + 1}：热键 ${c.hotkey} 重复`);
      keys.add(k);
    }
  });
  return errs;
}

/** advance() 的结果：这次点击做了什么 */
export type AdvanceResult = 'reveal' | 'next' | 'choices' | 'none';

export class DialogueSession {
  readonly lines: readonly ResolvedLine[];
  private index = 0;
  /** 已显示的字数（小数：逐字显示的进度） */
  private shownChars = 0;
  private choicesOn = false;
  private finished: DialogueAction | null = null;

  constructor(
    readonly def: DialogueDef,
    names: Readonly<Record<DialogueSpeaker, string>>,
    /** 逐字显示的速度（字/秒）；≤ 0 = 每句立即整句显示 */
    private readonly typeSpeed: number,
  ) {
    const errs = validateDialogue(def);
    if (errs.length > 0) throw new Error(`对话数据有误：${errs.join('；')}`);
    this.lines = def.lines.map((l) => resolveLine(l, names));
    if (typeSpeed <= 0) this.shownChars = this.lines[0]!.chars.length;
  }

  /** 当前这句的下标 */
  get lineIndex(): number {
    return this.index;
  }

  /** 当前这句 */
  get line(): ResolvedLine {
    return this.lines[this.index]!;
  }

  /** 当前这句已经显示出来的正文 */
  get visibleText(): string {
    return this.line.chars.slice(0, Math.floor(this.shownChars)).join('');
  }

  /** 当前这句是否已整句显示 */
  get lineComplete(): boolean {
    return this.shownChars >= this.line.chars.length;
  }

  /** 是否正在显示选项 */
  get showingChoices(): boolean {
    return this.choicesOn;
  }

  get choices(): readonly DialogueChoice[] {
    return this.def.choices;
  }

  /** 选完之后的动作；还没选为 null */
  get result(): DialogueAction | null {
    return this.finished;
  }

  get done(): boolean {
    return this.finished !== null;
  }

  /** 逐字显示推进 dt 秒 */
  update(dt: number): void {
    if (this.done || this.choicesOn || dt <= 0 || this.lineComplete) return;
    this.shownChars = Math.min(this.line.chars.length, this.shownChars + dt * this.typeSpeed);
  }

  /** 点击 / 空格 */
  advance(): AdvanceResult {
    if (this.done || this.choicesOn) return 'none';
    if (!this.lineComplete) {
      this.shownChars = this.line.chars.length;
      return 'reveal';
    }
    if (this.index < this.lines.length - 1) {
      this.index += 1;
      this.shownChars = this.typeSpeed > 0 ? 0 : this.line.chars.length;
      return 'next';
    }
    this.choicesOn = true;
    return 'choices';
  }

  /** 选第 i 个选项；不在显示选项、下标不对、已经选过时返回 null */
  choose(i: number): DialogueAction | null {
    if (this.done || !this.choicesOn) return null;
    const c = this.def.choices[i];
    if (!c) return null;
    this.finished = c.action;
    return c.action;
  }

  /** 按热键选；没有对应的选项返回 null */
  chooseHotkey(key: string): DialogueAction | null {
    if (!this.choicesOn) return null;
    const k = key.toLowerCase();
    const i = this.def.choices.findIndex((c) => c.hotkey !== undefined && c.hotkey.toLowerCase() === k);
    return i < 0 ? null : this.choose(i);
  }

  /** 直接结束（Esc = “再等等”；回到起点、退出游戏时） */
  cancel(action: DialogueAction = 'close'): DialogueAction {
    if (!this.finished) this.finished = action;
    return this.finished;
  }
}

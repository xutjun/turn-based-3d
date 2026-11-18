import { describe, expect, it } from 'vitest';
import { BOSS_DIALOGUE_ID, DIALOGUES } from '../../src/data/dialogues';
import { DialogueSession } from '../../src/explore/dialogueSession';
import { installFakeDom, type FakeElement } from './fakeDom';

// 对话选项的出现时机（步骤 17 验收修正）：骑士台词逐字显示完 → 点击 → Boss 台词逐字显示完 → 再点击 → 才出现选项。
// 逐字显示中点击 / 空格只补全整句；选项出现前按 1 / 2 无效。
// 旧 bug：DialogBox.open() 只重置了“上次画的内容”的缓存，没把选项区的 DOM 重新隐藏，
// 第二次及以后打开对话时选项从第一句起就一直显示。

const NAMES = { leader: '烬刃', boss: '深渊魔将' };

async function setup() {
  const root = installFakeDom();
  const { DialogBox } = await import('../../src/ui/dialog/DialogBox');
  let session: DialogueSession | null = null;
  // 与 PlayerBattleApp 相同：点击 / 空格 = advance，热键只在显示选项时有效
  const box = new DialogBox({
    root: root as unknown as HTMLElement,
    onAdvance: () => {
      session?.advance();
      box.render();
    },
    onChoose: () => undefined,
  });
  const find = (cls: string): FakeElement => root.all().find((e) => e.className.split(' ').includes(cls))!;
  const choicesShown = (): boolean => !find('dk-dialog-choices').classList.contains('is-hidden');
  const open = (): DialogueSession => {
    session = new DialogueSession(DIALOGUES[BOSS_DIALOGUE_ID]!, NAMES, 24);
    box.open(session);
    return session;
  };
  const tick = (seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      session!.update(1 / 60);
      box.render();
    }
  };
  const click = (): void => (box as unknown as { onClick: (e: unknown) => void }).onClick({ button: 0, stopPropagation: () => undefined });
  return { box, open, tick, click, choicesShown };
}

describe('对话选项的出现时机', () => {
  it.each([1, 2, 3])('第 %i 次打开对话：两句台词都显示完并各点一次之后才出现选项', async (times) => {
    const s = await setup();
    for (let round = 1; round <= times; round++) {
      const d = s.open();
      const last = round === times;
      // 骑士台词逐字显示中：没有选项，按 1 / 2 无效
      s.tick(0.2);
      expect(d.lineIndex).toBe(0);
      expect(d.lineComplete).toBe(false);
      expect(s.choicesShown(), `第 ${round} 次 骑士逐字中`).toBe(false);
      expect(d.chooseHotkey('1')).toBeNull();
      // 逐字中点击：只补全整句
      s.click();
      expect(d.lineIndex).toBe(0);
      expect(d.lineComplete).toBe(true);
      expect(s.choicesShown(), '骑士整句').toBe(false);
      expect(d.chooseHotkey('2')).toBeNull();
      // 点击：Boss 台词开始逐字显示
      s.click();
      expect(d.lineIndex).toBe(1);
      expect(d.lineComplete).toBe(false);
      expect(s.choicesShown(), 'Boss 逐字中').toBe(false);
      expect(d.chooseHotkey('1')).toBeNull();
      // 逐字显示自然走完：仍然没有选项
      s.tick(5);
      expect(d.lineComplete).toBe(true);
      expect(s.choicesShown(), 'Boss 整句显示完').toBe(false);
      expect(d.chooseHotkey('1')).toBeNull();
      // 再点击一次：才出现选项，热键生效
      s.click();
      expect(d.showingChoices).toBe(true);
      expect(s.choicesShown(), '点击确认后').toBe(true);
      if (!last) {
        // 选“再等等”结束这次对话，下一轮重新打开
        expect(d.chooseHotkey('2')).toBe('close');
        s.box.close();
      } else {
        expect(d.chooseHotkey('1')).toBe('startBattle');
      }
    }
  });

  it('Boss 台词逐字显示中点击：只补全整句，不会直接跳出选项', async () => {
    const s = await setup();
    const d = s.open();
    s.click(); // 骑士补全
    s.click(); // 到 Boss
    s.tick(0.1);
    s.click(); // Boss 补全
    expect(d.lineComplete).toBe(true);
    expect(d.showingChoices).toBe(false);
    expect(s.choicesShown()).toBe(false);
    s.click();
    expect(s.choicesShown()).toBe(true);
  });
});

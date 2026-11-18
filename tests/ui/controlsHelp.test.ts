import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_HELP } from '../../src/data/controls';
import { SettingsStore } from '../../src/ui/settings/settingsStore';
import { installFakeDom, type FakeElement } from './fakeDom';

// v0.7-hud3：画面上不再显示探索操作提示；设置菜单里的“操作说明”列出探索和战斗的全部操作，关闭后回到设置菜单。

async function setup() {
  const body = installFakeDom();
  const { SettingsMenu } = await import('../../src/ui/settings/SettingsMenu');
  const store = new SettingsStore(null);
  const opens: boolean[] = [];
  const menu = new SettingsMenu({
    root: body as unknown as HTMLElement,
    store,
    soundSupported: true,
    preview: () => undefined,
    onOpenChange: (open) => opens.push(open),
    onRestart: () => undefined,
    onExit: () => undefined,
  });
  const texts = (): string[] => body.all().map((e) => e.textContent);
  const button = (text: string): FakeElement => body.all().find((e) => e.tagName === 'button' && e.textContent === text)!;
  return { body, menu, texts, button, opens };
}

describe('操作说明', () => {
  it('内容分“探索”“战斗”两部分，覆盖现有的快捷键和操作', () => {
    expect(CONTROL_HELP.map((s) => s.title)).toEqual(['探索', '战斗']);
    const flat = (i: number): string =>
      CONTROL_HELP[i]!.groups.flatMap((g) => g.entries.map((e) => `${e.keys}：${e.action}`)).join('\n');
    const explore = flat(0);
    for (const want of ['鼠标左键点地面', '左键点 Boss', '方向键 / WASD', '按钮栏', 'Esc', '左键 / 空格 / 回车', '1 / 2', '再等等', 'M']) {
      expect(explore, want).toContain(want);
    }
    const battle = flat(1);
    for (const want of ['A / W / D', '攻击 / 技能 / 防御', '右键 / Esc', '退格', '1 倍速 / 2 倍速', 'S', '跳过动画', '回车 / 空格', '齿轮', 'M']) {
      expect(battle, want).toContain(want);
    }
  });

  for (const context of ['title', 'explore', 'battle'] as const) {
    it(`设置菜单（${context}）里有“操作说明”：打开后显示说明面板，“返回”或 Esc 回到设置菜单，再按 Esc 关闭菜单`, async () => {
      const s = await setup();
      s.menu.open(context);
      expect(s.texts()).toContain('操作说明');
      s.button('操作说明').onclick!();
      expect(s.menu.helpOpen).toBe(true);
      const t = s.texts();
      expect(t).toContain('探索');
      expect(t).toContain('战斗');
      expect(t).toContain('鼠标左键点地面');
      expect(t).not.toContain('分辨率'); // 说明面板替换了设置面板
      s.button('返回').onclick!();
      expect(s.menu.helpOpen).toBe(false);
      expect(s.menu.isOpen).toBe(true);
      expect(s.texts()).toContain('分辨率');
      // Esc：说明 → 设置菜单 → 关闭
      s.button('操作说明').onclick!();
      expect(s.menu.escape()).toBe(true);
      expect(s.menu.helpOpen).toBe(false);
      expect(s.menu.isOpen).toBe(true);
      expect(s.menu.escape()).toBe(true);
      expect(s.menu.isOpen).toBe(false);
      expect(s.opens).toEqual([true, false]); // 看说明不会改变暂停状态
    });
  }

  it('重新打开菜单时显示的是设置面板，不是上次的说明', async () => {
    const s = await setup();
    s.menu.open('explore');
    s.button('操作说明').onclick!();
    s.menu.close();
    s.menu.open('explore');
    expect(s.menu.helpOpen).toBe(false);
    expect(s.texts()).toContain('分辨率');
  });

  it('页面上不再创建探索操作提示', () => {
    const src = readFileSync(join(__dirname, '../../src/ui/PlayerBattleApp.ts'), 'utf-8');
    expect(src).not.toMatch(/dk-explore-hint/);
    expect(src).not.toMatch(/exploreHint/);
  });
});

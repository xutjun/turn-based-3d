import { describe, expect, it } from 'vitest';
import { EQUIP_SLOTS, EQUIPMENT, STAT_KEYS, STAT_LABEL } from '../../src/data/equipment';
import { HERO_TEMPLATES } from '../../src/data/heroes';
import { EQUIP_ICON_SHAPES, equipIconSvg } from '../../src/ui/explore/equipIcons';
import { placeTooltip } from '../../src/ui/widgets/Tooltip';
import { installFakeDom, type FakeElement } from './fakeDom';

// 步骤 22：道具面板（人形装备框 + 8 × 5 背包）、装备悬停提示、角色面板的“基础 + 装备”提示、提示框不超出画面、装备图标。

async function setup(leaderId = 'A1') {
  const body = installFakeDom();
  const doc = document as unknown as { createElement(t: string): FakeElement };
  const stage = doc.createElement('div');
  body.append(stage);
  const { ExploreHud } = await import('../../src/ui/explore/ExploreHud');
  let leader = HERO_TEMPLATES.find((t) => t.id === leaderId)!;
  const hud = new ExploreHud({
    stage: stage as unknown as HTMLElement,
    leader: () => leader,
    preview: null,
    onSettings: () => undefined,
    now: () => 0,
  });
  hud.syncScreen('explore');
  const slot = (s: string): FakeElement => hud.inventory.slots.get(s as never) as unknown as FakeElement;
  /** 提示框当前内容里的全部文字 */
  const tipTexts = (): string[] => {
    const c = hud.tooltip.shownContent as unknown as FakeElement | string | null;
    if (c === null) return [];
    return typeof c === 'string' ? [c] : c.all().map((e) => e.textContent).filter(Boolean);
  };
  return { hud, slot, tipTexts, setLeader: (id: string) => void (leader = HERO_TEMPLATES.find((t) => t.id === id)!) };
}

describe('道具面板', () => {
  it('6 个装备框都显示当前队长的装备图标和品质边框；背包 8 × 5 = 40 个空格子', async () => {
    const s = await setup();
    s.hud.press('inventory');
    expect(s.hud.openPanel).toBe('inventory');
    expect([...s.hud.inventory.slots.keys()]).toEqual([...EQUIP_SLOTS]);
    for (const slot of EQUIP_SLOTS) {
      const box = s.slot(slot);
      expect(box.className).toContain('has-item');
      expect(box.className).toContain('q-set');
      expect(box.style['--q']).toBe('#3fd46a');
      expect((box.children[1] as FakeElement).innerHTML).toMatch(/^<svg viewBox=/);
      expect(box.attrs['aria-label']).toContain(EQUIPMENT.find((e) => e.id === `eq_A1_${slot}`)!.name);
    }
    expect(s.hud.inventory.cells).toHaveLength(40);
    for (const cell of s.hud.inventory.cells as unknown as FakeElement[]) expect(cell.children).toHaveLength(0);
  });

  it('悬停装备：提示框显示名称、等级、部位和各项属性加成；移开消失', async () => {
    const s = await setup();
    s.hud.press('inventory');
    s.slot('helmet').dispatch('pointerenter');
    expect(s.tipTexts()).toEqual(['余烬桶盔', '余烬套 · 套装', '10 级 · 头盔', '+60 魔法', '+8 防御力']);
    s.slot('helmet').dispatch('pointerleave');
    expect(s.hud.tooltip.shownContent).toBeNull();
    s.slot('weapon').dispatch('pointerenter');
    expect(s.tipTexts()).toEqual(['熔火弯刀', '余烬套 · 套装', '10 级 · 武器', '+60 物理攻击力']);
  });

  it('每件装备的提示都列出它的全部加成（按属性顺序）', async () => {
    const { equipTooltipLines } = await import('../../src/ui/explore/panels/InventoryPanel');
    for (const e of EQUIPMENT) {
      const l = equipTooltipLines(e);
      const want = STAT_KEYS.filter((k) => e.bonus[k]).map((k) => `+${e.bonus[k]} ${STAT_LABEL[k]}`);
      expect(l.bonuses, e.id).toEqual(want);
      expect(l.meta).toMatch(/^10 级 · /);
      expect(l.name).toBe(e.name);
    }
  });

  it('背包空格子没有提示；装备不能点、不能拖', async () => {
    const s = await setup();
    s.hud.press('inventory');
    for (const cell of s.hud.inventory.cells as unknown as FakeElement[]) {
      expect(cell.listeners['pointerenter']).toBeUndefined();
      expect(cell.onclick).toBeNull();
    }
    for (const slot of EQUIP_SLOTS) {
      const box = s.slot(slot);
      expect(box.onclick).toBeNull();
      expect(box.listeners['click']).toBeUndefined();
      expect(box.listeners['pointerdown']).toBeUndefined();
      expect(box.listeners['dragstart']).toBeUndefined();
      expect(box.attrs['draggable']).toBe('false');
    }
  });

  it('换了队长后重新打开：显示新队长的装备', async () => {
    const s = await setup();
    s.setLeader('A2');
    s.hud.press('inventory');
    s.slot('necklace').dispatch('pointerenter');
    expect(s.tipTexts()).toEqual(['雷纹挂坠', '雷殛套 · 套装', '10 级 · 项链', '+40 魔法', '+20 法术攻击力']);
  });
});

describe('角色面板：最终属性与“基础 + 装备”', () => {
  it('属性读计算后的最终属性；悬停某项显示基础 + 装备 = 合计', async () => {
    const s = await setup();
    s.hud.press('character');
    const panel = s.hud.panels as unknown as { current: { root: FakeElement } };
    const rows = panel.current.root.all().filter((e) => e.className.includes('dk-char-row is-stat'));
    expect(rows.map((r) => r.dataset['stat'])).toEqual([...STAT_KEYS]);
    const texts = (r: FakeElement): string[] => r.children.map((c) => c.textContent);
    expect(texts(rows[0]!)).toEqual(['气血', '1200']);
    rows[0]!.dispatch('pointerenter');
    expect(s.hud.tooltip.shownText).toBe('基础 900 + 装备 300 = 1200');
    rows[5]!.dispatch('pointerenter');
    expect(s.hud.tooltip.shownText).toBe('基础 75 + 装备 15 = 90');
    rows[3]!.dispatch('pointerenter');
    expect(s.hud.tooltip.shownText).toBe('基础 50 + 装备 0 = 50');
  });
});

describe('提示框不超出画面', () => {
  const bounds = { width: 1440, height: 900 };
  const size = { width: 200, height: 120 };

  it('默认在目标正上方居中', () => {
    const p = placeTooltip({ left: 600, top: 400, width: 64, height: 64 }, size, bounds);
    expect(p).toEqual({ left: 532, top: 272, below: false });
  });

  it('靠左 / 靠右时贴边，不超出', () => {
    expect(placeTooltip({ left: 0, top: 400, width: 40, height: 40 }, size, bounds).left).toBe(6);
    expect(placeTooltip({ left: 1420, top: 400, width: 20, height: 40 }, size, bounds).left).toBe(1440 - 6 - 200);
  });

  it('上方放不下时放到目标下方；下方也放不下时夹在画面内', () => {
    const p = placeTooltip({ left: 600, top: 30, width: 64, height: 64 }, size, bounds);
    expect(p.below).toBe(true);
    expect(p.top).toBe(30 + 64 + 8);
    const tall = placeTooltip({ left: 600, top: 50, width: 64, height: 800 }, size, bounds);
    expect(tall.top + size.height).toBeLessThanOrEqual(900 - 6);
    expect(tall.top).toBeGreaterThanOrEqual(6);
  });
});

describe('装备图标（程序化 SVG）', () => {
  it('每种形状都能生成，带渐变、做旧滤镜和描边；同一 key 只生成一次', () => {
    for (const shape of EQUIP_ICON_SHAPES) {
      const svg = equipIconSvg(`test-${shape}`, { shape, primary: 0x806040, secondary: 0xd0a242, glow: 0xff4a12 });
      expect(svg).toMatch(/^<svg viewBox="0 0 \d+ \d+"/);
      expect(svg).toContain(`id="eqi-test-${shape}-b"`);
      expect(svg).toContain('feTurbulence');
      expect(svg).toContain('stroke="#0a0806"');
      expect(equipIconSvg(`test-${shape}`, { shape: 'plate', primary: 0, secondary: 0 })).toBe(svg);
    }
  });

  it('30 件装备的图标 id 互不冲突，颜色来自装备表', () => {
    const ids = new Set<string>();
    for (const e of EQUIPMENT) {
      const svg = equipIconSvg(e.id, e.icon);
      const id = /id="(eqi-[\w-]+)-b"/.exec(svg)![1]!;
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
    expect(ids.size).toBe(30);
  });
});

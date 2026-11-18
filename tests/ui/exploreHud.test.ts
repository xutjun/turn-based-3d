import { describe, expect, it } from 'vitest';
import { HERO_TEMPLATES } from '../../src/data/heroes';
import { installFakeDom, type FakeElement } from './fakeDom';

// 步骤 21：探索界面（圆球、按钮栏、面板框架、角色面板）、Esc 优先级、点击不穿透、进出战斗时的显隐。

async function setup() {
  const body = installFakeDom();
  const stage = (document as unknown as { createElement(t: string): FakeElement }).createElement('div');
  stage.className = 'dk-stage';
  body.append(stage);
  const menuLayer = (document as unknown as { createElement(t: string): FakeElement }).createElement('div');
  menuLayer.className = 'dk-menu-layer';
  stage.append(menuLayer);
  const { ExploreHud } = await import('../../src/ui/explore/ExploreHud');
  let leader = HERO_TEMPLATES.find((t) => t.id === 'A1')!;
  const opened: { id: string; yaw: number; closed: boolean }[] = [];
  let settings = 0;
  const changes: (string | null)[] = [];
  const hud = new ExploreHud({
    stage: stage as unknown as HTMLElement,
    before: menuLayer as unknown as HTMLElement,
    leader: () => leader,
    preview: {
      open: (id) => {
        const v = { id, yaw: 0, closed: false, close: () => void (v.closed = true) };
        opened.push(v);
        return v;
      },
    },
    onSettings: () => void (settings += 1),
    onPanelChange: (p) => changes.push(p),
    now: () => 0,
  });
  const root = hud.root as unknown as FakeElement;
  /** 面板层里挂着的面板 */
  const mounted = (): FakeElement[] => root.children.find((c) => c.className === 'dk-hud-panels')!.children;
  const button = (id: string): FakeElement => root.all().find((e) => e.className.includes(`dk-hud-btn is-${id}`))!;
  return {
    hud,
    stage,
    root,
    menuLayer,
    mounted,
    button,
    opened,
    changes,
    settings: () => settings,
    setLeader: (id: string) => void (leader = HERO_TEMPLATES.find((t) => t.id === id)!),
  };
}

describe('探索界面的显隐', () => {
  it('只在探索和对话中显示；标题、过场、战斗、结算、战后过场中隐藏', async () => {
    const s = await setup();
    const { exploreHudVisibleOn } = await import('../../src/ui/explore/ExploreHud');
    for (const screen of ['title', 'explore', 'dialog', 'intro', 'battle', 'result', 'outro'] as const) {
      s.hud.syncScreen(screen);
      expect(s.hud.visible, screen).toBe(screen === 'explore' || screen === 'dialog');
      expect(exploreHudVisibleOn(screen)).toBe(s.hud.visible);
    }
  });

  it('界面层插在菜单层之下（设置菜单盖在它上面）', async () => {
    const s = await setup();
    const kids = s.stage.children;
    expect(kids.indexOf(s.root)).toBeGreaterThanOrEqual(0);
    expect(kids.indexOf(s.root)).toBeLessThan(kids.indexOf(s.menuLayer));
  });

  it('进入战斗时整个界面隐藏并关闭面板，战后回到探索时恢复（圆球显示当前队长），连续多轮无残留', async () => {
    const s = await setup();
    const { clearBattleUi } = await import('../../src/ui/explore/exploreUi');
    const parts = {
      hud: { reset: () => undefined, setControlsVisible: () => undefined, setMarks: () => undefined, visibleBattleElements: () => 0 },
      rings: { clear: () => undefined, visibleCount: 0 },
    };
    for (let round = 0; round < 3; round++) {
      s.hud.syncScreen('explore');
      s.hud.press('character');
      expect(s.hud.openPanel).toBe('character');
      // 点 Boss → 对话：对话中面板已关（页面在 clickBoss 时关掉；这里也由 syncScreen 保证）
      s.hud.syncScreen('dialog');
      expect(s.hud.openPanel).toBeNull();
      expect(s.mounted()).toHaveLength(0);
      for (const screen of ['intro', 'battle', 'result', 'outro'] as const) {
        s.hud.syncScreen(screen);
        expect(s.hud.visible).toBe(false);
        expect(s.hud.openPanel).toBeNull();
      }
      // 战后回到探索：页面先切界面再走 clearBattleUi
      s.hud.syncScreen('explore');
      clearBattleUi(parts);
      expect(s.hud.visible).toBe(true);
      expect(s.hud.orb.current).toEqual({ hp: 1200, maxHp: 1200, mp: 600, maxMp: 600 });
      expect(s.opened.every((v) => v.closed)).toBe(true);
    }
    // 每轮只开过一次角色面板的预览，全部关掉了
    expect(s.opened).toHaveLength(3);
  });
});

describe('面板开关与互斥', () => {
  it('点按钮打开，再点关闭；同一时间只开一个；关闭叉也能关', async () => {
    const s = await setup();
    s.hud.syncScreen('explore');
    s.hud.press('character');
    expect(s.hud.openPanel).toBe('character');
    expect(s.mounted()).toHaveLength(1);
    expect(s.button('character').classList.contains('is-active')).toBe(true);

    s.hud.press('inventory');
    expect(s.hud.openPanel).toBe('inventory');
    expect(s.mounted()).toHaveLength(1);
    expect(s.mounted()[0]!.className).toContain('dk-panel-inventory');
    expect(s.button('character').classList.contains('is-active')).toBe(false);
    expect(s.opened[0]!.closed).toBe(true); // 角色面板的 3D 预览随面板关闭

    s.hud.press('pet');
    s.hud.press('party');
    expect(s.mounted()).toHaveLength(1);
    expect(s.hud.openPanel).toBe('party');

    s.hud.press('party');
    expect(s.hud.openPanel).toBeNull();
    expect(s.mounted()).toHaveLength(0);

    s.hud.press('character');
    const close = s.mounted()[0]!.all().find((e) => e.className.includes('dk-game-panel-close'))!;
    close.onclick!();
    expect(s.hud.openPanel).toBeNull();
    // 切换面板 = 先关当前再开新的
    expect(s.changes).toEqual(['character', null, 'inventory', null, 'pet', null, 'party', null, 'character', null]);
  });

  it('道具、宝宝、队友本步是空面板，写“下一步实现”', async () => {
    const s = await setup();
    s.hud.syncScreen('explore');
    for (const id of ['inventory', 'pet', 'party'] as const) {
      s.hud.press(id);
      const texts = s.mounted()[0]!.all().map((e) => e.textContent);
      expect(texts).toContain('下一步实现');
    }
  });

  it('技能按钮灰色禁用，点了不打开任何面板，悬停提示“敬请期待”', async () => {
    const s = await setup();
    s.hud.syncScreen('explore');
    s.hud.press('skills');
    expect(s.hud.openPanel).toBeNull();
    const b = s.button('skills');
    expect(b.classList.contains('is-disabled')).toBe(true);
    expect(b.attrs['aria-disabled']).toBe('true');
    b.dispatch('pointerenter');
    expect(s.hud.tooltip.shownText).toContain('敬请期待');
    b.dispatch('pointerleave');
    expect(s.hud.tooltip.shownText).toBeNull();
  });

  it('“设置”先关闭打开着的面板，再打开设置菜单', async () => {
    const s = await setup();
    s.hud.syncScreen('explore');
    s.hud.press('character');
    s.hud.press('settings');
    expect(s.hud.openPanel).toBeNull();
    expect(s.settings()).toBe(1);
  });

  it('对话中只有“设置”可用，其余按钮置灰、点了无效', async () => {
    const s = await setup();
    s.hud.syncScreen('dialog');
    for (const id of ['character', 'inventory', 'pet', 'party'] as const) {
      s.hud.press(id);
      expect(s.hud.openPanel).toBeNull();
      expect(s.button(id).classList.contains('is-disabled')).toBe(true);
    }
    expect(s.button('settings').classList.contains('is-disabled')).toBe(false);
    s.hud.press('settings');
    expect(s.settings()).toBe(1);
    // 回到探索后恢复可用
    s.hud.syncScreen('explore');
    expect(s.button('character').classList.contains('is-disabled')).toBe(false);
  });
});

describe('圆球', () => {
  it('左红右蓝按比例填充，悬停显示数字；显示当前队长', async () => {
    const s = await setup();
    s.hud.syncScreen('explore');
    expect(s.hud.orb.tipText('hp')).toBe('气血 1200 / 1200');
    expect(s.hud.orb.tipText('mp')).toBe('魔法 600 / 600');
    expect(s.hud.orb.levels()).toEqual({ hp: 1, mp: 1 });
    s.hud.orb.set({ hp: 300, maxHp: 1200, mp: 0, maxMp: 600 });
    expect(s.hud.orb.levels()).toEqual({ hp: 0.25, mp: 0 });
    const liquids = s.root.all().filter((e) => e.className === 'dk-orb-liquid');
    expect(liquids.map((e) => e.style['height'])).toEqual(['25.0%', '0.0%']);
    const half = s.root.all().find((e) => e.className === 'dk-orb-half is-hp')!;
    half.dispatch('pointerenter');
    expect(s.hud.tooltip.shownText).toBe('气血 300 / 1200');

    s.setLeader('A2');
    s.hud.refresh();
    expect(s.hud.orb.tipText('hp')).toBe('气血 850 / 850');
    expect(s.hud.orb.tipText('mp')).toBe('魔法 800 / 800');
  });

  it('上限为 0 时按空，不出现 NaN', async () => {
    const { orbLevel } = await import('../../src/ui/hud/Orb');
    expect(orbLevel(5, 0)).toBe(0);
    expect(orbLevel(-1, 10)).toBe(0);
    expect(orbLevel(20, 10)).toBe(1);
  });
});

describe('角色面板', () => {
  it('右侧显示名称、等级 10、经验条和 6 项属性（读现有战斗属性），左侧打开当前队长的 3D 预览', async () => {
    const s = await setup();
    s.hud.syncScreen('explore');
    s.hud.press('character');
    const texts = s.mounted()[0]!.all().map((e) => e.textContent);
    for (const want of ['烬刃', '等级', '10', '经验', '0 / 10000', '气血', '1200', '魔法', '600', '物理攻击力', '210', '法术攻击力', '50', '防御力', '60', '速度', '90']) {
      expect(texts, want).toContain(want);
    }
    expect(s.opened.map((v) => v.id)).toEqual(['A1']);
    expect(s.hud.character.previewOpen).toBe(true);
    // 面板底子上给 3D 视口挖了窗口（否则不透明的面板会挡住画在画布上的模型）
    expect(s.mounted()[0]!.classList.contains('has-window')).toBe(true);
    expect(s.mounted()[0]!.children[0]!.className).toBe('dk-game-panel-bg');
    s.hud.closePanel();
    expect(s.hud.character.previewOpen).toBe(false);
    expect(s.opened[0]!.closed).toBe(true);
  });

  it('拖拽旋转写到预览视口，松开后惯性逐帧推进；重新打开时回到正面', async () => {
    const s = await setup();
    s.hud.syncScreen('explore');
    s.hud.press('character');
    const panel = s.hud.character;
    const vp = panel.viewport as unknown as FakeElement;
    let t = 0;
    (panel as unknown as { deps: { now(): number } }).deps.now = () => t;
    vp.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 100, preventDefault: () => undefined });
    for (let i = 1; i <= 5; i++) {
      t = i * 0.016;
      vp.dispatch('pointermove', { pointerId: 1, clientX: 100 + i * 10 });
    }
    const view = s.opened[0]!;
    expect(view.yaw).toBeCloseTo(50 * 0.012, 6);
    vp.dispatch('pointerup', { pointerId: 1 });
    expect(panel.spin.velocity).toBeGreaterThan(0);
    const before = view.yaw;
    s.hud.update(0.1);
    expect(view.yaw).toBeGreaterThan(before);
    for (let i = 0; i < 200; i++) s.hud.update(1 / 60);
    expect(panel.spin.velocity).toBe(0);
    s.hud.press('character'); // 关
    s.hud.press('character'); // 再开
    expect(s.opened[1]!.yaw).toBe(0);
  });
});

describe('Esc 优先级（探索 / 对话）', () => {
  it('设置菜单 > 对话 > 面板 > 打开设置；其他界面交给原来的处理', async () => {
    const { resolveExploreEscape } = await import('../../src/ui/explore/ExploreHud');
    expect(resolveExploreEscape({ screen: 'explore', menuOpen: true, panelOpen: true })).toBe('menu');
    expect(resolveExploreEscape({ screen: 'dialog', menuOpen: true, panelOpen: false })).toBe('menu');
    expect(resolveExploreEscape({ screen: 'dialog', menuOpen: false, panelOpen: false })).toBe('dialog');
    expect(resolveExploreEscape({ screen: 'explore', menuOpen: false, panelOpen: true })).toBe('panel');
    expect(resolveExploreEscape({ screen: 'explore', menuOpen: false, panelOpen: false })).toBe('openMenu');
    for (const screen of ['title', 'intro', 'battle', 'result', 'outro'] as const) {
      expect(resolveExploreEscape({ screen, menuOpen: false, panelOpen: false })).toBeNull();
    }
  });

  it('有面板时按 Esc：先关面板，第二次 Esc 才打开设置', async () => {
    const s = await setup();
    const { resolveExploreEscape } = await import('../../src/ui/explore/ExploreHud');
    s.hud.syncScreen('explore');
    s.hud.press('party');
    let menuOpen = false;
    const esc = (): void => {
      const a = resolveExploreEscape({ screen: 'explore', menuOpen, panelOpen: s.hud.openPanel !== null });
      if (a === 'panel') s.hud.closePanel();
      else if (a === 'openMenu') menuOpen = true;
      else if (a === 'menu') menuOpen = false;
    };
    esc();
    expect(s.hud.openPanel).toBeNull();
    expect(menuOpen).toBe(false);
    esc();
    expect(menuOpen).toBe(true);
    esc();
    expect(menuOpen).toBe(false);
  });
});

describe('点击不穿透到地面', () => {
  async function pointer(enabled = true) {
    const s = await setup();
    s.hud.syncScreen('explore');
    const { ExplorePointer } = await import('../../src/ui/explore/ExplorePointer');
    const canvas = (document as unknown as { createElement(t: string): FakeElement }).createElement('canvas');
    s.stage.insertBefore(canvas, s.root);
    const ground: { x: number; z: number }[] = [];
    let boss = 0;
    const hovers: boolean[] = [];
    const p = new ExplorePointer({
      container: s.stage as unknown as HTMLElement,
      enabled: () => enabled,
      groundAt: (x, y) => ({ x, z: y }),
      bossBox: () => ({ id: 'E9', left: 0, right: 2000, top: 0, bottom: 50, depth: 50 }),
      onGround: (x, z) => ground.push({ x, z }),
      onBoss: () => void (boss += 1),
      onBossHover: (on) => hovers.push(on),
    });
    const click = (target: FakeElement, x = 300, y = 400): void =>
      s.stage.dispatch('click', { button: 0, clientX: x, clientY: y, composedPath: () => target.path() });
    const move = (target: FakeElement, x = 300, y = 20): void =>
      s.stage.dispatch('pointermove', { clientX: x, clientY: y, composedPath: () => target.path() });
    return { ...s, p, canvas, ground, click, move, hovers, boss: () => boss };
  }

  it('点画布 = 移动；点圆球、按钮栏、面板（含面板里的 3D 视口）都不移动', async () => {
    const s = await pointer();
    s.click(s.canvas);
    expect(s.ground).toHaveLength(1);
    s.hud.press('character');
    const targets = [
      s.root.all().find((e) => e.className === 'dk-orb-half is-mp')!,
      s.button('inventory'),
      s.button('skills'),
      s.mounted()[0]!,
      s.hud.character.viewport as unknown as FakeElement,
      s.mounted()[0]!.all().find((e) => e.className === 'dk-char-value')!,
    ];
    for (const t of targets) s.click(t);
    expect(s.ground).toHaveLength(1);
    expect(s.boss()).toBe(0);
    // 面板开着时，点面板外的地面照常移动（DESIGN §9.17 M3）
    s.click(s.canvas);
    expect(s.ground).toHaveLength(2);
  });

  it('鼠标在界面上时不高亮 Boss', async () => {
    const s = await pointer();
    s.move(s.canvas);
    expect(s.hovers).toEqual([true]);
    s.move(s.button('party'));
    expect(s.hovers).toEqual([true, false]);
  });
});

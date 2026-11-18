import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { BattleEngine } from '../../src/core/battle';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { Scheduler } from '../../src/render/director/Scheduler';
import { SelectionRings } from '../../src/render/scene/selectionRings';
import { battleUiResidue, clearBattleUi } from '../../src/ui/explore/exploreUi';
import { installFakeDom, type FakeElement } from './fakeDom';

// 步骤 17 修正的 bug：战斗中（或探索中）“退出游戏”回到标题再“开始游戏”，隐藏单位的头顶血条仍悬空显示在原位。
// 原因：拆场时 hud.reset() 不删头顶条（留给下一场的 init() 替换），而探索里不会再 init()，update() 每帧照样把它们投影到头顶。
// 现在每次进入探索 / 标题都走 clearBattleUi()：之后战斗界面层里不能有任何可见元素。

async function setup() {
  const container = installFakeDom();
  const { BattleHud } = await import('../../src/ui/hud/BattleHud');
  const scheduler = new Scheduler();
  const hud = new BattleHud({
    container: container as unknown as HTMLElement,
    scheduler,
    project: () => ({ x: 100, y: 100, visible: true }),
    headPosition: (_id, out) => out.set(0, 2, 0),
    settingsMenu: true,
  });
  const rings = new SelectionRings([...ALLY_TEMPLATES, ...ENEMY_TEMPLATES]);
  const engine = new BattleEngine(createDefaultSetup(3));
  const units = Object.values(engine.getState().units);
  /** 战斗界面层（.hud）里除了倍速按钮区以外，看得见的元素 */
  const layer = (): FakeElement[] => {
    const root = container.children.find((c) => c.className === 'hud')!;
    return root.all().filter((e) => e !== root && !e.className.includes('hud-controls') && !(e.parent?.className.includes('hud-controls') ?? false));
  };
  /** 模拟打了一阵子的战斗：头顶条、封印图标、飘字、横幅、顺序条、头顶标记、选中光圈都有 */
  const fight = (): void => {
    hud.setControlsVisible(true);
    hud.init(units as never);
    hud.setStatus('E0', 'seal', 2);
    hud.floater('E1', '-120', 'damage' as never);
    hud.banner('第 1 回合');
    hud.setTurn(1, units.map((u) => u.id));
    hud.setMarks(new Map([['E2', { kind: 'hostile', primary: true }]]));
    rings.set(new Map([['E2', { color: 0xff0000, state: 'primary' }]]) as never);
    scheduler.update(0.016);
    hud.update();
  };
  return { hud, rings, layer, fight, scheduler };
}

describe('进入探索模式时不留任何战斗界面元素', () => {
  it('打过一阵之后进入探索：头顶条、名字、封印图标、飘字、横幅、顺序条、选中光圈全部清空，之后逐帧更新也不会再出现', async () => {
    const s = await setup();
    s.fight();
    expect(battleUiResidue({ hud: s.hud, rings: s.rings })).toBeGreaterThan(20);
    expect(s.layer().length).toBeGreaterThan(20);

    clearBattleUi({ hud: s.hud, rings: s.rings });
    expect(battleUiResidue({ hud: s.hud, rings: s.rings })).toBe(0);
    for (let i = 0; i < 30; i++) {
      s.scheduler.update(0.05);
      s.hud.update();
    }
    expect(battleUiResidue({ hud: s.hud, rings: s.rings })).toBe(0);
    // DOM 里也确实没有了：战斗界面层只剩空的顺序条和横幅容器（隐藏 / 透明）
    const left = s.layer().filter((e) => e.className.includes('hud-head') || e.className.includes('hud-floater') || e.className.includes('hud-chip') || e.className.includes('hud-status'));
    expect(left).toEqual([]);
    expect(s.rings.visibleCount).toBe(0);
  });

  it('反复“战斗 → 进入探索”多次（退出游戏再开始、战斗中重新开始、过场中退出）：每次进入探索后都是 0', async () => {
    const s = await setup();
    for (let round = 0; round < 4; round++) {
      s.fight();
      clearBattleUi({ hud: s.hud, rings: s.rings });
      s.hud.update();
      expect(battleUiResidue({ hud: s.hud, rings: s.rings }), `第 ${round + 1} 次`).toBe(0);
    }
    // 过场中途退出：此时还没开战（头顶条可能是上一场留下的），同样清空
    s.fight();
    s.hud.setBattleOpacity(0);
    clearBattleUi({ hud: s.hud, rings: s.rings });
    expect(battleUiResidue({ hud: s.hud, rings: s.rings })).toBe(0);
    void Vector3;
  });
});

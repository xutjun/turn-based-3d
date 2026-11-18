import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { Scheduler } from '../../src/render/director/Scheduler';
import { SelectionRings } from '../../src/render/scene/selectionRings';
import { battleUiResidue, clearBattleUi, clearBattleUiForOutro } from '../../src/ui/explore/exploreUi';
import type { BattleSummary } from '../../src/ui/stats/BattleStats';
import { postBattleOptions } from '../../src/ui/panels/ResultPanel';
import { installFakeDom, type FakeElement } from './fakeDom';

// 战后界面（步骤 19 / v0.6.1）：战斗结束弹出结算画面和简单统计，点按钮（重新开始 / 再来一次）后清掉全部战斗界面（倍速 / 跳过按钮保留给战后过场），
// 过场播完进入探索时连按钮也隐藏。胜利、失败、中途放弃交替多轮后战斗界面层里没有任何可见元素。

async function setup() {
  const container = installFakeDom();
  const { BattleHud } = await import('../../src/ui/hud/BattleHud');
  const { ResultPanel } = await import('../../src/ui/panels/ResultPanel');
  const { LogPanel } = await import('../../src/ui/panels/LogPanel');
  const scheduler = new Scheduler();
  const hud = new BattleHud({
    container: container as unknown as HTMLElement,
    scheduler,
    project: () => ({ x: 100, y: 100, visible: true }),
    headPosition: (_id, out) => out.set(0, 2, 0),
    settingsMenu: true,
  });
  const uiRoot = document.createElement('div');
  container.append(uiRoot as unknown as FakeElement);
  const rings = new SelectionRings([...ALLY_TEMPLATES, ...ENEMY_TEMPLATES]);
  const log = new LogPanel(uiRoot);
  let rematches = 0;
  const result = new ResultPanel(uiRoot, () => void (rematches += 1));
  const ui = { hud, rings, log, result };
  const engine = new BattleEngine(createDefaultSetup(3));
  const units = Object.values(engine.getState().units);
  const fight = (): void => {
    hud.setControlsVisible(true);
    hud.init(units as never);
    hud.setStatus('E0', 'seal', 2);
    hud.floater('E1', '-120', 'damage' as never);
    hud.banner('第 3 回合');
    hud.setTurn(3, units.map((u) => u.id));
    hud.setMarks(new Map([['E2', { kind: 'hostile', primary: true }]]));
    rings.set(new Map([['E2', { color: 0xff0000, state: 'primary' }]]) as never);
    log.append([{ text: '第 1 回合', tone: 'turn' }, { text: '烬刃 攻击 骷髅兵', tone: 'ally' }] as never);
    scheduler.update(0.016);
    hud.update();
  };
  const summary = (winner: 'ally' | 'enemy'): BattleSummary => ({
    winner,
    turns: 7,
    actions: 60,
    allies: [],
    enemies: [],
    allyDamage: 12345,
    enemyDamage: 6789,
    allyHealing: 2468,
    allySurvivors: winner === 'ally' ? 4 : 0,
    enemySurvivors: winner === 'ally' ? 0 : 6,
    mvp: null,
  });
  const texts = (root: FakeElement): string[] => root.all().map((e) => e.textContent).filter(Boolean);
  const controlsShown = (): boolean => {
    const c = container.all().find((e) => e.className.includes('hud-controls'));
    return !!c && c.style['display'] !== 'none' && !c.classList.contains('is-hidden');
  };
  return { hud, rings, log, result, ui, fight, summary, texts, uiRoot: uiRoot as unknown as FakeElement, scheduler, controlsShown, rematches: () => rematches, logLines: () => (uiRoot as unknown as FakeElement).all().filter((e) => e.className.includes('dk-log-line')).length };
}

describe('结算画面：标题、简单统计、按钮', () => {
  const buttons = (root: FakeElement) => root.all().filter((e) => e.tagName === 'button');

  it('胜利：“恭喜你，击败了深渊魔将！”、统计、“重新开始”和禁用的“前往下一关”（悬停“敬请期待”，点击无效果）；回车 / 空格 = 重新开始', async () => {
    const s = await setup();
    const calls: string[] = [];
    s.result.show(s.summary('ally'), postBattleOptions('ally', '深渊魔将', { restart: () => calls.push('restart'), retry: () => calls.push('retry') }));
    const t = s.texts(s.uiRoot);
    expect(t).toContain('恭喜你，击败了深渊魔将！');
    for (const want of ['回合数', '7', '我方总伤害', '12345', '治疗量', '2468']) expect(t).toContain(want);
    expect(t).not.toContain('继续');
    expect(t).not.toContain('胜利');
    expect(s.uiRoot.all().some((e) => e.tagName === 'table')).toBe(false);
    const [restart, next, ...rest] = buttons(s.uiRoot);
    expect(rest).toEqual([]);
    expect(restart!.textContent).toBe('重新开始');
    expect(next!.textContent).toBe('前往下一关');
    // 前往下一关：禁用（灰色、不可点击），悬停提示“敬请期待”，点击什么都不发生
    expect(next!.title).toBe('敬请期待');
    expect(next!.className).toContain('is-disabled');
    expect(next!.attrs['aria-disabled']).toBe('true');
    expect(next!.style['cursor']).toBe('not-allowed');
    (next!.onclick as unknown as (e: { preventDefault(): void }) => void)({ preventDefault: () => undefined });
    expect(calls).toEqual([]);
    expect(s.result.visible).toBe(true);
    // 重新开始：按钮、回车 / 空格都调用它
    restart!.onclick!();
    expect(calls).toEqual(['restart']);
    expect(s.result.activate()).toBe(true);
    expect(calls).toEqual(['restart', 'restart']);
    s.result.hide();
    expect(s.result.activate()).toBe(false);
    expect(s.rematches()).toBe(0);
  });

  it('失败：“你被击败了”、统计、只有“再来一次”；回车 / 空格 = 再来一次', async () => {
    const s = await setup();
    const calls: string[] = [];
    s.result.show(s.summary('enemy'), postBattleOptions('enemy', '深渊魔将', { restart: () => calls.push('restart'), retry: () => calls.push('retry') }));
    const t = s.texts(s.uiRoot);
    expect(t).toContain('你被击败了');
    expect(t).toContain('我方总伤害');
    expect(t).not.toContain('继续');
    expect(buttons(s.uiRoot).map((b) => b.textContent)).toEqual(['再来一次']);
    expect(s.result.activate()).toBe(true);
    buttons(s.uiRoot)[0]!.onclick!();
    expect(calls).toEqual(['retry', 'retry']);
  });

  it('自动战斗等页面的完整结算界面不变：单位表格和“再战一次”', async () => {
    const s = await setup();
    s.result.show(s.summary('ally'));
    expect(s.texts(s.uiRoot)).toContain('再战一次');
    expect(s.uiRoot.all().some((e) => e.tagName === 'table')).toBe(true);
    s.result.activate();
    expect(s.rematches()).toBe(1);
  });
});

describe('战后回到探索：界面无残留', () => {
  it('胜利、失败、中途放弃交替多轮：点结算按钮后只剩倍速 / 跳过按钮，进入探索后战斗界面层为 0', async () => {
    const s = await setup();
    const rounds = ['victory', 'defeat', 'abort', 'victory', 'abort', 'defeat'] as const;
    for (const [i, r] of rounds.entries()) {
      s.fight();
      expect(battleUiResidue(s.ui), `第 ${i + 1} 轮战斗中`).toBeGreaterThan(20);
      expect(s.logLines()).toBe(2);
      if (r !== 'abort') {
        const go = () => clearBattleUiForOutro(s.ui);
        s.result.show(s.summary(r === 'victory' ? 'ally' : 'enemy'), postBattleOptions(r === 'victory' ? 'ally' : 'enemy', '深渊魔将', { restart: go, retry: go }));
        expect(s.result.visible).toBe(true);
        s.result.activate();
        // 战后过场中：头顶条、飘字、顺序条、光圈、日志、战后提示都没了，倍速 / 跳过按钮还在
        expect(battleUiResidue(s.ui), `第 ${i + 1} 轮战后过场`).toBe(0);
        expect(s.logLines()).toBe(0);
        expect(s.result.visible).toBe(false);
        expect(s.controlsShown()).toBe(true);
        for (let k = 0; k < 20; k++) {
          s.scheduler.update(0.05);
          s.hud.update();
        }
        expect(battleUiResidue(s.ui)).toBe(0);
      }
      clearBattleUi(s.ui); // 进入探索（或中途放弃回到起点）
      s.hud.update();
      expect(battleUiResidue(s.ui), `第 ${i + 1} 轮进入探索`).toBe(0);
      expect(s.controlsShown()).toBe(false);
      expect(s.logLines()).toBe(0);
    }
  });
});

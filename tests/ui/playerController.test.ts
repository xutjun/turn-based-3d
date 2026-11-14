import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { SKILLS } from '../../src/data/skills';
import type { LogLine } from '../../src/ui/log/battleLog';
import { PlayerBattleController, type UiPhase } from '../../src/ui/PlayerBattleController';
import type { BattleSummary } from '../../src/ui/stats/BattleStats';

/** 让等待中的 Promise 续接跑完 */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function createMatch(seed: number, petAuto: boolean) {
  const engine = new BattleEngine(createDefaultSetup(seed, { petAutoCommand: petAuto }));
  const phases: UiPhase[] = [];
  const log: LogLine[] = [];
  let result: BattleSummary | null = null;
  const controller = new PlayerBattleController({
    engine,
    skills: SKILLS,
    idle: () => Promise.resolve(),
    nextFrame: () => Promise.resolve(),
    petAuto,
    onPhase: (p) => phases.push(p),
    onLog: (lines) => log.push(...lines),
    onResult: (s) => (result = s),
  });
  return { engine, controller, phases, log, result: () => result };
}

/** 像玩家一样通过会话下指令：人物攻击第一个可选目标，偶尔防御 */
async function playManually(m: ReturnType<typeof createMatch>, maxSteps = 20000): Promise<number> {
  const { controller, engine } = m;
  const { session } = controller;
  let commands = 0;
  for (let i = 0; i < maxSteps && m.result() === null; i++) {
    if (session.mode === 'idle') {
      await tick();
      continue;
    }
    // 只有指令阶段才会轮到玩家
    expect(engine.getState().phase).toBe('command');
    expect(controller.uiPhase).toBe('command');
    if (commands % 7 === 6) session.chooseDefend();
    else {
      session.chooseAttack();
      expect(session.mode).toBe('target');
      expect(session.confirmTarget(session.candidates[0]!)).toBe(true);
    }
    commands += 1;
  }
  return commands;
}

describe('玩家战斗控制器', () => {
  it('手动下指令可以从头到尾打完一场，指令阶段与执行阶段交替', async () => {
    const m = createMatch(7, false);
    const running = m.controller.run();
    const commands = await playManually(m);
    await running;

    const state = m.engine.getState();
    expect(state.phase).toBe('ended');
    expect(m.result()).not.toBeNull();
    expect(m.result()!.winner).toBe(state.winner);
    expect(m.result()!.turns).toBe(state.turn);
    expect(m.controller.check).toMatchObject({ finished: true, winner: state.winner, turns: state.turn });
    expect(commands).toBeGreaterThan(state.turn); // 每回合至少下了一条指令

    // 阶段：command → execution 交替，最后 ended
    expect(m.phases[0]).toBe('command');
    expect(m.phases.at(-1)).toBe('ended');
    for (let i = 0; i < m.phases.length - 1; i++) {
      expect(m.phases[i]).toBe(i % 2 === 0 ? 'command' : 'execution');
    }
    expect(m.phases.filter((p) => p === 'command')).toHaveLength(state.turn);

    // 日志：每回合一行回合标题，最后一行是战斗结果
    expect(m.log.filter((l) => l.tone === 'turn')).toHaveLength(state.turn);
    expect(m.log.at(-1)!.tone).toBe('end');
    expect(m.controller.session.mode).toBe('idle');
  });

  it('宝宝手动时每回合要给人物和宝宝都下指令；自动时只给人物下', async () => {
    const manual = createMatch(3, false);
    void manual.controller.run();
    await tick();
    expect(manual.controller.session.progress).toEqual({ index: 1, total: 10 });
    expect(manual.controller.session.unitId).toBe('A0');
    manual.controller.session.chooseDefend();
    expect(manual.controller.session.unitId).toBe('A5'); // 人物之后是它的宝宝
    manual.controller.stop();

    const auto = createMatch(3, true);
    void auto.controller.run();
    await tick();
    expect(auto.controller.session.progress).toEqual({ index: 1, total: 5 });
    auto.controller.session.chooseDefend();
    expect(auto.controller.session.unitId).toBe('A1');
    auto.controller.stop();
  });

  it('指令阶段切换宝宝自动 / 手动立即生效', async () => {
    const m = createMatch(5, false);
    void m.controller.run();
    await tick();
    const { session } = m.controller;
    session.chooseDefend(); // A0
    expect(session.unitId).toBe('A5');

    // 正在给宝宝下指令时切到自动：跳到下一个人物
    expect(m.controller.setPetAuto(true)).toBe(true);
    expect(m.engine.getState().settings.petAutoCommand).toBe(true);
    expect(session.unitId).toBe('A1');
    expect(session.progress).toEqual({ index: 2, total: 5 });

    // 再切回手动：宝宝重新需要指令
    expect(m.controller.setPetAuto(false)).toBe(true);
    expect(session.unitId).toBe('A1');
    expect(session.progress.total).toBe(10);
    m.controller.stop();
  });

  it('执行阶段切换宝宝设置：下回合的指令阶段开始时生效', async () => {
    const engine = new BattleEngine(createDefaultSetup(9, { petAutoCommand: true }));
    let release: (() => void) | null = null;
    let holding = false;
    const controller = new PlayerBattleController({
      engine,
      skills: SKILLS,
      // 执行阶段卡住演出，模拟动画正在播放
      idle: () => (holding ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()),
      nextFrame: () => Promise.resolve(),
      petAuto: true,
    });
    void controller.run();
    await tick();
    const { session } = controller;
    holding = true;
    while (session.mode !== 'idle') session.chooseDefend();
    await tick();
    expect(engine.getState().phase).toBe('execution');
    expect(controller.setPetAuto(false)).toBe(false); // 现在改不了
    expect(engine.getState().settings.petAutoCommand).toBe(true);

    holding = false;
    release!();
    for (let i = 0; i < 200 && session.mode === 'idle'; i++) await tick();
    expect(engine.getState().turn).toBe(2);
    expect(engine.getState().settings.petAutoCommand).toBe(false);
    expect(session.progress.total).toBe(engine.getPendingCommandUnits().length);
    expect(engine.getPendingCommandUnits().some((id) => engine.getState().units[id]!.kind === 'pet')).toBe(true);
    controller.stop();
  });

  it('再战一次：新的一场状态完全重置', async () => {
    const first = createMatch(11, true);
    const running = first.controller.run();
    await playManually(first);
    await running;
    first.controller.stop();
    expect(first.engine.getState().phase).toBe('ended');

    const second = createMatch(12, true);
    void second.controller.run();
    await tick();
    const state = second.engine.getState();
    expect(state.turn).toBe(1);
    expect(state.phase).toBe('command');
    expect(state.winner).toBeNull();
    for (const id of state.unitIds) {
      const u = state.units[id]!;
      expect(u.alive).toBe(true);
      expect(u.hp).toBe(u.stats.maxHp);
      expect(u.mp).toBe(u.stats.maxMp);
      expect(u.statuses).toEqual([]);
    }
    expect(second.controller.stats.summary()).toMatchObject({ winner: null, allyDamage: 0, enemyDamage: 0, actions: 0 });
    expect(second.log.map((l) => l.text)).toEqual(['第 1 回合']);
    expect(second.controller.check).toMatchObject({ finished: false, winner: null, turns: 0, actions: 0 });
    expect(second.controller.session.unitId).toBe('A0');
    second.controller.stop();
  });

  it('stop() 之后不再推进战斗', async () => {
    const m = createMatch(1, true);
    const running = m.controller.run();
    await tick();
    m.controller.stop();
    await running;
    expect(m.engine.getState().turn).toBe(1);
    expect(m.result()).toBeNull();
  });
});

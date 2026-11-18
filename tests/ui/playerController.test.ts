import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { SKILLS } from '../../src/data/skills';
import type { LogLine } from '../../src/ui/log/battleLog';
import { PlayerBattleController, type UiPhase } from '../../src/ui/PlayerBattleController';
import type { BattleSummary } from '../../src/ui/stats/BattleStats';
import { makeSetup, makeUnit } from '../helpers';

/** 用技能手动打的几场（种子固定，结果可复现） */
const SKILL_SEEDS = [1, 2, 3];

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

/**
 * 像玩家一样通过会话下指令，能放技能就放技能：
 * 技能列表里的技能轮着用：找第一个可用且有目标的技能，悬停预览后点击确认；都不能用就普攻。
 * 返回用过的技能，以及执行阶段里给刚复活的单位现场下指令的次数。
 */
async function playWithSkills(m: ReturnType<typeof createMatch>, maxSteps = 40000) {
  const { controller, engine } = m;
  const { session } = controller;
  const used = new Set<string>();
  let midTurn = 0;
  for (let i = 0; i < maxSteps && m.result() === null; i++) {
    if (session.mode === 'idle') {
      await tick();
      continue;
    }
    const state = engine.getState();
    if (state.phase === 'execution') {
      // 只有刚复活、轮到出手的单位才会在执行阶段要指令
      expect(state.awaitingCommandFor).toBe(session.unitId);
      expect(session.progress).toEqual({ index: 1, total: 1 });
      midTurn += 1;
    } else expect(state.phase).toBe('command');

    session.openSkills();
    let done = false;
    // 每回合换一个技能起头，列表里的技能轮着用
    const rows = session.skillRows;
    const shift = rows.length > 0 ? state.turn % rows.length : 0;
    for (const row of [...rows.slice(shift), ...rows.slice(0, shift)]) {
      if (!row.enabled) continue;
      session.chooseSkill(row.skill.id);
      if (session.mode !== 'target') continue; // 没有可选目标（例如没人倒地时的复活）
      const target = session.candidates[0]!;
      session.hover(target);
      const preview = session.preview;
      expect(preview[0]).toBe(target);
      expect(preview.length).toBeLessThanOrEqual(row.skill.targetCount);
      expect(session.confirmTarget(target)).toBe(true);
      used.add(row.skill.id);
      done = true;
      break;
    }
    if (!done) {
      if (session.mode === 'skills') session.back();
      session.chooseAttack();
      expect(session.confirmTarget(session.candidates[0]!)).toBe(true);
    }
  }
  return { used, midTurn };
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
    expect(auto.controller.session.unitId).toBe('A2'); // 新阵型：按列，雷咒（col 1）在夜隼之后
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
    expect(session.unitId).toBe('A2'); // 新阵型：夜隼之后是雷咒（col 1）
    expect(session.progress).toEqual({ index: 2, total: 5 });

    // 再切回手动：宝宝重新需要指令
    expect(m.controller.setPetAuto(false)).toBe(true);
    expect(session.unitId).toBe('A2');
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

  it('手动释放技能可以打完一场：每个友方技能都能在界面里选中并放出，日志里出现技能名', async () => {
    const used = new Set<string>();
    const names = new Set<string>();
    for (const seed of SKILL_SEEDS) {
      const m = createMatch(seed, false);
      const running = m.controller.run();
      const r = await playWithSkills(m);
      await running;
      expect(m.engine.getState().phase).toBe('ended');
      expect(m.controller.session.mode).toBe('idle');
      for (const id of r.used) used.add(id);
      for (const l of m.log) for (const s of Object.values(SKILLS)) if (l.text.includes(`「${s.name}」`)) names.add(s.id);
    }
    const expected = ['triple_shot', 'arrow_rain', 'combo_slash', 'whirlwind', 'group_spell', 'triple_spell', 'single_spell', 'seal', 'group_heal', 'revive'];
    for (const id of expected) {
      expect(used.has(id), id).toBe(true);
      expect(names.has(id), id).toBe(true);
    }
  });

  it('复活后排在施法者之后的单位：执行阶段暂停，界面现场要指令，下完后它在本回合出手', async () => {
    const engine = new BattleEngine(
      makeSetup(
        [
          makeUnit('A0', 'ally', { name: '治疗师', classId: 'heal', skillIds: ['revive'], stats: { speed: 90, maxMp: 200 } }),
          makeUnit('A1', 'ally', { name: '倒地者', hp: 0, alive: false, stats: { speed: 50 } }),
          makeUnit('E0', 'enemy', { autoCommand: true, stats: { speed: 10, maxHp: 9999, physAtk: 11 } }),
        ],
        { skills: SKILLS },
      ),
    );
    const phases: UiPhase[] = [];
    const log: LogLine[] = [];
    const controller = new PlayerBattleController({
      engine,
      skills: SKILLS,
      idle: () => Promise.resolve(),
      nextFrame: () => Promise.resolve(),
      petAuto: false,
      onPhase: (p) => phases.push(p),
      onLog: (lines) => log.push(...lines),
    });
    const { session } = controller;
    void controller.run();
    await tick();

    // 指令阶段：只有治疗师要下指令，复活倒地的队友
    expect(session.unitId).toBe('A0');
    expect(session.progress).toEqual({ index: 1, total: 1 });
    session.openSkills();
    session.chooseSkill('revive');
    expect(session.candidates).toEqual(['A1']);
    expect(session.confirmTarget('A1')).toBe(true);
    for (let i = 0; i < 20 && session.mode === 'idle'; i++) await tick();

    // 执行阶段中途：轮到刚复活的单位，界面回到下指令状态
    expect(engine.getState().phase).toBe('execution');
    expect(engine.getState().awaitingCommandFor).toBe('A1');
    expect(session.unitId).toBe('A1');
    expect(session.canGoBack).toBe(false); // 只有它一个，不能返回上一个
    expect(controller.uiPhase).toBe('command');
    expect(log.some((l) => l.text === '倒地者 被复活（气血 30/100）')).toBe(true);
    session.chooseAttack();
    expect(session.confirmTarget('E0')).toBe(true);
    for (let i = 0; i < 20 && engine.getState().turn === 1; i++) await tick();

    expect(engine.getState().turn).toBe(2);
    expect(log.some((l) => l.text === '倒地者 攻击 E0')).toBe(true);
    expect(phases.slice(0, 4)).toEqual(['command', 'execution', 'command', 'execution']);
    controller.stop();
  });
});

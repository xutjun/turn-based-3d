import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { SKILLS } from '../../src/data/skills';
import { BattleDirector } from '../../src/render/director/BattleDirector';
import { Scheduler } from '../../src/render/director/Scheduler';
import { drainMatch } from '../../src/ui/matchLifecycle';
import { PlayerBattleController } from '../../src/ui/PlayerBattleController';
import { createFakes, runBattle } from '../render/directorFakes';

const nextTurn = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('暂停与恢复（调度器）', () => {
  it('暂停期间动画、等待、下一帧都不推进；恢复后从停下的地方继续', async () => {
    const s = new Scheduler();
    const seen: number[] = [];
    let tweenDone = false;
    let waitDone = false;
    let frameDone = false;
    void s.tween(1, (t) => seen.push(t)).then(() => (tweenDone = true));
    void s.wait(0.5).then(() => (waitDone = true));
    s.update(0.25);
    expect(seen.at(-1)).toBeCloseTo(0.25);

    s.setPaused(true);
    expect(s.paused).toBe(true);
    void s.nextFrame().then(() => (frameDone = true));
    const time = s.time;
    for (let i = 0; i < 100; i++) s.update(0.1); // 暂停了 10 秒
    await nextTurn();
    expect(s.time).toBe(time);
    expect(s.delta).toBe(0);
    expect(seen.at(-1)).toBeCloseTo(0.25);
    expect(waitDone).toBe(false);
    expect(frameDone).toBe(false); // 战斗流程（等下一帧）也停住
    expect(s.pending).toBe(2);

    s.setPaused(false);
    s.update(0.25);
    await nextTurn();
    expect(frameDone).toBe(true);
    expect(waitDone).toBe(true);
    expect(seen.at(-1)).toBeCloseTo(0.5);
    expect(tweenDone).toBe(false);
    s.update(0.5);
    await nextTurn();
    expect(tweenDone).toBe(true);
  });

  it('暂停不消耗顿帧 / 慢镜头的剩余时长', () => {
    const s = new Scheduler();
    s.warp(0.2, 0.5);
    s.setPaused(true);
    for (let i = 0; i < 50; i++) s.update(0.1);
    s.setPaused(false);
    expect(s.warpFactor).toBe(0.2);
  });

  it('整场战斗演出中途多次暂停再继续：演出不错乱，数值与逻辑层一致，没有单位留在站位外', async () => {
    let frame = 0;
    let pausedFrames = 0;
    const { engine, fakes, mismatches } = await runBattle(7, false, (scheduler) => {
      frame += 1;
      // 每 37 帧暂停 15 帧
      const pause = frame % 37 >= 22;
      scheduler.setPaused(pause);
      if (pause) pausedFrames += 1;
    });
    expect(pausedFrames).toBeGreaterThan(100);
    expect(engine.getState().phase).toBe('ended');
    expect(mismatches).toEqual([]);
    expect(fakes.violations).toEqual([]);
    expect(fakes.away.size).toBe(0);
  });

  it('暂停期间演出日志一条都不增加', async () => {
    const scheduler = new Scheduler();
    const fakes = createFakes(scheduler);
    const engine = new BattleEngine(createDefaultSetup(3));
    const director = new BattleDirector(engine.events, fakes.stage, fakes.hud, scheduler, {
      skillName: (id) => id,
      isBasicSkill: () => true,
    });
    engine.start();
    for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, engine.suggestCommand(id));
    engine.beginExecution();
    engine.stepAction();
    let done = false;
    void director.idle().then(() => (done = true));
    for (let i = 0; i < 10; i++) {
      scheduler.update(0.05);
      await nextTurn();
    }
    scheduler.setPaused(true);
    const logged = fakes.log.length;
    for (let i = 0; i < 200; i++) {
      scheduler.update(0.05);
      await nextTurn();
    }
    expect(fakes.log.length).toBe(logged);
    expect(done).toBe(false);
    scheduler.setPaused(false);
    for (let i = 0; i < 2000 && !done; i++) {
      scheduler.update(0.05);
      await nextTurn();
    }
    expect(done).toBe(true);
    expect(fakes.away.size).toBe(0);
  });
});

/** 一场由玩家下指令的战斗（真引擎 + 真导演 + 假舞台），用来测重新开始 */
function createMatch(seed: number, scheduler: Scheduler) {
  const fakes = createFakes(scheduler);
  const engine = new BattleEngine(createDefaultSetup(seed, { petAutoCommand: true }));
  const director = new BattleDirector(engine.events, fakes.stage, fakes.hud, scheduler, {
    skillName: (id) => SKILLS[id]?.name ?? id,
    isBasicSkill: (id) => SKILLS[id]?.classId === 'common',
  });
  const controller = new PlayerBattleController({
    engine,
    skills: SKILLS,
    idle: () => director.idle(),
    nextFrame: () => scheduler.nextFrame(),
    petAuto: true,
  });
  const run = controller.run();
  return { engine, director, controller, fakes, run };
}

/** 继续推进调度器直到 promise 完成（旧一场的流程停在“等下一帧”上，渲染循环每帧都会推进调度器） */
async function settle(scheduler: Scheduler, promise: Promise<void>): Promise<void> {
  let done = false;
  void promise.then(() => (done = true));
  for (let i = 0; i < 2000 && !done; i++) {
    scheduler.update(0.05);
    await nextTurn();
  }
  expect(done).toBe(true);
}

/** 玩家逐个下“攻击第一个目标”，同时推进演出，直到条件满足 */
async function playUntil(m: ReturnType<typeof createMatch>, scheduler: Scheduler, until: () => boolean, dt = 1 / 60): Promise<void> {
  const { session } = m.controller;
  for (let i = 0; i < 20000 && !until(); i++) {
    if (session.mode === 'menu') {
      session.chooseAttack();
      session.confirmTarget(session.candidates[0]!);
      continue;
    }
    scheduler.update(dt);
    await nextTurn();
  }
  expect(until()).toBe(true);
}

describe('重新开始：状态完全重置', () => {
  it('演出进行到一半、战斗暂停着时重新开始：旧一场立即收尾，不再有任何演出，跳过设置恢复原样', async () => {
    const scheduler = new Scheduler();
    const old = createMatch(11, scheduler);
    // 打到第 2 回合的出手阶段、有动画正在进行
    await playUntil(old, scheduler, () => old.engine.getState().turn >= 2 && old.director.stats.actions >= 12 && scheduler.pending > 0);
    expect(old.engine.getState().phase).not.toBe('ended');

    // 打开设置菜单（暂停），确认重新开始
    scheduler.setPaused(true);
    await drainMatch(old, scheduler);
    expect(scheduler.paused).toBe(false);
    expect(scheduler.skip).toBe(false); // 玩家原来没开跳过动画：恢复
    expect(scheduler.pending).toBe(0); // 旧演出全部走完
    expect(old.fakes.away.size).toBe(0); // 冲出去的单位已经回到站位
    await settle(scheduler, old.run); // 旧的战斗流程退出，不会卡住

    // 之后无论推进多久，旧一场都不再结算、不再演出
    const turn = old.engine.getState().turn;
    const actions = old.director.stats.actions;
    const logged = old.fakes.log.length;
    for (let i = 0; i < 300; i++) {
      scheduler.update(1 / 60);
      await nextTurn();
      if (old.controller.session.mode !== 'idle') throw new Error('旧一场还在要指令');
    }
    expect(old.engine.getState().turn).toBe(turn);
    expect(old.director.stats.actions).toBe(actions);
    expect(old.fakes.log.length).toBe(logged);

    // 新的一场从头开始：第 1 回合、满血、同样能正常打完
    const fresh = createMatch(12, scheduler);
    await playUntil(fresh, scheduler, () => fresh.engine.getState().turn >= 1 && fresh.controller.session.mode === 'menu');
    const state = fresh.engine.getState();
    expect(state.turn).toBe(1);
    for (const id of state.unitIds) {
      const u = state.units[id]!;
      expect(u.alive).toBe(true);
      expect(u.hp).toBe(u.stats.maxHp);
      expect(fresh.fakes.hp.get(id)).toBe(u.hp);
    }
    await playUntil(fresh, scheduler, () => fresh.engine.getState().phase === 'ended', 0.1);
    await settle(scheduler, fresh.run);
    expect(fresh.controller.check.finished).toBe(true);
  });

  it('玩家开着跳过动画时重新开始，收尾后仍是跳过动画', async () => {
    const scheduler = new Scheduler();
    scheduler.setSkip(true);
    const old = createMatch(5, scheduler);
    await playUntil(old, scheduler, () => old.engine.getState().turn >= 2);
    await drainMatch(old, scheduler);
    expect(scheduler.skip).toBe(true);
    await settle(scheduler, old.run);
  });

  it('反复重新开始 10 次：每次旧一场都干净退出', async () => {
    const scheduler = new Scheduler();
    for (let i = 0; i < 10; i++) {
      const m = createMatch(100 + i, scheduler);
      await playUntil(m, scheduler, () => m.director.stats.actions >= 1 + (i % 4) && scheduler.pending > 0);
      if (i % 2 === 0) scheduler.setPaused(true);
      await drainMatch(m, scheduler);
      await settle(scheduler, m.run);
      expect(scheduler.pending).toBe(0);
      expect(scheduler.paused).toBe(false);
      expect(m.fakes.away.size).toBe(0);
    }
  });
});

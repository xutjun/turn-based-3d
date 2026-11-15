import { describe, expect, it } from 'vitest';
import { runBattle } from '../render/directorFakes';

// 整场战斗回归：固定一批种子，用默认 10v10 阵容把逻辑和演出一起从头跑到一方全灭。
// 每次出手演完后核对：没有报错、没有两个单位同时行动、没有单位留在站位之外、
// 界面上的气血 / 魔法 / 倒地状态与逻辑层一致。数值、技能、演出有改动时这里最先发现问题。

/** 跳过动画跑的种子（快，覆盖面大） */
const SKIP_SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 64, 66, 89, 144, 233, 377, 610, 987, 2026];
/** 按正常速度把每一段动画都演完的种子（慢，检查演出不会卡死） */
const PLAY_SEEDS = [4, 64, 131];

describe('整场战斗回归', () => {
  it.each(SKIP_SEEDS)('种子 %i：跳过动画跑完整场，界面与逻辑一致，无同时行动、无离位', async (seed) => {
    const { engine, director, fakes, mismatches, eventCount } = await runBattle(seed, true);
    const state = engine.getState();
    expect(state.phase).toBe('ended');
    expect(state.winner === 'ally' || state.winner === 'enemy').toBe(true);
    expect(mismatches).toEqual([]);
    expect(fakes.violations).toEqual([]);
    expect(director.stats.concurrentActions).toBe(0);
    expect(director.stats.eventsPlayed).toBe(eventCount); // 每个事件都演出过
    expect(fakes.away.size).toBe(0);
    // 战斗结束时一方全灭，另一方至少一人存活
    const alive = (side: string): number => state.unitIds.filter((id) => state.units[id]!.side === side && state.units[id]!.alive).length;
    expect(alive(state.winner === 'ally' ? 'enemy' : 'ally')).toBe(0);
    expect(alive(state.winner!)).toBeGreaterThan(0);
  });

  it.each(PLAY_SEEDS)('种子 %i：按正常速度演完整场不卡死，同一时刻最多一个单位离开站位', async (seed) => {
    const { engine, director, fakes, mismatches, eventCount } = await runBattle(seed, false);
    expect(engine.getState().phase).toBe('ended');
    expect(mismatches).toEqual([]);
    expect(fakes.violations).toEqual([]);
    expect(fakes.maxAway()).toBeLessThanOrEqual(1);
    expect(director.stats.concurrentActions).toBe(0);
    expect(director.stats.eventsPlayed).toBe(eventCount);
  });

  it.each([7, 64])('种子 %i：演出中途反复开关跳过动画、切换倍速，战斗照常打完且界面与逻辑一致', async (seed) => {
    let frame = 0;
    const { engine, director, fakes, mismatches, eventCount } = await runBattle(seed, false, (scheduler) => {
      frame += 1;
      // 每隔几帧就像玩家乱按一样切一次：跳过动画 开 / 关，倍速 1 / 2
      if (frame % 7 === 0) scheduler.setSkip(!scheduler.skip);
      if (frame % 5 === 0) scheduler.setTimeScale(scheduler.timeScale === 1 ? 2 : 1);
    });
    expect(engine.getState().phase).toBe('ended');
    expect(mismatches).toEqual([]);
    expect(fakes.violations).toEqual([]);
    expect(fakes.maxAway()).toBeLessThanOrEqual(1);
    expect(fakes.away.size).toBe(0);
    expect(director.stats.concurrentActions).toBe(0);
    expect(director.stats.eventsPlayed).toBe(eventCount);
  });

  it('回合数落在合理范围内（数值平衡的粗检查）', async () => {
    const turns: number[] = [];
    for (const seed of SKIP_SEEDS) turns.push((await runBattle(seed, true)).engine.getState().turn);
    turns.sort((a, b) => a - b);
    expect(turns[0]).toBeGreaterThanOrEqual(4);
    expect(turns.at(-1)).toBeLessThanOrEqual(30);
    const median = turns[Math.floor(turns.length / 2)]!;
    expect(median).toBeGreaterThanOrEqual(8);
    expect(median).toBeLessThanOrEqual(14);
  });
});

describe('数值平衡守护', () => {
  it('200 个种子的自动战斗：友方胜率在 50%~70% 之间，多数战斗 8~14 回合，辅助技能都有用到；敌方不集火，魔法够用，复活当回合出手，连击约 50%', async () => {
    const { BattleEngine } = await import('../../src/core/battle');
    const { createDefaultSetup } = await import('../../src/data/defaultSetup');
    const { autoPlay } = await import('../helpers');
    const { isSealed } = await import('../../src/core/status');
    const { SKILLS } = await import('../../src/data/skills');
    const N = 200;
    let wins = 0;
    let inRange = 0;
    const casts: Record<string, number> = {};
    // v0.2 的指标（口径同 scripts/balance.ts）
    let singleTurns = 0; // 敌方有单体出手的回合
    let focusedTurns = 0; // 其中有友方被敌方单体出手选中 ≥ 3 次的回合
    let starved = 0; // 友方有主动技能、没被封印、魔法不够用任何技能的出手
    let actsWithSkills = 0;
    let allyActs = 0;
    let revived = 0;
    let revivedActed = 0; // 复活后当回合出手了的次数
    let basicByPassive = 0; // 物理型宝宝的普攻次数
    let passiveRolls = 0; // 其中连击判定成功的次数
    for (let seed = 1; seed <= N; seed++) {
      const engine = new BattleEngine(createDefaultSetup(seed));
      let singles = new Map<string, number>();
      let waitingRevived = new Set<string>();
      engine.events.onAny((e) => {
        const units = engine.getState().units;
        if (e.type === 'SkillCast') {
          casts[e.skillId] = (casts[e.skillId] ?? 0) + 1;
          const def = SKILLS[e.skillId]!;
          const actor = units[e.actorId]!;
          if (actor.side === 'enemy' && def.effect === 'damage' && def.targetCount === 1) {
            singles.set(e.targets[0]!, (singles.get(e.targets[0]!) ?? 0) + 1);
          }
          if (actor.passiveIds.length > 0 && def.classId === 'common') basicByPassive += 1;
        } else if (e.type === 'HitResolved') {
          if (e.hitIndex === 0 && e.hitCount === 2 && SKILLS[e.skillId]!.classId === 'common') passiveRolls += 1;
        } else if (e.type === 'UnitActStart') {
          const u = units[e.actorId]!;
          if (waitingRevived.delete(e.actorId)) revivedActed += 1;
          if (u.side !== 'ally') return;
          allyActs += 1;
          if (u.skillIds.length === 0) return;
          actsWithSkills += 1;
          if (e.command.kind !== 'defend' && !isSealed(u) && u.skillIds.every((id) => u.mp < SKILLS[id]!.mpCost)) starved += 1;
        } else if (e.type === 'UnitRevived') {
          revived += 1;
          expect(e.actsThisTurn).toBe(true); // 默认阵容里被复活的单位当回合都能出手
          waitingRevived.add(e.unitId);
        } else if (e.type === 'UnitDied') {
          // 排队途中又被打倒（或战斗在轮到它之前结束）的不算“应该出手”
          if (waitingRevived.delete(e.unitId)) revived -= 1;
        } else if (e.type === 'TurnEnd' || e.type === 'BattleEnd') {
          if (singles.size > 0) {
            singleTurns += 1;
            if (Math.max(...singles.values()) >= 3) focusedTurns += 1;
          }
          singles = new Map();
          if (e.type === 'TurnEnd') expect([...waitingRevived]).toEqual([]); // 复活的单位在回合结束前都出过手
          revived -= waitingRevived.size;
          waitingRevived = new Set();
        }
      });
      autoPlay(engine);
      const state = engine.getState();
      if (state.winner === 'ally') wins += 1;
      if (state.turn >= 8 && state.turn <= 14) inRange += 1;
    }
    expect(wins / N).toBeGreaterThanOrEqual(0.5);
    expect(wins / N).toBeLessThanOrEqual(0.7);
    expect(inRange / N).toBeGreaterThan(0.6);
    // 封印、治疗每场都有；复活平均每 3 场左右一次
    expect(casts['seal']! / N).toBeGreaterThan(3);
    expect(casts['group_heal']! / N).toBeGreaterThan(3);
    expect(casts['revive']! / N).toBeGreaterThan(0.2);
    expect(casts['triple_spell']! / N).toBeGreaterThan(2);
    // 敌方不集火：旧规则（固定打残血）下这个比例是 12.8%
    expect(focusedTurns / singleTurns).toBeLessThan(0.03);
    // 友方因魔法不足被迫普攻的出手占比低于 10%（两种分母都满足；旧数值是 39.6%）
    expect(starved / actsWithSkills).toBeLessThan(0.1);
    expect(starved / allyActs).toBeLessThan(0.1);
    // 复活的单位当回合出手
    expect(revived).toBeGreaterThan(20);
    expect(revivedActed).toBe(revived);
    // 物理型宝宝的连击约 50% 触发
    expect(passiveRolls / basicByPassive).toBeGreaterThan(0.46);
    expect(passiveRolls / basicByPassive).toBeLessThan(0.54);
  });
});

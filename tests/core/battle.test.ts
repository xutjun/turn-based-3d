import { describe, expect, it } from 'vitest';
import type { BattleState } from '../../src/core/types';
import { constRng, makeEngine, makeUnit, ofType, runExecution, seqRng } from '../helpers';

/** 取可修改的内部状态（仅用于构造防御性分支的测试场景） */
const mutable = (s: Readonly<BattleState>): BattleState => s as BattleState;

describe('回合状态机与事件顺序', () => {
  it('一个回合的事件顺序：回合开始 → 指令 → 执行 → 结算 → 下一回合', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 60 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 40 } }),
    ]);
    expect(engine.getState().phase).toBe('init');
    engine.start();
    expect(engine.getState()).toMatchObject({ phase: 'command', turn: 1 });

    expect(engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' })).toEqual({ ok: true });
    expect(engine.submitCommand('E0', { kind: 'defend' })).toEqual({ ok: true });
    engine.beginExecution();
    expect(engine.getState().phase).toBe('execution');
    runExecution(engine);
    expect(engine.getState()).toMatchObject({ phase: 'command', turn: 2 });

    expect(events.map((e) => e.type)).toEqual([
      'BattleStart',
      'TurnStart',
      'CommandPhaseStart',
      'ExecutionPhaseStart',
      'DefendApplied',
      'UnitActStart', // A0
      'SkillCast',
      'HitResolved',
      'UnitActEnd',
      'UnitActStart', // E0 防御
      'UnitActEnd',
      'TurnEnd',
      'TurnStart',
      'CommandPhaseStart',
    ]);
    // 序号严格递增
    events.forEach((e, i) => expect(e.seq).toBe(i + 1));
    // 回合号
    expect(events[0]!.turn).toBe(0);
    expect(ofType(events, 'TurnEnd')[0]!.turn).toBe(1);
    expect(ofType(events, 'TurnStart').map((e) => e.turn)).toEqual([1, 2]);
  });

  it('SkillCast 带出手方式、动画和冲锋信息：近战冲锋、弓箭原地射击、法术原地施放', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90 }, attackMode: 'melee' }),
      makeUnit('A1', 'ally', { stats: { speed: 80 }, attackMode: 'ranged' }),
      makeUnit('A2', 'ally', {
        stats: { speed: 70 },
        attackMode: 'cast',
        basicAttackSkillId: 'basic_magic',
      }),
      makeUnit('E0', 'enemy', { stats: { speed: 10, maxHp: 9999 } }),
    ]);
    engine.start();
    for (const id of ['A0', 'A1', 'A2']) engine.submitCommand(id, { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    const casts = ofType(events, 'SkillCast');
    expect(casts.map((c) => [c.actorId, c.delivery, c.animation, c.meleeCharge])).toEqual([
      ['A0', 'melee', 'meleeStrike', true],
      ['A1', 'ranged', 'bowShot', false],
      ['A2', 'cast', 'castBolt', false],
    ]);
    // 近战和远程的物理伤害完全相同（同一套公式）
    const hits = ofType(events, 'HitResolved');
    expect(hits[0]!.damage).toBe(hits[1]!.damage);
    expect(hits[0]!.damageType).toBe('physical');
    expect(hits[2]!.damageType).toBe('magic');
  });

  it('一次 stepAction 只结算一个单位的一次出手', () => {
    const { engine } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90, maxHp: 9999 } }),
      makeUnit('A1', 'ally', { stats: { speed: 70, maxHp: 9999 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 80, maxHp: 9999 } }),
      makeUnit('E1', 'enemy', { stats: { speed: 60, maxHp: 9999 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('A1', { kind: 'attack', targetId: 'E1' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' });
    engine.submitCommand('E1', { kind: 'attack', targetId: 'A1' });
    engine.beginExecution();

    const actors: string[] = [];
    while (engine.getState().phase === 'execution') {
      const batch = engine.stepAction()!;
      const starts = ofType(batch, 'UnitActStart');
      const ends = ofType(batch, 'UnitActEnd');
      expect(starts.length).toBe(1);
      expect(ends.length).toBe(1);
      expect(batch[0]!.type).toBe('UnitActStart');
      expect(ends[0]!.actorId).toBe(starts[0]!.actorId);
      // 这次出手里的结算都属于同一个行动者
      for (const h of ofType(batch, 'HitResolved')) expect(h.actorId).toBe(starts[0]!.actorId);
      actors.push(starts[0]!.actorId);
    }
    expect(actors).toEqual(['A0', 'E0', 'A1', 'E1']);
  });

  it('引擎不修改传入的单位对象', () => {
    const a = makeUnit('A0', 'ally', { stats: { speed: 60 } });
    const e = makeUnit('E0', 'enemy', { stats: { speed: 40 } });
    const { engine } = makeEngine([a, e]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' });
    engine.beginExecution();
    runExecution(engine);
    expect(e.hp).toBe(100);
    expect(a.hp).toBe(100);
    expect(engine.getState().units['E0']!.hp).toBe(60);
  });

  it('阶段不对时的调用会被拒绝', () => {
    const { engine } = makeEngine([makeUnit('A0', 'ally'), makeUnit('E0', 'enemy')]);
    // 尚未开始
    expect(engine.submitCommand('A0', { kind: 'defend' })).toEqual({ ok: false, reason: 'wrongPhase' });
    expect(() => engine.stepAction()).toThrow();
    engine.start();
    expect(() => engine.start()).toThrow();
    // 指令阶段不能直接执行
    expect(() => engine.stepAction()).toThrow();
    // 还有单位没下指令时不能进入执行阶段
    engine.submitCommand('A0', { kind: 'defend' });
    expect(() => engine.beginExecution()).toThrow();
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    // 执行阶段不能再下指令
    expect(engine.submitCommand('A0', { kind: 'defend' })).toEqual({ ok: false, reason: 'wrongPhase' });
  });
});

describe('指令', () => {
  it('指令阶段可以重复提交，后一次覆盖前一次', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 60 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 40 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('A0', { kind: 'defend' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    expect(ofType(events, 'HitResolved')).toHaveLength(0);
    expect(ofType(events, 'DefendApplied').map((e) => e.unitId).sort()).toEqual(['A0', 'E0']);
  });

  it('不合法的目标被拒绝：己方单位、不存在的单位', () => {
    const { engine } = makeEngine([
      makeUnit('A0', 'ally'),
      makeUnit('A1', 'ally'),
      makeUnit('E0', 'enemy'),
    ]);
    engine.start();
    expect(engine.submitCommand('A0', { kind: 'attack', targetId: 'A1' })).toEqual({
      ok: false,
      reason: 'invalidTarget',
    });
    expect(engine.submitCommand('A0', { kind: 'attack', targetId: 'NOPE' })).toEqual({
      ok: false,
      reason: 'invalidTarget',
    });
  });

  it('自动出手的单位不接受手动指令，由 AI 普攻残血目标', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 60, maxHp: 1000 }, hp: 900 }),
      makeUnit('A1', 'ally', { stats: { speed: 50, maxHp: 1000 }, hp: 300 }),
      makeUnit('E0', 'enemy', { stats: { speed: 40 }, autoCommand: true }),
    ]);
    engine.start();
    expect(engine.getPendingCommandUnits()).toEqual(['A0', 'A1']);
    expect(engine.submitCommand('E0', { kind: 'defend' })).toEqual({
      ok: false,
      reason: 'notCommandable',
    });
    engine.submitCommand('A0', { kind: 'defend' });
    engine.submitCommand('A1', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    const exec = ofType(events, 'ExecutionPhaseStart')[0]!;
    expect(exec.commands['E0']).toEqual({ kind: 'attack', targetId: 'A1' }); // A1 气血比例最低
  });

  it('待指令顺序：人物 → 他的宝宝 → 下一个人物；开启宝宝自动后只剩人物', () => {
    const hero = (id: string, col: 0 | 1, petId: string) =>
      makeUnit(id, 'ally', { kind: 'hero', slot: { row: 0, col }, petId });
    const pet = (id: string, col: 0 | 1, ownerId: string) =>
      makeUnit(id, 'ally', { kind: 'pet', slot: { row: 1, col }, ownerId });
    const { engine } = makeEngine([
      hero('A1', 1, 'P1'),
      hero('A0', 0, 'P0'),
      pet('P1', 1, 'A1'),
      pet('P0', 0, 'A0'),
      makeUnit('E0', 'enemy', { autoCommand: true }),
    ]);
    engine.start();
    expect(engine.getPendingCommandUnits()).toEqual(['A0', 'P0', 'A1', 'P1']);
    engine.submitCommand('A0', { kind: 'defend' });
    engine.submitCommand('P0', { kind: 'defend' });
    expect(engine.getPendingCommandUnits()).toEqual(['A1', 'P1']);

    engine.setSettings({ petAutoCommand: true });
    expect(engine.getPendingCommandUnits()).toEqual(['A1']);
    expect(engine.submitCommand('P1', { kind: 'defend' })).toEqual({
      ok: false,
      reason: 'notCommandable',
    });
    engine.submitCommand('A1', { kind: 'defend' });
    engine.beginExecution();
    // 宝宝改为自动后，之前手动下的“防御”作废，由 AI 决定（普攻）
    expect(engine.getState().commands['P0']).toEqual({ kind: 'attack', targetId: 'E0' });
  });
});

describe('防御指令', () => {
  it('防御从执行阶段一开始就生效：防御者比攻击者慢也能减伤', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10 } }), // 比 A0 慢
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    // 基础伤害 50 − 10 = 40，防御减半 → 20
    expect(ofType(events, 'HitResolved')[0]).toMatchObject({
      damage: 20,
      defended: true,
      hpBefore: 100,
      hpAfter: 80,
    });
  });

  it('防御只持续一回合：下一回合不防御则受到全额伤害', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    expect(engine.getState().units['E0']!.defending).toBe(false);

    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' });
    engine.beginExecution();
    runExecution(engine);
    const hits = ofType(events, 'HitResolved').filter((h) => h.targetId === 'E0');
    expect(hits.map((h) => [h.damage, h.defended])).toEqual([
      [20, true],
      [40, false],
    ]);
  });
});

describe('HP 管理与死亡', () => {
  it('气血归零即死亡；被击败的敌方消失，之后不再出手、不能被选中', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90, physAtk: 500, maxHp: 9999 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 50 } }), // 会在出手前被打死
      makeUnit('E1', 'enemy', { stats: { speed: 10, maxHp: 9999 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' });
    engine.submitCommand('E1', { kind: 'attack', targetId: 'A0' });
    engine.beginExecution();
    runExecution(engine);

    const hit = ofType(events, 'HitResolved')[0]!;
    expect(hit).toMatchObject({ targetId: 'E0', hpAfter: 0, killed: true });
    expect(ofType(events, 'UnitDied')).toMatchObject([{ unitId: 'E0', killerId: 'A0', vanish: true }]);
    const e0 = engine.getState().units['E0']!;
    expect(e0).toMatchObject({ hp: 0, alive: false });

    // 第 1 回合：E0 排在 A0 之后，已死亡，不出手
    const turn1 = events.filter((e) => e.turn === 1);
    expect(ofType(turn1, 'UnitActStart').map((e) => e.actorId)).toEqual(['A0', 'E1']);

    // 第 2 回合：不在出手顺序里，不能下指令，不能被选为目标
    expect(engine.getState().turnOrder).toEqual(['A0', 'E1']);
    expect(engine.getPendingCommandUnits()).toEqual(['A0', 'E1']);
    expect(engine.submitCommand('E0', { kind: 'defend' })).toEqual({ ok: false, reason: 'unitDead' });
    expect(engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' })).toEqual({
      ok: false,
      reason: 'invalidTarget',
    });
    expect(engine.getCommandOptions('E0')).toEqual({ canAttack: false, canDefend: false, skills: [] });
  });

  it('友方死亡是倒地而不是消失：保留在出手顺序里，但不再出手、不用下指令', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 50 } }),
      makeUnit('A1', 'ally', { stats: { speed: 20, maxHp: 9999 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 90, physAtk: 500, maxHp: 9999 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('A1', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' });
    engine.beginExecution();
    runExecution(engine);

    expect(ofType(events, 'UnitDied')).toMatchObject([{ unitId: 'A0', vanish: false }]);
    expect(ofType(events.filter((e) => e.turn === 1), 'UnitActStart').map((e) => e.actorId)).toEqual([
      'E0',
      'A1',
    ]);
    // 第 2 回合：倒地的 A0 仍在顺序里，但不需要指令
    expect(engine.getState().turnOrder).toEqual(['E0', 'A0', 'A1']);
    expect(engine.getPendingCommandUnits()).toEqual(['A1', 'E0']);
    engine.submitCommand('A1', { kind: 'defend' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A1' });
    engine.beginExecution();
    runExecution(engine);
    expect(
      ofType(events.filter((e) => e.turn === 2), 'UnitActStart').map((e) => e.actorId),
    ).toEqual(['E0', 'A1']);
  });

  it('伤害超过剩余气血时，气血停在 0', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90, physAtk: 99999 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10 } }),
      makeUnit('E1', 'enemy', { stats: { speed: 5 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.submitCommand('E1', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    expect(ofType(events, 'HitResolved')[0]).toMatchObject({ hpBefore: 100, hpAfter: 0 });
    expect(engine.getState().units['E0']!.hp).toBe(0);
  });

  it('普攻未命中时不扣气血', () => {
    // 随机数 0.99 ≥ 命中率 0.95 → 未命中
    const { engine, events } = makeEngine(
      [makeUnit('A0', 'ally', { stats: { speed: 90 } }), makeUnit('E0', 'enemy', { stats: { speed: 10 } })],
      { rng: constRng(0.99) },
    );
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    expect(ofType(events, 'HitResolved')[0]).toMatchObject({
      isMiss: true,
      damage: 0,
      hpAfter: 100,
      killed: false,
    });
  });

  it('引擎中的暴击：伤害乘以暴击倍率并标记 isCrit', () => {
    // 序列：命中、浮动 1.0、暴击
    const { engine, events } = makeEngine(
      [
        makeUnit('A0', 'ally', { stats: { speed: 90 } }),
        makeUnit('E0', 'enemy', { stats: { speed: 10 } }),
      ],
      { rng: seqRng([0, 0.5, 0]) },
    );
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    engine.stepAction();
    // 40 × 1.5（暴击）× 0.5（防御）= 30
    expect(ofType(events, 'HitResolved')[0]).toMatchObject({ isCrit: true, damage: 30 });
  });
});

describe('目标在出手前已死亡', () => {
  it('自动重选：按速度由快到慢取第一个存活敌人', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90, physAtk: 500 } }),
      makeUnit('A1', 'ally', { stats: { speed: 80 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10 } }),
      makeUnit('E1', 'enemy', { stats: { speed: 20, maxHp: 9999 } }),
      makeUnit('E2', 'enemy', { stats: { speed: 30, maxHp: 9999 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('A1', { kind: 'attack', targetId: 'E0' }); // 轮到 A1 时 E0 已死
    for (const id of ['E0', 'E1', 'E2']) engine.submitCommand(id, { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);

    expect(ofType(events, 'TargetRetargeted')).toMatchObject([
      { actorId: 'A1', fromId: 'E0', toId: 'E2' }, // E2 比 E1 快
    ]);
    const a1Hit = ofType(events, 'HitResolved').find((h) => h.actorId === 'A1')!;
    expect(a1Hit.targetId).toBe('E2');
    const a1Cast = ofType(events, 'SkillCast').find((c) => c.actorId === 'A1')!;
    expect(a1Cast.targets).toEqual(['E2']);
  });

  it('没有任何合法目标时判空：出手作废，不产生伤害', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10, maxHp: 9999 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    // 构造防御性场景：把唯一的敌人标记为已死亡（正常流程下此时战斗已结束）
    const e0 = mutable(engine.getState()).units['E0']!;
    e0.alive = false;
    e0.hp = 0;
    const batch = engine.stepAction()!;
    expect(batch.map((e) => e.type).slice(0, 3)).toEqual(['UnitActStart', 'ActionFizzled', 'UnitActEnd']);
    expect(ofType(events, 'HitResolved')).toHaveLength(0);
    expect(ofType(events, 'SkillCast')).toHaveLength(0);
  });
});

describe('MP 管理与技能可用性', () => {
  const caster = (mp: number) =>
    makeUnit('A0', 'ally', {
      stats: { speed: 90, maxMp: 60 },
      mp,
      skillIds: ['test_bolt'], // 消耗 50 魔法
      attackMode: 'cast',
      basicAttackSkillId: 'basic_magic',
    });
  const dummy = () => makeUnit('E0', 'enemy', { stats: { speed: 10, maxHp: 9999 } });

  it('魔法足够时技能可用，出手瞬间一次性扣除魔法', () => {
    const { engine, events } = makeEngine([caster(60), dummy()]);
    engine.start();
    expect(engine.getCommandOptions('A0')).toEqual({
      canAttack: true,
      canDefend: true,
      skills: [{ skillId: 'test_bolt', enabled: true }],
    });
    expect(engine.submitCommand('A0', { kind: 'skill', skillId: 'test_bolt', targetId: 'E0' })).toEqual({
      ok: true,
    });
    engine.submitCommand('E0', { kind: 'defend' });
    // 提交指令时不扣魔法
    expect(engine.getState().units['A0']!.mp).toBe(60);
    engine.beginExecution();
    runExecution(engine);
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({
      skillId: 'test_bolt',
      mpCost: 50,
      mpBefore: 60,
      mpAfter: 10,
    });
    expect(engine.getState().units['A0']!.mp).toBe(10);
  });

  it('魔法不足时技能置灰并被拒绝，只能普攻或防御', () => {
    const { engine } = makeEngine([caster(49), dummy()]);
    engine.start();
    expect(engine.getCommandOptions('A0').skills).toEqual([
      { skillId: 'test_bolt', enabled: false, disabledReason: 'noMp' },
    ]);
    expect(engine.submitCommand('A0', { kind: 'skill', skillId: 'test_bolt', targetId: 'E0' })).toEqual({
      ok: false,
      reason: 'noMp',
    });
    expect(engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' })).toEqual({ ok: true });
    expect(engine.submitCommand('A0', { kind: 'defend' })).toEqual({ ok: true });
  });

  it('魔法为 0 时无法使用技能', () => {
    const { engine } = makeEngine([caster(0), dummy()]);
    engine.start();
    expect(engine.getCommandOptions('A0')).toMatchObject({
      canAttack: true,
      canDefend: true,
      skills: [{ enabled: false, disabledReason: 'noMp' }],
    });
    expect(
      engine.submitCommand('A0', { kind: 'skill', skillId: 'test_bolt', targetId: 'E0' }),
    ).toMatchObject({ ok: false, reason: 'noMp' });
  });

  it('魔法刚好等于消耗时可以使用；用完后下一回合不可用', () => {
    const { engine } = makeEngine([caster(50), dummy()]);
    engine.start();
    expect(engine.submitCommand('A0', { kind: 'skill', skillId: 'test_bolt', targetId: 'E0' })).toEqual({
      ok: true,
    });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    expect(engine.getState().units['A0']!.mp).toBe(0);
    expect(engine.getCommandOptions('A0').skills[0]).toMatchObject({ enabled: false, disabledReason: 'noMp' });
  });

  it('普攻和防御不消耗魔法', () => {
    const { engine, events } = makeEngine([caster(60), dummy()]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({ mpCost: 0, mpBefore: 60, mpAfter: 60 });
  });

  it('不属于该单位的技能、不存在的技能被拒绝', () => {
    const { engine } = makeEngine([makeUnit('A0', 'ally'), dummy()]);
    engine.start();
    expect(
      engine.submitCommand('A0', { kind: 'skill', skillId: 'test_bolt', targetId: 'E0' }),
    ).toEqual({ ok: false, reason: 'unknownSkill' });
    expect(engine.submitCommand('A0', { kind: 'skill', skillId: 'nope', targetId: 'E0' })).toEqual({
      ok: false,
      reason: 'unknownSkill',
    });
  });

  it('被封印的单位技能置灰并被拒绝（封印的施加在步骤 2 实现）', () => {
    const sealed = caster(60);
    sealed.statuses = [{ type: 'seal', remainingTurns: 2, sourceId: 'E0', appliedTurn: 0 }];
    const { engine } = makeEngine([sealed, dummy()]);
    engine.start();
    expect(engine.getCommandOptions('A0').skills[0]).toMatchObject({
      enabled: false,
      disabledReason: 'sealed',
    });
    expect(
      engine.submitCommand('A0', { kind: 'skill', skillId: 'test_bolt', targetId: 'E0' }),
    ).toEqual({ ok: false, reason: 'sealed' });
    expect(engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' })).toEqual({ ok: true });
  });

  it('出手时魔法已不足（防御性分支）：改为普攻，不扣魔法', () => {
    const { engine, events } = makeEngine([caster(60), dummy()]);
    engine.start();
    engine.submitCommand('A0', { kind: 'skill', skillId: 'test_bolt', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.beginExecution();
    mutable(engine.getState()).units['A0']!.mp = 10; // 模拟提交后魔法被削减
    runExecution(engine);
    expect(ofType(events, 'CommandFallback')).toMatchObject([
      { actorId: 'A0', fromSkillId: 'test_bolt', toSkillId: 'basic_magic', reason: 'noMp' },
    ]);
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({ skillId: 'basic_magic', mpAfter: 10 });
  });
});

describe('胜负判定', () => {
  it('敌方全灭：友方获胜，战斗立即结束', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90, physAtk: 500 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' });
    engine.beginExecution();
    const batch = engine.stepAction()!;
    expect(batch.map((e) => e.type)).toEqual([
      'UnitActStart',
      'SkillCast',
      'HitResolved',
      'UnitDied',
      'UnitActEnd',
      'BattleEnd',
    ]);
    expect(ofType(events, 'BattleEnd')[0]).toMatchObject({ winner: 'ally', turns: 1 });
    expect(engine.getState()).toMatchObject({ phase: 'ended', winner: 'ally' });
    // 结束后不再有任何出手、结算或新回合
    expect(engine.stepAction()).toBeNull();
    expect(ofType(events, 'TurnEnd')).toHaveLength(0);
    expect(engine.submitCommand('A0', { kind: 'defend' })).toEqual({ ok: false, reason: 'wrongPhase' });
    expect(engine.getPendingCommandUnits()).toEqual([]);
  });

  it('友方全灭：敌方获胜', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 10 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 90, physAtk: 500 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' });
    engine.beginExecution();
    runExecution(engine);
    expect(ofType(events, 'BattleEnd')[0]).toMatchObject({ winner: 'enemy' });
    expect(engine.getState().winner).toBe('enemy');
    // 倒地的 A0 没有出手
    expect(ofType(events, 'UnitActStart').map((e) => e.actorId)).toEqual(['E0']);
  });

  it('一方还有存活单位时战斗继续', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90, physAtk: 500 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10 } }),
      makeUnit('E1', 'enemy', { stats: { speed: 5 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'defend' });
    engine.submitCommand('E1', { kind: 'defend' });
    engine.beginExecution();
    runExecution(engine);
    expect(ofType(events, 'BattleEnd')).toHaveLength(0);
    expect(engine.getState()).toMatchObject({ phase: 'command', turn: 2, winner: null });
  });
});

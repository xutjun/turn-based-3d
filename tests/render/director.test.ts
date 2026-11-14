import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import { EventBus, type BattleEvent, type BattleEventInput, type UnitSnapshot } from '../../src/core/events';
import type { Side, UnitId } from '../../src/core/types';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { facingOf, slotPosition } from '../../src/data/formation';
import { BattleDirector, groupSteps } from '../../src/render/director/BattleDirector';
import { Scheduler } from '../../src/render/director/Scheduler';
import type { DirectorHud, GroundPoint, Stage, StageUnit } from '../../src/render/director/types';

/** 记录调用的假舞台和假界面：不依赖 three 和 DOM */
function createFakes(scheduler: Scheduler) {
  const log: string[] = [];
  const hp = new Map<UnitId, number>();
  const mp = new Map<UnitId, number>();
  const dead = new Set<UnitId>();
  const away = new Set<UnitId>();
  const units = new Map<UnitId, StageUnit>();
  let active: UnitId | null = null;
  let maxAway = 0;
  const violations: string[] = [];

  const makeUnit = (u: UnitSnapshot): StageUnit => {
    const home = slotPosition(u.side, u.slot);
    const act = (name: string, duration: number): Promise<void> => {
      log.push(`${name}:${u.id}`);
      return scheduler.wait(duration);
    };
    return {
      id: u.id,
      side: u.side,
      kind: u.kind,
      radius: 0.5,
      home,
      facing: facingOf(u.side),
      anchor: () => ({ x: home.x, y: 1, z: home.z }),
      moveTo: (_p: GroundPoint, d: number) => {
        if (active !== u.id) violations.push(`${u.id} 不是出手者却离开了站位`);
        away.add(u.id);
        maxAway = Math.max(maxAway, away.size);
        return act('moveTo', d);
      },
      returnHome: async (d: number) => {
        await act('returnHome', d);
        away.delete(u.id);
      },
      windup: (style, d) => act(`windup-${style}`, d),
      release: (style, d) => act(`release-${style}`, d),
      recover: (d) => act('recover', d),
      hit: (d) => act('hit', d),
      dodge: (d) => act('dodge', d),
      die: (_v, d1, d2) => act('die', d1 + d2),
      revive: (d) => act('revive', d),
      setDefending: (on) => void log.push(`defend:${u.id}:${on}`),
    };
  };

  const stage: Stage = {
    unit: (id) => units.get(id)!,
    projectile: (kind, _a, _b, _c, d) => {
      log.push(`projectile-${kind}`);
      return scheduler.wait(d);
    },
    burst: (kind, _a, _c, d) => {
      log.push(`burst-${kind}`);
      return scheduler.wait(d);
    },
  };
  const hud: DirectorHud = {
    init: (list) => {
      for (const u of list) {
        units.set(u.id, makeUnit(u));
        hp.set(u.id, u.hp);
        mp.set(u.id, u.mp);
      }
    },
    setHp: (id, v) => void hp.set(id, v),
    setMp: (id, v) => void mp.set(id, v),
    setDead: (id, d) => void (d ? dead.add(id) : dead.delete(id)),
    setStatus: (id, s, t) => void log.push(`status:${id}:${s}:${t}`),
    floater: (id, text) => void log.push(`floater:${id}:${text}`),
    setTurn: (turn) => void log.push(`turn:${turn}`),
    setActive: (id) => {
      if (id !== null && active !== null) violations.push(`${id} 开始出手时 ${active} 还没结束`);
      active = id;
    },
    setActed: () => undefined,
    banner: (text) => void log.push(`banner:${text}`),
  };
  return { log, hp, mp, dead, away, stage, hud, violations, maxAway: () => maxAway };
}

/** 不跳过动画时，一边推进调度器一边等 Promise 完成 */
async function pump(scheduler: Scheduler, promise: Promise<void>): Promise<void> {
  let done = false;
  void promise.then(() => (done = true));
  for (let i = 0; i < 100000 && !done; i++) {
    scheduler.update(0.05);
    await new Promise((r) => setImmediate(r));
  }
  if (!done) throw new Error('演出没有结束（卡死）');
}

/** 用自动指令跑完整场战斗，每次出手都等演出结束 */
async function runBattle(seed: number, skip: boolean) {
  const scheduler = new Scheduler();
  scheduler.setSkip(skip);
  const fakes = createFakes(scheduler);
  const engine = new BattleEngine(createDefaultSetup(seed));
  const director = new BattleDirector(engine.events, fakes.stage, fakes.hud, scheduler, {
    skillName: (id) => id,
    isBasicSkill: () => true,
  });
  const idle = (): Promise<void> => (skip ? director.idle() : pump(scheduler, director.idle()));
  const mismatches: string[] = [];
  let eventCount = 0;
  engine.events.onAny(() => (eventCount += 1));

  engine.start();
  await idle();
  while (engine.getState().phase !== 'ended') {
    for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, engine.suggestCommand(id));
    engine.beginExecution();
    await idle();
    while (engine.getState().phase === 'execution') {
      engine.stepAction();
      await idle();
      // 演出追上逻辑后，界面数值必须和逻辑层一致，且没有人留在站位之外
      const state = engine.getState();
      for (const id of state.unitIds) {
        const u = state.units[id]!;
        if (fakes.hp.get(id) !== u.hp) mismatches.push(`${id} hp ${fakes.hp.get(id)} != ${u.hp}`);
        if (fakes.dead.has(id) === u.alive) mismatches.push(`${id} 倒地状态不一致`);
      }
      if (fakes.away.size > 0) mismatches.push(`出手结束后仍有单位离开站位：${[...fakes.away].join(',')}`);
    }
  }
  await idle();
  return { engine, director, fakes, mismatches, eventCount };
}

describe('BattleDirector：整场自动战斗', () => {
  it('跳过动画时能演完整场战斗，界面与逻辑完全一致', async () => {
    const { engine, director, fakes, mismatches, eventCount } = await runBattle(7, true);
    expect(engine.getState().phase).toBe('ended');
    expect(mismatches).toEqual([]);
    expect(fakes.violations).toEqual([]);
    expect(director.stats.concurrentActions).toBe(0);
    expect(director.stats.eventsPlayed).toBe(eventCount); // 每个事件都被演出过，没有遗漏
    expect(director.stats.actions).toBeGreaterThan(50);
    expect(fakes.log.some((l) => l.startsWith('banner:胜利') || l.startsWith('banner:战败'))).toBe(true);
  });

  it('正常播放（不跳过）时同样能演完，不会卡死，且同一时刻最多一个单位离开站位', async () => {
    const { engine, director, fakes, mismatches, eventCount } = await runBattle(11, false);
    expect(engine.getState().phase).toBe('ended');
    expect(mismatches).toEqual([]);
    expect(fakes.violations).toEqual([]);
    expect(fakes.maxAway()).toBe(1);
    expect(director.stats.eventsPlayed).toBe(eventCount);
  });

  it('只有近战会离开站位：弓箭手和施法者从不移动', async () => {
    const { engine, fakes } = await runBattle(3, true);
    const units = engine.getState().units;
    const movers = new Set(fakes.log.filter((l) => l.startsWith('moveTo:')).map((l) => l.split(':')[1]!));
    expect(movers.size).toBeGreaterThan(0);
    for (const id of movers) expect(units[id]!.attackMode, id).toBe('melee');
    // 弓箭手用箭矢，施法者用光弹
    expect(fakes.log).toContain('projectile-arrow');
    expect(fakes.log).toContain('projectile-bolt');
    // 每次冲锋都对应一次返回
    const count = (p: string): number => fakes.log.filter((l) => l.startsWith(p)).length;
    expect(count('returnHome:')).toBe(count('moveTo:'));
  });
});

// ---------------------------------------------------------------------------
// 手工构造的事件序列：多段、多目标、封印、治疗、复活这些事件接口里已有定义的演出路径
// ---------------------------------------------------------------------------

function snapshot(id: UnitId, side: Side, col: 0 | 1 | 2): UnitSnapshot {
  return {
    id,
    templateId: 'test',
    name: id,
    side,
    kind: side === 'ally' ? 'hero' : 'enemy',
    classId: 'physical',
    slot: { row: 0, col },
    attackMode: 'melee',
    stats: { maxHp: 100, maxMp: 50, physAtk: 10, magAtk: 10, defense: 0, speed: 10 },
    hp: 100,
    mp: 50,
  };
}

async function playScript(script: BattleEventInput[]) {
  const scheduler = new Scheduler();
  const fakes = createFakes(scheduler);
  const bus = new EventBus();
  const director = new BattleDirector(bus, fakes.stage, fakes.hud, scheduler, {
    skillName: (id) => `技能<${id}>`,
    isBasicSkill: (id) => id === 'basic',
  });
  const units = [snapshot('A0', 'ally', 0), snapshot('A1', 'ally', 1), snapshot('E0', 'enemy', 0), snapshot('E1', 'enemy', 1), snapshot('E2', 'enemy', 2)];
  let seq = 0;
  const emit = (e: BattleEventInput): void => bus.emit({ ...e, seq: (seq += 1), turn: 1 } as BattleEvent);
  emit({ type: 'BattleStart', units });
  for (const e of script) emit(e);
  await pump(scheduler, director.idle());
  return { fakes, director };
}

const cast = (o: Partial<Extract<BattleEventInput, { type: 'SkillCast' }>>): BattleEventInput => ({
  type: 'SkillCast',
  actorId: 'A0',
  skillId: 'skill',
  delivery: 'melee',
  animation: 'meleeStrike',
  meleeCharge: true,
  element: 'none',
  targets: ['E0'],
  mpCost: 10,
  mpBefore: 50,
  mpAfter: 40,
  ...o,
});
const hit = (targetId: UnitId, stepIndex: number, o: Partial<Extract<BattleEventInput, { type: 'HitResolved' }>> = {}): BattleEventInput => ({
  type: 'HitResolved',
  actorId: 'A0',
  targetId,
  skillId: 'skill',
  stepIndex,
  stepCount: 3,
  hitIndex: 0,
  hitCount: 1,
  damageType: 'physical',
  isMiss: false,
  isCrit: false,
  defended: false,
  damage: 30,
  hpBefore: 100,
  hpAfter: 70,
  killed: false,
  ...o,
});

describe('BattleDirector：多段与多目标技能的演出编排', () => {
  it('同一 stepIndex 的结算分在同一步，不同 stepIndex 分开；死亡跟在所在的步里', () => {
    const events = [
      hit('E0', 0),
      hit('E1', 0, { killed: true, hpAfter: 0 }),
      { type: 'UnitDied', unitId: 'E1', killerId: 'A0', vanish: true } as BattleEventInput,
      hit('E2', 1),
    ].map((e, i) => ({ ...e, seq: i, turn: 1 }) as BattleEvent);
    const steps = groupSteps(events);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.hits.map((h) => h.targetId)).toEqual(['E0', 'E1']);
    expect(steps[0]!.followups).toHaveLength(1);
    expect(steps[1]!.hits.map((h) => h.targetId)).toEqual(['E2']);
  });

  it('连斩：同一目标 3 段只冲锋一次，打完才返回', async () => {
    const { fakes } = await playScript([
      { type: 'UnitActStart', actorId: 'A0', command: { kind: 'skill', skillId: 'skill', targetId: 'E0' } },
      cast({}),
      hit('E0', 0, { hitIndex: 0, hitCount: 3 }),
      hit('E0', 1, { hitIndex: 1, hitCount: 3, hpBefore: 70, hpAfter: 40 }),
      hit('E0', 2, { hitIndex: 2, hitCount: 3, hpBefore: 40, hpAfter: 10, isCrit: true }),
      { type: 'UnitActEnd', actorId: 'A0' },
    ]);
    const moves = fakes.log.filter((l) => l === 'moveTo:A0' || l === 'returnHome:A0');
    expect(moves).toEqual(['moveTo:A0', 'returnHome:A0']);
    expect(fakes.log.filter((l) => l === 'release-melee:A0')).toHaveLength(3);
    expect(fakes.hp.get('E0')).toBe(10);
    expect(fakes.mp.get('A0')).toBe(40);
    expect(fakes.log).toContain('floater:A0:技能<skill>');
    expect(fakes.log).toContain('floater:E0:暴击 -30');
  });

  it('旋风斩：依次冲向每个目标，中途打死的目标倒地，最后返回原位', async () => {
    const { fakes } = await playScript([
      { type: 'UnitActStart', actorId: 'A0', command: { kind: 'skill', skillId: 'skill', targetId: 'E0' } },
      cast({ targets: ['E0', 'E1', 'E2'] }),
      hit('E0', 0),
      hit('E1', 1, { killed: true, hpAfter: 0 }),
      { type: 'UnitDied', unitId: 'E1', killerId: 'A0', vanish: true },
      hit('E2', 2, { isMiss: true, damage: 0, hpAfter: 100 }),
      { type: 'UnitActEnd', actorId: 'A0' },
    ]);
    expect(fakes.log.filter((l) => l === 'moveTo:A0')).toHaveLength(3);
    expect(fakes.log.filter((l) => l === 'returnHome:A0')).toHaveLength(1);
    expect(fakes.dead.has('E1')).toBe(true);
    expect(fakes.log).toContain('die:E1');
    expect(fakes.log).not.toContain('hit:E1'); // 被打死的直接倒地
    expect(fakes.log).toContain('dodge:E2');
    expect(fakes.log).toContain('floater:E2:未命中');
    expect(fakes.hp.get('E2')).toBe(100);
    expect(fakes.away.size).toBe(0);
  });

  it('群体法术：原地施法，所有目标同帧结算，死亡在同一步统一表现', async () => {
    const { fakes } = await playScript([
      { type: 'UnitActStart', actorId: 'A0', command: { kind: 'skill', skillId: 'skill', targetId: 'E0' } },
      cast({ delivery: 'cast', meleeCharge: false, element: 'thunder', targets: ['E0', 'E1', 'E2'] }),
      hit('E0', 0, { damageType: 'magic' }),
      hit('E1', 0, { damageType: 'magic', killed: true, hpAfter: 0 }),
      hit('E2', 0, { damageType: 'magic' }),
      { type: 'UnitDied', unitId: 'E1', killerId: 'A0', vanish: true },
      { type: 'UnitActEnd', actorId: 'A0' },
    ]);
    expect(fakes.log.some((l) => l.startsWith('moveTo:'))).toBe(false);
    expect(fakes.log.filter((l) => l === 'burst-pillarDown')).toHaveLength(3);
    // 三个飘字之间没有夹着任何等待结束后才会出现的记录
    const first = fakes.log.indexOf('floater:E0:-30');
    expect(fakes.log.slice(first, first + 6).filter((l) => l.startsWith('floater:'))).toHaveLength(3);
    expect(fakes.dead.has('E1')).toBe(true);
  });

  it('封印、治疗、复活：原地施法，状态与血条按事件更新，倒地单位起身', async () => {
    const { fakes } = await playScript([
      // 先让 A1 倒地
      { type: 'UnitActStart', actorId: 'E0', command: { kind: 'attack', targetId: 'A1' } },
      cast({ actorId: 'E0', skillId: 'basic', targets: ['A1'], mpCost: 0, mpBefore: 50, mpAfter: 50 }),
      hit('A1', 0, { actorId: 'E0', killed: true, hpAfter: 0, damage: 100 }),
      { type: 'UnitDied', unitId: 'A1', killerId: 'E0', vanish: false },
      { type: 'UnitActEnd', actorId: 'E0' },
      // 封印命中 E0，被 E1 抵抗
      { type: 'UnitActStart', actorId: 'A0', command: { kind: 'skill', skillId: 'seal', targetId: 'E0' } },
      cast({ skillId: 'seal', delivery: 'cast', meleeCharge: false, element: 'seal', targets: ['E0'] }),
      { type: 'StatusApplied', unitId: 'E0', sourceId: 'A0', status: 'seal', remainingTurns: 2 },
      { type: 'UnitActEnd', actorId: 'A0' },
      { type: 'UnitActStart', actorId: 'A0', command: { kind: 'skill', skillId: 'seal', targetId: 'E1' } },
      cast({ skillId: 'seal', delivery: 'cast', meleeCharge: false, element: 'seal', targets: ['E1'], mpBefore: 40, mpAfter: 30 }),
      { type: 'StatusResisted', unitId: 'E1', sourceId: 'A0', status: 'seal' },
      { type: 'UnitActEnd', actorId: 'A0' },
      // 复活 A1
      { type: 'UnitActStart', actorId: 'A0', command: { kind: 'skill', skillId: 'revive', targetId: 'A1' } },
      cast({ skillId: 'revive', delivery: 'cast', meleeCharge: false, element: 'heal', targets: ['A1'], mpBefore: 30, mpAfter: 0 }),
      { type: 'UnitRevived', unitId: 'A1', actorId: 'A0', hpAfter: 30, maxHp: 100, actsThisTurn: true },
      { type: 'UnitActEnd', actorId: 'A0' },
      // 复活后的 A1 被治疗，然后自己出手
      { type: 'UnitActStart', actorId: 'A0', command: { kind: 'skill', skillId: 'heal', targetId: 'A1' } },
      cast({ skillId: 'heal', delivery: 'cast', meleeCharge: false, element: 'heal', targets: ['A1', 'A0'], mpCost: 0, mpBefore: 0, mpAfter: 0 }),
      { type: 'HealResolved', actorId: 'A0', targetId: 'A1', skillId: 'heal', stepIndex: 0, stepCount: 1, isCrit: false, amount: 40, hpBefore: 30, hpAfter: 70 },
      { type: 'HealResolved', actorId: 'A0', targetId: 'A0', skillId: 'heal', stepIndex: 0, stepCount: 1, isCrit: true, amount: 0, hpBefore: 100, hpAfter: 100 },
      { type: 'UnitActEnd', actorId: 'A0' },
      { type: 'UnitActStart', actorId: 'A1', command: { kind: 'attack', targetId: 'E2' } },
      cast({ actorId: 'A1', skillId: 'basic', targets: ['E2'], mpCost: 0, mpBefore: 50, mpAfter: 50 }),
      hit('E2', 0, { actorId: 'A1' }),
      { type: 'UnitActEnd', actorId: 'A1' },
      // 回合结算：封印递减、到期
      { type: 'StatusTicked', unitId: 'E0', status: 'seal', remainingTurns: 1 },
      { type: 'StatusRemoved', unitId: 'E0', status: 'seal', reason: 'expired' },
      { type: 'TurnEnd' },
    ]);
    const { log } = fakes;
    expect(log.some((l) => l.startsWith('moveTo:A0'))).toBe(false); // 施法者全程没有离开站位
    expect(log).toContain('die:A1');
    expect(log).toContain('status:E0:seal:2');
    expect(log).toContain('floater:E0:封印');
    expect(log).toContain('floater:E1:抵抗');
    expect(log).toContain('revive:A1');
    expect(log).toContain('floater:A1:复活');
    expect(log).toContain('burst-pillarUp');
    expect(log).toContain('floater:A1:+40');
    expect(log).toContain('floater:A0:暴击 +0');
    expect(fakes.dead.has('A1')).toBe(false);
    expect(fakes.hp.get('A1')).toBe(70);
    // 复活在倒地之后，复活后的单位能再次冲锋出手
    expect(log.indexOf('revive:A1')).toBeGreaterThan(log.indexOf('die:A1'));
    expect(log.indexOf('moveTo:A1')).toBeGreaterThan(log.indexOf('revive:A1'));
    expect(log).toContain('status:E0:seal:1');
    expect(log).toContain('status:E0:seal:null');
    expect(fakes.violations).toEqual([]);
  });

  it('防御、指令回退、没有目标：只出提示，不移动', async () => {
    const { fakes } = await playScript([
      { type: 'DefendApplied', unitId: 'A0' },
      { type: 'DefendApplied', unitId: 'E1' },
      { type: 'UnitActStart', actorId: 'A0', command: { kind: 'defend' } },
      { type: 'UnitActEnd', actorId: 'A0' },
      { type: 'UnitActStart', actorId: 'A1', command: { kind: 'skill', skillId: 'skill', targetId: 'E0' } },
      { type: 'CommandFallback', actorId: 'A1', fromSkillId: 'skill', toSkillId: 'basic', reason: 'sealed' },
      { type: 'ActionFizzled', actorId: 'A1', skillId: 'basic', reason: 'noValidTarget' },
      { type: 'UnitActEnd', actorId: 'A1' },
      { type: 'TurnEnd' },
    ]);
    expect(fakes.log).toContain('defend:A0:true');
    expect(fakes.log).toContain('defend:E1:true');
    expect(fakes.log).toContain('floater:A1:被封印 · 改为普攻');
    expect(fakes.log).toContain('floater:A1:没有目标');
    expect(fakes.log).toContain('defend:A0:false'); // 回合结束解除防御
    expect(fakes.log.some((l) => l.startsWith('moveTo:'))).toBe(false);
  });
});

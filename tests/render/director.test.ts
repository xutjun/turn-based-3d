import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import { EventBus, type BattleEvent, type BattleEventInput, type UnitSnapshot } from '../../src/core/events';
import type { Side, UnitId } from '../../src/core/types';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { facingOf, slotPosition } from '../../src/data/formation';
import { CAMERA_FX, GLOW_FX } from '../../src/data/presentationConfig';
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
      fxColor: 0xffffff,
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
      release: (style, d, variant = 0) => {
        log.push(`variant:${u.id}:${variant}`);
        return act(`release-${style}`, d);
      },
      recover: (d) => act('recover', d),
      hit: (d) => act('hit', d),
      dodge: (d) => act('dodge', d),
      die: (_v, d1, d2) => act('die', d1 + d2),
      revive: (d) => act('revive', d),
      setDefending: (on) => void log.push(`defend:${u.id}:${on}`),
      setWeaponGlow: (scale) => void log.push(`glow:${u.id}:${scale}`),
      setWeaponColor: (color) => void log.push(`color:${u.id}:${color === null ? 'reset' : 'set'}`),
      setTrail: (on) => void log.push(`trail:${u.id}:${on}`),
      setSealed: (on) => void log.push(`sealed:${u.id}:${on}`),
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
    slash: (_a, variant, _c, d) => {
      log.push(`slash:${variant}`);
      return scheduler.wait(d);
    },
    beam: (_a, _b, _c, travel, linger) => {
      log.push('beam');
      return scheduler.wait(travel + linger);
    },
    aura: (kind, _a, _c, d) => {
      log.push(`aura-${kind}`);
      return scheduler.wait(d);
    },
    camera: {
      focus: (_p, _zoom, _pan, d) => {
        log.push('cam-focus');
        return scheduler.wait(d);
      },
      reset: (d) => {
        log.push('cam-reset');
        return scheduler.wait(d);
      },
      shake: (amount) => void log.push(`cam-shake:${amount}`),
    },
  };
  // 记录顿帧 / 慢镜头
  const warp = scheduler.warp.bind(scheduler);
  scheduler.warp = (factor, duration) => {
    log.push(`warp:${factor}:${duration}`);
    warp(factor, duration);
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
      const waiting = engine.getState().awaitingCommandFor;
      if (waiting !== null) engine.submitCommand(waiting, engine.suggestCommand(waiting));
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
    // 弓箭手用箭矢（普攻 / 三连射）或射向天空的光箭（箭雨），施法者用光弹
    expect(fakes.log.some((l) => l === 'projectile-arrow' || l === 'projectile-skyArrow')).toBe(true);
    expect(fakes.log).toContain('projectile-bolt');
    // 每次离开站位（旋风斩会连续冲向多个目标）都以一次返回结束，返回之前不会有别的单位离开站位
    let away: string | null = null;
    let returns = 0;
    for (const l of fakes.log) {
      const id = l.split(':')[1]!;
      if (l.startsWith('moveTo:')) {
        expect(away === null || away === id, l).toBe(true);
        away = id;
      } else if (l.startsWith('returnHome:')) {
        expect(away, l).toBe(id);
        away = null;
        returns += 1;
      }
    }
    expect(away).toBeNull();
    expect(returns).toBeGreaterThan(0);
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

async function playScript(script: BattleEventInput[], skip = false) {
  const scheduler = new Scheduler();
  scheduler.setSkip(skip);
  const fakes = createFakes(scheduler);
  const bus = new EventBus();
  const director = new BattleDirector(bus, fakes.stage, fakes.hud, scheduler, {
    skillName: (id) => `技能<${id}>`,
    isBasicSkill: (id) => id === 'basic',
  });
  const units = [
    snapshot('A0', 'ally', 0),
    snapshot('A1', 'ally', 1),
    snapshot('A2', 'ally', 2),
    ...(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'] as const).map((id, i) => snapshot(id, 'enemy', i as 0)),
  ];
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
    expect(fakes.log.filter((l) => l === 'burst-thunder')).toHaveLength(3);
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

// ---------------------------------------------------------------------------
// 步骤 7：各技能的专属演出（镜头、特效、顿帧、武器发光）
// ---------------------------------------------------------------------------

const act = (actorId: UnitId, body: BattleEventInput[]): BattleEventInput[] => [
  { type: 'UnitActStart', actorId, command: { kind: 'skill', skillId: 'skill', targetId: 'E0' } },
  ...body,
  { type: 'UnitActEnd', actorId },
];
const died = (unitId: UnitId): BattleEventInput => ({ type: 'UnitDied', unitId, killerId: 'A0', vanish: true });
const ENEMIES = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'] as const;
const { hitStop, shake, slowMo, hitStopFactor } = CAMERA_FX;

describe('步骤 7：技能演出', () => {
  it('连斩：3 击用 3 种不同的挥砍轨迹，武器发光逐击递增，第 3 击抖动和顿帧更大', async () => {
    const { fakes } = await playScript(
      act('A0', [
        cast({ animation: 'comboSlash' }),
        hit('E0', 0, { hitIndex: 0, hitCount: 3 }),
        hit('E0', 1, { hitIndex: 1, hitCount: 3, hpBefore: 70, hpAfter: 40 }),
        hit('E0', 2, { hitIndex: 2, hitCount: 3, hpBefore: 40, hpAfter: 10 }),
      ]),
    );
    const { log } = fakes;
    expect(log.filter((l) => l.startsWith('variant:A0'))).toEqual(['variant:A0:0', 'variant:A0:1', 'variant:A0:2']);
    expect(log.filter((l) => l.startsWith('slash:'))).toEqual(['slash:0', 'slash:1', 'slash:2']);
    // 发光倍率逐击变大，结束后回到 1
    const glows = log.filter((l) => l.startsWith('glow:A0:')).map((l) => Number(l.split(':')[2]));
    expect(glows.slice(0, 3)).toEqual(GLOW_FX.combo);
    expect(GLOW_FX.combo[0]!).toBeLessThan(GLOW_FX.combo[1]!);
    expect(GLOW_FX.combo[1]!).toBeLessThan(GLOW_FX.combo[2]!);
    expect(glows[glows.length - 1]).toBe(1);
    // 每一击都有独立的受击和飘字
    expect(log.filter((l) => l === 'hit:E0')).toHaveLength(3);
    expect(log.filter((l) => l === 'floater:E0:-30')).toHaveLength(3);
    // 前两击轻抖、无顿帧；第 3 击重抖 + 顿帧
    const shakes = log.filter((l) => l.startsWith('cam-shake:'));
    expect(shakes).toEqual([`cam-shake:${shake.hit}`, `cam-shake:${shake.hit}`, `cam-shake:${shake.heavy}`]);
    expect(shake.heavy).toBeGreaterThan(shake.hit);
    expect(log.filter((l) => l.startsWith('warp:'))).toEqual([`warp:${hitStopFactor}:${hitStop.heavy}`]);
    expect(log.filter((l) => l === 'burst-heavyImpact')).toHaveLength(1);
    expect(log.filter((l) => l === 'moveTo:A0')).toHaveLength(1);
    expect(log.filter((l) => l.startsWith('cam-') && !l.startsWith('cam-shake')).pop()).toBe('cam-reset');
  });

  it('连斩：目标中途死亡，剩余段数不演，直接跑回', async () => {
    const { fakes } = await playScript(
      act('A0', [
        cast({ animation: 'comboSlash' }),
        hit('E0', 0, { hitIndex: 0, hitCount: 3 }),
        hit('E0', 1, { hitIndex: 1, hitCount: 3, hpBefore: 70, hpAfter: 0, damage: 70, killed: true }),
        died('E0'),
      ]),
    );
    const { log } = fakes;
    expect(log.filter((l) => l === 'release-melee:A0')).toHaveLength(2);
    expect(log.filter((l) => l.startsWith('slash:'))).toHaveLength(2);
    expect(log).toContain('die:E0');
    expect(log.indexOf('returnHome:A0')).toBeGreaterThan(log.indexOf('die:E0') - 3);
    expect(log).toContain(`warp:${hitStopFactor}:${hitStop.kill}`); // 击杀顿帧
    expect(fakes.away.size).toBe(0);
  });

  it('旋风斩：依次切入 7 个目标，拖尾光轨、镜头跟随，最后一击慢镜头，全部打完才跑回', async () => {
    const { fakes } = await playScript(
      act('A0', [cast({ animation: 'whirlwind', targets: [...ENEMIES] }), ...ENEMIES.map((id, i) => hit(id, i, { stepCount: 7 }))]),
    );
    const { log } = fakes;
    expect(log.filter((l) => l === 'moveTo:A0')).toHaveLength(7);
    expect(log.filter((l) => l === 'returnHome:A0')).toHaveLength(1);
    expect(log.indexOf('returnHome:A0')).toBeGreaterThan(log.lastIndexOf('floater:E6:-30'));
    expect(log).toContain('trail:A0:true');
    expect(log.lastIndexOf('trail:A0:false')).toBeGreaterThan(log.lastIndexOf('trail:A0:true'));
    // 每冲向一个目标镜头就跟一次（外加开场推近和跑回时的一次）
    expect(log.filter((l) => l === 'cam-focus').length).toBeGreaterThanOrEqual(8);
    // 只有最后一击带慢镜头，并且是重击
    expect(log.filter((l) => l === `warp:${slowMo.factor}:${slowMo.duration}`)).toHaveLength(1);
    expect(log.indexOf(`warp:${slowMo.factor}:${slowMo.duration}`)).toBeGreaterThan(log.indexOf('floater:E5:-30'));
    expect(log.filter((l) => l.startsWith('slash:'))).toHaveLength(7);
    expect(log.filter((l) => l.startsWith('floater:E'))).toHaveLength(7);
    expect(fakes.violations).toEqual([]);
    expect(fakes.maxAway()).toBe(1);
  });

  it('旋风斩：存活目标不足 7 个时只演实际结算的那几个', async () => {
    const { fakes } = await playScript(
      act('A0', [cast({ animation: 'whirlwind', targets: ['E0', 'E1', 'E2'] }), hit('E0', 0), hit('E2', 2)]),
    );
    expect(fakes.log.filter((l) => l === 'moveTo:A0')).toHaveLength(2);
    expect(fakes.log.some((l) => l.endsWith(':E1'))).toBe(false); // 没有结算事件的目标不演
  });

  it('箭雨：原地朝天射出一箭，光箭依次落下，每个落点有光圈，射手不离开站位', async () => {
    const { fakes } = await playScript(
      act('A0', [
        cast({ animation: 'arrowRain', delivery: 'ranged', meleeCharge: false, targets: [...ENEMIES] }),
        ...ENEMIES.map((id, i) => hit(id, i, { stepCount: 7, isMiss: i === 3, damage: i === 3 ? 0 : 30, hpAfter: i === 3 ? 100 : 70 })),
      ]),
    );
    const { log } = fakes;
    expect(log.some((l) => l.startsWith('moveTo:'))).toBe(false);
    expect(log).toContain('windup-bowUp:A0');
    expect(log.filter((l) => l === 'projectile-skyArrow')).toHaveLength(1);
    expect(log.filter((l) => l === 'projectile-rainArrow')).toHaveLength(7);
    expect(log.filter((l) => l === 'burst-landing')).toHaveLength(7);
    // 天上的箭先射出去，之后才有箭落下；7 个目标按顺序依次结算
    expect(log.indexOf('projectile-skyArrow')).toBeLessThan(log.indexOf('projectile-rainArrow'));
    const order = log.filter((l) => l.startsWith('floater:E')).map((l) => l.split(':')[1]);
    expect(order).toEqual([...ENEMIES]);
    expect(log).toContain('floater:E3:未命中');
    expect(fakes.hp.get('E3')).toBe(100);
    expect(fakes.hp.get('E6')).toBe(70);
  });

  it('群体法术：蓄力 + 地面符文阵，6 个目标同一帧落雷、同一帧飘字，镜头震动', async () => {
    const six = ENEMIES.slice(0, 6);
    const { fakes } = await playScript(
      act('A0', [
        cast({ animation: 'groupSpell', delivery: 'cast', meleeCharge: false, element: 'thunder', targets: [...six] }),
        ...six.map((id) => hit(id, 0, { stepCount: 1, damageType: 'magic' })),
      ]),
    );
    const { log } = fakes;
    expect(log).toContain('aura-runeCircle');
    expect(log).toContain('aura-charge');
    expect(log).toContain(`glow:A0:${GLOW_FX.spellCharge}`);
    expect(log).toContain('color:A0:set');
    expect(log.lastIndexOf('color:A0:reset')).toBeGreaterThan(log.lastIndexOf('color:A0:set'));
    // 6 道落雷连续出现（同一帧发起）
    const firstBolt = log.indexOf('burst-thunder');
    expect(log.slice(firstBolt, firstBolt + 6)).toEqual(Array(6).fill('burst-thunder'));
    // 符文阵在落雷之前出现
    expect(log.indexOf('aura-runeCircle')).toBeLessThan(firstBolt);
    // 6 个飘字之间没有任何需要等待的动作结束
    const firstFloat = log.indexOf('floater:E0:-30');
    const window = log.slice(firstFloat, log.indexOf('floater:E5:-30') + 1);
    expect(window.filter((l) => l.startsWith('floater:'))).toHaveLength(6);
    expect(window.some((l) => l.startsWith('moveTo') || l.startsWith('projectile') || l.startsWith('windup'))).toBe(false);
    expect(log).toContain(`cam-shake:${shake.spell}`);
  });

  it('封印：锁链射向目标，命中则缠绕并常驻锁链，被抵抗则崩碎；到期或死亡时解除', async () => {
    const { fakes } = await playScript([
      ...act('A0', [
        cast({ animation: 'sealChain', delivery: 'cast', meleeCharge: false, element: 'seal', targets: ['E0'] }),
        { type: 'StatusApplied', unitId: 'E0', sourceId: 'A0', status: 'seal', remainingTurns: 3 },
      ]),
      ...act('A0', [
        cast({ animation: 'sealChain', delivery: 'cast', meleeCharge: false, element: 'seal', targets: ['E1'], mpBefore: 40, mpAfter: 30 }),
        { type: 'StatusResisted', unitId: 'E1', sourceId: 'A0', status: 'seal' },
      ]),
      { type: 'StatusRemoved', unitId: 'E0', status: 'seal', reason: 'expired' },
    ]);
    const { log } = fakes;
    expect(log.filter((l) => l === 'beam')).toHaveLength(2);
    expect(log.filter((l) => l === 'aura-bind')).toHaveLength(1);
    expect(log.filter((l) => l === 'burst-shatter')).toHaveLength(1);
    expect(log).toContain('sealed:E0:true');
    expect(log).not.toContain('sealed:E1:true');
    expect(log).toContain('status:E0:seal:3');
    expect(log.indexOf('sealed:E0:false')).toBeGreaterThan(log.indexOf('sealed:E0:true'));
    expect(log.some((l) => l.startsWith('moveTo:'))).toBe(false);
  });

  it('群体治疗：3 个目标同时升起光柱；复活：光芒降下后单位起身', async () => {
    const heal = (targetId: UnitId): BattleEventInput => ({
      type: 'HealResolved', actorId: 'A0', targetId, skillId: 'heal', stepIndex: 0, stepCount: 1, isCrit: false, amount: 20, hpBefore: 50, hpAfter: 70,
    });
    const { fakes } = await playScript([
      ...act('E0', [
        cast({ actorId: 'E0', skillId: 'basic', targets: ['A1'], mpCost: 0, mpAfter: 50 }),
        hit('A1', 0, { actorId: 'E0', killed: true, hpAfter: 0, damage: 100 }),
        { type: 'UnitDied', unitId: 'A1', killerId: 'E0', vanish: false },
      ]),
      ...act('A0', [
        cast({ animation: 'revive', delivery: 'cast', meleeCharge: false, element: 'heal', targets: ['A1'] }),
        { type: 'UnitRevived', unitId: 'A1', actorId: 'A0', hpAfter: 30, maxHp: 100, actsThisTurn: false },
      ]),
      ...act('A0', [
        cast({ animation: 'groupHeal', delivery: 'cast', meleeCharge: false, element: 'heal', targets: ['A0', 'A1', 'A2'], mpBefore: 40, mpAfter: 30 }),
        heal('A0'),
        heal('A1'),
        heal('A2'),
      ]),
    ]);
    const { log } = fakes;
    expect(log.filter((l) => l === 'burst-reviveLight')).toHaveLength(1);
    expect(log.indexOf('revive:A1')).toBeGreaterThan(log.indexOf('burst-reviveLight'));
    const firstPillar = log.indexOf('burst-pillarUp');
    expect(log.slice(firstPillar, firstPillar + 3)).toEqual(Array(3).fill('burst-pillarUp'));
    const firstHeal = log.indexOf('floater:A0:+20');
    expect(log.slice(firstHeal, firstHeal + 3)).toEqual(['floater:A0:+20', 'floater:A1:+20', 'floater:A2:+20']);
    expect(fakes.hp.get('A1')).toBe(70);
    expect(fakes.dead.has('A1')).toBe(false);
  });

  it('暴击和击杀有顿帧；普通受击只有轻微抖动', async () => {
    const { fakes } = await playScript([
      ...act('A0', [cast({}), hit('E0', 0)]),
      ...act('A0', [cast({ mpBefore: 40, mpAfter: 30 }), hit('E1', 0, { isCrit: true })]),
    ]);
    const { log } = fakes;
    expect(log.filter((l) => l.startsWith('warp:'))).toEqual([`warp:${hitStopFactor}:${hitStop.crit}`]);
    expect(log.filter((l) => l.startsWith('cam-shake:'))).toEqual([`cam-shake:${shake.hit}`, `cam-shake:${shake.crit}`]);
    // 每次出手：先推近，最后复位
    expect(log.filter((l) => l === 'cam-reset')).toHaveLength(2);
    expect(log.indexOf('cam-focus')).toBeLessThan(log.indexOf('moveTo:A0'));
  });

  it('跳过动画时所有技能演出照常结算、不卡住，且结尾状态复原', async () => {
    const six = ENEMIES.slice(0, 6);
    const { fakes, director } = await playScript(
      [
        ...act('A0', [cast({ animation: 'whirlwind', targets: [...ENEMIES] }), ...ENEMIES.map((id, i) => hit(id, i, { stepCount: 7 }))]),
        ...act('A0', [
          cast({ animation: 'arrowRain', delivery: 'ranged', meleeCharge: false, targets: [...ENEMIES], mpBefore: 40, mpAfter: 30 }),
          ...ENEMIES.map((id, i) => hit(id, i, { stepCount: 7, hpBefore: 70, hpAfter: 40 })),
        ]),
        ...act('A0', [
          cast({ animation: 'groupSpell', delivery: 'cast', meleeCharge: false, element: 'thunder', targets: [...six], mpBefore: 30, mpAfter: 20 }),
          ...six.map((id) => hit(id, 0, { stepCount: 1, damageType: 'magic', hpBefore: 40, hpAfter: 0, damage: 40, killed: true })),
          ...six.map(died),
        ]),
      ],
      true,
    );
    expect(director.stats.actions).toBe(3);
    for (const id of six) expect(fakes.dead.has(id)).toBe(true);
    expect(fakes.hp.get('E6')).toBe(40);
    expect(fakes.away.size).toBe(0);
    const { log } = fakes;
    expect(log.lastIndexOf('trail:A0:false')).toBeGreaterThan(log.lastIndexOf('trail:A0:true'));
    expect(log.filter((l) => l.startsWith('glow:A0:')).pop()).toBe('glow:A0:1');
    expect(log.filter((l) => l.startsWith('cam-')).pop()).toBe('cam-reset');
  });
});

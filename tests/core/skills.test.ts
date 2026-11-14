import { describe, expect, it } from 'vitest';
import type { BattleEngine } from '../../src/core/battle';
import type { BattleEvent, BattleEventInput } from '../../src/core/events';
import { executeSkill } from '../../src/core/skillExecutor';
import type { BattleState, Command, SkillDef, Unit } from '../../src/core/types';
import { SKILLS } from '../../src/data/skills';
import { constRng, makeEngine, makeUnit, ofType, runExecution, seqRng, TEST_CONFIG } from '../helpers';

// 步骤 2：技能结算。技能用正式技能表（data/skills.ts），单位用测试单位：
// 气血 100、物伤 50、法伤 50、防御 10；随机数恒为 0.5 时必中、浮动 1.0、不暴击。
// 所以：普攻 40，连斩每段 50×0.6−10 = 20，旋风斩 50×0.7−10 = 25，群体法术 50×0.8−5 = 35，治疗 50。

type Extra = Parameters<typeof makeUnit>[2];
const ally = (id: string, speed: number, extra: Extra = {}): Unit =>
  makeUnit(id, 'ally', { ...extra, stats: { speed, maxMp: 200, ...extra?.stats } });
const foe = (id: string, speed: number, extra: Extra = {}): Unit =>
  makeUnit(id, 'enemy', { ...extra, stats: { speed, ...extra?.stats } });
const fallen: Extra = { hp: 0, alive: false };
const sealedFor = (turns: number): Extra => ({
  statuses: [{ type: 'seal', remainingTurns: turns, sourceId: 'X', appliedTurn: 1 }],
});

const start = (units: Unit[], rng = constRng(0.5), skills: Record<string, SkillDef> = SKILLS) => {
  const made = makeEngine(units, { rng, setup: { skills } });
  made.engine.start();
  return made;
};

/** 给所有待指令单位下指令（没写的单位普攻对方第一个存活单位），并进入执行阶段 */
function command(engine: BattleEngine, commands: Record<string, Command>): void {
  const state = engine.getState();
  for (const id of engine.getPendingCommandUnits()) {
    const self = state.units[id]!;
    const firstFoe = state.unitIds.find((x) => state.units[x]!.side !== self.side && state.units[x]!.alive)!;
    const r = engine.submitCommand(id, commands[id] ?? { kind: 'attack', targetId: firstFoe });
    if (!r.ok) throw new Error(`指令被拒绝：${id} ${r.reason}`);
  }
  engine.beginExecution();
}

/** 下指令并只结算第一个出手者（测试里把要观察的单位设成速度最快） */
function actFirst(engine: BattleEngine, commands: Record<string, Command>): BattleEvent[] {
  command(engine, commands);
  return engine.stepAction()!;
}

const skill = (skillId: string, targetId: string): Command => ({ kind: 'skill', skillId, targetId });
const types = (events: BattleEvent[]): string[] => events.map((e) => e.type);

// ----------------------------------------------------------------------
describe('连斩 / 三连射（单体三连击）', () => {
  it('对同一目标造成 3 次独立伤害，魔法只扣一次', () => {
    const { engine } = start([ally('A0', 90, { skillIds: ['combo_slash'] }), foe('E0', 10)]);
    const events = actFirst(engine, { A0: skill('combo_slash', 'E0') });
    const cast = ofType(events, 'SkillCast');
    expect(cast).toHaveLength(1);
    expect(cast[0]).toMatchObject({
      skillId: 'combo_slash',
      delivery: 'melee',
      animation: 'comboSlash',
      meleeCharge: true,
      targets: ['E0'],
      mpCost: 40,
      mpBefore: 200,
      mpAfter: 160,
    });
    const hits = ofType(events, 'HitResolved');
    expect(hits.map((h) => [h.targetId, h.stepIndex, h.hitIndex, h.stepCount, h.hitCount, h.damage])).toEqual([
      ['E0', 0, 0, 3, 3, 20],
      ['E0', 1, 1, 3, 3, 20],
      ['E0', 2, 2, 3, 3, 20],
    ]);
    expect(hits.map((h) => h.hpAfter)).toEqual([80, 60, 40]);
    expect(engine.getState().units['A0']!.mp).toBe(160);
  });

  it('每一段独立判定暴击和浮动', () => {
    // 每段依次消耗：命中、浮动、暴击
    const rng = seqRng([0.5, 0.5, 0.05, 0.5, 0, 0.5, 0.5, 0.999, 0.5]);
    const { engine } = start([ally('A0', 90, { skillIds: ['combo_slash'] }), foe('E0', 10)], rng);
    const hits = ofType(actFirst(engine, { A0: skill('combo_slash', 'E0') }), 'HitResolved');
    expect(hits.map((h) => h.isCrit)).toEqual([true, false, false]);
    expect(hits.map((h) => h.damage)).toEqual([30, 18, 22]); // 20×1.5、20×0.9、20×1.1
    expect(rng.used()).toBe(9);
  });

  it('目标中途死亡：剩余段数取消，死亡事件紧跟致死的那一段', () => {
    const { engine } = start([
      ally('A0', 90, { skillIds: ['combo_slash'] }),
      foe('E0', 20, { hp: 30 }),
      foe('E1', 10),
    ]);
    const events = actFirst(engine, { A0: skill('combo_slash', 'E0') });
    expect(types(events)).toEqual(['UnitActStart', 'SkillCast', 'HitResolved', 'HitResolved', 'UnitDied', 'UnitActEnd']);
    const hits = ofType(events, 'HitResolved');
    expect(hits).toHaveLength(2); // 第 3 段没有发生
    expect(hits[1]).toMatchObject({ hitIndex: 1, hitCount: 3, hpAfter: 0, killed: true });
    expect(engine.getState().units['E1']!.hp).toBe(100); // 剩余段数不会转给别的目标
    expect(engine.getState().units['A0']!.mp).toBe(160); // 魔法照常扣一次
  });

  it('第一段就打死目标时只有一段', () => {
    const { engine } = start([ally('A0', 90, { skillIds: ['combo_slash'] }), foe('E0', 20, { hp: 5 }), foe('E1', 10)]);
    expect(ofType(actFirst(engine, { A0: skill('combo_slash', 'E0') }), 'HitResolved')).toHaveLength(1);
  });

  it('弓箭手的三连射：原地射击，不冲锋，同样是 3 次独立的物理伤害', () => {
    const { engine } = start([
      ally('A0', 90, { attackMode: 'ranged', skillIds: ['triple_shot'] }),
      foe('E0', 10),
    ]);
    const events = actFirst(engine, { A0: skill('triple_shot', 'E0') });
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({
      skillId: 'triple_shot',
      delivery: 'ranged',
      animation: 'tripleShot',
      meleeCharge: false,
    });
    const hits = ofType(events, 'HitResolved');
    expect(hits.map((h) => h.damage)).toEqual([20, 20, 20]); // 与近战连斩同一套物理公式
    expect(hits.every((h) => h.damageType === 'physical')).toBe(true);
  });
});

// ----------------------------------------------------------------------
describe('旋风斩 / 箭雨（依次攻击最多 7 个）', () => {
  // E0..E9 速度 10..19：速度顺序为 E9, E8, …, E0
  const tenFoes = (): Unit[] => Array.from({ length: 10 }, (_, i) => foe(`E${i}`, 10 + i));

  it('10 个敌人时依次攻击 7 个：主目标第一，其余按速度由快到慢；每个目标独立一步', () => {
    const { engine } = start([ally('A0', 90, { skillIds: ['whirlwind'] }), ...tenFoes()]);
    expect(engine.previewTargets('A0', 'whirlwind', 'E3')).toEqual(['E3', 'E9', 'E8', 'E7', 'E6', 'E5', 'E4']);
    const events = actFirst(engine, { A0: skill('whirlwind', 'E3') });
    const cast = ofType(events, 'SkillCast')[0]!;
    expect(cast.targets).toEqual(['E3', 'E9', 'E8', 'E7', 'E6', 'E5', 'E4']);
    expect(cast).toMatchObject({ animation: 'whirlwind', meleeCharge: true, mpCost: 80, mpAfter: 120 });
    const hits = ofType(events, 'HitResolved');
    expect(hits.map((h) => h.targetId)).toEqual(cast.targets);
    expect(hits.map((h) => h.stepIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(hits.every((h) => h.stepCount === 7 && h.hitCount === 1 && h.damage === 25)).toBe(true);
    // 没被选中的 3 个敌人不受伤害；魔法只扣一次
    for (const id of ['E0', 'E1', 'E2']) expect(engine.getState().units[id]!.hp).toBe(100);
    expect(ofType(events, 'SkillCast')).toHaveLength(1);
    expect(engine.getState().units['A0']!.mp).toBe(120);
  });

  it('存活敌人不足 7 个时全部打一遍', () => {
    const { engine } = start([ally('A0', 90, { skillIds: ['whirlwind'] }), ...tenFoes().slice(0, 4)]);
    expect(engine.previewTargets('A0', 'whirlwind', 'E1')).toEqual(['E1', 'E3', 'E2', 'E0']);
    const events = actFirst(engine, { A0: skill('whirlwind', 'E1') });
    const hits = ofType(events, 'HitResolved');
    expect(hits.map((h) => h.targetId)).toEqual(['E1', 'E3', 'E2', 'E0']);
    expect(hits.every((h) => h.stepCount === 4)).toBe(true);
    expect(engine.getState().units['A0']!.mp).toBe(120);
  });

  it('只剩 1 个敌人时只打 1 次；已被击败的敌人不会被选中', () => {
    const { engine } = start([
      ally('A0', 90, { skillIds: ['whirlwind'] }),
      foe('E0', 10),
      foe('E1', 20, fallen),
    ]);
    const hits = ofType(actFirst(engine, { A0: skill('whirlwind', 'E0') }), 'HitResolved');
    expect(hits.map((h) => h.targetId)).toEqual(['E0']);
  });

  it('每个目标独立判定：致死的那一步之后紧跟死亡事件，其余目标照常结算', () => {
    const foes = tenFoes().slice(0, 3);
    foes[2]!.hp = 10; // E2（速度最快）一击即倒
    const { engine } = start([ally('A0', 90, { skillIds: ['whirlwind'] }), ...foes]);
    const events = actFirst(engine, { A0: skill('whirlwind', 'E0') });
    expect(types(events)).toEqual([
      'UnitActStart',
      'SkillCast',
      'HitResolved', // E0
      'HitResolved', // E2
      'UnitDied',
      'HitResolved', // E1
      'UnitActEnd',
    ]);
  });

  it('轮到某个目标时它已经死亡：直接跳过，不发事件、不补位', () => {
    const { engine } = start([ally('A0', 90, { skillIds: ['whirlwind'] }), ...tenFoes().slice(0, 3)]);
    const state = engine.getState() as BattleState;
    state.units['E1']!.alive = false; // 模拟“列表确定之后、轮到它之前死亡”
    state.units['E1']!.hp = 0;
    const out: BattleEventInput[] = [];
    executeSkill(
      { state, config: TEST_CONFIG, rng: constRng(0.5), emit: (e) => out.push(e) },
      state.units['A0']!,
      SKILLS['whirlwind']!,
      ['E0', 'E1', 'E2'],
    );
    const hits = out.filter((e) => e.type === 'HitResolved');
    expect(hits.map((h) => [h.targetId, h.stepIndex, h.stepCount])).toEqual([
      ['E0', 0, 3],
      ['E2', 2, 3],
    ]);
  });

  it('攻击顺序可配置为从左到右：主目标之后按列，同列前排在先', () => {
    const skills = { ...SKILLS, whirlwind: { ...SKILLS['whirlwind']!, sequenceOrder: 'leftToRight' as const } };
    const { engine } = start(
      [
        ally('A0', 90, { skillIds: ['whirlwind'] }),
        foe('E0', 10, { slot: { row: 1, col: 2 } }),
        foe('E1', 11, { slot: { row: 0, col: 2 } }),
        foe('E2', 12, { slot: { row: 0, col: 4 } }),
        foe('E3', 13, { slot: { row: 0, col: 0 } }),
      ],
      constRng(0.5),
      skills,
    );
    expect(engine.previewTargets('A0', 'whirlwind', 'E2')).toEqual(['E2', 'E3', 'E1', 'E0']);
  });

  it('弓箭手的箭雨：原地依次射向 7 个目标', () => {
    const { engine } = start([
      ally('A0', 90, { attackMode: 'ranged', skillIds: ['arrow_rain'] }),
      ...tenFoes(),
    ]);
    const events = actFirst(engine, { A0: skill('arrow_rain', 'E0') });
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({ delivery: 'ranged', animation: 'arrowRain', meleeCharge: false });
    expect(ofType(events, 'HitResolved')).toHaveLength(7);
  });
});

// ----------------------------------------------------------------------
describe('群体法术（同时攻击最多 6 个）', () => {
  const foes = (n: number): Unit[] => Array.from({ length: n }, (_, i) => foe(`E${i}`, 10 + i));
  const mage = (): Unit => ally('A0', 90, { skillIds: ['group_spell'], attackMode: 'cast', basicAttackSkillId: 'basic_magic' });

  it('10 个敌人时同时命中 6 个：全部是同一步，按法术公式各自结算，魔法只扣一次', () => {
    const { engine } = start([mage(), ...foes(10)]);
    const events = actFirst(engine, { A0: skill('group_spell', 'E0') });
    const cast = ofType(events, 'SkillCast')[0]!;
    expect(cast.targets).toEqual(['E0', 'E9', 'E8', 'E7', 'E6', 'E5']);
    expect(cast).toMatchObject({ delivery: 'cast', animation: 'groupSpell', element: 'thunder', meleeCharge: false, mpAfter: 120 });
    const hits = ofType(events, 'HitResolved');
    expect(hits.map((h) => h.targetId)).toEqual(cast.targets);
    expect(hits.every((h) => h.stepIndex === 0 && h.stepCount === 1 && h.damageType === 'magic' && h.damage === 35)).toBe(true);
    expect(engine.getState().units['A0']!.mp).toBe(120);
  });

  it('存活敌人不足 6 个时全部命中', () => {
    const { engine } = start([mage(), ...foes(4)]);
    expect(engine.previewTargets('A0', 'group_spell', 'E2')).toEqual(['E2', 'E3', 'E1', 'E0']);
    const hits = ofType(actFirst(engine, { A0: skill('group_spell', 'E2') }), 'HitResolved');
    expect(hits.map((h) => h.targetId)).toEqual(['E2', 'E3', 'E1', 'E0']);
    expect(engine.getState().units['A0']!.mp).toBe(120);
  });

  it('同帧结算：所有命中都发出之后才统一发出死亡事件', () => {
    const units = foes(3);
    units[0]!.hp = 10;
    units[2]!.hp = 10;
    const { engine } = start([mage(), ...units]);
    const events = actFirst(engine, { A0: skill('group_spell', 'E1') });
    expect(types(events)).toEqual([
      'UnitActStart',
      'SkillCast',
      'HitResolved',
      'HitResolved',
      'HitResolved',
      'UnitDied',
      'UnitDied',
      'UnitActEnd',
    ]);
    expect(ofType(events, 'UnitDied').map((d) => d.unitId)).toEqual(['E2', 'E0']);
  });

  it('每个目标独立判定暴击', () => {
    // 3 个目标，每个依次消耗：命中、浮动、暴击（测试配置的法术暴击率 0.2、倍率 2）
    const rng = seqRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0.5, 0.5, 0.5]);
    const { engine } = start([mage(), ...foes(3)], rng);
    const hits = ofType(actFirst(engine, { A0: skill('group_spell', 'E0') }), 'HitResolved');
    expect(hits.map((h) => [h.targetId, h.isCrit, h.damage])).toEqual([
      ['E0', false, 35],
      ['E2', true, 70],
      ['E1', false, 35],
    ]);
  });

  it('一次打光全部敌人：战斗结束', () => {
    const units = foes(2).map((u) => ({ ...u, hp: 5 }));
    const { engine } = start([mage(), ...units]);
    const events = actFirst(engine, { A0: skill('group_spell', 'E0') });
    expect(events.at(-1)).toMatchObject({ type: 'BattleEnd', winner: 'ally' });
  });

  it('群体法术·烈焰是同一种技能的火系版本', () => {
    const { engine } = start([ally('A0', 90, { skillIds: ['group_spell_fire'] }), ...foes(8)]);
    const events = actFirst(engine, { A0: skill('group_spell_fire', 'E0') });
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({ animation: 'groupSpell', element: 'fire', mpCost: 80 });
    expect(ofType(events, 'HitResolved')).toHaveLength(6);
  });
});

// ----------------------------------------------------------------------
describe('群体治疗（同时治疗最多 3 个）', () => {
  const healer = (extra: Extra = {}): Unit => ally('A0', 90, { skillIds: ['group_heal', 'revive'], ...extra });

  it('治疗主目标和按速度补足的 2 个存活友军，同一步结算，不超过气血上限', () => {
    const { engine } = start([
      healer({ hp: 20 }),
      ally('A1', 80, { hp: 30 }),
      ally('A2', 70, { hp: 40 }),
      ally('A3', 60, { hp: 90 }),
      foe('E0', 10),
    ]);
    expect(engine.previewTargets('A0', 'group_heal', 'A3')).toEqual(['A3', 'A0', 'A1']);
    const events = actFirst(engine, { A0: skill('group_heal', 'A3') });
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({ animation: 'groupHeal', element: 'heal', targets: ['A3', 'A0', 'A1'], mpAfter: 120 });
    const heals = ofType(events, 'HealResolved');
    expect(heals.map((h) => [h.targetId, h.amount, h.hpBefore, h.hpAfter])).toEqual([
      ['A3', 10, 90, 100], // 治疗量 50，只缺 10
      ['A0', 50, 20, 70],
      ['A1', 50, 30, 80],
    ]);
    expect(heals.every((h) => h.stepIndex === 0 && h.stepCount === 1)).toBe(true);
    expect(engine.getState().units['A2']!.hp).toBe(40); // 没被选中
    expect(engine.getState().units['A0']!.mp).toBe(120); // 只扣一次
  });

  it('存活友军少于 3 个时只治疗存活的；倒地的友军不会被治疗', () => {
    const { engine } = start([healer({ hp: 50 }), ally('A1', 80, { hp: 50 }), ally('A2', 70, fallen), foe('E0', 10)]);
    expect(engine.previewTargets('A0', 'group_heal', 'A1')).toEqual(['A1', 'A0']);
    const heals = ofType(actFirst(engine, { A0: skill('group_heal', 'A1') }), 'HealResolved');
    expect(heals.map((h) => h.targetId)).toEqual(['A1', 'A0']);
    expect(engine.getState().units['A2']).toMatchObject({ hp: 0, alive: false });
    expect(engine.submitCommand('A0', skill('group_heal', 'A2'))).toMatchObject({ ok: false }); // 执行阶段也不能再下指令
  });

  it('只剩施法者自己时只治疗自己；不能选倒地的友军或敌人', () => {
    const { engine } = start([healer({ hp: 10 }), ally('A1', 80, fallen), foe('E0', 10)]);
    expect(engine.submitCommand('A0', skill('group_heal', 'A1'))).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(engine.submitCommand('A0', skill('group_heal', 'E0'))).toEqual({ ok: false, reason: 'invalidTarget' });
    const heals = ofType(actFirst(engine, { A0: skill('group_heal', 'A0') }), 'HealResolved');
    expect(heals.map((h) => [h.targetId, h.hpAfter])).toEqual([['A0', 60]]);
  });

  it('治疗可以暴击，每个目标独立判定，不消耗命中随机数', () => {
    // 每个目标依次消耗：浮动、暴击（治疗暴击率 0.1、倍率 1.5）
    const rng = seqRng([0.5, 0.05, 0.5, 0.5]);
    const { engine } = start(
      [healer({ hp: 1, stats: { maxHp: 1000 } }), ally('A1', 80, { hp: 1, stats: { maxHp: 1000 } }), foe('E0', 10)],
      rng,
    );
    const heals = ofType(actFirst(engine, { A0: skill('group_heal', 'A0') }), 'HealResolved');
    expect(heals.map((h) => [h.isCrit, h.amount])).toEqual([
      [true, 75],
      [false, 50],
    ]);
    expect(rng.used()).toBe(4);
  });

  it('出手时主目标已倒地：改为治疗速度最快的存活友军', () => {
    const { engine } = start([
      ally('A0', 50, { skillIds: ['group_heal'], hp: 60 }),
      ally('A1', 40, { hp: 10 }),
      foe('E0', 90, { stats: { physAtk: 500 } }),
    ]);
    command(engine, { A0: skill('group_heal', 'A1'), E0: { kind: 'attack', targetId: 'A1' } });
    const events = runExecution(engine);
    expect(ofType(events, 'TargetRetargeted')[0]).toMatchObject({ actorId: 'A0', fromId: 'A1', toId: 'A0' });
    expect(ofType(events, 'HealResolved').map((h) => h.targetId)).toEqual(['A0']);
  });
});

// ----------------------------------------------------------------------
describe('复活', () => {
  const healer = (speed: number, extra: Extra = {}): Unit => ally('A0', speed, { skillIds: ['group_heal', 'revive'], ...extra });

  it('只能选倒地的友军：存活的友军、敌人、施法者自己都被拒绝', () => {
    const { engine } = start([healer(90), ally('A1', 80), ally('A2', 70, fallen), foe('E0', 10)]);
    expect(engine.submitCommand('A0', skill('revive', 'A1'))).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(engine.submitCommand('A0', skill('revive', 'A0'))).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(engine.submitCommand('A0', skill('revive', 'E0'))).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(engine.previewTargets('A0', 'revive', 'A1')).toEqual([]);
    expect(engine.submitCommand('A0', skill('revive', 'A2'))).toEqual({ ok: true });
    expect(engine.previewTargets('A0', 'revive', 'A2')).toEqual(['A2']); // 不扩展目标
  });

  it('复活后恢复 30% 气血，魔法保持倒地时的值，不带封印', () => {
    const { engine } = start([
      healer(90),
      ally('A1', 95, { ...fallen, mp: 33, stats: { maxHp: 1000 } }),
      ally('A2', 60, fallen),
      foe('E0', 10),
    ]);
    const events = actFirst(engine, { A0: skill('revive', 'A1') });
    expect(types(events)).toEqual(['UnitActStart', 'SkillCast', 'UnitRevived', 'UnitActEnd']);
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({ animation: 'revive', targets: ['A1'], mpCost: 120, mpAfter: 80 });
    expect(ofType(events, 'UnitRevived')[0]).toMatchObject({ unitId: 'A1', actorId: 'A0', hpAfter: 300, maxHp: 1000 });
    expect(engine.getState().units['A1']).toMatchObject({ hp: 300, mp: 33, alive: true, statuses: [], defending: false });
    expect(engine.getState().units['A2']!.alive).toBe(false); // 只复活选中的那一个
  });

  it('被复活者排在施法者之后：本回合轮到它时暂停，现场下指令后出手', () => {
    const { engine } = start([healer(90), ally('A1', 50, fallen), foe('E0', 70), foe('E1', 10)]);
    expect(engine.getPendingCommandUnits()).not.toContain('A1'); // 倒地时不用下指令
    const first = actFirst(engine, { A0: skill('revive', 'A1') });
    expect(ofType(first, 'UnitRevived')[0]!.actsThisTurn).toBe(true);

    expect(types(engine.stepAction()!)[0]).toBe('UnitActStart'); // E0 出手
    // 轮到 A1：没有指令，暂停
    const paused = engine.stepAction()!;
    expect(types(paused)).toEqual(['CommandRequested']);
    expect(engine.getState().awaitingCommandFor).toBe('A1');
    expect(() => engine.stepAction()).toThrow();
    // 现场下指令：校验规则与指令阶段相同，别的单位不能趁机下指令
    expect(engine.submitCommand('A0', { kind: 'defend' })).toEqual({ ok: false, reason: 'wrongPhase' });
    expect(engine.submitCommand('A1', { kind: 'attack', targetId: 'A0' })).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(engine.submitCommand('A1', { kind: 'attack', targetId: 'E1' })).toEqual({ ok: true });
    expect(engine.getState().awaitingCommandFor).toBeNull();
    const acted = engine.stepAction()!;
    expect(acted[0]).toMatchObject({ type: 'UnitActStart', actorId: 'A1' });
    expect(ofType(acted, 'HitResolved')[0]).toMatchObject({ actorId: 'A1', targetId: 'E1' });
  });

  it('被复活者排在施法者之前：本回合不出手，下一回合正常下指令并出手', () => {
    const { engine } = start([healer(50), ally('A1', 90, fallen), foe('E0', 10, { stats: { maxHp: 9999 } })]);
    command(engine, { A0: skill('revive', 'A1') });
    const events = runExecution(engine);
    expect(ofType(events, 'UnitRevived')[0]!.actsThisTurn).toBe(false);
    expect(ofType(events, 'CommandRequested')).toHaveLength(0);
    expect(ofType(events, 'UnitActStart').map((e) => e.actorId)).toEqual(['A0', 'E0']);
    // 下一回合：重新参与排序和下指令
    expect(engine.getState().turn).toBe(2);
    expect(engine.getPendingCommandUnits()).toContain('A1');
    command(engine, {});
    const next = runExecution(engine);
    expect(ofType(next, 'UnitActStart').map((e) => e.actorId)).toEqual(['A1', 'A0', 'E0']);
    expect(ofType(next, 'HitResolved')[0]).toMatchObject({ actorId: 'A1', targetId: 'E0' });
  });

  it('自动出手的宝宝被复活后由 AI 现场决定，不暂停', () => {
    const { engine } = start([
      healer(90),
      ally('A1', 50, { ...fallen, kind: 'pet', autoCommand: true }),
      foe('E0', 10, { stats: { maxHp: 9999 } }),
    ]);
    command(engine, { A0: skill('revive', 'A1') });
    const events = runExecution(engine);
    expect(ofType(events, 'CommandRequested')).toHaveLength(0);
    expect(ofType(events, 'UnitActStart').map((e) => e.actorId)).toEqual(['A0', 'A1', 'E0']);
  });

  it('本回合内先倒地、再被复活：原来的指令作废，轮到时重新下指令', () => {
    const { engine } = start([
      healer(80),
      ally('A1', 50, { hp: 10 }),
      foe('E0', 90, { stats: { physAtk: 500, maxHp: 9999 } }),
    ]);
    // 第 1 回合：A1 被打倒，它已提交的指令随之作废
    command(engine, { E0: { kind: 'attack', targetId: 'A1' } });
    runExecution(engine);
    expect(engine.getState().units['A1']!.alive).toBe(false);
    command(engine, { A0: skill('revive', 'A1'), E0: { kind: 'defend' } });
    engine.stepAction(); // E0
    engine.stepAction(); // A0 复活 A1
    expect(types(engine.stepAction()!)).toEqual(['CommandRequested']);
    expect(engine.getState().commands['A1']).toBeUndefined();
    expect(engine.submitCommand('A1', { kind: 'defend' })).toEqual({ ok: true });
    expect(types(engine.stepAction()!).slice(0, 2)).toEqual(['UnitActStart', 'UnitActEnd']);
  });

  it('出手时目标已被别人复活：不重选，出手作废，不扣魔法', () => {
    const { engine } = start([
      healer(90),
      ally('A1', 80, { skillIds: ['revive'] }),
      ally('A2', 95, fallen),
      ally('A3', 94, fallen),
      foe('E0', 10),
    ]);
    command(engine, { A0: skill('revive', 'A2'), A1: skill('revive', 'A2') });
    engine.stepAction(); // A0 复活 A2
    const events = engine.stepAction()!; // A1 的目标已经站起来了
    expect(types(events)).toEqual(['UnitActStart', 'ActionFizzled', 'UnitActEnd']);
    expect(engine.getState().units['A1']!.mp).toBe(200);
    expect(engine.getState().units['A3']!.alive).toBe(false); // 不会改去复活别人
  });

  it('被复活的单位重新计入胜负：友方只剩它时战斗继续', () => {
    const { engine } = start([
      healer(90, { hp: 1 }),
      ally('A1', 95, fallen),
      foe('E0', 50, { stats: { maxHp: 9999 } }),
    ]);
    command(engine, { A0: skill('revive', 'A1'), E0: { kind: 'attack', targetId: 'A0' } });
    const events = runExecution(engine);
    expect(ofType(events, 'UnitDied').map((d) => d.unitId)).toEqual(['A0']);
    expect(engine.getState().phase).toBe('command');
    expect(engine.getPendingCommandUnits()).toEqual(['A1', 'E0']); // 测试里敌方也手动下指令
  });
});

// ----------------------------------------------------------------------
describe('封印', () => {
  const sealer = (extra: Extra = {}): Unit => ally('A0', 90, { skillIds: ['seal'], ...extra });
  const caster = (id: string, speed: number, extra: Extra = {}): Unit =>
    foe(id, speed, { skillIds: ['single_spell'], ...extra, stats: { maxMp: 200, maxHp: 9999, ...extra?.stats } });

  it('命中：目标被封印 3 回合，技能置灰并被拒绝，仍可普攻和防御', () => {
    const { engine } = start([sealer(), caster('E0', 10)]);
    const events = actFirst(engine, { A0: skill('seal', 'E0') });
    expect(types(events)).toEqual(['UnitActStart', 'SkillCast', 'StatusApplied', 'UnitActEnd']);
    expect(ofType(events, 'SkillCast')[0]).toMatchObject({ animation: 'sealChain', element: 'seal', targets: ['E0'], mpAfter: 140 });
    expect(ofType(events, 'StatusApplied')[0]).toMatchObject({ unitId: 'E0', sourceId: 'A0', status: 'seal', remainingTurns: 3 });
    runExecution(engine);
    // 下一回合：E0 仍被封印
    expect(engine.getCommandOptions('E0')).toEqual({
      canAttack: true,
      canDefend: true,
      skills: [{ skillId: 'single_spell', enabled: false, disabledReason: 'sealed' }],
    });
    expect(engine.submitCommand('E0', skill('single_spell', 'A0'))).toEqual({ ok: false, reason: 'sealed' });
    expect(engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' })).toEqual({ ok: true });
    expect(engine.submitCommand('E0', { kind: 'defend' })).toEqual({ ok: true });
  });

  it('未命中：发出 StatusResisted，目标不受影响，魔法照扣', () => {
    const { engine } = start([sealer(), caster('E0', 10)], constRng(0.8)); // 0.8 ≥ 命中率 0.75
    const events = actFirst(engine, { A0: skill('seal', 'E0') });
    expect(types(events)).toEqual(['UnitActStart', 'SkillCast', 'StatusResisted', 'UnitActEnd']);
    expect(engine.getState().units['E0']!.statuses).toEqual([]);
    expect(engine.getState().units['A0']!.mp).toBe(140);
  });

  it('立即生效：目标本回合还没出手的技能指令改为普攻，不扣它的魔法', () => {
    const { engine } = start([sealer({ stats: { maxHp: 9999 } }), caster('E0', 10)]);
    command(engine, { A0: skill('seal', 'E0'), E0: skill('single_spell', 'A0') });
    const events = runExecution(engine);
    expect(ofType(events, 'CommandFallback')[0]).toMatchObject({
      actorId: 'E0',
      fromSkillId: 'single_spell',
      toSkillId: 'basic_physical',
      reason: 'sealed',
    });
    const casts = ofType(events, 'SkillCast');
    expect(casts[1]).toMatchObject({ actorId: 'E0', skillId: 'basic_physical', targets: ['A0'], mpCost: 0 });
    expect(engine.getState().units['E0']!.mp).toBe(200);
  });

  it('回合递减：施加回合计入，3 → 2 → 1 → 第三次结算时解除', () => {
    const { engine } = start([sealer({ stats: { maxHp: 9999 } }), caster('E0', 10)]);
    command(engine, { A0: skill('seal', 'E0') });
    const t1 = runExecution(engine);
    expect(ofType(t1, 'StatusTicked')).toMatchObject([{ unitId: 'E0', status: 'seal', remainingTurns: 2 }]);
    // 递减在回合结算时、TurnEnd 之前
    expect(types(t1).indexOf('StatusTicked')).toBeLessThan(types(t1).indexOf('TurnEnd'));
    expect(engine.getCommandOptions('E0').skills[0]!.enabled).toBe(false);

    command(engine, { A0: { kind: 'defend' } });
    const t2 = runExecution(engine);
    expect(ofType(t2, 'StatusTicked')).toMatchObject([{ unitId: 'E0', remainingTurns: 1 }]);
    expect(engine.getCommandOptions('E0').skills[0]!.enabled).toBe(false);

    command(engine, { A0: { kind: 'defend' } });
    const t3 = runExecution(engine);
    expect(ofType(t3, 'StatusTicked')).toHaveLength(0);
    expect(ofType(t3, 'StatusRemoved')).toMatchObject([{ unitId: 'E0', status: 'seal', reason: 'expired' }]);
    // 第 4 回合：封印已解除，技能恢复可用
    expect(engine.getState().turn).toBe(4);
    expect(engine.getState().units['E0']!.statuses).toEqual([]);
    expect(engine.getCommandOptions('E0').skills[0]).toEqual({ skillId: 'single_spell', enabled: true });
    expect(engine.submitCommand('E0', skill('single_spell', 'A0'))).toEqual({ ok: true });
  });

  it('已被封印的单位不能再被封印', () => {
    const { engine } = start([sealer(), caster('E0', 10, sealedFor(2)), caster('E1', 5)]);
    expect(engine.submitCommand('A0', skill('seal', 'E0'))).toEqual({ ok: false, reason: 'invalidTarget' });
    expect(engine.previewTargets('A0', 'seal', 'E0')).toEqual([]);
    expect(engine.previewTargets('A0', 'seal', 'E1')).toEqual(['E1']); // 只有 1 个目标
  });

  it('出手时目标已被别人封印：改封印下一个未被封印的敌人；没有则作废且不扣魔法', () => {
    const two = start([sealer(), ally('A1', 80, { skillIds: ['seal'] }), caster('E0', 10), caster('E1', 5)]);
    command(two.engine, { A0: skill('seal', 'E0'), A1: skill('seal', 'E0') });
    two.engine.stepAction();
    const second = two.engine.stepAction()!;
    expect(ofType(second, 'TargetRetargeted')[0]).toMatchObject({ actorId: 'A1', fromId: 'E0', toId: 'E1' });
    expect(ofType(second, 'StatusApplied')[0]).toMatchObject({ unitId: 'E1' });

    const one = start([sealer(), ally('A1', 80, { skillIds: ['seal'] }), caster('E0', 10)]);
    command(one.engine, { A0: skill('seal', 'E0'), A1: skill('seal', 'E0') });
    one.engine.stepAction();
    expect(types(one.engine.stepAction()!)).toEqual(['UnitActStart', 'ActionFizzled', 'UnitActEnd']);
    expect(one.engine.getState().units['A1']!.mp).toBe(200);
    expect(one.engine.getState().units['E0']!.statuses).toHaveLength(1); // 不叠加
  });

  it('被封印的单位倒地时封印清除，复活后不带封印', () => {
    const { engine } = start([
      ally('A0', 90, { skillIds: ['revive'] }),
      ally('A1', 20, { hp: 10, ...sealedFor(3) }),
      foe('E0', 50, { stats: { maxHp: 9999 } }),
    ]);
    command(engine, { A0: { kind: 'defend' }, E0: { kind: 'attack', targetId: 'A1' } });
    const t1 = runExecution(engine);
    expect(ofType(t1, 'StatusRemoved')).toMatchObject([{ unitId: 'A1', status: 'seal', reason: 'death' }]);
    command(engine, { A0: skill('revive', 'A1'), E0: { kind: 'attack', targetId: 'A0' } });
    engine.stepAction();
    expect(engine.getState().units['A1']).toMatchObject({ alive: true, statuses: [] });
  });
});

// ----------------------------------------------------------------------
describe('魔法：一次性扣除与不足', () => {
  it.each([
    ['combo_slash', 40, 3],
    ['whirlwind', 80, 7],
    ['group_spell', 80, 6],
  ])('%s 只扣一次 %i 点魔法（%i 次结算）', (skillId, cost, count) => {
    const foes = Array.from({ length: 10 }, (_, i) => foe(`E${i}`, 10 + i, { stats: { maxHp: 9999 } }));
    const { engine } = start([ally('A0', 90, { skillIds: [skillId] }), ...foes]);
    const events = actFirst(engine, { A0: skill(skillId, 'E0') });
    expect(ofType(events, 'SkillCast')).toHaveLength(1);
    expect(ofType(events, 'HitResolved')).toHaveLength(count);
    expect(engine.getState().units['A0']!.mp).toBe(200 - cost);
  });

  it('魔法不足时多目标技能置灰并被拒绝；刚好够时可以用', () => {
    const { engine } = start([
      ally('A0', 90, { skillIds: ['combo_slash', 'whirlwind'], mp: 79 }),
      ally('A1', 80, { skillIds: ['whirlwind'], mp: 80 }),
      foe('E0', 10),
    ]);
    expect(engine.getCommandOptions('A0').skills).toEqual([
      { skillId: 'combo_slash', enabled: true },
      { skillId: 'whirlwind', enabled: false, disabledReason: 'noMp' },
    ]);
    expect(engine.submitCommand('A0', skill('whirlwind', 'E0'))).toEqual({ ok: false, reason: 'noMp' });
    expect(engine.submitCommand('A1', skill('whirlwind', 'E0'))).toEqual({ ok: true });
  });

  it('出手作废时不扣魔法', () => {
    const { engine } = start([
      ally('A0', 90, { stats: { physAtk: 9999 } }),
      ally('A1', 80, { skillIds: ['seal'] }),
      foe('E0', 10),
      foe('E1', 5, sealedFor(3)),
    ]);
    // A0 先打死 E0，A1 的封印只剩一个已被封印的 E1 可选 → 作废
    command(engine, { A0: { kind: 'attack', targetId: 'E0' }, A1: skill('seal', 'E0') });
    const events = runExecution(engine);
    expect(ofType(events, 'ActionFizzled')[0]).toMatchObject({ actorId: 'A1', skillId: 'seal' });
    expect(engine.getState().units['A1']!.mp).toBe(200);
  });
});

// ----------------------------------------------------------------------
describe('预览与执行一致', () => {
  it('previewTargets 给出的目标就是出手时 SkillCast.targets', () => {
    const foes = Array.from({ length: 10 }, (_, i) => foe(`E${i}`, 10 + ((i * 7) % 10), { stats: { maxHp: 9999 } }));
    for (const id of ['combo_slash', 'whirlwind', 'group_spell', 'single_spell', 'seal']) {
      const { engine } = start([ally('A0', 90, { skillIds: [id] }), ...foes]);
      const preview = engine.previewTargets('A0', id, 'E4');
      expect(preview[0]).toBe('E4');
      expect(preview).toHaveLength(SKILLS[id]!.targetCount);
      const events = actFirst(engine, { A0: skill(id, 'E4') });
      expect(ofType(events, 'SkillCast')[0]!.targets, id).toEqual(preview);
    }
  });

  it('未知单位、未知技能、不合法的主目标返回空', () => {
    const { engine } = start([ally('A0', 90, { skillIds: ['whirlwind'] }), foe('E0', 10)]);
    expect(engine.previewTargets('X', 'whirlwind', 'E0')).toEqual([]);
    expect(engine.previewTargets('A0', 'nope', 'E0')).toEqual([]);
    expect(engine.previewTargets('A0', 'whirlwind', 'A0')).toEqual([]);
  });
});

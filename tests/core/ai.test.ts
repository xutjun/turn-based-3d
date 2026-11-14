import { describe, expect, it } from 'vitest';
import type { Unit } from '../../src/core/types';
import { SKILLS } from '../../src/data/skills';
import { makeEngine, makeUnit } from '../helpers';

// AI 规则（DESIGN §8.4）：敌方与自动宝宝共用。阈值：气血比例 < 0.6 治疗；对方存活 ≥ 3 用群体技能。

type Extra = Parameters<typeof makeUnit>[2];
const unit = (id: string, side: 'ally' | 'enemy', extra: Extra = {}): Unit =>
  makeUnit(id, side, { ...extra, stats: { maxMp: 200, maxHp: 1000, ...extra?.stats } });
const suggest = (units: Unit[], id: string) => {
  const { engine } = makeEngine(units, { setup: { skills: SKILLS } });
  engine.start();
  return engine.suggestCommand(id);
};
const sealed: Extra = { statuses: [{ type: 'seal', remainingTurns: 2, sourceId: 'X', appliedTurn: 1 }] };

describe('AI：恢复系', () => {
  const healer = (extra: Extra = {}): Unit =>
    unit('E0', 'enemy', { classId: 'heal', skillIds: ['group_heal'], ...extra });

  it('有友军气血低于 60%：群体治疗，主目标为比例最低者', () => {
    const cmd = suggest(
      [healer(), unit('E1', 'enemy', { hp: 500 }), unit('E2', 'enemy', { hp: 300 }), unit('A0', 'ally', { hp: 100 })],
      'E0',
    );
    expect(cmd).toEqual({ kind: 'skill', skillId: 'group_heal', targetId: 'E2' });
  });

  it('没有人低于阈值：普攻残血敌人', () => {
    const cmd = suggest(
      [healer(), unit('E1', 'enemy', { hp: 600 }), unit('A0', 'ally', { hp: 900 }), unit('A1', 'ally', { hp: 400 })],
      'E0',
    );
    expect(cmd).toEqual({ kind: 'attack', targetId: 'A1' });
  });

  it('魔法不足或被封印时不治疗，改为普攻', () => {
    const others = [unit('E1', 'enemy', { hp: 100 }), unit('A0', 'ally')];
    expect(suggest([healer({ mp: 79 }), ...others], 'E0')).toEqual({ kind: 'attack', targetId: 'A0' });
    expect(suggest([healer(sealed), ...others], 'E0')).toEqual({ kind: 'attack', targetId: 'A0' });
  });

  it('没有人需要治疗、有倒地友军且会复活：复活 id 最小的倒地友军', () => {
    const pet = unit('A9', 'ally', { classId: 'heal', skillIds: ['group_heal', 'revive'] });
    const down: Extra = { hp: 0, alive: false };
    const cmd = suggest([pet, unit('A3', 'ally', down), unit('A1', 'ally', down), unit('E0', 'enemy')], 'A9');
    expect(cmd).toEqual({ kind: 'skill', skillId: 'revive', targetId: 'A1' });
    // 有人残血时先治疗
    const cmd2 = suggest([pet, unit('A1', 'ally', down), unit('A2', 'ally', { hp: 100 }), unit('E0', 'enemy')], 'A9');
    expect(cmd2).toEqual({ kind: 'skill', skillId: 'group_heal', targetId: 'A2' });
  });
});

describe('AI：封印系', () => {
  const sealer = (extra: Extra = {}): Unit => unit('E0', 'enemy', { classId: 'seal', skillIds: ['seal'], ...extra });

  it('优先封印对方的法术 / 恢复职业，取法术伤害最高者', () => {
    const cmd = suggest(
      [
        sealer(),
        unit('A0', 'ally', { classId: 'physical', skillIds: ['whirlwind'], stats: { magAtk: 999 } }),
        unit('A1', 'ally', { classId: 'magic', stats: { magAtk: 150 } }),
        unit('A2', 'ally', { classId: 'heal', stats: { magAtk: 170 } }),
      ],
      'E0',
    );
    expect(cmd).toEqual({ kind: 'skill', skillId: 'seal', targetId: 'A2' });
  });

  it('跳过已被封印的单位；没有法术 / 恢复职业时封印拥有技能的单位', () => {
    const cmd = suggest(
      [
        sealer(),
        unit('A0', 'ally', { classId: 'magic', stats: { magAtk: 200 }, ...sealed }),
        unit('A1', 'ally', { classId: 'physical', skillIds: ['combo_slash'], stats: { magAtk: 10 } }),
        unit('A2', 'ally', { classId: 'physical', stats: { magAtk: 90 } }), // 没有技能，封印没有意义
      ],
      'E0',
    );
    expect(cmd).toEqual({ kind: 'skill', skillId: 'seal', targetId: 'A1' });
  });

  it('没有值得封印的目标，或魔法不足：普攻残血敌人', () => {
    const targets = [unit('A0', 'ally', { hp: 900 }), unit('A1', 'ally', { hp: 200 })];
    expect(suggest([sealer(), ...targets], 'E0')).toEqual({ kind: 'attack', targetId: 'A1' });
    const mage = unit('A2', 'ally', { classId: 'magic' });
    expect(suggest([sealer({ mp: 0 }), ...targets, mage], 'E0')).toEqual({ kind: 'attack', targetId: 'A1' });
  });
});

describe('AI：物理系 / 法术系', () => {
  const boss = (extra: Extra = {}): Unit => unit('E0', 'enemy', { skillIds: ['combo_slash', 'whirlwind'], ...extra });
  const allies = (n: number): Unit[] =>
    Array.from({ length: n }, (_, i) => unit(`A${i}`, 'ally', { hp: 900 - i * 100 }));

  it('对方存活 ≥ 3：群体技能，主目标为残血敌人', () => {
    expect(suggest([boss(), ...allies(3)], 'E0')).toEqual({ kind: 'skill', skillId: 'whirlwind', targetId: 'A2' });
  });

  it('对方不足 3 个：单体技能', () => {
    expect(suggest([boss(), ...allies(2)], 'E0')).toEqual({ kind: 'skill', skillId: 'combo_slash', targetId: 'A1' });
  });

  it('魔法不够放群体技能时用单体技能；都不够时普攻', () => {
    expect(suggest([boss({ mp: 60 }), ...allies(5)], 'E0')).toEqual({ kind: 'skill', skillId: 'combo_slash', targetId: 'A4' });
    expect(suggest([boss({ mp: 39 }), ...allies(5)], 'E0')).toEqual({ kind: 'attack', targetId: 'A4' });
  });

  it('被封印时只会普攻', () => {
    expect(suggest([boss(sealed), ...allies(5)], 'E0')).toEqual({ kind: 'attack', targetId: 'A4' });
  });

  it('法术系同理：群体法术 / 单体法术', () => {
    const mage = (): Unit => unit('E0', 'enemy', { classId: 'magic', skillIds: ['group_spell', 'single_spell'] });
    expect(suggest([mage(), ...allies(4)], 'E0')).toEqual({ kind: 'skill', skillId: 'group_spell', targetId: 'A3' });
    expect(suggest([mage(), ...allies(1)], 'E0')).toEqual({ kind: 'skill', skillId: 'single_spell', targetId: 'A0' });
  });

  it('没有技能的单位普攻残血敌人；AI 给出的指令都能通过校验', () => {
    const units = [unit('E0', 'enemy'), ...allies(3)];
    expect(suggest(units, 'E0')).toEqual({ kind: 'attack', targetId: 'A2' });
    const { engine } = makeEngine([boss(), ...allies(3)], { setup: { skills: SKILLS } });
    engine.start();
    expect(engine.submitCommand('E0', engine.suggestCommand('E0'))).toEqual({ ok: true });
  });
});

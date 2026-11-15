import { describe, expect, it } from 'vitest';
import { formatLogLines, type LogContext } from '../../src/ui/log/battleLog';
import { BattleStats } from '../../src/ui/stats/BattleStats';
import { autoPlay, makeEngine, makeUnit, runExecution } from '../helpers';

const ctx: LogContext = {
  unitName: (id) => `<${id}>`,
  skillName: (id) => (id === 'test_bolt' ? '测试法术' : '普攻'),
  isBasicSkill: (id) => id.startsWith('basic'),
};

describe('战斗日志', () => {
  it('记录回合、防御、出手、伤害、击败和战斗结束', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90, physAtk: 200 } }),
      makeUnit('A1', 'ally', { stats: { speed: 80 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10 } }),
    ]);
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('A1', { kind: 'defend' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A1' });
    engine.beginExecution();
    runExecution(engine);

    const lines = formatLogLines(events, ctx);
    expect(lines.map((l) => l.text)).toEqual([
      '第 1 回合',
      '<A1> 摆出防御姿态',
      '<A0> 攻击 <E0>',
      '<E0> 受到 190 点伤害',
      '<E0> 被击败',
      '战斗胜利 · 共 1 回合',
    ]);
    expect(lines.map((l) => l.tone)).toEqual(['turn', 'info', 'action', 'damage', 'death', 'end']);
    expect(lines.map((l) => l.detail)).toEqual([false, false, false, true, true, false]);
  });

  it('技能显示名称与魔法消耗；未命中、暴击、防御有标注', () => {
    const base = { seq: 1, turn: 1 };
    const lines = formatLogLines(
      [
        {
          ...base,
          type: 'SkillCast',
          actorId: 'A0',
          skillId: 'test_bolt',
          delivery: 'cast',
          animation: 'singleSpell',
          meleeCharge: false,
          element: 'fire',
          targets: ['E0', 'E1'],
          mpCost: 50,
          mpBefore: 80,
          mpAfter: 30,
        },
        { ...base, type: 'HitResolved', actorId: 'A0', targetId: 'E0', skillId: 'test_bolt', stepIndex: 0, stepCount: 1, hitIndex: 0, hitCount: 1, damageType: 'magic', isMiss: true, isCrit: false, defended: false, damage: 0, hpBefore: 100, hpAfter: 100, killed: false },
        { ...base, type: 'HitResolved', actorId: 'A0', targetId: 'E1', skillId: 'test_bolt', stepIndex: 0, stepCount: 1, hitIndex: 0, hitCount: 1, damageType: 'magic', isMiss: false, isCrit: true, defended: true, damage: 40, hpBefore: 100, hpAfter: 60, killed: false },
        { ...base, type: 'HealResolved', actorId: 'A0', targetId: 'A1', skillId: 'heal', stepIndex: 0, stepCount: 1, isCrit: false, amount: 30, hpBefore: 10, hpAfter: 40 },
        { ...base, type: 'StatusApplied', unitId: 'E0', sourceId: 'A0', status: 'seal', remainingTurns: 3 },
        { ...base, type: 'UnitRevived', unitId: 'A1', actorId: 'A0', hpAfter: 30, maxHp: 100, actsThisTurn: false, queuedAtEnd: false },
        { ...base, type: 'CommandFallback', actorId: 'A0', fromSkillId: 'test_bolt', toSkillId: 'basic_magic', reason: 'noMp' },
        { ...base, type: 'UnitDied', unitId: 'A1', killerId: 'E0', vanish: false },
      ],
      ctx,
    );
    expect(lines.map((l) => l.text)).toEqual([
      '<A0> 使用「测试法术」→ <E0>、<E1>（魔法 -50）',
      '<E0> 躲开了攻击',
      '<E1> 受到 40 点伤害（暴击）（防御）',
      '<A1> 回复 30 点气血',
      '<E0> 被封印 3 回合',
      '<A1> 被复活（气血 30/100）',
      '<A0> 魔法不足，「测试法术」改为普攻',
      '<A1> 倒地',
    ]);
  });
});

describe('战斗统计', () => {
  it('累计伤害、击败数和存活情况，伤害合计与气血变化一致', () => {
    const { engine, events } = makeEngine([
      makeUnit('A0', 'ally', { stats: { speed: 90, physAtk: 80, maxHp: 300 } }),
      makeUnit('A1', 'ally', { stats: { speed: 80, physAtk: 60, maxHp: 300 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 10, maxHp: 150 } }),
      makeUnit('E1', 'enemy', { stats: { speed: 20, maxHp: 150 } }),
    ]);
    autoPlay(engine);
    const stats = new BattleStats();
    stats.consume(events);
    const s = stats.summary();

    expect(s.winner).toBe('ally');
    expect(s.turns).toBe(engine.getState().turn);
    expect(s.allies.map((u) => u.id)).toEqual(['A0', 'A1']);
    expect(s.enemySurvivors).toBe(0);
    expect(s.allySurvivors).toBe(2);
    // 敌人都被打光：我方总伤害恰好等于敌方气血总和（溢出的伤害不计）
    expect(s.allyDamage).toBe(300);
    expect(s.allies.reduce((n, u) => n + u.kills, 0)).toBe(2);
    expect(s.mvp).toBe('A0');
    // 我方承受的伤害等于损失的气血
    const state = engine.getState();
    for (const u of s.allies) {
      expect(u.damageTaken).toBe(state.units[u.id]!.stats.maxHp - state.units[u.id]!.hp);
    }
    expect(s.enemyDamage).toBe(s.allies.reduce((n, u) => n + u.damageTaken, 0));
    expect(s.actions).toBe(events.filter((e) => e.type === 'UnitActStart').length);
  });

  it('新的一场从零开始', () => {
    const stats = new BattleStats();
    expect(stats.summary()).toMatchObject({ winner: null, turns: 0, actions: 0, allies: [], allyDamage: 0, mvp: null });
  });
});

describe('战斗日志：步骤 9 新增的事件', () => {
  it('连击触发、复活后排到队尾都有记录', () => {
    const base = { seq: 1, turn: 1 };
    const lines = formatLogLines(
      [
        { ...base, type: 'PassiveTriggered', unitId: 'A5', passiveId: 'double_strike', name: '连击', targetId: 'E0' },
        { ...base, type: 'UnitRevived', unitId: 'A1', actorId: 'A0', hpAfter: 30, maxHp: 100, actsThisTurn: true, queuedAtEnd: true },
        { ...base, type: 'UnitRevived', unitId: 'A2', actorId: 'A0', hpAfter: 30, maxHp: 100, actsThisTurn: true, queuedAtEnd: false },
      ],
      ctx,
    );
    expect(lines.map((l) => l.text)).toEqual([
      '<A5> 触发「连击」，再攻击一次',
      '<A1> 被复活（气血 30/100），本回合排到队尾出手',
      '<A2> 被复活（气血 30/100）',
    ]);
  });
});

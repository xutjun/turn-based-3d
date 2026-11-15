import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import type { Command, Unit } from '../../src/core/types';
import { AI_CONFIG } from '../../src/data/aiConfig';
import { SKILLS } from '../../src/data/skills';
import { makeEngine, makeSetup, makeUnit } from '../helpers';

// AI 规则（DESIGN §8.4）：敌方与自动宝宝共用。测试用阈值：气血比例 < 0.6 治疗；对方存活 ≥ 3 用群体技能。
// 前三组用 focus 模式（固定选目标，友方自动出手的规则）；最后一组是 spread 模式（敌方不集火）。

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
    expect(suggest([healer({ mp: 59 }), ...others], 'E0')).toEqual({ kind: 'attack', targetId: 'A0' });
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
    expect(suggest([boss({ mp: 59 }), ...allies(5)], 'E0')).toEqual({ kind: 'skill', skillId: 'combo_slash', targetId: 'A4' });
    expect(suggest([boss({ mp: 29 }), ...allies(5)], 'E0')).toEqual({ kind: 'attack', targetId: 'A4' });
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

// ----------------------------------------------------------------------
// 步骤 9：spread 模式（带权重的随机 + 同回合分散），默认配置里敌方使用。
// 这里用正式的 AI_CONFIG；随机数由战斗种子派生，所以每个种子的结果固定。
// ----------------------------------------------------------------------
describe('AI：spread 选目标（敌方不集火）', () => {
  const auto: Extra = { autoCommand: true };
  /** 开一场、双方下完指令，返回进入执行阶段时的全部指令 */
  const commandsOf = (units: Unit[], seed: number, ai = AI_CONFIG): Record<string, Command> => {
    const engine = new BattleEngine(makeSetup(units, { skills: SKILLS, ai, seed }));
    let commands: Record<string, Command> = {};
    engine.events.on('ExecutionPhaseStart', (e) => (commands = e.commands));
    engine.start();
    for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, { kind: 'defend' });
    engine.beginExecution();
    return commands;
  };
  const targetOf = (cmd: Command | undefined): string => (cmd && cmd.kind !== 'defend' ? cmd.targetId : '');
  const enemies = (n: number, extra: Extra = {}): Unit[] =>
    Array.from({ length: n }, (_, i) => unit(`E${i}`, 'enemy', { ...auto, ...extra, stats: { speed: 50 - i, ...extra?.stats } }));
  const allies = (n: number): Unit[] => Array.from({ length: n }, (_, i) => unit(`A${i}`, 'ally'));
  const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

  it('默认配置：敌方 spread、友方 focus，参数都在配置里', () => {
    expect(AI_CONFIG.targetMode).toEqual({ enemy: 'spread', ally: 'focus' });
    expect(AI_CONFIG.spread.repeatDecay).toBeGreaterThan(0);
    expect(AI_CONFIG.spread.repeatDecay).toBeLessThan(1);
    expect(AI_CONFIG.spread.lowHpBonus).toBeLessThan(1); // 残血只是小幅加权
  });

  it('同一个种子结果完全相同，不同种子会不同（随机走带种子的随机数）', () => {
    const units = (): Unit[] => [...enemies(5), ...allies(5)];
    const a = JSON.stringify(commandsOf(units(), 7));
    expect(JSON.stringify(commandsOf(units(), 7))).toBe(a);
    const distinct = new Set(SEEDS.slice(0, 30).map((seed) => JSON.stringify(commandsOf(units(), seed))));
    expect(distinct.size).toBeGreaterThan(10);
  });

  it('5 个敌人打 5 个友方：同一回合里目标明显分散；focus 模式下则全部打同一个', () => {
    let focused = 0;
    let maxSum = 0;
    for (const seed of SEEDS) {
      const cmds = commandsOf([...enemies(5), ...allies(5)], seed);
      const counts = new Map<string, number>();
      for (const id of ['E0', 'E1', 'E2', 'E3', 'E4']) counts.set(targetOf(cmds[id]), (counts.get(targetOf(cmds[id])) ?? 0) + 1);
      const max = Math.max(...counts.values());
      maxSum += max;
      if (max >= 3) focused += 1;
    }
    expect(focused / SEEDS.length).toBeLessThan(0.2); // 同一个友方被 3 次以上选中的回合很少
    expect(maxSum / SEEDS.length).toBeLessThan(2.3);
    // 对照：旧规则（focus）每回合 5 次全打同一个
    const focusAi = { ...AI_CONFIG, targetMode: { enemy: 'focus', ally: 'focus' } as const };
    const cmds = commandsOf([...enemies(5), ...allies(5).map((u, i) => (i === 3 ? { ...u, hp: 10 } : u))], 1, focusAi);
    expect(['E0', 'E1', 'E2', 'E3', 'E4'].map((id) => targetOf(cmds[id]))).toEqual(Array(5).fill('A3'));
  });

  it('残血只有小幅加权，不会压倒随机性：1 个残血 + 4 个满血时，残血被选中的概率略高于平均', () => {
    let low = 0;
    for (const seed of SEEDS) {
      const units = [...enemies(1), ...allies(5).map((u, i) => (i === 2 ? { ...u, hp: 100 } : u))];
      if (targetOf(commandsOf(units, seed)['E0']) === 'A2') low += 1;
    }
    // 理论值 1.27 / (4 + 1.27) ≈ 24%；平均值是 20%
    expect(low / SEEDS.length).toBeGreaterThan(0.17);
    expect(low / SEEDS.length).toBeLessThan(0.32);
  });

  it('同一回合内已被选中的单位权重衰减：第二个敌人选同一目标的概率明显低于均匀随机', () => {
    let same = 0;
    for (const seed of SEEDS) {
      const cmds = commandsOf([...enemies(2), ...allies(2)], seed);
      if (targetOf(cmds['E0']) === targetOf(cmds['E1'])) same += 1;
    }
    // 均匀随机是 50%；衰减 0.5 后理论值 0.5 / 1.5 ≈ 33%
    expect(same / SEEDS.length).toBeGreaterThan(0.25);
    expect(same / SEEDS.length).toBeLessThan(0.42);
  });

  it('被选次数只在本回合内累计，回合开始清零', () => {
    const engine = new BattleEngine(makeSetup([...enemies(3, { stats: { physAtk: 11 } }), ...allies(3)], { skills: SKILLS, ai: AI_CONFIG, seed: 3 }));
    engine.start();
    for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, { kind: 'defend' });
    engine.beginExecution();
    const total = (): number => Object.values(engine.getState().aiTargetCounts.enemy.attack).reduce((a, b) => a + b, 0);
    expect(total()).toBe(3);
    while (engine.getState().phase === 'execution') engine.stepAction();
    expect(engine.getState().turn).toBe(2);
    expect(total()).toBe(0);
  });

  it('封印目标也是随机 + 分散：不总是同一个人，同一回合的两个封印者很少封同一个；偏向法术 / 恢复职业', () => {
    const sealers = (): Unit[] => enemies(2, { classId: 'seal', skillIds: ['seal'] });
    const targets = (): Unit[] => [
      unit('A0', 'ally', { classId: 'magic', skillIds: ['group_spell'] }),
      unit('A1', 'ally', { classId: 'heal', skillIds: ['group_heal'] }),
      unit('A2', 'ally', { classId: 'physical', skillIds: ['combo_slash'] }),
      unit('A3', 'ally', { classId: 'physical' }), // 没有主动技能：不会被封印
    ];
    const first = new Map<string, number>();
    let same = 0;
    for (const seed of SEEDS) {
      const cmds = commandsOf([...sealers(), ...targets()], seed);
      expect(cmds['E0']).toMatchObject({ kind: 'skill', skillId: 'seal' });
      const t0 = targetOf(cmds['E0']);
      first.set(t0, (first.get(t0) ?? 0) + 1);
      if (t0 === targetOf(cmds['E1'])) same += 1;
    }
    expect(first.has('A3')).toBe(false);
    expect([...first.keys()].sort()).toEqual(['A0', 'A1', 'A2']);
    // 权重 2 : 2 : 1 → 物理系约 20%，法术 / 恢复各约 40%
    expect(first.get('A2')! / SEEDS.length).toBeLessThan(0.3);
    expect(first.get('A0')! / SEEDS.length).toBeGreaterThan(0.3);
    expect(first.get('A1')! / SEEDS.length).toBeGreaterThan(0.3);
    expect(same / SEEDS.length).toBeLessThan(0.3);
  });

  it('治疗主目标也是随机 + 分散：只在气血低于阈值的友军里选，不总是气血最低的那个', () => {
    const healers = (): Unit[] => enemies(2, { classId: 'heal', skillIds: ['group_heal'] });
    const wounded = (): Unit[] => [
      unit('E5', 'enemy', { ...auto, hp: 100, stats: { speed: 1 } }),
      unit('E6', 'enemy', { ...auto, hp: 200, stats: { speed: 2 } }),
      unit('E7', 'enemy', { ...auto, hp: 300, stats: { speed: 3 } }),
      unit('E8', 'enemy', { ...auto, hp: 900, stats: { speed: 4 } }), // 不低于阈值：不会被选为主目标
    ];
    const picked = new Set<string>();
    let same = 0;
    for (const seed of SEEDS.slice(0, 200)) {
      const cmds = commandsOf([...healers(), ...wounded(), ...allies(1)], seed);
      expect(cmds['E0']).toMatchObject({ kind: 'skill', skillId: 'group_heal' });
      picked.add(targetOf(cmds['E0']));
      if (targetOf(cmds['E0']) === targetOf(cmds['E1'])) same += 1;
    }
    expect([...picked].sort()).toEqual(['E5', 'E6', 'E7']);
    expect(same / 200).toBeLessThan(0.34);
  });

  it('出手时目标失效的重选也走权重随机：不会全部落到速度最快的那个友方身上', () => {
    const to = new Map<string, number>();
    for (const seed of SEEDS.slice(0, 200)) {
      // A0 只有 1 点气血：第一个打它的敌人把它打倒，其余选了 A0 的敌人要重选
      const units = [
        ...enemies(6, { stats: { physAtk: 20 } }),
        unit('A0', 'ally', { hp: 1, stats: { speed: 99 } }),
        unit('A1', 'ally', { stats: { speed: 98 } }),
        unit('A2', 'ally', { stats: { speed: 97 } }),
        unit('A3', 'ally', { stats: { speed: 96 } }),
      ];
      const engine = new BattleEngine(makeSetup(units, { skills: SKILLS, ai: AI_CONFIG, seed }));
      engine.events.on('TargetRetargeted', (e) => to.set(e.toId, (to.get(e.toId) ?? 0) + 1));
      engine.start();
      for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, { kind: 'defend' });
      engine.beginExecution();
      while (engine.getState().phase === 'execution' && engine.getState().turn === 1) engine.stepAction();
    }
    const total = [...to.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(30);
    expect([...to.keys()].sort()).toEqual(['A1', 'A2', 'A3']);
    // 旧规则下 100% 落到 A1（速度最快的存活友方）
    expect(to.get('A1')! / total).toBeLessThan(0.6);
  });

  it('友方自动出手（focus）不受影响：自动宝宝仍然打残血，不消耗 AI 随机数', () => {
    const pet = unit('A0', 'ally', { kind: 'pet', autoCommand: true });
    const foes = [unit('E0', 'enemy', { hp: 900 }), unit('E1', 'enemy', { hp: 300 }), unit('E2', 'enemy', { hp: 600 })];
    for (const seed of [1, 2, 3, 4, 5]) {
      const engine = new BattleEngine(makeSetup([pet, ...foes], { skills: SKILLS, ai: AI_CONFIG, seed }));
      engine.start();
      expect(engine.suggestCommand('A0')).toEqual({ kind: 'attack', targetId: 'E1' });
      expect(engine.getState().aiTargetCounts.ally.attack).toEqual({});
    }
  });
});

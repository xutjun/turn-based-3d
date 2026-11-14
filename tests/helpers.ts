// 测试辅助：构造小型战斗、可控的随机数。

import { BattleEngine } from '../src/core/battle';
import type { BattleEvent } from '../src/core/events';
import type { Rng } from '../src/core/rng';
import type { BattleConfig, BattleSetup, SkillDef, Unit } from '../src/core/types';

/** 测试用全局数值（与正式配置相互独立，方便验算） */
export const TEST_CONFIG: BattleConfig = {
  crit: {
    physical: { rate: 0.1, multiplier: 1.5 },
    magic: { rate: 0.2, multiplier: 2 },
    heal: { rate: 0.1, multiplier: 1.5 },
  },
  magicDefenseCoef: 0.5,
  varianceMin: 0.9,
  varianceMax: 1.1,
  defendDamageMult: 0.5,
};

/** 每次都返回同一个值的随机数。0.5 = 必定命中、浮动系数恰为 1.0、不暴击 */
export function constRng(value: number): Rng {
  return { next: () => value };
}

/** 按给定序列依次返回的随机数；用完后报错，并记录已消耗的个数 */
export function seqRng(values: number[]): Rng & { used: () => number } {
  let i = 0;
  return {
    next(): number {
      if (i >= values.length) throw new Error('测试随机数序列已用完');
      return values[i++]!;
    },
    used: () => i,
  };
}

const BASIC_PHYSICAL: SkillDef = {
  id: 'basic_physical',
  name: '普攻',
  description: '',
  classId: 'common',
  mpCost: 0,
  effect: 'damage',
  damageType: 'physical',
  targetSide: 'enemy',
  targetState: 'alive',
  targetCount: 1,
  pattern: 'single',
  hits: 1,
  multiplier: 1,
  hitRate: 0.95,
  meleeCharge: true,
  animation: { melee: 'meleeStrike', ranged: 'bowShot' },
  element: 'none',
};

const BASIC_MAGIC: SkillDef = {
  ...BASIC_PHYSICAL,
  id: 'basic_magic',
  name: '法术普攻',
  damageType: 'magic',
  meleeCharge: false,
  animation: { cast: 'castBolt' },
  element: 'fire',
};

/** 测试专用技能：单体法术伤害，消耗 50 魔法（用于验证“魔法不足不可用技能”） */
const TEST_BOLT: SkillDef = {
  ...BASIC_MAGIC,
  id: 'test_bolt',
  name: '测试法术',
  classId: 'magic',
  mpCost: 50,
  multiplier: 2,
  hitRate: 1,
  animation: { cast: 'singleSpell' },
};

export const TEST_SKILLS: Record<string, SkillDef> = {
  basic_physical: BASIC_PHYSICAL,
  basic_magic: BASIC_MAGIC,
  test_bolt: TEST_BOLT,
};

/** 构造一个单位；默认值：气血 100、魔法 0、物伤 50、法伤 50、防御 10、速度 50，手动下指令 */
export function makeUnit(
  id: string,
  side: 'ally' | 'enemy',
  overrides: Partial<Omit<Unit, 'stats'>> & { stats?: Partial<Unit['stats']> } = {},
): Unit {
  const { stats: statOverrides, ...rest } = overrides;
  const stats = {
    maxHp: 100,
    maxMp: 0,
    physAtk: 50,
    magAtk: 50,
    defense: 10,
    speed: 50,
    ...statOverrides,
  };
  return {
    id,
    templateId: 'test',
    name: id,
    side,
    kind: side === 'ally' ? 'hero' : 'enemy',
    classId: 'physical',
    slot: { row: 0, col: 0 },
    attackMode: 'melee',
    basicAttackSkillId: 'basic_physical',
    skillIds: [],
    stats,
    hp: stats.maxHp,
    mp: stats.maxMp,
    alive: true,
    statuses: [],
    defending: false,
    autoCommand: false, // 测试里敌方也手动下指令，便于精确控制
    ...rest,
  };
}

export function makeSetup(units: Unit[], overrides: Partial<BattleSetup> = {}): BattleSetup {
  return {
    config: TEST_CONFIG,
    skills: TEST_SKILLS,
    units,
    settings: { petAutoCommand: false },
    ai: { healHpThreshold: 0.6, aoeMinTargets: 3 },
    seed: 1,
    ...overrides,
  };
}

/** 创建引擎并收集它发出的全部事件。默认随机数恒为 0.5（必中、浮动 1.0、不暴击） */
export function makeEngine(
  units: Unit[],
  options: { rng?: Rng; setup?: Partial<BattleSetup> } = {},
): { engine: BattleEngine; events: BattleEvent[] } {
  const engine = new BattleEngine(makeSetup(units, options.setup), {
    rng: options.rng ?? constRng(0.5),
  });
  const events: BattleEvent[] = [];
  engine.events.onAny((e) => events.push(e));
  return { engine, events };
}

/**
 * 把执行阶段跑完（直到进入下一回合的指令阶段或战斗结束），返回期间的事件。
 * 遇到刚复活、等待现场下指令的单位时，采用 AI 建议。
 */
export function runExecution(engine: BattleEngine): BattleEvent[] {
  const out: BattleEvent[] = [];
  while (engine.getState().phase === 'execution') {
    const waiting = engine.getState().awaitingCommandFor;
    if (waiting !== null) {
      const r = engine.submitCommand(waiting, engine.suggestCommand(waiting));
      if (!r.ok) throw new Error(`指令被拒绝：${waiting} ${r.reason}`);
    }
    const batch = engine.stepAction();
    if (batch) out.push(...batch);
  }
  return out;
}

/** 让所有待指令单位采用 AI 建议并跑完整场战斗，返回全部事件 */
export function autoPlay(engine: BattleEngine, maxTurns = 500): void {
  if (engine.getState().phase === 'init') engine.start();
  while (engine.getState().phase !== 'ended') {
    if (engine.getState().turn > maxTurns) throw new Error('战斗超过回合上限仍未结束');
    for (const id of engine.getPendingCommandUnits()) {
      const r = engine.submitCommand(id, engine.suggestCommand(id));
      if (!r.ok) throw new Error(`指令被拒绝：${id} ${r.reason}`);
    }
    engine.beginExecution();
    runExecution(engine);
  }
}

/** 取出某一类事件 */
export function ofType<T extends BattleEvent['type']>(
  events: BattleEvent[],
  type: T,
): Extract<BattleEvent, { type: T }>[] {
  return events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

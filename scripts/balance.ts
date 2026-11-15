// 批量模拟统计：用多个种子跑完整的自动战斗，输出胜率、回合数分布、各技能的使用次数，
// 以及敌方的“被集火率”和双方“魔法不足被迫普攻”的占比（口径见 DESIGN.md §9.4）。
// 调数值（data/heroes.ts、data/enemies.ts、data/skills.ts、data/battleConfig.ts）之后用它核对平衡。
//
// 用法：
//   npm run balance                     默认 500 个种子（1..500）
//   npm run balance -- --seeds=1000     指定种子数量
//
// 双方都按引擎的 AI 建议出手（与页面的 ?auto=1 相同）。

import { BattleEngine } from '../src/core/battle';
import { createDefaultSetup } from '../src/data/defaultSetup';
import { isSealed } from '../src/core/status';
import type { Side } from '../src/core/types';
import { SKILLS } from '../src/data/skills';

const MAX_TURNS = 500; // 安全上限，正常不会达到

function parseSeeds(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith('--seeds=')) {
      const n = Number(arg.slice('--seeds='.length));
      if (!Number.isInteger(n) || n <= 0) throw new Error(`种子数量必须是正整数：${arg}`);
      return n;
    }
  }
  return 500;
}

interface Tally {
  casts: number; // 施放次数
  battles: number; // 出现过该技能的场数
  ally: number; // 其中友方施放的次数
}

const seeds = parseSeeds(process.argv.slice(2));
const usage = new Map<string, Tally>();
const turnCounts: number[] = [];
let allyWins = 0;
let allySurvivors = 0;
let revived = 0;
let healed = 0;
let sealsLanded = 0;
let sealBlocked = 0; // 因被封印而改为普攻的次数
let passiveProcs = 0; // 连击判定成功的次数（普攻的计划段数为 2）
let passiveSecond = 0; // 其中第二击实际打出的次数（第一击打死目标时取消）
let passiveChances = 0; // 拥有被动技能的单位的普攻次数

// 集火：每个回合里，每个友方单位被敌方“单体出手”（普攻、连斩、单体法术；一次出手算一次）选中的次数
let turnsWithSingles = 0; // 敌方至少有一次单体出手的回合数
let focusedTurns = 0; // 其中存在某个友方被选中 ≥ 3 次的回合数
let turnsWith3Singles = 0; // 敌方单体出手 ≥ 3 次的回合数（只有这些回合才可能出现集火）
let maxHitsSum = 0;
const maxHitsHist = new Map<number, number>();
const sealTargets = new Map<string, number>(); // 敌方封印落在谁身上
const healTargets = new Map<string, number>(); // 敌方治疗的主目标

// 魔法不足：有主动技能、没被封印、但魔法不够用任何一个技能，只能普攻的出手
const mpStats: Record<Side, { starved: number; actsWithSkills: number; acts: number }> = {
  ally: { starved: 0, actsWithSkills: 0, acts: 0 },
  enemy: { starved: 0, actsWithSkills: 0, acts: 0 },
};

for (let seed = 1; seed <= seeds; seed++) {
  const engine = new BattleEngine(createDefaultSetup(seed));
  const seen = new Set<string>();
  let singles = new Map<string, number>();
  const closeTurn = (): void => {
    if (singles.size > 0) {
      const max = Math.max(...singles.values());
      turnsWithSingles += 1;
      maxHitsSum += max;
      maxHitsHist.set(max, (maxHitsHist.get(max) ?? 0) + 1);
      if (max >= 3) focusedTurns += 1;
      if ([...singles.values()].reduce((a, b) => a + b, 0) >= 3) turnsWith3Singles += 1;
    }
    singles = new Map();
  };
  engine.events.onAny((e) => {
    if (e.type === 'TurnEnd' || e.type === 'BattleEnd') closeTurn();
    else if (e.type === 'PassiveTriggered') passiveSecond += 1;
    else if (e.type === 'HitResolved' && e.hitIndex === 0 && e.hitCount === 2 && SKILLS[e.skillId]!.classId === 'common') passiveProcs += 1;
    else if (e.type === 'UnitActStart') {
      const u = engine.getState().units[e.actorId]!;
      const m = mpStats[u.side];
      m.acts += 1;
      if (u.skillIds.length > 0) {
        m.actsWithSkills += 1;
        if (e.command.kind !== 'defend' && !isSealed(u) && u.skillIds.every((id) => u.mp < SKILLS[id]!.mpCost)) m.starved += 1;
      }
    }
    if (e.type === 'SkillCast') {
      const actor = engine.getState().units[e.actorId]!;
      const def = SKILLS[e.skillId]!;
      if (actor.passiveIds?.length && def.classId === 'common') passiveChances += 1;
      if (actor.side === 'enemy') {
        const first = e.targets[0]!;
        if (def.effect === 'damage' && def.targetCount === 1) singles.set(first, (singles.get(first) ?? 0) + 1);
        else if (def.effect === 'seal') sealTargets.set(first, (sealTargets.get(first) ?? 0) + 1);
        else if (def.effect === 'heal') healTargets.set(first, (healTargets.get(first) ?? 0) + 1);
      }
      const t = usage.get(e.skillId) ?? { casts: 0, battles: 0, ally: 0 };
      t.casts += 1;
      if (engine.getState().units[e.actorId]!.side === 'ally') t.ally += 1;
      if (!seen.has(e.skillId)) {
        seen.add(e.skillId);
        t.battles += 1;
      }
      usage.set(e.skillId, t);
    } else if (e.type === 'UnitRevived') revived += 1;
    else if (e.type === 'HealResolved') healed += e.amount;
    else if (e.type === 'StatusApplied') sealsLanded += 1;
    else if (e.type === 'CommandFallback' && e.reason === 'sealed') sealBlocked += 1;
  });

  const submit = (id: string): void => {
    const result = engine.submitCommand(id, engine.suggestCommand(id));
    if (!result.ok) throw new Error(`种子 ${seed}：指令被拒绝 ${id} ${result.reason}`);
  };
  engine.start();
  while (engine.getState().phase !== 'ended') {
    if (engine.getState().turn > MAX_TURNS) throw new Error(`种子 ${seed}：超过 ${MAX_TURNS} 回合仍未结束`);
    for (const id of engine.getPendingCommandUnits()) submit(id);
    engine.beginExecution();
    while (engine.getState().phase === 'execution') {
      const waiting = engine.getState().awaitingCommandFor;
      if (waiting !== null) submit(waiting);
      engine.stepAction();
    }
  }
  const state = engine.getState();
  turnCounts.push(state.turn);
  if (state.winner === 'ally') {
    allyWins += 1;
    allySurvivors += state.unitIds.filter((id) => state.units[id]!.side === 'ally' && state.units[id]!.alive).length;
  }
}

turnCounts.sort((a, b) => a - b);
const at = (p: number): number => turnCounts[Math.min(turnCounts.length - 1, Math.floor(p * turnCounts.length))]!;
const mean = turnCounts.reduce((a, b) => a + b, 0) / seeds;
const inRange = turnCounts.filter((t) => t >= 8 && t <= 14).length;
const pct = (n: number, d: number): string => `${((n / d) * 100).toFixed(1)}%`;

console.log(`场数 ${seeds}（种子 1..${seeds}）`);
console.log(`友方胜率 ${pct(allyWins, seeds)}（${allyWins} 胜 ${seeds - allyWins} 负），获胜时平均存活 ${(allySurvivors / Math.max(1, allyWins)).toFixed(1)} 个`);
console.log(
  `回合数 平均 ${mean.toFixed(1)}，最少 ${turnCounts[0]}，10% ${at(0.1)}，中位 ${at(0.5)}，90% ${at(0.9)}，最多 ${turnCounts.at(-1)}；8~14 回合的占 ${pct(inRange, seeds)}`,
);
console.log(
  `每场平均：封印命中 ${(sealsLanded / seeds).toFixed(1)} 次（使对方 ${(sealBlocked / seeds).toFixed(1)} 次技能改为普攻），治疗 ${(healed / seeds).toFixed(0)} 点气血，复活 ${(revived / seeds).toFixed(2)} 次`,
);
console.log('\n技能            每场次数  友方/敌方    出现场次');
for (const skill of Object.values(SKILLS)) {
  const t = usage.get(skill.id) ?? { casts: 0, battles: 0, ally: 0 };
  console.log(
    `${skill.name.padEnd(10, '　')} ${(t.casts / seeds).toFixed(2).padStart(7)}  ${(t.ally / seeds).toFixed(2).padStart(5)}/${((t.casts - t.ally) / seeds).toFixed(2).padEnd(5)}  ${pct(t.battles, seeds).padStart(6)}`,
  );
}

const share = (m: Map<string, number>): string => {
  const total = [...m.values()].reduce((a, b) => a + b, 0);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${id} ${pct(n, Math.max(1, total))}`)
    .join('，');
};
console.log('\n敌方集火（单体出手 = 普攻、连斩、单体法术，一次出手算一次）');
console.log(
  `被集火率 ${pct(focusedTurns, Math.max(1, turnsWithSingles))}（${focusedTurns}/${turnsWithSingles} 个回合里，有友方单位被敌方单体出手选中 ≥ 3 次）；每回合单个友方被选中的最大次数 平均 ${(maxHitsSum / Math.max(1, turnsWithSingles)).toFixed(2)}`,
);
console.log(
  `只看敌方单体出手 ≥ 3 次的回合（${turnsWith3Singles} 个）：被集火的占 ${pct(focusedTurns, Math.max(1, turnsWith3Singles))}`,
);
console.log(
  `最大次数分布：${[...maxHitsHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k} 次 ${pct(n, turnsWithSingles)}`).join('，')}`,
);
console.log(`敌方封印目标分布：${share(sealTargets)}`);
console.log(`敌方治疗主目标分布：${share(healTargets)}`);

console.log('\n魔法不足被迫普攻（有主动技能、未被封印、魔法不够用任何技能）');
for (const side of ['ally', 'enemy'] as const) {
  const m = mpStats[side];
  console.log(
    `${side === 'ally' ? '友方' : '敌方'}：${m.starved} 次；占有主动技能单位的出手 ${pct(m.starved, Math.max(1, m.actsWithSkills))}（${m.actsWithSkills}），占全部出手 ${pct(m.starved, Math.max(1, m.acts))}（${m.acts}）`,
  );
}
if (passiveChances > 0) {
  console.log(
    `\n被动“连击”：${passiveChances} 次普攻中触发 ${passiveProcs} 次 = ${pct(passiveProcs, passiveChances)}；第二击实际打出 ${passiveSecond} 次（其余是第一击已打死目标，第二击取消）`,
  );
}

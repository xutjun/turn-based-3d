// 批量模拟统计：用多个种子跑完整的自动战斗，输出胜率、回合数分布和各技能的使用次数。
// 调数值（data/heroes.ts、data/enemies.ts、data/skills.ts、data/battleConfig.ts）之后用它核对平衡。
//
// 用法：
//   npm run balance                     默认 300 个种子（1..300）
//   npm run balance -- --seeds=1000     指定种子数量
//
// 双方都按引擎的 AI 建议出手（与页面的 ?auto=1 相同）。

import { BattleEngine } from '../src/core/battle';
import { createDefaultSetup } from '../src/data/defaultSetup';
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
  return 300;
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

for (let seed = 1; seed <= seeds; seed++) {
  const engine = new BattleEngine(createDefaultSetup(seed));
  const seen = new Set<string>();
  engine.events.onAny((e) => {
    if (e.type === 'SkillCast') {
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

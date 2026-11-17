// 近战衔接测量（步骤 11c）：打印刀、剑、枪普攻，连斩，旋风斩，狼，魔偶的
//   起跳到命中、每次命中的“落地到命中”、命中前的站定时间（口径见 tests/render/meleeFlow.ts）。
// 用法：npx tsx scripts/measureMeleeFlow.ts

import { measureMeleeFlow } from '../tests/render/meleeFlow';

const CASES: [string, string][] = [
  ['basic_blade', 'A1'],
  ['basic_sword', 'A3'],
  ['basic_spear', 'A4'],
  ['combo', 'A1'],
  ['whirlwind', 'A1'],
  ['double_strike', 'A5'],
  ['golem_basic', 'A9'],
  ['golem_double', 'A9'],
];
const fmt = (xs: number[]): string => xs.map((x) => (x < 0 ? '—' : x.toFixed(2))).join(', ');
for (const [id, actor] of CASES) {
  const r = await measureMeleeFlow(id, actor);
  console.log(
    `${id.padEnd(14)} 起跳→命中 ${r.takeoffToHit.toFixed(2)}s  落地→命中 [${fmt(r.hits.map((h) => h.land))}]s  ` +
      `命中前站定 [${fmt(r.hits.map((h) => h.still))}]s  总时长 ${r.total.toFixed(2)}s`,
  );
}

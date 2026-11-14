// 命令行模拟：用默认 10v10 阵容跑完一场战斗并输出文字日志。
//
// 用法：
//   npm run sim                  用当前时间作为随机种子
//   npm run sim -- --seed=42     固定种子，结果可复现
//   npm run sim -- --quiet       只输出每回合概况和最终结果
//
// 友方指令由脚本代替玩家决定：气血低于阈值时有一定概率防御，否则采用引擎的 AI 建议。
// 敌方指令由引擎内的 AI 自动决定。

import { BattleEngine } from '../src/core/battle';
import type { BattleEvent } from '../src/core/events';
import { createRng } from '../src/core/rng';
import type { Command, Unit, UnitId } from '../src/core/types';
import { createDefaultSetup } from '../src/data/defaultSetup';
import { SKILLS } from '../src/data/skills';

// 脚本自己的策略参数（只影响“代替玩家下指令”，不属于战斗规则）
const SIM_POLICY = {
  defendHpRatio: 0.3, // 气血比例低于该值时考虑防御
  defendChance: 0.5, // 满足上面条件时选择防御的概率
  maxTurns: 1000, // 安全上限，正常不会达到
};

function parseArgs(argv: string[]): { seed: number; quiet: boolean } {
  let seed = Date.now() >>> 0;
  let quiet = false;
  for (const arg of argv) {
    if (arg.startsWith('--seed=')) {
      const n = Number(arg.slice('--seed='.length));
      if (!Number.isFinite(n)) throw new Error(`种子必须是数字：${arg}`);
      seed = n >>> 0;
    } else if (arg === '--quiet') {
      quiet = true;
    }
  }
  return { seed, quiet };
}

const { seed, quiet } = parseArgs(process.argv.slice(2));
const engine = new BattleEngine(createDefaultSetup(seed));
// 脚本的决策随机数与引擎分开，互不影响
const policyRng = createRng(seed ^ 0x9e3779b9);

const unit = (id: UnitId): Unit => engine.getState().units[id]!;
const label = (id: UnitId): string => `${unit(id).name}(${id})`;
const skillName = (id: string): string => SKILLS[id]?.name ?? id;
const DAMAGE_TYPE_NAME = { physical: '物理', magic: '法术' } as const;
const DELIVERY_NAME = { melee: '近战冲锋', ranged: '原地射击', cast: '原地施法' } as const;

function describeCommand(cmd: Command): string {
  if (cmd.kind === 'defend') return '防御';
  if (cmd.kind === 'attack') return `普攻 → ${label(cmd.targetId)}`;
  return `${skillName(cmd.skillId)} → ${label(cmd.targetId)}`;
}

// ---------- 检查：任意时刻只有一个单位在行动 ----------
let activeActor: UnitId | null = null;
let actionCount = 0;
const violations: string[] = [];

function checkSingleActor(e: BattleEvent): void {
  switch (e.type) {
    case 'UnitActStart':
      if (activeActor !== null) violations.push(`#${e.seq} ${e.actorId} 开始行动时 ${activeActor} 尚未结束`);
      activeActor = e.actorId;
      actionCount += 1;
      break;
    case 'UnitActEnd':
      if (activeActor !== e.actorId) violations.push(`#${e.seq} ${e.actorId} 结束行动，但当前行动者是 ${activeActor}`);
      activeActor = null;
      break;
    case 'SkillCast':
    case 'HitResolved':
    case 'CommandFallback':
    case 'TargetRetargeted':
    case 'ActionFizzled':
      if (activeActor !== e.actorId) violations.push(`#${e.seq} ${e.type} 的行动者 ${e.actorId} 不是当前行动者 ${activeActor}`);
      break;
    default:
      break;
  }
}

// ---------- 文字日志 ----------
const log = (line: string): void => console.log(line);
const detail = (line: string): void => {
  if (!quiet) console.log(line);
};

function printEvent(e: BattleEvent): void {
  switch (e.type) {
    case 'BattleStart':
      log(`===== 战斗开始（种子 ${seed}）=====`);
      for (const side of ['ally', 'enemy'] as const) {
        log(side === 'ally' ? '友方：' : '敌方：');
        for (const u of e.units.filter((x) => x.side === side)) {
          detail(
            `  ${u.name}(${u.id}) 气血 ${u.stats.maxHp} 魔法 ${u.stats.maxMp} 物伤 ${u.stats.physAtk} ` +
              `法伤 ${u.stats.magAtk} 防御 ${u.stats.defense} 速度 ${u.stats.speed}`,
          );
        }
      }
      break;
    case 'TurnStart':
      log(`\n【第 ${e.turn} 回合】`);
      detail(
        '  出手顺序：' +
          e.turnOrder.map((id) => `${label(id)}${unit(id).alive ? '' : '[倒地]'}`).join(' > '),
      );
      break;
    case 'DefendApplied':
      detail(`  ◆ ${label(e.unitId)} 进入防御，本回合受到的伤害减半`);
      break;
    case 'UnitActStart':
      detail(`  ▶ ${label(e.actorId)} 出手：${describeCommand(e.command)}`);
      break;
    case 'CommandFallback':
      detail(`      ${skillName(e.fromSkillId)} 无法使用（${e.reason === 'sealed' ? '被封印' : '魔法不足'}），改为${skillName(e.toSkillId)}`);
      break;
    case 'TargetRetargeted':
      detail(`      原目标 ${label(e.fromId)} 已失效，改为攻击 ${label(e.toId)}`);
      break;
    case 'ActionFizzled':
      detail(`      没有合法目标，本次出手作废`);
      break;
    case 'SkillCast':
      detail(
        `      ${skillName(e.skillId)}（${DELIVERY_NAME[e.delivery]}）` +
          (e.targets.length > 1 ? ` → ${e.targets.length} 个目标：${e.targets.join(' ')}` : '') +
          (e.mpCost > 0 ? `，魔法 ${e.mpBefore}→${e.mpAfter}` : ''),
      );
      break;
    case 'HitResolved':
      if (e.isMiss) {
        detail(`      未命中 ${label(e.targetId)}`);
      } else {
        detail(
          `      命中 ${label(e.targetId)}：${DAMAGE_TYPE_NAME[e.damageType]}伤害 ${e.damage}` +
            `${e.isCrit ? '【暴击】' : ''}${e.defended ? '【防御减半】' : ''}，气血 ${e.hpBefore}→${e.hpAfter}`,
        );
      }
      break;
    case 'UnitDied':
      log(`      ✖ ${label(e.unitId)} ${e.vanish ? '被击败，从场上消失' : '倒地'}`);
      break;
    case 'HealResolved':
      detail(
        `      治疗 ${label(e.targetId)}：回复 ${e.amount}${e.isCrit ? '【暴击】' : ''}，气血 ${e.hpBefore}→${e.hpAfter}`,
      );
      break;
    case 'StatusApplied':
      detail(`      封印 ${label(e.unitId)}，持续 ${e.remainingTurns} 回合`);
      break;
    case 'StatusResisted':
      detail(`      ${label(e.unitId)} 抵抗了封印`);
      break;
    case 'StatusTicked':
      detail(`  · ${label(e.unitId)} 的封印还剩 ${e.remainingTurns} 回合`);
      break;
    case 'StatusRemoved':
      if (e.reason === 'expired') detail(`  · ${label(e.unitId)} 的封印解除`);
      break;
    case 'UnitRevived':
      log(
        `      ✚ ${label(e.unitId)} 被复活，气血 ${e.hpAfter}/${e.maxHp}` +
          (e.actsThisTurn ? '（本回合还能出手）' : '（本回合不再出手）'),
      );
      break;
    case 'CommandRequested':
      detail(`  ？ ${label(e.unitId)} 刚被复活，现场下指令`);
      break;
    case 'UnitActEnd':
      detail(`  ◀ ${label(e.actorId)} 行动结束`);
      break;
    case 'TurnEnd': {
      const s = engine.getState();
      const alive = (side: 'ally' | 'enemy'): number =>
        s.unitIds.filter((id) => s.units[id]!.side === side && s.units[id]!.alive).length;
      log(`  —— 第 ${e.turn} 回合结束：友方存活 ${alive('ally')}，敌方存活 ${alive('enemy')}`);
      break;
    }
    case 'BattleEnd':
      log(`\n===== 战斗结束：${e.winner === 'ally' ? '友方' : '敌方'}获胜，共 ${e.turns} 回合 =====`);
      break;
    default:
      break;
  }
}

engine.events.onAny((e) => {
  checkSingleActor(e);
  printEvent(e);
});

// ---------- 主循环 ----------
engine.start();
while (engine.getState().phase !== 'ended') {
  if (engine.getState().turn > SIM_POLICY.maxTurns) {
    throw new Error(`超过 ${SIM_POLICY.maxTurns} 回合仍未结束`);
  }
  // 指令阶段：代替玩家给每个待指令单位下指令
  for (const id of engine.getPendingCommandUnits()) {
    const u = unit(id);
    const wantDefend =
      u.hp / u.stats.maxHp < SIM_POLICY.defendHpRatio && policyRng.next() < SIM_POLICY.defendChance;
    const cmd: Command = wantDefend ? { kind: 'defend' } : engine.suggestCommand(id);
    const result = engine.submitCommand(id, cmd);
    if (!result.ok) throw new Error(`指令被拒绝：${id} ${JSON.stringify(cmd)} 原因 ${result.reason}`);
  }
  engine.beginExecution();
  // 执行阶段：一次一个单位出手
  while (engine.getState().phase === 'execution') {
    // 刚复活的单位轮到出手：现场下指令
    const waiting = engine.getState().awaitingCommandFor;
    if (waiting !== null) {
      const result = engine.submitCommand(waiting, engine.suggestCommand(waiting));
      if (!result.ok) throw new Error(`指令被拒绝：${waiting} 原因 ${result.reason}`);
    }
    engine.stepAction();
  }
}

// ---------- 结果 ----------
const finalState = engine.getState();
log('\n存活单位：');
for (const id of finalState.unitIds) {
  const u = finalState.units[id]!;
  if (u.alive) log(`  ${label(id)} 气血 ${u.hp}/${u.stats.maxHp}`);
}
log(`\n共 ${actionCount} 次出手。`);
if (violations.length === 0) {
  log('检查通过：任意时刻只有一个单位在行动。');
} else {
  log(`检查失败：发现 ${violations.length} 处同时行动：`);
  for (const v of violations) log(`  ${v}`);
  process.exitCode = 1;
}

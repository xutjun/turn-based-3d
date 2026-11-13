// 指令校验与可用指令查询（对应 DESIGN.md §3.2、§5.9、§8.2）。

import { isSealed } from './status';
import { isValidTarget } from './targeting';
import type {
  BattleState,
  Command,
  CommandOptions,
  CommandRejectReason,
  SkillDef,
  SkillId,
  Unit,
  UnitId,
} from './types';

export type SkillTable = Record<SkillId, SkillDef>;

/** 技能当前不可用的原因；可用时返回 undefined。被封印优先于魔法不足。 */
export function getSkillDisabledReason(unit: Unit, skill: SkillDef): 'noMp' | 'sealed' | undefined {
  if (isSealed(unit)) return 'sealed';
  if (unit.mp < skill.mpCost) return 'noMp'; // 魔法为 0 或不足时不能用技能
  return undefined;
}

/** 某单位当前可用的指令和技能（界面据此置灰） */
export function getCommandOptions(
  state: BattleState,
  skills: SkillTable,
  unitId: UnitId,
): CommandOptions {
  const unit = state.units[unitId];
  if (!unit || !unit.alive) return { canAttack: false, canDefend: false, skills: [] };
  return {
    canAttack: true,
    canDefend: true,
    skills: unit.skillIds.map((skillId) => {
      const reason = getSkillDisabledReason(unit, skills[skillId]!);
      return reason ? { skillId, enabled: false, disabledReason: reason } : { skillId, enabled: true };
    }),
  };
}

/** 取出指令对应的技能定义；指令里的技能不存在或不属于该单位时返回 null */
export function getCommandSkill(skills: SkillTable, unit: Unit, cmd: Command): SkillDef | null {
  if (cmd.kind === 'attack') return skills[unit.basicAttackSkillId] ?? null;
  if (cmd.kind === 'skill') {
    if (!unit.skillIds.includes(cmd.skillId)) return null;
    return skills[cmd.skillId] ?? null;
  }
  return null;
}

/**
 * 校验一条指令（不含阶段、存活、可指挥的检查，那些由引擎负责）。
 * 合法返回 null，否则返回拒绝原因。
 */
export function validateCommand(
  state: BattleState,
  skills: SkillTable,
  unit: Unit,
  cmd: Command,
): CommandRejectReason | null {
  if (cmd.kind === 'defend') return null;

  const skill = getCommandSkill(skills, unit, cmd);
  if (!skill) return 'unknownSkill';

  if (cmd.kind === 'skill') {
    const reason = getSkillDisabledReason(unit, skill);
    if (reason) return reason;
  }

  const target = state.units[cmd.targetId];
  if (!target || !isValidTarget(unit, skill, target)) return 'invalidTarget';
  return null;
}

// 战斗日志：把逻辑事件翻译成一行行文字。纯函数，不依赖 DOM。

import type { BattleEvent } from '../../core/events';
import type { SkillId, UnitId } from '../../core/types';

/** 日志行的语气，界面按它上色 */
export type LogTone = 'turn' | 'action' | 'damage' | 'crit' | 'miss' | 'heal' | 'status' | 'death' | 'revive' | 'info' | 'end';

export interface LogLine {
  tone: LogTone;
  text: string;
  /** 是否缩进（一次出手下面的结算明细） */
  detail: boolean;
}

export interface LogContext {
  unitName(id: UnitId): string;
  skillName(id: SkillId): string;
  isBasicSkill(id: SkillId): boolean;
}

/** 把一批事件翻译成日志行；不需要记录的事件（阶段切换等）被忽略 */
export function formatLogLines(events: readonly BattleEvent[], ctx: LogContext): LogLine[] {
  const lines: LogLine[] = [];
  const n = ctx.unitName;
  const top = (tone: LogTone, text: string): void => void lines.push({ tone, text, detail: false });
  const sub = (tone: LogTone, text: string): void => void lines.push({ tone, text, detail: true });

  for (const e of events) {
    switch (e.type) {
      case 'TurnStart':
        top('turn', `第 ${e.turn} 回合`);
        break;
      case 'DefendApplied':
        top('info', `${n(e.unitId)} 摆出防御姿态`);
        break;
      case 'CommandFallback':
        top(
          'info',
          `${n(e.actorId)} ${e.reason === 'sealed' ? '被封印' : '魔法不足'}，「${ctx.skillName(e.fromSkillId)}」改为普攻`,
        );
        break;
      case 'TargetRetargeted':
        top('info', `${n(e.actorId)} 的目标已失效，改为 ${n(e.toId)}`);
        break;
      case 'ActionFizzled':
        top('info', `${n(e.actorId)} 没有可选目标，出手作废`);
        break;
      case 'SkillCast': {
        const targets = e.targets.map(n).join('、');
        const cost = e.mpCost > 0 ? `（魔法 -${e.mpCost}）` : '';
        top(
          'action',
          ctx.isBasicSkill(e.skillId)
            ? `${n(e.actorId)} 攻击 ${targets}`
            : `${n(e.actorId)} 使用「${ctx.skillName(e.skillId)}」→ ${targets}${cost}`,
        );
        break;
      }
      case 'HitResolved':
        if (e.isMiss) sub('miss', `${n(e.targetId)} 躲开了攻击`);
        else
          sub(
            e.isCrit ? 'crit' : 'damage',
            `${n(e.targetId)} 受到 ${e.damage} 点伤害${e.isCrit ? '（暴击）' : ''}${e.defended ? '（防御）' : ''}`,
          );
        break;
      case 'HealResolved':
        sub('heal', `${n(e.targetId)} 回复 ${e.amount} 点气血${e.isCrit ? '（暴击）' : ''}`);
        break;
      case 'UnitDied':
        sub('death', e.vanish ? `${n(e.unitId)} 被击败` : `${n(e.unitId)} 倒地`);
        break;
      case 'UnitRevived':
        sub('revive', `${n(e.unitId)} 被复活（气血 ${e.hpAfter}/${e.maxHp}）${e.queuedAtEnd ? '，本回合排到队尾出手' : ''}`);
        break;
      case 'PassiveTriggered':
        sub('info', `${n(e.unitId)} 触发「${e.name}」，再攻击一次`);
        break;
      case 'StatusApplied':
        sub('status', `${n(e.unitId)} 被封印 ${e.remainingTurns} 回合`);
        break;
      case 'StatusResisted':
        sub('miss', `${n(e.unitId)} 抵抗了封印`);
        break;
      case 'StatusRemoved':
        if (e.reason === 'expired') top('status', `${n(e.unitId)} 的封印解除`);
        break;
      case 'BattleEnd':
        top('end', e.winner === 'ally' ? `战斗胜利 · 共 ${e.turns} 回合` : `战斗失败 · 共 ${e.turns} 回合`);
        break;
      default:
        break;
    }
  }
  return lines;
}

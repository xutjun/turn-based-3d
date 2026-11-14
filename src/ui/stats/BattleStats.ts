// 战斗统计：从逻辑事件累计每个单位的伤害、治疗、击败数等，结算界面用。不依赖 DOM。

import type { BattleEvent } from '../../core/events';
import type { Side, UnitId, UnitKind } from '../../core/types';

export interface UnitStats {
  id: UnitId;
  name: string;
  side: Side;
  kind: UnitKind;
  damageDealt: number;
  damageTaken: number;
  healing: number;
  kills: number;
  crits: number;
  alive: boolean; // 战斗结束时是否存活
}

export interface BattleSummary {
  winner: Side | null;
  turns: number;
  actions: number; // 全场出手次数
  allies: UnitStats[];
  enemies: UnitStats[];
  allyDamage: number; // 我方造成的总伤害
  enemyDamage: number; // 敌方造成的总伤害
  allyHealing: number;
  allySurvivors: number;
  enemySurvivors: number;
  /** 我方伤害最高的单位；没有造成任何伤害时为 null */
  mvp: UnitId | null;
}

export class BattleStats {
  private readonly units = new Map<UnitId, UnitStats>();
  private order: UnitId[] = [];
  private winner: Side | null = null;
  private turns = 0;
  private actions = 0;

  /** 累计一批事件 */
  consume(events: readonly BattleEvent[]): void {
    for (const e of events) this.consumeOne(e);
  }

  private consumeOne(e: BattleEvent): void {
    this.turns = Math.max(this.turns, e.turn);
    switch (e.type) {
      case 'BattleStart':
        this.units.clear();
        this.order = e.units.map((u) => u.id);
        for (const u of e.units) {
          this.units.set(u.id, {
            id: u.id,
            name: u.name,
            side: u.side,
            kind: u.kind,
            damageDealt: 0,
            damageTaken: 0,
            healing: 0,
            kills: 0,
            crits: 0,
            alive: u.hp > 0,
          });
        }
        break;
      case 'UnitActStart':
        this.actions += 1;
        break;
      case 'HitResolved': {
        if (e.isMiss) break;
        // 以实际扣掉的气血为准（最后一击不会多算溢出的伤害）
        const lost = e.hpBefore - e.hpAfter;
        const actor = this.units.get(e.actorId);
        const target = this.units.get(e.targetId);
        if (actor) {
          actor.damageDealt += lost;
          if (e.isCrit) actor.crits += 1;
        }
        if (target) target.damageTaken += lost;
        break;
      }
      case 'HealResolved': {
        const actor = this.units.get(e.actorId);
        if (actor) actor.healing += e.amount;
        break;
      }
      case 'UnitDied': {
        const unit = this.units.get(e.unitId);
        const killer = this.units.get(e.killerId);
        if (unit) unit.alive = false;
        if (killer) killer.kills += 1;
        break;
      }
      case 'UnitRevived': {
        const unit = this.units.get(e.unitId);
        if (unit) unit.alive = true;
        break;
      }
      case 'BattleEnd':
        this.winner = e.winner;
        this.turns = e.turns;
        break;
      default:
        break;
    }
  }

  summary(): BattleSummary {
    const all = this.order.map((id) => ({ ...this.units.get(id)! }));
    const allies = all.filter((u) => u.side === 'ally');
    const enemies = all.filter((u) => u.side === 'enemy');
    const sum = (list: UnitStats[], pick: (u: UnitStats) => number): number => list.reduce((acc, u) => acc + pick(u), 0);
    let mvp: UnitStats | null = null;
    for (const u of allies) {
      if (u.damageDealt > 0 && (!mvp || u.damageDealt > mvp.damageDealt)) mvp = u;
    }
    return {
      winner: this.winner,
      turns: this.turns,
      actions: this.actions,
      allies,
      enemies,
      allyDamage: sum(allies, (u) => u.damageDealt),
      enemyDamage: sum(enemies, (u) => u.damageDealt),
      allyHealing: sum(allies, (u) => u.healing),
      allySurvivors: allies.filter((u) => u.alive).length,
      enemySurvivors: enemies.filter((u) => u.alive).length,
      mvp: mvp?.id ?? null,
    };
  }
}

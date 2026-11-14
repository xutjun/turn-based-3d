import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import type { BattleEvent } from '../../src/core/events';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { SKILLS } from '../../src/data/skills';
import { autoPlay, ofType } from '../helpers';

/** 用默认 10v10 阵容和给定种子自动打完一场，返回全部事件 */
function playDefault(seed: number): BattleEvent[] {
  const engine = new BattleEngine(createDefaultSetup(seed));
  const events: BattleEvent[] = [];
  engine.events.onAny((e) => events.push(e));
  autoPlay(engine);
  return events;
}

describe('完整 10v10 战斗', () => {
  const seeds = [1, 2, 3, 42, 2026];

  it('能从开始打到一方全灭', () => {
    for (const seed of seeds) {
      const events = playDefault(seed);
      expect(events.at(-1)!.type).toBe('BattleEnd');
      expect(ofType(events, 'BattleEnd')).toHaveLength(1);
      expect(ofType(events, 'BattleStart')[0]!.units).toHaveLength(20);
    }
  });

  it('任意时刻只有一个单位在行动，且每回合严格按速度顺序、每个单位最多出手一次', () => {
    for (const seed of seeds) {
      const events = playDefault(seed);
      let active: string | null = null;
      let order: string[] = [];
      let cursor = -1;
      for (const e of events) {
        if (e.type === 'TurnStart') {
          expect(active).toBeNull();
          order = e.turnOrder;
          cursor = -1;
        } else if (e.type === 'UnitActStart') {
          expect(active).toBeNull(); // 上一个单位必须已经结束
          active = e.actorId;
          const index = order.indexOf(e.actorId);
          expect(index).toBeGreaterThan(cursor); // 顺序只能往后走，不能重复
          cursor = index;
        } else if (e.type === 'UnitActEnd') {
          expect(e.actorId).toBe(active);
          active = null;
        } else if (e.type === 'SkillCast' || e.type === 'HitResolved') {
          expect(e.actorId).toBe(active);
        }
      }
    }
  });

  it('出手顺序按速度从高到低', () => {
    const events = playDefault(7);
    const speed = new Map(ofType(events, 'BattleStart')[0]!.units.map((u) => [u.id, u.stats.speed]));
    for (const t of ofType(events, 'TurnStart')) {
      const speeds = t.turnOrder.map((id) => speed.get(id)!);
      expect(speeds).toEqual([...speeds].sort((a, b) => b - a));
    }
  });

  it('死亡单位不再出手，也不再被攻击、被治疗；被复活后才能重新出手', () => {
    for (const seed of seeds) {
      const dead = new Set<string>();
      for (const e of playDefault(seed)) {
        if (e.type === 'UnitDied') dead.add(e.unitId);
        if (e.type === 'UnitRevived') expect(dead.delete(e.unitId)).toBe(true);
        if (e.type === 'HealResolved') expect(dead.has(e.targetId)).toBe(false);
        if (e.type === 'UnitActStart') expect(dead.has(e.actorId)).toBe(false);
        if (e.type === 'HitResolved') expect(dead.has(e.targetId)).toBe(false);
      }
    }
  });

  it('相同种子的战斗过程完全相同，不同种子不同', () => {
    const a = JSON.stringify(playDefault(123));
    const b = JSON.stringify(playDefault(123));
    const c = JSON.stringify(playDefault(124));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('气血变化前后连贯：每次命中 / 治疗的 hpBefore 等于该单位上一次的 hpAfter', () => {
    const events = playDefault(5);
    const hp = new Map(ofType(events, 'BattleStart')[0]!.units.map((u) => [u.id, u.hp]));
    for (const e of events) {
      if (e.type === 'HitResolved') {
        expect(e.hpBefore).toBe(hp.get(e.targetId));
        expect(e.hpAfter).toBe(Math.max(0, e.hpBefore - e.damage));
        expect(e.killed).toBe(e.hpAfter === 0 && !e.isMiss);
        hp.set(e.targetId, e.hpAfter);
      } else if (e.type === 'HealResolved') {
        expect(e.hpBefore).toBe(hp.get(e.targetId));
        expect(e.hpAfter).toBe(e.hpBefore + e.amount);
        hp.set(e.targetId, e.hpAfter);
      } else if (e.type === 'UnitRevived') {
        expect(hp.get(e.unitId)).toBe(0);
        hp.set(e.unitId, e.hpAfter);
      }
    }
  });

  const ALL_SKILLS = ['combo_slash', 'triple_shot', 'whirlwind', 'arrow_rain', 'group_spell', 'group_spell_fire', 'single_spell', 'seal', 'group_heal', 'revive'];

  it('整场自动战斗里每个技能都会出现（种子 64、66 的单场内十个技能全部出现）', () => {
    for (const seed of [64, 66]) {
      const used = new Set(ofType(playDefault(seed), 'SkillCast').map((c) => c.skillId));
      for (const id of ALL_SKILLS) expect(used.has(id), `种子 ${seed}：${id}`).toBe(true);
    }
  });

  it('封印会递减到期，倒地的友方会被复活并重新出手', () => {
    const events = playDefault(64);
    expect(ofType(events, 'StatusApplied').length).toBeGreaterThan(0);
    expect(ofType(events, 'StatusTicked').length).toBeGreaterThan(0);
    expect(ofType(events, 'StatusRemoved').some((e) => e.reason === 'expired')).toBe(true);
    const revived = ofType(events, 'UnitRevived');
    expect(revived.length).toBeGreaterThan(0);
    const first = revived[0]!;
    expect(events.some((e) => e.type === 'UnitActStart' && e.actorId === first.unitId && e.seq > first.seq)).toBe(true);
  });

  it('技能结算符合规则：魔法只扣一次且不为负，目标数不超上限，段数与步数正确，被封印者不放技能', () => {
    for (const seed of seeds) {
      const events = playDefault(seed);
      const mp = new Map(ofType(events, 'BattleStart')[0]!.units.map((u) => [u.id, u.mp]));
      const side = new Map(ofType(events, 'BattleStart')[0]!.units.map((u) => [u.id, u.side]));
      const sealed = new Set<string>();
      let cast: Extract<BattleEvent, { type: 'SkillCast' }> | null = null;
      let castsThisAction = 0;
      for (const e of events) {
        switch (e.type) {
          case 'UnitActStart':
            cast = null;
            castsThisAction = 0;
            break;
          case 'SkillCast': {
            const skill = SKILLS[e.skillId]!;
            castsThisAction += 1;
            expect(castsThisAction).toBe(1); // 一次出手只施放一次、只扣一次魔法
            expect(e.mpCost).toBe(skill.mpCost);
            expect(e.mpBefore).toBe(mp.get(e.actorId));
            expect(e.mpAfter).toBe(e.mpBefore - e.mpCost);
            expect(e.mpAfter).toBeGreaterThanOrEqual(0);
            mp.set(e.actorId, e.mpAfter);
            expect(e.targets.length).toBeGreaterThan(0);
            expect(e.targets.length).toBeLessThanOrEqual(skill.targetCount);
            expect(new Set(e.targets).size).toBe(e.targets.length);
            for (const id of e.targets) {
              expect(side.get(id) === side.get(e.actorId)).toBe(skill.targetSide === 'ally');
            }
            if (skill.classId !== 'common') expect(sealed.has(e.actorId)).toBe(false);
            expect(e.animation).toBe(skill.animation[e.delivery]);
            cast = e;
            break;
          }
          case 'HitResolved': {
            const skill = SKILLS[e.skillId]!;
            expect(cast!.targets).toContain(e.targetId);
            expect(e.hitCount).toBe(skill.hits);
            if (skill.pattern === 'sequential') {
              expect(e.stepCount).toBe(cast!.targets.length);
              expect(cast!.targets[e.stepIndex]).toBe(e.targetId);
            } else if (skill.pattern === 'multiHit') {
              expect(e.stepIndex).toBe(e.hitIndex);
            } else {
              expect([e.stepIndex, e.stepCount]).toEqual([0, 1]);
            }
            break;
          }
          case 'HealResolved':
            expect(cast!.targets).toContain(e.targetId);
            expect(e.amount).toBeGreaterThanOrEqual(0);
            break;
          case 'StatusApplied':
            expect(sealed.has(e.unitId)).toBe(false); // 不重复封印
            sealed.add(e.unitId);
            break;
          case 'StatusRemoved':
            sealed.delete(e.unitId);
            break;
          default:
            break;
        }
      }
    }
  });

  it('宝宝自动出手时同样能打完', () => {
    const engine = new BattleEngine(createDefaultSetup(9, { petAutoCommand: true }));
    autoPlay(engine);
    expect(engine.getState().phase).toBe('ended');
  });
});

import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import type { BattleEvent } from '../../src/core/events';
import { createDefaultSetup } from '../../src/data/defaultSetup';
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

  it('死亡单位不再出手，也不再被攻击', () => {
    for (const seed of seeds) {
      const dead = new Set<string>();
      for (const e of playDefault(seed)) {
        if (e.type === 'UnitDied') dead.add(e.unitId);
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

  it('气血变化前后连贯：每次命中的 hpBefore 等于该单位上一次的 hpAfter', () => {
    const events = playDefault(5);
    const hp = new Map(ofType(events, 'BattleStart')[0]!.units.map((u) => [u.id, u.hp]));
    for (const h of ofType(events, 'HitResolved')) {
      expect(h.hpBefore).toBe(hp.get(h.targetId));
      expect(h.hpAfter).toBe(Math.max(0, h.hpBefore - h.damage));
      expect(h.killed).toBe(h.hpAfter === 0 && !h.isMiss);
      hp.set(h.targetId, h.hpAfter);
    }
  });
});

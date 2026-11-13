import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { buildTurnOrder } from '../../src/core/turnOrder';
import { constRng, makeEngine, makeUnit, ofType, runExecution, seqRng } from '../helpers';

describe('出手排序', () => {
  it('按速度从高到低', () => {
    const units = [
      makeUnit('A0', 'ally', { stats: { speed: 30 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 90 } }),
      makeUnit('A1', 'ally', { stats: { speed: 60 } }),
      makeUnit('E1', 'enemy', { stats: { speed: 10 } }),
    ];
    expect(buildTurnOrder(units, createRng(1))).toEqual(['E0', 'A1', 'A0', 'E1']);
  });

  it('速度都不相同时不消耗随机数', () => {
    const units = [
      makeUnit('A0', 'ally', { stats: { speed: 30 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 90 } }),
    ];
    const rng = seqRng([]);
    buildTurnOrder(units, rng);
    expect(rng.used()).toBe(0);
  });

  it('速度相同时随机，但相同种子结果相同', () => {
    const units = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map((id) =>
      makeUnit(id, 'ally', { stats: { speed: 50 } }),
    );
    const first = buildTurnOrder(units, createRng(42));
    expect(buildTurnOrder(units, createRng(42))).toEqual(first);
    expect([...first].sort()).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
    // 不同种子下应当出现不同的顺序
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) seen.add(buildTurnOrder(units, createRng(seed)).join());
    expect(seen.size).toBeGreaterThan(1);
  });

  it('同速只在同速组内打乱，不会越过更快或更慢的单位', () => {
    const units = [
      makeUnit('SLOW', 'ally', { stats: { speed: 10 } }),
      makeUnit('T1', 'ally', { stats: { speed: 50 } }),
      makeUnit('T2', 'enemy', { stats: { speed: 50 } }),
      makeUnit('T3', 'ally', { stats: { speed: 50 } }),
      makeUnit('FAST', 'enemy', { stats: { speed: 99 } }),
    ];
    for (let seed = 0; seed < 30; seed++) {
      const order = buildTurnOrder(units, createRng(seed));
      expect(order[0]).toBe('FAST');
      expect(order[4]).toBe('SLOW');
      expect(order.slice(1, 4).sort()).toEqual(['T1', 'T2', 'T3']);
    }
  });

  it('倒地的友方保留在顺序里（可能被复活），被击败的敌方不参与', () => {
    const units = [
      makeUnit('A0', 'ally', { stats: { speed: 30 } }),
      makeUnit('A1', 'ally', { stats: { speed: 80 }, alive: false, hp: 0 }),
      makeUnit('E0', 'enemy', { stats: { speed: 90 }, alive: false, hp: 0 }),
      makeUnit('E1', 'enemy', { stats: { speed: 10 } }),
    ];
    expect(buildTurnOrder(units, createRng(1))).toEqual(['A1', 'A0', 'E1']);
  });

  it('每回合开始重新排序：同速单位在不同回合可以有不同先后', () => {
    // 4 个同速单位，伤害很低，战斗能持续很多回合
    const units = [
      makeUnit('A0', 'ally', { stats: { maxHp: 100000 } }),
      makeUnit('A1', 'ally', { stats: { maxHp: 100000 } }),
      makeUnit('E0', 'enemy', { stats: { maxHp: 100000 } }),
      makeUnit('E1', 'enemy', { stats: { maxHp: 100000 } }),
    ];
    const { engine, events } = makeEngine(units, { rng: createRng(2024) });
    engine.start();
    for (let t = 0; t < 12; t++) {
      for (const id of engine.getPendingCommandUnits()) {
        engine.submitCommand(id, { kind: 'defend' });
      }
      engine.beginExecution();
      runExecution(engine);
    }
    const orders = ofType(events, 'TurnStart').map((e) => e.turnOrder.join());
    expect(orders.length).toBe(13);
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it('执行阶段严格按 TurnStart 给出的顺序出手', () => {
    const units = [
      makeUnit('A0', 'ally', { stats: { speed: 30, maxHp: 9999 } }),
      makeUnit('A1', 'ally', { stats: { speed: 70, maxHp: 9999 } }),
      makeUnit('E0', 'enemy', { stats: { speed: 90, maxHp: 9999 } }),
      makeUnit('E1', 'enemy', { stats: { speed: 50, maxHp: 9999 } }),
    ];
    const { engine, events } = makeEngine(units, { rng: constRng(0.5) });
    engine.start();
    engine.submitCommand('A0', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('A1', { kind: 'attack', targetId: 'E0' });
    engine.submitCommand('E0', { kind: 'attack', targetId: 'A0' });
    engine.submitCommand('E1', { kind: 'attack', targetId: 'A0' });
    engine.beginExecution();
    runExecution(engine);
    const turn1 = events.filter((e) => e.turn === 1);
    expect(ofType(turn1, 'TurnStart')[0]!.turnOrder).toEqual(['E0', 'A1', 'E1', 'A0']);
    expect(ofType(turn1, 'UnitActStart').map((e) => e.actorId)).toEqual(['E0', 'A1', 'E1', 'A0']);
  });
});

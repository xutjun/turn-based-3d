import { describe, expect, it } from 'vitest';
import { createRng, randInt, randRange, shuffleInPlace } from '../../src/core/rng';

describe('随机数', () => {
  it('相同种子产生相同序列', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('不同种子产生不同序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    const sa = Array.from({ length: 10 }, () => a.next());
    const sb = Array.from({ length: 10 }, () => b.next());
    expect(sa).not.toEqual(sb);
  });

  it('取值范围在 [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('randRange / randInt 落在指定范围内', () => {
    const r = createRng(9);
    for (let i = 0; i < 500; i++) {
      const v = randRange(r, 0.9, 1.1);
      expect(v).toBeGreaterThanOrEqual(0.9);
      expect(v).toBeLessThan(1.1);
      const n = randInt(r, 5);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(5);
    }
  });

  it('洗牌保留全部元素，且相同种子结果相同', () => {
    const a = shuffleInPlace(createRng(3), [1, 2, 3, 4, 5, 6]);
    const b = shuffleInPlace(createRng(3), [1, 2, 3, 4, 5, 6]);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

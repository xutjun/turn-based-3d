import { Color, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../../src/render/fx/particles';

const WHITE = new Color(1, 1, 1);
/** 在 x 处生成一个静止的粒子，寿命 life 秒 */
const put = (pool: ParticlePool, x: number, life: number): void => pool.spawn(x, 0, 0, 0, 0, 0, life, 0.1, WHITE, 1, 0, 0, 0, 0);
/** 当前存活粒子的 x 坐标 */
const xs = (pool: ParticlePool): number[] => {
  const pos = pool.points.geometry.getAttribute('position');
  return Array.from({ length: pool.count }, (_, i) => pos.getX(i)).sort((a, b) => a - b);
};

describe('粒子池', () => {
  it('粒子到寿命后被回收，其余粒子不受影响', () => {
    const pool = new ParticlePool(8, new Texture());
    put(pool, 1, 0.1);
    put(pool, 2, 1);
    put(pool, 3, 0.1);
    put(pool, 4, 1);
    pool.update(0.05);
    expect(pool.count).toBe(4);
    pool.update(0.1); // 1 和 3 到寿命
    expect(xs(pool)).toEqual([2, 4]);
    expect(pool.points.geometry.drawRange.count).toBe(2);
    pool.update(1);
    expect(pool.count).toBe(0);
    expect(pool.points.geometry.drawRange.count).toBe(0);
  });

  it('容量固定：池满后新粒子被丢弃，不会扩容；回收后的位置可以复用', () => {
    const pool = new ParticlePool(3, new Texture());
    for (let i = 0; i < 10; i++) put(pool, i, 0.5);
    expect(pool.count).toBe(3);
    expect(pool.peak).toBe(3);
    const buffer = pool.points.geometry.getAttribute('position').array;
    pool.update(1);
    expect(pool.count).toBe(0);
    for (let i = 0; i < 2; i++) put(pool, 7, 0.5);
    pool.update(0.01);
    expect(xs(pool)).toEqual([7, 7]);
    expect(pool.points.geometry.getAttribute('position').array).toBe(buffer); // 还是同一块内存
  });

  it('速度、重力推动粒子；亮度先亮起后熄灭', () => {
    const pool = new ParticlePool(4, new Texture());
    pool.spawn(0, 1, 0, 2, 0, 0, 1, 0.1, WHITE, 1, 0, 10, 0, 0);
    pool.update(0.1);
    const pos = pool.points.geometry.getAttribute('position');
    const col = pool.points.geometry.getAttribute('aColor');
    expect(pos.getX(0)).toBeCloseTo(0.2);
    expect(pos.getY(0)).toBeLessThan(1); // 重力向下
    const early = col.getX(0);
    pool.update(0.8);
    expect(col.getX(0)).toBeLessThan(early);
    expect(col.getX(0)).toBeGreaterThan(0);
  });

  it('clear() 立即清空（跳过动画时使用）', () => {
    const pool = new ParticlePool(4, new Texture());
    put(pool, 1, 5);
    put(pool, 2, 5);
    pool.clear();
    expect(pool.count).toBe(0);
    pool.update(0.016);
    expect(pool.points.geometry.drawRange.count).toBe(0);
  });
});

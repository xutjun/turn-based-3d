import { describe, expect, it } from 'vitest';
import {
  FORMATION,
  allSlots,
  facingOf,
  facingYawOf,
  slotKey,
  slotPosition,
} from '../../src/data/formation';

const near = (v: { x: number; z: number }, x: number, z: number): void => {
  expect(v.x).toBeCloseTo(x, 3);
  expect(v.z).toBeCloseTo(z, 3);
};

describe('阵型世界坐标', () => {
  it('前排坐标与设计文档 §7.3 的表一致', () => {
    near(slotPosition('ally', { row: 0, col: 0 }), 1.389, 7.611);
    near(slotPosition('ally', { row: 0, col: 1 }), 2.944, 6.056);
    near(slotPosition('ally', { row: 0, col: 2 }), 4.5, 4.5);
    near(slotPosition('ally', { row: 0, col: 3 }), 6.056, 2.944);
    near(slotPosition('ally', { row: 0, col: 4 }), 7.611, 1.389);
    near(slotPosition('enemy', { row: 0, col: 0 }), -7.611, -1.389);
    near(slotPosition('enemy', { row: 0, col: 2 }), -4.5, -4.5);
    near(slotPosition('enemy', { row: 0, col: 4 }), -1.389, -7.611);
  });

  it('后排在前排身后（远离对方）一个排间距', () => {
    for (let col = 0; col < 5; col++) {
      const c = col as 0 | 1 | 2 | 3 | 4;
      const af = slotPosition('ally', { row: 0, col: c });
      const ab = slotPosition('ally', { row: 1, col: c });
      near(ab, af.x + 1.414, af.z + 1.414);
      const ef = slotPosition('enemy', { row: 0, col: c });
      const eb = slotPosition('enemy', { row: 1, col: c });
      near(eb, ef.x - 1.414, ef.z - 1.414);
    }
  });

  it('敌方在画面左上（−x, −z），友方在右下（+x, +z）', () => {
    for (const slot of allSlots()) {
      const a = slotPosition('ally', slot);
      const e = slotPosition('enemy', slot);
      expect(a.x + a.z).toBeGreaterThan(0);
      expect(e.x + e.z).toBeLessThan(0);
    }
  });

  it('双方互相面对', () => {
    const fa = facingOf('ally');
    const fe = facingOf('enemy');
    expect(fa.x + fe.x).toBeCloseTo(0);
    expect(fa.z + fe.z).toBeCloseTo(0);
    // 友方朝向指向敌方中心
    const dx = FORMATION.enemyFrontCenter.x - FORMATION.allyFrontCenter.x;
    const dz = FORMATION.enemyFrontCenter.z - FORMATION.allyFrontCenter.z;
    expect(fa.x * dx + fa.z * dz).toBeGreaterThan(0);
    expect(Math.abs(facingYawOf('ally') - facingYawOf('enemy'))).toBeCloseTo(Math.PI);
  });

  it('每方 10 个格子，坐标互不重叠', () => {
    const slots = allSlots();
    expect(slots).toHaveLength(10);
    expect(new Set(slots.map(slotKey)).size).toBe(10);
    const all = [
      ...slots.map((s) => slotPosition('ally', s)),
      ...slots.map((s) => slotPosition('enemy', s)),
    ];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(Math.hypot(all[i]!.x - all[j]!.x, all[i]!.z - all[j]!.z)).toBeGreaterThan(1.5);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import { frameDelta } from '../../src/render/frameClock';

// 渲染循环的帧间隔（步骤 17 修正的 bug：rAF 时间戳早于上一次记下的时刻时，间隔是负数，演出时钟倒退）

describe('帧间隔', () => {
  it('正常的一帧：按真实间隔', () => {
    expect(frameDelta(1016, 1000, 0.1)).toBeCloseTo(0.016, 9);
  });

  it('时间戳早于上一次记下的时刻：按 0（演出时钟不倒退）', () => {
    expect(frameDelta(1000, 6190, 0.1)).toBe(0);
    expect(frameDelta(1000, 1000, 0.1)).toBe(0);
    expect(frameDelta(Number.NaN, 1000, 0.1)).toBe(0);
  });

  it('切回标签页后的长间隔：按上限', () => {
    expect(frameDelta(5000, 1000, 0.1)).toBe(0.1);
  });
});

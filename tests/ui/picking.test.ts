import { describe, expect, it } from 'vitest';
import { pickUnitAt, screenBoxOf } from '../../src/ui/input/picking';

const pick = { minHalfWidth: 20, widthRatio: 0.3, headPadding: 30, footPadding: 10 };

describe('鼠标拾取', () => {
  it('可点范围包含身体、头顶条和脚下一小段', () => {
    const box = screenBoxOf('A0', { x: 100, y: 300 }, { x: 100, y: 200 }, pick);
    expect(box).toMatchObject({ left: 70, right: 130, top: 170, bottom: 310, depth: 300 });
  });

  it('矮小的单位也有最小宽度', () => {
    const box = screenBoxOf('A5', { x: 50, y: 100 }, { x: 50, y: 80 }, pick);
    expect(box.right - box.left).toBe(40);
  });

  it('指在范围内选中，范围外不选', () => {
    const boxes = [screenBoxOf('A0', { x: 100, y: 300 }, { x: 100, y: 200 }, pick)];
    expect(pickUnitAt(100, 250, boxes)).toBe('A0');
    expect(pickUnitAt(100, 175, boxes)).toBe('A0'); // 头顶条
    expect(pickUnitAt(140, 250, boxes)).toBeNull();
    expect(pickUnitAt(100, 320, boxes)).toBeNull();
    expect(pickUnitAt(0, 0, [])).toBeNull();
  });

  it('范围重叠时选水平方向更近的；一样近时选靠前的', () => {
    const back = screenBoxOf('E0', { x: 100, y: 280 }, { x: 100, y: 180 }, pick);
    const front = screenBoxOf('E1', { x: 140, y: 300 }, { x: 140, y: 200 }, pick);
    expect(pickUnitAt(105, 250, [back, front])).toBe('E0');
    expect(pickUnitAt(135, 250, [back, front])).toBe('E1');
    const same = screenBoxOf('E2', { x: 100, y: 300 }, { x: 100, y: 200 }, pick);
    expect(pickUnitAt(100, 250, [back, same])).toBe('E2');
    expect(pickUnitAt(100, 250, [same, back])).toBe('E2');
  });
});

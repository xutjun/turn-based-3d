import { describe, expect, it } from 'vitest';
import { layoutNames, nameRect, pointedHead, type HeadBox } from '../../src/ui/hud/nameLayout';

const cfg = { lineHeight: 14, step: 14, maxSteps: 8, gap: 1 };
const head = (id: string, x: number, y: number, extra: Partial<HeadBox> = {}): HeadBox => ({
  id,
  x,
  y,
  barWidth: 62,
  barHeight: 8,
  nameWidth: 70,
  showName: true,
  priority: 0,
  ...extra,
});
const intersects = (a: ReturnType<typeof nameRect>, b: ReturnType<typeof nameRect>): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('头顶名字错开', () => {
  it('周围没有东西时名字留在原位', () => {
    const lifts = layoutNames([head('E0', 100, 100), head('E1', 400, 100)], cfg);
    expect([...lifts]).toEqual([
      ['E0', 0],
      ['E1', 0],
    ]);
  });

  it('不显示名字的单位不参与排名字，但它的血条仍然要避开', () => {
    // E1 的血条正好在 E0 名字的位置上（后排单位站得更高、更靠后）
    const lifts = layoutNames([head('E0', 100, 100), head('E1', 120, 84, { showName: false })], cfg);
    expect(lifts.has('E1')).toBe(false);
    expect(lifts.get('E0')).toBeGreaterThan(0);
  });

  it('挤在一起的一排名字两两不重叠，也不压住任何血条', () => {
    // 旋风斩预览：7 个目标同时显示名字，前后排交错、间距很小
    const heads = Array.from({ length: 7 }, (_, i) => head(`E${i}`, 100 + i * 34, 100 - (i % 2) * 12));
    const lifts = layoutNames(heads, cfg);
    const rects = heads.map((h) => ({ h, r: nameRect(h, lifts.get(h.id)!, cfg.lineHeight) }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(intersects(rects[i]!.r, rects[j]!.r), `${i}-${j}`).toBe(false);
      }
      for (const other of heads) {
        if (other === rects[i]!.h) continue;
        const bar = { left: other.x - 31, right: other.x + 31, top: other.y - 8, bottom: other.y };
        expect(intersects(rects[i]!.r, bar), `${i} 压住 ${other.id} 的血条`).toBe(false);
      }
    }
  });

  it('优先级高的名字（Boss、主目标）留在原位，让别人去躲', () => {
    const lifts = layoutNames(
      [head('E0', 100, 120), head('E7', 110, 100, { priority: 2, barWidth: 120, nameWidth: 90 })],
      cfg,
    );
    expect(lifts.get('E7')).toBe(0);
    expect(lifts.get('E0')).toBeGreaterThan(0);
  });

  it('上抬有上限，不会无限往上找位置', () => {
    const heads = Array.from({ length: 12 }, (_, i) => head(`E${i}`, 100, 100));
    for (const lift of layoutNames(heads, cfg).values()) expect(lift).toBeLessThanOrEqual(cfg.step * cfg.maxSteps);
  });
});

describe('鼠标指着谁', () => {
  const hover = { halfWidth: 30, above: 36, below: 84 };
  const heads = [
    { id: 'A0', x: 100, y: 200, scale: 1 },
    { id: 'A1', x: 150, y: 200, scale: 1 },
    { id: 'E7', x: 400, y: 100, scale: 2 },
  ];

  it('指在头顶条或身体范围内选中，范围重叠时选水平方向更近的', () => {
    expect(pointedHead(heads, 100, 250, hover)).toBe('A0');
    expect(pointedHead(heads, 128, 250, hover)).toBe('A1');
    expect(pointedHead(heads, 100, 180, hover)).toBe('A0'); // 头顶条上
  });

  it('范围之外不选；Boss 的范围按体型放大', () => {
    expect(pointedHead(heads, 100, 320, hover)).toBeNull();
    expect(pointedHead(heads, 250, 200, hover)).toBeNull();
    expect(pointedHead(heads, 450, 250, hover)).toBe('E7');
  });
});

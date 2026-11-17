import { describe, expect, it } from 'vitest';
import { VIEWPORT_CONFIG } from '../../src/data/uiConfig';
import { pickUnitAt, screenBoxOf } from '../../src/ui/input/picking';
import {
  RESOLUTION_IDS,
  clientToLocal,
  computeLayout,
  fitAspect,
  isResolutionId,
  resolutionLabel,
  resolutionSize,
} from '../../src/ui/layout/viewportMath';

const ASPECT = 16 / 10;
const { width: DW, height: DH } = VIEWPORT_CONFIG.design;

/** 各种窗口：很宽、很高、接近正方形、正好 16:10、很小 */
const WINDOWS: [number, number][] = [
  [2560, 600],
  [700, 1400],
  [1000, 1000],
  [1100, 1000],
  [1440, 900],
  [1920, 1080],
  [1366, 768],
  [320, 240],
];

describe('固定 16:10：比例换算', () => {
  it('设计尺寸本身就是 16:10', () => {
    expect(DW / DH).toBeCloseTo(ASPECT, 9);
    expect(VIEWPORT_CONFIG.aspect).toBeCloseTo(ASPECT, 9);
  });

  it('任意窗口里取到的区域都是 16:10、不超出窗口、并且贴满一个方向（另一个方向是黑边）', () => {
    for (const [w, h] of WINDOWS) {
      const box = fitAspect(w, h);
      expect(box.width / box.height).toBeCloseTo(ASPECT, 9);
      expect(box.width).toBeLessThanOrEqual(w + 1e-9);
      expect(box.height).toBeLessThanOrEqual(h + 1e-9);
      const fillsWidth = Math.abs(box.width - w) < 1e-9;
      const fillsHeight = Math.abs(box.height - h) < 1e-9;
      expect(fillsWidth || fillsHeight).toBe(true);
    }
  });

  it('很宽的窗口左右加黑边，很高的窗口上下加黑边，游戏区域居中', () => {
    const wide = computeLayout(2560, 600, 'fit');
    expect(wide.top).toBe(0);
    expect(wide.height).toBe(600);
    expect(wide.left).toBeCloseTo((2560 - 960) / 2, 9);

    const tall = computeLayout(700, 1400, 'fit');
    expect(tall.left).toBe(0);
    expect(tall.width).toBe(700);
    expect(tall.top).toBeCloseTo((1400 - 437.5) / 2, 9);

    const exact = computeLayout(1440, 900, 'fit');
    expect(exact).toMatchObject({ left: 0, top: 0, width: 1440, height: 900, scale: 1 });
  });

  it('界面缩放倍率 = 显示宽度 / 排版宽度，宽高两个方向一致（等比缩放、不变形）', () => {
    for (const [w, h] of WINDOWS) {
      const l = computeLayout(w, h, 'fit');
      expect(l.scale).toBeCloseTo(l.width / DW, 9);
      expect(l.height / DH).toBeCloseTo(l.scale, 9);
    }
  });

  it('适应窗口：渲染像素 = 显示大小 × min(设备像素比, 画质上限)，并保持 16:10', () => {
    const hi = computeLayout(1440, 900, 'fit', 2, 2);
    expect(hi.renderWidth).toBe(2880);
    expect(hi.renderHeight).toBe(1800);
    const low = computeLayout(1440, 900, 'fit', 2, 1);
    expect(low.renderWidth).toBe(1440);
    expect(low.renderHeight).toBe(900);
    const odd = computeLayout(1366, 768, 'fit', 1.25, 2);
    expect(odd.renderWidth / odd.renderHeight).toBeCloseTo(ASPECT, 2);
  });

  it('固定分辨率：渲染像素固定为该值；窗口够大时按 1:1 物理像素居中显示，不够大时等比缩小', () => {
    for (const id of RESOLUTION_IDS) {
      const size = resolutionSize(id);
      if (!size) continue;
      expect(size.width / size.height).toBeCloseTo(ASPECT, 9);
      // 窗口足够大
      const big = computeLayout(3840, 2400, id, 1);
      expect(big.renderWidth).toBe(size.width);
      expect(big.renderHeight).toBe(size.height);
      expect(big.width).toBe(size.width);
      expect(big.left).toBe((3840 - size.width) / 2);
      expect(big.top).toBe((2400 - size.height) / 2);
      // 窗口不够大：缩小显示，渲染像素不变
      const small = computeLayout(1000, 700, id, 1);
      expect(small.renderWidth).toBe(size.width);
      expect(small.width).toBeLessThanOrEqual(1000);
      expect(small.height).toBeLessThanOrEqual(700);
      expect(small.width / small.height).toBeCloseTo(ASPECT, 9);
    }
    // 高分屏：1920×1200 在 2 倍屏上显示为 960×600 个 CSS 像素（1:1 物理像素）
    const retina = computeLayout(2000, 1200, '1920x1200', 2);
    expect(retina.width).toBe(960);
    expect(retina.renderWidth).toBe(1920);
  });

  it('分辨率选项：四档固定分辨率 + 适应窗口；名称和合法性检查', () => {
    expect(RESOLUTION_IDS).toEqual(['1280x800', '1440x900', '1680x1050', '1920x1200', 'fit']);
    expect(resolutionLabel('fit')).toBe('适应窗口');
    expect(resolutionLabel('1920x1200')).toBe('1920 × 1200');
    expect(isResolutionId('1680x1050')).toBe(true);
    expect(isResolutionId('800x600')).toBe(false);
    expect(isResolutionId(42)).toBe(false);
  });

  it('非法的窗口尺寸和设备像素比不会算出 0 或 NaN', () => {
    const l = computeLayout(0, 0, 'fit', Number.NaN);
    for (const v of Object.values(l)) expect(Number.isFinite(v)).toBe(true);
    expect(l.renderWidth).toBeGreaterThanOrEqual(1);
    expect(l.renderHeight).toBeGreaterThanOrEqual(1);
  });
});

describe('固定 16:10：鼠标坐标映射', () => {
  it('没有缩放时就是减去左上角', () => {
    const p = clientToLocal(150, 90, { left: 50, top: 40, width: 1440, height: 900 }, 1440, 900);
    expect(p).toEqual({ x: 100, y: 50 });
  });

  it('加了黑边、整体缩放后，窗口坐标能准确换算回排版坐标', () => {
    for (const [w, h] of WINDOWS) {
      const l = computeLayout(w, h, 'fit');
      const rect = { left: l.left, top: l.top, width: l.width, height: l.height };
      // 排版坐标 → 屏幕坐标（舞台的 transform：先缩放再平移）→ 换算回来
      for (const [lx, ly] of [
        [0, 0],
        [DW, DH],
        [720, 450],
        [123.4, 777.7],
      ] as const) {
        const clientX = l.left + lx * l.scale;
        const clientY = l.top + ly * l.scale;
        const back = clientToLocal(clientX, clientY, rect, DW, DH);
        expect(back.x).toBeCloseTo(lx, 6);
        expect(back.y).toBeCloseTo(ly, 6);
      }
    }
  });

  it('选目标：不管窗口什么比例，点在单位身上都能选中它；不换算时会选错或选不中', () => {
    // 两个相邻的单位，按排版坐标投影出来的位置
    const boxes = [
      screenBoxOf('a', { x: 600, y: 520 }, { x: 600, y: 420 }),
      screenBoxOf('b', { x: 690, y: 520 }, { x: 690, y: 420 }),
    ];
    let wrongWithoutMapping = 0;
    for (const [w, h] of WINDOWS) {
      const l = computeLayout(w, h, 'fit');
      const rect = { left: l.left, top: l.top, width: l.width, height: l.height };
      for (const target of ['a', 'b'] as const) {
        const x = target === 'a' ? 600 : 690;
        const clientX = l.left + x * l.scale;
        const clientY = l.top + 480 * l.scale;
        const p = clientToLocal(clientX, clientY, rect, DW, DH);
        expect(pickUnitAt(p.x, p.y, boxes)).toBe(target);
        // 旧算法（只减左上角、不除以缩放）
        if (pickUnitAt(clientX - rect.left, clientY - rect.top, boxes) !== target) wrongWithoutMapping += 1;
      }
    }
    expect(wrongWithoutMapping).toBeGreaterThan(0);
  });
});

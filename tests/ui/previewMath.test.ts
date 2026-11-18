import { describe, expect, it } from 'vitest';
import { previewPixelRect } from '../../src/render/preview/previewRect';
import { Spin } from '../../src/ui/explore/spin';
import { addExp, expToNext, heroProgress } from '../../src/growth/progression';
import { LEVEL_CAP } from '../../src/data/progression';
import { HERO_TEMPLATES } from '../../src/data/heroes';

// 步骤 21：预览视口的矩形换算、拖拽旋转与惯性、等级经验接口（纯函数）。

describe('预览视口的矩形换算', () => {
  it('舞台按 1 倍、像素比 1：窗口坐标直接换成画布像素，原点在左下', () => {
    const r = previewPixelRect({ left: 30, top: 300, width: 260, height: 340 }, { left: 0, top: 0, width: 1440, height: 900 }, 1440, 900);
    expect(r).toEqual({ x: 30, y: 900 - 300 - 340, width: 260, height: 340 });
  });

  it('16:10 舞台被缩小、带黑边，渲染像素比 2：先减去画布偏移，再按缓冲区 / 显示尺寸放大', () => {
    // 舞台缩放 0.5、左右黑边 100 像素：画布显示为 720 × 450，缓冲区 1440 × 900（像素比 2）
    const canvas = { left: 100, top: 0, width: 720, height: 450 };
    const el = { left: 100 + 15, top: 150, width: 130, height: 170 };
    const r = previewPixelRect(el, canvas, 1440, 900)!;
    expect(r).toEqual({ x: 30, y: 900 - 300 - 340, width: 260, height: 340 });
  });

  it('部分超出画布时只画相交的部分；完全在外、面积为 0 时返回 null', () => {
    const canvas = { left: 0, top: 0, width: 1000, height: 600 };
    expect(previewPixelRect({ left: -50, top: 500, width: 200, height: 200 }, canvas, 1000, 600)).toEqual({ x: 0, y: 0, width: 150, height: 100 });
    expect(previewPixelRect({ left: 1200, top: 0, width: 100, height: 100 }, canvas, 1000, 600)).toBeNull();
    expect(previewPixelRect({ left: 10, top: 10, width: 0, height: 100 }, canvas, 1000, 600)).toBeNull();
    expect(previewPixelRect({ left: 10, top: 10, width: 10, height: 10 }, { left: 0, top: 0, width: 0, height: 0 }, 1000, 600)).toBeNull();
  });
});

describe('拖拽旋转与惯性', () => {
  const config = { dragRadPerPx: 0.01, inertiaDecay: 4, maxSpin: 9, minSpin: 0.05, releaseHold: 0.08 };

  it('跟手：水平位移 × 系数；可以一直转下去（超过 360 度）', () => {
    const s = new Spin(config);
    s.begin(0, 0);
    for (let i = 1; i <= 100; i++) s.move(i * 10, i * 0.016);
    expect(s.yaw).toBeCloseTo(10, 6);
    expect(s.yaw).toBeGreaterThan(Math.PI * 2);
  });

  it('松开后按松手前的速度继续转，指数衰减后停下；转过的总角度有限', () => {
    const s = new Spin(config);
    s.begin(0, 0);
    for (let i = 1; i <= 10; i++) s.move(i * 5, i * 0.016);
    s.end(10 * 0.016);
    const v0 = s.velocity;
    expect(v0).toBeGreaterThan(1);
    const start = s.yaw;
    for (let i = 0; i < 600; i++) s.step(1 / 60);
    expect(s.velocity).toBe(0);
    const coast = s.yaw - start;
    expect(coast).toBeGreaterThan(0);
    expect(coast).toBeLessThanOrEqual(v0 / config.inertiaDecay + 1e-9); // 解析上限 v0 / k
  });

  it('惯性与帧率无关：60 帧和 15 帧推进同样的时间，转到同一个角度', () => {
    const run = (fps: number): number => {
      const s = new Spin(config);
      s.begin(0, 0);
      s.move(40, 0.02);
      s.end(0.02);
      for (let i = 0; i < fps / 2; i++) s.step(1 / fps); // 0.5 秒
      return s.yaw;
    };
    expect(run(60)).toBeCloseTo(run(20), 6);
  });

  it('停住一会儿再松手：没有惯性；方向相反也对称；角速度有上限', () => {
    const s = new Spin(config);
    s.begin(0, 0);
    s.move(50, 0.016);
    s.end(0.5);
    expect(s.velocity).toBe(0);
    s.begin(0, 1);
    s.move(-30, 1.016);
    s.end(1.016);
    expect(s.velocity).toBeLessThan(0);
    s.begin(0, 2);
    s.move(10000, 2.001);
    s.end(2.001);
    expect(Math.abs(s.velocity)).toBeLessThanOrEqual(config.maxSpin);
  });

  it('按下时停掉惯性；reset 回到正面', () => {
    const s = new Spin(config);
    s.begin(0, 0);
    s.move(40, 0.016);
    s.end(0.016);
    expect(s.velocity).not.toBe(0);
    s.begin(40, 1);
    expect(s.velocity).toBe(0);
    s.reset();
    expect(s.yaw).toBe(0);
    expect(s.isDragging).toBe(false);
  });
});

describe('等级与经验（只留接口）', () => {
  it('5 名人物都是 10 级、0 经验，升级所需取表里的值', () => {
    for (const t of HERO_TEMPLATES) expect(heroProgress(t.id)).toEqual({ level: 10, exp: 0 });
    expect(expToNext(10)).toBe(10000);
    expect(LEVEL_CAP).toBe(10);
  });

  it('addExp：够了就升级、可连升；到上限只累积不升级；不改传入的对象', () => {
    const p = { level: 1, exp: 0 };
    expect(addExp(p, 99)).toEqual({ level: 1, exp: 99 });
    expect(addExp(p, 100 + 250 + 10)).toEqual({ level: 3, exp: 10 });
    expect(p).toEqual({ level: 1, exp: 0 });
    expect(addExp({ level: 10, exp: 0 }, 50000)).toEqual({ level: 10, exp: 50000 });
    expect(addExp({ level: 9, exp: 0 }, 7200 + 5)).toEqual({ level: 10, exp: 5 });
    expect(addExp({ level: 5, exp: 0 }, -20)).toEqual({ level: 5, exp: 0 });
  });
});

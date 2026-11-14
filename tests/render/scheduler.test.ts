import { describe, expect, it } from 'vitest';
import { EASE, Scheduler } from '../../src/render/director/Scheduler';

/** 让已经完成的 Promise 的后续代码先跑完 */
const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('时间调度器', () => {
  it('tween 按时间推进，结束时进度恰好为 1', async () => {
    const s = new Scheduler();
    const seen: number[] = [];
    let done = false;
    void s.tween(1, (t) => seen.push(t)).then(() => (done = true));
    s.update(0.25);
    s.update(0.25);
    await settle();
    expect(done).toBe(false);
    expect(seen[seen.length - 1]).toBeCloseTo(0.5);
    s.update(0.6);
    await settle();
    expect(done).toBe(true);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('两倍速时动画用一半的真实时间完成', async () => {
    const s = new Scheduler();
    s.setTimeScale(2);
    let done = false;
    void s.wait(1).then(() => (done = true));
    s.update(0.4);
    await settle();
    expect(done).toBe(false);
    s.update(0.11);
    await settle();
    expect(done).toBe(true);
    expect(s.time).toBeCloseTo(1.02);
  });

  it('跳过动画：进行中的动画立即完成，之后的动画也立即完成', async () => {
    const s = new Scheduler();
    let a = 0;
    let finished = 0;
    void s.tween(5, (t) => (a = t)).then(() => (finished += 1));
    void s.wait(5).then(() => (finished += 1));
    s.setSkip(true);
    await settle();
    expect(a).toBe(1);
    expect(finished).toBe(2);
    expect(s.pending).toBe(0);
    let b = 0;
    await s.tween(3, (t) => (b = t), EASE.out);
    expect(b).toBe(1);
    await s.wait(10); // 不需要 update 就能完成
  });

  it('nextFrame 即使在跳过动画时也要等到下一次 update', async () => {
    const s = new Scheduler();
    s.setSkip(true);
    let done = false;
    void s.nextFrame().then(() => (done = true));
    await settle();
    expect(done).toBe(false);
    s.update(0.016);
    await settle();
    expect(done).toBe(true);
  });

  it('顿帧 / 慢镜头：一段时间内演出时间变慢，结束后恢复；倍速会缩短这段时间', async () => {
    const s = new Scheduler();
    let progress = 0;
    void s.tween(1, (t) => (progress = t));
    s.warp(0.1, 0.5);
    s.update(0.25);
    expect(progress).toBeCloseTo(0.025);
    expect(s.delta).toBeCloseTo(0.025);
    s.update(0.25); // 扭曲到此结束
    s.update(0.25);
    expect(s.warpFactor).toBe(1);
    expect(progress).toBeCloseTo(0.3);

    const fast = new Scheduler();
    fast.setTimeScale(2);
    fast.warp(0, 0.5);
    fast.update(0.25); // 两倍速下 0.25 秒就耗尽 0.5 秒的顿帧
    expect(fast.warpFactor).toBe(1);
  });

  it('多个扭曲同时存在时取最慢的；跳过动画时扭曲不生效并被清除', () => {
    const s = new Scheduler();
    s.warp(0.5, 1);
    s.warp(0.2, 0.3);
    expect(s.warpFactor).toBe(0.2);
    s.update(0.4);
    expect(s.warpFactor).toBe(0.5);
    s.setSkip(true);
    expect(s.warpFactor).toBe(1);
    s.warp(0.1, 1);
    expect(s.warpFactor).toBe(1);
  });
});

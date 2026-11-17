// 统一的时间调度器：表现层所有“等一会儿”和“在一段时间内变化”都走这里，不使用 setTimeout。
// 由渲染循环每帧调用 update()；倍速（timeScale）和跳过动画（skip）在这里统一生效。
// 本文件不依赖 three 和 DOM，可以直接做单元测试。

export type Ease = (t: number) => number;

export const EASE = {
  linear: (t: number): number => t,
  in: (t: number): number => t * t,
  out: (t: number): number => 1 - (1 - t) * (1 - t),
  inOut: (t: number): number => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  /** 0 → 1 → 0，用于小跳、闪白这类去了又回来的变化 */
  arc: (t: number): number => Math.sin(Math.PI * t),
  // ---- 步骤 11：进攻动作用的曲线 ----
  /** 起步很慢、越来越快：发力（挥下、刺出） */
  inCubic: (t: number): number => t * t * t,
  /** 一开始很快、到位前减速：蓄力到位、余势 */
  outCubic: (t: number): number => 1 - (1 - t) ** 3,
  /** 先往反方向缩一下再出去 */
  inBack: (t: number): number => 2.70158 * t * t * t - 1.70158 * t * t,
  /** 冲过头一点再回来（回弹） */
  outBack: (t: number): number => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  /** 冲过头后来回弹几下才停住（弓身回弹） */
  outElastic: (t: number): number =>
    t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1,
} satisfies Record<string, Ease>;

interface Task {
  elapsed: number;
  duration: number;
  step: ((t: number) => void) | null;
  ease: Ease;
  resolve: () => void;
}

export class Scheduler {
  /** 累计的演出时间（秒，已乘倍速） */
  time = 0;
  /** 上一帧的演出时间间隔（秒，已乘倍速），待机呼吸、血条缓动、飘字用它 */
  delta = 0;

  private scale = 1;
  private skipping = false;
  /** 进行中的时间扭曲（顿帧、慢镜头）：factor 为时间流速，left 为剩余时长 */
  private readonly warps: { factor: number; left: number }[] = [];
  private readonly tasks = new Set<Task>();
  private frameWaiters: (() => void)[] = [];

  get timeScale(): number {
    return this.scale;
  }

  /** 战斗速度：1 = 正常，2 = 两倍速 */
  setTimeScale(scale: number): void {
    this.scale = Math.max(0.1, scale);
  }

  get skip(): boolean {
    return this.skipping;
  }

  /** 跳过动画：打开后所有进行中和之后的动画立即完成 */
  setSkip(on: boolean): void {
    this.skipping = on;
    if (on) {
      this.warps.length = 0;
      this.flush();
    }
  }

  /**
   * 时间扭曲：接下来的 duration 秒内（按倍速后的时间计），演出时间只以 factor 倍流逝。
   * factor 接近 0 = 顿帧（hit stop），0.3 左右 = 慢镜头。多个扭曲同时存在时取最慢的。
   * 跳过动画时不生效。
   */
  warp(factor: number, duration: number): void {
    if (this.skipping || duration <= 0) return;
    this.warps.push({ factor: Math.max(0, Math.min(1, factor)), left: duration });
  }

  /** 当前的时间流速（1 = 正常；顿帧、慢镜头时小于 1） */
  get warpFactor(): number {
    let f = 1;
    for (const w of this.warps) f = Math.min(f, w.factor);
    return f;
  }

  /** 进行中的动画数量 */
  get pending(): number {
    return this.tasks.size;
  }

  /** 每帧调用一次，realDt 为真实经过的秒数 */
  update(realDt: number): void {
    const scaled = realDt * this.scale;
    const dt = scaled * this.warpFactor;
    for (let i = this.warps.length - 1; i >= 0; i--) {
      const w = this.warps[i]!;
      w.left -= scaled;
      if (w.left <= 0) this.warps.splice(i, 1);
    }
    this.delta = dt;
    this.time += dt;
    for (const task of [...this.tasks]) {
      task.elapsed += dt;
      const t = Math.min(1, task.elapsed / task.duration);
      task.step?.(task.ease(t));
      if (t >= 1) {
        this.tasks.delete(task);
        task.resolve();
      }
    }
    const waiters = this.frameWaiters;
    this.frameWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /**
   * 在 duration 秒内把进度从 0 推到 1，每帧调用 step(进度)。
   * 结束时保证以进度 1 调用一次。跳过动画时立即完成。
   */
  tween(duration: number, step: (t: number) => void, ease: Ease = EASE.linear): Promise<void> {
    if (this.skipping || duration <= 0) {
      step(ease(1));
      return Promise.resolve();
    }
    step(ease(0));
    return new Promise((resolve) => {
      this.tasks.add({ elapsed: 0, duration, step, ease, resolve });
    });
  }

  /** 等待 duration 秒。跳过动画时立即完成。 */
  wait(duration: number): Promise<void> {
    if (this.skipping || duration <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.tasks.add({ elapsed: 0, duration, step: null, ease: EASE.linear, resolve });
    });
  }

  /** 等到下一帧（跳过动画时也会真的等一帧，避免一口气算完整场战斗把页面卡住） */
  nextFrame(): Promise<void> {
    return new Promise((resolve) => {
      this.frameWaiters.push(resolve);
    });
  }

  /** 立即完成所有进行中的动画 */
  flush(): void {
    this.warps.length = 0;
    for (const task of [...this.tasks]) {
      this.tasks.delete(task);
      task.step?.(task.ease(1));
      task.resolve();
    }
  }
}

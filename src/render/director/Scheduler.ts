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
    if (on) this.flush();
  }

  /** 进行中的动画数量 */
  get pending(): number {
    return this.tasks.size;
  }

  /** 每帧调用一次，realDt 为真实经过的秒数 */
  update(realDt: number): void {
    const dt = realDt * this.scale;
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
    for (const task of [...this.tasks]) {
      this.tasks.delete(task);
      task.step?.(task.ease(1));
      task.resolve();
    }
  }
}

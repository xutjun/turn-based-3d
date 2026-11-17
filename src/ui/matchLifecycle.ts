// 一场战斗的收尾（步骤 12：重新开始 / 退出到标题 / 再战一次共用）。
// 不依赖 three 和 DOM，可以直接做单元测试。
//
// 中途放弃一场战斗时，导演可能正演到一半（某次出手的冲锋、命中、倒地 …），这一段演出的后续步骤
// 还挂在调度器上。如果直接复位舞台，后续步骤会在复位之后继续执行，把上一场的动作（倒地、飘字）带进新的一场。
// 所以先停掉流程，再临时打开“跳过动画”让正在播的那一段立即走完，最后才复位。

/** 收尾需要的最小接口 */
export interface DrainableMatch {
  controller: { stop(): void };
  director: { dispose(): void; idle(): Promise<void> };
}

export interface DrainableScheduler {
  readonly skip: boolean;
  setSkip(on: boolean): void;
  setPaused(on: boolean): void;
}

/**
 * 停掉一场战斗并等它的演出彻底结束：
 * 1. 控制器停止（不再结算新的出手、不再等玩家指令）；导演丢弃还没播的事件。
 * 2. 解除暂停（设置菜单里点“重新开始”时战斗正暂停着）。
 * 3. 临时打开跳过动画：正在播的那次出手的所有等待立即完成；等它播完再恢复玩家原来的跳过设置。
 * 之后调用方再复位舞台、头顶条、日志等。
 */
export async function drainMatch(match: DrainableMatch, scheduler: DrainableScheduler): Promise<void> {
  match.controller.stop();
  match.director.dispose();
  scheduler.setPaused(false);
  const skip = scheduler.skip;
  scheduler.setSkip(true);
  try {
    await match.director.idle();
  } finally {
    scheduler.setSkip(skip);
  }
}

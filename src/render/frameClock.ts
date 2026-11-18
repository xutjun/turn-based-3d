// 渲染循环的帧间隔（步骤 17 修正）：纯计算，可单元测试。
//
// 旧 bug：帧间隔 = (这一帧的时间戳 − 上一帧的时间戳)，只限制了上限。requestAnimationFrame 给的时间戳是“这一帧开始的时刻”，
// 可能早于启动 / 切回自动渲染时记下的 performance.now()（无头浏览器里实测差了约 5 秒），于是第一帧的间隔是负数，
// 演出时钟倒退、进行中的补间被往回拖。现在夹在 [0, max] 之间。

/** 两帧之间的时间间隔（秒）：负数按 0，过长（切回标签页）按 max */
export function frameDelta(nowMs: number, lastMs: number, max: number): number {
  const dt = (nowMs - lastMs) / 1000;
  if (!(dt > 0)) return 0;
  return Math.min(max, dt);
}

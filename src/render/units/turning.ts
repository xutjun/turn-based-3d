// 近战冲锋时的转身：纯计算，不依赖 three。
// 冲出去时先转向跑动方向（目标所在的方向），到位前正对目标；跑回原位的途中平滑转回原来的朝向。

/** 从 from 转到 to 的最短夹角（弧度，范围 −π ~ π） */
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 平滑过渡（两端速度为 0），所以转身没有突然的起止 */
function smooth(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/** 沿最短方向从 from 转向 to，t 为 0~1 的进度 */
export function turnToward(from: number, to: number, t: number): number {
  return from + shortestAngle(from, to) * smooth(t);
}

export interface ChargeTurn {
  lead: number; // 冲锋开始后用多少比例的时间转向跑动方向（0~1）
  settle: number; // 到位前用多少比例的时间转为正对目标（0~1）
}

/**
 * 冲锋途中某一时刻的朝向。
 * @param t 冲锋进度 0~1
 * @param from 出发时的朝向
 * @param travel 跑动方向
 * @param face 到位后的朝向（正对目标）
 */
export function chargeYaw(t: number, from: number, travel: number, face: number, turn: ChargeTurn): number {
  const lead = Math.max(1e-6, turn.lead);
  const settle = Math.max(1e-6, turn.settle);
  const running = turnToward(from, travel, t / lead);
  if (t <= 1 - settle) return running;
  return turnToward(running, face, (t - (1 - settle)) / settle);
}

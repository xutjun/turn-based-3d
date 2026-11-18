// 探索模式的角度与坐标工具（步骤 14 起）。纯计算，不依赖 three.js 和 DOM。
// 步骤 14 的“方向键直线行走”（stepWalker）在步骤 15 并入 agent.ts（同一套速度、转向和碰撞）。
//
// 朝向约定与 three.js 一致：yaw 为绕 y 轴的转角，面朝方向 = (sin yaw, cos yaw)。

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const TAU = Math.PI * 2;

/** 把角度折回 (−π, π] */
export function wrapAngle(a: number): number {
  const r = a - TAU * Math.round(a / TAU);
  return r <= -Math.PI ? r + TAU : r;
}

/** 从 from 朝 to 转，最多转 maxStep 弧度（走最短的方向） */
export function turnToward(from: number, to: number, maxStep: number): number {
  const diff = wrapAngle(to - from);
  if (Math.abs(diff) <= maxStep) return wrapAngle(to);
  return wrapAngle(from + Math.sign(diff) * maxStep);
}

/** 面朝某个方向（地面向量）的 yaw */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/**
 * 某人局部坐标里的一点 → 世界：局部坐标 (lx 向此人的左手侧, lz 向前)。
 * 模型的 +x（左手侧）在世界里是 (cos yaw, −sin yaw)，前方是 (sin yaw, cos yaw)。
 * （步骤 17 的队员显形站位用它把“队长左右两侧”换成世界坐标。）
 */
export function localToWorld(origin: { x: number; z: number; yaw: number }, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(origin.yaw);
  const s = Math.sin(origin.yaw);
  return { x: origin.x + lx * c + lz * s, z: origin.z - lx * s + lz * c };
}

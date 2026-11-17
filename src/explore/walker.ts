// 探索模式里一个角色的移动（步骤 14）：速度、加减速、转身、边界。纯计算，不依赖 three.js 和 DOM。
// 步骤 14 用它做“方向键 / WASD 直线行走”的调试控制；步骤 15 的点击移动、寻路、跟随也建立在它上面。
//
// 朝向约定与 three.js 一致：yaw 为绕 y 轴的转角，面朝方向 = (sin yaw, cos yaw)。

import { EXPLORE_CONFIG } from '../data/exploreConfig';

export interface WalkerState {
  x: number;
  z: number;
  yaw: number;
  /** 当前速度（世界坐标，米/秒） */
  vx: number;
  vz: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type MoveConfig = typeof EXPLORE_CONFIG.move;

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

export function createWalker(x: number, z: number, yaw: number): WalkerState {
  return { x, z, yaw, vx: 0, vz: 0 };
}

export function speedOf(w: WalkerState): number {
  return Math.hypot(w.vx, w.vz);
}

/**
 * 推进一帧。
 * @param dir 想走的方向（地面向量，长度会被归一化；长度为 0 = 停下）
 * @param speedScale 目标速度 = 走速 × speedScale（0~1）
 */
export function stepWalker(
  w: WalkerState,
  dir: { x: number; z: number },
  dt: number,
  cfg: MoveConfig = EXPLORE_CONFIG.move,
  bounds: Bounds = EXPLORE_CONFIG.bounds,
  speedScale = 1,
): void {
  if (dt <= 0) return;
  const len = Math.hypot(dir.x, dir.z);
  const target = len > 1e-6 ? cfg.walkSpeed * Math.max(0, Math.min(1, speedScale)) : 0;
  const tx = len > 1e-6 ? (dir.x / len) * target : 0;
  const tz = len > 1e-6 ? (dir.z / len) * target : 0;
  // 速度向目标靠拢：加速和减速的上限不同（停得比起步快一点）
  const dvx = tx - w.vx;
  const dvz = tz - w.vz;
  const dv = Math.hypot(dvx, dvz);
  if (dv > 1e-9) {
    const speeding = target > speedOf(w);
    const step = (speeding ? cfg.accel : cfg.decel) * dt;
    const k = Math.min(1, step / dv);
    w.vx += dvx * k;
    w.vz += dvz * k;
  }
  // 位移，并夹在可走区域里（撞到边界时那个方向的速度清零）
  let x = w.x + w.vx * dt;
  let z = w.z + w.vz * dt;
  if (x < bounds.minX || x > bounds.maxX) {
    x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
    w.vx = 0;
  }
  if (z < bounds.minZ || z > bounds.maxZ) {
    z = Math.max(bounds.minZ, Math.min(bounds.maxZ, z));
    w.vz = 0;
  }
  w.x = x;
  w.z = z;
  // 转身：朝着想走的方向（停下时保持原朝向）
  if (len > 1e-6) w.yaw = turnToward(w.yaw, yawOf(dir.x, dir.z), cfg.turnRate * dt);
}

/**
 * 队形里某个位置的世界坐标：队长局部坐标 (lx 向队长的左手侧, lz 向前) → 世界。
 * 模型的 +x（左手侧）在世界里是 (cos yaw, −sin yaw)，前方是 (sin yaw, cos yaw)。
 */
export function localToWorld(origin: { x: number; z: number; yaw: number }, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(origin.yaw);
  const s = Math.sin(origin.yaw);
  return { x: origin.x + lx * c + lz * s, z: origin.z - lx * s + lz * c };
}

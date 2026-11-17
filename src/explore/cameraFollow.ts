// 探索相机的跟随（步骤 14，DESIGN §11.6）：临界阻尼弹簧平滑跟随，注视点夹在可走区域内缩的矩形里。
// 纯计算，不依赖 three.js 和 DOM；render/explore 把结果交给 2.5D 相机。

import { EXPLORE_CONFIG } from '../data/exploreConfig';
import type { Bounds } from './walker';

export type CameraFollowConfig = typeof EXPLORE_CONFIG.camera;

/** 一维临界阻尼弹簧（Game Programming Gems 4 的 SmoothDamp）：返回新位置，速度写回 state */
export function smoothDamp(current: number, target: number, state: { v: number }, smoothTime: number, dt: number): number {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const temp = (state.v + omega * change) * dt;
  state.v = (state.v - omega * temp) * exp;
  return target + (change + temp) * exp;
}

/** 注视点允许的范围：可走区域每边内缩 margin（内缩后为空时取中点） */
export function cameraBounds(bounds: Bounds, margin: number): Bounds {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const minX = Math.min(cx, bounds.minX + margin);
  const maxX = Math.max(cx, bounds.maxX - margin);
  const minZ = Math.min(cz, bounds.minZ + margin);
  const maxZ = Math.max(cz, bounds.maxZ - margin);
  return { minX, maxX, minZ, maxZ };
}

export class CameraFollow {
  x = 0;
  z = 0;
  private readonly vx = { v: 0 };
  private readonly vz = { v: 0 };
  private readonly limits: Bounds;

  constructor(
    private readonly cfg: CameraFollowConfig = EXPLORE_CONFIG.camera,
    bounds: Bounds = EXPLORE_CONFIG.bounds,
  ) {
    this.limits = cameraBounds(bounds, cfg.margin);
  }

  /** 想看的点：跟随对象的位置沿行进方向前移一点，再夹进范围 */
  goal(x: number, z: number, vx: number, vz: number): { x: number; z: number } {
    const speed = Math.hypot(vx, vz);
    const lead = speed > 1e-3 ? this.cfg.lead / speed : 0;
    const l = this.limits;
    return {
      x: Math.max(l.minX, Math.min(l.maxX, x + vx * lead)),
      z: Math.max(l.minZ, Math.min(l.maxZ, z + vz * lead)),
    };
  }

  /** 立即对准（进入探索、回到起点时） */
  snap(x: number, z: number, vx = 0, vz = 0): void {
    const g = this.goal(x, z, vx, vz);
    this.x = g.x;
    this.z = g.z;
    this.vx.v = this.vz.v = 0;
  }

  /** 推进一帧，平滑地靠近目标 */
  update(x: number, z: number, vx: number, vz: number, dt: number): void {
    if (dt <= 0) return;
    const g = this.goal(x, z, vx, vz);
    this.x = smoothDamp(this.x, g.x, this.vx, this.cfg.smoothTime, dt);
    this.z = smoothDamp(this.z, g.z, this.vz, this.cfg.smoothTime, dt);
    // 弹簧的过冲也不能越界
    const l = this.limits;
    this.x = Math.max(l.minX, Math.min(l.maxX, this.x));
    this.z = Math.max(l.minZ, Math.min(l.maxZ, this.z));
  }
}

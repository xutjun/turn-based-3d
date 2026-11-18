// 探索模式的碰撞（步骤 15，DESIGN §11.3 / §9.12 H5）：障碍物是圆和胶囊（倒地断柱），单位是圆。
// 纯计算，不依赖 three.js 和 DOM。
//
// 做法：位移分成小步，每一小步之后把单位从重叠的障碍物里沿法线推出去——
// 推出只改变“朝障碍物里钻”的那部分位移，沿表面的部分保留，于是单位贴着障碍物滑动，永远进不去。
// 点击移动（agent.ts）和方向键调试共用这里。

import { BATTLEFIELD_LAYOUT, DRUM_RADIUS, PILLAR_RADIUS, type BattlefieldLayout } from '../data/battlefieldLayout';
import { EXPLORE_CONFIG, type GroundXZ } from '../data/exploreConfig';
import type { Bounds } from './walker';

export type ObstacleTag = 'pillar' | 'drum' | 'brazier' | 'banner' | 'bonePile' | 'boss';

/** 圆形障碍 */
export interface CircleObstacle {
  kind: 'circle';
  tag: ObstacleTag;
  x: number;
  z: number;
  r: number;
}

/** 胶囊障碍（线段 a → b 加半径 r） */
export interface CapsuleObstacle {
  kind: 'capsule';
  tag: ObstacleTag;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
}

export type Obstacle = CircleObstacle | CapsuleObstacle;

export type CollisionConfig = typeof EXPLORE_CONFIG.collision;

/**
 * 由战场布局生成障碍物（不含 Boss）。半径按物件的真实尺寸，见 exploreConfig.collision。
 * 断柱沿模型的 x 轴横躺：绕 y 转 rot 之后，轴向在世界里是 (cos rot, −sin rot)。
 */
export function layoutObstacles(layout: BattlefieldLayout = BATTLEFIELD_LAYOUT, c: CollisionConfig = EXPLORE_CONFIG.collision): Obstacle[] {
  const out: Obstacle[] = [];
  for (const p of layout.pillars) out.push({ kind: 'circle', tag: 'pillar', x: p.x, z: p.z, r: (p.radius ?? PILLAR_RADIUS) + c.pillarPad });
  for (const d of layout.drums) {
    const hx = (Math.cos(d.rot) * d.len) / 2;
    const hz = (-Math.sin(d.rot) * d.len) / 2;
    out.push({ kind: 'capsule', tag: 'drum', ax: d.x - hx, az: d.z - hz, bx: d.x + hx, bz: d.z + hz, r: DRUM_RADIUS + c.drumPad });
  }
  for (const b of layout.braziers) out.push({ kind: 'circle', tag: 'brazier', x: b.x, z: b.z, r: c.brazier });
  for (const b of layout.banners) out.push({ kind: 'circle', tag: 'banner', x: b.x, z: b.z, r: c.banner });
  for (const b of layout.bonePiles) out.push({ kind: 'circle', tag: 'bonePile', x: b.x, z: b.z, r: c.bonePile });
  return out;
}

/** Boss 的障碍（在场时） */
export function bossObstacle(boss: GroundXZ, c: CollisionConfig = EXPLORE_CONFIG.collision): CircleObstacle {
  return { kind: 'circle', tag: 'boss', x: boss.x, z: boss.z, r: c.boss };
}

/** 障碍物上离点 (px, pz) 最近的“中心点”：圆是圆心，胶囊是线段上的最近点 */
export function obstacleCore(o: Obstacle, px: number, pz: number): { x: number; z: number } {
  if (o.kind === 'circle') return { x: o.x, z: o.z };
  const dx = o.bx - o.ax;
  const dz = o.bz - o.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((px - o.ax) * dx + (pz - o.az) * dz) / len2)) : 0;
  return { x: o.ax + dx * t, z: o.az + dz * t };
}

/** 点到障碍物表面的有符号距离（在里面为负） */
export function obstacleDistance(o: Obstacle, px: number, pz: number): number {
  const c = obstacleCore(o, px, pz);
  return Math.hypot(px - c.x, pz - c.z) - o.r;
}

/** 点到所有障碍物表面的最近距离（没有障碍物时为 +∞） */
export function clearance(obstacles: readonly Obstacle[], px: number, pz: number): number {
  let best = Infinity;
  for (const o of obstacles) best = Math.min(best, obstacleDistance(o, px, pz));
  return best;
}

/** 点是否在可走边界内 */
export function inBounds(b: Bounds, x: number, z: number): boolean {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

/**
 * 把半径为 radius 的圆从所有重叠的障碍物里推出来（沿法线），再夹进边界。
 * 两个障碍物挨得很近时一次推出可能把单位推进另一个，所以迭代几次。
 * 返回是否发生了推出（撞到了东西）。
 */
export function resolveOverlaps(p: { x: number; z: number }, radius: number, obstacles: readonly Obstacle[], bounds: Bounds, iterations = 4): boolean {
  let hit = false;
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (const o of obstacles) {
      const c = obstacleCore(o, p.x, p.z);
      let nx = p.x - c.x;
      let nz = p.z - c.z;
      const d = Math.hypot(nx, nz);
      const need = o.r + radius;
      if (d >= need) continue;
      if (d < 1e-9) {
        // 正好在中心（理论上不会发生）：往 +x 推
        nx = 1;
        nz = 0;
      } else {
        nx /= d;
        nz /= d;
      }
      // 多推 1e-6，浮点误差下也严格在外面
      p.x = c.x + nx * (need + 1e-6);
      p.z = c.z + nz * (need + 1e-6);
      moved = hit = true;
    }
    const cx = Math.max(bounds.minX, Math.min(bounds.maxX, p.x));
    const cz = Math.max(bounds.minZ, Math.min(bounds.maxZ, p.z));
    if (cx !== p.x || cz !== p.z) {
      p.x = cx;
      p.z = cz;
      hit = true;
      moved = true;
    }
    if (!moved) break;
  }
  return hit;
}

/**
 * 带碰撞地移动：从 p 出发想移动 (dx, dz)，按 ≤ maxStep 的小步走，每步之后推出重叠。
 * 直接改 p，返回是否撞到了东西（障碍物或边界）。
 */
export function moveWithCollision(
  p: { x: number; z: number },
  dx: number,
  dz: number,
  radius: number,
  obstacles: readonly Obstacle[],
  bounds: Bounds,
  maxStep: number = EXPLORE_CONFIG.collision.maxStep,
): boolean {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / Math.max(1e-3, maxStep)));
  let hit = false;
  for (let i = 0; i < steps; i++) {
    const px = p.x;
    const pz = p.z;
    p.x += dx / steps;
    p.z += dz / steps;
    if (resolveOverlaps(p, radius, obstacles, bounds)) {
      hit = true;
      // 夹角处（两个障碍物之间、障碍物与边界之间）推出一个又进了另一个：退回这一小步的起点，原地不动
      if (clearance(obstacles, p.x, p.z) < radius) {
        p.x = px;
        p.z = pz;
        break;
      }
    }
  }
  return hit;
}

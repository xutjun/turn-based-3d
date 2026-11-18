// 导航网格（步骤 15，DESIGN §11.3）：把可走区域划成方格，障碍物按“障碍半径 + 单位半径 + 余量”膨胀后栅格化，
// 格子中心落在膨胀后的障碍里就不可走。纯计算，不依赖 three.js 和 DOM。

import { EXPLORE_CONFIG } from '../data/exploreConfig';
import { obstacleDistance, type Obstacle } from './collision';
import type { Bounds } from './walker';

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** 1 = 可走 */
  readonly walkable: Uint8Array;

  /**
   * @param inflate 障碍物膨胀量（单位半径 + 余量）：格子中心离障碍表面不到这么远就不可走
   */
  constructor(
    readonly bounds: Bounds,
    readonly cell: number,
    readonly obstacles: readonly Obstacle[],
    readonly inflate: number,
  ) {
    this.cols = Math.max(1, Math.round((bounds.maxX - bounds.minX) / cell));
    this.rows = Math.max(1, Math.round((bounds.maxZ - bounds.minZ) / cell));
    this.walkable = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.centerX(c);
        const z = this.centerZ(r);
        let free = true;
        for (const o of obstacles) {
          if (obstacleDistance(o, x, z) < inflate) {
            free = false;
            break;
          }
        }
        this.walkable[r * this.cols + c] = free ? 1 : 0;
      }
    }
  }

  centerX(c: number): number {
    return this.bounds.minX + (c + 0.5) * this.cell;
  }

  centerZ(r: number): number {
    return this.bounds.minZ + (r + 0.5) * this.cell;
  }

  /** 世界坐标所在的列 / 行（夹在网格内） */
  colOf(x: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.bounds.minX) / this.cell)));
  }

  rowOf(z: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.bounds.minZ) / this.cell)));
  }

  index(c: number, r: number): number {
    return r * this.cols + c;
  }

  /** 世界坐标所在格子的编号（夹在网格内） */
  indexAt(x: number, z: number): number {
    return this.index(this.colOf(x), this.rowOf(z));
  }

  isWalkableCell(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows && this.walkable[r * this.cols + c] === 1;
  }

  /** 世界坐标处是否可走（在边界外为否） */
  isWalkableAt(x: number, z: number): boolean {
    const b = this.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
    return this.walkable[this.indexAt(x, z)] === 1;
  }

  /** 格子中心的世界坐标 */
  centerOf(i: number): { x: number; z: number } {
    return { x: this.centerX(i % this.cols), z: this.centerZ(Math.floor(i / this.cols)) };
  }

  /**
   * 两点之间的连线是否全部落在可走格里（视线检查，拉直路径和跑动中跳过拐点用）。
   * 按 cell / 4 的间距采样，比格子边长细得多，不会漏掉斜穿的格子角。
   */
  lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    const dist = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(dist / (this.cell / 4)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (!this.isWalkableAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }
}

/** 按配置建一张网格 */
export function buildNavGrid(obstacles: readonly Obstacle[], cfg = EXPLORE_CONFIG): NavGrid {
  return new NavGrid(cfg.bounds, cfg.nav.cellSize, obstacles, cfg.collision.unitRadius + cfg.nav.clearance);
}

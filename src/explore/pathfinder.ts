// 寻路（步骤 15，DESIGN §11.3）：8 邻接格子 A*（斜走代价 √2、禁止切角、八方向距离启发）+ 视线拉直；
// 点到不可达处时走到“与起点连通的格子里离点击处最近的那一格”。纯计算，不依赖 three.js 和 DOM。

import { EXPLORE_CONFIG } from '../data/exploreConfig';
import { clearance, inBounds } from './collision';
import type { NavGrid } from './navGrid';

export interface Pt {
  x: number;
  z: number;
}

export interface PathResult {
  /** 路点：第一个是起点（单位当前的精确位置），最后一个是终点 */
  points: Pt[];
  /** 实际要去的终点 */
  goal: Pt;
  /** 终点就是点击处（false = 点击处不可达，换成了最近的可达点） */
  exact: boolean;
}

const SQRT2 = Math.SQRT2;
// 8 个邻居：dc, dr, 代价
const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** 斜走时两个正交邻格都必须可走（不切障碍的角） */
function canStep(g: NavGrid, c: number, r: number, dc: number, dr: number): boolean {
  if (!g.isWalkableCell(c + dc, r + dr)) return false;
  if (dc !== 0 && dr !== 0) return g.isWalkableCell(c + dc, r) && g.isWalkableCell(c, r + dr);
  return true;
}

/** 离 (x, z) 最近的可走格（mask 给出时只在 mask 为 1 的格子里找）；没有返回 −1 */
export function nearestCell(g: NavGrid, x: number, z: number, mask?: Uint8Array): number {
  let best = -1;
  let bestD = Infinity;
  for (let r = 0; r < g.rows; r++) {
    const dz = g.centerZ(r) - z;
    const dz2 = dz * dz;
    if (dz2 >= bestD) continue;
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c;
      if (g.walkable[i] !== 1 || (mask && mask[i] !== 1)) continue;
      const dx = g.centerX(c) - x;
      const d = dx * dx + dz2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  return best;
}

/** 从某格出发能走到的所有格子（与 A* 同样的邻接规则） */
export function reachableFrom(g: NavGrid, start: number): Uint8Array {
  const seen = new Uint8Array(g.cols * g.rows);
  if (start < 0 || g.walkable[start] !== 1) return seen;
  const queue = new Int32Array(g.cols * g.rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const i = queue[head++]!;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    for (const [dc, dr] of NEIGHBORS) {
      if (!canStep(g, c, r, dc, dr)) continue;
      const j = (r + dr) * g.cols + (c + dc);
      if (seen[j]) continue;
      seen[j] = 1;
      queue[tail++] = j;
    }
  }
  return seen;
}

/** 最小堆（按 f 值） */
class Heap {
  private readonly idx: number[] = [];
  private readonly key: number[] = [];

  get size(): number {
    return this.idx.length;
  }

  push(i: number, f: number): void {
    const a = this.idx;
    const k = this.key;
    a.push(i);
    k.push(f);
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (k[p]! <= f) break;
      a[n] = a[p]!;
      k[n] = k[p]!;
      n = p;
    }
    a[n] = i;
    k[n] = f;
  }

  pop(): number {
    const a = this.idx;
    const k = this.key;
    const top = a[0]!;
    const lastI = a.pop()!;
    const lastK = k.pop()!;
    if (a.length > 0) {
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const m = r < a.length && k[r]! < k[l]! ? r : l;
        if (k[m]! >= lastK) break;
        a[n] = a[m]!;
        k[n] = k[m]!;
        n = m;
      }
      a[n] = lastI;
      k[n] = lastK;
    }
    return top;
  }
}

/** 格子 A*：返回从 start 到 goal 的格子编号序列（含两端）；不连通返回 null */
export function aStar(g: NavGrid, start: number, goal: number): number[] | null {
  if (start < 0 || goal < 0 || g.walkable[start] !== 1 || g.walkable[goal] !== 1) return null;
  if (start === goal) return [start];
  const n = g.cols * g.rows;
  const cost = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gc = goal % g.cols;
  const gr = (goal - gc) / g.cols;
  const h = (c: number, r: number): number => {
    const dx = Math.abs(c - gc);
    const dy = Math.abs(r - gr);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap = new Heap();
  cost[start] = 0;
  heap.push(start, h(start % g.cols, Math.floor(start / g.cols)));
  while (heap.size > 0) {
    const i = heap.pop();
    if (closed[i]) continue;
    if (i === goal) break;
    closed[i] = 1;
    const c = i % g.cols;
    const r = (i - c) / g.cols;
    for (const [dc, dr, w] of NEIGHBORS) {
      if (!canStep(g, c, r, dc, dr)) continue;
      const j = (r + dr) * g.cols + (c + dc);
      if (closed[j]) continue;
      const nc = cost[i]! + w;
      if (nc < cost[j]!) {
        cost[j] = nc;
        parent[j] = i;
        heap.push(j, nc + h(c + dc, r + dr));
      }
    }
  }
  if (parent[goal] === -1) return null;
  const out: number[] = [];
  for (let i = goal; i !== -1; i = parent[i]!) out.push(i);
  return out.reverse();
}

/** 视线拉直：从当前点往后找最远的、连线全部可走的路点，只留下拐点 */
export function smoothPath(g: NavGrid, pts: readonly Pt[]): Pt[] {
  if (pts.length <= 2) return pts.map((p) => ({ ...p }));
  const out: Pt[] = [{ ...pts[0]! }];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !g.lineOfSight(pts[i]!.x, pts[i]!.z, pts[j]!.x, pts[j]!.z)) j--;
    out.push({ ...pts[j]! });
    i = j;
  }
  return out;
}

/**
 * 从 from 到 to 的路径。
 * - 起点所在格不可走（单位贴着障碍、落在膨胀区里）时，先就近找一个可走格作为搜索起点；
 * - 终点：点击处可达且离障碍足够远 → 用点击处的精确坐标；否则取与起点连通的格子里离点击处最近的一格；
 * - 整张图没有可走格时返回 null。
 * @param unitRadius 单位的碰撞半径（判断点击处能不能站人）
 */
export function findPath(g: NavGrid, from: Pt, to: Pt, unitRadius: number = EXPLORE_CONFIG.collision.unitRadius): PathResult | null {
  let start = g.indexAt(from.x, from.z);
  if (g.walkable[start] !== 1 || !inBounds(g.bounds, from.x, from.z)) start = nearestCell(g, from.x, from.z);
  if (start < 0) return null;
  const reach = reachableFrom(g, start);
  // 终点
  let goalCell = g.indexAt(to.x, to.z);
  let goal: Pt;
  let exact = false;
  const standable = inBounds(g.bounds, to.x, to.z) && clearance(g.obstacles, to.x, to.z) >= unitRadius + 0.02;
  if (inBounds(g.bounds, to.x, to.z) && g.walkable[goalCell] === 1 && reach[goalCell] === 1 && standable) {
    goal = { x: to.x, z: to.z };
    exact = true;
  } else {
    if (!(g.walkable[goalCell] === 1 && reach[goalCell] === 1 && inBounds(g.bounds, to.x, to.z))) goalCell = nearestCell(g, to.x, to.z, reach);
    if (goalCell < 0) return null;
    goal = g.centerOf(goalCell);
  }
  const cells = aStar(g, start, goalCell);
  if (!cells) return null;
  const pts: Pt[] = [{ x: from.x, z: from.z }];
  // 中间的格子中心（起点格可走时它的中心就不要了：单位直接从当前位置出发）
  const firstWalkable = g.walkable[g.indexAt(from.x, from.z)] === 1 && inBounds(g.bounds, from.x, from.z);
  for (let k = firstWalkable ? 1 : 0; k < cells.length - 1; k++) pts.push(g.centerOf(cells[k]!));
  pts.push(goal);
  return { points: smoothPath(g, pts), goal, exact };
}

/** 折线的总长 */
export function pathLength(points: readonly Pt[], from = 0): number {
  let s = 0;
  for (let i = from + 1; i < points.length; i++) s += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  return s;
}

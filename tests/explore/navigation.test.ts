import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/core/rng';
import { BATTLEFIELD_LAYOUT, DRUM_RADIUS, PILLAR_RADIUS } from '../../src/data/battlefieldLayout';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { slotPosition } from '../../src/data/formation';
import { LeaderAgent } from '../../src/explore/agent';
import {
  bossObstacle,
  clearance,
  layoutObstacles,
  moveWithCollision,
  obstacleDistance,
  type CircleObstacle,
  type Obstacle,
} from '../../src/explore/collision';
import { ExploreWorld, type NavWorld } from '../../src/explore/exploreWorld';
import { buildNavGrid, NavGrid } from '../../src/explore/navGrid';
import { aStar, findPath, pathLength, reachableFrom } from '../../src/explore/pathfinder';
import { resolveExploreClick } from '../../src/ui/explore/ExplorePointer';
import type { ScreenBox } from '../../src/ui/input/picking';

// 步骤 15：探索模式的碰撞、导航网格、寻路、队长运动学（纯逻辑）

const DT = 1 / 60;
const R = EXPLORE_CONFIG.collision.unitRadius;
const BOUNDS = EXPLORE_CONFIG.bounds;
const boss = ENEMY_TEMPLATES.find((t) => t.rank === 'boss')!;
const BOSS = slotPosition('enemy', boss.slot);
const world = new ExploreWorld(BOSS);
const START = EXPLORE_CONFIG.start;

/** 单位与所有障碍物的最小间隙（< 0 = 穿进去了） */
const gap = (w: NavWorld, x: number, z: number): number => clearance(w.obstacles, x, z) - R;

/** 跑 seconds 秒，逐帧检查不穿进障碍物、不出边界、没有 NaN；返回最小间隙 */
function run(a: LeaderAgent, w: NavWorld, seconds: number, each?: (t: number) => void): number {
  let minGap = Infinity;
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    a.update(DT);
    expect(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.yaw)).toBe(true);
    expect(a.x).toBeGreaterThanOrEqual(w.bounds.minX);
    expect(a.x).toBeLessThanOrEqual(w.bounds.maxX);
    expect(a.z).toBeGreaterThanOrEqual(w.bounds.minZ);
    expect(a.z).toBeLessThanOrEqual(w.bounds.maxZ);
    minGap = Math.min(minGap, gap(w, a.x, a.z));
    each?.(i * DT);
  }
  return minGap;
}

function newAgent(w: NavWorld = world, x = START.x, z = START.z, yaw = 0): LeaderAgent {
  const a = new LeaderAgent(w);
  a.place(x, z, yaw);
  return a;
}

describe('步骤 15：障碍物数据（与场景同一份布局）', () => {
  const obs = layoutObstacles();

  it('每个石柱、断柱、火盆、旗杆、骨堆都是障碍；Boss 单独一个；碎石不算', () => {
    const L = BATTLEFIELD_LAYOUT;
    const count = (tag: string): number => obs.filter((o) => o.tag === tag).length;
    expect(count('pillar')).toBe(L.pillars.length);
    expect(count('drum')).toBe(L.drums.length);
    expect(count('brazier')).toBe(L.braziers.length);
    expect(count('banner')).toBe(L.banners.length);
    expect(count('bonePile')).toBe(L.bonePiles.length);
    expect(obs.length).toBe(L.pillars.length + L.drums.length + L.braziers.length + L.banners.length + L.bonePiles.length);
    expect(world.obstacles.filter((o) => o.tag === 'boss')).toHaveLength(1);
  });

  it('碰撞半径来自配置：石柱 = 柱身 + 碎石堆、火盆 0.7、Boss 1.4、单位 0.4', () => {
    const c = EXPLORE_CONFIG.collision;
    const pillar = obs.find((o) => o.tag === 'pillar') as CircleObstacle;
    expect(pillar.r).toBeCloseTo(PILLAR_RADIUS + c.pillarPad, 9);
    expect((obs.find((o) => o.tag === 'brazier') as CircleObstacle).r).toBe(0.7);
    expect(bossObstacle(BOSS).r).toBe(1.4);
    expect(c.unitRadius).toBe(0.4);
  });

  it('断柱是胶囊：中心在摆放位置，长度 = len，轴向与模型（沿本地 x 横躺，绕 y 转 rot）一致', () => {
    const drums = obs.filter((o) => o.kind === 'capsule');
    BATTLEFIELD_LAYOUT.drums.forEach((d, i) => {
      const o = drums[i]!;
      if (o.kind !== 'capsule') throw new Error();
      expect((o.ax + o.bx) / 2).toBeCloseTo(d.x, 9);
      expect((o.az + o.bz) / 2).toBeCloseTo(d.z, 9);
      expect(Math.hypot(o.bx - o.ax, o.bz - o.az)).toBeCloseTo(d.len, 9);
      // three.js 绕 y 转 rot：本地 +x → 世界 (cos rot, 0, −sin rot)
      expect((o.bx - o.ax) / d.len).toBeCloseTo(Math.cos(d.rot), 9);
      expect((o.bz - o.az) / d.len).toBeCloseTo(-Math.sin(d.rot), 9);
      expect(o.r).toBe(DRUM_RADIUS);
    });
  });

  it('出生点、Boss 前方的交谈点都是可以站人的位置', () => {
    expect(gap(world, START.x, START.z)).toBeGreaterThan(0.3);
    expect(world.grid.isWalkableAt(START.x, START.z)).toBe(true);
  });
});

describe('步骤 15：碰撞与贴边滑动', () => {
  const pole: CircleObstacle = { kind: 'circle', tag: 'banner', x: 0, z: 0, r: 0.3 };

  it('正面撞上：停在表面，不会进去；斜着撞：沿表面滑过去', () => {
    const p = { x: -3, z: 0 };
    for (let i = 0; i < 120; i++) moveWithCollision(p, 6.4 * DT, 0, R, [pole], BOUNDS);
    expect(obstacleDistance(pole, p.x, p.z)).toBeGreaterThanOrEqual(R - 1e-9);
    expect(p.x).toBeLessThan(0);
    // 斜着（偏 0.1 米）撞上去：被表面引导绕到另一侧
    const q = { x: -3, z: 0.1 };
    let minD = Infinity;
    for (let i = 0; i < 120; i++) {
      moveWithCollision(q, 6.4 * DT, 0, R, [pole], BOUNDS);
      minD = Math.min(minD, obstacleDistance(pole, q.x, q.z));
    }
    expect(minD).toBeGreaterThanOrEqual(R - 1e-9);
    expect(q.x).toBeGreaterThan(1); // 滑过去了
  });

  it('最大帧间隔（0.1 秒）下满速冲向最细的旗杆也跨不过去（位移分小步）', () => {
    const p = { x: -0.75, z: 0 };
    moveWithCollision(p, 6.4 * 0.1 * 3, 0, R, [pole], BOUNDS); // 一次 1.9 米
    expect(obstacleDistance(pole, p.x, p.z)).toBeGreaterThanOrEqual(R - 1e-9);
    expect(p.x).toBeLessThan(0);
  });

  it('胶囊（断柱）：从侧面、端头撞上都进不去', () => {
    const drum: Obstacle = { kind: 'capsule', tag: 'drum', ax: -1, az: 0, bx: 1, bz: 0, r: 0.55 };
    for (const [sx, sz, dx, dz] of [
      [0, -3, 0, 1],
      [-4, 0, 1, 0],
      [0.9, 3, -0.1, -1],
    ] as const) {
      const p = { x: sx, z: sz };
      for (let i = 0; i < 180; i++) {
        moveWithCollision(p, dx * 6.4 * DT, dz * 6.4 * DT, R, [drum], BOUNDS);
        expect(obstacleDistance(drum, p.x, p.z)).toBeGreaterThanOrEqual(R - 1e-9);
      }
    }
  });

  it('边界：夹在可走区域里，贴着边界还能沿边走', () => {
    const p = { x: BOUNDS.maxX - 0.1, z: 0 };
    for (let i = 0; i < 60; i++) moveWithCollision(p, 6.4 * DT, 1 * DT, R, [], BOUNDS);
    expect(p.x).toBe(BOUNDS.maxX);
    expect(p.z).toBeGreaterThan(0.5);
  });

  it('方向键（调试）：朝每一个障碍物从 8 个方向满速冲 2 秒，全程不进入障碍物', () => {
    for (const o of world.obstacles) {
      const c = o.kind === 'circle' ? { x: o.x, z: o.z } : { x: (o.ax + o.bx) / 2, z: (o.az + o.bz) / 2 };
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const d = o.r + R + 2.5;
        const sx = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, c.x + Math.cos(ang) * d));
        const sz = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, c.z + Math.sin(ang) * d));
        if (gap(world, sx, sz) < 0) continue; // 起点本身在别的障碍里（挨得很近的物件），跳过
        const a = newAgent(world, sx, sz);
        a.setManual(c.x - sx, c.z - sz);
        expect(run(a, world, 2)).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('方向键斜着顶住障碍物时贴着表面滑动（还在移动），身体朝滑动方向', () => {
    const w = customWorld([{ kind: 'circle', tag: 'bonePile', x: 0, z: 0, r: 1.1 }]);
    const a = newAgent(w, -4, 0.3, Math.PI / 2);
    a.setManual(1, 0);
    run(a, w, 0.75);
    expect(gap(w, a.x, a.z)).toBeGreaterThanOrEqual(-1e-6);
    const speed = a.actualSpeed;
    expect(speed).toBeGreaterThan(1); // 没有被卡死
    run(a, w, 1.5);
    expect(a.x).toBeGreaterThan(1.5); // 绕过去了
  });
});

/** 用自定义障碍物搭一个小世界（不含场景物件） */
function customWorld(obstacles: Obstacle[], bounds = BOUNDS): NavWorld {
  const cfg = { ...EXPLORE_CONFIG, bounds };
  return { grid: buildNavGrid(obstacles, cfg), obstacles, bounds, unitRadius: R };
}

describe('步骤 15：导航网格与 A*', () => {
  it('格子 0.25 米；膨胀后的障碍里的格子不可走，其余可走', () => {
    const g = world.grid;
    expect(g.cell).toBe(0.25);
    expect(g.cols).toBe(136);
    expect(g.rows).toBe(136);
    const inflate = R + EXPLORE_CONFIG.nav.clearance;
    for (let i = 0; i < g.cols * g.rows; i += 7) {
      const c = g.centerOf(i);
      const blocked = clearance(world.obstacles, c.x, c.z) < inflate;
      expect(g.walkable[i] === 0).toBe(blocked);
    }
  });

  it('A*：结果的每一步都是相邻可走格，斜走不切角；与暴力 BFS 的连通性一致', () => {
    const g = world.grid;
    const s = g.indexAt(START.x, START.z);
    const t = g.indexAt(-12, 12);
    const cells = aStar(g, s, t)!;
    expect(cells[0]).toBe(s);
    expect(cells.at(-1)).toBe(t);
    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1]!;
      const b = cells[k]!;
      const dc = (b % g.cols) - (a % g.cols);
      const dr = Math.floor(b / g.cols) - Math.floor(a / g.cols);
      expect(Math.max(Math.abs(dc), Math.abs(dr))).toBe(1);
      expect(g.walkable[b]).toBe(1);
      if (dc !== 0 && dr !== 0) {
        expect(g.isWalkableCell((a % g.cols) + dc, Math.floor(a / g.cols))).toBe(true);
        expect(g.isWalkableCell(a % g.cols, Math.floor(a / g.cols) + dr)).toBe(true);
      }
    }
    expect(reachableFrom(g, s)[t]).toBe(1);
  });

  it('A* 是最短的：绕一根柱子的路径长度 ≈ 解析的最短绕行距离', () => {
    const r = 1;
    const w = customWorld([{ kind: 'circle', tag: 'pillar', x: 0, z: 0, r }]);
    const res = findPath(w.grid, { x: -6, z: 0 }, { x: 6, z: 0 })!;
    // 膨胀后的圆半径 ρ，起终点距圆心 d：最短绕行 = 2·√(d² − ρ²) + ρ·(π − 2·acos(ρ / d))
    const rho = r + R + EXPLORE_CONFIG.nav.clearance;
    const d = 6;
    const best = 2 * Math.sqrt(d * d - rho * rho) + rho * (Math.PI - 2 * Math.acos(rho / d));
    const len = pathLength(res.points);
    expect(len).toBeGreaterThanOrEqual(best - 0.05);
    expect(len).toBeLessThan(best * 1.06);
    expect(res.exact).toBe(true);
  });

  it('拉直：路点很少、相邻路点之间的连线全部可走；起点是当前位置，终点是点击处', () => {
    const from = { x: START.x, z: START.z };
    const to = { x: -13, z: 12 };
    const res = findPath(world.grid, from, to)!;
    expect(res.points[0]).toEqual(from);
    expect(res.points.at(-1)).toEqual(to);
    expect(res.exact).toBe(true);
    expect(res.points.length).toBeLessThanOrEqual(6);
    for (let k = 1; k < res.points.length; k++) {
      const a = res.points[k - 1]!;
      const b = res.points[k]!;
      expect(world.grid.lineOfSight(a.x, a.z, b.x, b.z)).toBe(true);
    }
  });

  it('绕开 Boss：从出生点到 Boss 正后方的路径不穿过 Boss（Boss 不在场时可以直穿）', () => {
    const behind = { x: BOSS.x - 4, z: BOSS.z - 4 };
    const res = findPath(world.grid, START, behind)!;
    const pts = res.points;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1]!;
      const b = pts[k]!;
      for (let t = 0; t <= 1; t += 0.01) {
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        expect(Math.hypot(x - BOSS.x, z - BOSS.z)).toBeGreaterThan(1.4 + R);
      }
    }
    const open = new ExploreWorld(BOSS);
    open.setBossPresent(false);
    expect(open.obstacles.some((o) => o.tag === 'boss')).toBe(false);
    const direct = findPath(open.grid, START, behind)!;
    expect(pathLength(direct.points)).toBeLessThan(pathLength(pts) - 0.1);
  });

  it('单次寻路足够快（跨整张图 < 30 毫秒）', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) findPath(world.grid, { x: 16.5, z: 16.5 }, { x: -16.5, z: -16.5 });
    expect((performance.now() - t0) / 10).toBeLessThan(30);
  });
});

describe('步骤 15：不可达的点击处 → 最近的可达点', () => {
  it('点在火盆、骨堆、石柱、Boss 里：终点在障碍物外、离点击处最近（误差 < 1 格），exact = false', () => {
    const targets = [
      ...BATTLEFIELD_LAYOUT.braziers,
      ...BATTLEFIELD_LAYOUT.bonePiles,
      ...BATTLEFIELD_LAYOUT.pillars.filter((p) => Math.abs(p.x) < 17 && Math.abs(p.z) < 17),
      BOSS,
    ];
    const g = world.grid;
    for (const t of targets) {
      const res = findPath(g, START, t)!;
      expect(res, `${t.x},${t.z}`).not.toBeNull();
      expect(res.exact).toBe(false);
      expect(gap(world, res.goal.x, res.goal.z)).toBeGreaterThan(0);
      // 与“真正离点击处最近的可走格”比较
      const reach = reachableFrom(g, g.indexAt(START.x, START.z));
      let best = Infinity;
      for (let i = 0; i < reach.length; i++) if (reach[i]) best = Math.min(best, Math.hypot(g.centerOf(i).x - t.x, g.centerOf(i).z - t.z));
      expect(Math.hypot(res.goal.x - t.x, res.goal.z - t.z)).toBeLessThan(best + 1e-9);
    }
  });

  it('点在场景边界外：终点在边界内离点击处最近的地方', () => {
    const res = findPath(world.grid, START, { x: 40, z: 5 })!;
    expect(res.exact).toBe(false);
    expect(res.goal.x).toBeGreaterThan(BOUNDS.maxX - 0.3);
    expect(Math.abs(res.goal.z - 5)).toBeLessThan(0.3);
  });

  it('点在被围住、与起点不连通的区域：走到连通区域里离点击处最近的一格', () => {
    // 一圈柱子围出一个封闭的小院子
    const ring: Obstacle[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      ring.push({ kind: 'circle', tag: 'pillar', x: Math.cos(a) * 4, z: Math.sin(a) * 4, r: 0.7 });
    }
    const w = customWorld(ring);
    expect(w.grid.isWalkableAt(0, 0)).toBe(true); // 院子里面本身是空地
    const res = findPath(w.grid, { x: 10, z: 0 }, { x: 0, z: 0 })!;
    expect(res.exact).toBe(false);
    expect(Math.hypot(res.goal.x, res.goal.z)).toBeGreaterThan(4); // 在围墙外面
    expect(Math.hypot(res.goal.x, res.goal.z)).toBeLessThan(6);
  });

  it('起点自己落在膨胀区里（贴着障碍物站）：照样能找到路', () => {
    const o = world.obstacles.find((x) => x.tag === 'brazier') as CircleObstacle;
    const from = { x: o.x + o.r + R + 0.05, z: o.z }; // 离表面只有 5 厘米，在膨胀区里
    expect(world.grid.isWalkableAt(from.x, from.z)).toBe(false);
    const res = findPath(world.grid, from, START)!;
    expect(res.exact).toBe(true);
    expect(res.points[0]).toEqual(from);
  });
});

describe('步骤 15：队长跑过去（点击移动）', () => {
  it('长距离：起跑加速到 6.4 米/秒，到达前平滑减速，停在终点（误差 < 2 厘米），全程不碰障碍', () => {
    const a = newAgent(world, START.x, START.z, Math.atan2(BOSS.x - START.x, BOSS.z - START.z));
    const r = a.moveTo(-12, 13)!;
    expect(r.exact).toBe(true);
    let maxSpeed = 0;
    let prev = 0;
    let maxDv = 0;
    let arrived = -1;
    const minGap = run(a, world, 12, (t) => {
      const s = a.speed;
      maxSpeed = Math.max(maxSpeed, s);
      maxDv = Math.max(maxDv, Math.abs(s - prev));
      prev = s;
      if (arrived < 0 && !a.hasPath) arrived = t;
    });
    expect(minGap).toBeGreaterThanOrEqual(-1e-6);
    expect(maxSpeed).toBeCloseTo(EXPLORE_CONFIG.move.runSpeed, 6);
    expect(maxDv).toBeLessThanOrEqual(EXPLORE_CONFIG.move.decel * DT + 1e-9); // 速度没有跳变
    expect(arrived).toBeGreaterThan(0);
    expect(Math.hypot(a.x + 12, a.z - 13)).toBeLessThan(0.02);
    expect(a.speed).toBe(0);
  });

  it('起跑：约 0.7 秒跑到满速；停步：最后 0.4 秒内速度从小跑降到 0（一两步缓冲）', () => {
    const a = newAgent(world, START.x, START.z, Math.PI); // 面朝 −z
    a.moveTo(START.x, START.z - 12);
    const speeds: number[] = [];
    run(a, world, 4, () => speeds.push(a.actualSpeed));
    const full = speeds.findIndex((s) => s >= EXPLORE_CONFIG.move.runSpeed - 1e-6);
    expect(full * DT).toBeGreaterThan(0.6);
    expect(full * DT).toBeLessThan(0.85);
    const stop = speeds.findIndex((s, i) => i > full && s === 0);
    expect(stop).toBeGreaterThan(0);
    // 停下前 0.4 秒还在小跑（> 2 米/秒），不是从满速一下子停住
    const before = speeds[stop - Math.round(0.4 / DT)]!;
    expect(before).toBeGreaterThan(2);
    expect(before).toBeLessThan(EXPLORE_CONFIG.move.runSpeed);
  });

  it('跑动中再次点击：立刻改道，速度不中断（不会先停下来）', () => {
    const a = newAgent(world, START.x, START.z, Math.PI);
    a.moveTo(START.x, -5);
    run(a, world, 1.2);
    expect(a.speed).toBeGreaterThan(6);
    a.moveTo(-5, START.z); // 改到左边
    let minSpeed = Infinity;
    run(a, world, 0.4, () => (minSpeed = Math.min(minSpeed, a.actualSpeed)));
    expect(minSpeed).toBeGreaterThan(1.5); // 转弯减速但不停
    run(a, world, 6);
    expect(Math.hypot(a.x + 5, a.z - START.z)).toBeLessThan(0.02);
  });

  it('身体朝向：起步时背对目标，先转身再加速；跑动中朝着移动方向', () => {
    const a = newAgent(world, START.x, START.z, 0); // 面朝 +z
    a.moveTo(START.x, START.z - 8); // 目标在 −z（身后）
    a.update(DT);
    expect(a.actualSpeed).toBeLessThan(0.05); // 第一帧几乎不动：先转身
    run(a, world, 0.8);
    const dir = Math.atan2(a.vx, a.vz);
    expect(Math.abs(Math.cos(a.yaw - dir) - 1)).toBeLessThan(0.02);
  });

  it('随机点击压力测试：600 次点击（含障碍物上、边界外、快速连点），全程不穿进任何障碍物、不出界、不报错', () => {
    const rng = createRng(15);
    const a = newAgent(world);
    let minGap = Infinity;
    let arrivals = 0;
    for (let k = 0; k < 600; k++) {
      // 1/4 点在某个障碍物中心，1/8 点在边界外，其余随机
      const roll = rng.next();
      let x: number;
      let z: number;
      if (roll < 0.25) {
        const o = world.obstacles[Math.floor(rng.next() * world.obstacles.length)]!;
        x = o.kind === 'circle' ? o.x : o.ax;
        z = o.kind === 'circle' ? o.z : o.az;
      } else if (roll < 0.375) {
        x = (rng.next() - 0.5) * 60;
        z = (rng.next() - 0.5) * 60;
      } else {
        x = BOUNDS.minX + rng.next() * (BOUNDS.maxX - BOUNDS.minX);
        z = BOUNDS.minZ + rng.next() * (BOUNDS.maxZ - BOUNDS.minZ);
      }
      const res = a.moveTo(x, z);
      expect(res).not.toBeNull();
      expect(gap(world, res!.goal.x, res!.goal.z)).toBeGreaterThan(0);
      // 快速连点（0.05 ~ 0.3 秒）或等它跑一阵
      const wait = rng.next() < 0.4 ? 0.05 + rng.next() * 0.25 : 0.5 + rng.next() * 4;
      minGap = Math.min(minGap, run(a, world, wait));
      if (!a.hasPath) arrivals += 1;
    }
    expect(minGap).toBeGreaterThanOrEqual(-1e-6);
    expect(arrivals).toBeGreaterThan(100); // 等得够久的那些大多到了
  }, 30_000); // 步骤 17：测试文件变多、并行时 CPU 更忙，单独跑约 2 秒，默认 5 秒的超时会偶发不够

  it('每一次点击最终都能到达终点（随机 80 个点，各自等到停下）', () => {
    const rng = createRng(1515);
    const a = newAgent(world);
    for (let k = 0; k < 80; k++) {
      const x = BOUNDS.minX + rng.next() * (BOUNDS.maxX - BOUNDS.minX);
      const z = BOUNDS.minZ + rng.next() * (BOUNDS.maxZ - BOUNDS.minZ);
      const res = a.moveTo(x, z)!;
      let t = 0;
      while (a.hasPath && t < 20) {
        a.update(DT);
        t += DT;
        expect(gap(world, a.x, a.z)).toBeGreaterThanOrEqual(-1e-6);
      }
      expect(a.hasPath, `点击 (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe(false);
      expect(Math.hypot(a.x - res.goal.x, a.z - res.goal.z)).toBeLessThan(0.02);
    }
  });

  it('卡住（导航网格与实际障碍不一致）：几次重算后放弃、停下，不会穿过去，也不会原地乱抖', () => {
    // 网格里没有这堵“墙”，碰撞里有：寻路以为能直走，实际被挡住
    const wall: Obstacle = { kind: 'capsule', tag: 'drum', ax: 0, az: -6, bx: 0, bz: 6, r: 0.5 };
    const grid = buildNavGrid([]);
    const w: NavWorld = { grid, obstacles: [wall], bounds: BOUNDS, unitRadius: R };
    const a = newAgent(w, -3, 0, Math.PI / 2);
    a.moveTo(3, 0);
    const minGap = run(a, w, 6);
    expect(minGap).toBeGreaterThanOrEqual(-1e-6);
    expect(a.hasPath).toBe(false);
    expect(a.x).toBeLessThan(0);
  });

  it('方向键会取消点击目标；松开方向键后减速停下', () => {
    const a = newAgent(world);
    a.moveTo(-10, -10);
    run(a, world, 0.5);
    a.setManual(1, 0);
    expect(a.hasPath).toBe(false);
    expect(a.destination).toBeNull();
    run(a, world, 0.5);
    a.setManual(0, 0);
    run(a, world, 1);
    expect(a.speed).toBe(0);
  });
});

describe('步骤 15：鼠标点击的判定', () => {
  const box: ScreenBox = { id: 'E7', left: 100, right: 200, top: 50, bottom: 300, depth: 300 };
  const ground = (x: number, y: number) => ({ x: x / 10, z: y / 10 });

  it('点在 Boss 的屏幕范围里 = 点 Boss；其余是地面上的点；射线碰不到地面时什么都不做', () => {
    expect(resolveExploreClick(150, 200, box, ground)).toEqual({ kind: 'boss' });
    expect(resolveExploreClick(400, 200, box, ground)).toEqual({ kind: 'ground', x: 40, z: 20 });
    expect(resolveExploreClick(150, 200, null, ground)).toEqual({ kind: 'ground', x: 15, z: 20 });
    expect(resolveExploreClick(400, 200, box, () => null)).toBeNull();
  });

  it('点 Boss = 跑到 Boss 身边最近的可达点（不进入 Boss 的碰撞圈）', () => {
    const a = newAgent(world);
    const res = a.moveTo(BOSS.x, BOSS.z)!;
    expect(res.exact).toBe(false);
    run(a, world, 8);
    const d = Math.hypot(a.x - BOSS.x, a.z - BOSS.z);
    expect(d).toBeGreaterThanOrEqual(1.4 + R - 1e-6);
    expect(d).toBeLessThan(1.4 + R + EXPLORE_CONFIG.nav.clearance + 0.25);
  });
});

describe('步骤 15：网格类的边界情况', () => {
  it('视线检查：穿过障碍为否，空地为是；边界外为否', () => {
    const g = new NavGrid(BOUNDS, 0.25, [{ kind: 'circle', tag: 'pillar', x: 0, z: 0, r: 1 }], R);
    expect(g.lineOfSight(-5, 0, 5, 0)).toBe(false);
    expect(g.lineOfSight(-5, 3, 5, 3)).toBe(true);
    expect(g.isWalkableAt(BOUNDS.maxX + 1, 0)).toBe(false);
  });
});

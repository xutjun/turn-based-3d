// 入场过场的“走位规划”（步骤 17，DESIGN §11.4、§11.8）。纯计算，不依赖 three.js 和 DOM，可单元测试。
//
//   - 队员显形站位：队长左右两侧各两人（cutsceneConfig 的局部坐标）。谁站哪个位置不写死：
//     枚举 4 人的全部 24 种分配，取“站位 → 各自战斗格子”的直线总长最短的一种（平面上总长最短的配对两两不交叉），
//     于是从任何方向开打，震飞时各自的路线都不交叉；
//     落在障碍里、边界外、与别人挤在一起时，在原站位周围由近到远找一个能站的点，彼此、与队长至少隔开 minGap。
//   - 震飞：每人一条抛物线，从当前位置飞到自己的战斗格子（落点 = 格子，误差为 0）。冲击波到达时离地。
//     地面投影是直线加一段侧偏（sin 形），高度是抛物线。直线被石柱、火盆、Boss 挡住时先试侧偏、再加高，
//     直到全程不穿过任何障碍物；同时检查与已规划的人在同一时刻的空中间距。
//   - 宝宝入场：从主人身后斜着进来，落到后排格子。

import { INTRO_CONFIG, type IntroConfig, type PetEntryStyle, type TumbleStyle } from '../data/cutsceneConfig';
import { ROW_DIRECTION, facingOf } from '../data/formation';
import type { UnitId } from '../core/types';
import { clearance, inBounds, obstacleDistance, type Obstacle } from './collision';
import type { NavWorld } from './exploreWorld';
import { nearestCell } from './pathfinder';
import { localToWorld, yawOf } from './walker';

export interface Ground {
  x: number;
  z: number;
}

export interface GroundPose extends Ground {
  yaw: number;
}

// ----------------------------------------------------------------------
// 队员显形站位
// ----------------------------------------------------------------------

export interface RevealSpot extends GroundPose {
  id: UnitId;
}

/** 某点能不能站人：在边界内、离障碍物表面至少 单位半径 + 余量 */
function standable(world: NavWorld, x: number, z: number, margin: number): boolean {
  return inBounds(world.bounds, x, z) && clearance(world.obstacles, x, z) >= world.unitRadius + margin;
}

/** 离 (x, z) 最近的能站人的点：本身能站就不动，否则取导航网格里最近的可走格中心 */
export function nearestStandable(world: NavWorld, x: number, z: number, margin = 0.05): Ground {
  if (standable(world, x, z, margin)) return { x, z };
  const i = nearestCell(world.grid, x, z);
  if (i < 0) return { x, z };
  return world.grid.centerOf(i);
}

/**
 * 4 名队员显形的站位（队长两侧），全员面向 Boss。
 * @param leader 队长此刻的位置和朝向
 * @param members 队员与他们在战斗中的列号
 */
export function revealSpots(
  leader: GroundPose,
  members: readonly { id: UnitId; slot: Ground }[],
  boss: Ground,
  world: NavWorld,
  cfg: IntroConfig['reveal'] = INTRO_CONFIG.reveal,
): RevealSpot[] {
  const spots = cfg.spots.slice(0, members.length).map((s) => localToWorld(leader, s.x, s.z));
  const placed: Ground[] = [{ x: leader.x, z: leader.z }];
  const final: Ground[] = [];
  // 先定下每个站位（吸附到可走点、与别人隔开），再按最终位置分配人选
  spots.forEach((p) => {
    const free = (x: number, z: number): boolean =>
      standable(world, x, z, 0.05) && placed.every((o) => Math.hypot(x - o.x, z - o.z) >= cfg.minGap);
    // 原位置能站且不挤就用它；否则在周围由近到远找一个（同一圈里按角度均匀试）
    let q: Ground | null = free(p.x, p.z) ? { x: p.x, z: p.z } : null;
    for (let r = 0.25; !q && r <= 4; r += 0.25) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.3));
      let best: Ground | null = null;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 2 * Math.PI;
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (!free(x, z)) continue;
        // 同一圈里优先离队长近的（不跑到障碍物另一边去）
        const d = Math.hypot(x - leader.x, z - leader.z);
        if (d < bestD) {
          bestD = d;
          best = { x, z };
        }
      }
      q = best;
    }
    if (!q) q = nearestStandable(world, p.x, p.z);
    placed.push(q);
    final.push(q);
  });
  const order = bestAssignment(final, members.map((m) => m.slot));
  return final.map((q, k) => {
    const m = members[order[k]!]!;
    return { id: m.id, x: q.x, z: q.z, yaw: yawOf(boss.x - q.x, boss.z - q.z) };
  });
}

/** 全排列 */
function permutations(n: number): number[][] {
  if (n <= 1) return [[0].slice(0, n)];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let i = 0; i <= rest.length; i++) out.push([...rest.slice(0, i), n - 1, ...rest.slice(i)]);
  }
  return out;
}

/**
 * 站位 → 目标的一一分配：返回 order，第 k 个站位分给第 order[k] 个目标。取直线总长最短的分配
 * （总长相同时取字典序最小的，结果确定）。人数很少（4 人 24 种），直接枚举。
 */
export function bestAssignment(spots: readonly Ground[], targets: readonly Ground[]): number[] {
  let best: number[] = spots.map((_, i) => i);
  let bestCost = Infinity;
  for (const perm of permutations(spots.length)) {
    let cost = 0;
    perm.forEach((t, k) => (cost += Math.hypot(spots[k]!.x - targets[t]!.x, spots[k]!.z - targets[t]!.z)));
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = perm;
    }
  }
  return best;
}

// ----------------------------------------------------------------------
// 震飞
// ----------------------------------------------------------------------

export interface FlightPlan {
  id: UnitId;
  from: Ground;
  to: Ground;
  /** 离地时刻（相对 Boss 踏地的一瞬间）：冲击波到达 + 反应延迟 */
  launch: number;
  duration: number;
  /** 最高点高度（根节点离地） */
  apex: number;
  /** 地面投影的侧偏（米，沿行进方向的左侧为正），sin 形，中点最大 */
  bend: number;
  tumble: TumbleStyle;
}

/** 飞行进度 t（0~1）时的位置：地面投影匀速（抛体的水平速度不变），高度是抛物线 */
export function flightAt(plan: FlightPlan, t: number): { x: number; y: number; z: number } {
  // 两端精确等于起点、终点（落点误差为 0，不受浮点运算影响）
  if (t <= 0) return { x: plan.from.x, y: 0, z: plan.from.z };
  if (t >= 1) return { x: plan.to.x, y: 0, z: plan.to.z };
  const k = t;
  const dx = plan.to.x - plan.from.x;
  const dz = plan.to.z - plan.from.z;
  const len = Math.hypot(dx, dz);
  const nx = len > 1e-6 ? -dz / len : 0;
  const nz = len > 1e-6 ? dx / len : 0;
  const side = plan.bend * Math.sin(Math.PI * k);
  return {
    x: plan.from.x + dx * k + nx * side,
    y: plan.apex * 4 * k * (1 - k),
    z: plan.from.z + dz * k + nz * side,
  };
}

/** 某一时刻（相对踏地）这个人在哪里：离地前在起点，落地后在终点，中间在抛物线上 */
export function flightPositionAt(plan: FlightPlan, time: number): { x: number; y: number; z: number } {
  const t = (time - plan.launch) / plan.duration;
  return flightAt(plan, t);
}

export type FlightConfig = IntroConfig['flight'];

/**
 * 一条飞行路线离障碍物的最小余量（米，负数 = 穿模）。对每个障碍物：身体（半径 bodyRadius）的地面投影离障碍表面
 * 不到 clearance 时，脚下必须高出障碍物 overClear 以上（石柱、旗杆按无限高，只能绕开）。
 * 起点、终点本身是能站人的地方：靠近两端时只要求不比两端更贴近障碍。
 */
export function flightObstacleMargin(
  plan: FlightPlan,
  obstacles: readonly Obstacle[],
  heights: IntroConfig['obstacleHeight'] = INTRO_CONFIG.obstacleHeight,
  cfg: FlightConfig = INTRO_CONFIG.flight,
  samples = 64,
): { margin: number; tag: string | null } {
  let worst = Infinity;
  let tag: string | null = null;
  for (const o of obstacles) {
    const h = heights[o.tag] ?? Infinity;
    const endD = Math.min(obstacleDistance(o, plan.from.x, plan.from.z), obstacleDistance(o, plan.to.x, plan.to.z)) - cfg.bodyRadius;
    const need = Math.min(cfg.clearance, endD);
    for (let i = 1; i < samples; i++) {
      const p = flightAt(plan, i / samples);
      const d = obstacleDistance(o, p.x, p.z) - cfg.bodyRadius;
      const ground = d - need; // 地面投影的余量
      const over = p.y - (h + cfg.overClear); // 从上方越过的余量
      const m = Math.max(ground, over);
      if (m < worst) {
        worst = m;
        tag = o.tag;
      }
    }
  }
  return { margin: worst, tag };
}

/**
 * 两人同一时刻的最小间距（身体中心的三维距离），只看至少一人在空中的时段
 * （都站在地上时的间距由显形站位的 minGap 和战斗格子的间距保证）。
 */
export function flightSeparation(a: FlightPlan, b: FlightPlan, samples = 80): number {
  const t0 = Math.min(a.launch, b.launch);
  const t1 = Math.max(a.launch + a.duration, b.launch + b.duration);
  const airborne = (f: FlightPlan, t: number): boolean => t > f.launch && t < f.launch + f.duration;
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = t0 + ((t1 - t0) * i) / samples;
    if (!airborne(a, t) && !airborne(b, t)) continue;
    const p = flightPositionAt(a, t);
    const q = flightPositionAt(b, t);
    best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
  }
  return best;
}

/**
 * 两人在空中至少要隔开多远：配置的 separation，但不超过他们起跳前、落地后在地上站着时的间距
 * （刚离地、快落地的一瞬间本来就挨着那么近）。
 */
export function requiredSeparation(a: FlightPlan, b: FlightPlan, cfg: FlightConfig = INTRO_CONFIG.flight): number {
  const start = Math.hypot(a.from.x - b.from.x, a.from.z - b.from.z);
  const end = Math.hypot(a.to.x - b.to.x, a.to.z - b.to.z);
  return Math.min(cfg.separation, start - 0.02, end - 0.02);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.max(0, Math.min(1, t));

/**
 * 规划 5 人的震飞路线。
 * @param starts 每人离地的位置（队长 + 显形的队员）
 * @param targets 每人的战斗格子（世界坐标）
 * @param boss 冲击波的中心（Boss 脚下）
 */
export function planFlights(
  starts: readonly { id: UnitId; x: number; z: number }[],
  targets: Readonly<Record<UnitId, Ground>>,
  boss: Ground,
  obstacles: readonly Obstacle[],
  cfg: IntroConfig = INTRO_CONFIG,
): FlightPlan[] {
  const f = cfg.flight;
  const plans: FlightPlan[] = [];
  // 按离 Boss 的距离（先被击中的先规划）
  const order = [...starts].sort((a, b) => Math.hypot(a.x - boss.x, a.z - boss.z) - Math.hypot(b.x - boss.x, b.z - boss.z));
  order.forEach((s, index) => {
    const to = targets[s.id];
    if (!to) throw new Error(`${s.id} 没有战斗格子`);
    const dist = Math.hypot(to.x - s.x, to.z - s.z);
    const k = (dist - f.duration.nearDist) / (f.duration.farDist - f.duration.nearDist);
    const duration = lerp(f.duration.min, f.duration.max, k);
    const jitter = f.heightJitter[index % f.heightJitter.length] ?? 0;
    const baseApex = Math.min(f.maxApex, lerp(f.apex.min, f.apex.max, k) + jitter);
    const launch = Math.hypot(s.x - boss.x, s.z - boss.z) / cfg.stomp.waveSpeed + f.launchDelay;
    const tumble = f.tumble[s.id] ?? 'lean';
    // 候选：侧偏 0、±0.5、±1 …，最高点逐步加高；代价小的先试
    const candidates: { bend: number; apex: number; cost: number }[] = [];
    for (let b = 0; b <= f.maxBend + 1e-9; b += 0.5) {
      for (const sign of b === 0 ? [1] : [1, -1]) {
        for (let up = 0; baseApex + up <= f.maxApex + 1e-9; up += 0.5) {
          candidates.push({ bend: b * sign, apex: baseApex + up, cost: b + up * 1.5 });
        }
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);
    let best: FlightPlan | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const plan: FlightPlan = { id: s.id, from: { x: s.x, z: s.z }, to: { x: to.x, z: to.z }, launch, duration, apex: c.apex, bend: c.bend, tumble };
      const margin = flightObstacleMargin(plan, obstacles, cfg.obstacleHeight, f).margin;
      let sep = Infinity; // 与已规划的人在空中的间距余量
      for (const p of plans) sep = Math.min(sep, flightSeparation(plan, p) - requiredSeparation(plan, p, f));
      const ok = margin >= 0 && sep >= 0;
      if (ok) {
        best = plan;
        break;
      }
      // 都不满足时保留“最不坏”的那条
      const score = Math.min(margin, sep);
      if (score > bestScore) {
        bestScore = score;
        best = plan;
      }
    }
    plans.push(best!);
  });
  return plans;
}

// ----------------------------------------------------------------------
// 宝宝入场
// ----------------------------------------------------------------------

export interface PetEntry {
  id: UnitId;
  style: PetEntryStyle;
  from: Ground;
  to: Ground;
  /** 开始时刻（相对宝宝入场这一段的开始） */
  start: number;
  duration: number;
}

/**
 * 宝宝从主人身后（离格子 behind 米、沿排方向往外侧偏 aside 米）进来，落到后排格子；
 * 左半边（列号小）的从左侧进、右半边的从右侧进。按列号依次出发。
 * 起点和路线离障碍物太近时把侧偏减小（直至 0）。
 */
export function planPetEntries(
  pets: readonly { id: UnitId; templateId: string; col: number; slot: Ground }[],
  obstacles: readonly Obstacle[],
  cfg: IntroConfig['pets'] = INTRO_CONFIG.pets,
): PetEntry[] {
  const f = facingOf('ally');
  const sorted = [...pets].sort((a, b) => a.col - b.col);
  return sorted.map((p, i) => {
    const style = cfg.styles[p.templateId] ?? 'leap';
    const outward = p.col < 2 ? -1 : 1;
    const behind = style === 'slam' ? 1.2 : cfg.behind;
    let from: Ground = { x: p.slot.x, z: p.slot.z };
    for (let aside = cfg.aside; aside >= -1e-9; aside -= 0.35) {
      from = {
        x: p.slot.x - f.x * behind + ROW_DIRECTION.x * aside * outward,
        z: p.slot.z - f.z * behind + ROW_DIRECTION.z * aside * outward,
      };
      // 起点和中点离障碍物表面至少 0.8 米
      const mid = { x: (from.x + p.slot.x) / 2, z: (from.z + p.slot.z) / 2 };
      if (clearance(obstacles, from.x, from.z) >= 0.8 && clearance(obstacles, mid.x, mid.z) >= 0.8) break;
    }
    const duration = cfg[style].duration;
    return { id: p.id, style, from, to: { x: p.slot.x, z: p.slot.z }, start: i * cfg.stagger, duration };
  });
}

/** 宝宝入场的总时长（最后一只就位） */
export function petEntriesDuration(entries: readonly PetEntry[]): number {
  return entries.reduce((m, e) => Math.max(m, e.start + e.duration), 0);
}

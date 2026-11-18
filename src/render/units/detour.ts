// 冲锋路线绕开己方单位（步骤 17，DESIGN §11.7）：新阵型里人物在后排、宝宝在主人正前方，人物近战冲锋时
// 直线会从前排的宝宝身上穿过。这里算一个绕行方案（对任何单位都适用，没人挡路时不起作用）：
//   - 侧偏：地面投影在直线基础上向一侧弯出去（C1 平滑的鼓包），从挡路的人身边、或两人之间的空隙穿过去，到终点时回到直线上；
//   - 加高：把这一跳抬高，从肩膀上方、头的旁边越过（人物按“身体 + 头部”两段算：肩部以上只有头那么宽）。
//   两者组合，按“侧偏米数 + 加高倍率 × 1.5”的代价从小到大试，取第一个全程不碰人的方案
//   人物调用时先把宝宝当作越不过去的障碍（只试侧偏，UnitView），保证是从两只宝宝之间穿过去。
// 跳得够高、能从头顶越过的不绕；没有挡路的人时返回 null（与原来的直线完全一样）。纯计算，可单元测试。

export interface DetourObstacle {
  x: number;
  z: number;
  /** 身体半径（米） */
  radius: number;
  /** 身高（米）：跳跃时身体最低点高于它就算越过 */
  height: number;
  /** 肩高（米，不填 = 身高的 0.78）与头部半径（不填 = 身体半径的 0.4）：身体最低点高过肩膀时只需避开头 */
  shoulder?: number;
  headRadius?: number;
}

/** 路线上的一个采样：s = 位移进度（0~1），hop = 此时离地高度，lateral = 步态自带的弧线侧偏（米，左侧为正） */
export interface DetourSample {
  s: number;
  hop: number;
  lateral?: number;
}

export interface Detour {
  /** 侧偏的峰值（米，沿行进方向的左侧为正） */
  offset: number;
  /** 峰值所在的位移进度 */
  at: number;
  /** 离地高度的倍率（1 = 不加高） */
  lift: number;
}

const smoothstep = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/** 侧偏的鼓包：s = 0 和 1 时为 0，s = at 时为 1，处处平滑 */
export function detourBump(s: number, at: number): number {
  const a = Math.max(0.05, Math.min(0.95, at));
  return s <= a ? smoothstep(s / a) : 1 - smoothstep((s - a) / (1 - a));
}

/**
 * 算绕行方案。
 * @param selfRadius 冲锋者的身体半径
 * @param samples 沿路线的采样（进度、离地高度、步态自带的侧偏）
 * @param margin 两人身体之间至少留的空隙
 * @param maxOffset 侧偏的上限
 * @param maxLift 加高的倍率上限
 */
export function pathDetour(
  from: { x: number; z: number },
  to: { x: number; z: number },
  obstacles: readonly DetourObstacle[],
  selfRadius: number,
  samples: readonly DetourSample[],
  margin = 0.1,
  maxOffset = 2.4,
  maxLift = 3,
): Detour | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5 || obstacles.length === 0) return null;
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;
  const alongOf = (o: DetourObstacle): number => ((o.x - from.x) * ux + (o.z - from.z) * uz) / len;
  // 只看路线中段的人（起点、终点附近的人本来就站在那里）
  const relevant = obstacles.filter((o) => {
    const a = alongOf(o);
    return a > 0.02 && a < 0.98;
  });
  if (relevant.length === 0) return null;
  const blocked = (offset: number, at: number, lift: number): boolean => {
    for (const p of samples) {
      const side = (p.lateral ?? 0) + offset * detourBump(p.s, at);
      const x = from.x + dx * p.s + nx * side;
      const z = from.z + dz * p.s + nz * side;
      const hop = p.hop * lift;
      for (const o of relevant) {
        if (hop >= o.height) continue; // 从头顶越过
        // 高过肩膀：只需避开头
        const r = hop >= (o.shoulder ?? o.height * 0.78) ? (o.headRadius ?? o.radius * 0.4) : o.radius;
        if (Math.hypot(x - o.x, z - o.z) < r + selfRadius + margin) return true;
      }
    }
    return false;
  };
  if (!blocked(0, 0.5, 1)) return null;
  // 候选：侧偏（峰值放在某个挡路者那里、或几个常用位置）× 加高倍率；代价小的先试，同样代价先试远离第一个挡路者的一侧
  const first = [...relevant].sort((a, b) => alongOf(a) - alongOf(b))[0]!;
  const firstLateral = (first.x - from.x) * nx + (first.z - from.z) * nz;
  const away = firstLateral >= 0 ? -1 : 1;
  const ats = [...new Set([...relevant.map((o) => Math.round(alongOf(o) * 100) / 100), 0.25, 0.35, 0.5])].filter((a) => a > 0.05 && a < 0.95);
  const candidates: { offset: number; lift: number; cost: number; order: number }[] = [];
  let order = 0;
  for (let lift = 1; lift <= maxLift + 1e-9; lift += 0.25) {
    for (let mag = 0; mag <= maxOffset + 1e-9; mag += 0.15) {
      for (const sign of mag === 0 ? [1] : [away, -away]) {
        candidates.push({ offset: sign * mag, lift, cost: mag + (lift - 1) * 1.5, order: order++ });
      }
    }
  }
  candidates.sort((p, q) => p.cost - q.cost || p.order - q.order);
  for (const c of candidates) {
    if (c.offset === 0 && c.lift === 1) continue;
    for (const at of c.offset === 0 ? [0.5] : ats) {
      if (!blocked(c.offset, at, c.lift)) return { offset: c.offset, at, lift: c.lift };
    }
  }
  return null;
}

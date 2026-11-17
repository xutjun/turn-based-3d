// 人形腿部的两段骨骼 IK（步骤 14）：给出踝关节要去的位置，求髋、膝、踝三个关节的转角。
// 纯计算，不依赖 three.js，可单元测试。行走（walkGait.ts）和“踩地”（身体下沉时屈膝）都用它。
//
// 约定（与 assets/models/characters/rig.ts 一致）：
//   - 模型面朝 +z，腿沿关节的 −y 方向延伸；绕 x 轴转正角 = 肢体向后摆（脚往 −z 走）；
//   - 模型根节点在两脚之间的地面上，身体前倾（根节点 rotation.x）以根节点为轴；
//   - 髋关节在根节点上方 hipHeight 处，踝关节在髋下方 thigh + shin 处。
// 只在矢状面（前后、上下）里解，髋关节原有的外张角（rotation.z）保持不变。

/** 一条腿的尺寸（模型坐标，未乘整体缩放） */
export interface LegDims {
  hipHeight: number; // 髋关节离地高度
  thigh: number; // 大腿长（髋 → 膝）
  shin: number; // 小腿长（膝 → 踝）
}

/**
 * 踝关节的目标（地面坐标，相对模型根节点）：z 向前，y 离地高度；pitch = 脚掌的俯仰（脚尖抬起为正）；
 * x = 相对站姿的左右偏移（向左手侧为正；行走时身体左右换重心，脚要反向补偿才不横向滑动）。
 */
export interface FootTarget {
  x: number;
  z: number;
  y: number;
  pitch: number;
}

/** 三个关节绕 x 轴的转角，以及髋关节绕 z 轴的附加外张（都加在站姿上） */
export interface LegAngles {
  hip: number;
  knee: number;
  foot: number;
  hipRoll: number;
}

/** 站立时踝关节离地的高度 */
export function ankleHeight(d: LegDims): number {
  return d.hipHeight - d.thigh - d.shin;
}

/** 站姿下的踝关节目标：正下方、脚掌放平 */
export function restFoot(d: LegDims): FootTarget {
  return { x: 0, z: 0, y: ankleHeight(d), pitch: 0 };
}

/**
 * 两段骨骼 IK：踝关节相对髋关节的位置（身体坐标，dz 向前、dy 向上，通常为负），膝盖朝前弯。
 * 够不着时腿伸直指向目标；太近时按最短距离处理。maxReach = 允许的最大伸直比例（1 = 可以完全伸直）。
 * 返回髋、膝的转角（rig 约定：正角 = 向后）。
 */
export function solveLeg(thigh: number, shin: number, dz: number, dy: number, maxReach = 1): { hip: number; knee: number } {
  const T = thigh;
  const S = shin;
  const dist = Math.hypot(dz, dy);
  // 指向目标的方向：从“正下方”往前转的角度
  const dir = Math.atan2(dz, -dy);
  const far = (T + S) * Math.min(1, maxReach);
  if (dist >= far - 1e-9) {
    // 伸直（或允许的最大伸直程度）：maxReach < 1 时膝盖保持微屈
    if (maxReach >= 1) return { hip: -dir, knee: 0 };
    return bend(T, S, far, dir);
  }
  return bend(T, S, Math.max(Math.abs(T - S) + 1e-6, dist), dir);
}

function bend(T: number, S: number, dist: number, dir: number): { hip: number; knee: number } {
  const clampCos = (v: number): number => Math.max(-1, Math.min(1, v));
  // 大腿与目标连线的夹角、小腿与目标连线的夹角（余弦定理）；膝盖朝前 = 大腿比连线更靠前
  const a = Math.acos(clampCos((T * T + dist * dist - S * S) / (2 * T * dist)));
  const b = Math.acos(clampCos((S * S + dist * dist - T * T) / (2 * S * dist)));
  const thighAng = dir + a; // 大腿相对“正下方”向前的角度
  const shinAng = dir - b; // 小腿相对“正下方”向前的角度
  return { hip: -thighAng, knee: thighAng - shinAng };
}

/**
 * 正向运动学（测试和联系表用）：给定髋、膝转角，踝关节相对髋关节的位置（身体坐标）。
 */
export function forwardLeg(thigh: number, shin: number, hip: number, knee: number): { dz: number; dy: number } {
  const thighAng = -hip;
  const shinAng = thighAng - knee;
  return {
    dz: thigh * Math.sin(thighAng) + shin * Math.sin(shinAng),
    dy: -(thigh * Math.cos(thighAng) + shin * Math.cos(shinAng)),
  };
}

/**
 * 求一条腿的三个关节转角：
 * @param foot 踝关节目标（地面坐标，相对根节点）
 * @param pitch 身体的前倾角（根节点 rotation.x，前倾为正）
 * @param lift 根节点离地高度（模型坐标；下蹲为负，腾空为正）
 * @param tuck 收腿比例 0~1：腾空时把腿长上限缩短这么多（膝盖弯起来）
 * @param maxReach 允许的最大伸直比例
 */
export function legAngles(d: LegDims, foot: FootTarget, pitch: number, lift: number, tuck = 0, maxReach = 1): LegAngles {
  // 踝关节相对根节点（世界方向）→ 转进身体坐标（绕 x 轴转 −pitch）
  const Y = foot.y - lift;
  const Z = foot.z;
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  const by = Y * c + Z * s;
  const bz = -Y * s + Z * c;
  let dy = by - d.hipHeight;
  let dz = bz;
  if (tuck > 0) {
    // 收腿：腿长上限缩短，方向不变
    const cap = (d.thigh + d.shin) * (1 - tuck);
    const dist = Math.hypot(dz, dy);
    if (dist > cap && dist > 1e-9) {
      dz *= cap / dist;
      dy *= cap / dist;
    }
  }
  const { hip, knee } = solveLeg(d.thigh, d.shin, dz, dy, maxReach);
  // 左右：髋关节绕 z 轴多外张一点（正角 = 脚往左手侧），偏移量小，按当前髋到踝的距离近似
  const reachNow = Math.max(0.1, Math.hypot(dz, dy));
  const hipRoll = foot.x === 0 ? 0 : Math.asin(Math.max(-1, Math.min(1, foot.x / reachNow)));
  // 脚掌：总转角 = 身体前倾 + 髋 + 膝 + 踝；要让脚尖抬起 foot.pitch，总转角应为 −foot.pitch
  return { hip, knee, foot: -foot.pitch - pitch - hip - knee, hipRoll };
}

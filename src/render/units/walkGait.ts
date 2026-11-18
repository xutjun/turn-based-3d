// 行走步态（步骤 14，DESIGN §11.5）：纯计算，不依赖 three.js，可单元测试。
//
// 核心：相位按“走过的距离”推进（phase += 距离 / 周期长度），而不是按时间；
// 支撑脚在一个支撑相里相对身体向后移动的距离 = 身体前进的距离，所以脚在地面上原地不动——不会滑步。
// 步频自动跟着速度变：走得快，同样的距离走得更快，相位就推进得更快。
//
// 每只脚的轨迹（地面坐标，相对身体）：
//   支撑相（相位 0 ~ duty）：踝关节从 +duty·C/2 匀速退到 −duty·C/2；开头脚尖翘起、落平，末尾绕脚尖抬起脚跟（推离）。
//   摆动相（duty ~ 1）：埃尔米特曲线从后往前，两端的速度与支撑相衔接（离地和落地的瞬间脚相对地面不动），
//                     中间抬起 lift。
// 身体下沉量 drop：保证每只着地的脚都够得着（髋到踝不超过腿长 × reach），由此自然产生每步一次的起伏。
// 输出的是踝关节目标和身体、手臂的偏移量；关节转角由 legPose.ts 的 IK 在真实骨架尺寸上求出。
//
// 跑步（步骤 15，DESIGN §11.5）：同一套轨迹，参数按跑步权重 run（随速度 0 → 1）从走路过渡到跑步——
//   支撑相比例降到 0.24（两脚之间有腾空）、摆动脚先向后上方收（脚跟上踢）再提膝前送、
//   身体有显式的起伏曲线（支撑中段最低、腾空中段最高）、前倾更多、手臂屈肘大幅摆动。
//   run = 0 时所有参数与走路完全相同（走路的代码路径不变）。

import { RUN_GAIT, WALK_GAIT } from '../../data/exploreConfig';
import { ankleHeight, restFoot, type FootTarget, type LegDims } from './legPose';

export type WalkGaitConfig = typeof WALK_GAIT;
export type RunGaitConfig = typeof RUN_GAIT;

const TAU = Math.PI * 2;
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number): number => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const frac = (v: number): number => v - Math.floor(v);

/** 脚掌落地时脚跟到踝的水平距离（米，绕脚跟落平时踝关节的抬高用） */
const HEEL_LENGTH = 0.05;

/** 某个速度下的步态参数 */
export interface GaitParams {
  cycle: number; // 一个周期走过的距离（米）
  duty: number; // 支撑相比例
  lift: number; // 摆动脚的最大离地高度
  /** 跑步权重 0~1（0 = 走路） */
  run: number;
  /** 摆动脚最高点在摆动相里的位置（走路 0.5） */
  peak: number;
  /** 推离时脚跟抬起、落地时脚尖翘起（弧度） */
  heelLift: number;
  toeUp: number;
  /** 脚的前后位置整体前移（米）：跑步前倾时着地范围以髋的投影为中心（由 WalkGait 按骨架尺寸填写） */
  center: number;
  /** 跑步摆动曲线两端“速度匹配”的衰减宽度（摆动相比例，见 footAt） */
  snap: number;
}

/** 跑步权重：速度从 runFrom 到 runFull 平滑地由 0 升到 1 */
export function runWeight(speed: number, rc: RunGaitConfig = RUN_GAIT): number {
  return smooth((speed - rc.runFrom) / Math.max(1e-6, rc.runFull - rc.runFrom));
}

export function gaitParams(speed: number, c: WalkGaitConfig = WALK_GAIT, rc: RunGaitConfig = RUN_GAIT): GaitParams {
  const v = Math.max(0, speed);
  const cycle = Math.min(c.cycleMax, Math.max(c.cycleMin, c.cycleBase + c.cycleK * v));
  const [v0, v1] = c.dutySpeed;
  const duty = lerp(c.dutySlow, c.dutyFast, clamp01((v - v0) / Math.max(1e-6, v1 - v0)));
  const lift = c.liftBase + c.liftK * v;
  const r = runWeight(v, rc);
  if (r <= 0) return { cycle, duty, lift, run: 0, peak: 0.5, heelLift: c.heelLift, toeUp: c.toeUp, center: 0, snap: rc.swingSnap };
  return {
    cycle: lerp(cycle, Math.max(rc.cycleMin, rc.cycleK * v), r),
    duty: lerp(duty, rc.duty, r),
    lift: lerp(lift, rc.lift, r),
    run: r,
    peak: lerp(0.5, rc.liftPeak, r),
    heelLift: lerp(c.heelLift, rc.heelLift, r),
    toeUp: lerp(c.toeUp, rc.toeUp, r),
    center: 0,
    snap: rc.swingSnap,
  };
}

/** 一只脚此刻的状态 */
export interface FootState extends FootTarget {
  /** 是否着地（支撑相） */
  stance: boolean;
  /** 着地点（支撑相里在地面上不动的那一点：脚掌放平时是踝的正下方，推离时是脚尖）相对身体的前后位置；摆动相为 NaN */
  contactZ: number;
  /** 着地点是哪一点（推离开始时由踝换到脚尖） */
  contact: 'ankle' | 'toe' | 'none';
}

/**
 * 在步态相位 u（0~1，0 = 落地）求一只脚的目标。纯函数：p 为步态参数，a0 为站立时踝关节离地高度。
 */
export function footAt(u: number, p: GaitParams, a0: number, c: WalkGaitConfig = WALK_GAIT): FootState {
  const { cycle: C, duty: b } = p;
  const half = (b * C) / 2;
  const ctr = p.center;
  if (u < b) {
    // 支撑相：踝关节（或推离时的脚尖）相对身体匀速后退
    const base = half - u * C + ctr;
    const toe = p.toeUp * (1 - smooth(u / Math.max(1e-6, b * c.toeUpSpan)));
    const heel = p.heelLift * smooth((u - b * (1 - c.heelLiftSpan)) / Math.max(1e-6, b * c.heelLiftSpan));
    // 推离：绕脚尖转，脚尖不动，踝关节抬高、略微前移；落地：绕脚跟放平，踝关节略抬高
    const z = base + c.toeLength * (1 - Math.cos(heel));
    const y = a0 + c.toeLength * Math.sin(heel) + HEEL_LENGTH * Math.sin(toe);
    return { x: 0, z, y, pitch: toe - heel, stance: true, contactZ: heel > 0 ? base + c.toeLength : base, contact: heel > 0 ? 'toe' : 'ankle' };
  }
  // 摆动相：埃尔米特曲线，两端切线 = 支撑相里脚相对身体的速度（落地、离地瞬间相对地面静止）
  const s = (u - b) / Math.max(1e-6, 1 - b);
  const heelEnd = p.heelLift;
  const z0 = -half + c.toeLength * (1 - Math.cos(heelEnd)) + ctr;
  const z1 = half + ctr;
  const m = -(1 - b) * C; // dz/ds
  const s2 = s * s;
  const s3 = s2 * s;
  let z = (2 * s3 - 3 * s2 + 1) * z0 + (s3 - 2 * s2 + s) * m + (-2 * s3 + 3 * s2) * z1 + (s3 - s2) * m;
  if (p.run > 0) {
    // 跑步：支撑相很短，同样的端点速度放进埃尔米特曲线会前后各过冲近 20 厘米（腿在落地前伸直踢出去）。
    // 改为“平滑主曲线 + 两端快速衰减的速度匹配项”：离地、落地的瞬间脚相对地面仍然静止（不滑），
    // 但只在两端很短的一段里继续后退 / 回扒，过冲只有 |m|·snap/e（约 7 厘米）
    const tau = Math.max(1e-3, p.snap);
    const e0 = s * Math.exp(-s / tau);
    const e1 = (1 - s) * Math.exp(-(1 - s) / tau);
    const zr = z0 + (z1 - z0) * smooth(s) + m * e0 - m * e1;
    z = lerp(z, zr, p.run);
  }
  const y0 = a0 + c.toeLength * Math.sin(heelEnd);
  const y1 = a0 + HEEL_LENGTH * Math.sin(p.toeUp);
  // 抬脚的拱形：走路是对称的正弦拱（最高点在中间）；跑步的最高点提前（离地后先把脚跟往臀下收，再提膝前送）
  const k = p.peak === 0.5 ? 1 : Math.log(0.5) / Math.log(Math.min(0.95, Math.max(0.05, p.peak)));
  const y = lerp(y0, y1, smooth(s)) + p.lift * Math.sin(Math.PI * (k === 1 ? s : Math.pow(s, k)));
  // 脚掌：离地后先放平，落地前翘起脚尖
  const pitch = s < 0.4 ? lerp(-heelEnd, 0, smooth(s / 0.4)) : lerp(0, p.toeUp, smooth((s - 0.6) / 0.4));
  return { x: 0, z, y, pitch, stance: false, contactZ: Number.NaN, contact: 'none' };
}

/**
 * 某只脚对身体高度的要求：身体至少下沉多少，这只脚才够得着（髋到踝 ≤ 腿长 × reach）。
 * hipZ / hipY：前倾后髋关节相对根节点的位置。
 */
export function dropNeeded(d: LegDims, foot: FootTarget, hipZ: number, hipY: number, reach: number): number {
  const R = (d.thigh + d.shin) * reach;
  const dz = foot.z - hipZ;
  const span = Math.sqrt(Math.max(0, R * R - dz * dz));
  return hipY - foot.y - span;
}

/** 一只脚“算不算数”（身体高度要不要照顾它）：着地时 1；离地后很快降到 0，快落地时再升回 1，保证连续 */
function footWeight(u: number, duty: number): number {
  if (u < duty) return 1;
  const s = (u - duty) / Math.max(1e-6, 1 - duty);
  return 1 - smooth(s / 0.25) + smooth((s - 0.75) / 0.25);
}

/**
 * 步态的输出。身体和手臂的偏移已乘行走权重；脚的目标是“满权重”的步态本身（连同 dropFull、leanFull），
 * 腿的转角由调用方按满权重求 IK，再与站姿按权重混合——起步、停步时膝盖不会在“伸直”附近突然弹直。
 */
export interface WalkOutput {
  /** 左 / 右踝关节目标（地面坐标，相对根节点；满权重） */
  left: FootState;
  right: FootState;
  /** 身体下沉（模型坐标，米，正数 = 往下）：drop 已乘权重，dropFull 是满权重时的值 */
  drop: number;
  dropFull: number;
  /** 前倾（弧度）：lean 已乘权重，leanFull 是满权重时的值 */
  lean: number;
  leanFull: number;
  /** 侧倾（弧度）、左右重心位移（米，向左手侧为正） */
  roll: number;
  shift: number;
  /** 腰的扭转（spine.y） */
  twist: number;
  /** 双臂摆角（肩 rotation.x，负 = 向前）与肘的附加弯曲 */
  shoulderL: number;
  shoulderR: number;
  elbowL: number;
  elbowR: number;
  /** 左 / 右脚相对站姿的前后位移（模型坐标，米）：袍摆跟着迈步用 */
  strideL: number;
  strideR: number;
}

export interface WalkHands {
  /** 左手 / 右手持武器：这只手臂摆得小 */
  heldLeft: boolean;
  heldRight: boolean;
}

/**
 * 一个单位的行走状态。每帧调用 advance(走过的距离, dt)，再调用 sample() 取输出。
 */
export class WalkGait {
  /** 步态相位（周期数，只增不减；左脚在 frac(phase) = 0 时落地，右脚晚半个周期） */
  phase = 0;
  /** 行走权重 0~1：走动时升到 1，停下后平滑降到 0（回到待机） */
  weight = 0;
  /** 平滑后的速度（米/秒，模型坐标） */
  speed = 0;
  readonly out: WalkOutput;
  private params: GaitParams;
  /** 累计走过的距离（模型坐标，米） */
  private traveled = 0;
  /**
   * 每只脚的“落地点”（步骤 14）：脚落地时记下它在累计距离上的位置，整个支撑相里脚相对身体的位置 = 落地点 − 已走距离，
   * 所以加速、减速（步幅随速度变化）时着地的脚也不会滑；离地时记下与解析轨迹的偏差，在摆动前半段平滑消掉。
   */
  private readonly feet = {
    left: { anchor: 0, stance: false, carry: 0 },
    right: { anchor: 0, stance: false, carry: 0 },
  };

  constructor(
    readonly dims: LegDims,
    private readonly hands: WalkHands = { heldLeft: false, heldRight: false },
    private readonly c: WalkGaitConfig = WALK_GAIT,
    private readonly rc: RunGaitConfig = RUN_GAIT,
  ) {
    this.params = gaitParams(0, c, rc);
    const rest = restFoot(dims);
    this.out = {
      left: { ...rest, stance: true, contactZ: 0, contact: 'ankle' },
      right: { ...rest, stance: true, contactZ: 0, contact: 'ankle' },
      drop: 0,
      dropFull: 0,
      lean: 0,
      leanFull: 0,
      roll: 0,
      shift: 0,
      twist: 0,
      shoulderL: 0,
      shoulderR: 0,
      elbowL: 0,
      elbowR: 0,
      strideL: 0,
      strideR: 0,
    };
  }

  /** 是否在走（或还没完全停下） */
  get active(): boolean {
    return this.weight > 0;
  }

  /** 跑步程度 0~1（已乘行走权重）：披风、袍摆甩动的放大用 */
  get run(): number {
    return this.params.run * this.weight;
  }

  /**
   * 推进：distance = 这一帧身体在地面上移动的距离（模型坐标，米），dt = 这一帧的时长（秒）。
   * 相位按距离推进，所以支撑脚相对地面不动。
   */
  advance(distance: number, dt: number): void {
    const c = this.c;
    if (dt <= 0) return;
    const v = distance / dt;
    // 从站着开始走：落地点重新记录（第一帧着地的脚按解析轨迹的位置“落地”）
    if (this.weight === 0) {
      this.feet.left.stance = this.feet.right.stance = false;
      this.feet.left.carry = this.feet.right.carry = 0;
    }
    // 速度平滑一下（掉帧时不跳）；停下时步态参数保持最后的值（否则步幅突变，腿会跳一下）
    if (distance > 1e-7) {
      this.speed += (v - this.speed) * (1 - Math.exp(-20 * dt));
      this.params = gaitParams(this.speed, c, this.rc);
      this.phase += distance / this.params.cycle;
      this.traveled += distance;
    }
    const target = v > c.stopSpeed ? 1 : 0;
    const rate = target > this.weight ? c.blendIn : c.blendOut;
    this.weight += (target - this.weight) * (1 - Math.exp(-rate * dt));
    // 剩下千分之几时直接归零（看不出差别），停下后输出精确回到站姿
    if (this.weight < 2e-3 && target === 0) this.weight = 0;
  }

  /** 立即停下并回到站姿（复位用） */
  reset(): void {
    this.phase = 0;
    this.weight = 0;
    this.speed = 0;
    this.traveled = 0;
    this.params = gaitParams(0, this.c, this.rc);
    this.sample();
  }

  /** 按当前相位和权重计算输出（写进 this.out 并返回） */
  sample(): WalkOutput {
    const c = this.c;
    const d = this.dims;
    const o = this.out;
    const w = this.weight;
    const p = this.params;
    const rc = this.rc;
    const run = p.run;
    const a0 = ankleHeight(d);
    const uL = frac(this.phase);
    const uR = frac(this.phase + 0.5);

    // 前倾：随速度加大，跑起来更多（满权重的值；身体实际前倾再乘权重）
    const leanFull = lerp(c.lean * Math.min(1, this.speed / 3.2), rc.lean, run);
    const hipZ = d.hipHeight * Math.sin(leanFull);
    const hipY = d.hipHeight * Math.cos(leanFull);
    // 跑步：着地范围以髋的投影为中心（走路时为 0）
    p.center = run * rc.center * hipZ;
    const fL = this.anchored(footAt(uL, p, a0, c), uL, this.feet.left);
    const fR = this.anchored(footAt(uR, p, a0, c), uR, this.feet.right);
    o.left = fL;
    o.right = fR;

    // 身体下沉：着地的脚必须够得着（髋到踝不超过腿长 × reach，膝盖始终微屈）；
    // 离地的脚权重连续变化，下沉量没有跳变
    const need = (f: FootTarget): number => Math.max(0, dropNeeded(d, f, hipZ, hipY, c.reach));
    let dropFull = Math.max(footWeight(uL, p.duty) * need(fL), footWeight(uR, p.duty) * need(fR));
    if (run > 0) {
      // 跑步的起伏：每次落地后的支撑中段压到最低（屈膝缓冲），两脚都离地的腾空中段最高
      const v = frac(2 * this.phase);
      const curve = rc.sink + rc.bob * Math.cos(TAU * (v - p.duty));
      dropFull = Math.max(dropFull, run * curve);
      // 腾空（两脚都离地）时身体再往上抛一点，比站立时还高：此时没有脚着地，抬高身体不会让哪只脚够不着地面
      const air = (v - 2 * p.duty) / Math.max(1e-6, 1 - 2 * p.duty);
      if (air > 0 && air < 1) dropFull -= run * rc.flightLift * Math.sin(Math.PI * air);
    }
    o.dropFull = dropFull;
    o.drop = o.dropFull * w;
    o.leanFull = leanFull;

    // 腿的前后摆角（近似），手臂与对侧腿同步（乘权重）
    const legLen = d.thigh + d.shin;
    const swing = (z: number): number => Math.asin(Math.max(-1, Math.min(1, (z * w) / legLen)));
    const aL = swing(fL.z);
    const aR = swing(fR.z);
    const held = lerp(c.heldArmScale, rc.heldArmScale, run);
    const armL = this.hands.heldLeft ? held : 1;
    const armR = this.hands.heldRight ? held : 1;
    const armSwing = lerp(c.armSwing, rc.armSwing, run);
    const elbowFollow = lerp(c.elbowFollow, rc.elbowFollow, run);
    // 跑步：肘固定屈起（持武器的手屈得少，武器压低）
    const bendL = rc.elbowBend * run * w * (this.hands.heldLeft ? rc.heldElbowScale : 1);
    const bendR = rc.elbowBend * run * w * (this.hands.heldRight ? rc.heldElbowScale : 1);
    // 右脚在前（aR > 0）时左臂向前（肩转负角）
    o.shoulderL = -armSwing * aR * armL;
    o.shoulderR = -armSwing * aL * armR;
    o.elbowL = -elbowFollow * Math.max(0, aR) * armL - bendL;
    o.elbowR = -elbowFollow * Math.max(0, aL) * armR - bendR;
    // 腰：左脚在前时右肩向前（腰向左扭，spine.y 为正）
    const maxSwing = Math.max(0.2, Math.asin(Math.min(1, (p.duty * p.cycle) / 2 / legLen)));
    o.twist = lerp(c.twist, rc.twist, run) * Math.max(-1, Math.min(1, (aL - aR) / (2 * maxSwing)));
    // 重心：左脚支撑相的中点重心最靠左（+x），右脚的中点最靠右
    const side = Math.cos(TAU * (this.phase - p.duty / 2));
    const shift = lerp(c.shift, rc.shift, run);
    o.shift = shift * side * w;
    o.roll = -lerp(c.roll, rc.roll, run) * side * w;
    // 身体往左移了 shift，脚就相对身体往右放 shift：着地的脚在地面上不横向滑动（满权重的值）
    fL.x = fR.x = -shift * side;
    o.lean = leanFull * w;
    o.strideL = fL.z * w;
    o.strideR = fR.z * w;
    return o;
  }

  /**
   * 支撑相按落地点锚定：脚相对身体的前后位置 = 落地点 − 已走距离（与速度无关，着地的脚绝不打滑）；
   * 摆动相从离地时的实际位置出发，偏差在摆动的前 60% 平滑消掉（落地前回到解析轨迹）。
   */
  private anchored(f: FootState, u: number, s: { anchor: number; stance: boolean; carry: number }): FootState {
    const p = this.params;
    if (f.stance) {
      const analytic = (p.duty * p.cycle) / 2 - u * p.cycle + p.center; // 解析轨迹里这一刻的着地位置（踝的正下方）
      if (!s.stance) s.anchor = this.traveled + analytic; // 刚落地：记下落地点
      s.stance = true;
      const delta = s.anchor - this.traveled - analytic;
      s.carry = delta;
      if (delta !== 0) {
        f.z += delta;
        f.contactZ += delta;
      }
      return f;
    }
    s.stance = false;
    const t = (u - p.duty) / Math.max(1e-6, 1 - p.duty);
    const fade = s.carry * (1 - smooth(t / 0.6));
    if (fade !== 0) f.z += fade;
    return f;
  }
}

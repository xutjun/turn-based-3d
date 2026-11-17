// 进攻动作的计算（步骤 11）：一个单位出手时的“动作状态”——站在哪、朝哪、摆什么姿态、处于哪个阶段。
// 不依赖 three.js 和 DOM，可以直接做单元测试；UnitView 每帧把这里的状态搬到模型上。
//
// 三层内容：
//   1. 动作姿态（pose）：相对站姿的偏移量，按 data/attackAnimConfig.ts 里各动作的关键姿态做补间；
//      预备 → 发力 → 命中顿住 → 余势 → 收招，每个阶段由编排者（Choreographer）调用一次。
//   2. 步态（gait）：离开 / 回到站位时的位移曲线（起步加速、到位刹车）、前倾、起伏、重心摆动、
//      腾空、弧线、旋身，以及落脚事件（由 UnitView 接成尘土、火星和镜头轻震）。
//   3. 次级运动（push）：拖在身后的弹簧质点，披风、袍摆、链条、尾巴按它的偏移量被“甩”出去再回落。
//
// 所有时间都走 Scheduler：倍速、顿帧、跳过动画自动生效；跳过动画时每个补间直接落到终点，
// 所以一次出手演完后必然回到“原位、原朝向、站姿”。

import {
  ATTACK_ANIM,
  GAITS,
  jumpSplit,
  MOTION_PROFILES,
  SECONDARY_MOTION,
  moveOf,
  type BodyPose,
  type EaseName,
  type GaitDef,
  type GaitId,
  type MotionId,
  type MoveDef,
  type PoseKey,
} from '../../data/attackAnimConfig';
import { STAGING } from '../../data/presentationConfig';
import { EASE, type Ease, type Scheduler } from '../director/Scheduler';
import type { AttackStyle, GroundPoint, MoveOptions } from '../director/types';
import { chargeYaw, turnToward } from './turning';

const TAU = Math.PI * 2;
const TURN = 'root.turn';
const REST: readonly PoseKey[] = [{ pose: {} }];

/**
 * 出手者当前处于哪个阶段（联系表和测试用它标注关键帧）。
 * 近战的来回（步骤 11b）：crouch 下蹲蓄力 → approach / return 腾空 → land 落地缓冲。
 */
export type MotionPhase =
  | 'idle'
  | 'brace'
  | 'crouch'
  | 'approach'
  | 'land'
  | 'anticipation'
  | 'strike'
  | 'hold'
  | 'follow'
  | 'recover'
  | 'return';

/** 落脚事件：起步蹬地 / 途中每一步 / 到位（刹车或落地） */
export interface Footfall {
  kind: 'start' | 'step' | 'end';
  x: number;
  z: number;
  /** 行进方向（单位向量） */
  dirX: number;
  dirZ: number;
  dust: number; // 尘土量
  sparks: boolean;
  shake: number; // 镜头轻震（米）
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number): number => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};

/**
 * 冲刺的位移曲线：前 accel 比例的时间匀加速，中间匀速，最后 brake 比例的时间匀减速到 0（刹车）。
 * 返回 0~1 的路程进度；单调不减，两端分别为 0 和 1。
 */
export function dashProgress(t: number, accel: number, brake: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const a = Math.max(1e-4, accel);
  const b = Math.max(1e-4, brake);
  const vmax = 1 / (1 - a / 2 - b / 2);
  if (t < a) return (vmax * t * t) / (2 * a);
  if (t <= 1 - b) return vmax * (t - a / 2);
  const r = 1 - t;
  return 1 - (vmax * r * r) / (2 * b);
}

/** 冲刺途中的速度（0~1，1 = 全速）：起步从 0 加速，到位时减到 0 */
export function dashSpeed(t: number, accel: number, brake: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < accel) return t / Math.max(1e-4, accel);
  if (t <= 1 - brake) return 1;
  return (1 - t) / Math.max(1e-4, brake);
}

/** 把角度折回 (−π, π] */
export function wrapAngle(a: number): number {
  const r = a - TAU * Math.round(a / TAU);
  return r <= -Math.PI ? r + TAU : r;
}

interface Segment {
  pose: BodyPose;
  end: number; // 这一段结束时的阶段进度（0~1）
  ease: Ease;
}

/** 把一串关键姿态按 span 比例排成首尾相接的若干段 */
function segmentsOf(keys: readonly PoseKey[], fallback: EaseName): Segment[] {
  const total = keys.reduce((sum, k) => sum + (k.span ?? 1), 0) || 1;
  let acc = 0;
  return keys.map((k) => {
    acc += k.span ?? 1;
    return { pose: k.pose, end: acc / total, ease: EASE[k.ease ?? fallback] };
  });
}

/**
 * 在阶段进度 t 处求姿态：从 from 出发，依次经过各段的姿态。结果写进 out（只写 channels 里列出的通道）。
 */
export function samplePose(
  out: Record<string, number>,
  channels: readonly string[],
  from: BodyPose,
  segments: readonly Segment[],
  t: number,
): void {
  let start = 0;
  let prev = from;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (t <= seg.end || i === segments.length - 1) {
      const u = seg.end > start ? clamp01((t - start) / (seg.end - start)) : 1;
      const k = t >= 1 && i === segments.length - 1 ? 1 : seg.ease(u);
      for (const c of channels) {
        const a = prev[c] ?? 0;
        out[c] = a + ((seg.pose[c] ?? 0) - a) * k;
      }
      return;
    }
    start = seg.end;
    prev = seg.pose;
  }
}

function channelsOf(from: BodyPose, segments: readonly { pose: BodyPose }[]): string[] {
  const set = new Set(Object.keys(from));
  for (const s of segments) for (const c of Object.keys(s.pose)) set.add(c);
  return [...set];
}

export class UnitMotion {
  /** 当前所在的地面位置（只有近战冲锋途中不等于站位） */
  readonly ground: GroundPoint;
  /** 当前朝向（弧度）；只有离开站位期间不等于原始朝向 */
  yaw: number;
  /** 是否离开了站位 */
  away = false;
  phase: MotionPhase = 'idle';
  /** 当前（或最近一次）的出手动作，联系表标注用 */
  move: MoveDef | null = null;
  /** 动作姿态：相对站姿的偏移量；全为空 = 站姿 */
  readonly pose: Record<string, number> = {};
  /** 步态层：冲刺 / 扑跃途中整体的前倾、侧倾、离地、旋身；squash = 跳劈落地时身体被压下去（步骤 11c，和姿态层叠加） */
  readonly gait = { pitch: 0, roll: 0, hop: 0, spin: 0, squash: 0 };
  /** 步态层：随步伐摆动的关节（魔偶的双腿） */
  readonly gaitJoints: Record<string, number> = {};
  /** 命中顿住时的震颤幅度（0 = 没有） */
  shudder = 0;
  /** 次级运动：弹簧质点相对身体的偏移（世界坐标，米） */
  readonly push = { x: 0, y: 0, z: 0 };
  /** 次级运动：布料飘动幅度的增量（米） */
  flutter = 0;

  private poseToken = 0;
  private readonly spring = { ready: false, qx: 0, qy: 0, qz: 0, vx: 0, vy: 0, vz: 0, px: 0, py: 0, pz: 0 };

  constructor(
    private readonly scheduler: Scheduler,
    readonly home: GroundPoint,
    private readonly baseYaw: number,
    readonly motion: MotionId,
    /** 落脚事件（尘土、火星、镜头轻震）；跳过动画时不触发 */
    private readonly onFootfall: (f: Footfall) => void = () => undefined,
  ) {
    this.ground = { ...home };
    this.yaw = baseYaw;
  }

  /** 是否正在出手（待机动画据此让位） */
  get busy(): boolean {
    return this.phase !== 'idle' || this.away;
  }

  /** 姿态是否已回到站姿 */
  get atRest(): boolean {
    for (const v of Object.values(this.pose)) if (Math.abs(v) > 1e-6) return false;
    const g = this.gait;
    return g.pitch === 0 && g.roll === 0 && g.hop === 0 && g.spin === 0 && g.squash === 0 && this.shudder === 0;
  }

  // ------------------------------------------------------------------
  // 姿态
  // ------------------------------------------------------------------

  /**
   * 在 duration 秒内依次摆出 keys 里的姿态。新的调用会取代还没播完的旧调用。
   * 开始时把“转身”通道折回 (−π, π]：上一个阶段转过的整圈不需要再倒转回来。
   */
  private playKeys(keys: readonly PoseKey[], duration: number, fallback: EaseName): Promise<void> {
    const token = (this.poseToken += 1);
    if (this.pose[TURN] !== undefined) this.pose[TURN] = wrapAngle(this.pose[TURN]);
    const from = { ...this.pose };
    const segments = segmentsOf(keys, fallback);
    const channels = channelsOf(from, segments);
    return this.scheduler.tween(duration, (t) => {
      if (token !== this.poseToken) return; // 已被更新的姿态取代
      samplePose(this.pose, channels, from, segments, t);
    });
  }

  /** 出发前的蓄势（狼压低身体、魔偶举臂）；没有蓄势姿态的单位立即完成 */
  brace(duration: number): Promise<void> {
    const brace = MOTION_PROFILES[this.motion].brace;
    if (!brace) return Promise.resolve();
    this.phase = 'brace';
    return this.playKeys([{ pose: brace.pose }], duration, brace.ease ?? 'outCubic');
  }

  /** 预备（蓄力） */
  windup(style: AttackStyle, duration: number, variant = 0): Promise<void> {
    this.move = moveOf(this.motion, style, variant);
    this.phase = 'anticipation';
    return this.playKeys(this.move.ready, duration, 'outCubic');
  }

  /** 发力：到这一步结束的瞬间就是命中 */
  release(style: AttackStyle, duration: number, variant = 0): Promise<void> {
    this.move = moveOf(this.motion, style, variant);
    this.phase = 'strike';
    return this.playKeys(this.move.strike, duration, 'inCubic');
  }

  /** 命中顿住：姿态停在命中的一瞬，只有一点点震颤 */
  hold(duration: number): Promise<void> {
    this.phase = 'hold';
    return this.scheduler.tween(duration, (t) => {
      this.shudder = t >= 1 ? 0 : ATTACK_ANIM.holdShudder * (1 - t);
    });
  }

  /** 余势：过冲、回弹 */
  follow(duration: number): Promise<void> {
    this.phase = 'follow';
    return this.playKeys(this.move?.follow ?? REST, duration, 'outCubic');
  }

  /** 收招：经过收刀 / 回撤的姿态，回到站姿 */
  async recover(duration: number): Promise<void> {
    this.phase = 'recover';
    const via = this.move?.recover ?? [];
    const viaSpan = via.reduce((sum, k) => sum + (k.span ?? 1), 0);
    // 收招途中的姿态各占自己的 span，剩下的时间回到站姿
    const keys: PoseKey[] = [...via, { pose: {}, span: Math.max(0.2, 1 - viaSpan), ease: 'inOut' }];
    const token = this.poseToken + 1;
    await this.playKeys(keys, duration, 'inOut');
    if (token !== this.poseToken) return; // 收招途中又开始了新的动作
    this.clearPose();
    if (!this.away) this.phase = 'idle';
  }

  private clearPose(): void {
    for (const c of Object.keys(this.pose)) delete this.pose[c];
  }

  // ------------------------------------------------------------------
  // 位移
  // ------------------------------------------------------------------

  /**
   * 离开站位移动到某点；到位时正对 face。
   * 带下蹲 / 落地缓冲的步态（大跳跃）：duration 是总时长，先下蹲蓄力、再腾空、落地后缓冲回到站姿。
   * 跳劈（options.land = false）：没有单独的落地缓冲，腾空占满剩下的时间；落地的一瞬间身体被压下去再弹回（gait.squash），
   * 和同时进行的挥击叠加——落地缓冲和发力是同一个动作。
   */
  async moveTo(point: GroundPoint, duration: number, face?: GroundPoint, options: MoveOptions = {}): Promise<void> {
    this.away = true;
    const gaitId = options.gait ?? MOTION_PROFILES[this.motion].approach.gait;
    const { air, land } = await this.takeOff(gaitId, duration, options, options.land !== false);
    this.phase = 'approach';
    const dx = point.x - this.ground.x;
    const dz = point.z - this.ground.z;
    const fromYaw = this.yaw;
    // 几乎没有位移时不转向跑动方向（避免方向抖动）
    const travel = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : fromYaw;
    const faceYaw = face ? Math.atan2(face.x - point.x, face.z - point.z) : travel;
    await this.travel(point, air, gaitId, options.side ?? 1, (t) => chargeYaw(t, fromYaw, travel, faceYaw, STAGING.chargeTurn));
    if (options.land === false) {
      this.landImpact();
      return;
    }
    await this.landing(gaitId, land, false);
  }

  private impactToken = 0;

  /** 跳劈落地：身体被压下去再弹回（不占用编排时间，和挥击、顿住同时进行） */
  private landImpact(): void {
    const J = ATTACK_ANIM.jumpStrike;
    const token = (this.impactToken += 1);
    void this.scheduler.tween(J.landSquashTime, (t) => {
      if (token === this.impactToken) this.gait.squash = J.landSquash * (1 - t) * (1 - t);
    });
  }

  /**
   * 回到站位：面朝对手向后跳回（大跳跃：下蹲 → 腾空 → 落地缓冲），途中平滑转回原来的朝向；
   * 落定后位置、朝向、姿态全部按基准写回（不靠反向抵消）。
   */
  async returnHome(duration: number, options: MoveOptions = {}): Promise<void> {
    const gaitId = options.gait ?? MOTION_PROFILES[this.motion].retreat.gait;
    // 回程的下蹲直接从当前姿态（上一击的余势）开始：收招和下蹲合成一个动作
    const { air, land } = await this.takeOff(gaitId, duration, options, true);
    this.phase = 'return';
    const fromYaw = this.yaw;
    await this.travel(this.home, air, gaitId, options.side ?? 1, (t) => turnToward(fromYaw, this.baseYaw, t));
    this.yaw = this.baseYaw;
    this.ground.x = this.home.x;
    this.ground.z = this.home.z;
    await this.landing(gaitId, land, true);
    // 以基准为准：落定后原位、原朝向、站姿
    this.yaw = this.baseYaw;
    this.ground.x = this.home.x;
    this.ground.z = this.home.z;
    this.poseToken += 1;
    this.clearPose();
    this.impactToken += 1;
    this.gait.squash = 0;
    this.away = false;
    this.phase = 'idle';
  }

  /**
   * 起跳前的下蹲蓄力（步态有 crouch 时）；返回腾空和落地缓冲各占的时间（三段加起来 = duration）。
   * 离地的一瞬间调用 options.onAirborne。
   */
  private async takeOff(gaitId: GaitId, duration: number, options: MoveOptions, withLand: boolean): Promise<{ air: number; land: number }> {
    const g = GAITS[gaitId];
    const { crouch, air, land } = jumpSplit(gaitId, duration, withLand);
    if (g.crouch && crouch > 0) {
      this.phase = 'crouch';
      await this.playKeys([{ pose: g.crouch.pose }], crouch, g.crouch.ease ?? 'outCubic');
    }
    options.onAirborne?.();
    return { air, land };
  }

  /** 落地缓冲（步态有 land 时）：先压到落地姿态，再平滑回到站姿；home = 跳回原位（结束后清空姿态） */
  private async landing(gaitId: GaitId, duration: number, home: boolean): Promise<void> {
    const g = GAITS[gaitId];
    if (!g.land || duration <= 0) {
      if (home && Object.keys(this.pose).length > 0) await this.playKeys(REST, 0.15, 'inOut');
      return;
    }
    this.phase = 'land';
    const token = this.poseToken + 1;
    await this.playKeys(
      [
        { pose: g.land.pose, span: 0.35, ease: 'out' },
        { pose: {}, span: 0.65, ease: 'inOut' },
      ],
      duration,
      'inOut',
    );
    if (token === this.poseToken) this.clearPose();
  }

  private travel(to: GroundPoint, duration: number, gaitId: GaitId, side: number, yawAt: (t: number) => number): Promise<void> {
    const g: GaitDef = GAITS[gaitId];
    const from = { ...this.ground };
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dz);
    const dirX = dist > 1e-4 ? dx / dist : Math.sin(this.yaw);
    const dirZ = dist > 1e-4 ? dz / dist : Math.cos(this.yaw);
    const steps = Math.max(1, Math.round(dist / g.stride));
    const airborne = g.hop > 0;
    let lastStep = 0;
    let ended = false;
    const emit = (kind: Footfall['kind'], dust: number, shake: number): void => {
      if (this.scheduler.skip || (dust <= 0 && shake <= 0)) return;
      this.onFootfall({ kind, x: this.ground.x, z: this.ground.z, dirX, dirZ, dust, sparks: g.sparks, shake });
    };

    // 途中的姿态关键帧（扑跃的蹬地、腾空、落地）
    let poseStep: ((t: number) => void) | null = null;
    if (g.poses && g.poses.length > 0) {
      const token = (this.poseToken += 1);
      const poseFrom = { ...this.pose };
      const segments: Segment[] = g.poses.map((k) => ({ pose: k.pose, end: k.at, ease: EASE[k.ease ?? 'inOut'] }));
      const channels = channelsOf(poseFrom, segments);
      poseStep = (t) => {
        if (token === this.poseToken) samplePose(this.pose, channels, poseFrom, segments, t);
      };
    }

    const [w0, w1] = g.spinWindow;
    let first = true;
    return this.scheduler.tween(duration, (t) => {
      const s = dashProgress(t, g.accel, g.brake);
      const v = dashSpeed(t, g.accel, g.brake);
      const lateral = g.arc * dist * Math.sin(Math.PI * s) * side;
      this.ground.x = from.x + dx * s - dirZ * lateral;
      this.ground.z = from.z + dz * s + dirX * lateral;
      this.yaw = yawAt(t);
      if (first) {
        first = false;
        emit('start', g.dust.start, 0);
      }
      poseStep?.(t);
      if (t >= 1) {
        // 到位：位置精确落在终点，步态层清零
        this.ground.x = to.x;
        this.ground.z = to.z;
        this.gait.pitch = this.gait.roll = this.gait.hop = this.gait.spin = 0;
        for (const c of Object.keys(this.gaitJoints)) delete this.gaitJoints[c];
        if (!ended) {
          ended = true;
          emit('end', g.dust.end, airborne ? g.shake : 0);
        }
        return;
      }
      // 朝向与行进方向的关系：面朝行进方向时前倾，面朝对手后撤时变成后仰
      const along = Math.sin(this.yaw) * dirX + Math.cos(this.yaw) * dirZ;
      const across = Math.cos(this.yaw) * dirX - Math.sin(this.yaw) * dirZ;
      const braking = t > 1 - g.brake ? (t - (1 - g.brake)) / Math.max(1e-4, g.brake) : 0;
      const lean = g.lean * v - g.brakeLean * Math.sin(Math.PI * braking);
      const stepPhase = steps * s;
      const wave = Math.sin(Math.PI * stepPhase);
      const drive = Math.sqrt(v);
      this.gait.pitch = lean * along;
      this.gait.roll = -lean * across * 0.6 + g.sway * wave * drive;
      this.gait.hop = g.hop * 4 * t * (1 - t) + g.bob * Math.abs(wave) * drive;
      this.gait.spin = g.spin !== 0 ? TAU * g.spin * smooth((s - w0) / Math.max(1e-4, w1 - w0)) : 0;
      if (g.legs) {
        this.gaitJoints[`${g.legs.joints[0]}.x`] = g.legs.swing * wave * drive;
        this.gaitJoints[`${g.legs.joints[1]}.x`] = -g.legs.swing * wave * drive;
      }
      // 落脚：每走完一步触发一次；贴地的步态在开始刹车时扬起一蓬尘土
      const k = Math.floor(stepPhase + 1e-6);
      if (k > lastStep && k < steps) emit('step', g.dust.step, g.shake);
      lastStep = Math.max(lastStep, k);
      if (!airborne && !ended && braking > 0) {
        ended = true;
        emit('end', g.dust.end, g.shake);
      }
    });
  }

  // ------------------------------------------------------------------
  // 次级运动
  // ------------------------------------------------------------------

  /**
   * 推进弹簧质点。
   * @param dt 演出时间间隔（秒，已乘倍速）
   * @param ax 身体后方挂点的世界坐标（披风大致所在的位置）
   * @param enabled 关闭（低画质）或跳过动画时质点直接贴回挂点，没有任何残留的甩动
   */
  updateSecondary(dt: number, ax: number, ay: number, az: number, enabled: boolean, active = this.busy): void {
    const c = SECONDARY_MOTION;
    const s = this.spring;
    // 收尾（步骤 11b）：身体停下后，甩动在 settle 秒内平滑衰减到 0 并清空弹簧，
    // 保证每次演出结束时披风、尾巴精确回到基准姿态，不留余摆
    if (active) this.settleTime = 0;
    else if (dt > 0) this.settleTime += dt;
    const settled = !active && this.settleTime >= c.settle;
    if (!enabled || !s.ready || dt <= 0 || this.scheduler.skip || settled) {
      s.ready = enabled;
      s.qx = s.px = ax;
      s.qy = s.py = ay;
      s.qz = s.pz = az;
      s.vx = s.vy = s.vz = 0;
      this.push.x = this.push.y = this.push.z = 0;
      this.flutter = 0;
      return;
    }
    // 小步长积分，倍速或掉帧时也稳定
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / n;
      const tx = s.px + (ax - s.px) * u;
      const ty = s.py + (ay - s.py) * u;
      const tz = s.pz + (az - s.pz) * u;
      s.vx += (c.stiffness * (tx - s.qx) - c.damping * s.vx) * h;
      s.vy += (c.stiffness * (ty - s.qy) - c.damping * s.vy) * h;
      s.vz += (c.stiffness * (tz - s.qz) - c.damping * s.vz) * h;
      s.qx += s.vx * h;
      s.qy += s.vy * h;
      s.qz += s.vz * h;
    }
    const bodySpeed = Math.hypot(ax - s.px, ay - s.py, az - s.pz) / dt;
    s.px = ax;
    s.py = ay;
    s.pz = az;
    let ox = s.qx - ax;
    let oy = (s.qy - ay) * c.liftFactor;
    let oz = s.qz - az;
    const len = Math.hypot(ox, oy, oz);
    if (len > c.maxOffset) {
      // 超出上限：把质点拉回到上限处，避免攒下很大的偏移之后猛地弹回
      const k = c.maxOffset / len;
      ox *= k;
      oy *= k;
      oz *= k;
      s.qx = ax + ox;
      s.qy = ay + oy / c.liftFactor;
      s.qz = az + oz;
    }
    const gain = active ? 1 : 1 - smooth(this.settleTime / c.settle);
    this.push.x = ox * gain;
    this.push.y = oy * gain;
    this.push.z = oz * gain;
    const relSpeed = Math.hypot(s.vx, s.vy, s.vz);
    this.flutter = gain * Math.min(c.flutterMax, c.flutterGain * (bodySpeed * 0.5 + relSpeed * 0.5));
  }

  /** 身体停下后已经过了多久（演出时间，秒）；次级运动的收尾用 */
  private settleTime = 0;

  // ------------------------------------------------------------------

  /** 立即回到开场状态：原位、原朝向、站姿（再战一次时调用） */
  reset(): void {
    this.poseToken += 1;
    this.clearPose();
    this.gait.pitch = this.gait.roll = this.gait.hop = this.gait.spin = this.gait.squash = 0;
    this.impactToken += 1;
    for (const c of Object.keys(this.gaitJoints)) delete this.gaitJoints[c];
    this.shudder = 0;
    this.ground.x = this.home.x;
    this.ground.z = this.home.z;
    this.yaw = this.baseYaw;
    this.away = false;
    this.phase = 'idle';
    this.move = null;
    this.spring.ready = false;
    this.push.x = this.push.y = this.push.z = 0;
    this.flutter = 0;
  }

  /** 倒地时：放弃进行中的出手姿态 */
  dropPose(): void {
    this.poseToken += 1;
    this.clearPose();
    this.shudder = 0;
    if (!this.away) this.phase = 'idle';
  }
}

// 场上一个单位的表现：站位、朝向、程序化动作（待机、冲锋、出手、受击、倒地、复活）。
// 实现 director/types.ts 里的 StageUnit 接口，所有动作都通过 Scheduler 播放。
//
// 做法：每个动作只改几个“姿态参数”（前倾、抬手、倒地程度、闪白 …），
// 每帧由 applyPose() 把这些参数换算成模型根节点和骨架关节的位置、旋转。
// 人形角色额外驱动手臂关节；非人形的宝宝只用整体的前扑、后仰、起伏。

import { Color, Vector3, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from 'three';
import { getRig, type HumanoidRig } from '../../assets/models/characters/rig';
import { getEquippedWeapon, getWeaponGlow, getWeaponHold, setBowArrowVisible } from '../../assets/models/weapons';
import { GLOW_BASE_KEY } from '../../assets/materials';
import type { UnitTemplate } from '../../core/types';
import type { SoundPlayer } from '../../assets/audio/SoundEngine';
import type { SoundName } from '../../data/audioConfig';
import { animatedJointsOf } from './animatedJoints';
import { releaseSound, windupSound } from './soundCues';
import { chargeYaw, turnToward } from './turning';
import { facingOf, facingYawOf, slotPosition } from '../../data/formation';
import { ELEMENT_COLORS, FX_CONFIG, STAGING } from '../../data/presentationConfig';
import { createChainBand, type FxSystem, type TrailHandle } from '../fx/FxSystem';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { AnchorName, AttackStyle, GroundPoint, Point3, StageUnit } from '../director/types';

const HP_ANCHOR = 'hpAnchor';
const FLASH_COLOR = new Color(0xffffff);

/** 姿态参数：全部为 0 时就是自然站姿 */
interface Pose {
  windup: number; // 蓄力程度 0~1
  strike: number; // 出手程度 0~1
  style: AttackStyle;
  variant: number; // 近战挥砍轨迹：0 斜劈 / 1 横斩 / 2 跃起重劈
  lean: number; // 后仰（受击）弧度
  side: number; // 侧移（闪避），米
  hop: number; // 离地高度，米
  fall: number; // 倒地程度 0~1
  shrink: number; // 消失程度 0~1
  flash: number; // 闪白 0~1
  guard: number; // 防御姿态 0~1
}

interface JointRest {
  joint: Object3D;
  x: number;
  y: number;
  z: number;
}

export class UnitView implements StageUnit {
  readonly id: string;
  readonly side: UnitTemplate['side'];
  readonly kind: UnitTemplate['kind'];
  readonly radius: number;
  readonly home: GroundPoint;
  readonly facing: GroundPoint;

  /** 当前是否离开了站位（验收“除近战冲锋外不位移”用） */
  away = false;

  private readonly pose: Pose = {
    windup: 0,
    strike: 0,
    style: 'melee',
    variant: 0,
    lean: 0,
    side: 0,
    hop: 0,
    fall: 0,
    shrink: 0,
    flash: 0,
    guard: 0,
  };
  private readonly ground: GroundPoint;
  private readonly baseScale: number;
  private readonly height: number;
  private readonly rig: HumanoidRig | undefined;
  private readonly rest: Record<string, JointRest> = {};
  private readonly weapon: Object3D | undefined;
  private readonly weaponRestX: number;
  private readonly hpAnchor: Object3D | undefined;
  private readonly flashMaterials: MeshStandardMaterial[] = [];
  private readonly phase: number;
  private readonly tmp = new Vector3();
  private dead = false;
  /** 原始朝向（面向对方）与当前朝向：只有近战冲锋途中两者不同 */
  private readonly baseYaw: number;
  private yaw: number;
  readonly fxColor: number;
  private readonly weaponColors: { color: number; accentColor: number } | undefined;
  private readonly trailSpan: readonly [number, number];
  private trail: TrailHandle | null = null;
  private glowScale = 1;
  private glowMove = 0;
  private sealBands: Mesh[] | null = null;
  private sealed = false;

  constructor(
    template: UnitTemplate,
    readonly model: Object3D,
    private readonly scheduler: Scheduler,
    private readonly fx: FxSystem,
    private readonly sound: SoundPlayer = { play: () => undefined },
  ) {
    this.id = template.id;
    this.side = template.side;
    this.kind = template.kind;
    this.radius = template.rank === 'boss' ? STAGING.unitRadius.boss : STAGING.unitRadius[template.kind];
    this.home = slotPosition(template.side, template.slot);
    this.facing = facingOf(template.side);
    this.ground = { ...this.home };
    this.baseScale = model.scale.x;
    this.phase = (template.slot.col * 1.7 + template.slot.row * 2.9 + (template.side === 'ally' ? 0 : 1.3)) % 6.28;

    // 先转朝向（y），再做前后俯仰（x）：这样俯仰总是沿着单位自己的前后方向
    model.rotation.order = 'YXZ';
    this.baseYaw = facingYawOf(template.side);
    this.yaw = this.baseYaw;
    model.rotation.set(0, this.baseYaw, 0);

    this.hpAnchor = model.getObjectByName(HP_ANCHOR);
    this.height = (this.hpAnchor ? this.hpAnchor.position.y : 1.8) * this.baseScale;

    this.rig = getRig(model);
    if (this.rig) {
      for (const [name, joint] of Object.entries(animatedJointsOf(this.rig))) {
        this.rest[name] = { joint, x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z };
      }
    }
    this.weapon = getEquippedWeapon(model);
    this.weaponRestX = this.weapon?.rotation.x ?? 0;
    const glow = this.weapon ? getWeaponGlow(this.weapon) : undefined;
    this.weaponColors = glow?.currentColors;
    this.fxColor = this.weaponColors?.color ?? FX_CONFIG.sideColor[template.side];
    this.trailSpan = (template.weaponId && FX_CONFIG.trailSpan[template.weaponId]) || [0, 0];

    // 受击闪白只作用在不发光的表面材质上（发光材质由武器/目光自己控制）
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const std = m as MeshStandardMaterial;
        if (!std.isMeshStandardMaterial || std.userData[GLOW_BASE_KEY] !== undefined) continue;
        if (std.emissive.getHex() !== 0 || std.emissiveMap) continue;
        if (!this.flashMaterials.includes(std)) this.flashMaterials.push(std);
      }
    });

    this.applyPose();
  }

  // ------------------------------------------------------------------
  // StageUnit
  // ------------------------------------------------------------------

  anchor(name: AnchorName): Point3 {
    if (name === 'weapon' && this.weapon) {
      const p = this.weapon.getWorldPosition(this.tmp);
      return { x: p.x, y: p.y, z: p.z };
    }
    const y = name === 'ground' ? 0.05 : name === 'head' ? this.height : this.height * (name === 'weapon' ? 0.7 : 0.5);
    // 倒地的单位重心在地面附近
    return { x: this.ground.x, y: this.dead && name !== 'head' ? Math.min(y, 0.3) : y, z: this.ground.z };
  }

  /** 头顶条的世界坐标（站位上方固定高度，不随冲锋和倒地晃动以外的动作抖动） */
  headPosition(out: Vector3): Vector3 {
    // 倒地后头顶条降低一些，贴近躺在地上的身体
    return out.set(this.ground.x, this.height * (1 - 0.55 * this.pose.fall) + this.pose.hop, this.ground.z);
  }

  moveTo(point: GroundPoint, duration: number, face?: GroundPoint): Promise<void> {
    this.away = true;
    const dx = point.x - this.ground.x;
    const dz = point.z - this.ground.z;
    const fromYaw = this.yaw;
    // 几乎没有位移时不转向跑动方向（避免方向抖动）
    const travel = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : fromYaw;
    const faceYaw = face ? Math.atan2(face.x - point.x, face.z - point.z) : travel;
    return this.slide(point, duration, (t) => chargeYaw(t, fromYaw, travel, faceYaw, STAGING.chargeTurn));
  }

  async returnHome(duration: number): Promise<void> {
    // 面朝对手退回原位，途中平滑转回原来的朝向（不做 180° 的急转身）
    const fromYaw = this.yaw;
    await this.slide(this.home, duration, (t) => turnToward(fromYaw, this.baseYaw, t));
    this.yaw = this.baseYaw;
    this.away = false;
  }

  private cue(name: SoundName | null, intensity = 1): void {
    if (name) this.sound.play(name, intensity);
  }

  private slide(to: GroundPoint, duration: number, yawAt: (t: number) => number): Promise<void> {
    const from = { ...this.ground };
    return this.scheduler.tween(duration, (t) => {
      const k = EASE.inOut(t);
      this.ground.x = from.x + (to.x - from.x) * k;
      this.ground.z = from.z + (to.z - from.z) * k;
      this.yaw = yawAt(t);
      this.pose.hop = Math.sin(Math.PI * t) * STAGING.runHopHeight;
    });
  }

  windup(style: AttackStyle, duration: number, variant = 0): Promise<void> {
    this.pose.style = style;
    this.pose.variant = variant;
    this.pose.strike = 0;
    if ((style === 'bow' || style === 'bowUp') && this.weapon) setBowArrowVisible(this.weapon, true);
    this.cue(windupSound(style));
    const from = this.pose.windup; // 连击时上一击还没完全收招，从当前程度接着蓄力
    return this.scheduler.tween(duration, (t) => (this.pose.windup = from + (1 - from) * t), EASE.out);
  }

  release(style: AttackStyle, duration: number, variant = 0): Promise<void> {
    this.pose.style = style;
    this.pose.variant = variant;
    if (this.weapon) {
      // 出手瞬间武器光芒增强
      getWeaponGlow(this.weapon)?.flare();
      if (style === 'bow' || style === 'bowUp') setBowArrowVisible(this.weapon, false);
    }
    this.cue(releaseSound(style), variant === 2 ? 1.3 : 1); // 重劈的挥击声更重
    return this.scheduler.tween(duration, (t) => (this.pose.strike = t), EASE.in);
  }

  recover(duration: number): Promise<void> {
    const w = this.pose.windup;
    const s = this.pose.strike;
    return this.scheduler.tween(
      duration,
      (t) => {
        this.pose.windup = w * (1 - t);
        this.pose.strike = s * (1 - t);
      },
      EASE.inOut,
    );
  }

  hit(duration: number, heavy: boolean): Promise<void> {
    const amount = heavy ? 0.42 : 0.26;
    this.sound.play(heavy ? 'heavyHit' : 'hit');
    return this.scheduler.tween(duration, (t) => {
      const k = EASE.arc(t);
      this.pose.lean = amount * k;
      this.pose.flash = Math.max(0, 1 - t * 2.2); // 闪白只在前半段
    });
  }

  dodge(duration: number): Promise<void> {
    this.sound.play('dodge');
    return this.scheduler.tween(duration, (t) => (this.pose.side = EASE.arc(t) * 0.28));
  }

  async die(vanish: boolean, fallDuration: number, vanishDuration: number): Promise<void> {
    this.dead = true;
    this.sound.play('fall');
    this.setSealed(false);
    this.pose.guard = 0;
    this.pose.windup = 0;
    this.pose.strike = 0;
    await this.scheduler.tween(
      fallDuration,
      (t) => {
        this.pose.fall = t;
        this.pose.flash = Math.max(0, 1 - t * 3);
      },
      EASE.in,
    );
    if (vanish) {
      await this.scheduler.tween(vanishDuration, (t) => (this.pose.shrink = t), EASE.in);
      this.model.visible = false;
    }
  }

  async revive(duration: number): Promise<void> {
    this.model.visible = true;
    this.sound.play('revive');
    const shrink = this.pose.shrink;
    const fall = this.pose.fall;
    await this.scheduler.tween(
      duration,
      (t) => {
        this.pose.shrink = shrink * (1 - t);
        this.pose.fall = fall * (1 - t);
      },
      EASE.inOut,
    );
    this.dead = false;
  }

  /** 回到开场状态：站在原位、存活、自然站姿（再战一次时调用） */
  reset(): void {
    const p = this.pose;
    p.windup = p.strike = p.lean = p.side = p.hop = p.fall = p.shrink = p.guard = 0;
    p.flash = 0;
    p.style = 'melee';
    p.variant = 0;
    this.dead = false;
    this.away = false;
    this.yaw = this.baseYaw;
    this.trail = null; // 拖尾网格已由特效系统统一收回
    this.setSealed(false);
    this.setWeaponGlow(1, 0);
    this.setWeaponColor(null);
    this.ground.x = this.home.x;
    this.ground.z = this.home.z;
    this.model.visible = true;
    this.applyPose(this.scheduler.time);
  }

  setDefending(on: boolean): void {
    if (this.dead && on) return;
    const from = this.pose.guard;
    const to = on ? 1 : 0;
    void this.scheduler.tween(0.2, (t) => (this.pose.guard = from + (to - from) * t), EASE.out);
  }

  setWeaponGlow(scale: number, duration: number): void {
    const glow = this.weapon ? getWeaponGlow(this.weapon) : undefined;
    if (!glow) return;
    const id = (this.glowMove += 1);
    const from = this.glowScale;
    void this.scheduler.tween(duration, (t) => {
      if (id !== this.glowMove) return; // 已被更新的一次调用取代
      this.glowScale = from + (scale - from) * t;
      glow.setScale(this.glowScale);
    });
  }

  setWeaponColor(color: number | null): void {
    const glow = this.weapon ? getWeaponGlow(this.weapon) : undefined;
    if (!glow || !this.weaponColors) return;
    if (color === null) glow.setColor(this.weaponColors.color, this.weaponColors.accentColor);
    else glow.setColor(color);
  }

  setTrail(on: boolean): void {
    if (!on) {
      this.trail?.stop();
      this.trail = null;
      return;
    }
    if (this.trail) return;
    // 没有武器的单位拖的是身体带起的一道淡淡的风痕
    this.trail = this.fx.startTrail((base, tip) => this.sampleTrail(base, tip), this.fxColor, this.weapon ? 1 : 0.4);
  }

  /** 拖尾两端的世界坐标：有武器取武器上的两点，没有武器取身体前方的一条竖线 */
  private sampleTrail(base: Vector3, tip: Vector3): void {
    if (this.weapon) {
      this.weapon.updateWorldMatrix(true, false);
      base.set(0, this.trailSpan[0], 0).applyMatrix4(this.weapon.matrixWorld);
      tip.set(0, this.trailSpan[1], 0).applyMatrix4(this.weapon.matrixWorld);
      return;
    }
    const m = this.model.position;
    const reach = this.radius * 0.9;
    base.set(m.x + this.facing.x * reach, m.y + this.height * 0.38, m.z + this.facing.z * reach);
    tip.set(m.x + this.facing.x * reach, m.y + this.height * 0.6, m.z + this.facing.z * reach);
  }

  setSealed(on: boolean): void {
    if (on === this.sealed) return;
    this.sealed = on;
    if (on && !this.sealBands) {
      // 第一次被封印时才创建锁链；挂在模型上，跟着模型一起后仰、倒地
      const top = this.height / this.baseScale;
      const r = (this.radius / this.baseScale) * 0.95;
      this.sealBands = [0.42, 0.68].map((h, i) => {
        const band = createChainBand(ELEMENT_COLORS.seal, 1.6);
        band.scale.set(r, top * 0.09, r);
        band.position.y = top * h;
        band.rotation.set(i === 0 ? 0.3 : -0.26, 0, i === 0 ? -0.18 : 0.22);
        this.model.add(band);
        return band;
      });
    }
    for (const band of this.sealBands ?? []) band.visible = on;
  }

  // ------------------------------------------------------------------
  // 每帧
  // ------------------------------------------------------------------

  /** 每帧调用：把姿态参数应用到模型上（time 为调度器的演出时间） */
  update(time: number): void {
    this.applyPose(time);
    if (this.sealed && this.sealBands) {
      this.sealBands[0]!.rotation.y = time * 1.4;
      this.sealBands[1]!.rotation.y = -time * 1.1;
      const pulse = 1.3 + 0.5 * Math.sin(time * 4);
      for (const band of this.sealBands) (band.material as MeshBasicMaterial).opacity = pulse / 1.8;
    }
  }

  private applyPose(time = 0): void {
    const p = this.pose;
    const m = this.model;
    const alive = 1 - p.fall;
    // 待机起伏：倒地后停止
    const breath = Math.sin(time * 1.7 + this.phase) * alive;
    const bob = (this.kind === 'pet' ? 0.014 : 0.008) * this.baseScale * breath;

    // 出手时身体的前后移动：蓄力后撤，出手前扑
    const lungeScale = this.rig ? 0.5 : 1; // 非人形主要靠整体前扑表现攻击
    let forward = 0;
    let pitch = 0;
    let lift = 0;
    let roll = 0; // 绕前后轴的侧倾（非人形的横扫）
    if (p.style === 'melee') {
      forward = (-0.12 * p.windup + 0.42 * p.strike) * lungeScale;
      pitch = (-0.12 * p.windup + 0.3 * p.strike) * lungeScale;
      if (p.variant === 1) {
        // 横斩：身体侧倾着扫过去
        roll = (-0.35 * p.windup + 0.7 * p.strike) * (this.rig ? 0.25 : 1);
      } else if (p.variant === 2) {
        // 重劈：蓄力时跃起，出手时砸下并更深地前倾
        lift = 0.38 * p.windup * (1 - p.strike);
        pitch += 0.22 * p.strike * lungeScale + (this.rig ? 0.12 * p.strike : 0);
        forward += 0.12 * p.strike;
      }
    } else if (p.style === 'bow' || p.style === 'bowUp') {
      forward = -0.05 * p.windup + 0.05 * p.strike;
      // 仰射：整个人向后仰，把弓指向天空
      pitch = (p.style === 'bowUp' ? -0.6 : -0.05) * p.windup;
    } else {
      lift = (0.1 * p.windup + 0.05 * p.strike) * (this.rig ? 0.4 : 1);
      pitch = -0.1 * p.windup + 0.18 * p.strike;
    }
    forward -= 0.12 * p.lean; // 受击时略微后退
    forward -= 0.06 * p.guard;

    // 当前朝向（冲锋途中会转身），出手的前冲、受击的后退都沿着它
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    m.rotation.y = this.yaw;
    // 侧移方向：朝向的垂直方向
    const s = this.baseScale;
    m.position.set(
      this.ground.x + fx * forward * s - fz * p.side * s,
      p.hop + lift * s + bob,
      this.ground.z + fz * forward * s + fx * p.side * s,
    );
    // 前倾为正；受击后仰、倒地向后躺平
    m.rotation.x = pitch - p.lean - 0.08 * p.guard - (Math.PI / 2) * EASE.in(p.fall);
    m.rotation.z = roll;
    const k = this.baseScale * (1 - 0.97 * p.shrink);
    m.scale.setScalar(k);

    if (this.rig) this.applyRigPose(breath);

    // 闪白
    if (p.flash > 0 || this.flashWasOn) {
      for (const mat of this.flashMaterials) {
        mat.emissive.copy(FLASH_COLOR);
        mat.emissiveIntensity = p.flash * 0.9;
        if (p.flash <= 0) mat.emissive.setHex(0);
      }
      this.flashWasOn = p.flash > 0;
    }
  }

  private flashWasOn = false;

  /** 人形角色：驱动手臂、腰、头的关节 */
  private applyRigPose(breath: number): void {
    const p = this.pose;
    const r = this.rest;
    const set = (name: string, dx: number, dy = 0, dz = 0): number => {
      const j = r[name]!;
      j.joint.rotation.set(j.x + dx, j.y + dy, j.z + dz);
      return dx;
    };
    // 肩、肘绕 x 轴转动：负值 = 手臂向前上方抬起
    let shoulderR = 0;
    let elbowR = 0;
    let shoulderL = 0;
    let elbowL = 0;
    let twist = 0; // 腰部左右扭转
    if (p.style === 'melee' && p.variant === 1) {
      // 横斩：手臂平举在身前，靠腰部从一侧大幅扭到另一侧把武器扫过去
      shoulderR = -1.45 * p.windup;
      elbowR = -0.25 * p.windup + 0.2 * p.strike;
      twist = -1.05 * p.windup + 2.0 * p.strike;
    } else if (p.style === 'melee' && p.variant === 2) {
      // 重劈：双手高举过头，全力砸下
      shoulderR = -2.5 * p.windup + 2.3 * p.strike;
      elbowR = -0.3 * p.windup + 0.7 * p.strike;
      shoulderL = -2.2 * p.windup + 2.0 * p.strike;
      elbowL = -0.5 * p.windup + 0.6 * p.strike;
      twist = 0.15 * p.strike;
    } else if (p.style === 'melee') {
      // 斜劈：举过头顶 → 向前下方劈下
      shoulderR = -1.9 * p.windup + 1.6 * p.strike;
      elbowR = -0.5 * p.windup + 0.9 * p.strike;
      twist = -0.35 * p.windup + 0.6 * p.strike;
    } else if (p.style === 'bow' || p.style === 'bowUp') {
      // 左手持弓前举，右手后拉；松弦时右手弹开
      shoulderL = -1.25 * p.windup;
      elbowL = 0.15 * p.windup;
      shoulderR = -1.0 * p.windup + 0.2 * p.strike;
      elbowR = -1.0 * p.windup + 0.7 * p.strike;
      twist = 0.45 * p.windup;
    } else {
      // 双手上举蓄力，出手时向前一推
      shoulderR = -0.95 * p.windup + 0.35 * p.strike;
      elbowR = -0.2 * p.windup + 0.4 * p.strike;
      shoulderL = -1.5 * p.windup + 0.5 * p.strike;
      elbowL = -0.5 * p.windup + 0.4 * p.strike;
    }
    // 防御：双臂护在身前
    shoulderR += -0.5 * p.guard;
    elbowR += -0.9 * p.guard;
    shoulderL += -0.9 * p.guard;
    elbowL += -1.3 * p.guard;

    set('shoulderR', shoulderR);
    set('elbowR', elbowR);
    set('shoulderL', shoulderL);
    set('elbowL', elbowL);
    set('spine', 0, twist);
    set('chest', 0.012 * breath - 0.25 * p.lean);
    set('head', 0.3 * p.lean - 0.1 * p.guard);

    // 弓要保持竖直：手臂抬起多少，武器就反向转回多少（都绕 x 轴，可以直接相加）
    if (this.weapon && getWeaponHold(this.weapon)?.hand === 'left') {
      this.weapon.rotation.x = this.weaponRestX - (shoulderL + elbowL);
    }
  }
}

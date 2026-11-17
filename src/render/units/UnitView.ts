// 场上一个单位的表现：站位、朝向、程序化动作（待机、冲锋、出手、受击、倒地、复活）。
// 实现 director/types.ts 里的 StageUnit 接口，所有动作都通过 Scheduler 播放。
//
// 做法：
//   - 出手（冲刺、预备、发力、顿住、余势、收招）的状态在 UnitMotion 里计算（纯计算，可单元测试）：
//     当前位置、朝向、相对站姿的“动作姿态”（各关节和整体的偏移量，关键姿态在 data/attackAnimConfig.ts）；
//   - 受击、闪避、倒地、防御仍是这里的几个“姿态参数”；
//   - 每帧由 applyPose() 把两者叠加，换算成模型根节点和各关节的位置、旋转，最后再叠加待机偏移。

import { Color, Matrix4, Quaternion, Vector3, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from 'three';
import { getRig, type HumanoidRig } from '../../assets/models/characters/rig';
import { getEquippedWeapon, getWeaponGlow, getWeaponHold, setBowArrowVisible } from '../../assets/models/weapons';
import { GLOW_BASE_KEY } from '../../assets/materials';
import type { UnitTemplate } from '../../core/types';
import type { SoundPlayer } from '../../assets/audio/SoundEngine';
import type { SoundName } from '../../data/audioConfig';
import { animatedJointsOf, extraJointsOf } from './animatedJoints';
import { ATTACK_ANIM, MOTION_OF_TEMPLATE, MOTION_PROFILES, SECONDARY_MOTION, moveOf, type MotionId } from '../../data/attackAnimConfig';
import { IdleAnimator } from './IdleAnimator';
import { UnitMotion, type Footfall, type MotionPhase } from './UnitMotion';
import { seedOf } from './idleMotion';
import { IDLE_CONFIG } from '../../data/idleConfig';
import { UNIT_MODELS } from '../../data/unitModels';
import { releaseSound, windupSound } from './soundCues';
import { facingOf, facingYawOf, slotPosition } from '../../data/formation';
import { ELEMENT_COLORS, FX_CONFIG, STAGING } from '../../data/presentationConfig';
import { createChainBand, type FxSystem, type TrailHandle } from '../fx/FxSystem';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { AnchorName, AttackStyle, GroundPoint, MoveOptions, Point3, StageUnit } from '../director/types';

const HP_ANCHOR = 'hpAnchor';
const FLASH_COLOR = new Color(0xffffff);

/** 进攻动画的全局开关（低画质时关掉次级运动），所有单位共用 */
export const ATTACK_RUNTIME = {
  secondary: true, // 披风、袍摆、链条、尾巴的惯性甩动
};

/** 受击 / 闪避 / 倒地 / 防御的姿态参数：全部为 0 时就是自然站姿（出手的姿态在 UnitMotion 里） */
interface Pose {
  lean: number; // 后仰（受击）弧度
  side: number; // 侧移（闪避），米
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
  /** 这个关节在动作姿态里的三个通道名（<关节>.x / .y / .z） */
  keys: readonly [string, string, string];
}

const channelKeys = (name: string): [string, string, string] => [`${name}.x`, `${name}.y`, `${name}.z`];

export class UnitView implements StageUnit {
  readonly id: string;
  private readonly templateId: string;
  readonly side: UnitTemplate['side'];
  readonly kind: UnitTemplate['kind'];
  readonly radius: number;
  readonly home: GroundPoint;
  readonly facing: GroundPoint;

  /** 动作档案：用哪一套进攻动作 */
  readonly motion: MotionId;
  /** 镜头轻震的出口（魔偶踏步）；由 BattleStage 接到演出镜头上 */
  onShake: (amount: number) => void = () => undefined;

  private readonly pose: Pose = { lean: 0, side: 0, fall: 0, shrink: 0, flash: 0, guard: 0 };
  /** 出手的动作状态：位置、朝向、动作姿态、阶段 */
  private readonly act: UnitMotion;
  private readonly baseScale: number;
  private readonly height: number;
  private readonly rig: HumanoidRig | undefined;
  private readonly rest: Record<string, JointRest> = {};
  /** 人形骨架之外的关节（宝宝的头、颈、腿、翅 …）：待机先摆好，动作姿态再加上去 */
  private readonly extras: { joint: Object3D; keys: readonly [string, string, string] }[] = [];
  private readonly tail: Object3D | undefined;
  private readonly muzzleJoint: Object3D | undefined;
  private readonly weapon: Object3D | undefined;
  private readonly weaponRest = { x: 0, y: 0, z: 0 };
  private readonly weaponLeft: boolean;
  private readonly hpAnchor: Object3D | undefined;
  private readonly flashMaterials: MeshStandardMaterial[] = [];
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmp3 = new Vector3();
  private readonly quat = new Quaternion();
  private readonly quat2 = new Quaternion();
  private readonly basis = new Matrix4();
  private dead = false;
  /** 原始朝向（面向对方）；当前朝向在 act.yaw，只有近战冲锋途中两者不同 */
  private readonly baseYaw: number;
  readonly fxColor: number;
  private readonly weaponColors: { color: number; accentColor: number } | undefined;
  private readonly trailSpan: readonly [number, number];
  private trail: TrailHandle | null = null;
  private glowScale = 1;
  private glowMove = 0;
  private sealBands: Mesh[] | null = null;
  private sealed = false;
  /** 待机动画：每个单位自己的相位和周期（按单位 id 取种子），见 IdleAnimator */
  private readonly idle: IdleAnimator;
  /** 待机权重（0~1）：出手、受击、冲锋时平滑降到 0，结束后平滑回到 1 */
  private idleWeight = 1;
  private lastIdleTime = 0;

  constructor(
    template: UnitTemplate,
    readonly model: Object3D,
    private readonly scheduler: Scheduler,
    private readonly fx: FxSystem,
    private readonly sound: SoundPlayer = { play: () => undefined },
  ) {
    this.id = template.id;
    this.templateId = template.templateId;
    this.side = template.side;
    this.kind = template.kind;
    this.radius = template.rank === 'boss' ? STAGING.unitRadius.boss : STAGING.unitRadius[template.kind];
    this.home = slotPosition(template.side, template.slot);
    this.facing = facingOf(template.side);
    this.baseScale = model.scale.x;

    // 先转朝向（y），再做前后俯仰（x）：这样俯仰总是沿着单位自己的前后方向
    model.rotation.order = 'YXZ';
    this.baseYaw = facingYawOf(template.side);
    model.rotation.set(0, this.baseYaw, 0);

    this.hpAnchor = model.getObjectByName(HP_ANCHOR);
    this.height = (this.hpAnchor ? this.hpAnchor.position.y : 1.8) * this.baseScale;

    this.rig = getRig(model);
    if (this.rig) {
      for (const [name, joint] of Object.entries(animatedJointsOf(this.rig))) {
        this.rest[name] = { joint, x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z, keys: channelKeys(name) };
      }
    }
    const extra = extraJointsOf(model, this.rig);
    for (const [name, joint] of Object.entries(extra)) this.extras.push({ joint, keys: channelKeys(name) });
    this.tail = this.rig ? undefined : extra['tail'];
    // 动作档案：人物按武器，其余按模板；没指定的人形用刀的动作，非人形用通用的扑击
    this.motion = template.weaponId ?? MOTION_OF_TEMPLATE[template.templateId] ?? (this.rig ? 'blade' : 'beast');
    const muzzle = MOTION_PROFILES[this.motion].muzzle;
    this.muzzleJoint = muzzle?.joint ? extra[muzzle.joint] : undefined;
    this.act = new UnitMotion(scheduler, this.home, this.baseYaw, this.motion, (f) => this.footfall(f));
    this.weapon = getEquippedWeapon(model);
    if (this.weapon) {
      this.weaponRest.x = this.weapon.rotation.x;
      this.weaponRest.y = this.weapon.rotation.y;
      this.weaponRest.z = this.weapon.rotation.z;
    }
    this.weaponLeft = this.weapon !== undefined && getWeaponHold(this.weapon)?.hand === 'left';
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

    this.idle = new IdleAnimator(model, UNIT_MODELS[template.templateId]?.idle ?? 'stiff', seedOf(template.id));
    this.idle.update(0, 1);
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
    if (name === 'muzzle') return this.muzzle();
    const y = name === 'ground' ? 0.05 : name === 'head' ? this.height : this.height * (name === 'weapon' ? 0.7 : 0.5);
    // 倒地的单位重心在地面附近
    return { x: this.ground.x, y: this.dead && name !== 'head' ? Math.min(y, 0.3) : y, z: this.ground.z };
  }

  /** 施法点：骨龙的嘴前、幽灵的双手之间；没有专门配置的单位等同于武器挂点 */
  private muzzle(): Point3 {
    const def = MOTION_PROFILES[this.motion].muzzle;
    if (!def) return this.anchor('weapon');
    const s = this.baseScale;
    const fx = Math.sin(this.act.yaw);
    const fz = Math.cos(this.act.yaw);
    if (this.muzzleJoint) {
      this.muzzleJoint.updateWorldMatrix(true, false);
      const p = this.muzzleJoint.getWorldPosition(this.tmp);
      return { x: p.x + fx * def.forward * s, y: p.y + def.up * s, z: p.z + fz * def.forward * s };
    }
    const m = this.model.position;
    return { x: m.x + fx * def.forward * s, y: m.y + def.up * s, z: m.z + fz * def.forward * s };
  }

  /** 当前所在的地面位置（只有近战冲锋途中不等于站位） */
  private get ground(): GroundPoint {
    return this.act.ground;
  }

  /** 当前是否离开了站位（验收“除近战冲锋外不位移”用） */
  get away(): boolean {
    return this.act.away;
  }

  /** 出手者当前的阶段（联系表、调试用） */
  get phase(): MotionPhase {
    return this.act.phase;
  }

  /** 调试：当前出手动作的名字、动作姿态是否已回到站姿、当前朝向与位置 */
  motionSnapshot(): { phase: MotionPhase; move: string | null; atRest: boolean; yawOffset: number; x: number; z: number } {
    return {
      phase: this.act.phase,
      move: this.act.move?.label ?? null,
      atRest: this.act.atRest,
      yawOffset: this.act.yaw - this.baseYaw,
      x: this.ground.x - this.home.x,
      z: this.ground.z - this.home.z,
    };
  }

  /** 头顶条的世界坐标（站位上方固定高度，不随冲锋和倒地晃动以外的动作抖动） */
  headPosition(out: Vector3): Vector3 {
    // 倒地后头顶条降低一些，贴近躺在地上的身体
    return out.set(this.ground.x, this.height * (1 - 0.55 * this.pose.fall) + this.act.gait.hop, this.ground.z);
  }

  moveTo(point: GroundPoint, duration: number, face?: GroundPoint, options?: MoveOptions): Promise<void> {
    return this.act.moveTo(point, duration, face, options);
  }

  returnHome(duration: number, options?: MoveOptions): Promise<void> {
    // 面朝对手退回原位，途中平滑转回原来的朝向（不做 180° 的急转身）
    return this.act.returnHome(duration, options);
  }

  brace(duration: number): Promise<void> {
    return this.act.brace(duration);
  }

  private cue(name: SoundName | null, intensity = 1): void {
    if (name) this.sound.play(name, intensity);
  }

  /** 落脚：脚下扬起尘土，金属靴带几点火星，沉重的踏步让镜头轻震 */
  private footfall(f: Footfall): void {
    if (f.dust > 0) {
      // 尘土朝行进的反方向扬起（刹车时朝前）
      const back = f.kind === 'end' ? 0.25 : -0.2;
      const at = { x: f.x + f.dirX * back, y: 0.05, z: f.z + f.dirZ * back };
      void this.fx.burst('dust', at, f.sparks && f.kind !== 'step' ? ATTACK_ANIM.sparkColor : ATTACK_ANIM.dustColor, 0.5, f.dust * (0.6 + 0.4 * this.baseScale));
    }
    if (f.shake > 0) this.onShake(f.shake);
  }

  windup(style: AttackStyle, duration: number, variant = 0): Promise<void> {
    if ((style === 'bow' || style === 'bowUp') && this.weapon) setBowArrowVisible(this.weapon, true);
    this.cue(windupSound(style));
    return this.act.windup(style, duration, variant);
  }

  release(style: AttackStyle, duration: number, variant = 0): Promise<void> {
    if (this.weapon) {
      // 出手瞬间武器光芒增强
      getWeaponGlow(this.weapon)?.flare();
      if (style === 'bow' || style === 'bowUp') setBowArrowVisible(this.weapon, false);
    }
    const move = moveOf(this.motion, style, variant);
    this.cue(releaseSound(style), move.fx?.loud ? 1.3 : 1); // 重劈的挥击声更重
    const done = this.act.release(style, duration, variant);
    // 发力结束（落地 / 踏地）时脚下的尘土
    const dust = move.fx?.groundDust ?? 0;
    if (dust > 0) {
      void done.then(() => {
        if (this.scheduler.skip) return;
        const reach = this.radius * 0.8;
        const at = { x: this.ground.x + Math.sin(this.act.yaw) * reach, y: 0.05, z: this.ground.z + Math.cos(this.act.yaw) * reach };
        void this.fx.burst('dust', at, ATTACK_ANIM.dustColor, 0.55, dust * (0.6 + 0.4 * this.baseScale));
      });
    }
    return done;
  }

  hold(duration: number): Promise<void> {
    return this.act.hold(duration);
  }

  follow(duration: number): Promise<void> {
    return this.act.follow(duration);
  }

  recover(duration: number): Promise<void> {
    return this.act.recover(duration);
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
    this.act.dropPose();
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
    p.lean = p.side = p.fall = p.shrink = p.guard = 0;
    p.flash = 0;
    this.dead = false;
    this.act.reset();
    this.trail = null; // 拖尾网格已由特效系统统一收回
    this.setSealed(false);
    this.setWeaponGlow(1, 0);
    this.setWeaponColor(null);
    this.model.visible = true;
    this.idleWeight = 1;
    this.idle.update(this.lastIdleTime, 1);
    this.idle.setSecondary(0, 0, 0, 0);
    this.applyPose();
  }

  /** 调试：这个单位当前的待机状态（权重、呼吸相位、转头角度、周期倍率），window.__idle() 用 */
  idleSnapshot(): { weight: number; breath: number; headYaw: number; roll: number; rate: number; style: string } {
    const o = this.idle.offsets;
    return {
      weight: this.idleWeight,
      breath: o.breath,
      headYaw: o.headYaw,
      roll: o.roll,
      rate: this.idle.traits.rate,
      style: UNIT_MODELS[this.templateId]?.idle ?? 'stiff',
    };
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
    this.trail = this.fx.startTrail((base, tip) => this.sampleTrail(base, tip), this.fxColor, this.weapon ? FX_CONFIG.trailBrightness : 0.3);
  }

  /** 拖尾两端的世界坐标：有武器取武器上的两点，没有武器取身体前方的一条竖线 */
  private sampleTrail(base: Vector3, tip: Vector3): void {
    if (this.weapon) {
      this.weapon.updateWorldMatrix(true, false);
      base.set(0, this.trailSpan[0], 0).applyMatrix4(this.weapon.matrixWorld);
      tip.set(0, this.trailSpan[1], 0).applyMatrix4(this.weapon.matrixWorld);
      // 只取靠近尖端的一段：挥击幅度大时是一道弧形的光带，而不是一整片扇面
      base.lerpVectors(tip, base, FX_CONFIG.trailWidth);
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

  /**
   * 每帧调用：把姿态参数应用到模型上。
   * @param time 调度器的演出时间（封印锁链的旋转用）
   * @param idleTime 待机动画用的时间：场景的连续时间，不受“跳过动画”影响，保证待机动作不会突然跳变
   */
  update(time: number, idleTime = time): void {
    const dt = Math.min(0.1, Math.max(0, idleTime - this.lastIdleTime));
    this.lastIdleTime = idleTime;
    // 待机权重：有出手 / 受击 / 冲锋动作时目标为 0，否则为 1；按固定速率平滑靠近，切换没有跳变
    const p = this.pose;
    const busy = Math.min(1, Math.max(this.act.busy ? 1 : 0, p.lean * 3, p.side * 4));
    const target = (1 - busy) * (1 - (1 - IDLE_CONFIG.guardScale) * p.guard);
    this.idleWeight += (target - this.idleWeight) * (1 - Math.exp(-IDLE_CONFIG.blendRate * dt));
    // 倒地后只保留极轻微的变化；消失的单位不动
    const down = (1 - (1 - IDLE_CONFIG.fallenScale) * p.fall) * (1 - p.shrink);
    this.idle.update(idleTime, this.idleWeight * down);
    this.applyPose(time);
    this.updateSecondary();
    if (this.sealed && this.sealBands) {
      this.sealBands[0]!.rotation.y = time * 1.4;
      this.sealBands[1]!.rotation.y = -time * 1.1;
      const pulse = 1.3 + 0.5 * Math.sin(time * 4);
      for (const band of this.sealBands) (band.material as MeshBasicMaterial).opacity = pulse / 1.8;
    }
  }

  /**
   * 次级运动：披风、袍摆、链条被身体带动（弹簧质点的偏移量交给布料着色器），狼的尾巴跟着甩。
   * 用演出时间推进：倍速时更快，顿帧时一起停住，跳过动画时直接归零。
   */
  private updateSecondary(): void {
    const c = SECONDARY_MOTION;
    const m = this.model;
    const back = c.backOffset * this.baseScale;
    const yaw = m.rotation.y;
    const enabled = ATTACK_RUNTIME.secondary && !this.dead;
    this.act.updateSecondary(
      this.scheduler.delta,
      m.position.x - Math.sin(yaw) * back,
      m.position.y,
      m.position.z - Math.cos(yaw) * back,
      enabled,
    );
    const push = this.act.push;
    this.idle.setSecondary(push.x, push.y, push.z, this.act.flutter);
    if (this.tail && (push.x !== 0 || push.z !== 0)) {
      // 偏移量换到模型自己的左右 / 前后方向，变成尾巴的转角
      const k = c.tailGain / this.baseScale;
      const lateral = (push.x * Math.cos(yaw) - push.z * Math.sin(yaw)) * k;
      const along = (push.x * Math.sin(yaw) + push.z * Math.cos(yaw)) * k;
      const lim = (v: number): number => Math.max(-c.tailMax, Math.min(c.tailMax, v));
      this.tail.rotation.y += lim(lateral);
      this.tail.rotation.x += lim(-along * 0.6);
    }
  }

  private applyPose(time = 0): void {
    const p = this.pose;
    const m = this.model;
    const a = this.act.pose;
    const g = this.act.gait;
    const ch = (c: string): number => a[c] ?? 0;
    // 待机：整体的起伏、漂浮、重心转移（都已乘过待机权重，出手和倒地时自然归零）
    const idle = this.idle.offsets;
    const bob = (idle.bob + idle.float) * this.baseScale;

    // 出手：动作姿态里的整体位移和转动，加上冲刺 / 扑跃的步态层
    let forward = ch('root.forward');
    const pitch = ch('root.pitch') + g.pitch;
    const lift = ch('root.lift');
    const roll = ch('root.roll') + g.roll;
    const turn = ch('root.turn') + g.spin;
    // 命中顿住时的一点震颤
    if (this.act.shudder > 0) forward += this.act.shudder * Math.sin(time * 95);
    forward -= 0.12 * p.lean; // 受击时略微后退
    forward -= 0.06 * p.guard;

    // 当前朝向（冲锋途中会转身），出手的前冲、受击的后退都沿着它；动作里的转身只转身体，不改变前冲方向
    const yaw = this.act.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    m.rotation.y = yaw + turn;
    // 侧移方向：朝向的垂直方向
    const s = this.baseScale;
    const side = p.side + idle.shift + ch('root.side'); // 重心转移带起的一点点左右位移（厘米级，不算离开站位）
    m.position.set(
      this.ground.x + fx * forward * s - fz * side * s,
      g.hop + lift * s + bob,
      this.ground.z + fz * forward * s + fx * side * s,
    );
    // 前倾为正；受击后仰、倒地向后躺平
    m.rotation.x = pitch - p.lean - 0.08 * p.guard - (Math.PI / 2) * EASE.in(p.fall);
    m.rotation.z = roll + idle.roll;
    // 整体形变：扑跃时沿前后方向拉长，落地 / 蓄力时压扁
    const k = this.baseScale * (1 - 0.97 * p.shrink);
    const stretch = ch('root.stretch');
    const squash = ch('root.squash');
    if (stretch === 0 && squash === 0) m.scale.setScalar(k);
    else m.scale.set(k * (1 - 0.2 * stretch + 0.25 * squash), k * (1 - 0.3 * stretch - squash), k * (1 + stretch + 0.25 * squash));

    if (this.rig) {
      this.applyRigPose();
      this.idle.addToRig(); // 待机偏移加在出手 / 受击姿态之上
    }
    this.applyExtraJoints();
    this.applyWeaponPose();

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

  /** 人形角色：驱动手臂、腰、胸、头的关节 = 站姿 + 动作姿态 + 防御 / 受击 */
  private applyRigPose(): void {
    const p = this.pose;
    const a = this.act.pose;
    for (const j of Object.values(this.rest)) {
      j.joint.rotation.set(j.x + (a[j.keys[0]] ?? 0), j.y + (a[j.keys[1]] ?? 0), j.z + (a[j.keys[2]] ?? 0));
    }
    const add = (name: string, dx: number): void => {
      this.rest[name]!.joint.rotation.x += dx;
    };
    // 防御：双臂护在身前
    if (p.guard > 0) {
      add('shoulderR', -0.5 * p.guard);
      add('elbowR', -0.9 * p.guard);
      add('shoulderL', -0.9 * p.guard);
      add('elbowL', -1.3 * p.guard);
    }
    if (p.lean !== 0 || p.guard > 0) {
      add('chest', -0.25 * p.lean);
      add('head', 0.3 * p.lean - 0.1 * p.guard);
    }
  }

  /** 人形骨架之外的关节（宝宝的头、颈、下颌、腿、翅、臂 …）：待机已经摆好，这里把动作姿态和步态加上去 */
  private applyExtraJoints(): void {
    const a = this.act.pose;
    const gj = this.act.gaitJoints;
    for (const e of this.extras) {
      const dx = (a[e.keys[0]] ?? 0) + (gj[e.keys[0]] ?? 0);
      const dy = a[e.keys[1]] ?? 0;
      const dz = a[e.keys[2]] ?? 0;
      if (dx !== 0) e.joint.rotation.x += dx;
      if (dy !== 0) e.joint.rotation.y += dy;
      if (dz !== 0) e.joint.rotation.z += dz;
    }
  }

  /**
   * 武器相对手的姿态：握持角度 + 动作姿态里的附加转动；
   * weapon.aim > 0 时把武器尖端拧向正前方（突刺时枪 / 剑始终指向目标，不管手臂怎么摆）。
   */
  private applyWeaponPose(): void {
    const w = this.weapon;
    if (!w) return;
    const a = this.act.pose;
    const r = this.weaponRest;
    let x = r.x + (a['weapon.x'] ?? 0);
    if (this.weaponLeft) {
      // 弓要保持竖直：手臂抬起多少，武器就反向转回多少（都绕 x 轴，可以直接相加）
      const guard = this.pose.guard;
      x -= (a['shoulderL.x'] ?? 0) + (a['elbowL.x'] ?? 0) - 2.2 * guard;
    }
    w.rotation.set(x, r.y + (a['weapon.y'] ?? 0), r.z + (a['weapon.z'] ?? 0));
    const aim = a['weapon.aim'] ?? 0;
    if (aim <= 0 || !w.parent) return;
    // 目标姿态（世界坐标）：武器 +y（尖端）指向正前方并按 aimPitch 上扬，+z（刃口）朝下
    const yaw = this.act.yaw + (a['weapon.aimYaw'] ?? 0);
    const up = a['weapon.aimPitch'] ?? 0;
    const tip = this.tmp.set(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up));
    const edge = this.tmp2.set(0, -1, 0).addScaledVector(tip, tip.y).normalize();
    const sideways = this.tmp3.crossVectors(tip, edge);
    this.basis.makeBasis(sideways, tip, edge);
    const want = this.quat.setFromRotationMatrix(this.basis);
    w.parent.updateWorldMatrix(true, false);
    const parent = w.parent.getWorldQuaternion(this.quat2);
    want.premultiply(parent.invert());
    w.quaternion.slerp(want, Math.min(1, aim));
  }
}

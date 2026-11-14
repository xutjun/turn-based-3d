// 场上一个单位的表现：站位、朝向、程序化动作（待机、冲锋、出手、受击、倒地、复活）。
// 实现 director/types.ts 里的 StageUnit 接口，所有动作都通过 Scheduler 播放。
//
// 做法：每个动作只改几个“姿态参数”（前倾、抬手、倒地程度、闪白 …），
// 每帧由 applyPose() 把这些参数换算成模型根节点和骨架关节的位置、旋转。
// 人形角色额外驱动手臂关节；非人形的宝宝只用整体的前扑、后仰、起伏。

import { Color, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { getRig, type HumanoidRig } from '../../assets/models/characters/rig';
import { getEquippedWeapon, getWeaponGlow, getWeaponHold, setBowArrowVisible } from '../../assets/models/weapons';
import { GLOW_BASE_KEY } from '../../assets/materials';
import type { UnitTemplate } from '../../core/types';
import { facingOf, facingYawOf, slotPosition } from '../../data/formation';
import { STAGING } from '../../data/presentationConfig';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { AnchorName, AttackStyle, GroundPoint, Point3, StageUnit } from '../director/types';

const HP_ANCHOR = 'hpAnchor';
const FLASH_COLOR = new Color(0xffffff);

/** 姿态参数：全部为 0 时就是自然站姿 */
interface Pose {
  windup: number; // 蓄力程度 0~1
  strike: number; // 出手程度 0~1
  style: AttackStyle;
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

  constructor(
    template: UnitTemplate,
    readonly model: Object3D,
    private readonly scheduler: Scheduler,
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
    model.rotation.set(0, facingYawOf(template.side), 0);

    this.hpAnchor = model.getObjectByName(HP_ANCHOR);
    this.height = (this.hpAnchor ? this.hpAnchor.position.y : 1.8) * this.baseScale;

    this.rig = getRig(model);
    if (this.rig) {
      const r = this.rig;
      const joints: Record<string, Object3D> = {
        shoulderR: r.armR.shoulder,
        elbowR: r.armR.elbow,
        shoulderL: r.armL.shoulder,
        elbowL: r.armL.elbow,
        spine: r.spine,
        chest: r.chest,
        head: r.head,
      };
      for (const [name, joint] of Object.entries(joints)) {
        this.rest[name] = { joint, x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z };
      }
    }
    this.weapon = getEquippedWeapon(model);
    this.weaponRestX = this.weapon?.rotation.x ?? 0;

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

  moveTo(point: GroundPoint, duration: number): Promise<void> {
    this.away = true;
    return this.slide(point, duration);
  }

  async returnHome(duration: number): Promise<void> {
    await this.slide(this.home, duration);
    this.away = false;
  }

  private slide(to: GroundPoint, duration: number): Promise<void> {
    const from = { ...this.ground };
    return this.scheduler.tween(duration, (t) => {
      const k = EASE.inOut(t);
      this.ground.x = from.x + (to.x - from.x) * k;
      this.ground.z = from.z + (to.z - from.z) * k;
      this.pose.hop = Math.sin(Math.PI * t) * STAGING.runHopHeight;
    });
  }

  windup(style: AttackStyle, duration: number): Promise<void> {
    this.pose.style = style;
    this.pose.strike = 0;
    if (style === 'bow' && this.weapon) setBowArrowVisible(this.weapon, true);
    return this.scheduler.tween(duration, (t) => (this.pose.windup = t), EASE.out);
  }

  release(style: AttackStyle, duration: number): Promise<void> {
    this.pose.style = style;
    if (this.weapon) {
      // 出手瞬间武器光芒增强
      getWeaponGlow(this.weapon)?.flare();
      if (style === 'bow') setBowArrowVisible(this.weapon, false);
    }
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
    return this.scheduler.tween(duration, (t) => {
      const k = EASE.arc(t);
      this.pose.lean = amount * k;
      this.pose.flash = Math.max(0, 1 - t * 2.2); // 闪白只在前半段
    });
  }

  dodge(duration: number): Promise<void> {
    return this.scheduler.tween(duration, (t) => (this.pose.side = EASE.arc(t) * 0.28));
  }

  async die(vanish: boolean, fallDuration: number, vanishDuration: number): Promise<void> {
    this.dead = true;
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
    this.dead = false;
    this.away = false;
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

  // ------------------------------------------------------------------
  // 每帧
  // ------------------------------------------------------------------

  /** 每帧调用：把姿态参数应用到模型上（time 为调度器的演出时间） */
  update(time: number): void {
    this.applyPose(time);
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
    if (p.style === 'melee') {
      forward = (-0.12 * p.windup + 0.42 * p.strike) * lungeScale;
      pitch = (-0.12 * p.windup + 0.3 * p.strike) * lungeScale;
    } else if (p.style === 'bow') {
      forward = -0.05 * p.windup + 0.05 * p.strike;
      pitch = -0.05 * p.windup;
    } else {
      lift = (0.1 * p.windup + 0.05 * p.strike) * (this.rig ? 0.4 : 1);
      pitch = -0.1 * p.windup + 0.18 * p.strike;
    }
    forward -= 0.12 * p.lean; // 受击时略微后退
    forward -= 0.06 * p.guard;

    const fx = this.facing.x;
    const fz = this.facing.z;
    // 侧移方向：朝向的垂直方向
    const s = this.baseScale;
    m.position.set(
      this.ground.x + fx * forward * s - fz * p.side * s,
      p.hop + lift * s + bob,
      this.ground.z + fz * forward * s + fx * p.side * s,
    );
    // 前倾为正；受击后仰、倒地向后躺平
    m.rotation.x = pitch - p.lean - 0.08 * p.guard - (Math.PI / 2) * EASE.in(p.fall);
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
    if (p.style === 'melee') {
      // 举过头顶 → 向前下方劈下
      shoulderR = -1.9 * p.windup + 1.6 * p.strike;
      elbowR = -0.5 * p.windup + 0.9 * p.strike;
      twist = -0.35 * p.windup + 0.6 * p.strike;
    } else if (p.style === 'bow') {
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

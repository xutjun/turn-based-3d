// 场上一个单位的表现：站位、朝向、程序化动作（待机、冲锋、出手、受击、倒地、复活）。
// 实现 director/types.ts 里的 StageUnit 接口，所有动作都通过 Scheduler 播放。
//
// 做法：
//   - 出手（冲刺、预备、发力、顿住、余势、收招）的状态在 UnitMotion 里计算（纯计算，可单元测试）：
//     当前位置、朝向、相对站姿的“动作姿态”（各关节和整体的偏移量，关键姿态在 data/attackAnimConfig.ts）；
//   - 受击、闪避、倒地、防御仍是这里的几个“姿态参数”；
//   - 每帧由 applyPose() 把两者叠加，换算成模型根节点和各关节的位置、旋转，最后再叠加待机偏移。

import { Color, Matrix4, Quaternion, Vector3, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D, type PointLight } from 'three';
import { getRig, type HumanoidRig } from '../../assets/models/characters/rig';
import { bowStringDepth, getEquippedWeapon, getWeaponGlow, getWeaponHold, setBowArrowVisible, setBowDraw } from '../../assets/models/weapons';
import { GLOW_BASE_KEY } from '../../assets/materials';
import type { UnitTemplate } from '../../core/types';
import type { SoundPlayer } from '../../assets/audio/SoundEngine';
import type { SoundName } from '../../data/audioConfig';
import { animatedJointsOf, extraJointsOf } from './animatedJoints';
import { forwardLeg, legAngles, restFoot, type FootTarget, type LegDims } from './legPose';
import { WalkGait } from './walkGait';
import { EXPLORE_CONFIG, LEG_PLANT, WALK_GAIT } from '../../data/exploreConfig';
import { ATTACK_ANIM, LEFT_GRIP, MOTION_OF_TEMPLATE, MOTION_PROFILES, MOUNTED_STAFF, SECONDARY_MOTION, moveOf, type MotionId } from '../../data/attackAnimConfig';
import { solveArmIK } from './armIK';
import { IdleAnimator, type LegReach } from './IdleAnimator';
import { UnitMotion, type Footfall, type MotionPhase } from './UnitMotion';
import { pathDetour, type DetourObstacle } from './detour';
import { seedOf } from './idleMotion';
import { IDLE_CONFIG } from '../../data/idleConfig';
import type { EmotePose } from '../../data/dialogues';
import { UNIT_MODELS } from '../../data/unitModels';
import { releaseSound, windupSound } from './soundCues';
import { facingOf, facingYawOf, slotPosition } from '../../data/formation';
import { ELEMENT_COLORS, FX_CONFIG, STAGING } from '../../data/presentationConfig';
import { createChainBand, type FxSystem, type TrailHandle } from '../fx/FxSystem';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { AnchorName, AttackStyle, GroundPoint, MoveOptions, Point3, StageUnit } from '../director/types';

const HP_ANCHOR = 'hpAnchor';
const FLASH_COLOR = new Color(0xffffff);
/** 悬停高亮的轮边光颜色（临时对象，每次按配置写入） */
const HOVER_COLOR = new Color();

/** 进攻动画的全局开关（低画质时关掉次级运动），所有单位共用 */
export const ATTACK_RUNTIME = {
  secondary: true, // 披风、袍摆、链条、尾巴的惯性甩动
};

/**
 * 过场的特技层（步骤 17，入场过场）：被震飞时的离地高度、空中翻滚、落地下蹲，Boss 跺地抬腿等。
 * 由过场的时间轴直接写入（场景调度器的补间），全部为 0 / 空时与没有这一层完全一样；战斗中不使用。
 */
export interface StuntLayer {
  /** 根节点离地高度（米，世界坐标）：腾空为正，落地下蹲为负（人形的膝盖由 IK 弯曲，脚留在地上） */
  y: number;
  /** 绕身体中心的俯仰（弧度，前倾为正，向后翻滚为负）：转轴在离地 height × pivot 处 */
  pitch: number;
  roll: number;
  /** 身体相对当前朝向的附加转角（弧度） */
  spin: number;
  pivot: number;
  /** 叠加在动作姿态上的关节偏移（与进攻动作同一套通道名） */
  pose: Record<string, number>;
}

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

  /**
   * 模型上的点光源（发光武器的光，步骤 17）：搬到场景级的分组里（detachLights），每帧跟随原来的挂点；
   * 单位隐藏时亮度为 0 而不是把光源移出场景——场景里的光源数量恒定，显示 / 隐藏单位时不会让所有材质重新编译着色器。
   */
  private readonly lights: { light: PointLight; parent: Object3D; local: Vector3 }[] = [];
  private lightsDetached = false;

  /** 把模型上的点光源搬到 group 里（BattleStage 建好时调用一次） */
  detachLights(group: Object3D): void {
    if (this.lightsDetached) return;
    this.lightsDetached = true;
    const found: PointLight[] = [];
    this.model.traverse((o) => {
      if ((o as PointLight).isPointLight) found.push(o as PointLight);
    });
    for (const light of found) {
      const parent = light.parent;
      if (!parent) continue;
      this.lights.push({ light, parent, local: light.position.clone() });
      parent.remove(light);
      group.add(light);
    }
    this.syncLights();
  }

  /** 光源跟随挂点；单位隐藏时熄灭（亮度每帧由武器的发光控制器重新写入） */
  private syncLights(): void {
    if (this.lights.length === 0) return;
    const shown = this.model.visible;
    for (const l of this.lights) {
      if (!shown) {
        l.light.intensity = 0;
        continue;
      }
      l.parent.updateWorldMatrix(true, false);
      l.light.position.copy(l.local).applyMatrix4(l.parent.matrixWorld);
    }
  }

  /** 模板编号（过场按它选宝宝的入场方式） */
  get templateKey(): string {
    return this.templateId;
  }

  /** 动作档案：用哪一套进攻动作 */
  readonly motion: MotionId;
  /**
   * 冲锋时要绕开的己方单位（步骤 17）：由 BattleStage 接上（同一方、站在格子上、看得见的其他单位）；默认没有。
   */
  obstacleSource: () => readonly DetourObstacle[] = () => [];

  /** 身高（米，含缩放）：别人冲锋时判断能不能从头顶越过 */
  get bodyHeight(): number {
    return this.height;
  }

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
  /**
   * 基准姿态（步骤 11b）：建模时所有会动的关节的站姿转角。每帧开头先把它们全部写回基准，
   * 再叠加待机、出手、受击；任何一层只做“加法”也不会跨帧累积（旧 bug：狼的腿每帧被累加，跳回后四脚朝天）。
   */
  private readonly basePose: { joint: Object3D; x: number; y: number; z: number }[] = [];
  private readonly tail: Object3D | undefined;
  private readonly muzzleJoint: Object3D | undefined;
  private readonly weapon: Object3D | undefined;
  private readonly weaponRest = { x: 0, y: 0, z: 0 };
  private readonly weaponLeft: boolean;
  /** 手里的弓（可以拉弦时）：弓弦到握把的距离 */
  private readonly bow: { depth: number } | undefined;
  private readonly hpAnchor: Object3D | undefined;
  private readonly flashMaterials: MeshStandardMaterial[] = [];
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly tmp3 = new Vector3();
  private readonly tmp4 = new Vector3();
  private readonly quat = new Quaternion();
  private readonly quat2 = new Quaternion();
  private readonly basis = new Matrix4();
  private dead = false;
  /** 原始朝向（面向对方）；当前朝向在 act.yaw，只有近战冲锋途中两者不同 */
  private readonly baseYaw: number;
  readonly fxColor: number;
  private readonly weaponColors: { color: number; accentColor: number } | undefined;
  private readonly trailSpan: readonly [number, number];
  /** 右手的“杖”：装备的武器，或长在模型上的法杖（右手武器挂点）；左手握杖、杖顶光芒、拖尾用 */
  private readonly staff: { holder: Object3D; grip: number; tip: number; trail: readonly [number, number] } | undefined;
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
  /**
   * 腿（步骤 14，只有会走路的人形有）：骨架尺寸、行走步态、站姿的踝关节目标。
   * 每帧由 IK 求髋、膝、踝的转角：走路时脚按步态落地、抬起；站着时身体下沉就屈膝，脚留在地面上；腾空时收腿。
   */
  private readonly legs: { dims: LegDims; walk: WalkGait; rest: FootTarget; ankleX: { L: number; R: number } } | undefined;
  /** 腿伸到哪里：左 / 右膝、左 / 右踝相对髋关节的位置（身体坐标）；袍摆被腿顶开用 */
  private readonly legReach: LegReach = {
    kneeL: { z: 0, depth: 0 },
    kneeR: { z: 0, depth: 0 },
    footL: { z: 0, depth: 0 },
    footR: { z: 0, depth: 0 },
  };
  /** 探索模式里这一帧走过的距离（世界坐标，米），update 时交给步态 */
  private pendingWalk = 0;
  /**
   * 说话动作（步骤 16，对话中骑士举刀指向 Boss、Boss 仰头张翼狂笑）：一层叠加在动作姿态上的关节偏移，
   * 按权重淡入淡出（场景时间，暂停时停住）。不经过 UnitMotion，战斗的出手 / 受击状态不受影响。
   */
  private gesture: EmotePose | null = null;
  private gestureTarget = 0;
  private gestureWeight = 0;
  private gestureTime = 0;
  /** 这一帧实际使用的动作姿态：没有说话动作时就是 act.pose，有时是两者之和（复用同一个对象） */
  private livePose: Record<string, number>;
  private readonly mixPose: Record<string, number> = {};
  /** 过场的特技层（步骤 17）：过场时间轴直接改这里的数值，结束时 clearStunt() */
  readonly stunt: StuntLayer = { y: 0, pitch: 0, roll: 0, spin: 0, pivot: 0.5, pose: {} };

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
    for (const joint of [...Object.values(this.rest).map((r) => r.joint), ...this.extras.map((e) => e.joint)]) {
      this.basePose.push({ joint, x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z });
    }
    this.tail = this.rig ? undefined : extra['tail'];
    // 动作档案：人物按武器，其余按模板；没指定的人形用刀的动作，非人形用通用的扑击
    this.motion = template.weaponId ?? MOTION_OF_TEMPLATE[template.templateId] ?? (this.rig ? 'blade' : 'beast');
    const muzzle = MOTION_PROFILES[this.motion].muzzle;
    this.muzzleJoint = muzzle?.joint ? extra[muzzle.joint] : undefined;
    this.act = new UnitMotion(scheduler, this.home, this.baseYaw, this.motion, (f) => this.footfall(f));
    this.act.avoid = (from, to, samples) => {
      const others = this.obstacleSource();
      return others.length > 0 ? pathDetour(from, to, others, this.radius * 0.8, samples) : null;
    };
    this.livePose = this.act.pose;
    this.weapon = getEquippedWeapon(model);
    if (this.weapon) {
      this.weaponRest.x = this.weapon.rotation.x;
      this.weaponRest.y = this.weapon.rotation.y;
      this.weaponRest.z = this.weapon.rotation.z;
    }
    this.weaponLeft = this.weapon !== undefined && getWeaponHold(this.weapon)?.hand === 'left';
    const depth = this.weapon ? bowStringDepth(this.weapon) : undefined;
    this.bow = depth === undefined ? undefined : { depth };
    const glow = this.weapon ? getWeaponGlow(this.weapon) : undefined;
    this.weaponColors = glow?.currentColors;
    this.fxColor = this.weaponColors?.color ?? FX_CONFIG.sideColor[template.side];
    this.trailSpan = (template.weaponId && FX_CONFIG.trailSpan[template.weaponId]) || [0, 0];
    const mounted = MOUNTED_STAFF[template.templateId];
    if (this.weapon && !this.weaponLeft && template.weaponId) {
      this.staff = { holder: this.weapon, grip: LEFT_GRIP.weapon[template.weaponId] ?? 0.3, tip: this.trailSpan[1], trail: this.trailSpan };
    } else if (!this.weapon && mounted && this.rig) {
      this.staff = { holder: this.rig.weaponMount, grip: LEFT_GRIP.mount, tip: mounted.tip, trail: mounted.trail };
    }

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

    if (this.rig?.legsAnimated) {
      const r = this.rig;
      const dims: LegDims = { hipHeight: r.hips.position.y, thigh: r.legL.knee.position.length(), shin: r.legL.foot.position.length() };
      const heldLeft = this.weapon !== undefined && this.weaponLeft;
      const heldRight = this.weapon !== undefined && !this.weaponLeft;
      // 站姿时左右踝关节离身体中线多远（髋的横向位置 + 外张角带出去的距离）；身体侧倾时据此修正脚的高度
      const legLen = dims.thigh + dims.shin;
      const ankleX = (leg: typeof r.legL): number => leg.hip.position.x + legLen * Math.sin(leg.hip.rotation.z);
      this.legs = { dims, walk: new WalkGait(dims, { heldLeft, heldRight }), rest: restFoot(dims), ankleX: { L: ankleX(r.legL), R: ankleX(r.legR) } };
    }

    this.idle = new IdleAnimator(model, UNIT_MODELS[template.templateId]?.idle ?? 'stiff', seedOf(template.id));
    this.restoreBase();
    this.idle.update(0, 1);
    this.applyPose();
  }

  /** 把所有会动的关节写回基准姿态（每帧最先调用；之后各层在此基础上叠加） */
  private restoreBase(): void {
    for (const b of this.basePose) b.joint.rotation.set(b.x, b.y, b.z);
  }

  /**
   * 调试 / 测试：当前是否处于防御姿态（防御到回合结束才解除，姿态复位检查要排除它）。
   */
  get guarding(): boolean {
    return this.pose.guard > 0;
  }

  /** 当前离地高度（米）：跳跃途中大于 0；联系表取景用 */
  get airHeight(): number {
    return this.act.gait.hop;
  }

  /** 调试 / 测试：倒地程度（0 = 站着）；存活单位必须为 0 */
  get fallen(): number {
    return this.pose.fall;
  }

  // ------------------------------------------------------------------
  // 探索模式（步骤 14）：位置和朝向由探索逻辑决定，单位自己按走过的距离迈步
  // ------------------------------------------------------------------

  /** 会不会走路（有腿部关节） */
  get canWalk(): boolean {
    return this.legs !== undefined;
  }

  /** 行走权重 0~1（调试 / 测试；没有腿的单位恒为 0） */
  get walkWeight(): number {
    return this.legs?.walk.weight ?? 0;
  }

  /** 步态相位（调试 / 联系表；没有腿的单位恒为 0） */
  get walkPhase(): number {
    return this.legs?.walk.phase ?? 0;
  }

  /** 当前地面位置与朝向（探索模式读取） */
  get groundPosition(): { x: number; z: number; yaw: number } {
    return { x: this.act.ground.x, z: this.act.ground.z, yaw: this.act.yaw };
  }

  /**
   * 移动到地面上的某点、面朝 yaw（探索模式每帧调用）。走过的距离交给步态，下一次 update 时迈步。
   * 不改变“离开站位”（away）的判定：那只用于战斗。
   */
  locomote(x: number, z: number, yaw: number): void {
    const g = this.act.ground;
    this.pendingWalk += Math.hypot(x - g.x, z - g.z);
    g.x = x;
    g.z = z;
    this.act.yaw = yaw;
  }

  /** 立即放到某点（不走过去，不迈步）：列队、回到起点时用 */
  placeAt(x: number, z: number, yaw: number): void {
    this.act.ground.x = x;
    this.act.ground.z = z;
    this.act.yaw = yaw;
    this.pendingWalk = 0;
    this.legs?.walk.reset();
  }

  // ------------------------------------------------------------------
  // 说话动作（步骤 16）
  // ------------------------------------------------------------------

  /**
   * 开始 / 结束说话动作：传入姿态则淡入并保持（换一个姿态时从当前权重接着淡入新的），传 null 淡出。
   * 淡入淡出时长见 EXPLORE_CONFIG.dialog.gestureFade。
   */
  setGesture(pose: EmotePose | null): void {
    if (pose) {
      if (pose !== this.gesture) this.gestureTime = 0;
      this.gesture = pose;
      this.gestureTarget = 1;
    } else {
      this.gestureTarget = 0;
    }
  }

  /** 说话动作的权重 0~1（调试 / 测试） */
  get gestureLevel(): number {
    return this.gestureWeight;
  }

  /** 身体有没有处在过场的特技里（待机让位、腿不踩地的判断用） */
  get stuntActive(): boolean {
    const t = this.stunt;
    return t.y !== 0 || t.pitch !== 0 || t.roll !== 0 || t.spin !== 0 || Object.keys(t.pose).length > 0;
  }

  /** 清掉过场的特技层（过场结束、重置时） */
  clearStunt(): void {
    const t = this.stunt;
    t.y = t.pitch = t.roll = t.spin = 0;
    t.pivot = 0.5;
    for (const k of Object.keys(t.pose)) delete t.pose[k];
  }

  /** 离地高度（米）：过场中被震飞、跳入时用（头顶条、联系表取景） */
  get stuntHeight(): number {
    return this.stunt.y;
  }

  private updateGesture(dt: number): void {
    this.updateGestureWeight(dt);
    // 过场的特技姿态叠加在最上面
    const stunt = this.stunt.pose;
    let any = false;
    for (const _ in stunt) {
      any = true;
      break;
    }
    if (!any) return;
    if (this.livePose === this.act.pose) {
      const mix = this.mixPose;
      for (const k of Object.keys(mix)) delete mix[k];
      Object.assign(mix, this.act.pose);
      this.livePose = mix;
    }
    const mix = this.livePose;
    for (const [k, v] of Object.entries(stunt)) mix[k] = (mix[k] ?? 0) + v;
  }

  private updateGestureWeight(dt: number): void {
    const g = this.gesture;
    if (!g) {
      this.livePose = this.act.pose;
      return;
    }
    const step = dt / Math.max(1e-3, EXPLORE_CONFIG.dialog.gestureFade);
    const d = this.gestureTarget - this.gestureWeight;
    this.gestureWeight = Math.abs(d) <= step ? this.gestureTarget : this.gestureWeight + Math.sign(d) * step;
    this.gestureTime += dt;
    if (this.gestureWeight <= 0 && this.gestureTarget === 0) {
      this.gesture = null;
      this.livePose = this.act.pose;
      return;
    }
    // 平滑的权重曲线（起止没有突变）
    const t = this.gestureWeight;
    const w = t * t * (3 - 2 * t);
    const mix = this.mixPose;
    for (const k of Object.keys(mix)) delete mix[k];
    Object.assign(mix, this.act.pose);
    for (const [k, v] of Object.entries(g.pose)) mix[k] = (mix[k] ?? 0) + v * w;
    if (g.wobble) {
      const s = Math.sin(2 * Math.PI * g.wobble.hz * this.gestureTime) * w;
      for (const [k, v] of Object.entries(g.wobble.pose)) mix[k] = (mix[k] ?? 0) + v * s;
    }
    this.livePose = mix;
  }

  // ------------------------------------------------------------------
  // 悬停高亮（步骤 15）：探索中鼠标指着 Boss 时，轮边光换成暗金色并加强（等效于轮廓高亮，不新增网格）
  // ------------------------------------------------------------------

  /** 打开 / 关闭高亮（淡入淡出，时长见 EXPLORE_CONFIG.bossHover.fade） */
  setHighlight(on: boolean): void {
    this.highlightTarget = on ? 1 : 0;
  }

  /** 当前高亮程度 0~1（调试 / 测试） */
  get highlight(): number {
    return this.highlightLevel;
  }

  private highlightTarget = 0;
  private highlightLevel = 0;
  /** 身体材质的轮边光（不含武器：武器的发光边由发光控制器每帧写），首次高亮时收集并记下原值 */
  private rimSlots: { u: { uRimColor: { value: Color }; uRimStrength: { value: number }; uRimPower: { value: number } }; color: Color; strength: number; power: number }[] | null = null;

  private updateHighlight(dt: number): void {
    if (this.highlightLevel === this.highlightTarget) return;
    const c = EXPLORE_CONFIG.bossHover;
    const step = dt > 0 ? dt / Math.max(1e-3, c.fade) : 1;
    const d = this.highlightTarget - this.highlightLevel;
    this.highlightLevel = Math.abs(d) <= step ? this.highlightTarget : this.highlightLevel + Math.sign(d) * step;
    this.applyHighlight();
  }

  private applyHighlight(): void {
    if (!this.rimSlots) {
      if (this.highlightLevel === 0) return;
      this.rimSlots = [];
      const weapon = this.weapon;
      const seen = new Set<object>();
      this.model.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        // 武器上的材质跳过
        for (let p: Object3D | null = o; p; p = p.parent) if (p === weapon) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const u = (m as MeshStandardMaterial).userData?.['rimUniforms'];
          if (!u || seen.has(u)) continue;
          seen.add(u);
          this.rimSlots!.push({ u, color: u.uRimColor.value.clone(), strength: u.uRimStrength.value, power: u.uRimPower.value });
        }
      });
    }
    const c = EXPLORE_CONFIG.bossHover;
    const h = this.highlightLevel * this.highlightLevel * (3 - 2 * this.highlightLevel);
    for (const s of this.rimSlots) {
      s.u.uRimColor.value.copy(s.color).lerp(HOVER_COLOR.setHex(c.color), h);
      s.u.uRimStrength.value = s.strength + (c.strength - s.strength) * h;
      s.u.uRimPower.value = s.power + (c.power - s.power) * h;
    }
  }

  // ------------------------------------------------------------------
  // StageUnit
  // ------------------------------------------------------------------

  anchor(name: AnchorName): Point3 {
    if (name === 'weapon' && this.staff && (this.motion === 'staff' || !this.weapon)) {
      // 法杖：杖顶（光弹、锁链从这里射出）
      const h = this.staff.holder;
      h.updateWorldMatrix(true, false);
      const p = this.tmp.set(0, this.staff.tip, 0).applyMatrix4(h.matrixWorld);
      return { x: p.x, y: p.y, z: p.z };
    }
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
    return out.set(this.ground.x, this.height * (1 - 0.55 * this.pose.fall) + this.act.gait.hop + this.stunt.y, this.ground.z);
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
    this.pendingWalk = 0;
    this.legs?.walk.reset();
    this.gesture = null;
    this.gestureTarget = this.gestureWeight = this.gestureTime = 0;
    this.livePose = this.act.pose;
    this.highlightTarget = this.highlightLevel = 0;
    this.applyHighlight();
    this.clearStunt();
    this.restoreBase();
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
    if (!this.weapon && this.staff) {
      // 长在模型上的法杖：沿右手武器挂点取样
      const h = this.staff.holder;
      h.updateWorldMatrix(true, false);
      base.set(0, this.staff.trail[0], 0).applyMatrix4(h.matrixWorld);
      tip.set(0, this.staff.trail[1], 0).applyMatrix4(h.matrixWorld);
      base.lerpVectors(tip, base, FX_CONFIG.trailWidth);
      return;
    }
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
    this.updateHighlight(dt);
    this.updateGesture(dt);
    // 行走：这一帧走过的距离（换成模型坐标）推进步态相位
    if (this.legs) {
      if (dt > 0) {
        this.legs.walk.advance(this.pendingWalk / this.baseScale, dt);
        this.pendingWalk = 0;
      }
    }
    // 待机权重：有出手 / 受击 / 冲锋动作时目标为 0，否则为 1；按固定速率平滑靠近，切换没有跳变
    // 走路时待机让位（只留一点呼吸）
    const p = this.pose;
    const walking = (this.legs?.walk.weight ?? 0) * 0.85;
    const busy = Math.min(1, Math.max(this.act.busy || this.stuntActive ? 1 : 0, p.lean * 3, p.side * 4, walking, this.gestureWeight * 0.6));
    const target = (1 - busy) * (1 - (1 - IDLE_CONFIG.guardScale) * p.guard);
    this.idleWeight += (target - this.idleWeight) * (1 - Math.exp(-IDLE_CONFIG.blendRate * dt));
    // 倒地后只保留极轻微的变化；消失的单位不动
    const down = (1 - (1 - IDLE_CONFIG.fallenScale) * p.fall) * (1 - p.shrink);
    this.restoreBase();
    this.idle.update(idleTime, this.idleWeight * down);
    this.applyPose(time);
    this.updateSecondary();
    this.syncLights();
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
    const p = this.pose;
    // 身体还在动（出手、受击后仰、闪避、站起）时甩动照常；停下后由 UnitMotion 收尾归零
    // （后仰、闪避用正弦曲线，结束时是 1e-17 量级而不是精确的 0，所以用阈值判断）
    const walk = this.legs?.walk;
    const active = this.act.busy || Math.abs(p.lean) > 1e-4 || Math.abs(p.side) > 1e-4 || p.fall > 1e-4 || (walk?.active ?? false);
    this.act.updateSecondary(
      this.scheduler.delta,
      m.position.x - Math.sin(yaw) * back,
      m.position.y,
      m.position.z - Math.cos(yaw) * back,
      enabled,
      active,
      walk?.run ?? 0, // 跑起来披风、袍摆甩得更开（步骤 15）
    );
    const push = this.act.push;
    this.idle.setSecondary(push.x, push.y, push.z, this.act.flutter);
    // 袍摆、裙甲被腿顶开（步骤 14）：走路迈腿、下蹲屈膝时膝盖和脚往前后伸，布料跟着让开
    if (this.legs) this.idle.setLegReach(this.legReach, WALK_GAIT.robeClearance);
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
    const a = this.livePose;
    const g = this.act.gait;
    const ch = (c: string): number => a[c] ?? 0;
    // 待机：整体的起伏、漂浮、重心转移（都已乘过待机权重，出手和倒地时自然归零）
    const idle = this.idle.offsets;
    const bob = (idle.bob + idle.float) * this.baseScale;
    // 行走（步骤 14）：身体随步伐下沉起伏、前倾、左右换重心；不走时全部为 0
    const walk = this.legs?.walk.active ? this.legs.walk.sample() : null;

    // 出手：动作姿态里的整体位移和转动，加上冲刺 / 扑跃的步态层
    let forward = ch('root.forward');
    const pitch = ch('root.pitch') + g.pitch + (walk?.lean ?? 0);
    const lift = ch('root.lift') - (walk?.drop ?? 0);
    const roll = ch('root.roll') + g.roll + (walk?.roll ?? 0);
    const turn = ch('root.turn') + g.spin + this.stunt.spin;
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
    // 重心转移带起的一点点左右位移（厘米级，不算离开站位）
    // （p.side 为正是向右手侧；步态的 shift 为正是向左手侧）
    const side = p.side + idle.shift + ch('root.side') - (walk?.shift ?? 0);
    // 过场的翻滚绕身体中心转（不是绕脚底）：转动 θ 后把身体中心挪回原处
    const st = this.stunt;
    const pc = this.height * st.pivot;
    const pivotUp = st.pitch !== 0 ? pc * (1 - Math.cos(st.pitch)) : 0;
    const pivotFwd = st.pitch !== 0 ? -pc * Math.sin(st.pitch) : 0;
    m.position.set(
      this.ground.x + fx * forward * s - fz * side * s + fx * pivotFwd,
      g.hop + lift * s + bob + st.y + pivotUp,
      this.ground.z + fz * forward * s + fx * side * s + fz * pivotFwd,
    );
    // 前倾为正；受击后仰、倒地向后躺平
    m.rotation.x = pitch + st.pitch - p.lean - 0.08 * p.guard - (Math.PI / 2) * EASE.in(p.fall);
    m.rotation.z = roll + idle.roll + st.roll;
    // 整体形变：扑跃时沿前后方向拉长，落地 / 蓄力时压扁
    const k = this.baseScale * (1 - 0.97 * p.shrink);
    const stretch = ch('root.stretch');
    const squash = ch('root.squash') + g.squash; // 跳劈落地被压下去（步态层）叠加在姿态上
    if (stretch === 0 && squash === 0) m.scale.setScalar(k);
    else m.scale.set(k * (1 - 0.2 * stretch + 0.25 * squash), k * (1 - 0.3 * stretch - squash), k * (1 + stretch + 0.25 * squash));

    if (this.rig) {
      this.applyRigPose();
      this.idle.addToRig(); // 待机偏移加在出手 / 受击姿态之上
      if (walk) this.applyWalkUpperBody(walk);
      this.applyLegs(walk, bob);
    }
    this.applyExtraJoints();
    this.applyWeaponPose();
    this.applyLeftGrip();

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
    const a = this.livePose;
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

  /** 行走时的上半身（步骤 14）：双臂与对侧腿同步前后摆、腰随步伐扭转（已乘行走权重） */
  private applyWalkUpperBody(w: NonNullable<ReturnType<WalkGait['sample']>>): void {
    const add = (name: string, dx: number, dy = 0): void => {
      const j = this.rest[name]?.joint;
      if (!j) return;
      j.rotation.x += dx;
      j.rotation.y += dy;
    };
    add('shoulderL', w.shoulderL);
    add('shoulderR', w.shoulderR);
    add('elbowL', w.elbowL);
    add('elbowR', w.elbowR);
    add('spine', 0, w.twist);
    add('chest', 0, -w.twist * 0.4); // 胸口少转一点，肩膀的扭动更柔和
  }

  /**
   * 腿（步骤 14）：按踝关节目标用 IK 求髋、膝、踝的转角。
   *   - 走路时：目标来自步态（支撑脚原地不动、摆动脚抬起前送）；
   *   - 站着时：目标是脚下的地面——身体下沉（下蹲蓄力、落地缓冲、受击、待机呼吸）时屈膝，脚不陷进地里；
   *   - 腾空时：够不着地面，腿自然伸直，并按离地高度收腿；
   *   - 倒地 / 消失时：逐渐回到站姿（躺平的身体不再踩地）。
   * 必须在根节点的位置、转角、缩放都摆好之后调用。
   */
  private applyLegs(walk: ReturnType<WalkGait['sample']> | null, idleBob: number): void {
    const legs = this.legs;
    if (!legs) return;
    const m = this.model;
    const p = this.pose;
    // 过场中腾空（被震飞、翻滚）时腿不再找地面：回到站姿，由特技姿态收腿
    const air = this.stunt.y > 0 ? Math.min(1, this.stunt.y / 0.25) : 0;
    const plant = (1 - EASE.in(p.fall)) * (1 - p.shrink) * (1 - air);
    const reach = this.legReach;
    if (plant <= 0) {
      for (const k of [reach.kneeL, reach.kneeR, reach.footL, reach.footR]) k.z = 0;
      return; // 站姿已由 applyRigPose 写好
    }
    // 根节点在模型坐标里离地多高（缩放会把整个身体压扁 / 拉长，用竖直方向的缩放换算）
    const sy = Math.abs(m.scale.y) > 1e-6 ? m.scale.y : 1;
    // 待机呼吸带起的那几毫米不算（否则膝盖会跟着呼吸一弯一弯；原来就是整个人轻微起伏）
    const lift = (m.position.y - idleBob) / sy;
    const hop = this.act.gait.hop + Math.max(0, this.stunt.y);
    const tuck = hop > 0 ? LEG_PLANT.tuck * Math.min(1, hop / LEG_PLANT.tuckHeight) : 0;
    const pitch = m.rotation.x;
    // 行走：按“满权重”的身体（下沉、前倾都按满值）求步态的腿，再与站姿的腿按行走权重混合
    const w = walk ? legs.walk.weight : 0;
    const walkPitch = walk ? pitch - walk.lean + walk.leanFull : pitch;
    const walkLift = walk ? lift + walk.drop - walk.dropFull : lift;
    // 身体侧倾（绕根节点）会把一侧的脚抬起、另一侧压下：每条腿的“根节点高度”按自己的横向位置修正
    const sinRoll = Math.sin(m.rotation.z);
    const d = legs.dims;
    const solve = (foot: FootTarget | undefined, hip: string, knee: string, ankle: string, ankleX: number, out: { knee: LegReach['kneeL']; foot: LegReach['footL'] }): void => {
      const tilt = ankleX * sinRoll;
      const ang = legAngles(legs.dims, legs.rest, pitch, lift + tilt, tuck);
      if (foot && w > 0) {
        const step = legAngles(legs.dims, foot, walkPitch, walkLift + tilt, tuck);
        ang.hip += (step.hip - ang.hip) * w;
        ang.knee += (step.knee - ang.knee) * w;
        ang.foot += (step.foot - ang.foot) * w;
        ang.hipRoll += (step.hipRoll - ang.hipRoll) * w;
      }
      const h = this.rest[hip]!.joint;
      h.rotation.x += ang.hip * plant;
      h.rotation.z += ang.hipRoll * plant;
      this.rest[knee]!.joint.rotation.x += ang.knee * plant;
      this.rest[ankle]!.joint.rotation.x += ang.foot * plant;
      // 膝、踝相对髋关节的位置（袍摆被腿顶开用）
      const thighAng = -ang.hip * plant;
      out.knee.z = d.thigh * Math.sin(thighAng);
      out.knee.depth = (d.thigh * Math.cos(thighAng)) / d.hipHeight;
      const at = forwardLeg(d.thigh, d.shin, ang.hip * plant, ang.knee * plant);
      out.foot.z = at.dz;
      out.foot.depth = -at.dy / d.hipHeight;
    };
    solve(walk?.left, 'hipL', 'kneeL', 'footL', legs.ankleX.L, { knee: reach.kneeL, foot: reach.footL });
    solve(walk?.right, 'hipR', 'kneeR', 'footR', legs.ankleX.R, { knee: reach.kneeR, foot: reach.footR });
  }

  /** 人形骨架之外的关节（宝宝的头、颈、下颌、腿、翅、臂 …）：待机已经摆好，这里把动作姿态和步态加上去 */
  private applyExtraJoints(): void {
    const a = this.livePose;
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
    const a = this.livePose;
    const r = this.weaponRest;
    let x = r.x + (a['weapon.x'] ?? 0);
    if (this.weaponLeft) {
      // 弓要保持竖直：手臂抬起多少，武器就反向转回多少（都绕 x 轴，可以直接相加）
      const guard = this.pose.guard;
      x -= (a['shoulderL.x'] ?? 0) + (a['elbowL.x'] ?? 0) - 2.2 * guard;
      // 行走时左臂的摆动同样抵消掉（步骤 14）
      const walk = this.legs?.walk.active ? this.legs.walk.out : null;
      if (walk) x -= walk.shoulderL + walk.elbowL;
    }
    w.rotation.set(x, r.y + (a['weapon.y'] ?? 0), r.z + (a['weapon.z'] ?? 0));
    if (this.bow) {
      this.applyBowPose(w);
      return;
    }
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

  /**
   * 弓（步骤 11b）：
   *   bow.aim 0~1   把弓摆正：弓身竖直（略带 bow.cant 的倾角），弓背（箭的方向）指向朝向 + weapon.aimYaw、上扬 weapon.aimPitch；
   *   bow.draw −1~1 拉弦：0 = 未拉；> 0 时弦的中点向拉弦手（右手）靠拢，1 = 正好搭在手上（V 形，弓臂按拉开的距离弯曲）；
   *                 < 0 = 松弦后弦向前弹出的回弹（配合 outElastic 缓动来回振一下）。
   */
  private applyBowPose(w: Object3D): void {
    const a = this.livePose;
    const depth = this.bow?.depth ?? 0;
    const aim = a['bow.aim'] ?? 0;
    if (aim > 0 && w.parent) {
      const yaw = this.act.yaw + (a['weapon.aimYaw'] ?? 0);
      const up = a['weapon.aimPitch'] ?? 0;
      // 弓的 +z（箭的方向）指向目标，+y（上弓臂）竖直向上并垂直于箭；cant 让弓身绕箭轴略微倾斜
      const fwd = this.tmp.set(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up));
      const top = this.tmp2.set(0, 1, 0).addScaledVector(fwd, -fwd.y).normalize();
      const cant = a['bow.cant'] ?? 0;
      if (cant !== 0) top.applyAxisAngle(fwd, cant);
      const side = this.tmp3.crossVectors(top, fwd);
      this.basis.makeBasis(side, top, fwd);
      const want = this.quat.setFromRotationMatrix(this.basis);
      w.parent.updateWorldMatrix(true, false);
      want.premultiply(w.parent.getWorldQuaternion(this.quat2).invert());
      w.quaternion.slerp(want, Math.min(1, aim));
    }
    const draw = a['bow.draw'] ?? 0;
    if (draw === 0) {
      if (this.bowDrawn) setBowDraw(w, null, ATTACK_ANIM.bow.maxPull);
      this.bowDrawn = false;
      return;
    }
    this.bowDrawn = true;
    w.updateWorldMatrix(true, false);
    const rest = this.tmp2.set(0, 0, -depth);
    let nock: Vector3;
    if (draw > 0 && this.rig) {
      // 拉弦手在弓的局部坐标里的位置；弦的中点从原位向它靠拢
      const hand = this.rig.armR.hand;
      hand.updateWorldMatrix(true, false);
      const local = w.worldToLocal(hand.getWorldPosition(this.tmp));
      nock = rest.lerp(local, Math.min(1, draw));
    } else {
      // 松弦回弹：弦的中点向前弹过原位
      nock = rest.setZ(-depth - draw * ATTACK_ANIM.bow.snap);
    }
    setBowDraw(w, nock, ATTACK_ANIM.bow.maxPull);
  }

  private bowDrawn = false;

  /**
   * 双手握杖（步骤 11b）：grip.left 0~1 时，左手按两段骨骼 IK 握到右手武器的杖身上（LEFT_GRIP 处），
   * 按权重和原来的左臂姿态混合。在武器摆好之后调用，所以杖怎么挥，左手都跟着。
   */
  private applyLeftGrip(): void {
    const w = this.livePose['grip.left'] ?? 0;
    if (w <= 0 || !this.rig || !this.staff) return;
    const h = this.staff.holder;
    h.updateWorldMatrix(true, false);
    const target = this.tmp.set(0, this.staff.grip, 0).applyMatrix4(h.matrixWorld);
    // 默认握点够不着时（杖挥到了身体另一侧），左手沿杖身滑到离左肩最近、够得着的地方
    const arm = this.rig.armL;
    const shoulder = arm.shoulder.getWorldPosition(this.tmp2);
    const s = this.model.scale.y;
    const reach = (arm.elbow.position.length() + arm.hand.position.length()) * s * 0.97;
    if (shoulder.distanceTo(target) > reach) {
      const base = this.tmp3.set(0, 0, 0).applyMatrix4(h.matrixWorld);
      const dir = this.tmp4.set(0, 1, 0).transformDirection(h.matrixWorld);
      const scale = h.matrixWorld.getMaxScaleOnAxis();
      const [lo, hi] = ATTACK_ANIM.gripSlide;
      const along = Math.max((this.staff.grip + lo) * scale, Math.min((this.staff.grip + hi) * scale, shoulder.sub(base).dot(dir)));
      target.copy(base).addScaledVector(dir, along);
    }
    solveArmIK(arm, target, Math.min(1, w), 1);
  }
}

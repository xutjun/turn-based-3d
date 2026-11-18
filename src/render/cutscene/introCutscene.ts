// 入场过场（步骤 17，SPEC §14.3，DESIGN §11.4、§11.8）：选“我准备好了”之后自动播放。
//
//   a. 队员暗影显形：队长的影子向两侧铺开成两片暗影池，4 名队员从中升起、由半透明的暗紫幽影凝成实体，站到队长两侧；
//   b. Boss 怒吼：后仰、双翼张开、仰天咆哮，屏幕轻震，低频咆哮声；
//   c. Boss 跺地：抬右腿重重踏下，冲击波环匀速扩散，地面裂纹发光，尘土碎石飞溅，屏幕大幅震动；
//   d. 冲击波到达谁，谁就被震飞：沿各自的抛物线（explore/introPlan.ts 规划，不穿过火盆、石柱、Boss）
//      飞向战斗格子，空中翻滚或后仰，落地屈膝缓冲后起身、转向敌方；
//   e. 宝宝从主人身后进场：狼跃入、骨龙飞入、幽灵飘入、魔偶重重落地，就位后转向敌方；
//   f. 相机从对话视角平滑过渡到战斗视角；
//   g. （界面层）过场结束后开战，头顶条、顺序条、战斗界面淡入。
//
// 所有“等一会儿”和“在一段时间内变化”都走 Scheduler：倍速、跳过动画、暂停自动生效。
// 各条轨道彼此独立、只写自己负责的东西，跳过时以任何顺序完成都得到同一个结果；
// 最后 finish() 把所有单位交还战斗：回到格子、原朝向、站姿、全部显示（9 个小怪此时直接出现，召唤演出在步骤 18），
// 特效清空、相机回到战斗机位——与“直接开战”的开场状态完全一致。过场期间不产生任何战斗事件（引擎在过场结束后才建）。

import { INTRO_CONFIG, INTRO_POSES, type IntroConfig } from '../../data/cutsceneConfig';
import { CAMERA_CONFIG } from '../../data/renderConfig';
import { ROW_DIRECTION } from '../../data/formation';
import type { UnitId } from '../../core/types';
import type { SoundPlayer } from '../../assets/audio/SoundEngine';
import type { NavWorld } from '../../explore/exploreWorld';
import {
  flightAt,
  planFlights,
  planPetEntries,
  revealSpots,
  type FlightPlan,
  type Ground,
  type GroundPose,
  type PetEntry,
  type RevealSpot,
} from '../../explore/introPlan';
import { wrapAngle, yawOf } from '../../explore/walker';
import type { BattleCamera } from '../camera/battleCamera';
import type { CameraRig } from '../camera/CameraRig';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { FxSystem } from '../fx/FxSystem';
import type { BattleStage } from '../units/BattleStage';
import type { UnitView } from '../units/UnitView';
import type { IntroFx } from './introFx';
import { ShadeReveal, type ShadeLook } from './shadeReveal';

/** 相机取景（注视点 + 距离） */
export interface CameraFrame {
  x: number;
  y: number;
  z: number;
  distance: number;
}

/** 过场开始时的状态：队长在哪、朝哪，相机在哪 */
export interface IntroStart {
  leader: GroundPose;
  camera: CameraFrame;
}

/** 这一次过场的走位（调试 / 测试 / 联系表） */
export interface IntroPlan {
  reveal: RevealSpot[];
  flights: FlightPlan[];
  pets: PetEntry[];
  /** Boss 踏地的时刻（相对过场开始，1 倍速） */
  impactAt: number;
  /** 宝宝入场开始的时刻 */
  petsAt: number;
  /** 全部就位的时刻 */
  endAt: number;
}

/** 过场结束后的检查结果：每人的落点误差、有没有残留 */
export interface IntroReport {
  /** 落地瞬间离战斗格子的距离（米） */
  landing: Record<UnitId, number>;
  /** 结束时离格子的距离、朝向误差 */
  final: Record<UnitId, { dist: number; yaw: number; visible: boolean }>;
  skipped: boolean;
}

export interface IntroDeps {
  stage: BattleStage;
  scheduler: Scheduler;
  camera: BattleCamera;
  rig: CameraRig;
  fx: FxSystem;
  sound: SoundPlayer;
  introFx: IntroFx;
  world: NavWorld;
  leaderId: UnitId;
  bossId: UnitId;
  config?: IntroConfig;
}

const TAU = Math.PI * 2;
const smooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;

/** 把一组姿态按权重写进特技层（覆盖同名通道） */
function writePose(view: UnitView, pose: Readonly<Record<string, number>>, w: number): void {
  for (const [k, v] of Object.entries(pose)) view.stunt.pose[k] = v * w;
}

/** 两组姿态之间插值写进特技层 */
function blendPose(view: UnitView, a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>, t: number): void {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) view.stunt.pose[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t;
}

export class IntroCutscene {
  private readonly cfg: IntroConfig;
  private readonly shades = new Map<UnitId, ShadeReveal>();
  private playing = false;
  private planned: IntroPlan | null = null;
  private landing: Record<UnitId, number> = {};
  /** 调试 / 测试：上一次过场的检查结果 */
  lastReport: IntroReport | null = null;

  constructor(private readonly d: IntroDeps) {
    this.cfg = d.config ?? INTRO_CONFIG;
  }

  get active(): boolean {
    return this.playing;
  }

  get plan(): IntroPlan | null {
    return this.planned;
  }

  private view(id: UnitId): UnitView {
    return this.d.stage.unit(id);
  }

  private get allies(): UnitView[] {
    return [...this.d.stage.views.values()].filter((v) => v.side === 'ally');
  }

  private get heroes(): UnitView[] {
    return this.allies.filter((v) => v.kind === 'hero');
  }

  private get members(): UnitView[] {
    return this.heroes.filter((v) => v.id !== this.d.leaderId);
  }

  private get pets(): UnitView[] {
    return this.allies.filter((v) => v.kind === 'pet');
  }

  /** 列号的替代：格子沿排方向的投影（列号越大越靠 +排方向） */
  private colOf(v: UnitView): number {
    return v.home.x * ROW_DIRECTION.x + v.home.z * ROW_DIRECTION.z;
  }

  private shade(v: UnitView): ShadeReveal {
    let s = this.shades.get(v.id);
    if (!s) {
      s = new ShadeReveal(v.model);
      this.shades.set(v.id, s);
    }
    return s;
  }

  private get revealLook(): ShadeLook {
    const r = this.cfg.reveal;
    return { tint: r.tint, glow: r.glow, glowStrength: r.glowStrength };
  }

  /** 幽灵飘入时的冷色幽影 */
  private static readonly GHOST_LOOK: ShadeLook = { tint: 0x22344a, glow: 0x4f86c8, glowStrength: 0.8 };

  /**
   * 预热（启动时调用一次）：把显形要用的材质副本换上去，交给 compile 编译一次着色器，再换回原材质。
   * 这样第一次过场时不会因为编译着色器卡一下。
   */
  prewarm(compile: () => void): void {
    const touched: { v: UnitView; visible: boolean }[] = [];
    for (const v of [...this.members, ...this.pets.filter((p) => this.petStyle(p) === 'float')]) {
      touched.push({ v, visible: v.model.visible });
      v.model.visible = true;
      this.shade(v).engageForPrewarm(this.revealLook);
    }
    this.d.introFx.setPrewarm(true);
    try {
      compile();
    } finally {
      this.d.introFx.setPrewarm(false);
      this.d.introFx.clear();
      for (const { v, visible } of touched) {
        this.shade(v).restore();
        v.model.visible = visible;
      }
    }
  }

  private petStyle(v: UnitView): string {
    return this.cfg.pets.styles[v.templateKey] ?? 'leap';
  }

  /** 按过场开始时的状态算出全部走位 */
  makePlan(start: IntroStart): IntroPlan {
    const c = this.cfg;
    const boss = this.view(this.d.bossId).home;
    const reveal = revealSpots(
      start.leader,
      this.members.map((v) => ({ id: v.id, slot: { x: v.home.x, z: v.home.z } })),
      boss,
      this.d.world,
      c.reveal,
    );
    const starts = [{ id: this.d.leaderId, x: start.leader.x, z: start.leader.z }, ...reveal.map((s) => ({ id: s.id, x: s.x, z: s.z }))];
    const targets: Record<UnitId, Ground> = {};
    for (const v of this.heroes) targets[v.id] = { x: v.home.x, z: v.home.z };
    const flights = planFlights(starts, targets, boss, this.d.world.obstacles, c);
    const impactAt = c.stomp.at + c.stomp.lift + c.stomp.drop;
    const settle = c.flight.crouchDown + c.flight.crouchUp;
    const landedAt = flights.reduce((m, f) => Math.max(m, impactAt + f.launch + f.duration + settle), 0);
    const petsAt = landedAt + c.pets.after;
    const pets = planPetEntries(
      this.pets.map((v) => ({ id: v.id, templateId: v.templateKey, col: this.colOf(v), slot: { x: v.home.x, z: v.home.z } })),
      this.d.world.obstacles,
      c.pets,
    );
    const petsEnd = pets.reduce((m, e) => Math.max(m, e.start + e.duration), 0) + c.pets.turn;
    return { reveal, flights, pets, impactAt, petsAt, endAt: petsAt + petsEnd };
  }

  /**
   * 播放入场过场。结束（或被跳过）时所有单位已交还战斗：在格子上、面向敌方、全部显示，相机在战斗机位。
   */
  async play(start: IntroStart): Promise<IntroReport> {
    if (this.playing) throw new Error('入场过场已经在播放');
    this.playing = true;
    this.landing = {};
    const skippedAtStart = this.d.scheduler.skip;
    let skipped = skippedAtStart;
    try {
      const plan = this.makePlan(start);
      this.planned = plan;
      this.setup(start, plan);
      const s = this.d.scheduler;
      const c = this.cfg;
      const tracks: Promise<void>[] = [];
      const at = (time: number, fn: () => Promise<void> | void): void => {
        tracks.push(s.wait(time).then(fn));
      };
      at(0, () => this.reveal(plan));
      at(c.camera.at, () => this.cameraMove(start.camera));
      at(c.bossTurn.at, () => this.bossTurn(plan));
      at(c.roar.at, () => this.roar());
      at(c.stomp.at, () => this.stomp(plan));
      for (const f of plan.flights) at(plan.impactAt + f.launch, () => this.fly(f));
      at(plan.petsAt, () => this.petsIn(plan.pets));
      // 时间轴结束前途中打开了跳过：记下来（检查用）
      void s.wait(plan.endAt).then(() => (skipped = skipped || s.skip));
      await Promise.all(tracks);
      skipped = skipped || s.skip;
    } finally {
      this.finish();
      this.playing = false;
    }
    this.lastReport = { landing: { ...this.landing }, final: this.finalCheck(), skipped };
    return this.lastReport;
  }

  /** 开场布置：队长在原地，4 名队员埋在各自站位的地下（隐藏），宝宝和小怪隐藏，Boss 在原位 */
  private setup(start: IntroStart, plan: IntroPlan): void {
    for (const v of this.d.stage.views.values()) {
      v.clearStunt();
      v.setGesture(null);
      if (v.id === this.d.leaderId) {
        v.model.visible = true;
        v.placeAt(start.leader.x, start.leader.z, start.leader.yaw);
      } else if (v.id === this.d.bossId) {
        v.model.visible = true;
      } else {
        v.model.visible = false;
      }
    }
    for (const r of plan.reveal) {
      const v = this.view(r.id);
      v.placeAt(r.x, r.z, r.yaw);
      v.stunt.y = -this.cfg.reveal.sink;
    }
  }

  // ------------------------------------------------------------------
  // a. 队员暗影显形
  // ------------------------------------------------------------------

  private async reveal(plan: IntroPlan): Promise<void> {
    const s = this.d.scheduler;
    const r = this.cfg.reveal;
    const fx = this.d.introFx;
    const leader = this.view(this.d.leaderId).groundPosition;
    // 左右两片暗影池：两侧站位的中点
    const sides = this.sidesOf(plan.reveal, leader);
    this.d.sound.play('shadow');
    const spread = s.tween(r.spread, (t) => {
      const k = EASE.outCubic(t);
      fx.setPool(0, leader.x, leader.z, r.poolRadius * (0.5 + 0.3 * k), r.poolOpacity * Math.min(1, t * 3), r.tint);
      sides.forEach((p, i) => {
        fx.setPool(i + 1, leader.x + (p.x - leader.x) * k, leader.z + (p.z - leader.z) * k, r.poolRadius * (0.4 + 0.6 * k) * p.scale, r.poolOpacity * k, r.tint);
      });
    });
    // 按站位从内到外、左右交替依次升起
    const rises = plan.reveal.map((spot, i) =>
      s.wait(r.start + i * r.stagger).then(() => this.riseFromShadow(this.view(spot.id), spot)),
    );
    await Promise.all([spread, ...rises]);
    // 暗影池收缩消失
    await s.tween(r.poolFade, (t) => {
      const k = 1 - EASE.in(t);
      fx.setPool(0, leader.x, leader.z, r.poolRadius * 0.8 * k, r.poolOpacity * k, r.tint);
      sides.forEach((p, i) => fx.setPool(i + 1, p.x, p.z, r.poolRadius * p.scale * (0.6 + 0.4 * k), r.poolOpacity * k, r.tint));
    });
    fx.setPool(0, 0, 0, 0, 0, r.tint);
    fx.setPool(1, 0, 0, 0, 0, r.tint);
    fx.setPool(2, 0, 0, 0, 0, r.tint);
  }

  /** 两侧暗影池的中心和大小（盖住这一侧的所有站位） */
  private sidesOf(spots: readonly RevealSpot[], leader: { x: number; z: number; yaw: number }): { x: number; z: number; scale: number }[] {
    const lx = Math.cos(leader.yaw);
    const lz = -Math.sin(leader.yaw);
    const out: { x: number; z: number; scale: number }[] = [];
    for (const sign of [1, -1]) {
      const mine = spots.filter((p) => ((p.x - leader.x) * lx + (p.z - leader.z) * lz) * sign > 0);
      if (mine.length === 0) {
        out.push({ x: leader.x, z: leader.z, scale: 0 });
        continue;
      }
      const cx = mine.reduce((a, p) => a + p.x, 0) / mine.length;
      const cz = mine.reduce((a, p) => a + p.z, 0) / mine.length;
      const span = mine.reduce((m, p) => Math.max(m, Math.hypot(p.x - cx, p.z - cz)), 0);
      out.push({ x: cx, z: cz, scale: Math.max(1, (span + 0.6) / this.cfg.reveal.poolRadius) });
    }
    return out;
  }

  private async riseFromShadow(v: UnitView, spot: RevealSpot): Promise<void> {
    const r = this.cfg.reveal;
    const shade = this.shade(v);
    // 位置由开场布置摆好（setup），这里只管显形；跳过动画时各轨道完成的先后不定，显形不能把已经飞走的人拉回来
    v.model.visible = true;
    // 暗影池里冒起一缕暗紫的烟，身影从烟里升起
    void this.d.fx.burst('dust', { x: spot.x, y: 0.05, z: spot.z }, r.glow, 0.6, 0.9);
    await this.d.scheduler.tween(r.rise, (t) => {
      shade.set(t, this.revealLook);
      v.stunt.y = -r.sink * (1 - EASE.outCubic(t));
    });
    shade.restore();
    if (v.stunt.y < 0) v.stunt.y = 0;
    // 凝成实体：脚下一圈暗色烟尘
    void this.d.fx.burst('dust', { x: spot.x, y: 0.05, z: spot.z }, r.smoke, 0.6, 1.4);
  }

  // ------------------------------------------------------------------
  // f. 相机
  // ------------------------------------------------------------------

  private async cameraMove(from: CameraFrame): Promise<void> {
    const c = this.cfg.camera;
    const to = { x: CAMERA_CONFIG.target.x, y: CAMERA_CONFIG.target.y, z: CAMERA_CONFIG.target.z, distance: CAMERA_CONFIG.distance };
    const cam = this.d.camera;
    await this.d.scheduler.tween(c.duration, (t) => {
      const k = easeInOutCubic(t);
      if (t >= 1) {
        cam.setFrame(null);
        return;
      }
      cam.setFrame({
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        z: from.z + (to.z - from.z) * k,
        distance: from.distance + (to.distance - from.distance) * k,
      });
    });
  }

  // ------------------------------------------------------------------
  // b. Boss 转身、怒吼
  // ------------------------------------------------------------------

  private async bossTurn(plan: IntroPlan): Promise<void> {
    const boss = this.view(this.d.bossId);
    const g = boss.groundPosition;
    const pts = [this.view(this.d.leaderId).groundPosition, ...plan.reveal];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    const want = yawOf(cx - g.x, cz - g.z);
    await this.d.scheduler.tween(this.cfg.bossTurn.duration, (t) => boss.placeAt(g.x, g.z, lerpAngle(g.yaw, want, smooth(t))));
  }

  private async roar(): Promise<void> {
    const s = this.d.scheduler;
    const c = this.cfg.roar;
    const boss = this.view(this.d.bossId);
    const P = INTRO_POSES;
    this.d.sound.play('roar', 1.3);
    let nextShake = 0;
    await s.tween(c.duration, (t) => {
      const time = t * c.duration;
      const rise = Math.min(1, time / c.rise);
      const fall = Math.min(1, Math.max(0, (c.duration - time) / 0.2));
      const w = smooth(rise) * smooth(fall);
      writePose(boss, P.roar, w);
      const shiver = Math.sin(TAU * P.roarShiver.hz * time) * w;
      for (const [k, v] of Object.entries(P.roarShiver.pose)) boss.stunt.pose[k] = (boss.stunt.pose[k] ?? 0) + v * shiver;
      if (time >= nextShake && t < 1) {
        this.d.rig.shake(c.shake);
        nextShake = time + c.shakeEvery;
      }
    });
    for (const k of [...Object.keys(P.roar), ...Object.keys(P.roarShiver.pose)]) delete boss.stunt.pose[k];
  }

  // ------------------------------------------------------------------
  // c. Boss 跺地
  // ------------------------------------------------------------------

  private async stomp(plan: IntroPlan): Promise<void> {
    const s = this.d.scheduler;
    const c = this.cfg.stomp;
    const boss = this.view(this.d.bossId);
    const P = INTRO_POSES;
    // 抬腿
    await s.tween(c.lift, (t) => blendPose(boss, {}, P.stompLift, EASE.outCubic(t)));
    // 重重踏下
    await s.tween(c.drop, (t) => blendPose(boss, P.stompLift, P.stompDown, EASE.inCubic(t)));
    this.impact();
    // 收回站姿；同时转回原来的朝向（面向我方阵地）
    const g = boss.groundPosition;
    const home = boss.home;
    const baseYaw = yawOf(boss.facing.x, boss.facing.z);
    await Promise.all([
      s.wait(0.12).then(() => s.tween(c.recover, (t) => blendPose(boss, P.stompDown, {}, smooth(t)))),
      s.wait(0.5).then(() => s.tween(0.5, (t) => boss.placeAt(home.x, home.z, lerpAngle(g.yaw, baseYaw, smooth(t))))),
      this.wave(plan),
    ]);
    for (const k of new Set([...Object.keys(P.stompLift), ...Object.keys(P.stompDown)])) delete boss.stunt.pose[k];
  }

  /** 踏地的一瞬间：大幅震屏、震地声、尘土碎石、闪光 */
  private impact(): void {
    const c = this.cfg.stomp;
    const home = this.view(this.d.bossId).home;
    const at = { x: home.x, y: 0.05, z: home.z };
    this.d.rig.shake(c.shake);
    this.d.sound.play('quake', 1.4);
    if (this.d.scheduler.skip) return;
    void this.d.fx.burst('shockwave', at, c.waveColor, 0.8, 3);
    void this.d.fx.burst('dust', at, c.dustColor, 0.8, 3.2);
    this.d.fx.rubble(at, c.crackColor, c.dustColor, c.crackRadius, c.rubble);
    this.d.fx.flashLight(at.x, 1.2, at.z, c.waveColor, 30);
  }

  /** 冲击波环匀速扩散 + 地面裂纹发光后淡出 */
  private async wave(plan: IntroPlan): Promise<void> {
    void plan;
    const c = this.cfg.stomp;
    const fx = this.d.introFx;
    const home = this.view(this.d.bossId).home;
    const spread = c.waveRadius / c.waveSpeed;
    const rot = (home.x * 7.13 + home.z * 3.71) % TAU;
    const ring = this.d.scheduler.tween(spread, (t) => {
      // 环贴图的亮环在半径 0.88 处
      const radius = c.waveRadius * t;
      fx.setWave(home.x, home.z, radius / 0.88, t >= 1 ? 0 : (1 - t) * (1 - t * 0.5), c.waveColor);
    });
    const cracks = this.d.scheduler.tween(c.crackHold + c.crackFade, (t) => {
      const time = t * (c.crackHold + c.crackFade);
      const grow = EASE.outCubic(Math.min(1, time / 0.15));
      const fade = time < c.crackHold ? 1 : 1 - (time - c.crackHold) / c.crackFade;
      const flicker = 0.85 + 0.15 * Math.sin(time * 23);
      fx.setCracks(home.x, home.z, c.crackRadius * (0.6 + 0.4 * grow), t >= 1 ? 0 : Math.max(0, fade) * flicker, c.crackColor, rot);
    });
    await Promise.all([ring, cracks]);
  }

  // ------------------------------------------------------------------
  // d. 震飞
  // ------------------------------------------------------------------

  private async fly(plan: FlightPlan): Promise<void> {
    const s = this.d.scheduler;
    const f = this.cfg.flight;
    const v = this.view(plan.id);
    const P = INTRO_POSES;
    const start = v.groundPosition;
    const startYaw = start.yaw;
    const baseYaw = yawOf(v.facing.x, v.facing.z);
    v.stunt.pivot = 0.5;
    await s.tween(plan.duration, (t) => {
      const p = flightAt(plan, t);
      // 空中略微转向自己的阵地方向（落地后再转正）
      v.placeAt(p.x, p.z, lerpAngle(startYaw, baseYaw, smooth(t) * 0.35));
      v.stunt.y = t >= 1 ? 0 : p.y;
      if (plan.tumble === 'flip') v.stunt.pitch = t >= 1 ? 0 : -TAU * easeInOutCubic(t);
      else v.stunt.pitch = t >= 1 ? 0 : -f.leanBack * Math.sin(Math.PI * Math.min(1, t * 1.15));
      const w = t >= 1 ? 0 : Math.sin(Math.PI * Math.min(1, t * 1.1)) ** 0.6;
      writePose(v, P.blown, w);
      writePose(v, P.tuck, plan.tumble === 'flip' ? w : w * 0.6);
    });
    for (const k of [...Object.keys(P.blown), ...Object.keys(P.tuck)]) delete v.stunt.pose[k];
    // 落地：记下落点误差，脚下扬尘
    const g = v.groundPosition;
    this.landing[plan.id] = Math.hypot(g.x - v.home.x, g.z - v.home.z);
    this.d.sound.play('fall', 0.8);
    void this.d.fx.burst('dust', { x: g.x, y: 0.05, z: g.z }, STAGING_DUST, 0.6, f.landDust);
    this.d.rig.shake(0.08);
    // 屈膝缓冲 → 起身（根节点下沉，膝盖由 IK 弯曲，脚留在地上）
    await s.tween(f.crouchDown, (t) => {
      const k = EASE.outCubic(t);
      v.stunt.y = -f.crouchDepth * k;
      v.stunt.pitch = 0.22 * k;
    });
    await s.tween(f.crouchUp, (t) => {
      const k = 1 - smooth(t);
      v.stunt.y = t >= 1 ? 0 : -f.crouchDepth * k;
      v.stunt.pitch = t >= 1 ? 0 : 0.22 * k;
    });
    // 转向敌方
    const yaw0 = v.groundPosition.yaw;
    await s.tween(f.turn, (t) => v.placeAt(v.home.x, v.home.z, t >= 1 ? baseYaw : lerpAngle(yaw0, baseYaw, smooth(t))));
  }

  // ------------------------------------------------------------------
  // e. 宝宝入场
  // ------------------------------------------------------------------

  private async petsIn(entries: readonly PetEntry[]): Promise<void> {
    const s = this.d.scheduler;
    await Promise.all(entries.map((e) => s.wait(e.start).then(() => this.petIn(e))));
  }

  private async petIn(e: PetEntry): Promise<void> {
    const s = this.d.scheduler;
    const c = this.cfg.pets;
    const v = this.view(e.id);
    const P = INTRO_POSES;
    const travelYaw = yawOf(e.to.x - e.from.x, e.to.z - e.from.z);
    const ground = (t: number): Ground => ({ x: e.from.x + (e.to.x - e.from.x) * t, z: e.from.z + (e.to.z - e.from.z) * t });
    v.model.visible = true;
    v.placeAt(e.from.x, e.from.z, travelYaw);
    let heavy = false;
    switch (e.style) {
      case 'leap': {
        const L = c.leap;
        await s.tween(L.duration, (t) => {
          const p = ground(t);
          v.placeAt(p.x, p.z, travelYaw);
          v.stunt.y = t >= 1 ? 0 : L.apex * 4 * t * (1 - t);
          v.stunt.pitch = t >= 1 ? 0 : -0.45 * Math.cos(Math.PI * t);
          writePose(v, P.wolfLeap, t >= 1 ? 0 : Math.sin(Math.PI * t));
        });
        for (const k of Object.keys(P.wolfLeap)) delete v.stunt.pose[k];
        break;
      }
      case 'fly': {
        const F = c.fly;
        await s.tween(F.duration, (t) => {
          const k = EASE.outCubic(t);
          const p = ground(k);
          v.placeAt(p.x, p.z, travelYaw);
          v.stunt.y = t >= 1 ? 0 : F.height * (1 - smooth(t));
          v.stunt.pitch = t >= 1 ? 0 : 0.25 * Math.sin(Math.PI * t);
          // 扇翅：骨龙的翼 wingL.y 为负 = 张开（右翼相反）
          const flap = t >= 1 ? 0 : F.flapAmp * (0.6 + 0.4 * Math.sin(TAU * F.flap * t * F.duration)) * (1 - t * 0.6);
          v.stunt.pose['wingL.y'] = -flap;
          v.stunt.pose['wingR.y'] = flap;
          v.stunt.pose['wingL.z'] = flap * 0.5;
          v.stunt.pose['wingR.z'] = -flap * 0.5;
        });
        for (const k of ['wingL.y', 'wingR.y', 'wingL.z', 'wingR.z']) delete v.stunt.pose[k];
        break;
      }
      case 'float': {
        const F = c.float;
        const shade = this.shade(v);
        await s.tween(F.duration, (t) => {
          const k = smooth(t);
          const p = ground(k);
          const sway = F.sway * Math.sin(Math.PI * t * 2) * (1 - t);
          v.placeAt(p.x - Math.cos(travelYaw) * sway, p.z + Math.sin(travelYaw) * sway, travelYaw);
          v.stunt.y = t >= 1 ? 0 : F.height * (1 - k);
          v.stunt.roll = t >= 1 ? 0 : 0.2 * Math.sin(Math.PI * t * 2) * (1 - t);
          shade.set(Math.min(1, t * 1.25), IntroCutscene.GHOST_LOOK);
        });
        shade.restore();
        break;
      }
      case 'slam': {
        const F = c.slam;
        heavy = true;
        await s.tween(F.duration, (t) => {
          const k = EASE.inCubic(t);
          const p = ground(smooth(t));
          v.placeAt(p.x, p.z, travelYaw);
          v.stunt.y = t >= 1 ? 0 : F.height * (1 - k);
          writePose(v, P.golemFall, t >= 1 ? 0 : 1 - k * 0.6);
        });
        for (const k of Object.keys(P.golemFall)) delete v.stunt.pose[k];
        this.d.rig.shake(F.shake);
        this.d.sound.play('quake', 0.7);
        void this.d.fx.burst('shockwave', { x: e.to.x, y: 0.05, z: e.to.z }, 0xb08a5a, 0.6, 1.4);
        // 落地砸扁再弹回
        await s.tween(0.3, (t) => {
          v.stunt.pose['root.squash'] = t >= 1 ? 0 : F.squash * (1 - t) * (1 - t);
        });
        delete v.stunt.pose['root.squash'];
        break;
      }
    }
    v.clearStunt();
    if (!heavy) this.d.sound.play('fall', 0.5);
    void this.d.fx.burst('dust', { x: e.to.x, y: 0.05, z: e.to.z }, STAGING_DUST, 0.5, heavy ? c.landDust * 2.2 : c.landDust);
    // 就位后转向敌方
    const baseYaw = yawOf(v.facing.x, v.facing.z);
    await s.tween(c.turn, (t) => v.placeAt(e.to.x, e.to.z, t >= 1 ? baseYaw : lerpAngle(travelYaw, baseYaw, smooth(t))));
  }

  // ------------------------------------------------------------------
  // 收尾
  // ------------------------------------------------------------------

  /** 把所有单位交还战斗：特技层、材质、特效、相机全部复位（与直接开战的开场状态一致） */
  private finish(): void {
    for (const sh of this.shades.values()) sh.restore();
    this.d.introFx.clear();
    for (const v of this.d.stage.views.values()) v.clearStunt();
    // 回到格子、原朝向、站姿、全部显示（小怪直接出现）；清特效、镜头复位
    this.d.stage.reset();
    this.d.camera.setFrame(null);
  }

  private finalCheck(): IntroReport['final'] {
    const out: IntroReport['final'] = {};
    for (const v of this.d.stage.views.values()) {
      const g = v.groundPosition;
      const base = yawOf(v.facing.x, v.facing.z);
      out[v.id] = { dist: Math.hypot(g.x - v.home.x, g.z - v.home.z), yaw: Math.abs(wrapAngle(g.yaw - base)), visible: v.model.visible };
    }
    return out;
  }

  /** 正在用副本材质的单位（残留检查：过场结束后必须为空） */
  shadedUnits(): UnitId[] {
    return [...this.shades].filter(([, s]) => !s.usingOriginals()).map(([id]) => id);
  }
}

/** 落地扬尘的颜色（与冲锋落地相同） */
const STAGING_DUST = 0x8a7a68;

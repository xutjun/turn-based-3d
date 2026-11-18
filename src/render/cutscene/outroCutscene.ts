// 战后过场（步骤 19，SPEC §14.4，DESIGN §11.4、§11.8）：玩家在结算画面上点按钮之后播放，播完回到探索模式。
//
// 胜利（结算画面点“重新开始”）：
//   a. 倒地的队员（含宝宝）用复活动画站起来；
//   b. 宝宝沿入场路线倒着跳回主人身后，然后淡出；同时 4 名队员脚下展开暗影池、化入暗影（实体 → 幽影 → 沉入地面），
//      这是入场显形的反向；
//   c. 黑场淡出，黑场中复位：队长回到探索出生点、面向 Boss，Boss 在原位复位（重新显示、待机），其余单位隐藏；
//   d. 淡入，相机从战斗视角平滑回到探索视角（跟随队长的取景）。仍要重新对话才能开战。
// 失败（结算画面点“再来一次”）：
//   a. 黑场淡出；
//   b. 黑场中复位：所有单位站起、回到原位，敌方小怪、4 名队员和宝宝隐藏，Boss 在原位待机，
//      队长站到离 Boss respawnDistance 米的复位点、面向 Boss；相机置于战斗视角；
//   c. 淡入，相机从战斗视角平滑回到探索视角。
//
// 与入场过场相同的约定：所有等待和补间都走 Scheduler（倍速、跳过动画、暂停自动生效）；
// finish() 把改过的东西全部写回：材质副本换回原材质、特技层清空、地面特效隐藏、黑场归零，
// 所有单位复位后只显示探索布置（队长和 Boss），相机停在探索取景上。跳过时以任何顺序完成都得到同一个结果。

import { OUTRO_CONFIG, type OutroConfig } from '../../data/cutsceneConfig';
import { EXPLORE_CONFIG } from '../../data/exploreConfig';
import { facingOf } from '../../data/formation';
import { CAMERA_CONFIG } from '../../data/renderConfig';
import type { UnitId } from '../../core/types';
import type { SoundPlayer } from '../../assets/audio/SoundEngine';
import type { NavWorld } from '../../explore/exploreWorld';
import { nearestStandable, petEntryAt, type GroundPose, type PetEntry } from '../../explore/introPlan';
import { wrapAngle, yawOf } from '../../explore/walker';
import type { BattleCamera } from '../camera/battleCamera';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { FxSystem } from '../fx/FxSystem';
import type { BattleStage } from '../units/BattleStage';
import type { UnitView } from '../units/UnitView';
import type { CameraFrame } from './introCutscene';
import type { ShadeLook, ShadeReveal } from './shadeReveal';
import type { SummonFx } from './summonFx';

export type OutroResult = 'victory' | 'defeat';

export interface OutroDeps {
  stage: BattleStage;
  scheduler: Scheduler;
  camera: BattleCamera;
  fx: FxSystem;
  sound: SoundPlayer;
  /** 地面暗影池（与召唤共用；战后小怪都已不在，阵位贴花空着） */
  summonFx: SummonFx;
  world: NavWorld;
  leaderId: UnitId;
  bossId: UnitId;
  /** 显形材质工具（与入场过场共用同一份副本） */
  shadeOf: (v: UnitView) => ShadeReveal;
  /** 宝宝的入场路线（倒着播放就是跳回主人身后） */
  petEntries: () => PetEntry[];
  /** 队长站在 (x, z) 时探索相机的取景 */
  exploreFrame: (x: number, z: number) => CameraFrame;
  /** 黑场（0 = 透明，1 = 全黑），由界面层画 */
  setFade?: (alpha: number) => void;
  config?: OutroConfig;
}

/** 一次战后过场的记录（测试 / 调试） */
export interface OutroReport {
  result: OutroResult;
  /** 回到探索时队长的位置和朝向 */
  leader: GroundPose;
  /** 站起来的单位（胜利时倒地的那些） */
  stoodUp: UnitId[];
  /** 结束时显示的单位 */
  visible: UnitId[];
  /** 黑场的最大不透明度 */
  maxFade: number;
  skipped: boolean;
}

const TAU = Math.PI * 2;
const smooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;

export class OutroCutscene {
  private readonly cfg: OutroConfig;
  private playing = false;
  private fade = 0;
  private maxFade = 0;
  /** 用过副本材质的单位（残留检查） */
  private readonly touched = new Set<UnitView>();
  lastReport: OutroReport | null = null;

  constructor(private readonly d: OutroDeps) {
    this.cfg = d.config ?? OUTRO_CONFIG;
  }

  get active(): boolean {
    return this.playing;
  }

  /** 当前黑场不透明度 */
  get fadeLevel(): number {
    return this.fade;
  }

  private view(id: UnitId): UnitView {
    return this.d.stage.unit(id);
  }

  private get allies(): UnitView[] {
    return [...this.d.stage.views.values()].filter((v) => v.side === 'ally');
  }

  private get members(): UnitView[] {
    return this.allies.filter((v) => v.kind === 'hero' && v.id !== this.d.leaderId);
  }

  private shade(v: UnitView): ShadeReveal {
    this.touched.add(v);
    return this.d.shadeOf(v);
  }

  private setFade(a: number): void {
    this.fade = a;
    this.maxFade = Math.max(this.maxFade, a);
    this.d.setFade?.(a);
  }

  /**
   * 回到探索时队长站在哪：胜利（重新开始）= 探索出生点；失败 = Boss 正前方 respawnDistance 米的复位点。都面向 Boss。
   * 落在障碍物里时取最近的可走点。
   */
  leaderPose(result: OutroResult): GroundPose {
    const boss = this.view(this.d.bossId).home;
    let at: { x: number; z: number };
    if (result === 'victory') {
      at = EXPLORE_CONFIG.start;
    } else {
      const f = facingOf('enemy');
      const d = EXPLORE_CONFIG.respawnDistance;
      at = { x: boss.x + f.x * d, z: boss.z + f.z * d };
    }
    const p = nearestStandable(this.d.world, at.x, at.z);
    return { x: p.x, z: p.z, yaw: yawOf(boss.x - p.x, boss.z - p.z) };
  }

  /** 播放战后过场；结束（或被跳过）时场上是探索布置，相机在探索取景上 */
  async play(result: OutroResult): Promise<OutroReport> {
    if (this.playing) throw new Error('战后过场已经在播放');
    this.playing = true;
    this.maxFade = 0;
    const s = this.d.scheduler;
    let skipped = s.skip;
    const leader = this.leaderPose(result);
    let stoodUp: UnitId[] = [];
    try {
      if (result === 'victory') stoodUp = await this.victory();
      await this.blackout(leader);
      skipped = skipped || s.skip;
    } finally {
      this.finish(leader);
      this.playing = false;
    }
    const visible = [...this.d.stage.views.values()].filter((v) => v.model.visible).map((v) => v.id);
    this.lastReport = { result, leader, stoodUp, visible, maxFade: this.maxFade, skipped };
    return this.lastReport;
  }

  // ------------------------------------------------------------------
  // 胜利：站起、宝宝跳回、队员化入暗影
  // ------------------------------------------------------------------

  private async victory(): Promise<UnitId[]> {
    const s = this.d.scheduler;
    const c = this.cfg.victory;
    for (const v of this.allies) {
      v.setSealed(false);
      v.setDefending(false);
    }
    // 敌方都已倒下消失（保险：不管演出到哪一步，敌人一律不再显示，Boss 在黑场中复位）
    for (const v of this.d.stage.views.values()) if (v.side === 'enemy') v.model.visible = false;
    // a. 倒地的站起来
    const fallen = this.allies.filter((v) => v.fallen > 0 || !v.model.visible);
    if (fallen.length > 0) {
      await Promise.all(fallen.map((v) => v.revive(c.stand)));
      await s.wait(c.after);
    }
    // b. 宝宝跳回主人身后淡出、队员化入暗影
    const tracks: Promise<void>[] = [];
    for (const e of this.d.petEntries()) tracks.push(this.petOut(e));
    this.members.forEach((v, i) => tracks.push(s.wait(i * this.cfg.vanish.stagger).then(() => this.sink(v, i))));
    if (this.members.length > 0) this.d.sound.play('shadow');
    await Promise.all(tracks);
    return fallen.map((v) => v.id);
  }

  /** 宝宝沿入场路线倒着跳回主人身后，然后淡出隐藏 */
  private async petOut(e: PetEntry): Promise<void> {
    const s = this.d.scheduler;
    const c = this.cfg.pets;
    const v = this.view(e.id);
    if (!v.model.visible) return;
    const g = v.groundPosition;
    const travelYaw = yawOf(e.from.x - e.to.x, e.from.z - e.to.z);
    await s.tween(c.turn, (t) => v.placeAt(g.x, g.z, lerpAngle(g.yaw, travelYaw, smooth(t))));
    await s.tween(e.duration * c.speed, (t) => {
      const end = t >= 1;
      const p = petEntryAt(e, 1 - t);
      switch (e.style) {
        case 'leap':
          v.stunt.pitch = end ? 0 : -0.45 * Math.cos(Math.PI * t);
          break;
        case 'fly': {
          const flap = end ? 0 : 0.55 * (0.6 + 0.4 * Math.sin(TAU * 7 * t * e.duration));
          v.stunt.pose['wingL.y'] = -flap;
          v.stunt.pose['wingR.y'] = flap;
          break;
        }
        case 'float':
          v.stunt.roll = end ? 0 : 0.2 * Math.sin(Math.PI * t * 2) * (1 - t);
          break;
        case 'slam':
          v.stunt.pitch = end ? 0 : -0.2 * Math.sin(Math.PI * t);
          break;
      }
      v.placeAt(p.x, p.z, travelYaw);
      // 骨龙倒着飞：最后停在高处淡出；其余落回地面
      v.stunt.y = end && e.style !== 'fly' ? 0 : p.y;
    });
    const shade = this.shade(v);
    await s.tween(c.fade, (t) => shade.set(1 - t, c.look));
    v.model.visible = false;
    shade.restore();
    v.clearStunt();
  }

  /** 一名队员化入暗影：脚下暗影池展开 → 实体褪成幽影、沉入地面 → 隐藏 → 暗影池收缩消失 */
  private async sink(v: UnitView, slot: number): Promise<void> {
    const s = this.d.scheduler;
    const r = this.cfg.vanish;
    const fx = this.d.summonFx;
    const { x, z } = v.groundPosition;
    const look: ShadeLook = { tint: r.tint, glow: r.glow, glowStrength: r.glowStrength };
    const t0 = s.time;
    const pool = (radius: number, opacity: number): void => {
      fx.setPool(slot, x, z, radius, opacity, r.tint);
      fx.setGlow(slot, 'rune', x, z, radius * 0.85, opacity * 0.7, r.rimGlow, (s.time - t0) * r.runeSpin);
    };
    await s.tween(r.spread, (t) => pool(r.poolRadius * (0.3 + 0.7 * EASE.outCubic(t)), r.poolOpacity * Math.min(1, t * 2)));
    const shade = this.shade(v);
    void this.d.fx.burst('dust', { x, y: 0.05, z }, r.glow, 0.6, 1.0);
    await s.tween(r.duration, (t) => {
      shade.set(t >= 1 ? 0 : 1 - smooth(t), look);
      v.stunt.y = -r.sink * EASE.in(t);
      pool(r.poolRadius, r.poolOpacity);
    });
    v.model.visible = false;
    shade.restore();
    v.stunt.y = 0;
    await s.tween(r.poolFade, (t) => {
      const k = 1 - EASE.in(t);
      pool(r.poolRadius * (0.5 + 0.5 * k), t >= 1 ? 0 : r.poolOpacity * k);
    });
    pool(0, 0);
  }

  // ------------------------------------------------------------------
  // 黑场复位（胜利、失败共用）
  // ------------------------------------------------------------------

  private async blackout(leader: GroundPose): Promise<void> {
    const s = this.d.scheduler;
    const c = this.cfg.blackout;
    await s.tween(c.fadeOut, (t) => this.setFade(EASE.inOut(t)));
    this.setFade(1);
    // 黑场中复位：全员站起回到原位，然后只留探索布置（队长在出生点 / 复位点、Boss 在原位）；相机在战斗视角
    this.layout(leader);
    this.d.camera.setFrame(null);
    await s.wait(c.hold);
    await s.tween(c.fadeIn, (t) => this.setFade(1 - EASE.inOut(t)));
    this.setFade(0);
    await this.cameraTo(this.d.exploreFrame(leader.x, leader.z), c.camera);
  }

  /** 从战斗视角平滑过渡到给定取景 */
  private async cameraTo(to: CameraFrame, duration: number): Promise<void> {
    const from = { x: CAMERA_CONFIG.target.x, y: CAMERA_CONFIG.target.y, z: CAMERA_CONFIG.target.z, distance: CAMERA_CONFIG.distance };
    const cam = this.d.camera;
    await this.d.scheduler.tween(duration, (t) => {
      const k = t >= 1 ? 1 : easeInOutCubic(t);
      cam.setFrame({
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        z: from.z + (to.z - from.z) * k,
        distance: from.distance + (to.distance - from.distance) * k,
      });
    });
  }

  // ------------------------------------------------------------------
  // 收尾
  // ------------------------------------------------------------------

  /** 探索布置：所有单位复位（站起、回到原位、清特效），然后只显示队长和 Boss，队长放到 leader */
  private layout(leader: GroundPose): void {
    for (const v of this.touched) this.d.shadeOf(v).restore();
    this.d.summonFx.clear();
    this.d.stage.reset();
    for (const v of this.d.stage.views.values()) v.model.visible = v.id === this.d.leaderId || v.id === this.d.bossId;
    this.view(this.d.leaderId).placeAt(leader.x, leader.z, leader.yaw);
  }

  private finish(leader: GroundPose): void {
    this.layout(leader);
    this.d.camera.setFrame(this.d.exploreFrame(leader.x, leader.z));
    this.setFade(0);
  }

  /**
   * 预热（启动时调用一次）：宝宝淡出要用的材质副本先换上去编译一次着色器，再换回原材质
   * （队员的副本由入场过场预热），第一次战后过场不卡顿。
   */
  prewarm(compile: () => void): void {
    const list = this.allies.filter((v) => v.kind === 'pet');
    const vis = list.map((v) => v.model.visible);
    for (const v of list) {
      v.model.visible = true;
      this.d.shadeOf(v).engageForPrewarm(this.cfg.pets.look);
    }
    try {
      compile();
    } finally {
      list.forEach((v, i) => {
        this.d.shadeOf(v).restore();
        v.model.visible = vis[i]!;
      });
    }
  }

  /** 用着副本材质的单位（残留检查：过场结束后必须为空） */
  shadedUnits(): UnitId[] {
    return [...this.touched].filter((v) => !this.d.shadeOf(v).usingOriginals()).map((v) => v.id);
  }
}

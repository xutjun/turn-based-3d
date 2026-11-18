// 战后过场（步骤 19，SPEC §14.4，DESIGN §11.4、§11.8）：玩家在胜负提示上点“继续”之后播放，播完回到探索模式。
//
// 胜利：
//   a. 倒地的队员（含宝宝）用复活动画站起来；
//   b. 宝宝沿入场路线倒着跳回主人身后，然后淡出；同时 4 名队员脚下展开暗影池、化入暗影（实体 → 幽影 → 沉入地面），
//      这是入场显形的反向；只留下队长站在原地（他的战斗格子）；
//   c. 相机从战斗视角平滑回到探索视角（跟随队长的取景）。Boss 已被击败，不再出现。
// 失败：
//   a. 黑场淡出；
//   b. 黑场中复位：所有单位站起、回到原位，敌方小怪、4 名队员和宝宝隐藏，Boss 在原位待机，
//      队长站到离 Boss respawnDistance 米的复位点、面向 Boss；相机置于战斗视角；
//   c. 淡入，相机从战斗视角平滑回到探索视角。
// “再挑战一次”：Boss 在原位以灵魂显现、凝成实体的方式重新出现（bossReturn）。
//
// 与入场过场相同的约定：所有等待和补间都走 Scheduler（倍速、跳过动画、暂停自动生效）；
// finish() 把改过的东西全部写回：材质副本换回原材质、特技层清空、地面特效隐藏、黑场归零，
// 所有单位复位后只显示探索布置（队长；失败时再加 Boss），相机停在探索取景上。跳过时以任何顺序完成都得到同一个结果。

import { OUTRO_CONFIG, type OutroConfig } from '../../data/cutsceneConfig';
import { EXPLORE_CONFIG } from '../../data/exploreConfig';
import { facingOf } from '../../data/formation';
import { CAMERA_CONFIG } from '../../data/renderConfig';
import type { UnitId } from '../../core/types';
import type { SoundPlayer } from '../../assets/audio/SoundEngine';
import { PARTICLE_CELL } from '../../assets/textures/fxTextures';
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
  /** 黑场的最大不透明度（胜利为 0，失败为 1） */
  maxFade: number;
  skipped: boolean;
}

/** Boss 召唤 / 重新出现用的阵位贴花编号（小怪用 0~8，队员隐去用 0~3） */
const BOSS_SLOT = 9;
const TAU = Math.PI * 2;
const smooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

export class OutroCutscene {
  private readonly cfg: OutroConfig;
  private playing = false;
  private returning = false;
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

  /** Boss 正在重新出现（“再挑战一次”） */
  get bossReturning(): boolean {
    return this.returning;
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
   * 回到探索时队长站在哪：胜利 = 他的战斗格子（就地）；失败 = Boss 正前方 respawnDistance 米的复位点、面向 Boss。
   * 落在障碍物里时取最近的可走点。
   */
  leaderPose(result: OutroResult): GroundPose {
    const boss = this.view(this.d.bossId).home;
    if (result === 'victory') {
      const home = this.view(this.d.leaderId).home;
      const p = nearestStandable(this.d.world, home.x, home.z);
      const f = facingOf('ally');
      return { x: p.x, z: p.z, yaw: yawOf(f.x, f.z) };
    }
    const f = facingOf('enemy');
    const d = EXPLORE_CONFIG.respawnDistance;
    const p = nearestStandable(this.d.world, boss.x + f.x * d, boss.z + f.z * d);
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
      if (result === 'victory') stoodUp = await this.victory(leader);
      else await this.defeat(leader);
      skipped = skipped || s.skip;
    } finally {
      this.finish(result, leader);
      this.playing = false;
    }
    const visible = [...this.d.stage.views.values()].filter((v) => v.model.visible).map((v) => v.id);
    this.lastReport = { result, leader, stoodUp, visible, maxFade: this.maxFade, skipped };
    return this.lastReport;
  }

  // ------------------------------------------------------------------
  // 胜利
  // ------------------------------------------------------------------

  private async victory(leader: GroundPose): Promise<UnitId[]> {
    const s = this.d.scheduler;
    const c = this.cfg.victory;
    for (const v of this.allies) {
      v.setSealed(false);
      v.setDefending(false);
    }
    // 敌方都已倒下消失（保险：不管演出到哪一步，敌人一律不再显示）
    for (const v of this.d.stage.views.values()) if (v.side === 'enemy') v.model.visible = false;
    // a. 倒地的站起来
    const fallen = this.allies.filter((v) => v.fallen > 0 || !v.model.visible);
    if (fallen.length > 0) {
      await Promise.all(fallen.map((v) => v.revive(c.stand)));
      await s.wait(c.after);
    }
    // b. 宝宝跳回主人身后淡出、队员化入暗影；c. 相机回到探索视角
    const to = this.d.exploreFrame(leader.x, leader.z);
    const tracks: Promise<void>[] = [];
    for (const e of this.d.petEntries()) tracks.push(this.petOut(e));
    this.members.forEach((v, i) => tracks.push(s.wait(i * this.cfg.vanish.stagger).then(() => this.sink(v, i))));
    if (this.members.length > 0) this.d.sound.play('shadow');
    tracks.push(s.wait(c.camera.at).then(() => this.cameraTo(to, c.camera.duration)));
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
  // 失败
  // ------------------------------------------------------------------

  private async defeat(leader: GroundPose): Promise<void> {
    const s = this.d.scheduler;
    const c = this.cfg.defeat;
    await s.tween(c.fadeOut, (t) => this.setFade(EASE.inOut(t)));
    this.setFade(1);
    // 黑场中复位：全员站起回到原位，然后只留探索布置（队长在复位点、Boss 在原位）；相机在战斗视角
    this.layout('defeat', leader);
    this.d.camera.setFrame(null);
    await s.wait(c.hold);
    await s.tween(c.fadeIn, (t) => this.setFade(1 - EASE.inOut(t)));
    this.setFade(0);
    await this.cameraTo(this.d.exploreFrame(leader.x, leader.z), c.camera);
  }

  // ------------------------------------------------------------------
  // 相机
  // ------------------------------------------------------------------

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

  /**
   * 探索布置：所有单位复位（站起、回到原位、清特效），然后只显示队长（失败时再加 Boss），队长放到 leader。
   * 胜利时 Boss 已被击败，不再显示。
   */
  private layout(result: OutroResult, leader: GroundPose): void {
    for (const v of this.touched) this.d.shadeOf(v).restore();
    this.d.summonFx.clear();
    this.d.stage.reset();
    for (const v of this.d.stage.views.values()) {
      v.model.visible = v.id === this.d.leaderId || (result === 'defeat' && v.id === this.d.bossId);
    }
    this.view(this.d.leaderId).placeAt(leader.x, leader.z, leader.yaw);
  }

  private finish(result: OutroResult, leader: GroundPose): void {
    this.layout(result, leader);
    this.d.camera.setFrame(this.d.exploreFrame(leader.x, leader.z));
    this.setFade(0);
  }

  // ------------------------------------------------------------------
  // 再挑战一次：Boss 重新出现
  // ------------------------------------------------------------------

  /** Boss 在原位重新出现：脚下升起黑烟，半透明的灵魂轮廓浮现、凝成实体，一次光爆 */
  async bossReturn(): Promise<void> {
    if (this.returning) return;
    this.returning = true;
    const c = this.cfg.bossReturn;
    const fx = this.d.summonFx;
    const boss = this.view(this.d.bossId);
    const { x, z } = boss.home;
    const shade = this.shade(boss);
    boss.clearStunt();
    boss.placeAt(x, z, yawOf(boss.facing.x, boss.facing.z));
    boss.model.visible = false;
    let burst = false;
    this.d.sound.play('shadow', 1.1);
    try {
      await this.d.scheduler.tween(c.duration, (t) => {
        const time = t * c.duration;
        const end = t >= 1;
        const smokeK = time < c.smokeFor ? smooth(time / 0.2) : Math.max(0, 1 - (time - c.smokeFor) / 0.5);
        fx.setPool(BOSS_SLOT, x, z, c.poolRadius * (0.6 + 0.4 * smooth(time / 0.3)), end ? 0 : 0.8 * smokeK, c.smoke);
        if (!end && time < c.smokeFor) {
          const n = this.d.fx.emitCount(90);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const r = Math.sqrt(Math.random()) * c.poolRadius * 0.7;
            this.d.fx.particle(x + Math.cos(a) * r, 0.05, z + Math.sin(a) * r, rnd(-0.1, 0.1), rnd(0.6, 1.4), rnd(-0.1, 0.1), rnd(1.0, 1.6), rnd(0.6, 1.0), 0x3a3048, 0.35, PARTICLE_CELL.smoke, -0.3, 1.2, 1.6);
          }
        }
        const u = (time - c.appearAt) / c.condense;
        if (u <= 0 && !end) {
          boss.model.visible = false;
        } else {
          boss.model.visible = true;
          shade.set(end ? 1 : clamp01(u) ** 1.4, c.look);
          boss.stunt.y = end ? 0 : -c.rise * (1 - EASE.outCubic(clamp01(u)));
        }
        if (u >= 1 && !burst) {
          burst = true;
          void this.d.fx.burst('impact', boss.anchor('chest'), c.burst, 0.5, 1.6);
          this.d.sound.play('revive', 0.6);
        }
      });
    } finally {
      shade.restore();
      boss.clearStunt();
      boss.model.visible = true;
      fx.setPool(BOSS_SLOT, 0, 0, 0, 0, 0);
      this.returning = false;
    }
  }

  /**
   * 预热（启动时调用一次）：宝宝淡出、Boss 重新出现要用的材质副本先换上去编译一次着色器，再换回原材质
   * （队员的副本由入场过场预热），第一次战后过场不卡顿。
   */
  prewarm(compile: () => void): void {
    const list = [...this.allies.filter((v) => v.kind === 'pet'), this.view(this.d.bossId)];
    const vis = list.map((v) => v.model.visible);
    for (const v of list) {
      v.model.visible = true;
      this.d.shadeOf(v).engageForPrewarm(v.id === this.d.bossId ? this.cfg.bossReturn.look : this.cfg.pets.look);
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

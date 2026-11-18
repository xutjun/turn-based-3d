// 召唤演出（步骤 18，SPEC §14.3，DESIGN §11.8）：入场过场的最后一段，宝宝就位、镜头到达战斗视角之后播放。
//
//   a. Boss 高举双臂，身前出现暗红召唤法阵（暗色底 + 发光边 + 旋转符文，向上冒火星）；
//   b. 法阵按批次分出光束射向各个小怪的阵位（顺序、间隔见 SUMMON_CONFIG.batches）；
//   c. 光束到达的那一刻，该小怪在自己的战斗阵位上出场：
//      骷髅兵——地面裂开，骨头从地里冒出、飞起拼合（脊椎骨盆、肋骨、头骨、双臂、双腿依次），盔甲和武器落到身上，眼火点亮，站直；
//      堕落骑士——地面升起黑烟，半透明的灵魂轮廓浮现，逐渐凝成实体（盔甲由暗到亮），眼光亮起，一次光爆；
//      亡灵法师——绿色鬼火从四周汇聚，灵魂显现、凝成实体，骨杖最后出现在手中；
//      恶魔祭司——脚下升起暗影法阵，身影从法阵中升起成形，法阵收缩消失；
//   d. 全部就位后 Boss 一声短吼。
//
// 与入场过场相同的约定：所有等待和补间都走 Scheduler（倍速、跳过动画、暂停自动生效）；每条轨道只写自己负责的单位，
// 跳过时以任何顺序完成都得到同一个结果；finish() 把所有改过的东西写回原值：骷髅的部件位置 / 显隐（BoneAssembly）、
// 材质副本换回原材质（ShadeReveal）、骨杖的显隐和缩放、特技层姿态、召唤特效全部隐藏。
// 不增减光源、不新建材质（副本在第一次用时建好并复用，启动时预热编译），不会因为材质重编译卡顿。

import { SUMMON_CONFIG, SUMMON_POSES, type SummonConfig, type SummonStyle } from '../../data/cutsceneConfig';
import { PARTICLE_CELL } from '../../assets/textures/fxTextures';
import type { UnitId } from '../../core/types';
import type { SoundPlayer } from '../../assets/audio/SoundEngine';
import type { CameraRig } from '../camera/CameraRig';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { FxSystem } from '../fx/FxSystem';
import type { BattleStage } from '../units/BattleStage';
import type { UnitView } from '../units/UnitView';
import { BoneAssembly } from './boneAssembly';
import { ShadeReveal, type ShadeLook } from './shadeReveal';
import type { SummonFx } from './summonFx';
import { Vector3, type Object3D } from 'three';

export interface SummonDeps {
  stage: BattleStage;
  scheduler: Scheduler;
  fx: FxSystem;
  rig: CameraRig;
  sound: SoundPlayer;
  summonFx: SummonFx;
  bossId: UnitId;
  config?: SummonConfig;
}

/** 一只小怪的出场安排（时刻相对召唤开始，1 倍速，秒） */
export interface SummonEntry {
  id: UnitId;
  style: SummonStyle;
  /** 第几批（0 起） */
  batch: number;
  /** 阵位贴花 / 光束的编号 */
  slot: number;
  /** 光束射出（没有施法段时为 null） */
  beamAt: number | null;
  /** 开始出场 */
  startAt: number;
  /** 完整就位 */
  endAt: number;
}

export interface SummonTimeline {
  entries: SummonEntry[];
  /** Boss 放下双臂的时刻（没有施法段时为 0） */
  castEnd: number;
  /** 短吼开始（没有短吼时为 null） */
  roarAt: number | null;
  /** 整段结束 */
  endAt: number;
}

export interface SummonOptions {
  /** 只召唤这些单位（技能演示页逐种播放）；不填 = 全部 9 个小怪 */
  ids?: readonly UnitId[];
  /** 是否有 Boss 施法（举臂、法阵、光束）；默认有 */
  cast?: boolean;
  /** 是否在最后短吼；默认有 */
  roar?: boolean;
}

export interface SummonReport {
  /** 每只小怪开始显示的时刻（相对召唤开始，演出时间） */
  appeared: Record<UnitId, number>;
  /** 完整就位的时刻 */
  ready: Record<UnitId, number>;
  roared: boolean;
  skipped: boolean;
}

const TAU = Math.PI * 2;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const smooth = (t: number): number => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};
const rnd = (a: number, b: number): number => a + (b - a) * Math.random();

/** 每个单位固定的伪随机数（骨头起点每次召唤都一样，便于测试和验收） */
function seeded(id: string): () => number {
  let s = 2166136261;
  for (const ch of id) s = Math.imul(s ^ ch.charCodeAt(0), 16777619) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function writePose(view: UnitView, pose: Readonly<Record<string, number>>, w: number): void {
  for (const [k, v] of Object.entries(pose)) view.stunt.pose[k] = v * w;
}

function clearPose(view: UnitView, ...poses: Readonly<Record<string, number>>[]): void {
  for (const p of poses) for (const k of Object.keys(p)) delete view.stunt.pose[k];
}

export class SummonCutscene {
  private readonly cfg: SummonConfig;
  private readonly assemblies = new Map<UnitId, BoneAssembly>();
  private readonly shades = new Map<UnitId, ShadeReveal>();
  private readonly staffs = new Map<UnitId, { node: Object3D; visible: boolean; scale: Vector3 }>();
  private playing = false;
  /** 调试 / 测试：上一次召唤的记录 */
  lastReport: SummonReport | null = null;

  constructor(private readonly d: SummonDeps) {
    this.cfg = d.config ?? SUMMON_CONFIG;
  }

  get active(): boolean {
    return this.playing;
  }

  /** 场上的小怪（敌方除 Boss 外），顺序固定 */
  get minions(): UnitView[] {
    return [...this.d.stage.views.values()].filter((v) => v.side === 'enemy' && v.id !== this.d.bossId);
  }

  private view(id: UnitId): UnitView {
    return this.d.stage.unit(id);
  }

  styleOf(v: UnitView): SummonStyle {
    return this.cfg.styles[v.templateKey] ?? 'soul';
  }

  private durationOf(style: SummonStyle): number {
    return this.cfg[style].duration;
  }

  /** 按配置排出每只小怪的出场时刻 */
  timeline(opts: SummonOptions = {}): SummonTimeline {
    const c = this.cfg;
    const cast = opts.cast ?? true;
    const roar = opts.roar ?? true;
    const all = this.minions;
    const wanted = opts.ids ? all.filter((v) => opts.ids!.includes(v.id)) : all;
    const entries: SummonEntry[] = [];
    const batches = [...c.batches];
    // 配置里没写到的种类排在最后一批
    const listed = new Set(batches.flatMap((b) => b.templates));
    const rest = [...new Set(wanted.map((v) => v.templateKey).filter((k) => !listed.has(k)))];
    if (rest.length > 0) batches.push({ templates: rest, at: (batches.at(-1)?.at ?? 0) + 0.6, stagger: 0.1 });
    // 没有施法段时（演示页单独播放某一种），第一批从 0 开始
    const used = batches.filter((b) => wanted.some((v) => b.templates.includes(v.templateKey)));
    const first = used[0]?.at ?? 0;
    used.forEach((b, bi) => {
      const units = wanted.filter((v) => b.templates.includes(v.templateKey));
      units.forEach((v, k) => {
        const style = this.styleOf(v);
        const beamAt = cast ? c.beam.start + b.at + k * b.stagger : null;
        const startAt = beamAt !== null ? beamAt + c.beam.travel : b.at - first + k * b.stagger;
        entries.push({ id: v.id, style, batch: bi, slot: all.indexOf(v), beamAt, startAt, endAt: startAt + this.durationOf(style) });
      });
    });
    const lastBeam = entries.reduce((m, e) => Math.max(m, (e.beamAt ?? 0) + c.beam.travel + c.beam.linger), 0);
    const castEnd = cast ? Math.max(c.cast.raise, lastBeam) + c.cast.hold + c.cast.lower : 0;
    const ready = entries.reduce((m, e) => Math.max(m, e.endAt), 0);
    const roarAt = roar ? ready + c.roar.after : null;
    const endAt = Math.max(castEnd, roarAt !== null ? roarAt + c.roar.duration : ready);
    return { entries, castEnd, roarAt, endAt };
  }

  /** 召唤开始前的样子：这些小怪隐藏，所有部件、材质、骨杖复位 */
  hide(ids: readonly UnitId[] = this.minions.map((v) => v.id)): void {
    for (const id of ids) {
      const v = this.view(id);
      this.restoreUnit(v);
      v.model.visible = false;
    }
  }

  /**
   * 播放召唤。结束（或被跳过）时这些小怪都在阵位上、完整显示、姿态和材质与直接开战一致；召唤特效全部隐藏。
   */
  async play(opts: SummonOptions = {}): Promise<SummonReport> {
    if (this.playing) throw new Error('召唤演出已经在播放');
    this.playing = true;
    const s = this.d.scheduler;
    const tl = this.timeline(opts);
    const t0 = s.time;
    const report: SummonReport = { appeared: {}, ready: {}, roared: false, skipped: s.skip };
    const mark = (rec: Record<UnitId, number>, id: UnitId): void => {
      if (rec[id] === undefined) rec[id] = s.time - t0;
    };
    try {
      this.hide(tl.entries.map((e) => e.id));
      const tracks: Promise<void>[] = [];
      if (opts.cast ?? true) {
        tracks.push(this.cast(tl));
        for (const e of tl.entries) if (e.beamAt !== null) tracks.push(s.wait(e.beamAt).then(() => this.beam(e)));
      }
      for (const e of tl.entries) {
        tracks.push(
          s.wait(e.startAt).then(async () => {
            await this.emerge(e, () => mark(report.appeared, e.id));
            mark(report.ready, e.id);
          }),
        );
      }
      if (tl.roarAt !== null) {
        tracks.push(
          s.wait(tl.roarAt).then(async () => {
            await this.roar();
            report.roared = true;
          }),
        );
      }
      await Promise.all(tracks);
      report.skipped = report.skipped || s.skip;
    } finally {
      this.finish(tl.entries.map((e) => e.id));
      this.playing = false;
    }
    this.lastReport = report;
    return report;
  }

  // ------------------------------------------------------------------
  // a. Boss 施法与召唤法阵
  // ------------------------------------------------------------------

  /** 召唤法阵的位置：Boss 身前 */
  circleCenter(): { x: number; z: number } {
    const boss = this.view(this.d.bossId);
    return { x: boss.home.x + boss.facing.x * this.cfg.circle.ahead, z: boss.home.z + boss.facing.z * this.cfg.circle.ahead };
  }

  private async cast(tl: SummonTimeline): Promise<void> {
    const s = this.d.scheduler;
    const c = this.cfg;
    const boss = this.view(this.d.bossId);
    const P = SUMMON_POSES.cast;
    const at = this.circleCenter();
    const fx = this.d.summonFx;
    this.d.sound.play('cast', 1.2);
    this.d.rig.shake(0.08);
    const holdUntil = tl.castEnd - c.cast.lower;
    const fadeOutAt = holdUntil - c.cast.hold;
    const total = tl.castEnd;
    await s.tween(total, (t) => {
      const time = t * total;
      const end = t >= 1;
      // 举臂 → 保持 → 放下
      const up = smooth(time / c.cast.raise);
      const down = time < holdUntil ? 1 : 1 - smooth((time - holdUntil) / c.cast.lower);
      writePose(boss, P, end ? 0 : up * down);
      // 法阵：举臂的同时淡入，最后一道光束射出后淡出
      const C = c.circle;
      const fin = smooth((time - 0.1) / C.fadeIn);
      const fout = time < fadeOutAt ? 1 : 1 - smooth((time - fadeOutAt) / C.fadeOut);
      const k = end ? 0 : fin * fout;
      const pulse = 1 + 0.06 * Math.sin(time * 9);
      fx.setCircle(at.x, at.z, C.radius * (0.55 + 0.45 * EASE.outCubic(fin)) * pulse * (0.7 + 0.3 * fout), C.opacity * k, C.color, C.glow, time * C.spin);
      // 法阵上冒起的火星
      if (k > 0.2) {
        const n = this.d.fx.emitCount(45 * k);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const r = Math.sqrt(Math.random()) * C.radius * 0.9;
          this.d.fx.particle(at.x + Math.cos(a) * r, 0.08, at.z + Math.sin(a) * r, 0, rnd(0.8, 2), 0, rnd(0.5, 0.9), rnd(0.06, 0.13), C.glow, 1.5, PARTICLE_CELL.ember, -0.5, 0.6, -0.4);
        }
      }
    });
    clearPose(boss, P);
    fx.setCircle(0, 0, 0, 0, c.circle.color, c.circle.glow, 0);
  }

  /** 一道光束：从法阵中心射向这只小怪的阵位 */
  private async beam(e: SummonEntry): Promise<void> {
    const B = this.cfg.beam;
    const from = this.circleCenter();
    const to = this.view(e.id).home;
    const total = B.travel + B.linger;
    const reachAt = B.travel / total;
    this.d.sound.play('bolt', 0.6);
    const fx = this.d.summonFx;
    await this.d.scheduler.tween(total, (t) => {
      const end = t >= 1;
      const reach = Math.min(1, t / reachAt);
      const after = t <= reachAt ? 0 : (t - reachAt) / (1 - reachAt);
      const fade = end ? 0 : 1 - after * after;
      const flicker = 0.85 + 0.15 * Math.sin(t * 60);
      fx.setBeam(e.slot, from.x, from.z, to.x, to.z, EASE.outCubic(reach), B.height, B.width * (1 - 0.5 * after), fade * flicker, B.color);
      // 光束头部拖出的火星
      if (reach < 1) {
        const hx = from.x + (to.x - from.x) * EASE.outCubic(reach);
        const hz = from.z + (to.z - from.z) * EASE.outCubic(reach);
        const n = this.d.fx.emitCount(70);
        for (let i = 0; i < n; i++) {
          this.d.fx.particle(hx, B.height, hz, rnd(-0.5, 0.5), rnd(-0.2, 0.8), rnd(-0.5, 0.5), rnd(0.2, 0.4), rnd(0.07, 0.14), B.color, 1.6, PARTICLE_CELL.glow, 0, 1, -0.4);
        }
      }
    });
    fx.setBeam(e.slot, 0, 0, 0, 0, 0, 0, 0, 0, B.color);
  }

  // ------------------------------------------------------------------
  // c. 各种小怪的出场
  // ------------------------------------------------------------------

  private emerge(e: SummonEntry, shown: () => void): Promise<void> {
    const v = this.view(e.id);
    v.clearStunt();
    v.placeAt(v.home.x, v.home.z, Math.atan2(v.facing.x, v.facing.z));
    switch (e.style) {
      case 'bones':
        return this.bones(e, v, shown);
      case 'soul':
        return this.soul(e, v, shown);
      case 'wisps':
        return this.wisps(e, v, shown);
      case 'rise':
        return this.rise(e, v, shown);
    }
  }

  private assembly(v: UnitView): BoneAssembly {
    let a = this.assemblies.get(v.id);
    if (!a) {
      a = new BoneAssembly(v.model);
      this.assemblies.set(v.id, a);
    }
    return a;
  }

  private shade(v: UnitView): ShadeReveal {
    let s = this.shades.get(v.id);
    if (!s) {
      s = new ShadeReveal(v.model);
      this.shades.set(v.id, s);
    }
    return s;
  }

  /** 亡灵法师的骨杖（挂在右手的 weaponMount 下，召唤专用的合并边界） */
  private staff(v: UnitView): { node: Object3D; visible: boolean; scale: Vector3 } | null {
    let st = this.staffs.get(v.id);
    if (!st) {
      const node = v.model.getObjectByName('joint:weaponMount');
      if (!node) return null;
      st = { node, visible: node.visible, scale: node.scale.clone() };
      this.staffs.set(v.id, st);
    }
    return st;
  }

  /** 骷髅兵：地裂 → 骨头飞起拼合 → 盔甲武器落下 → 眼火点亮 → 站直 */
  private async bones(e: SummonEntry, v: UnitView, shown: () => void): Promise<void> {
    const c = this.cfg.bones;
    const fx = this.d.summonFx;
    const asm = this.assembly(v);
    const { x, z } = v.home;
    const rot = (x * 3.17 + z * 5.3) % TAU;
    asm.begin(v.home, c.scatter, c.depth, seeded(v.id));
    v.model.visible = true;
    shown();
    writePose(v, SUMMON_POSES.hunch, 1);
    v.stunt.y = -c.sink;
    this.d.sound.play('quake', 0.45);
    void this.d.fx.burst('dust', { x, y: 0.05, z }, 0x6a5a4a, 0.6, 1.3);
    await this.d.scheduler.tween(c.duration, (t) => {
      const time = t * c.duration;
      const end = t >= 1;
      const r = asm.pose(end ? Infinity : time, c);
      if (r.gearLanded) {
        this.d.sound.play('fall', 0.35);
        void this.d.fx.burst('dust', { x, y: 0.05, z }, 0x8a7a68, 0.5, 0.8);
      }
      if (r.eyesLit) {
        for (const p of asm.eyePositions()) {
          for (let i = 0; i < this.d.fx.burstCount(8); i++) {
            this.d.fx.particle(p.x, p.y, p.z, rnd(-0.3, 0.3), rnd(0.1, 0.6), rnd(-0.3, 0.3), rnd(0.25, 0.5), rnd(0.06, 0.12), c.eyeColor, 2, PARTICLE_CELL.glow, -0.3, 1, -0.3);
          }
        }
      }
      // 地面裂开：裂纹发光后淡出，下面一圈暗色
      const grow = EASE.outCubic(Math.min(1, time / 0.15));
      const fade = time < 1.3 ? 1 : Math.max(0, 1 - (time - 1.3) / 0.6);
      const flicker = 0.85 + 0.15 * Math.sin(time * 21);
      fx.setGlow(e.slot, 'crack', x, z, 1.15 * (0.5 + 0.5 * grow), end ? 0 : fade * flicker, c.crackColor, rot);
      fx.setPool(e.slot, x, z, 1.1 * (0.6 + 0.4 * grow), end ? 0 : 0.7 * fade, 0x0a0606);
      // 骨片和碎土从裂缝里迸出
      if (!end && time < 1.1) {
        const n = this.d.fx.emitCount(30);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const d = rnd(0.2, 0.9);
          this.d.fx.particle(x + Math.cos(a) * d, 0.05, z + Math.sin(a) * d, Math.cos(a) * 0.4, rnd(1.2, 2.6), Math.sin(a) * 0.4, rnd(0.35, 0.6), rnd(0.04, 0.09), c.boneColor, 0.9, PARTICLE_CELL.ember, 8, 0.6, 0);
        }
      }
      // 从佝偻站直，脚从裂缝里拔出
      const k = end ? 0 : time < c.standAt ? 1 : 1 - smooth((time - c.standAt) / c.stand);
      writePose(v, SUMMON_POSES.hunch, k);
      v.stunt.y = -c.sink * k;
    });
    asm.restore();
    clearPose(v, SUMMON_POSES.hunch);
    v.stunt.y = 0;
    fx.setGlow(e.slot, 'crack', 0, 0, 0, 0, c.crackColor);
    fx.setPool(e.slot, 0, 0, 0, 0, 0);
  }

  /** 堕落骑士：黑烟 → 半透明灵魂浮现 → 凝成实体（盔甲由暗到亮、眼光亮起）→ 光爆 */
  private async soul(e: SummonEntry, v: UnitView, shown: () => void): Promise<void> {
    const c = this.cfg.soul;
    const fx = this.d.summonFx;
    const shade = this.shade(v);
    const look: ShadeLook = c.look;
    const { x, z } = v.home;
    let burst = false;
    this.d.sound.play('shadow', 0.9);
    await this.d.scheduler.tween(c.duration, (t) => {
      const time = t * c.duration;
      const end = t >= 1;
      // 黑烟：暗色烟池 + 从地面冒起的烟团
      const smokeK = time < c.smokeFor ? smooth(time / 0.2) : Math.max(0, 1 - (time - c.smokeFor) / 0.5);
      fx.setPool(e.slot, x, z, 1.2 * (0.6 + 0.4 * smooth(time / 0.3)), end ? 0 : 0.8 * smokeK, c.smoke);
      if (!end && time < c.smokeFor) {
        const n = this.d.fx.emitCount(60);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const r = Math.sqrt(Math.random()) * 0.75;
          this.d.fx.particle(x + Math.cos(a) * r, 0.05, z + Math.sin(a) * r, rnd(-0.1, 0.1), rnd(0.5, 1.2), rnd(-0.1, 0.1), rnd(0.8, 1.3), rnd(0.5, 0.9), 0x3a3048, 0.35, PARTICLE_CELL.smoke, -0.3, 1.2, 1.4);
        }
      }
      // 灵魂浮现 → 凝成实体
      const u = (time - c.appearAt) / c.condense;
      if (u <= 0 && !end) {
        v.model.visible = false;
      } else {
        if (!v.model.visible) shown();
        v.model.visible = true;
        const k = end ? 1 : clamp01(u) ** 1.4;
        shade.set(k, look);
        v.stunt.y = end ? 0 : -c.rise * (1 - EASE.outCubic(clamp01(u)));
      }
      if (u >= 1 && !burst) {
        burst = true;
        const head = v.anchor('chest');
        void this.d.fx.burst('impact', head, c.burst, 0.45, 1);
        this.d.sound.play('revive', 0.5);
      }
    });
    shade.restore();
    v.stunt.y = 0;
    fx.setPool(e.slot, 0, 0, 0, 0, 0);
  }

  /** 亡灵法师：鬼火汇聚 → 灵魂显现、凝成实体 → 骨杖最后出现 */
  private async wisps(e: SummonEntry, v: UnitView, shown: () => void): Promise<void> {
    const c = this.cfg.wisps;
    const fx = this.d.summonFx;
    const shade = this.shade(v);
    const staff = this.staff(v);
    const { x, z } = v.home;
    const core = { x, y: 1.1, z };
    let staffShown = false;
    if (staff) staff.node.visible = false;
    this.d.sound.play('cast', 0.7);
    await this.d.scheduler.tween(c.duration, (t) => {
      const time = t * c.duration;
      const end = t >= 1;
      // 鬼火从四周飞向身体中心
      if (!end && time < c.gather + 0.15) {
        const n = this.d.fx.emitCount(120);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const r = c.radius * rnd(0.7, 1);
          const px = x + Math.cos(a) * r;
          const py = rnd(0.3, 2.1);
          const pz = z + Math.sin(a) * r;
          const life = rnd(0.4, 0.55);
          this.d.fx.particle(px, py, pz, (core.x - px) / life, (core.y - py) / life, (core.z - pz) / life, life, rnd(0.08, 0.16), c.color, 1.8, PARTICLE_CELL.glow, 0, 0, -0.6);
        }
      }
      // 脚下的幽绿光圈
      const ring = time < c.appearAt + c.condense ? smooth(time / 0.3) : Math.max(0, 1 - (time - c.appearAt - c.condense) / 0.3);
      fx.setGlow(e.slot, 'ring', x, z, 0.9 + 0.1 * Math.sin(time * 8), end ? 0 : 0.8 * ring, c.color);
      // 灵魂显现 → 凝成实体
      const u = (time - c.appearAt) / c.condense;
      if (u <= 0 && !end) {
        v.model.visible = false;
      } else {
        if (!v.model.visible) shown();
        v.model.visible = true;
        shade.set(end ? 1 : clamp01(u) ** 1.3, c.look);
      }
      // 骨杖最后出现在手中：从手心长出来
      if (staff) {
        const g = (time - c.staffAt) / c.staffGrow;
        if (end || g >= 1) {
          staff.node.visible = staff.visible;
          staff.node.scale.copy(staff.scale);
        } else if (g > 0) {
          staff.node.visible = staff.visible;
          staff.node.scale.copy(staff.scale).multiplyScalar(Math.max(0.01, EASE.outBack(g)));
        } else {
          staff.node.visible = false;
        }
        if (g > 0 && !staffShown) {
          staffShown = true;
          const p = staff.node.getWorldPosition(new Vector3());
          for (let i = 0; i < this.d.fx.burstCount(14); i++) {
            this.d.fx.particle(p.x, p.y, p.z, rnd(-0.8, 0.8), rnd(-0.3, 1.2), rnd(-0.8, 0.8), rnd(0.3, 0.55), rnd(0.07, 0.14), c.color, 2, PARTICLE_CELL.spark, 0, 1.2, -0.4);
          }
        }
      }
    });
    shade.restore();
    if (staff) {
      staff.node.visible = staff.visible;
      staff.node.scale.copy(staff.scale);
    }
    fx.setGlow(e.slot, 'ring', 0, 0, 0, 0, c.color);
  }

  /** 恶魔祭司：脚下升起暗影法阵 → 身影从法阵中升起成形 → 法阵收缩消失 */
  private async rise(e: SummonEntry, v: UnitView, shown: () => void): Promise<void> {
    const c = this.cfg.rise;
    const fx = this.d.summonFx;
    const shade = this.shade(v);
    const { x, z } = v.home;
    this.d.sound.play('shadow', 0.8);
    const outAt = c.riseAt + c.rise;
    await this.d.scheduler.tween(c.duration, (t) => {
      const time = t * c.duration;
      const end = t >= 1;
      // 法阵：展开 → 保持 → 收缩消失
      const open = EASE.outCubic(clamp01(time / c.circleIn));
      const close = time < outAt ? 1 : 1 - smooth((time - outAt) / c.circleOut);
      const k = end ? 0 : open * close;
      fx.setPool(e.slot, x, z, c.radius * 1.15 * (0.3 + 0.7 * open) * (0.5 + 0.5 * close), 0.85 * k, c.color);
      fx.setGlow(e.slot, 'rune', x, z, c.radius * (0.3 + 0.7 * open) * (0.4 + 0.6 * close), k, c.glow, -time * 1.6);
      // 身影从地下升起（地面挡住还在地下的部分，看起来是从法阵里自下而上长出来），由暗影凝成实体
      const u = (time - c.riseAt) / c.rise;
      if (u <= 0 && !end) {
        v.model.visible = false;
      } else {
        if (!v.model.visible) shown();
        v.model.visible = true;
        const e3 = EASE.outCubic(clamp01(u));
        v.stunt.y = end ? 0 : -c.depth * (1 - e3);
        shade.set(end ? 1 : clamp01(u * 1.1), c.look);
      }
      // 身影穿出地面处的一圈光环
      const ringK = u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
      fx.setRing(e.slot, x, 0.08, z, 0.75 + 0.1 * ringK, end ? 0 : 0.9 * ringK, c.glow);
      // 法阵上冒起的暗紫火星
      if (k > 0.3) {
        const n = this.d.fx.emitCount(40 * k);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * TAU;
          const r = Math.sqrt(Math.random()) * c.radius;
          this.d.fx.particle(x + Math.cos(a) * r, 0.06, z + Math.sin(a) * r, 0, rnd(0.6, 1.6), 0, rnd(0.4, 0.8), rnd(0.05, 0.11), c.glow, 1.4, PARTICLE_CELL.ember, -0.3, 0.6, -0.4);
        }
      }
    });
    shade.restore();
    v.stunt.y = 0;
    fx.setPool(e.slot, 0, 0, 0, 0, 0);
    fx.setGlow(e.slot, 'rune', 0, 0, 0, 0, c.glow);
    fx.setRing(e.slot, 0, 0, 0, 0, 0, c.glow);
  }

  // ------------------------------------------------------------------
  // d. 短吼
  // ------------------------------------------------------------------

  private async roar(): Promise<void> {
    const c = this.cfg.roar;
    const boss = this.view(this.d.bossId);
    const P = SUMMON_POSES.roar;
    this.d.sound.play('roar', 0.8);
    this.d.rig.shake(c.shake);
    await this.d.scheduler.tween(c.duration, (t) => {
      writePose(boss, P, t >= 1 ? 0 : Math.sin(Math.PI * t) ** 0.7);
    });
    clearPose(boss, P);
  }

  // ------------------------------------------------------------------
  // 收尾、预热、检查
  // ------------------------------------------------------------------

  /** 把一个单位被召唤改过的东西写回原值 */
  private restoreUnit(v: UnitView): void {
    this.assemblies.get(v.id)?.restore();
    this.shades.get(v.id)?.restore();
    const st = this.staffs.get(v.id);
    if (st) {
      st.node.visible = st.visible;
      st.node.scale.copy(st.scale);
    }
    clearPose(v, SUMMON_POSES.hunch);
    v.stunt.y = 0;
  }

  /** 收尾：这些小怪完整显示在阵位上，所有部件、材质、骨杖复位，Boss 的施法 / 短吼姿态清掉，召唤特效全部隐藏 */
  finish(ids: readonly UnitId[] = this.minions.map((v) => v.id)): void {
    for (const id of ids) {
      const v = this.view(id);
      this.restoreUnit(v);
      v.clearStunt();
      v.placeAt(v.home.x, v.home.z, Math.atan2(v.facing.x, v.facing.z));
      v.model.visible = true;
    }
    const boss = this.view(this.d.bossId);
    clearPose(boss, SUMMON_POSES.cast, SUMMON_POSES.roar);
    this.d.summonFx.clear();
  }

  /**
   * 预热：要用材质副本的小怪（灵魂凝聚、鬼火、暗影升起）换上副本，召唤特效全部显示（不透明度 0），
   * 交给调用方编译一次着色器，再全部换回。
   */
  prewarm(compile: () => void): void {
    const touched: { v: UnitView; visible: boolean }[] = [];
    for (const v of this.minions) {
      if (this.styleOf(v) === 'bones') continue;
      touched.push({ v, visible: v.model.visible });
      v.model.visible = true;
      this.shade(v).engageForPrewarm(this.cfg[this.styleOf(v) as 'soul' | 'wisps' | 'rise'].look);
    }
    this.d.summonFx.setPrewarm(true);
    try {
      compile();
    } finally {
      this.d.summonFx.setPrewarm(false);
      this.d.summonFx.clear();
      for (const { v, visible } of touched) {
        this.shade(v).restore();
        v.model.visible = visible;
      }
    }
  }

  /** 正在用副本材质的单位（残留检查：召唤结束后必须为空） */
  shadedUnits(): UnitId[] {
    return [...this.shades].filter(([, s]) => !s.usingOriginals()).map(([id]) => id);
  }

  /** 部件没有复位的单位（残留检查：召唤结束后必须为空） */
  unrestoredUnits(): UnitId[] {
    const out: UnitId[] = [];
    for (const [id, a] of this.assemblies) if (!a.isRestored()) out.push(id);
    for (const [id, st] of this.staffs) if (st.node.visible !== st.visible || !st.node.scale.equals(st.scale)) out.push(id);
    return out;
  }

  /** 测试 / 调试：某只骷髅兵的拼合进度 */
  assemblyOf(id: UnitId): BoneAssembly | undefined {
    return this.assemblies.get(id);
  }
}

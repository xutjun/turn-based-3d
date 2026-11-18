// 舞台：把场上的单位模型包装成 UnitView，并提供技能特效和演出镜头。实现 director/types.ts 的 Stage 接口。

import { Group, type Object3D } from 'three';
import type { UnitId, UnitTemplate } from '../../core/types';
import type { Scheduler } from '../director/Scheduler';
import type { CameraRig } from '../camera/CameraRig';
import type { AuraKind, BurstKind, Point3, ProjectileKind, Stage } from '../director/types';
import type { FxSystem } from '../fx/FxSystem';
import type { SoundPlayer } from '../../assets/audio/SoundEngine';
import type { SoundName } from '../../data/audioConfig';
import { AURA_SOUND, BEAM_SOUND, BURST_SOUND, PROJECTILE_SOUND } from './soundCues';
import { UnitView } from './UnitView';

/** 没有传音效引擎时用的空实现 */
const SILENT: SoundPlayer = { play: () => undefined };

export class BattleStage implements Stage {
  readonly views = new Map<UnitId, UnitView>();
  /** 单位身上的点光源（发光武器）：搬到这里，单位隐藏时只熄灭、不移出场景（场景光源数恒定，步骤 17） */
  readonly lightRig = new Group();

  constructor(
    templates: readonly UnitTemplate[],
    models: ReadonlyMap<UnitId, Object3D>,
    private readonly scheduler: Scheduler,
    readonly fx: FxSystem,
    readonly camera: CameraRig,
    /** 音效（可选）：不传则无声 */
    private readonly sound: SoundPlayer = SILENT,
  ) {
    for (const t of templates) {
      const model = models.get(t.id);
      if (!model) throw new Error(`单位 ${t.id} 没有模型`);
      const view = new UnitView(t, model, scheduler, fx, sound);
      // 沉重的踏步（魔偶）让镜头轻震
      view.onShake = (amount) => this.camera.shake(amount);
      view.detachLights(this.lightRig);
      this.views.set(t.id, view);
    }
    this.lightRig.name = 'unitLights';
    // 冲锋绕开己方单位（步骤 17）：同一方、看得见、没有离开格子的其他单位；倒地的按躺下的高度算
    for (const view of this.views.values()) {
      view.obstacleSource = () => {
        const out: { x: number; z: number; radius: number; height: number }[] = [];
        for (const other of this.views.values()) {
          if (other === view || other.side !== view.side || !other.model.visible || other.away) continue;
          const g = other.groundPosition;
          out.push({ x: g.x, z: g.z, radius: other.radius, height: other.bodyHeight * (other.fallen > 0.5 ? 0.25 : 1) });
        }
        return out;
      };
    }
  }

  unit(id: UnitId): UnitView {
    const view = this.views.get(id);
    if (!view) throw new Error(`舞台上没有单位 ${id}`);
    return view;
  }

  projectile(kind: ProjectileKind, from: Point3, to: Point3, color: number, duration: number): Promise<void> {
    this.cue(PROJECTILE_SOUND[kind]);
    return this.fx.projectile(kind, from, to, color, duration);
  }

  burst(kind: BurstKind, at: Point3, color: number, duration: number, scale = 1): Promise<void> {
    this.cue(BURST_SOUND[kind]);
    return this.fx.burst(kind, at, color, duration, scale);
  }

  slash(at: Point3, variant: number, color: number, duration: number, scale: number): Promise<void> {
    return this.fx.slash(at, variant, color, duration, scale);
  }

  beam(from: Point3, to: Point3, color: number, travel: number, linger: number): Promise<void> {
    this.cue(BEAM_SOUND);
    return this.fx.beam(from, to, color, travel, linger);
  }

  aura(kind: AuraKind, at: Point3, color: number, duration: number, radius: number): Promise<void> {
    this.cue(AURA_SOUND[kind]);
    return this.fx.aura(kind, at, color, duration, radius);
  }

  private cue(name: SoundName | null): void {
    if (name) this.sound.play(name);
  }

  /** 所有单位回到开场状态（再战一次时调用）：先结束残留的动画，再清掉特效、复位镜头和姿态 */
  reset(): void {
    this.scheduler.flush();
    this.fx.clear();
    this.camera.resetNow();
    for (const view of this.views.values()) view.reset();
  }

  /**
   * 每帧更新所有单位的姿态。
   * @param idleTime 待机动画用的连续时间（场景时间）；不传则用演出时间
   */
  update(idleTime: number = this.scheduler.time): void {
    for (const view of this.views.values()) view.update(this.scheduler.time, idleTime);
  }

  /** 调试：所有单位当前的待机状态 */
  idleSnapshot(): Record<UnitId, ReturnType<UnitView['idleSnapshot']>> {
    return Object.fromEntries([...this.views].map(([id, view]) => [id, view.idleSnapshot()]));
  }

  /** 调试：所有单位当前的动作状态（阶段、动作名、是否回到站姿、相对原位和原朝向的偏差） */
  motionSnapshot(): Record<UnitId, ReturnType<UnitView['motionSnapshot']>> {
    return Object.fromEntries([...this.views].map(([id, view]) => [id, view.motionSnapshot()]));
  }

  /** 当前离开站位的单位（任意时刻最多 1 个，且只能是正在近战冲锋的出手者） */
  unitsAway(): UnitId[] {
    return [...this.views.values()].filter((v) => v.away).map((v) => v.id);
  }
}

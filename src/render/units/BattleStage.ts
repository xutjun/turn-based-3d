// 舞台：把场上的单位模型包装成 UnitView，并提供技能特效和演出镜头。实现 director/types.ts 的 Stage 接口。

import type { Object3D } from 'three';
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
      this.views.set(t.id, new UnitView(t, model, scheduler, fx, sound));
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

  burst(kind: BurstKind, at: Point3, color: number, duration: number): Promise<void> {
    this.cue(BURST_SOUND[kind]);
    return this.fx.burst(kind, at, color, duration);
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

  /** 每帧更新所有单位的姿态 */
  update(): void {
    for (const view of this.views.values()) view.update(this.scheduler.time);
  }

  /** 当前离开站位的单位（任意时刻最多 1 个，且只能是正在近战冲锋的出手者） */
  unitsAway(): UnitId[] {
    return [...this.views.values()].filter((v) => v.away).map((v) => v.id);
  }
}

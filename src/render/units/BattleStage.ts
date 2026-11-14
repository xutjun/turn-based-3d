// 舞台：把场上的单位模型包装成 UnitView，并提供基础光效。实现 director/types.ts 的 Stage 接口。

import type { Object3D } from 'three';
import type { UnitId, UnitTemplate } from '../../core/types';
import type { Scheduler } from '../director/Scheduler';
import type { BurstKind, Point3, ProjectileKind, Stage } from '../director/types';
import type { SimpleFx } from '../fx/simpleFx';
import { UnitView } from './UnitView';

export class BattleStage implements Stage {
  readonly views = new Map<UnitId, UnitView>();

  constructor(
    templates: readonly UnitTemplate[],
    models: ReadonlyMap<UnitId, Object3D>,
    private readonly scheduler: Scheduler,
    private readonly fx: SimpleFx,
  ) {
    for (const t of templates) {
      const model = models.get(t.id);
      if (!model) throw new Error(`单位 ${t.id} 没有模型`);
      this.views.set(t.id, new UnitView(t, model, scheduler));
    }
  }

  unit(id: UnitId): UnitView {
    const view = this.views.get(id);
    if (!view) throw new Error(`舞台上没有单位 ${id}`);
    return view;
  }

  projectile(kind: ProjectileKind, from: Point3, to: Point3, color: number, duration: number): Promise<void> {
    return this.fx.projectile(kind, from, to, color, duration);
  }

  burst(kind: BurstKind, at: Point3, color: number, duration: number): Promise<void> {
    return this.fx.burst(kind, at, color, duration);
  }

  /** 所有单位回到开场状态（再战一次时调用）：先结束残留的动画，再复位姿态 */
  reset(): void {
    this.scheduler.flush();
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

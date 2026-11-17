// 探索模式的场景布置（步骤 14，DESIGN §11.2）：复用战场和同一批单位（BattleStage 的 UnitView），按模式切换。
//   - 进入探索：只显示 5 名人物和 Boss（原战斗位置，待机），宝宝和其余 9 个敌人隐藏；人物在出生点列队；
//   - 每帧：小队的移动（src/explore/squad.ts）写到 UnitView，单位按走过的距离迈步；相机平滑跟随；
//   - 离开探索：所有单位回到战斗站位、全部显示，相机回到战斗的固定机位。
// 战斗代码看到的永远是同一批 UnitView，探索不改战斗规则和演出。

import type { UnitId, UnitTemplate } from '../../core/types';
import { EXPLORE_CONFIG } from '../../data/exploreConfig';
import { CameraFollow } from '../../explore/cameraFollow';
import { Squad } from '../../explore/squad';
import type { BattleCamera } from '../camera/battleCamera';
import type { BattleStage } from '../units/BattleStage';

/** 调试：探索模式的状态（window.__app.explore()） */
export interface ExploreSnapshot {
  active: boolean;
  controlled: UnitId;
  visible: UnitId[];
  units: Record<UnitId, { x: number; z: number; yaw: number; speed: number; walk: number }>;
  camera: { x: number; z: number };
}

export class ExploreStage {
  readonly squad: Squad;
  readonly follow: CameraFollow;
  readonly bossId: UnitId;
  private readonly heroIds: UnitId[];
  private activeFlag = false;

  constructor(
    private readonly stage: BattleStage,
    private readonly camera: BattleCamera,
    templates: readonly UnitTemplate[],
  ) {
    const boss = templates.find((t) => t.rank === 'boss');
    if (!boss) throw new Error('阵容里没有 Boss');
    this.bossId = boss.id;
    this.heroIds = templates.filter((t) => t.side === 'ally' && t.kind === 'hero').map((t) => t.id);
    this.squad = new Squad(stage.unit(boss.id).home);
    for (const id of this.squad.ids) {
      if (!this.heroIds.includes(id)) throw new Error(`探索配置里的 ${id} 不是友方人物`);
    }
    this.follow = new CameraFollow();
  }

  get active(): boolean {
    return this.activeFlag;
  }

  /** 进入探索：所有单位先回到开场状态，再按探索布置显示、列队，相机对准队长 */
  enter(): void {
    this.stage.reset();
    for (const [id, view] of this.stage.views) {
      view.model.visible = this.heroIds.includes(id) || id === this.bossId;
    }
    this.activeFlag = true;
    this.returnToStart();
  }

  /** 离开探索：单位回到战斗站位、全部显示，相机回到战斗机位 */
  leave(): void {
    this.activeFlag = false;
    this.squad.input.x = this.squad.input.z = 0;
    this.stage.reset();
    this.camera.setFrame(null);
  }

  /** 回到起点：小队在出生点重新列队，控制权回到队长，相机立即对准 */
  returnToStart(): void {
    this.squad.reset();
    this.squad.controlled = EXPLORE_CONFIG.leaderId;
    for (const [id, w] of this.squad.walkers) this.stage.unit(id).placeAt(w.x, w.z, w.yaw);
    const c = this.focusWalker();
    this.follow.snap(c.x, c.z);
    this.applyCamera();
  }

  /** 方向键 / WASD 的输入（地面向量；0 = 不走） */
  setInput(x: number, z: number): void {
    this.squad.input.x = x;
    this.squad.input.z = z;
  }

  /** 调试：切换方向键控制的人物，相机跟过去 */
  cycleControlled(): UnitId {
    this.squad.input.x = this.squad.input.z = 0;
    return this.squad.cycleControlled();
  }

  /** 每帧（摆姿态之前）：推进移动，写到单位上，相机跟随 */
  update(dt: number): void {
    if (!this.activeFlag || dt <= 0) return;
    this.squad.update(dt);
    for (const [id, w] of this.squad.walkers) this.stage.unit(id).locomote(w.x, w.z, w.yaw);
    const c = this.focusWalker();
    this.follow.update(c.x, c.z, c.vx, c.vz, dt);
    this.applyCamera();
  }

  private focusWalker() {
    return this.squad.walkers.get(this.squad.controlled) ?? this.squad.leader;
  }

  private applyCamera(): void {
    const c = EXPLORE_CONFIG.camera;
    this.camera.setFrame({ x: this.follow.x, y: c.height, z: this.follow.z, distance: c.distance });
  }

  snapshot(): ExploreSnapshot {
    const units: ExploreSnapshot['units'] = {};
    for (const [id, w] of this.squad.walkers) {
      const v = this.stage.unit(id);
      units[id] = { x: w.x, z: w.z, yaw: w.yaw, speed: Math.hypot(w.vx, w.vz), walk: v.walkWeight };
    }
    return {
      active: this.activeFlag,
      controlled: this.squad.controlled,
      visible: [...this.stage.views].filter(([, v]) => v.model.visible).map(([id]) => id),
      units,
      camera: { x: this.follow.x, z: this.follow.z },
    };
  }
}

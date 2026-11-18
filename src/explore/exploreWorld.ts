// 探索模式的“地形”（步骤 15）：障碍物（场景物件 + Boss）与对应的导航网格。纯计算，不依赖 three.js 和 DOM。
// Boss 在场 / 不在场各建一张网格（DESIGN §11.3），切换时不重建。

import { BATTLEFIELD_LAYOUT, type BattlefieldLayout } from '../data/battlefieldLayout';
import { EXPLORE_CONFIG, type GroundXZ } from '../data/exploreConfig';
import { bossObstacle, layoutObstacles, type Obstacle } from './collision';
import { buildNavGrid, type NavGrid } from './navGrid';
import type { Bounds } from './walker';

export type ExploreConfig = typeof EXPLORE_CONFIG;

/** 队长移动需要的地形信息（agent.ts 只依赖这几项，测试可以自己搭一个） */
export interface NavWorld {
  readonly grid: NavGrid;
  readonly obstacles: readonly Obstacle[];
  readonly bounds: Bounds;
  readonly unitRadius: number;
}

export class ExploreWorld implements NavWorld {
  readonly bounds: Bounds;
  readonly unitRadius: number;
  private readonly withBoss: { obstacles: Obstacle[]; grid: NavGrid };
  private readonly withoutBoss: { obstacles: Obstacle[]; grid: NavGrid };
  private present = true;

  constructor(
    readonly boss: GroundXZ,
    readonly cfg: ExploreConfig = EXPLORE_CONFIG,
    layout: BattlefieldLayout = BATTLEFIELD_LAYOUT,
  ) {
    this.bounds = cfg.bounds;
    this.unitRadius = cfg.collision.unitRadius;
    const props = layoutObstacles(layout, cfg.collision);
    const all = [...props, bossObstacle(boss, cfg.collision)];
    this.withBoss = { obstacles: all, grid: buildNavGrid(all, cfg) };
    this.withoutBoss = { obstacles: props, grid: buildNavGrid(props, cfg) };
  }

  /** Boss 是否在场（步骤 19 胜利后不在场） */
  get bossPresent(): boolean {
    return this.present;
  }

  setBossPresent(on: boolean): void {
    this.present = on;
  }

  /** 当前生效的障碍物 */
  get obstacles(): readonly Obstacle[] {
    return this.present ? this.withBoss.obstacles : this.withoutBoss.obstacles;
  }

  /** 当前生效的导航网格 */
  get grid(): NavGrid {
    return this.present ? this.withBoss.grid : this.withoutBoss.grid;
  }
}

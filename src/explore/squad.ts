// 探索模式的小队（步骤 14）：出生点的列队、谁是队长、调试时控制谁。纯计算，不依赖 three.js 和 DOM。

import type { UnitId } from '../core/types';
import { EXPLORE_CONFIG, type GroundXZ } from '../data/exploreConfig';
import { createWalker, localToWorld, stepWalker, yawOf, type WalkerState } from './walker';

export type ExploreConfig = typeof EXPLORE_CONFIG;

/** 一个人在队形里的位置 */
export interface LineupSpot {
  id: UnitId;
  x: number;
  z: number;
  yaw: number;
}

/**
 * 出生点的列队：队长站在出生点、面向 Boss，队员按 lineup 站在队长身后，朝向与队长相同。
 */
export function startLineup(boss: GroundXZ, cfg: ExploreConfig = EXPLORE_CONFIG): LineupSpot[] {
  const start = cfg.start;
  const yaw = yawOf(boss.x - start.x, boss.z - start.z);
  const leader = { x: start.x, z: start.z, yaw };
  return [
    { id: cfg.leaderId, x: start.x, z: start.z, yaw },
    ...cfg.lineup.map((m) => ({ id: m.id, ...localToWorld(leader, m.x, m.z), yaw })),
  ];
}

/**
 * 小队的移动状态。步骤 14：只有“被控制的那个人”（默认队长）按方向键走，其余人原地站着；
 * 步骤 15 换成点击移动 + 跟随。
 */
export class Squad {
  readonly walkers = new Map<UnitId, WalkerState>();
  /** 当前由方向键控制的人（调试：Tab 切换） */
  controlled: UnitId;
  /** 想走的方向（地面向量，长度 0 = 不走） */
  readonly input = { x: 0, z: 0 };

  constructor(
    private readonly boss: GroundXZ,
    private readonly cfg: ExploreConfig = EXPLORE_CONFIG,
  ) {
    this.controlled = cfg.leaderId;
    this.reset();
  }

  /** 全体回到出生点列队（“回到起点”） */
  reset(): void {
    this.walkers.clear();
    for (const s of startLineup(this.boss, this.cfg)) this.walkers.set(s.id, createWalker(s.x, s.z, s.yaw));
    this.input.x = this.input.z = 0;
  }

  /** 队员的 id（队长在前） */
  get ids(): UnitId[] {
    return [...this.walkers.keys()];
  }

  get leader(): WalkerState {
    return this.walkers.get(this.cfg.leaderId)!;
  }

  /** 调试：切到下一个人（队长 → 队员 1 → … → 队长） */
  cycleControlled(): UnitId {
    const ids = this.ids;
    const i = ids.indexOf(this.controlled);
    this.controlled = ids[(i + 1) % ids.length]!;
    return this.controlled;
  }

  /** 推进一帧：被控制的人按 input 走，其余人减速停下 */
  update(dt: number): void {
    for (const [id, w] of this.walkers) {
      stepWalker(w, id === this.controlled ? this.input : { x: 0, z: 0 }, dt, this.cfg.move, this.cfg.bounds);
    }
  }
}

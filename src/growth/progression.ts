// 等级与经验的计算（步骤 21，DESIGN §12.1）：纯 TS，不依赖 three / DOM。
// 本阶段只留接口：没有任何地方调用 addExp（获得经验和升级在以后的步骤）。

import type { UnitId } from '../core/types';
import { EXP_TABLE, HERO_PROGRESS, LEVEL_CAP, type HeroProgress } from '../data/progression';

/** 第 level 级升到下一级所需的经验（表里没有时取最后一级的值） */
export function expToNext(level: number): number {
  const exact = EXP_TABLE[level];
  if (exact !== undefined) return exact;
  const levels = Object.keys(EXP_TABLE).map(Number);
  const last = Math.max(...levels);
  return EXP_TABLE[Math.min(level, last)] ?? EXP_TABLE[last]!;
}

/**
 * 增加经验，返回新的进度（不改传入的对象）。经验够了就升级，可以连升多级；
 * 到等级上限后只累积经验、不再升级（DESIGN §9.17 M2）。
 */
export function addExp(progress: Readonly<HeroProgress>, amount: number, cap = LEVEL_CAP): HeroProgress {
  let level = progress.level;
  let exp = progress.exp + Math.max(0, Math.floor(amount));
  while (level < cap && exp >= expToNext(level)) {
    exp -= expToNext(level);
    level += 1;
  }
  return { level, exp };
}

/** 某名人物当前的进度（不在表里时按 1 级 0 经验） */
export function heroProgress(id: UnitId): HeroProgress {
  const p = HERO_PROGRESS[id];
  return p ? { ...p } : { level: 1, exp: 0 };
}

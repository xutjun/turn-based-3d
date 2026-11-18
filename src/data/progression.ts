// 等级与经验（步骤 21，SPEC §15.1、DESIGN §12.1）：5 名人物当前统一 10 级，等级上限暂定 10。
// 本阶段不做获得经验和升级，只留接口（src/growth/progression.ts）；面板显示等级和经验条（当前 / 升级所需）。

import type { UnitId } from '../core/types';

/** 等级上限（暂定） */
export const LEVEL_CAP = 10;

/**
 * 第 n 级升到 n + 1 级所需的经验。
 * 第 10 级已是上限，仍写一个值给经验条显示“0 / 10000”，以后提高上限时直接可用（DESIGN §9.17 M2）。
 */
export const EXP_TABLE: Readonly<Record<number, number>> = {
  1: 100,
  2: 250,
  3: 500,
  4: 900,
  5: 1500,
  6: 2300,
  7: 3400,
  8: 5000,
  9: 7200,
  10: 10000,
};

/** 人物的等级与当前经验 */
export interface HeroProgress {
  level: number;
  exp: number;
}

/** 5 名人物的初始进度：全部 10 级、0 经验 */
export const HERO_PROGRESS: Readonly<Record<UnitId, HeroProgress>> = {
  A0: { level: 10, exp: 0 },
  A1: { level: 10, exp: 0 },
  A2: { level: 10, exp: 0 },
  A3: { level: 10, exp: 0 },
  A4: { level: 10, exp: 0 },
};

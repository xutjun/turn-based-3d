// 用默认配置表组装一场 10v10 战斗的引擎输入。

import { createUnits } from '../core/setup';
import type { BattleSettings, BattleSetup } from '../core/types';
import { AI_CONFIG } from './aiConfig';
import { BATTLE_CONFIG, DEFAULT_SETTINGS } from './battleConfig';
import { ENEMY_TEMPLATES } from './enemies';
import { ALLY_TEMPLATES } from './heroes';
import { SKILLS } from './skills';

/**
 * @param seed 随机种子；相同种子、相同指令得到完全相同的战斗过程
 * @param settings 覆盖默认设置（如宝宝自动出手）
 */
export function createDefaultSetup(seed: number, settings: Partial<BattleSettings> = {}): BattleSetup {
  const merged: BattleSettings = { ...DEFAULT_SETTINGS, ...settings };
  return {
    config: BATTLE_CONFIG,
    skills: SKILLS,
    units: createUnits([...ALLY_TEMPLATES, ...ENEMY_TEMPLATES], merged),
    settings: merged,
    ai: AI_CONFIG,
    seed,
  };
}

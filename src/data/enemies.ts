// 敌方阵容：10 个单位，小怪 + 精英 + 1 个 Boss。对应 DESIGN.md §8.3。
// 数值在步骤 9（v0.2）重新平衡过：敌方不再集火后，气血约 ×1.18、物伤 / 法伤约 ×1.05（用 npm run balance 核对）。敌人没有复活技能（敌人被击败即消失）。

import type { ClassId, EnemyRank, Slot, Stats, UnitTemplate } from '../core/types';

/** 敌人原型：同一种敌人共用外观模板、职业、出手方式和基础数值 */
interface EnemyArchetype {
  templateId: string;
  name: string;
  rank: EnemyRank;
  classId: ClassId;
  attackMode: UnitTemplate['attackMode'];
  basicAttackSkillId: string;
  skillIds: string[]; // 不含普攻，必须是所属职业技能库的子集
  stats: Stats;
}

const ARCHETYPES = {
  skeleton: {
    templateId: 'enemy_skeleton',
    name: '骷髅兵',
    rank: 'minion',
    classId: 'physical',
    attackMode: 'melee',
    basicAttackSkillId: 'basic_physical',
    skillIds: [],
    stats: { maxHp: 495, maxMp: 0, physAtk: 240, magAtk: 0, defense: 40, speed: 80 },
  },
  fallenKnight: {
    templateId: 'enemy_fallen_knight',
    name: '堕落骑士',
    rank: 'elite',
    classId: 'physical',
    attackMode: 'melee',
    basicAttackSkillId: 'basic_physical',
    skillIds: ['combo_slash'],
    stats: { maxHp: 910, maxMp: 200, physAtk: 300, magAtk: 55, defense: 70, speed: 75 },
  },
  demonPriestSeal: {
    templateId: 'enemy_demon_priest',
    name: '恶魔祭司·缚',
    rank: 'elite',
    classId: 'seal',
    attackMode: 'cast',
    basicAttackSkillId: 'basic_magic',
    skillIds: ['seal'],
    stats: { maxHp: 660, maxMp: 400, physAtk: 120, magAtk: 255, defense: 40, speed: 105 },
  },
  demonPriestHeal: {
    templateId: 'enemy_demon_priest',
    name: '恶魔祭司·愈',
    rank: 'elite',
    classId: 'heal',
    attackMode: 'cast',
    basicAttackSkillId: 'basic_magic',
    skillIds: ['group_heal'],
    stats: { maxHp: 660, maxMp: 500, physAtk: 120, magAtk: 255, defense: 40, speed: 88 },
  },
  necromancer: {
    templateId: 'enemy_necromancer',
    name: '亡灵法师',
    rank: 'elite',
    classId: 'magic',
    attackMode: 'cast',
    basicAttackSkillId: 'basic_magic',
    skillIds: ['group_spell', 'single_spell'],
    stats: { maxHp: 620, maxMp: 500, physAtk: 80, magAtk: 315, defense: 35, speed: 92 },
  },
  abyssLord: {
    templateId: 'enemy_abyss_lord',
    name: '深渊魔将',
    rank: 'boss',
    classId: 'physical',
    attackMode: 'melee',
    basicAttackSkillId: 'basic_physical',
    skillIds: ['combo_slash', 'whirlwind'],
    stats: { maxHp: 3780, maxMp: 600, physAtk: 355, magAtk: 200, defense: 90, speed: 70 },
  },
} satisfies Record<string, EnemyArchetype>;

/** 生成一个敌人；speed 用来覆盖原型速度（同种敌人速度略有差别） */
function enemy(
  id: string,
  row: Slot['row'],
  col: Slot['col'],
  archetype: EnemyArchetype,
  speed?: number,
): UnitTemplate {
  return {
    id,
    templateId: archetype.templateId,
    name: archetype.name,
    side: 'enemy',
    kind: 'enemy',
    classId: archetype.classId,
    rank: archetype.rank,
    slot: { row, col },
    attackMode: archetype.attackMode,
    basicAttackSkillId: archetype.basicAttackSkillId,
    skillIds: [...archetype.skillIds],
    stats: { ...archetype.stats, speed: speed ?? archetype.stats.speed },
  };
}

/** 敌方全部 10 个单位，顺序 E0..E9。前排 E0~E4，后排 E5~E9，Boss 在后排中央。 */
export const ENEMY_TEMPLATES: UnitTemplate[] = [
  enemy('E0', 0, 0, ARCHETYPES.skeleton, 80),
  enemy('E1', 0, 1, ARCHETYPES.skeleton, 82),
  enemy('E2', 0, 2, ARCHETYPES.fallenKnight, 75),
  enemy('E3', 0, 3, ARCHETYPES.skeleton, 84),
  enemy('E4', 0, 4, ARCHETYPES.skeleton, 86),
  enemy('E5', 1, 0, ARCHETYPES.demonPriestSeal),
  enemy('E6', 1, 1, ARCHETYPES.necromancer),
  enemy('E7', 1, 2, ARCHETYPES.abyssLord),
  enemy('E8', 1, 3, ARCHETYPES.fallenKnight, 78),
  enemy('E9', 1, 4, ARCHETYPES.demonPriestHeal),
];

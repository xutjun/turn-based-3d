// 友方阵容：5 个人物（后排）+ 5 个宝宝（前排，站在主人身前）。对应 DESIGN.md §8.3。
// 数值为初始值，步骤 8 可调平衡。技能列表（skillIds）在步骤 2 加入。

import type { ClassId, Slot, Stats, UnitTemplate, WeaponId } from '../core/types';
import { WEAPONS } from './weapons';

type Col = Slot['col'];

/** 人物：出手方式和普攻由武器决定 */
function hero(
  id: string,
  col: Col,
  name: string,
  classId: ClassId,
  weaponId: WeaponId,
  stats: Stats,
): UnitTemplate {
  const weapon = WEAPONS[weaponId];
  return {
    id,
    templateId: `hero_${weaponId}`,
    name,
    side: 'ally',
    kind: 'hero',
    classId,
    slot: { row: 1, col },
    weaponId,
    attackMode: weapon.attackMode,
    basicAttackSkillId: weapon.basicAttackSkillId,
    skillIds: [],
    stats,
  };
}

/** 宝宝：没有武器，出手方式和普攻直接写在模板里 */
function pet(
  id: string,
  col: Col,
  templateId: string,
  name: string,
  ownerId: string,
  classId: ClassId,
  attackMode: UnitTemplate['attackMode'],
  basicAttackSkillId: string,
  stats: Stats,
): UnitTemplate {
  return {
    id,
    templateId,
    name,
    side: 'ally',
    kind: 'pet',
    classId,
    ownerId,
    slot: { row: 0, col },
    attackMode,
    basicAttackSkillId,
    skillIds: [],
    stats,
  };
}

const s = (
  maxHp: number,
  maxMp: number,
  physAtk: number,
  magAtk: number,
  defense: number,
  speed: number,
): Stats => ({ maxHp, maxMp, physAtk, magAtk, defense, speed });

export const HERO_TEMPLATES: UnitTemplate[] = [
  //   id   列  名称    职业        武器      气血  魔法 物伤 法伤 防御 速度
  hero('A0', 0, '夜隼', 'physical', 'bow', s(950, 300, 150, 40, 45, 110)), // 自由职业：物理系弓手
  hero('A1', 1, '烬刃', 'physical', 'blade', s(1200, 300, 160, 40, 60, 90)),
  hero('A2', 2, '雷咒', 'magic', 'staff', s(850, 600, 40, 170, 35, 95)),
  hero('A3', 3, '缚魂', 'seal', 'sword', s(1000, 500, 110, 120, 50, 120)),
  hero('A4', 4, '守誓', 'heal', 'spear', s(1000, 600, 100, 140, 50, 85)),
];

export const PET_TEMPLATES: UnitTemplate[] = [
  pet('A5', 0, 'pet_wolf_grey', '影狼·灰', 'A0', 'physical', 'melee', 'basic_physical', s(650, 150, 110, 20, 40, 105)),
  pet('A6', 1, 'pet_wolf_red', '影狼·赤', 'A1', 'physical', 'melee', 'basic_physical', s(700, 150, 115, 20, 40, 100)),
  pet('A7', 2, 'pet_bone_dragon', '骨龙幼崽', 'A2', 'magic', 'cast', 'basic_magic', s(600, 300, 30, 120, 30, 90)),
  pet('A8', 3, 'pet_ghost', '幽灵', 'A3', 'seal', 'cast', 'basic_magic', s(600, 250, 30, 90, 30, 115)),
  pet('A9', 4, 'pet_golem', '魔偶', 'A4', 'heal', 'melee', 'basic_physical', s(900, 250, 80, 90, 60, 70)),
];

/** 友方全部 10 个单位，顺序 A0..A9 */
export const ALLY_TEMPLATES: UnitTemplate[] = [...HERO_TEMPLATES, ...PET_TEMPLATES];

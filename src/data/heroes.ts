// 友方阵容：5 个人物（后排）+ 5 个宝宝（前排，站在主人身前）。对应 DESIGN.md §8.3。
// 数值用 npm run balance 核对。人物的技能取职业技能库（classes.ts）；
// 宝宝只分物理型 / 法术型，职业、主动技能、被动技能由类型决定（pets.ts）。

import type { ClassId, Slot, Stats, UnitTemplate, WeaponId } from '../core/types';
import { heroSkillIds } from './classes';
import { PET_ASSIGNMENT, PET_TYPES } from './pets';
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
    skillIds: heroSkillIds(classId, weapon.attackMode),
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
  attackMode: UnitTemplate['attackMode'],
  basicAttackSkillId: string,
  stats: Stats,
): UnitTemplate {
  const assigned = PET_ASSIGNMENT[id];
  if (!assigned) throw new Error(`宝宝 ${id} 没有在 pets.ts 的 PET_ASSIGNMENT 里分配类型`);
  const type = PET_TYPES[assigned];
  const classId = type.classId;
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
    skillIds: [...type.skillIds],
    passiveIds: [...type.passiveIds],
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
  hero('A0', 0, '夜隼', 'physical', 'bow', s(950, 600, 195, 50, 45, 110)), // 自由职业：物理系弓手
  hero('A1', 1, '烬刃', 'physical', 'blade', s(1200, 600, 210, 50, 60, 90)),
  hero('A2', 2, '雷咒', 'magic', 'staff', s(850, 800, 50, 220, 35, 95)),
  hero('A3', 3, '缚魂', 'seal', 'sword', s(1000, 500, 145, 155, 50, 120)),
  hero('A4', 4, '守誓', 'heal', 'spear', s(1000, 800, 130, 180, 50, 85)),
];

export const PET_TEMPLATES: UnitTemplate[] = [
  pet('A5', 0, 'pet_wolf_grey', '影狼·灰', 'A0', 'melee', 'basic_physical', s(650, 150, 145, 25, 40, 105)),
  pet('A6', 1, 'pet_wolf_red', '影狼·赤', 'A1', 'melee', 'basic_physical', s(700, 150, 150, 25, 40, 100)),
  pet('A7', 2, 'pet_bone_dragon', '骨龙幼崽', 'A2', 'cast', 'basic_magic', s(600, 400, 40, 155, 30, 90)),
  pet('A8', 3, 'pet_ghost', '幽灵', 'A3', 'cast', 'basic_magic', s(600, 400, 40, 115, 30, 115)),
  pet('A9', 4, 'pet_golem', '魔偶', 'A4', 'melee', 'basic_physical', s(900, 250, 105, 115, 60, 70)),
];

/** 友方全部 10 个单位，顺序 A0..A9 */
export const ALLY_TEMPLATES: UnitTemplate[] = [...HERO_TEMPLATES, ...PET_TEMPLATES];

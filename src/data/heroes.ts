// 友方阵容：5 个人物（前排）+ 5 个宝宝（后排，站在主人身后一排）。对应 DESIGN.md §8.3、§11.7。
// 数值用 npm run balance 核对。人物的技能取职业技能库（classes.ts）；
// 宝宝只分物理型 / 法术型，职业、主动技能、被动技能由类型决定（pets.ts）。
//
// 步骤 17（v0.6 新阵型，SPEC §4）：人物站前排，骑士烬刃站正中，其余 4 人分在两侧；
// 前排从左到右的顺序写在 ALLY_LINEUP 里，人物和宝宝的列号都由它推出（宝宝与主人同列、在后排）。

import type { ClassId, Slot, Stats, UnitTemplate, WeaponId } from '../core/types';
import { heroSkillIds } from './classes';
import { PET_ASSIGNMENT, PET_TYPES } from './pets';
import { WEAPONS } from './weapons';

type Col = Slot['col'];

/**
 * 友方前排从左（col 0）到右（col 4）的人物顺序（步骤 17 新阵型，DESIGN §11.7）：
 * 夜隼、雷咒、烬刃（骑士，正中）、缚魂、守誓。宝宝站在主人身后一排的同一列。
 * 改这里即可换站位，战斗规则不变（只影响下指令顺序，DESIGN §9.10 F2）。
 */
export const ALLY_LINEUP: readonly string[] = ['A0', 'A2', 'A1', 'A3', 'A4'];
/** 人物站的排（0 = 前排，靠近敌方） */
export const HERO_ROW: Slot['row'] = 0;
/** 宝宝站的排（1 = 后排，主人身后） */
export const PET_ROW: Slot['row'] = 1;

/** 人物在前排的列号（由 ALLY_LINEUP 决定） */
function lineupCol(heroId: string): Col {
  const col = ALLY_LINEUP.indexOf(heroId);
  if (col < 0) throw new Error(`人物 ${heroId} 不在 ALLY_LINEUP 里`);
  return col as Col;
}

/** 人物：出手方式和普攻由武器决定 */
function hero(id: string, name: string, classId: ClassId, weaponId: WeaponId, stats: Stats): UnitTemplate {
  const weapon = WEAPONS[weaponId];
  return {
    id,
    templateId: `hero_${weaponId}`,
    name,
    side: 'ally',
    kind: 'hero',
    classId,
    slot: { row: HERO_ROW, col: lineupCol(id) },
    weaponId,
    attackMode: weapon.attackMode,
    basicAttackSkillId: weapon.basicAttackSkillId,
    skillIds: heroSkillIds(classId, weapon.attackMode),
    stats,
  };
}

/** 宝宝：没有武器，出手方式和普攻直接写在模板里；站在主人身后一排的同一列 */
function pet(
  id: string,
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
    slot: { row: PET_ROW, col: lineupCol(ownerId) },
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
  //   id   名称    职业        武器      气血  魔法 物伤 法伤 防御 速度（列号见 ALLY_LINEUP）
  hero('A0', '夜隼', 'physical', 'bow', s(950, 600, 195, 50, 45, 110)), // 自由职业：物理系弓手
  hero('A1', '烬刃', 'physical', 'blade', s(1200, 600, 210, 50, 60, 90)),
  hero('A2', '雷咒', 'magic', 'staff', s(850, 800, 50, 220, 35, 95)),
  hero('A3', '缚魂', 'seal', 'sword', s(1000, 500, 145, 155, 50, 120)),
  hero('A4', '守誓', 'heal', 'spear', s(1000, 800, 130, 180, 50, 85)),
];

export const PET_TEMPLATES: UnitTemplate[] = [
  pet('A5', 'pet_wolf_grey', '影狼·灰', 'A0', 'melee', 'basic_physical', s(650, 150, 145, 25, 40, 105)),
  pet('A6', 'pet_wolf_red', '影狼·赤', 'A1', 'melee', 'basic_physical', s(700, 150, 150, 25, 40, 100)),
  pet('A7', 'pet_bone_dragon', '骨龙幼崽', 'A2', 'cast', 'basic_magic', s(600, 400, 40, 155, 30, 90)),
  pet('A8', 'pet_ghost', '幽灵', 'A3', 'cast', 'basic_magic', s(600, 400, 40, 115, 30, 115)),
  pet('A9', 'pet_golem', '魔偶', 'A4', 'melee', 'basic_physical', s(900, 250, 105, 115, 60, 70)),
];

/** 友方全部 10 个单位，顺序 A0..A9 */
export const ALLY_TEMPLATES: UnitTemplate[] = [...HERO_TEMPLATES, ...PET_TEMPLATES];

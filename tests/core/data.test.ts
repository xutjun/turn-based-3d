import { describe, expect, it } from 'vitest';
import { BATTLE_CONFIG } from '../../src/data/battleConfig';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { isValidSlot, slotKey } from '../../src/data/formation';
import { SKILLS } from '../../src/data/skills';

describe('默认配置表', () => {
  const setup = createDefaultSetup(1);
  const allies = setup.units.filter((u) => u.side === 'ally');
  const enemies = setup.units.filter((u) => u.side === 'enemy');

  it('双方各 10 个单位，id 不重复', () => {
    expect(allies).toHaveLength(10);
    expect(enemies).toHaveLength(10);
    expect(new Set(setup.units.map((u) => u.id)).size).toBe(20);
  });

  it('每一方的格子都在 2×5 阵型内且不重复', () => {
    for (const side of [allies, enemies]) {
      for (const u of side) expect(isValidSlot(u.slot)).toBe(true);
      expect(new Set(side.map((u) => slotKey(u.slot))).size).toBe(10);
    }
  });

  it('友方 5 个人物在前排、各持不同武器；宝宝在主人身后一排', () => {
    const heroes = allies.filter((u) => u.kind === 'hero');
    const pets = allies.filter((u) => u.kind === 'pet');
    expect(heroes).toHaveLength(5);
    expect(pets).toHaveLength(5);
    expect(new Set(heroes.map((h) => h.weaponId)).size).toBe(5);
    for (const h of heroes) {
      expect(h.slot.row).toBe(0);
      const pet = pets.find((p) => p.id === h.petId)!;
      expect(pet.ownerId).toBe(h.id);
      expect(pet.slot).toEqual({ row: 1, col: h.slot.col });
    }
  });

  it('弓箭为远程物理、法杖为法术普攻、其余武器为近战物理', () => {
    const byWeapon = Object.fromEntries(allies.filter((u) => u.weaponId).map((u) => [u.weaponId, u]));
    expect(byWeapon['bow']).toMatchObject({ attackMode: 'ranged', basicAttackSkillId: 'basic_physical' });
    expect(byWeapon['staff']).toMatchObject({ attackMode: 'cast', basicAttackSkillId: 'basic_magic' });
    for (const w of ['blade', 'sword', 'spear']) {
      expect(byWeapon[w]).toMatchObject({ attackMode: 'melee', basicAttackSkillId: 'basic_physical' });
    }
  });

  it('敌方有且只有 1 个 Boss，敌方全部自动出手', () => {
    expect(enemies.filter((u) => u.rank === 'boss')).toHaveLength(1);
    expect(enemies.every((u) => u.autoCommand)).toBe(true);
    expect(allies.every((u) => !u.autoCommand)).toBe(true);
  });

  it('单位初始满气血、满魔法，引用的技能都存在', () => {
    for (const u of setup.units) {
      expect(u.hp).toBe(u.stats.maxHp);
      expect(u.mp).toBe(u.stats.maxMp);
      expect(u.alive).toBe(true);
      expect(SKILLS[u.basicAttackSkillId]).toBeDefined();
      for (const id of u.skillIds) expect(SKILLS[id]).toBeDefined();
    }
  });

  it('普攻命中率 0.95；全局系数与设计文档一致', () => {
    expect(SKILLS['basic_physical']!.hitRate).toBe(0.95);
    expect(SKILLS['basic_magic']!.hitRate).toBe(0.95);
    expect(BATTLE_CONFIG).toMatchObject({
      magicDefenseCoef: 0.5,
      varianceMin: 0.9,
      varianceMax: 1.1,
      defendDamageMult: 0.5,
    });
    for (const kind of ['physical', 'magic', 'heal'] as const) {
      expect(BATTLE_CONFIG.crit[kind]).toEqual({ rate: 0.1, multiplier: 1.5 });
    }
  });
});

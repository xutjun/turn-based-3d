import { describe, expect, it } from 'vitest';
import { BATTLE_CONFIG } from '../../src/data/battleConfig';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { isValidSlot, slotKey } from '../../src/data/formation';
import { CLASS_SKILLS, RANGED_VARIANTS } from '../../src/data/classes';
import { PASSIVES } from '../../src/data/passives';
import { PET_ASSIGNMENT, PET_TYPES } from '../../src/data/pets';
import { SKILLS } from '../../src/data/skills';
import { ALLY_LINEUP } from '../../src/data/heroes';

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

  it('新阵型（步骤 17）：友方 5 个人物在后排、各持不同武器；宝宝在主人正前方一排', () => {
    const heroes = allies.filter((u) => u.kind === 'hero');
    const pets = allies.filter((u) => u.kind === 'pet');
    expect(heroes).toHaveLength(5);
    expect(pets).toHaveLength(5);
    expect(new Set(heroes.map((h) => h.weaponId)).size).toBe(5);
    for (const h of heroes) {
      expect(h.slot.row).toBe(1);
      const pet = pets.find((p) => p.id === h.petId)!;
      expect(pet.ownerId).toBe(h.id);
      expect(pet.slot).toEqual({ row: 0, col: h.slot.col });
    }
  });

  it('新阵型（步骤 17）：骑士烬刃在后排正中，其余 4 人分在两侧，顺序按 ALLY_LINEUP', () => {
    const byId = Object.fromEntries(allies.map((u) => [u.id, u]));
    expect(byId['A1']!.name).toBe('烬刃');
    expect(byId['A1']!.slot).toEqual({ row: 1, col: 2 });
    expect(ALLY_LINEUP).toHaveLength(5);
    expect(new Set(ALLY_LINEUP).size).toBe(5);
    ALLY_LINEUP.forEach((id, col) => expect(byId[id]!.slot).toEqual({ row: 1, col }));
    // DESIGN §11.7 的表：夜隼、雷咒、烬刃、缚魂、守誓
    expect(ALLY_LINEUP.map((id) => byId[id]!.name)).toEqual(['夜隼', '雷咒', '烬刃', '缚魂', '守誓']);
    // 左右各两人
    expect(ALLY_LINEUP.slice(0, 2).length).toBe(2);
    expect(ALLY_LINEUP.slice(3).length).toBe(2);
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

describe('技能表合法性（DESIGN §4.1）', () => {
  const all = Object.values(SKILLS);

  it('SPEC 要求的技能都在表里，id 与名称不重复', () => {
    for (const id of ['combo_slash', 'triple_shot', 'whirlwind', 'arrow_rain', 'group_spell', 'triple_spell', 'single_spell', 'seal', 'group_heal', 'revive']) {
      expect(SKILLS[id], id).toBeDefined();
      expect(SKILLS[id]!.id).toBe(id);
    }
    expect(new Set(all.map((s) => s.name)).size).toBe(all.length);
    for (const s of all) expect(s.description.length, s.id).toBeGreaterThan(0);
  });

  it('执行模式与目标数、段数匹配', () => {
    for (const s of all) {
      if (s.pattern === 'single') expect([s.targetCount, s.hits], s.id).toEqual([1, 1]);
      else if (s.pattern === 'multiHit') {
        expect(s.targetCount, s.id).toBe(1);
        expect(s.hits, s.id).toBeGreaterThanOrEqual(2);
      } else {
        expect(s.targetCount, s.id).toBeGreaterThanOrEqual(2);
        expect(s.hits, s.id).toBe(1);
      }
      expect(s.hitRate, s.id).toBeGreaterThan(0);
      expect(s.hitRate, s.id).toBeLessThanOrEqual(1);
      expect(s.mpCost > 0, s.id).toBe(s.classId !== 'common'); // 只有普攻不耗魔法
    }
  });

  it('目标数符合 SPEC：连斩 1 个 3 段、旋风斩 7、群体法术 6、封印 1、治疗 3、复活 1', () => {
    expect(SKILLS['combo_slash']).toMatchObject({ targetCount: 1, hits: 3, pattern: 'multiHit' });
    expect(SKILLS['whirlwind']).toMatchObject({ targetCount: 7, pattern: 'sequential' });
    expect(SKILLS['group_spell']).toMatchObject({ targetCount: 6, pattern: 'simultaneous' });
    expect(SKILLS['seal']).toMatchObject({ targetCount: 1, status: { type: 'seal', duration: 3 } });
    expect(SKILLS['group_heal']).toMatchObject({ targetCount: 3, targetSide: 'ally', pattern: 'simultaneous' });
    expect(SKILLS['revive']).toMatchObject({ targetCount: 1, reviveHpRatio: 0.3 });
  });

  it('复活 ⇔ 目标为倒地的友方；物理技能有近战和远程两种动画，法术类技能有施法动画', () => {
    for (const s of all) {
      expect(s.effect === 'revive', s.id).toBe(s.targetState === 'dead');
      if (s.effect === 'revive') expect([s.targetSide, s.targetCount], s.id).toEqual(['ally', 1]);
      if (s.effect !== 'damage') expect(s.damageType, s.id).toBe('magic');
      if (s.effect === 'seal') expect(s.status, s.id).toBeDefined();
      if (s.damageType === 'physical') {
        expect(s.animation.melee, s.id).toBeDefined();
        expect(s.animation.ranged, s.id).toBeDefined();
      } else expect(s.animation.cast, s.id).toBeDefined();
    }
  });

  it('弓箭手版本与原技能数值完全相同，只是名称、说明不同；群体法术·烈焰已删除', () => {
    const numbers = (id: string) => {
      const { id: _id, name: _name, description: _d, element: _e, ...rest } = SKILLS[id]!;
      return rest;
    };
    expect(numbers('triple_shot')).toEqual(numbers('combo_slash'));
    expect(numbers('arrow_rain')).toEqual(numbers('whirlwind'));
    expect(SKILLS['group_spell_fire']).toBeUndefined();
  });

  it('三重魂火：法术型宝宝的主动技能，同时攻击 3 个单位，演出是群体法术的缩小版', () => {
    expect(SKILLS['triple_spell']).toMatchObject({
      classId: 'magic',
      effect: 'damage',
      damageType: 'magic',
      targetSide: 'enemy',
      targetCount: 3,
      pattern: 'simultaneous',
      hits: 1,
      animation: { cast: 'groupSpellSmall' },
    });
  });

  it('被动技能表：连击 = 普攻时 50% 追加 1 次攻击，字段齐全', () => {
    expect(PASSIVES['double_strike']).toMatchObject({
      name: '连击',
      trigger: 'basicAttack',
      chance: 0.5,
      effect: { kind: 'extraHit', hits: 1 },
    });
    for (const p of Object.values(PASSIVES)) {
      expect(p.chance).toBeGreaterThan(0);
      expect(p.chance).toBeLessThanOrEqual(1);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});

describe('单位的技能配置（DESIGN §4.3、§8.3）', () => {
  const setup = createDefaultSetup(1);
  const byId = Object.fromEntries(setup.units.map((u) => [u.id, u]));

  it('每个单位的技能都属于自己的职业技能库，且不含普攻', () => {
    for (const u of setup.units) {
      for (const id of u.skillIds) {
        expect(CLASS_SKILLS[u.classId], `${u.id} ${id}`).toContain(id);
        expect(SKILLS[id]!.classId, `${u.id} ${id}`).toBe(u.classId);
      }
    }
  });

  it('弓箭版技能只给远程单位，远程单位不拿近战版', () => {
    for (const u of setup.units) {
      for (const id of u.skillIds) {
        if (id in RANGED_VARIANTS) expect(u.attackMode, `${u.id} ${id}`).toBe('ranged');
        if (Object.values(RANGED_VARIANTS).includes(id)) expect(u.attackMode, `${u.id} ${id}`).not.toBe('ranged');
      }
    }
  });

  it('五个人物的技能', () => {
    expect(byId['A0']!.skillIds).toEqual(['triple_shot', 'arrow_rain']); // 弓
    expect(byId['A1']!.skillIds).toEqual(['combo_slash', 'whirlwind']); // 刀
    expect(byId['A2']!.skillIds).toEqual(['group_spell', 'single_spell']); // 法杖
    expect(byId['A3']!.skillIds).toEqual(['seal']);
    expect(byId['A4']!.skillIds).toEqual(['group_heal', 'revive']);
  });

  it('宝宝只分物理型 / 法术型：没有封印、治疗、复活；物理型无主动技能 + 被动连击，法术型只有三重魂火', () => {
    const pets = setup.units.filter((x) => x.kind === 'pet');
    expect(pets).toHaveLength(5);
    for (const u of pets) {
      const type = PET_TYPES[PET_ASSIGNMENT[u.id]!];
      expect(['physical', 'magic'], u.id).toContain(u.classId);
      expect(u.classId, u.id).toBe(type.classId);
      expect(u.skillIds, u.id).toEqual(type.skillIds);
      expect(u.passiveIds, u.id).toEqual(type.passiveIds);
      for (const id of u.skillIds) expect(['damage'], `${u.id} ${id}`).toContain(SKILLS[id]!.effect);
      for (const id of u.passiveIds) expect(PASSIVES[id], `${u.id} ${id}`).toBeDefined();
    }
    const physical = pets.filter((u) => u.classId === 'physical');
    const magic = pets.filter((u) => u.classId === 'magic');
    expect(physical.map((u) => u.id)).toEqual(['A5', 'A6', 'A9']);
    expect(magic.map((u) => u.id)).toEqual(['A7', 'A8']);
    for (const u of physical) expect([u.skillIds, u.passiveIds]).toEqual([[], ['double_strike']]);
    for (const u of magic) expect([u.skillIds, u.passiveIds]).toEqual([['triple_spell'], []]);
    // 人物和敌人没有被动技能
    for (const u of setup.units.filter((x) => x.kind !== 'pet')) expect(u.passiveIds, u.id).toEqual([]);
  });

  it('敌人没有复活，骷髅兵没有技能', () => {
    const enemies = setup.units.filter((x) => x.side === 'enemy');
    for (const u of enemies) expect(u.skillIds, u.id).not.toContain('revive');
    for (const u of enemies.filter((x) => x.rank === 'minion')) expect(u.skillIds).toEqual([]);
    expect(byId['E7']!.skillIds).toEqual(['combo_slash', 'whirlwind']);
  });

  it('开局每个单位的魔法至少够放一次自己的每个技能', () => {
    for (const u of setup.units) {
      for (const id of u.skillIds) expect(u.mp, `${u.id} ${id}`).toBeGreaterThanOrEqual(SKILLS[id]!.mpCost);
    }
  });
});

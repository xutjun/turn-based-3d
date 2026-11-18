import { describe, expect, it } from 'vitest';
import type { Stats } from '../../src/core/types';
import { BattleEngine } from '../../src/core/battle';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { EQUIP_SLOTS, EQUIPMENT, HERO_BASE_STATS, HERO_LOADOUT, STAT_KEYS } from '../../src/data/equipment';
import { ALLY_TEMPLATES, HERO_TEMPLATES, PET_TEMPLATES } from '../../src/data/heroes';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { addStats, equipmentBonus, heroBaseStats, heroEquipment, heroFinalStats, statBreakdown } from '../../src/growth/stats';

// 步骤 22：人物最终属性 = 基础属性 + 装备加成，与改动前（步骤 19）的战斗属性逐项相等；装备表合法性。

/** 改动前（步骤 19，heroes.ts 里的字面值）的人物战斗属性 */
const LEGACY_HERO_STATS: Record<string, Stats> = {
  A0: { maxHp: 950, maxMp: 600, physAtk: 195, magAtk: 50, defense: 45, speed: 110 },
  A1: { maxHp: 1200, maxMp: 600, physAtk: 210, magAtk: 50, defense: 60, speed: 90 },
  A2: { maxHp: 850, maxMp: 800, physAtk: 50, magAtk: 220, defense: 35, speed: 95 },
  A3: { maxHp: 1000, maxMp: 500, physAtk: 145, magAtk: 155, defense: 50, speed: 120 },
  A4: { maxHp: 1000, maxMp: 800, physAtk: 130, magAtk: 180, defense: 50, speed: 85 },
};

/** 改动前的宝宝属性（宝宝没有装备，保持不变） */
const LEGACY_PET_STATS: Record<string, Stats> = {
  A5: { maxHp: 650, maxMp: 150, physAtk: 145, magAtk: 25, defense: 40, speed: 105 },
  A6: { maxHp: 700, maxMp: 150, physAtk: 150, magAtk: 25, defense: 40, speed: 100 },
  A7: { maxHp: 600, maxMp: 400, physAtk: 40, magAtk: 155, defense: 30, speed: 90 },
  A8: { maxHp: 600, maxMp: 400, physAtk: 40, magAtk: 115, defense: 30, speed: 115 },
  A9: { maxHp: 900, maxMp: 250, physAtk: 105, magAtk: 115, defense: 60, speed: 70 },
};

describe('基础 + 装备 = 改动前的战斗属性', () => {
  for (const [id, legacy] of Object.entries(LEGACY_HERO_STATS)) {
    it(`${id}：heroFinalStats 与步骤 19 的数值逐项相等`, () => {
      expect(heroFinalStats(id)).toEqual(legacy);
      expect(addStats(heroBaseStats(id), equipmentBonus(id))).toEqual(legacy);
      for (const k of STAT_KEYS) {
        const b = statBreakdown(id, k);
        expect(b.base + b.equipment).toBe(legacy[k]);
        expect(b.total).toBe(legacy[k]);
      }
    });
  }

  it('人物模板（heroes.ts）用的就是计算后的最终属性', () => {
    for (const t of HERO_TEMPLATES) expect(t.stats).toEqual(LEGACY_HERO_STATS[t.id]);
  });

  it('战斗引擎接收的最终数值与改动前完全一致（人物、宝宝；开场满血满蓝）', () => {
    const units = new BattleEngine(createDefaultSetup(7)).getState().units;
    for (const [id, legacy] of Object.entries({ ...LEGACY_HERO_STATS, ...LEGACY_PET_STATS })) {
      expect(units[id]!.stats, id).toEqual(legacy);
      expect(units[id]!.hp).toBe(legacy.maxHp);
      expect(units[id]!.mp).toBe(legacy.maxMp);
    }
  });

  it('宝宝和敌方没有装备：宝宝属性保持原值，敌方不在基础属性表 / 穿戴表里', () => {
    for (const t of PET_TEMPLATES) expect(t.stats).toEqual(LEGACY_PET_STATS[t.id]);
    for (const t of [...PET_TEMPLATES, ...ENEMY_TEMPLATES]) {
      expect(HERO_BASE_STATS[t.id], t.id).toBeUndefined();
      expect(HERO_LOADOUT[t.id], t.id).toBeUndefined();
    }
    expect(ALLY_TEMPLATES).toHaveLength(10);
  });
});

describe('装备表合法性', () => {
  it('共 30 件：5 名人物各 6 个部位齐全、每个部位恰好 1 件', () => {
    expect(EQUIPMENT).toHaveLength(30);
    for (const t of HERO_TEMPLATES) {
      const own = EQUIPMENT.filter((e) => e.ownerId === t.id);
      expect(own.map((e) => e.slot).sort(), t.id).toEqual([...EQUIP_SLOTS].sort());
      const worn = heroEquipment(t.id);
      for (const slot of EQUIP_SLOTS) {
        expect(worn[slot].slot).toBe(slot);
        expect(worn[slot].ownerId).toBe(t.id);
      }
    }
  });

  it('等级全部为 10；id、名称不重复；名称非空；套装名每人一个', () => {
    expect(new Set(EQUIPMENT.map((e) => e.id)).size).toBe(30);
    expect(new Set(EQUIPMENT.map((e) => e.name)).size).toBe(30);
    for (const e of EQUIPMENT) {
      expect(e.level, e.id).toBe(10);
      expect(e.name.length).toBeGreaterThan(0);
    }
    for (const t of HERO_TEMPLATES) expect(new Set(EQUIPMENT.filter((e) => e.ownerId === t.id).map((e) => e.setName)).size).toBe(1);
  });

  it('加成都是正整数，只出现 6 种属性；每件至少一项加成', () => {
    for (const e of EQUIPMENT) {
      const keys = Object.keys(e.bonus);
      expect(keys.length, e.id).toBeGreaterThan(0);
      for (const k of keys) {
        expect(STAT_KEYS).toContain(k);
        const v = e.bonus[k as keyof Stats]!;
        expect(Number.isInteger(v) && v > 0, `${e.id}.${k}`).toBe(true);
      }
    }
  });

  it('基础属性都是正整数；速度只由鞋子提供，基础速度的大小顺序与最终速度相同', () => {
    for (const [id, base] of Object.entries(HERO_BASE_STATS)) {
      for (const k of STAT_KEYS) expect(Number.isInteger(base[k]) && base[k] > 0, `${id}.${k}`).toBe(true);
    }
    for (const e of EQUIPMENT) if (e.bonus.speed) expect(e.slot).toBe('boots');
    const order = (f: (id: string) => number): string[] => HERO_TEMPLATES.map((t) => t.id).sort((a, b) => f(b) - f(a));
    expect(order((id) => heroBaseStats(id).speed)).toEqual(order((id) => heroFinalStats(id).speed));
  });
});

import { describe, expect, it } from 'vitest';
import type { WeaponId } from '../../src/core/types';
import { ASSET_KEYS } from '../../src/data/assetKeys';
import { HERO_TEMPLATES } from '../../src/data/heroes';
import { WEAPON_MODELS } from '../../src/data/unitModels';
import { STAFF_ELEMENT_COLORS, WEAPONS } from '../../src/data/weapons';

const IDS: WeaponId[] = ['blade', 'sword', 'spear', 'staff', 'bow'];

describe('武器发光配置', () => {
  it('5 种武器都有合法的发光参数', () => {
    for (const id of IDS) {
      const g = WEAPONS[id].glow;
      expect(g.color, id).toBeGreaterThan(0);
      expect(g.accentColor, id).toBeGreaterThan(0);
      expect(g.intensity, id).toBeGreaterThan(1); // 要亮到能触发 Bloom
      expect(g.breathHz, id).toBeGreaterThan(0);
      expect(g.breathDepth, id).toBeGreaterThanOrEqual(0);
      expect(g.breathDepth, id).toBeLessThan(1); // 呼吸到最暗时也不能熄灭
      expect(g.flareBoost, id).toBeGreaterThan(1); // 出手瞬间必须比平时亮
      expect(g.flareDecay, id).toBeGreaterThan(0);
      expect(g.haloSize, id).toBeGreaterThan(0);
      expect(g.particleCount, id).toBeGreaterThanOrEqual(0);
    }
  });

  it('5 种武器的主发光色互不相同', () => {
    expect(new Set(IDS.map((id) => WEAPONS[id].glow.color)).size).toBe(5);
  });

  it('法杖有火、雷、封印、治疗四种元素配色', () => {
    expect(Object.keys(STAFF_ELEMENT_COLORS).sort()).toEqual(['fire', 'heal', 'seal', 'thunder']);
  });

  it('每种武器都配置了模型，资源键各不相同', () => {
    const keys = IDS.map((id) => WEAPON_MODELS[id].assetKey);
    expect(new Set(keys).size).toBe(5);
    for (const key of keys) expect(Object.values(ASSET_KEYS)).toContain(key);
  });

  it('友方 5 个人物的武器都有对应模型', () => {
    for (const hero of HERO_TEMPLATES) {
      expect(hero.weaponId, hero.id).toBeDefined();
      expect(WEAPON_MODELS[hero.weaponId!], hero.id).toBeDefined();
    }
  });
});

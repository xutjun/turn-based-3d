import { describe, expect, it } from 'vitest';
import { ASSET_KEYS } from '../../src/data/assetKeys';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { UNIT_MODELS } from '../../src/data/unitModels';

describe('单位外观配置', () => {
  const templates = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES];
  const keys = Object.values(ASSET_KEYS) as string[];

  it('场上 20 个单位都配置了正式模型，不再使用占位体', () => {
    expect(templates).toHaveLength(20);
    for (const t of templates) {
      const def = UNIT_MODELS[t.templateId];
      expect(def, `${t.id} ${t.templateId}`).toBeDefined();
      expect(keys, t.templateId).toContain(def!.assetKey);
      expect(def!.assetKey).not.toBe(ASSET_KEYS.placeholderUnit);
    }
  });

  it('人物、宝宝、敌人分别使用对应分类的资源键', () => {
    for (const t of templates) {
      const prefix = t.kind === 'hero' ? 'unit.hero.' : t.kind === 'pet' ? 'unit.pet.' : 'unit.enemy.';
      expect(UNIT_MODELS[t.templateId]!.assetKey.startsWith(prefix), t.templateId).toBe(true);
    }
  });

  it('4 种宝宝形象和 5 种敌人（含 Boss）都有模型', () => {
    const used = new Set(templates.map((t) => UNIT_MODELS[t.templateId]!.assetKey));
    for (const key of [
      ASSET_KEYS.petWolf,
      ASSET_KEYS.petBoneDragon,
      ASSET_KEYS.petGhost,
      ASSET_KEYS.petGolem,
      ASSET_KEYS.enemySkeleton,
      ASSET_KEYS.enemyFallenKnight,
      ASSET_KEYS.enemyDemonPriest,
      ASSET_KEYS.enemyNecromancer,
      ASSET_KEYS.enemyAbyssLord,
    ]) {
      expect(used.has(key), key).toBe(true);
    }
  });
});

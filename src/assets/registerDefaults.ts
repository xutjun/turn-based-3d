// 注册全部内置的程序化资源。资源键定义在 data/assetKeys.ts。

import { ASSET_KEYS } from '../data/assetKeys';
import { WEAPON_MODELS } from '../data/unitModels';
import { AssetRegistry } from './AssetRegistry';
import {
  buildAbyssLord,
  buildDemonPriest,
  buildFallenKnight,
  buildHealer,
  buildKnight,
  buildMage,
  buildNecromancer,
  buildRanger,
  buildSealer,
  buildSkeletonSoldier,
} from './models/characters';
import { buildBoneDragon, buildGhost, buildGolem, buildShadowWolf } from './models/creatures';
import { buildPlaceholderUnit } from './models/placeholder';
import {
  buildBladeWithGlow,
  buildBowWithGlow,
  buildSpearWithGlow,
  buildStaffWithGlow,
  buildSwordWithGlow,
} from './models/weapons';
import {
  buildBanner,
  buildBonePile,
  buildBrazier,
  buildBrokenPillar,
  buildFallenDrum,
  buildRubble,
} from './models/props';

export { ASSET_KEYS };

export function createDefaultRegistry(): AssetRegistry {
  const registry = new AssetRegistry();
  // 场景物件
  registry.register(ASSET_KEYS.pillar, buildBrokenPillar, { label: '残破石柱', category: 'prop' });
  registry.register(ASSET_KEYS.fallenDrum, buildFallenDrum, { label: '倒地断柱', category: 'prop' });
  registry.register(ASSET_KEYS.rubble, buildRubble, { label: '碎石', category: 'prop' });
  registry.register(ASSET_KEYS.bonePile, buildBonePile, { label: '骨堆', category: 'prop' });
  registry.register(ASSET_KEYS.brazier, buildBrazier, { label: '火盆', category: 'prop' });
  registry.register(ASSET_KEYS.banner, buildBanner, { label: '旗帜', category: 'prop' });
  registry.register(ASSET_KEYS.placeholderUnit, buildPlaceholderUnit, { label: '占位体', category: 'placeholder' });
  // 友方人物（previewWeapon：预览页里手持的武器，与 data/heroes.ts 的武器分配一致）
  const held = (id: keyof typeof WEAPON_MODELS): { key: string; params?: unknown } => {
    const def = WEAPON_MODELS[id];
    return { key: def.assetKey, params: def.params };
  };
  registry.register(ASSET_KEYS.heroKnight, buildKnight, {
    label: '重甲骑士（物理系）',
    category: 'hero',
    previewWeapon: held('blade'),
  });
  registry.register(ASSET_KEYS.heroMage, buildMage, {
    label: '法师（法术系）',
    category: 'hero',
    previewWeapon: held('staff'),
  });
  registry.register(ASSET_KEYS.heroSealer, buildSealer, {
    label: '缚魂祭司（封印系）',
    category: 'hero',
    previewWeapon: held('sword'),
  });
  registry.register(ASSET_KEYS.heroHealer, buildHealer, {
    label: '守誓者（恢复系）',
    category: 'hero',
    previewWeapon: held('spear'),
  });
  registry.register(ASSET_KEYS.heroRanger, buildRanger, {
    label: '游侠弓手（自由职业）',
    category: 'hero',
    previewWeapon: held('bow'),
  });
  // 友方发光武器
  registry.register(ASSET_KEYS.weaponBlade, buildBladeWithGlow, { label: '刀 · 熔岩流光', category: 'weapon' });
  registry.register(ASSET_KEYS.weaponSword, buildSwordWithGlow, { label: '剑 · 符文光带', category: 'weapon' });
  registry.register(ASSET_KEYS.weaponSpear, buildSpearWithGlow, { label: '枪 · 金芒缠纹', category: 'weapon' });
  registry.register(ASSET_KEYS.weaponStaff, buildStaffWithGlow, {
    label: '法杖 · 悬浮宝珠',
    category: 'weapon',
    previewParams: { element: 'thunder' },
  });
  registry.register(ASSET_KEYS.weaponBow, buildBowWithGlow, {
    label: '弓 · 能量弓弦',
    category: 'weapon',
    previewParams: { arrowNocked: true },
  });
  // 宝宝
  registry.register(ASSET_KEYS.petWolf, buildShadowWolf, { label: '暗影狼（物理系宝宝）', category: 'pet' });
  registry.register(ASSET_KEYS.petBoneDragon, buildBoneDragon, { label: '骨龙幼崽（法术系宝宝）', category: 'pet' });
  registry.register(ASSET_KEYS.petGhost, buildGhost, { label: '幽灵（封印系宝宝）', category: 'pet' });
  registry.register(ASSET_KEYS.petGolem, buildGolem, { label: '魔偶（恢复系宝宝）', category: 'pet' });
  // 敌人与 Boss
  registry.register(ASSET_KEYS.enemySkeleton, buildSkeletonSoldier, { label: '骷髅兵', category: 'enemy' });
  registry.register(ASSET_KEYS.enemyFallenKnight, buildFallenKnight, { label: '堕落骑士', category: 'enemy' });
  registry.register(ASSET_KEYS.enemyDemonPriest, buildDemonPriest, { label: '恶魔祭司', category: 'enemy' });
  registry.register(ASSET_KEYS.enemyNecromancer, buildNecromancer, { label: '亡灵法师', category: 'enemy' });
  registry.register(ASSET_KEYS.enemyAbyssLord, buildAbyssLord, { label: '深渊魔将（Boss）', category: 'enemy' });
  return registry;
}

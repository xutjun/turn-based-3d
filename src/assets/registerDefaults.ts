// 注册全部内置的程序化资源。资源键定义在 data/assetKeys.ts。

import { ASSET_KEYS } from '../data/assetKeys';
import { AssetRegistry } from './AssetRegistry';
import { buildHealer, buildKnight, buildMage, buildRanger, buildSealer } from './models/characters';
import { buildPlaceholderUnit } from './models/placeholder';
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
  // 友方人物
  registry.register(ASSET_KEYS.heroKnight, buildKnight, { label: '重甲骑士（物理系）', category: 'hero' });
  registry.register(ASSET_KEYS.heroMage, buildMage, { label: '法师（法术系）', category: 'hero' });
  registry.register(ASSET_KEYS.heroSealer, buildSealer, { label: '缚魂祭司（封印系）', category: 'hero' });
  registry.register(ASSET_KEYS.heroHealer, buildHealer, { label: '守誓者（恢复系）', category: 'hero' });
  registry.register(ASSET_KEYS.heroRanger, buildRanger, { label: '游侠弓手（自由职业）', category: 'hero' });
  return registry;
}

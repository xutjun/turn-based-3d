// 注册全部内置的程序化资源。资源键的命名：'prop.*' 场景物件，'unit.*' 单位。

import { AssetRegistry } from './AssetRegistry';
import { buildPlaceholderUnit } from './models/placeholder';
import {
  buildBanner,
  buildBonePile,
  buildBrazier,
  buildBrokenPillar,
  buildFallenDrum,
  buildRubble,
} from './models/props';

export const ASSET_KEYS = {
  pillar: 'prop.pillar',
  fallenDrum: 'prop.fallenDrum',
  rubble: 'prop.rubble',
  bonePile: 'prop.bonePile',
  brazier: 'prop.brazier',
  banner: 'prop.banner',
  placeholderUnit: 'unit.placeholder',
} as const;

export function createDefaultRegistry(): AssetRegistry {
  const registry = new AssetRegistry();
  registry.register(ASSET_KEYS.pillar, buildBrokenPillar);
  registry.register(ASSET_KEYS.fallenDrum, buildFallenDrum);
  registry.register(ASSET_KEYS.rubble, buildRubble);
  registry.register(ASSET_KEYS.bonePile, buildBonePile);
  registry.register(ASSET_KEYS.brazier, buildBrazier);
  registry.register(ASSET_KEYS.banner, buildBanner);
  registry.register(ASSET_KEYS.placeholderUnit, buildPlaceholderUnit);
  return registry;
}

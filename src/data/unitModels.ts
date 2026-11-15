// 单位外观配置：单位模板（templateId）→ 使用哪个模型，以及传给模型 builder 的外观参数。
// 想调整某个角色的颜色或比例，在 params 里覆盖对应 builder 的默认值即可，例如：
//   hero_blade: { assetKey: ASSET_KEYS.heroKnight, params: { clothColor: 0x123456, scale: 1.1 } }
// 没有列在这里的单位使用占位体。
// 以后换成真实 glb 模型时，只需把同一个资源键注册成加载 glb 的工厂，这里不用改。

import type { WeaponId } from '../core/types';
import { ASSET_KEYS, type AssetKey } from './assetKeys';
import type { IdleStyleId } from './idleConfig';

export interface UnitModelDef {
  assetKey: AssetKey;
  params?: Record<string, unknown>;
  /** 待机动画的风格（见 data/idleConfig.ts）；不填按 'stiff' */
  idle?: IdleStyleId;
}

/** 某个模型（资源键）的待机风格：预览页没有单位模板，按资源键查 */
export function idleStyleOfAsset(assetKey: string): IdleStyleId | undefined {
  return Object.values(UNIT_MODELS).find((d) => d.assetKey === assetKey)?.idle;
}

export const UNIT_MODELS: Record<string, UnitModelDef> = {
  hero_blade: { assetKey: ASSET_KEYS.heroKnight, idle: 'stiff' }, // 烬刃：物理系重甲骑士
  hero_staff: { assetKey: ASSET_KEYS.heroMage, idle: 'flowing' }, // 雷咒：法术系法师
  hero_sword: { assetKey: ASSET_KEYS.heroSealer, idle: 'flowing' }, // 缚魂：封印系祭司
  hero_spear: { assetKey: ASSET_KEYS.heroHealer, idle: 'flowing' }, // 守誓：恢复系
  hero_bow: { assetKey: ASSET_KEYS.heroRanger, idle: 'nimble' }, // 夜隼：自由职业弓手
  // 宝宝（体型约为人物的 0.6 倍）
  pet_wolf_grey: { assetKey: ASSET_KEYS.petWolf, idle: 'beast' }, // 影狼·灰
  pet_wolf_red: {
    assetKey: ASSET_KEYS.petWolf, // 影狼·赤：同一个模型换毛色
    idle: 'beast',
    params: { furColor: 0xb8562c, bellyColor: 0xdc9a5c, maneColor: 0x4a1a0e, eyeColor: 0xffc03a },
  },
  pet_bone_dragon: { assetKey: ASSET_KEYS.petBoneDragon, idle: 'winged' },
  pet_ghost: { assetKey: ASSET_KEYS.petGhost, idle: 'spectral' },
  pet_golem: { assetKey: ASSET_KEYS.petGolem, idle: 'construct' },
  // 敌人（精英略大，Boss 约 2 倍；比例在各 builder 的默认 scale 里，可在 params 覆盖）
  enemy_skeleton: { assetKey: ASSET_KEYS.enemySkeleton, idle: 'rattle' },
  enemy_fallen_knight: { assetKey: ASSET_KEYS.enemyFallenKnight, idle: 'stiff' },
  enemy_demon_priest: { assetKey: ASSET_KEYS.enemyDemonPriest, idle: 'flowing' },
  enemy_necromancer: { assetKey: ASSET_KEYS.enemyNecromancer, idle: 'flowing' },
  enemy_abyss_lord: { assetKey: ASSET_KEYS.enemyAbyssLord, idle: 'overlord' },
};

/**
 * 武器外观配置：武器 id → 使用哪个模型，以及传给武器 builder 的外观参数。
 * 发光颜色、强度、呼吸频率在 data/weapons.ts 的 glow 里调；这里只放形状、比例等覆盖项，例如：
 *   blade: { assetKey: ASSET_KEYS.weaponBlade, params: { length: 1.1, curve: 0.2 } }
 */
export const WEAPON_MODELS: Record<WeaponId, UnitModelDef> = {
  blade: { assetKey: ASSET_KEYS.weaponBlade },
  sword: { assetKey: ASSET_KEYS.weaponSword },
  spear: { assetKey: ASSET_KEYS.weaponSpear },
  staff: { assetKey: ASSET_KEYS.weaponStaff, params: { element: 'thunder' } }, // 雷咒：雷系法师
  bow: { assetKey: ASSET_KEYS.weaponBow },
};

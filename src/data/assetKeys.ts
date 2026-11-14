// 资源键：模型在 AssetRegistry 里的名字。配置表通过这些键引用模型，不直接依赖模型代码。
// 命名：'prop.*' 场景物件，'unit.hero.*' 友方人物，'unit.pet.*' 宝宝，'unit.enemy.*' 敌人，'weapon.*' 武器。

export const ASSET_KEYS = {
  pillar: 'prop.pillar',
  fallenDrum: 'prop.fallenDrum',
  rubble: 'prop.rubble',
  bonePile: 'prop.bonePile',
  brazier: 'prop.brazier',
  banner: 'prop.banner',
  placeholderUnit: 'unit.placeholder',
  heroKnight: 'unit.hero.knight',
  heroMage: 'unit.hero.mage',
  heroSealer: 'unit.hero.sealer',
  heroHealer: 'unit.hero.healer',
  heroRanger: 'unit.hero.ranger',
  petWolf: 'unit.pet.wolf',
  petBoneDragon: 'unit.pet.boneDragon',
  petGhost: 'unit.pet.ghost',
  petGolem: 'unit.pet.golem',
  enemySkeleton: 'unit.enemy.skeleton',
  enemyFallenKnight: 'unit.enemy.fallenKnight',
  enemyDemonPriest: 'unit.enemy.demonPriest',
  enemyNecromancer: 'unit.enemy.necromancer',
  enemyAbyssLord: 'unit.enemy.abyssLord',
  weaponBlade: 'weapon.blade',
  weaponSword: 'weapon.sword',
  weaponSpear: 'weapon.spear',
  weaponStaff: 'weapon.staff',
  weaponBow: 'weapon.bow',
} as const;

export type AssetKey = (typeof ASSET_KEYS)[keyof typeof ASSET_KEYS];

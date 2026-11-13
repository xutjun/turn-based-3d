// 单位外观配置：单位模板（templateId）→ 使用哪个模型，以及传给模型 builder 的外观参数。
// 想调整某个角色的颜色或比例，在 params 里覆盖对应 builder 的默认值即可，例如：
//   hero_blade: { assetKey: ASSET_KEYS.heroKnight, params: { clothColor: 0x123456, scale: 1.1 } }
// 没有列在这里的单位（宝宝、敌人在步骤 4c 完成前）使用占位体。
// 以后换成真实 glb 模型时，只需把同一个资源键注册成加载 glb 的工厂，这里不用改。

import { ASSET_KEYS, type AssetKey } from './assetKeys';

export interface UnitModelDef {
  assetKey: AssetKey;
  params?: Record<string, unknown>;
}

export const UNIT_MODELS: Record<string, UnitModelDef> = {
  hero_blade: { assetKey: ASSET_KEYS.heroKnight }, // 烬刃：物理系重甲骑士
  hero_staff: { assetKey: ASSET_KEYS.heroMage }, // 雷咒：法术系法师
  hero_sword: { assetKey: ASSET_KEYS.heroSealer }, // 缚魂：封印系祭司
  hero_spear: { assetKey: ASSET_KEYS.heroHealer }, // 守誓：恢复系
  hero_bow: { assetKey: ASSET_KEYS.heroRanger }, // 夜隼：自由职业弓手
};

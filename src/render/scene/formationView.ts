// 阵型显示：把 20 个单位的模型摆到阵型配置给出的位置上，朝向对方。
// 位置和朝向全部来自 data/formation.ts，改配置后这里自动跟着变。

import { Group, type Object3D } from 'three';
import type { AssetRegistry } from '../../assets/AssetRegistry';
import { equipWeapon } from '../../assets/models/weapons';
import type { PlaceholderParams } from '../../assets/models/placeholder';
import { ASSET_KEYS } from '../../assets/registerDefaults';
import type { UnitId, UnitTemplate } from '../../core/types';
import { facingYawOf, slotPosition } from '../../data/formation';
import { getRig } from '../../assets/models/characters/rig';
import { mergeStaticMeshes } from '../../assets/optimize';
import { allAnimatedJoints, enableLegJoints, JOINT_PREFIX } from '../units/animatedJoints';
import { PLACEHOLDER_CONFIG, RENDER_OPTIMIZE } from '../../data/renderConfig';
import { UNIT_MODELS, WEAPON_MODELS } from '../../data/unitModels';

export interface FormationView {
  group: Group;
  /** 单位 id → 场上的模型，UnitView 用它驱动动画 */
  units: Map<UnitId, Object3D>;
}

/** 占位体高度：宝宝约 0.6 倍，精英略大，Boss 约 2 倍 */
function placeholderHeight(t: UnitTemplate): number {
  const c = PLACEHOLDER_CONFIG;
  if (t.kind === 'pet') return c.heroHeight * c.petScale;
  if (t.rank === 'boss') return c.heroHeight * c.bossScale;
  if (t.rank === 'elite') return c.heroHeight * c.eliteScale;
  return c.heroHeight;
}

/** 创建一个单位的模型：外观配置里有正式模型就用正式模型，否则用占位体。头顶条由界面层（ui/hud）绘制 */
function createUnitModel(registry: AssetRegistry, t: UnitTemplate): Object3D {
  const def = UNIT_MODELS[t.templateId];
  if (def && registry.has(def.assetKey)) {
    const model = registry.create(def.assetKey, def.params ?? {});
    // 会走路的人形：腿部关节要在合并网格之前登记（步骤 14）
    if (def.walk) enableLegJoints(model);
    // 人物手持发光武器
    const weaponDef = t.weaponId ? WEAPON_MODELS[t.weaponId] : undefined;
    if (weaponDef && registry.has(weaponDef.assetKey)) {
      equipWeapon(model, registry.create(weaponDef.assetKey, weaponDef.params ?? {}));
    }
    return model;
  }
  const params: PlaceholderParams = {
    side: t.side,
    kind: t.kind,
    height: placeholderHeight(t),
    bodyColor: PLACEHOLDER_CONFIG.classColor[t.classId],
    sideColor: PLACEHOLDER_CONFIG.sideColor[t.side],
    hpBarGap: PLACEHOLDER_CONFIG.hpBarGap,
  };
  return registry.create(ASSET_KEYS.placeholderUnit, params);
}

/**
 * 合并一个单位模型里不会单独运动的网格。
 * 只有登记在 units/animatedJoints.ts 里的关节作为边界：人形的肩、肘、腰、胸、头，
 * 以及待机动画会转的额外关节（宝宝的头、尾、翅膀 …，Boss 的双翼）；其余关节下的部件并进上一级。
 */
function mergeUnitMeshes(model: Object3D): void {
  const moving = new Set<Object3D>(Object.values(allAnimatedJoints(model, getRig(model))));
  mergeStaticMeshes(model, {
    isStatic: (node) => node.name.startsWith(JOINT_PREFIX) && !moving.has(node),
    shadowLayer: RENDER_OPTIMIZE.shadowLayer,
  });
}

export function createFormationView(registry: AssetRegistry, templates: readonly UnitTemplate[]): FormationView {
  const group = new Group();
  group.name = 'formation';
  const units = new Map<UnitId, Object3D>();

  for (const t of templates) {
    const obj = createUnitModel(registry, t);
    // 合并不会单独运动的小网格，减少绘制调用（外观和动画不变）
    if (RENDER_OPTIMIZE.mergeStaticMeshes) mergeUnitMeshes(obj);
    const pos = slotPosition(t.side, t.slot);
    obj.position.set(pos.x, 0, pos.z);
    obj.rotation.y = facingYawOf(t.side);
    obj.name = `unit:${t.id}`;
    obj.userData['unitId'] = t.id;
    units.set(t.id, obj);
    group.add(obj);
  }
  return { group, units };
}

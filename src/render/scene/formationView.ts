// 阵型显示：把 20 个单位的占位体摆到阵型配置给出的位置上，朝向对方。
// 位置和朝向全部来自 data/formation.ts，改配置后这里自动跟着变。

import { Group, type Object3D } from 'three';
import type { AssetRegistry } from '../../assets/AssetRegistry';
import type { PlaceholderParams } from '../../assets/models/placeholder';
import { ASSET_KEYS } from '../../assets/registerDefaults';
import type { UnitId, UnitTemplate } from '../../core/types';
import { facingYawOf, slotPosition } from '../../data/formation';
import { PLACEHOLDER_CONFIG } from '../../data/renderConfig';

export interface FormationView {
  group: Group;
  /** 单位 id → 场上的模型，步骤 5 用它驱动动画 */
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

export function createFormationView(registry: AssetRegistry, templates: readonly UnitTemplate[]): FormationView {
  const group = new Group();
  group.name = 'formation';
  const units = new Map<UnitId, Object3D>();

  for (const t of templates) {
    const params: PlaceholderParams = {
      side: t.side,
      kind: t.kind,
      height: placeholderHeight(t),
      bodyColor: PLACEHOLDER_CONFIG.classColor[t.classId],
      sideColor: PLACEHOLDER_CONFIG.sideColor[t.side],
      hpBarGap: PLACEHOLDER_CONFIG.hpBarGap,
    };
    const obj = registry.create(ASSET_KEYS.placeholderUnit, params);
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

// 由单位模板生成参战单位（对应 DESIGN.md §1.2 的 setup.ts）。
// 逻辑层不直接引用配置表，模板由调用方传入。

import type { BattleSettings, Unit, UnitTemplate } from './types';

/** 把模板补上运行时字段：满气血、满魔法、存活、无状态 */
export function createUnits(templates: readonly UnitTemplate[], settings: BattleSettings): Unit[] {
  const units: Unit[] = templates.map((t) => ({
    ...t,
    slot: { ...t.slot },
    stats: { ...t.stats },
    skillIds: [...t.skillIds],
    passiveIds: [...(t.passiveIds ?? [])],
    hp: t.stats.maxHp,
    mp: t.stats.maxMp,
    alive: true,
    statuses: [],
    defending: false,
    // 敌方由 AI 控制；宝宝取设置项；人物由玩家控制
    autoCommand: t.side === 'enemy' ? true : t.kind === 'pet' ? settings.petAutoCommand : false,
  }));
  // 根据宝宝的 ownerId 给主人填上 petId
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const u of units) {
    if (u.ownerId === undefined) continue;
    const owner = byId.get(u.ownerId);
    if (!owner) throw new Error(`单位 ${u.id} 的主人 ${u.ownerId} 不存在`);
    owner.petId = u.id;
  }
  return units;
}

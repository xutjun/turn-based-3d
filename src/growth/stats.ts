// 人物属性计算（步骤 22，SPEC §15.1、DESIGN §12.1）：最终属性 = 基础属性 + 全部装备加成。
// 纯 TS，不依赖 three / DOM。战斗引擎（经 data/heroes.ts 的模板）和探索面板都用这里的同一个函数，
// 引擎仍只接收最终属性，src/core 的规则不变。

import type { Stats, UnitId } from '../core/types';
import { EQUIPMENT, HERO_BASE_STATS, HERO_LOADOUT, STAT_KEYS, type EquipmentDef, type EquipSlot } from '../data/equipment';

const ZERO: Readonly<Stats> = { maxHp: 0, maxMp: 0, physAtk: 0, magAtk: 0, defense: 0, speed: 0 };

/** 两组属性逐项相加（b 可以只写部分项） */
export function addStats(a: Readonly<Stats>, b: Readonly<Partial<Stats>>): Stats {
  const out = { ...a };
  for (const k of STAT_KEYS) out[k] += b[k] ?? 0;
  return out;
}

const BY_ID = new Map(EQUIPMENT.map((e) => [e.id, e]));

/** 按 id 取装备（没有时报错：装备表与穿戴表不一致是配置错误） */
export function equipmentById(id: string): EquipmentDef {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`装备不存在：${id}`);
  return e;
}

/** 某名人物各部位穿着的装备 */
export function heroEquipment(heroId: UnitId): Readonly<Record<EquipSlot, EquipmentDef>> {
  const loadout = HERO_LOADOUT[heroId];
  if (!loadout) throw new Error(`人物 ${heroId} 没有穿戴表`);
  return Object.fromEntries(Object.entries(loadout).map(([slot, id]) => [slot, equipmentById(id)])) as Record<EquipSlot, EquipmentDef>;
}

/** 某名人物全部装备的加成合计 */
export function equipmentBonus(heroId: UnitId): Stats {
  return Object.values(heroEquipment(heroId)).reduce<Stats>((sum, e) => addStats(sum, e.bonus), { ...ZERO });
}

/** 某名人物的基础属性 */
export function heroBaseStats(heroId: UnitId): Stats {
  const base = HERO_BASE_STATS[heroId];
  if (!base) throw new Error(`人物 ${heroId} 没有基础属性`);
  return { ...base };
}

/** 某名人物的最终（战斗）属性 = 基础 + 装备 */
export function heroFinalStats(heroId: UnitId): Stats {
  return addStats(heroBaseStats(heroId), equipmentBonus(heroId));
}

/** 某项属性的组成（角色面板悬停用） */
export function statBreakdown(heroId: UnitId, key: keyof Stats): { base: number; equipment: number; total: number } {
  const base = heroBaseStats(heroId)[key];
  const equipment = equipmentBonus(heroId)[key];
  return { base, equipment, total: base + equipment };
}

// 道具面板（步骤 22，SPEC §15.2 / §15.3）：上方 6 个装备框排成《暗黑破坏神》式的人形布局
// （头盔在上、项链在右上、武器在左侧竖长框、铠甲居中、腰带在铠甲下、鞋子在右下），
// 每个框显示程序化生成的装备图标和品质边框；下方 8 × 5 背包格子，目前为空。
// 装备不能卸下、不能拖动，点击没有效果；悬停装备显示提示框（名称、等级、部位、各项属性加成），空格子没有提示。

import type { UnitTemplate } from '../../../core/types';
import {
  EQUIP_QUALITY,
  EQUIP_SLOT_LABEL,
  EQUIP_SLOTS,
  INVENTORY_GRID,
  STAT_KEYS,
  STAT_LABEL,
  type EquipmentDef,
  type EquipSlot,
} from '../../../data/equipment';
import { heroEquipment } from '../../../growth/stats';
import { el } from '../../theme';
import type { Tooltip } from '../../widgets/Tooltip';
import { equipIconSvg } from '../equipIcons';
import { createPanelFrame, type GamePanel } from '../PanelHost';

export interface InventoryPanelDeps {
  leader(): UnitTemplate;
  tooltip: Tooltip | null;
  onClose(): void;
}

/** 装备提示框里的文字行（纯数据，可测）：名称、套装与品质、等级与部位、各项加成 */
export function equipTooltipLines(item: EquipmentDef): { name: string; color: string; set: string; meta: string; bonuses: string[] } {
  const q = EQUIP_QUALITY[item.quality];
  return {
    name: item.name,
    color: q.color,
    set: `${item.setName} · ${q.label}`,
    meta: `${item.level} 级 · ${EQUIP_SLOT_LABEL[item.slot]}`,
    bonuses: STAT_KEYS.filter((k) => (item.bonus[k] ?? 0) !== 0).map((k) => `+${item.bonus[k]} ${STAT_LABEL[k]}`),
  };
}

/** 装备提示框的内容元素（暗黑风格：名称用品质色，下面是套装、等级部位、分隔线、加成） */
export function equipTooltip(item: EquipmentDef): HTMLDivElement {
  const l = equipTooltipLines(item);
  const box = el('div', 'dk-equip-tip');
  const name = el('div', 'dk-equip-tip-name', l.name);
  name.style.color = l.color;
  box.append(name, el('div', 'dk-equip-tip-set', l.set), el('div', 'dk-equip-tip-meta', l.meta), el('div', 'dk-equip-tip-sep'));
  for (const b of l.bonuses) box.append(el('div', 'dk-equip-tip-bonus', b));
  return box;
}

export class InventoryPanel implements GamePanel {
  readonly id = 'inventory' as const;
  readonly root: HTMLDivElement;
  private readonly doll: HTMLDivElement;
  private readonly bag: HTMLDivElement;
  /** 部位 → 装备框（测试用） */
  readonly slots = new Map<EquipSlot, HTMLDivElement>();
  /** 背包格子（测试用） */
  readonly cells: HTMLDivElement[] = [];

  constructor(private readonly deps: InventoryPanelDeps) {
    const frame = createPanelFrame('道具', 'dk-panel-inventory', deps.onClose);
    this.root = frame.root;
    this.doll = el('div', 'dk-paperdoll');
    this.doll.append(el('div', 'dk-paperdoll-figure'));
    for (const slot of EQUIP_SLOTS) {
      const box = el('div', `dk-equip-slot is-${slot}`);
      box.setAttribute('draggable', 'false');
      box.append(el('span', 'dk-equip-slot-label', EQUIP_SLOT_LABEL[slot]), el('span', 'dk-equip-icon'));
      this.slots.set(slot, box);
      this.doll.append(box);
    }
    this.bag = el('div', 'dk-bag');
    for (let i = 0; i < INVENTORY_GRID.cols * INVENTORY_GRID.rows; i++) {
      const cell = el('div', 'dk-bag-cell');
      this.cells.push(cell);
      this.bag.append(cell);
    }
    frame.body.append(this.doll, el('div', 'dk-sep'), el('div', 'dk-bag-title', '背包'), this.bag);
    // 每个装备框只登记一次提示；内容按当前队长取（换队长后悬停显示新队长的装备）
    for (const [slot, box] of this.slots) {
      deps.tooltip?.attach(box, () => equipTooltip(heroEquipment(this.deps.leader().id)[slot]));
    }
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.deps.tooltip?.hide();
  }

  /** 按当前队长画 6 个装备框 */
  render(): void {
    const items = heroEquipment(this.deps.leader().id);
    for (const [slot, box] of this.slots) {
      const item = items[slot];
      const icon = box.children[1] as HTMLSpanElement;
      icon.innerHTML = equipIconSvg(item.id, item.icon);
      box.className = `dk-equip-slot is-${slot} q-${item.quality} has-item`;
      box.style.setProperty?.('--q', EQUIP_QUALITY[item.quality].color);
      box.setAttribute('aria-label', `${EQUIP_SLOT_LABEL[slot]}：${item.name}`);
    }
  }
}

// 装备配置表（步骤 22，SPEC §15.2、DESIGN §12.1 / §12.2）：5 套共 30 件 10 级装备 + 每名人物的 10 级基础属性。
// 人物的战斗属性 = 基础属性 + 全部装备加成（src/growth/stats.ts 的 heroFinalStats），相加后与步骤 19 的数值逐项相等。
// 装备的外观就是人物模型上现有的对应部位（modelPart 只作说明）；本阶段装备不能卸下、不能更换，只能查看。
// 图标（icon）由 ui/explore/equipIcons.ts 按形状和颜色程序化绘制（SVG），颜色取自各人物模型参数与 weapons.ts 的发光色。

import type { Stats, UnitId } from '../core/types';

export type EquipSlot = 'helmet' | 'weapon' | 'armor' | 'belt' | 'boots' | 'necklace';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['helmet', 'weapon', 'armor', 'belt', 'boots', 'necklace'];
export const EQUIP_SLOT_LABEL: Readonly<Record<EquipSlot, string>> = {
  helmet: '头盔',
  weapon: '武器',
  armor: '铠甲',
  belt: '腰带',
  boots: '鞋子',
  necklace: '项链',
};

/** 属性的显示名与顺序（SPEC §15.1） */
export const STAT_KEYS: readonly (keyof Stats)[] = ['maxHp', 'maxMp', 'physAtk', 'magAtk', 'defense', 'speed'];
export const STAT_LABEL: Readonly<Record<keyof Stats, string>> = {
  maxHp: '气血',
  maxMp: '魔法',
  physAtk: '物理攻击力',
  magAtk: '法术攻击力',
  defense: '防御力',
  speed: '速度',
};

/** 品质（决定装备框和名称的颜色）。本阶段 30 件都是套装品质 */
export type EquipQuality = 'normal' | 'magic' | 'rare' | 'set' | 'unique';
export const EQUIP_QUALITY: Readonly<Record<EquipQuality, { label: string; color: string }>> = {
  normal: { label: '普通', color: '#c8c0ae' },
  magic: { label: '魔法', color: '#7d8cff' },
  rare: { label: '稀有', color: '#f0d35a' },
  set: { label: '套装', color: '#3fd46a' },
  unique: { label: '暗金', color: '#c9a25a' },
};

/** 图标形状（equipIcons.ts 里各有一个程序化画法） */
export type EquipIconShape =
  | 'helmBarrel'
  | 'hoodPointed'
  | 'hoodDeep'
  | 'crownMask'
  | 'hoodSoft'
  | 'blade'
  | 'bow'
  | 'staff'
  | 'sword'
  | 'spear'
  | 'plate'
  | 'leather'
  | 'robe'
  | 'beltBuckle'
  | 'beltSash'
  | 'bootPlate'
  | 'bootLeather'
  | 'pendant'
  | 'beads';

export interface EquipIconSpec {
  shape: EquipIconShape;
  primary: number; // 主体颜色
  secondary: number; // 镶边 / 次要部件
  glow?: number; // 发光部分（刃口、宝石、符文）
}

export interface EquipmentDef {
  id: string;
  name: string;
  level: number;
  slot: EquipSlot;
  ownerId: UnitId;
  setName: string;
  quality: EquipQuality;
  /** 只写有加成的项，未写 = 0 */
  bonus: Partial<Stats>;
  icon: EquipIconSpec;
  /** 对应模型上的哪一部分（只作说明，运行时不用） */
  modelPart: string;
}

/** 5 名人物的 10 级基础属性（裸装）。+ 装备合计 = 步骤 19 的战斗属性（DESIGN §12.2 的证明表） */
export const HERO_BASE_STATS: Readonly<Record<UnitId, Stats>> = {
  A0: { maxHp: 720, maxMp: 490, physAtk: 125, magAtk: 50, defense: 25, speed: 92 }, // 夜隼
  A1: { maxHp: 900, maxMp: 480, physAtk: 135, magAtk: 50, defense: 35, speed: 75 }, // 烬刃
  A2: { maxHp: 660, maxMp: 630, physAtk: 50, magAtk: 135, defense: 20, speed: 81 }, // 雷咒
  A3: { maxHp: 770, maxMp: 400, physAtk: 110, magAtk: 105, defense: 30, speed: 100 }, // 缚魂
  A4: { maxHp: 770, maxMp: 640, physAtk: 100, magAtk: 120, defense: 31, speed: 73 }, // 守誓
};

type Row = [slot: EquipSlot, name: string, bonus: Partial<Stats>, icon: EquipIconSpec, modelPart: string];

/** 一套装备：每行一个部位 */
function set(ownerId: UnitId, setName: string, rows: readonly Row[]): EquipmentDef[] {
  return rows.map(([slot, name, bonus, icon, modelPart]) => ({
    id: `eq_${ownerId}_${slot}`,
    name,
    level: 10,
    slot,
    ownerId,
    setName,
    quality: 'set' as const,
    bonus,
    icon,
    modelPart,
  }));
}

export const EQUIPMENT: readonly EquipmentDef[] = [
  // 夜隼（A0，弓）· 鸦羽套
  ...set('A0', '鸦羽套', [
    ['helmet', '鸦羽尖兜帽', { maxMp: 50, defense: 5 }, { shape: 'hoodPointed', primary: 0x2f6a4c, secondary: 0xd8d2b8 }, '尖兜帽 + 蒙面'],
    ['weapon', '逐光长弓', { physAtk: 55 }, { shape: 'bow', primary: 0x6a4a2c, secondary: 0xa9a48c, glow: 0x3dffc8 }, '弓'],
    ['armor', '夜行皮甲', { maxHp: 150, defense: 10 }, { shape: 'leather', primary: 0x8a5a34, secondary: 0x2f6a4c }, '轻皮甲 + 单肩斗篷'],
    ['belt', '猎手腰带', { maxHp: 80, maxMp: 40 }, { shape: 'beltBuckle', primary: 0x46301f, secondary: 0xa9a48c }, '腰带 + 腰包'],
    ['boots', '翻边长靴', { speed: 18, defense: 5 }, { shape: 'bootLeather', primary: 0x46301f, secondary: 0x8a5a34 }, '及膝长靴'],
    ['necklace', '狼牙挂坠', { physAtk: 15, maxMp: 20 }, { shape: 'pendant', primary: 0x46301f, secondary: 0xe8e0c8 }, '皮绳狼牙挂饰（步骤 22 新增）'],
  ]),
  // 烬刃（A1，刀）· 余烬套
  ...set('A1', '余烬套', [
    ['helmet', '余烬桶盔', { maxMp: 60, defense: 8 }, { shape: 'helmBarrel', primary: 0xa9b1bf, secondary: 0xd0a242, glow: 0xff7a2a }, '桶盔 + 盔鳍'],
    ['weapon', '熔火弯刀', { physAtk: 60 }, { shape: 'blade', primary: 0x4b505c, secondary: 0xd0a242, glow: 0xff4a12 }, '刀'],
    ['armor', '余烬板甲', { maxHp: 200, defense: 12 }, { shape: 'plate', primary: 0xa9b1bf, secondary: 0x9a1f18 }, '胸甲 + 肩甲 + 战袍'],
    ['belt', '铁扣战带', { maxHp: 100, maxMp: 40 }, { shape: 'beltBuckle', primary: 0x7a4f2c, secondary: 0xd0a242 }, '腰带（带扣、匕首鞘）'],
    ['boots', '分节铁靴', { speed: 15, defense: 5 }, { shape: 'bootPlate', primary: 0xa9b1bf, secondary: 0x4b505c }, '铁靴 + 胫甲'],
    ['necklace', '烬火链坠', { physAtk: 15, maxMp: 20 }, { shape: 'pendant', primary: 0xd0a242, secondary: 0xd0a242, glow: 0xff7a2a }, '胸甲前的短链 + 烬火坠石（步骤 22 新增）'],
  ]),
  // 雷咒（A2，法杖）· 雷殛套
  ...set('A2', '雷殛套', [
    ['helmet', '雷殛深兜帽', { maxMp: 80, defense: 4 }, { shape: 'hoodDeep', primary: 0x1d2458, secondary: 0xc9a44e, glow: 0x8f7bff }, '兜帽 + 额前金饰'],
    ['weapon', '雷殛法杖', { magAtk: 65 }, { shape: 'staff', primary: 0x5a3e26, secondary: 0xc9a44e, glow: 0x8a6bff }, '法杖'],
    ['armor', '星纹长袍', { maxHp: 120, defense: 8 }, { shape: 'robe', primary: 0x2f4aa8, secondary: 0xc9a44e }, '外袍 + 内袍 + 肩披'],
    ['belt', '秘典腰带', { maxHp: 70, maxMp: 50 }, { shape: 'beltBuckle', primary: 0x6a4428, secondary: 0xc9a44e }, '皮腰带 + 法术书、卷轴筒'],
    ['boots', '学者便靴', { speed: 14, defense: 3 }, { shape: 'bootLeather', primary: 0x6a4428, secondary: 0x2f4aa8 }, '靴'],
    ['necklace', '雷纹挂坠', { magAtk: 20, maxMp: 40 }, { shape: 'pendant', primary: 0xc9a44e, secondary: 0xc9a44e, glow: 0x8f7bff }, '胸前符文挂坠'],
  ]),
  // 缚魂（A3，剑）· 缚链套
  ...set('A3', '缚链套', [
    ['helmet', '缚魂高冠', { maxMp: 40, defense: 6 }, { shape: 'crownMask', primary: 0x4a2f6e, secondary: 0xe0d6bc, glow: 0xb44dff }, '高冠 + 骨白面具'],
    ['weapon', '缚链符剑', { physAtk: 35, magAtk: 35 }, { shape: 'sword', primary: 0xb4bac6, secondary: 0x4a2f6e, glow: 0x58b4ff }, '剑'],
    ['armor', '缚魂祭袍', { maxHp: 150, defense: 10 }, { shape: 'robe', primary: 0x4a2f6e, secondary: 0xb4bac6 }, '祭袍 + 锁链 + 圣带'],
    ['belt', '暗红腰封', { maxHp: 80, maxMp: 30 }, { shape: 'beltSash', primary: 0x7a1f2e, secondary: 0xb4bac6 }, '腰封 + 符文牌'],
    ['boots', '祭司长靴', { speed: 20, defense: 4 }, { shape: 'bootLeather', primary: 0x3a2a26, secondary: 0x4a2f6e }, '长靴'],
    ['necklace', '封魂念珠', { magAtk: 15, maxMp: 30 }, { shape: 'beads', primary: 0x3a2a26, secondary: 0xb4bac6, glow: 0xb44dff }, '颈上念珠 + 封印石'],
  ]),
  // 守誓（A4，枪）· 誓约套
  ...set('A4', '誓约套', [
    ['helmet', '誓约金冠兜帽', { maxMp: 70, defense: 5 }, { shape: 'hoodSoft', primary: 0xe9e2cc, secondary: 0xd6a83e }, '软兜帽 + 金额冠'],
    ['weapon', '誓光长枪', { physAtk: 30, magAtk: 40 }, { shape: 'spear', primary: 0x6a4a2c, secondary: 0xd6a83e, glow: 0xffc23a }, '枪'],
    ['armor', '象牙圣袍', { maxHp: 150, defense: 10 }, { shape: 'robe', primary: 0xcfc7ae, secondary: 0x2f8a80 }, '长袍 + 披肩 + 肩甲片'],
    ['belt', '圣徒金腰带', { maxHp: 80, maxMp: 50 }, { shape: 'beltBuckle', primary: 0xd6a83e, secondary: 0x2f8a80 }, '金腰带 + 药瓶、香炉'],
    ['boots', '朝圣者软靴', { speed: 12, defense: 4 }, { shape: 'bootLeather', primary: 0x7a5a38, secondary: 0xcfc7ae }, '靴'],
    ['necklace', '圣徽念珠', { magAtk: 20, maxMp: 40 }, { shape: 'beads', primary: 0x7a5a38, secondary: 0xd6a83e, glow: 0xe6e28a }, '念珠 + 八芒星圣徽'],
  ]),
];

/** 人物 → 各部位穿着的装备 id（本阶段每人就是自己那一套） */
export const HERO_LOADOUT: Readonly<Record<UnitId, Readonly<Record<EquipSlot, string>>>> = Object.fromEntries(
  Object.keys(HERO_BASE_STATS).map((id) => [id, Object.fromEntries(EQUIP_SLOTS.map((slot) => [slot, `eq_${id}_${slot}`]))]),
) as Record<UnitId, Record<EquipSlot, string>>;

/** 背包格子：8 列 × 5 行（暂时没有道具） */
export const INVENTORY_GRID = { cols: 8, rows: 5 } as const;

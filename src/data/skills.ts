// 技能配置表（对应 DESIGN.md §4）。
// 全部技能都在这张表里：指令面板、战斗日志、演出飘字、技能演示模式用的名称和消耗都从这里取。
//
// “三连射”“箭雨”是连斩、旋风斩的弓箭手版本（SPEC §7.1），“群体法术·烈焰”是群体法术的火系版本：
// 它们与原技能共用同一套数值和结算方式，只有名称、说明、元素不同，所以用“在原技能上改几个字段”的方式定义。

import type { SkillDef, SkillId } from '../core/types';

const BASIC_PHYSICAL: SkillDef = {
  id: 'basic_physical',
  name: '普攻',
  description: '对一个敌人造成物理伤害。近战武器冲到目标面前攻击，弓箭在原地射击。',
  classId: 'common',
  mpCost: 0,
  effect: 'damage',
  damageType: 'physical',
  targetSide: 'enemy',
  targetState: 'alive',
  targetCount: 1,
  pattern: 'single',
  hits: 1,
  multiplier: 1.0,
  hitRate: 0.95,
  meleeCharge: true,
  animation: { melee: 'meleeStrike', ranged: 'bowShot' },
  element: 'none',
};

const BASIC_MAGIC: SkillDef = {
  id: 'basic_magic',
  name: '法术普攻',
  description: '在原地施法，对一个敌人造成法术伤害。',
  classId: 'common',
  mpCost: 0,
  effect: 'damage',
  damageType: 'magic',
  targetSide: 'enemy',
  targetState: 'alive',
  targetCount: 1,
  pattern: 'single',
  hits: 1,
  multiplier: 1.0,
  hitRate: 0.95,
  meleeCharge: false,
  animation: { cast: 'castBolt' },
  element: 'fire',
};

// ---------------- 物理系 ----------------

const COMBO_SLASH: SkillDef = {
  id: 'combo_slash',
  name: '连斩',
  description: '冲到一个敌人面前连续斩击 3 次，每次独立计算伤害和暴击。目标中途倒下时，剩余的斩击取消。',
  classId: 'physical',
  mpCost: 40,
  effect: 'damage',
  damageType: 'physical',
  targetSide: 'enemy',
  targetState: 'alive',
  targetCount: 1,
  pattern: 'multiHit',
  hits: 3, // 段数
  multiplier: 0.6, // 每段倍率
  hitRate: 1.0,
  meleeCharge: true,
  animation: { melee: 'comboSlash', ranged: 'tripleShot' },
  element: 'none',
};

/** 弓箭手版连斩：数值与连斩相同，原地射击 */
const TRIPLE_SHOT: SkillDef = {
  ...COMBO_SLASH,
  id: 'triple_shot',
  name: '三连射',
  description: '在原地向一个敌人连射 3 箭，每箭独立计算伤害和暴击。目标中途倒下时，剩余的箭取消。',
};

const WHIRLWIND: SkillDef = {
  id: 'whirlwind',
  name: '旋风斩',
  description: '依次冲向最多 7 个敌人各攻击一次，每个目标独立计算伤害。先打选中的目标，其余按速度由快到慢。',
  classId: 'physical',
  mpCost: 80,
  effect: 'damage',
  damageType: 'physical',
  targetSide: 'enemy',
  targetState: 'alive',
  targetCount: 7,
  pattern: 'sequential',
  hits: 1,
  multiplier: 0.7,
  hitRate: 1.0,
  meleeCharge: true,
  animation: { melee: 'whirlwind', ranged: 'arrowRain' },
  element: 'none',
  sequenceOrder: 'speedDesc', // 依次攻击的顺序：主目标之后按速度由快到慢；可改为 'leftToRight'
};

/** 弓箭手版旋风斩：数值与旋风斩相同，原地射击 */
const ARROW_RAIN: SkillDef = {
  ...WHIRLWIND,
  id: 'arrow_rain',
  name: '箭雨',
  description: '在原地向天空射出光箭，依次落向最多 7 个敌人，每个目标独立计算伤害。先打选中的目标，其余按速度由快到慢。',
};

// ---------------- 法术系 ----------------

const GROUP_SPELL: SkillDef = {
  id: 'group_spell',
  name: '群体法术·天雷',
  description: '原地蓄力，落雷同时击中最多 6 个敌人，每个目标独立计算法术伤害。选中的目标一定会被击中。',
  classId: 'magic',
  mpCost: 80,
  effect: 'damage',
  damageType: 'magic',
  targetSide: 'enemy',
  targetState: 'alive',
  targetCount: 6,
  pattern: 'simultaneous',
  hits: 1,
  multiplier: 0.8,
  hitRate: 1.0,
  meleeCharge: false,
  animation: { cast: 'groupSpell' },
  element: 'thunder',
};

/** 群体法术的火系版本（骨龙幼崽使用）：数值与天雷相同，光效为火柱 */
const GROUP_SPELL_FIRE: SkillDef = {
  ...GROUP_SPELL,
  id: 'group_spell_fire',
  name: '群体法术·烈焰',
  description: '原地蓄力，火柱同时击中最多 6 个敌人，每个目标独立计算法术伤害。选中的目标一定会被击中。',
  element: 'fire',
};

const SINGLE_SPELL: SkillDef = {
  id: 'single_spell',
  name: '单体法术·炎爆',
  description: '原地蓄力，一枚火球飞向一个敌人并爆炸，造成高倍率法术伤害。',
  classId: 'magic',
  mpCost: 50,
  effect: 'damage',
  damageType: 'magic',
  targetSide: 'enemy',
  targetState: 'alive',
  targetCount: 1,
  pattern: 'single',
  hits: 1,
  multiplier: 1.6,
  hitRate: 1.0,
  meleeCharge: false,
  animation: { cast: 'singleSpell' },
  element: 'fire',
};

// ---------------- 封印系 ----------------

const SEAL: SkillDef = {
  id: 'seal',
  name: '封印',
  description: '封印一个敌人 3 回合：期间不能使用技能，仍可攻击和防御。有 75% 的命中率，已被封印的单位不能再封印。',
  classId: 'seal',
  mpCost: 60,
  effect: 'seal',
  damageType: 'magic',
  targetSide: 'enemy',
  targetState: 'alive',
  targetCount: 1,
  pattern: 'single',
  hits: 1,
  multiplier: 0,
  hitRate: 0.75,
  meleeCharge: false,
  animation: { cast: 'sealChain' },
  element: 'seal',
  status: { type: 'seal', duration: 3 },
};

// ---------------- 恢复系 ----------------

const GROUP_HEAL: SkillDef = {
  id: 'group_heal',
  name: '群体治疗',
  description: '同时治疗最多 3 个存活的我方单位（人物和宝宝都可以）。选中的目标一定会被治疗，其余按速度由快到慢补足。',
  classId: 'heal',
  mpCost: 80,
  effect: 'heal',
  damageType: 'magic',
  targetSide: 'ally',
  targetState: 'alive',
  targetCount: 3,
  pattern: 'simultaneous',
  hits: 1,
  multiplier: 1.0,
  hitRate: 1.0,
  meleeCharge: false,
  animation: { cast: 'groupHeal' },
  element: 'heal',
};

const REVIVE: SkillDef = {
  id: 'revive',
  name: '复活',
  description: '复活一个倒地的队友，恢复 30% 气血。只能选择倒地的我方单位。',
  classId: 'heal',
  mpCost: 120,
  effect: 'revive',
  damageType: 'magic',
  targetSide: 'ally',
  targetState: 'dead',
  targetCount: 1,
  pattern: 'single',
  hits: 1,
  multiplier: 0,
  hitRate: 1.0,
  meleeCharge: false,
  animation: { cast: 'revive' },
  element: 'heal',
  reviveHpRatio: 0.3,
};

const SKILL_LIST: SkillDef[] = [
  BASIC_PHYSICAL,
  BASIC_MAGIC,
  COMBO_SLASH,
  TRIPLE_SHOT,
  WHIRLWIND,
  ARROW_RAIN,
  GROUP_SPELL,
  GROUP_SPELL_FIRE,
  SINGLE_SPELL,
  SEAL,
  GROUP_HEAL,
  REVIVE,
];

export const SKILLS: Record<SkillId, SkillDef> = Object.fromEntries(
  SKILL_LIST.map((s) => [s.id, s]),
);

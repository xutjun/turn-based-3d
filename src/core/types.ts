// 核心数据结构（对应 DESIGN.md §2）。
// 本文件只有类型定义，不依赖任何渲染或浏览器接口。

// ---------- 基础枚举 ----------
export type UnitId = string; // 例：'A0'..'A9'（友方）, 'E0'..'E9'（敌方）
export type SkillId = string;
export type PassiveId = string;
export type Side = 'ally' | 'enemy';
export type UnitKind = 'hero' | 'pet' | 'enemy';
export type ClassId = 'physical' | 'magic' | 'seal' | 'heal';
export type EnemyRank = 'minion' | 'elite' | 'boss';
export type WeaponId = 'blade' | 'sword' | 'spear' | 'staff' | 'bow';

/** 物理出手方式：由武器（或无武器单位的模板）决定 */
export type AttackMode = 'melee' | 'ranged' | 'cast';
/** 一次技能的实际出手方式：physical 技能取单位 attackMode（cast 单位按 melee 处理），magic 技能固定 cast */
export type Delivery = 'melee' | 'ranged' | 'cast';

export type DamageType = 'physical' | 'magic';
export type SkillEffect = 'damage' | 'heal' | 'seal' | 'revive';
export type TargetPattern = 'single' | 'multiHit' | 'sequential' | 'simultaneous';
export type Element = 'none' | 'fire' | 'thunder' | 'seal' | 'heal';
export type SequenceOrder = 'speedDesc' | 'leftToRight';

export type AnimType =
  | 'meleeStrike'
  | 'bowShot'
  | 'castBolt' // 普攻
  | 'comboSlash'
  | 'tripleShot' // 连斩 / 原地三连射
  | 'whirlwind'
  | 'arrowRain' // 旋风斩 / 箭雨
  | 'groupSpell'
  | 'groupSpellSmall' // 法术型宝宝的三目标法术：群体法术的缩小版
  | 'singleSpell' // 群体法术 / 单体法术
  | 'sealChain'
  | 'groupHeal'
  | 'revive';

// ---------- 属性 ----------
/** 6 项属性。气血、魔法的“当前值”放在 Unit.hp / Unit.mp */
export interface Stats {
  maxHp: number; // 气血上限
  maxMp: number; // 魔法上限
  physAtk: number; // 物理伤害
  magAtk: number; // 法术伤害（同时决定治疗量）
  defense: number; // 防御
  speed: number; // 速度
}

// ---------- 阵型格子 ----------
export interface Slot {
  row: 0 | 1; // 0 = 前排（靠近对方），1 = 后排
  col: 0 | 1 | 2 | 3 | 4; // 0 = 屏幕最左，4 = 屏幕最右
}

// ---------- 状态 ----------
export type StatusType = 'seal';
export interface Status {
  type: StatusType;
  remainingTurns: number; // 剩余回合数，>0 时生效
  sourceId: UnitId; // 施加者
  appliedTurn: number; // 施加时的回合号
}

// ---------- 单位 ----------
export interface Unit {
  id: UnitId;
  templateId: string; // 指向 heroes.ts / enemies.ts 中的模板
  name: string;
  side: Side;
  kind: UnitKind;
  classId: ClassId;
  rank?: EnemyRank; // 仅敌方
  ownerId?: UnitId; // 仅宝宝：主人 id
  petId?: UnitId; // 仅友方人物：宝宝 id
  slot: Slot;
  weaponId?: WeaponId; // 友方人物有；宝宝/敌人无
  attackMode: AttackMode;
  basicAttackSkillId: SkillId;
  skillIds: SkillId[]; // 主动技能，不含普攻；物理型宝宝为空
  passiveIds: PassiveId[]; // 被动技能；没有则为空数组
  stats: Stats;
  hp: number; // 当前气血，0 ≤ hp ≤ maxHp
  mp: number; // 当前魔法，0 ≤ mp ≤ maxMp
  alive: boolean; // hp > 0 ⇔ alive
  statuses: Status[];
  defending: boolean; // 本回合是否处于防御
  autoCommand: boolean; // 敌方为 true；宝宝取设置项；人物为 false
}

/**
 * 单位模板：配置表（heroes.ts / enemies.ts）里的一行。
 * 由 setup.ts 的 createUnits() 补上运行时字段后变成 Unit。
 */
export interface UnitTemplate {
  id: UnitId;
  templateId: string;
  name: string;
  side: Side;
  kind: UnitKind;
  classId: ClassId;
  rank?: EnemyRank;
  ownerId?: UnitId;
  slot: Slot;
  weaponId?: WeaponId;
  attackMode: AttackMode;
  basicAttackSkillId: SkillId;
  skillIds: SkillId[];
  passiveIds?: PassiveId[]; // 不写表示没有被动技能
  stats: Stats;
}

// ---------- 技能（配置表行） ----------
export interface SkillDef {
  id: SkillId;
  name: string;
  description: string;
  classId: ClassId | 'common'; // 'common' = 普攻
  mpCost: number;
  effect: SkillEffect;
  damageType: DamageType; // heal/seal/revive 填 'magic'，表示“法术类”
  targetSide: 'enemy' | 'ally'; // 相对施法者
  targetState: 'alive' | 'dead';
  targetCount: number; // 最大目标数
  pattern: TargetPattern;
  hits: number; // 每个目标的段数
  multiplier: number; // 每段倍率；seal/revive 填 0（不使用）
  hitRate: number; // 0~1
  meleeCharge: boolean; // 是否近战冲锋（仅当 delivery = 'melee' 时生效）
  animation: Partial<Record<Delivery, AnimType>>;
  element: Element; // 法杖宝珠颜色、特效配色
  sequenceOrder?: SequenceOrder; // 仅 sequential
  status?: { type: StatusType; duration: number }; // 仅 seal
  reviveHpRatio?: number; // 仅 revive
}

// ---------- 被动技能（配置表行，passives.ts） ----------
/** 触发条件。目前只有“用普攻出手时”（包括技能被改成普攻的情况） */
export type PassiveTrigger = 'basicAttack';
/** 效果。extraHit = 对同一目标追加 hits 次攻击 */
export type PassiveEffect = { kind: 'extraHit'; hits: number };
export interface PassiveDef {
  id: PassiveId;
  name: string; // 触发时的飘字，也用于指令面板说明
  description: string;
  trigger: PassiveTrigger;
  chance: number; // 触发概率 0~1
  effect: PassiveEffect;
}

// ---------- 指令 ----------
export type Command =
  | { kind: 'attack'; targetId: UnitId } // 普攻
  | { kind: 'skill'; skillId: SkillId; targetId: UnitId } // targetId = 主目标
  | { kind: 'defend' };

export interface CommandOptions {
  canAttack: boolean; // 存活即为 true
  canDefend: boolean;
  skills: { skillId: SkillId; enabled: boolean; disabledReason?: 'noMp' | 'sealed' }[];
}

export type CommandRejectReason =
  | 'wrongPhase'
  | 'unitDead'
  | 'notCommandable'
  | 'unknownSkill'
  | 'noMp'
  | 'sealed'
  | 'invalidTarget';

export type SubmitResult = { ok: true } | { ok: false; reason: CommandRejectReason };

// ---------- 战斗状态 ----------
export type BattlePhase = 'init' | 'command' | 'execution' | 'settlement' | 'ended';

export interface BattleSettings {
  petAutoCommand: boolean; // 宝宝自动出手（默认 false）
}

export interface BattleState {
  turn: number; // 回合号，从 1 开始
  phase: BattlePhase;
  units: Record<UnitId, Unit>;
  unitIds: UnitId[]; // 固定顺序：A0..A9, E0..E9
  turnOrder: UnitId[]; // 本回合出手顺序（回合开始时生成，包含倒地的友方）
  actionCursor: number; // 下一个出手者在 turnOrder 中的下标
  lateQueue: UnitId[]; // 队尾补出手队列：复活时速度位置已过的单位，按复活先后排列；出手或倒地后移出
  actedThisTurn: UnitId[]; // 本回合已经出过手的单位（每回合最多出手一次）
  /** 本回合各方 AI 已把某单位选为主目标的次数，回合开始清零（分散火力用） */
  aiTargetCounts: Record<Side, Record<AiTargetKind, Record<UnitId, number>>>;
  commands: Partial<Record<UnitId, Command>>; // 本回合已提交的指令
  awaitingCommandFor: UnitId | null; // 执行阶段中等待玩家现场下指令的复活单位
  winner: Side | null;
  settings: BattleSettings;
  eventSeq: number; // 事件自增序号
}

// ---------- 全局数值（battleConfig.ts） ----------
export interface CritConfig {
  rate: number; // 暴击率 0~1
  multiplier: number; // 暴击倍率
}

export interface BattleConfig {
  crit: Record<'physical' | 'magic' | 'heal', CritConfig>; // 物理/法术伤害/治疗分别配置
  magicDefenseCoef: number; // 法术伤害的防御系数
  varianceMin: number; // 随机浮动下限
  varianceMax: number; // 随机浮动上限
  defendDamageMult: number; // 防御指令受伤倍率
}

/** AI 选目标的种类：攻击 / 封印 / 治疗（含复活）分别计数 */
export type AiTargetKind = 'attack' | 'seal' | 'heal';
/** focus = 固定选“最优”目标；spread = 带权重的随机 + 同回合分散 */
export type AiTargetMode = 'focus' | 'spread';

export interface AiConfig {
  healHpThreshold: number; // 友军 hp 比例低于该值时治疗
  aoeMinTargets: number; // 存活对方单位 ≥ 该值时优先用群体技能
  targetMode: Record<Side, AiTargetMode>; // 各阵营的 AI 怎么选目标
  spread: {
    baseWeight: number; // 每个候选目标的基础权重
    repeatDecay: number; // 同一回合内每被己方 AI 选中一次，权重 × 该值
    lowHpBonus: number; // 残血加权：权重 × (1 + lowHpBonus × 已损失气血比例)
    sealCasterBonus: number; // 封印时，法术 / 恢复职业的权重 × 该值
  };
}

// ---------- 引擎输入 ----------
export interface BattleSetup {
  config: BattleConfig;
  skills: Record<SkillId, SkillDef>;
  passives?: Record<PassiveId, PassiveDef>; // 不传表示没有被动技能
  units: Unit[]; // 由 setup.ts 根据模板生成
  settings: BattleSettings;
  ai: AiConfig;
  seed: number;
}

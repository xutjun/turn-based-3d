# 工程设计文档（DESIGN.md）

> 本文档是步骤 1~10 的唯一技术依据。需求以 `docs/SPEC.md` 为准；本文档只把 SPEC 落成可实现的接口、字段、公式和流程。若两者冲突，以 SPEC 为准，并在汇报中说明。
> 文中“§x”指本文档章节；引用需求文档时写作“SPEC §x”。

---

## 1. 技术栈与目录结构

### 1.1 技术栈
| 项 | 选型 | 说明 |
|---|---|---|
| 语言 | TypeScript（`strict: true`） | 全项目 |
| 构建 | Vite | `npm install && npm run dev` 运行（SPEC §1） |
| 渲染 | Three.js + `three/examples/jsm` 后处理（EffectComposer、UnrealBloomPass、自定义暗角/颗粒 Pass、OutputPass 色调映射） | 仅 `/src/render`、`/src/assets` 可依赖 |
| 测试 | Vitest | 逻辑层单元测试（SPEC §11） |
| 音效 | Web Audio API 程序化合成 | 步骤 8 实现，之前只留钩子 |
| UI | 原生 DOM + CSS（衬线字体用系统字体栈 `"Cinzel", "Times New Roman", "Songti SC", serif`，不下载字体文件） | 不引入 UI 框架 |

不引入任何外部美术、字体、音频资源（SPEC §1、SPEC §3）。

### 1.2 目录结构
```
/
├─ index.html
├─ package.json / tsconfig.json / vite.config.ts / vitest.config.ts
├─ README.md
├─ docs/  SPEC.md  DESIGN.md
├─ scripts/  sim.ts（命令行跑一场战斗）  balance.ts（批量统计胜率、回合数、技能使用、集火率、魔法不足占比）
├─ src/
│  ├─ main.ts                 入口：按地址参数进入玩家战斗 / 自动战斗 / 技能演示 / 演出样例 / 模型预览
│  ├─ core/                   规则逻辑层：纯 TS，禁止 import three / DOM / src/data / src/render / src/ui / src/assets
│  │  ├─ types.ts             §2 的全部接口
│  │  ├─ rng.ts               可注入种子的随机数（mulberry32）；战斗结算与 AI 选目标各用一条独立的随机序列（§8.4）
│  │  ├─ events.ts            事件类型定义 + EventBus
│  │  ├─ damage.ts            伤害/治疗/暴击/防御公式（SPEC §6 要求集中于此并写注释）
│  │  ├─ turnOrder.ts         出手排序
│  │  ├─ targeting.ts         目标校验、补足、重选、执行顺序
│  │  ├─ status.ts            封印施加/递减/解除
│  │  ├─ commands.ts          指令校验、可用指令查询
│  │  ├─ skillExecutor.ts     按 pattern 执行技能，产出事件
│  │  ├─ passives.ts          被动技能的触发判定（§4.5）
│  │  ├─ ai.ts                敌方与自动宝宝的指令决策
│  │  ├─ battle.ts            BattleEngine：状态机与对外 API
│  │  └─ setup.ts             由单位模板生成参战单位
│  ├─ data/                   配置表：纯数据 + 只依赖 core/types.ts（步骤 10 新增 idleConfig.ts：待机风格）
│  │  ├─ battleConfig.ts      全局数值（暴击、浮动、防御系数等）
│  │  ├─ skills.ts            主动技能表（§4）
│  │  ├─ passives.ts          被动技能表（§4.5）
│  │  ├─ classes.ts           职业 → 技能库
│  │  ├─ weapons.ts           武器：出手方式 + 普攻技能 + 发光参数
│  │  ├─ heroes.ts            友方 5 人物 + 5 宝宝
│  │  ├─ pets.ts              宝宝类型（物理型 / 法术型）的定义，以及每只宝宝属于哪一型（§4.6）
│  │  ├─ enemies.ts           敌方 10 单位
│  │  ├─ formation.ts         阵型格子与世界坐标（§7）
│  │  ├─ aiConfig.ts          AI 阈值、选目标的权重参数
│  │  ├─ defaultSetup.ts      用默认配置表组装一场 10v10
│  │  ├─ assetKeys.ts / unitModels.ts   资源键；单位、武器用哪个模型及外观参数
│  │  ├─ renderConfig.ts      相机、灯光、雾、后处理、低画质、绘制优化
│  │  ├─ presentationConfig.ts 演出时长、镜头、飘字、粒子、冲锋转身
│  │  ├─ uiConfig.ts          目标光圈、日志、头顶名字
│  │  └─ audioConfig.ts       音量、各音效响度、环境音
│  ├─ assets/                 AssetRegistry、程序化贴图、模型 builder、绘制优化、音效合成
│  │  ├─ AssetRegistry.ts     资源键 → 工厂；之后可替换为 glb 加载器
│  │  ├─ registerDefaults.ts  注册全部程序化模型
│  │  ├─ optimize.ts          合并静态网格、阴影代理（步骤 8，见 §9.3）
│  │  ├─ materials.ts / noise.ts / environment.ts
│  │  ├─ textures/            Canvas 生成的表面贴图、粒子贴图
│  │  ├─ models/              characters/ creatures/ weapons/ props.ts placeholder.ts
│  │  └─ audio/SoundEngine.ts Web Audio 合成器
│  ├─ render/                 场景、相机、灯光、后处理、动画、特效、BattleDirector
│  │  ├─ BattleScene.ts       渲染器、渲染循环、窗口自适应、画质、性能快照
│  │  ├─ scene/  camera/  postfx/  fx/  debug/
│  │  ├─ units/               UnitView（单位动画）、BattleStage、冲锋转身、动作 → 音效、待机动画（idleMotion / IdleAnimator）
│  │  └─ director/            把逻辑事件变成按顺序播放的演出（BattleDirector、Choreographer、Scheduler）
│  ├─ ui/                     DOM 界面
│  │  ├─ PlayerBattleApp / PlayerBattleController   玩家战斗
│  │  ├─ BattleApp / AutoBattleController           自动战斗
│  │  ├─ command/ input/ panels/ hud/ log/ stats/   指令会话、鼠标输入、面板、头顶条与飘字、日志、统计
│  │  └─ showcase/            技能演示（?demo=skills）与演出样例（?demo=1）
│  └─ preview/                模型预览页（SPEC §3.4）
└─ tests/
   ├─ core/ data/ render/ ui/ Vitest 单元测试，文件名 *.test.ts
   └─ regression/             整场战斗回归 + 数值平衡守护
```

依赖方向（单向，不允许反向）：
```
data ──► core/types
core ──► （仅 core 内部）
assets ──► three, data
render ──► three, assets, data, core（只读类型 + 订阅事件）
ui ──► core（命令 API + 事件）, data, render（只用 worldToScreen 和高亮接口）
main ──► 全部
```
`core` 不 import `data`：配置通过 `BattleSetup` 注入引擎，测试中可以注入自定义小配置。

---

## 2. 核心数据结构（TypeScript 接口）

以下接口定义在 `src/core/types.ts`。

```ts
// ---------- 基础枚举 ----------
export type UnitId = string;            // 例：'A0'..'A9'（友方）, 'E0'..'E9'（敌方）
export type SkillId = string;
export type PassiveId = string;
export type Side = 'ally' | 'enemy';
export type UnitKind = 'hero' | 'pet' | 'enemy';
export type ClassId = 'physical' | 'magic' | 'seal' | 'heal';
export type EnemyRank = 'minion' | 'elite' | 'boss';
export type WeaponId = 'blade' | 'sword' | 'spear' | 'staff' | 'bow';

/** 物理出手方式：由武器（或无武器单位的模板）决定 */
export type AttackMode = 'melee' | 'ranged' | 'cast';
/** 一次技能的实际出手方式：physical 技能取单位 attackMode（cast 单位也按 melee 处理，见 §4.4），magic 技能固定 cast */
export type Delivery = 'melee' | 'ranged' | 'cast';

export type DamageType = 'physical' | 'magic';
export type SkillEffect = 'damage' | 'heal' | 'seal' | 'revive';
export type TargetPattern = 'single' | 'multiHit' | 'sequential' | 'simultaneous';
export type Element = 'none' | 'fire' | 'thunder' | 'seal' | 'heal';
export type SequenceOrder = 'speedDesc' | 'leftToRight';

export type AnimType =
  | 'meleeStrike' | 'bowShot' | 'castBolt'        // 普攻
  | 'comboSlash'  | 'tripleShot'                  // 连斩 / 原地三连射
  | 'whirlwind'   | 'arrowRain'                   // 旋风斩 / 箭雨
  | 'groupSpell'  | 'singleSpell'                 // 群体法术 / 单体法术
  | 'groupSpellSmall'                             // 法术型宝宝的三目标法术：群体法术的缩小版
  | 'sealChain' | 'groupHeal' | 'revive';

// ---------- 属性 ----------
/** 6 项属性（SPEC §6）。气血、魔法的“当前值”放在 Unit.hp / Unit.mp */
export interface Stats {
  maxHp: number;     // 气血上限
  maxMp: number;     // 魔法上限
  physAtk: number;   // 物理伤害
  magAtk: number;    // 法术伤害（同时决定治疗量）
  defense: number;   // 防御
  speed: number;     // 速度
}

// ---------- 阵型格子 ----------
export interface Slot {
  row: 0 | 1;              // 0 = 前排（靠近对方），1 = 后排
  col: 0 | 1 | 2 | 3 | 4;  // 0 = 屏幕最左，4 = 屏幕最右
}

// ---------- 状态 ----------
export type StatusType = 'seal';
export interface Status {
  type: StatusType;
  remainingTurns: number;  // 剩余回合数，>0 时生效，头顶显示此数
  sourceId: UnitId;        // 施加者
  appliedTurn: number;     // 施加时的回合号
}

// ---------- 单位 ----------
export interface Unit {
  id: UnitId;
  templateId: string;      // 指向 heroes.ts / enemies.ts 中的模板
  name: string;
  side: Side;
  kind: UnitKind;
  classId: ClassId;
  rank?: EnemyRank;        // 仅敌方
  ownerId?: UnitId;        // 仅宝宝：主人 id
  petId?: UnitId;          // 仅友方人物：宝宝 id
  slot: Slot;
  weaponId?: WeaponId;     // 友方人物有；宝宝/敌人无
  attackMode: AttackMode;
  basicAttackSkillId: SkillId;
  skillIds: SkillId[];     // 主动技能，不含普攻；物理型宝宝为空
  passiveIds: PassiveId[]; // 被动技能（§4.5）；没有则为空数组
  stats: Stats;
  hp: number;              // 当前气血，0 ≤ hp ≤ maxHp
  mp: number;              // 当前魔法，0 ≤ mp ≤ maxMp
  alive: boolean;          // hp > 0 ⇔ alive
  statuses: Status[];
  defending: boolean;      // 本回合是否处于防御
  autoCommand: boolean;    // 敌方恒为 true；宝宝取设置项；人物恒为 false
}

// ---------- 技能（配置表行，详见 §4） ----------
export interface SkillDef {
  id: SkillId;
  name: string;
  description: string;
  classId: ClassId | 'common';   // 'common' = 普攻
  mpCost: number;
  effect: SkillEffect;
  damageType: DamageType;        // heal/seal/revive 填 'magic'，表示“法术类”
  targetSide: 'enemy' | 'ally';  // 相对施法者
  targetState: 'alive' | 'dead';
  targetCount: number;           // 最大目标数
  pattern: TargetPattern;
  hits: number;                  // 每个目标的段数
  multiplier: number;            // 每段倍率；seal/revive 填 0（不使用）
  hitRate: number;               // 0~1
  meleeCharge: boolean;          // 是否近战冲锋（仅当 delivery = 'melee' 时生效）
  animation: Partial<Record<Delivery, AnimType>>;
  element: Element;              // 法杖宝珠颜色、特效配色
  sequenceOrder?: SequenceOrder; // 仅 sequential
  status?: { type: StatusType; duration: number }; // 仅 seal
  reviveHpRatio?: number;        // 仅 revive
}

// ---------- 被动技能（配置表行，详见 §4.5） ----------
export type PassiveTrigger = 'basicAttack';          // 触发条件：目前只有“普攻出手时”
export type PassiveEffect =
  | { kind: 'extraHit'; hits: number };              // 对同一目标追加 hits 次攻击
export interface PassiveDef {
  id: PassiveId;
  name: string;            // 触发时的飘字，也用于指令面板说明
  description: string;
  trigger: PassiveTrigger;
  chance: number;          // 触发概率 0~1
  effect: PassiveEffect;
}

// ---------- 指令 ----------
export type Command =
  | { kind: 'attack'; targetId: UnitId }                     // 普攻
  | { kind: 'skill'; skillId: SkillId; targetId: UnitId }    // targetId = 主目标
  | { kind: 'defend' };

// ---------- 战斗状态 ----------
export type BattlePhase = 'init' | 'command' | 'execution' | 'settlement' | 'ended';

export interface BattleSettings {
  petAutoCommand: boolean;  // 宝宝自动出手（默认 false）
}

export interface BattleState {
  turn: number;                         // 回合号，从 1 开始
  phase: BattlePhase;
  units: Record<UnitId, Unit>;
  unitIds: UnitId[];                    // 固定顺序：A0..A9, E0..E9
  turnOrder: UnitId[];                  // 本回合出手顺序（回合开始时生成，包含倒地的友方，见 §8.2）；回合内不变
  actionCursor: number;                 // 下一个出手者在 turnOrder 中的下标
  lateQueue: UnitId[];                  // 队尾补出手队列：复活时速度位置已过的单位，按复活先后排列；出手或再次倒地后移出（§5.5）
  actedThisTurn: UnitId[];              // 本回合已经出过手的单位（每回合最多出手一次）
  aiTargetCounts: Record<Side, Record<AiTargetKind, Record<UnitId, number>>>;
                                        // 本回合各方 AI 已把某单位选为目标的次数，回合开始清零（§8.4）
  commands: Partial<Record<UnitId, Command>>; // 本回合已提交的指令
  awaitingCommandFor: UnitId | null;    // 执行阶段中等待玩家现场下指令的复活单位（§8.2）
  winner: Side | null;
  settings: BattleSettings;
  eventSeq: number;                     // 事件自增序号
}

// ---------- 全局数值（battleConfig.ts） ----------
export interface BattleConfig {
  crit: Record<'physical' | 'magic' | 'heal', { rate: number; multiplier: number }>;
                             // 暴击：物理/法术伤害/治疗分别配置，默认都是 rate 0.10、multiplier 1.5
  magicDefenseCoef: number;  // 法术伤害的防御系数，默认 0.5
  varianceMin: number;       // 随机浮动下限，默认 0.9
  varianceMax: number;       // 随机浮动上限，默认 1.1
  defendDamageMult: number;  // 防御指令受伤倍率，默认 0.5
}

// ---------- 引擎输入 ----------
export interface BattleSetup {
  config: BattleConfig;
  skills: Record<SkillId, SkillDef>;
  passives: Record<PassiveId, PassiveDef>;
  units: Unit[];             // 由 setup.ts 根据 heroes/enemies/formation 生成
  settings: BattleSettings;
  ai: AiConfig;
  seed: number;
}

export type AiTargetKind = 'attack' | 'seal' | 'heal';
export type AiTargetMode = 'focus' | 'spread';   // focus = 固定选“最优”目标；spread = 带权重的随机 + 分散

export interface AiConfig {
  healHpThreshold: number;      // 友军 hp 比例低于该值时治疗，默认 0.4（步骤 9 由 0.6 下调，§9.4 V5）
  aoeMinTargets: number;        // 存活对方单位 ≥ 该值时优先用群体技能，默认 3
  targetMode: Record<Side, AiTargetMode>;  // 默认 { enemy: 'spread', ally: 'focus' }，见 §8.4
  spread: {
    baseWeight: number;         // 每个候选目标的基础权重，默认 1
    repeatDecay: number;        // 同一回合内每被己方 AI 选中一次，权重 × 该值，默认 0.5
    lowHpBonus: number;         // 残血加权：权重 × (1 + lowHpBonus × 已损失气血比例)，默认 0.3
    sealCasterBonus: number;    // 封印时，法术 / 恢复职业的权重 × 该值，默认 2
  };
}
```

---

## 3. 逻辑层与表现层的事件接口

### 3.1 驱动方式
- 逻辑层是**同步、按步推进**的：`BattleEngine.stepAction()` 一次只结算**一个单位的一次出手**，把这次出手的全部事件同步发到 EventBus，并作为数组返回。
- 表现层（`render/director/BattleDirector`）订阅事件，把它们排进时间线播放；控制器要等 `director.idle()` 完成后才会调用下一次 `stepAction()`。这样从结构上保证“一次只有一个单位出手”（SPEC §5.1、SPEC §13）。
- 引擎算完时状态已经领先于画面，所以**表现层只能用事件里的字段**（`hpAfter`、`mpAfter` 等），不读引擎的实时状态。
- UI（日志、出手顺序条、指令面板）也订阅同一个 EventBus。

```ts
// core/events.ts
export class EventBus {
  on<T extends BattleEvent['type']>(type: T, fn: (e: Extract<BattleEvent, { type: T }>) => void): () => void; // 返回取消订阅函数
  onAny(fn: (e: BattleEvent) => void): () => void;
  emit(e: BattleEvent): void;   // 仅 core 内部调用
}
```

```ts
// 主循环（位于 main / ui 控制器，不在 core）
engine.start();                                   // BattleStart, TurnStart, CommandPhaseStart
// ……UI 逐个调用 engine.submitCommand() ……
engine.beginExecution();                          // AI 补指令，ExecutionPhaseStart
let batch;
while (engine.getState().phase === 'execution') {
  engine.stepAction();                            // 每次一个单位的出手
  await director.idle();                          // 等动画播完（跳过动画时立即完成）
  const waiting = engine.getState().awaitingCommandFor;
  if (waiting) await ui.askCommand(waiting);      // 复活单位现场下指令，内部调用 submitCommand()
}
// 循环结束时引擎已进入下一回合的 command 阶段，或已 ended
```

### 3.2 BattleEngine 对外 API
```ts
class BattleEngine {
  constructor(setup: BattleSetup);
  readonly events: EventBus;
  getState(): Readonly<BattleState>;          // 只读快照，供 UI 判断按钮状态
  start(): void;
  /** 本回合待下指令的单位（按指令顺序，见 §8.2），跳过死亡和 autoCommand 单位 */
  getPendingCommandUnits(): UnitId[];
  /** 某单位可用的指令/技能，以及置灰原因 */
  getCommandOptions(unitId: UnitId): CommandOptions;
  /** 某技能以某主目标出手时会命中的全部目标（UI 预览用，和执行时规则一致） */
  previewTargets(unitId: UnitId, skillId: SkillId, primaryId: UnitId): UnitId[];
  /** command 阶段给任意待指令单位下指令；execution 阶段只接受 awaitingCommandFor 指向的单位 */
  submitCommand(unitId: UnitId, cmd: Command): { ok: true } | { ok: false; reason: CommandRejectReason };
  beginExecution(): void;                     // 要求所有非自动单位都已提交指令
  stepAction(): BattleEvent[] | null;         // null = 战斗已结束；暂停等待指令时抛错
  setSettings(s: Partial<BattleSettings>): void; // 只在 command 阶段生效
}

interface CommandOptions {
  canAttack: boolean;                          // 存活即为 true
  canDefend: boolean;
  skills: { skillId: SkillId; enabled: boolean; disabledReason?: 'noMp' | 'sealed' }[];
}

type CommandRejectReason =
  | 'wrongPhase' | 'unitDead' | 'notCommandable' | 'unknownSkill'
  | 'noMp' | 'sealed' | 'invalidTarget';
```

### 3.3 事件清单
所有事件都有公共字段：
```ts
interface EventBase { seq: number; turn: number; }
```

| 事件 | 发出时机 | 字段（除公共字段外） |
|---|---|---|
| `BattleStart` | `start()` | `units: UnitSnapshot[]` |
| `TurnStart` | 每回合开始 | `turnOrder: UnitId[]` |
| `CommandPhaseStart` | 进入指令阶段 | `pending: UnitId[]` |
| `CommandRequested` | 执行阶段中复活的友方单位轮到出手、需要玩家下指令时（§8.2） | `unitId` |
| `ExecutionPhaseStart` | `beginExecution()` | `commands: Record<UnitId, Command>`（含 AI 指令） |
| `DefendApplied` | 紧接 `ExecutionPhaseStart`，每个防御单位一条 | `unitId` |
| `UnitActStart` | 每个单位出手开始 | `actorId`, `command: Command` |
| `CommandFallback` | 技能因封印/MP 不足改为普攻 | `actorId`, `fromSkillId`, `toSkillId`, `reason: 'sealed' \| 'noMp'` |
| `TargetRetargeted` | 主目标失效，重新选择 | `actorId`, `fromId`, `toId` |
| `ActionFizzled` | 没有任何合法目标，本次出手作废（不扣 MP） | `actorId`, `skillId`, `reason: 'noValidTarget'` |
| `SkillCast` | 目标确定、MP 扣除后 | `actorId`, `skillId`, `delivery: Delivery`, `animation: AnimType`, `meleeCharge: boolean`（已结合 delivery 计算）, `element`, `targets: UnitId[]`（执行顺序）, `mpCost`, `mpBefore`, `mpAfter` |
| `HitResolved` | 每段伤害结算 | `actorId`, `targetId`, `skillId`, `stepIndex`, `stepCount`, `hitIndex`, `hitCount`, `damageType`, `isMiss`, `isCrit`, `defended`, `damage`, `hpBefore`, `hpAfter`, `killed` |
| `HealResolved` | 每个治疗目标结算 | `actorId`, `targetId`, `skillId`, `stepIndex`, `stepCount`, `isCrit`, `amount`（实际回复量）, `hpBefore`, `hpAfter` |
| `UnitDied` | 气血归零 | `unitId`, `killerId`, `vanish: boolean`（敌方为 true：播放死亡后消失；友方为 false：倒地保持） |
| `UnitRevived` | 复活成功 | `unitId`, `actorId`, `hpAfter`, `maxHp`, `actsThisTurn: boolean`（本回合是否还会出手）, `queuedAtEnd: boolean`（是否排到队尾，见 §5.5） |
| `PassiveTriggered` | 被动技能生效的那一刻（连击：第二击之前） | `unitId`, `passiveId`, `name`（飘字）, `targetId` |
| `StatusApplied` | 封印命中 | `unitId`, `sourceId`, `status: StatusType`, `remainingTurns` |
| `StatusResisted` | 封印未命中 | `unitId`, `sourceId`, `status: StatusType` |
| `StatusTicked` | 回合结算时剩余回合减少但未到期 | `unitId`, `status`, `remainingTurns` |
| `StatusRemoved` | 到期，或单位死亡时清除 | `unitId`, `status`, `reason: 'expired' \| 'death'` |
| `UnitActEnd` | 单位出手结束 | `actorId` |
| `TurnEnd` | 结算阶段结束 | — |
| `BattleEnd` | 一方全灭 | `winner: Side`, `turns: number` |

`UnitSnapshot` = `Unit` 中表现层需要的字段（id、name、side、kind、classId、rank、slot、weaponId、attackMode、stats、hp、mp、templateId），只读。

**stepIndex 的语义（表现层编排的关键）**：同一个 `SkillCast` 之后，`stepIndex` 相同的 `HitResolved` / `HealResolved` 必须**同帧**表现；`stepIndex` 不同的按顺序表现。
- 普攻：1 条，step 0。
- 连斩：同一目标 step 0/1/2，`hitIndex` 0/1/2。
- 旋风斩：step 0..n-1，每个目标一步。
- 群体法术 / 三目标法术 / 群体治疗：所有目标都是 step 0（同帧爆发、同时飘字）。
- 普攻触发连击：同一目标 step 0/1，`hitIndex` 0/1，`hitCount = stepCount = 2`；`PassiveTriggered` 夹在两条 `HitResolved` 之间。

**死亡事件顺序**：`sequential` / `multiHit` 中，`UnitDied` 紧跟在致死的那条 `HitResolved` 之后；`simultaneous` 中，等该 step 的所有 `HitResolved` 都发出后，再统一发出 `UnitDied`。

### 3.4 一次出手的事件序列示例
```
UnitActStart
 [CommandFallback]       // 可选
 [TargetRetargeted]      // 可选
 SkillCast  或  ActionFizzled
 HitResolved / HealResolved / StatusApplied / StatusResisted / UnitRevived / PassiveTriggered …（0..n 条）
 [UnitDied …]
UnitActEnd
[BattleEnd]              // 这次出手导致一方全灭时
```
最后一个单位（含队尾补出手的复活单位）出手后，同一次 `stepAction()` 的返回值末尾追加 `StatusTicked / StatusRemoved …`、`TurnEnd`、下一回合的 `TurnStart`、`CommandPhaseStart`。

### 3.5 表现层订阅约定
- `BattleDirector` 用 `onAny` 收事件并转成时间线片段，片段是返回 Promise 的异步函数，按顺序执行，同一 stepIndex 的片段并行执行。
- 战斗速度（1x/2x）和跳过动画由 Director 的 `timeScale` / `skip` 控制，逻辑层不感知（SPEC §9、SPEC §10）。
- 冲锋/返回不是逻辑事件：Director 看到 `SkillCast.meleeCharge = true` 时，在第一段命中前插入“移动到目标面前”，在 `UnitActEnd` 前插入“返回原位”；`sequential` 在相邻两个 step 之间插入“冲向下一个目标”。

---

## 4. 技能配置表

### 4.1 字段定义（`src/data/skills.ts`，类型为 `SkillDef`）
| 字段 | 含义 | 取值规则 |
|---|---|---|
| `id` | 唯一键 | snake_case |
| `name` | 名称 | 中文 |
| `description` | 指令面板说明 | 中文 |
| `classId` | 职业 | `physical / magic / seal / heal / common` |
| `mpCost` | 消耗 MP | 出手瞬间一次性扣除；普攻为 0 |
| `effect` | 效果 | `damage / heal / seal / revive` |
| `damageType` | 伤害类型 | `physical / magic`；heal、seal、revive 固定为 `magic`（法术类，原地施放） |
| `targetSide` | 目标阵营 | 相对施法者：`enemy / ally` |
| `targetState` | 目标状态 | `alive`；只有复活是 `dead` |
| `targetCount` | 目标数 | 最大目标数 |
| `pattern` | 执行模式 | `single`：单目标单段；`multiHit`：单目标多段；`sequential`：多目标依次；`simultaneous`：多目标同时 |
| `hits` | 段数 | 每个目标被攻击的次数 |
| `multiplier` | 倍率 | 每段倍率；seal / revive 填 0 |
| `hitRate` | 命中率 | 0~1，每段独立判定 |
| `meleeCharge` | 是否近战冲锋 | 只有实际 delivery 为 `melee` 时才冲锋 |
| `animation` | 动画类型 | 按 delivery 给出：`{ melee?, ranged?, cast? }` |
| `element` | 元素 | 决定法杖宝珠/特效颜色 |
| `sequenceOrder` | 依次攻击的顺序 | 仅 `sequential`，`speedDesc`（默认，按目标速度由快到慢）或 `leftToRight` |
| `status` | 附加状态 | 仅封印：`{ type: 'seal', duration }` |
| `reviveHpRatio` | 复活回复比例 | 仅复活 |

**配置合法性约束**（步骤 2 用单元测试校验整张表）：
- `single`：`targetCount = 1` 且 `hits = 1`
- `multiHit`：`targetCount = 1` 且 `hits ≥ 2`
- `sequential`、`simultaneous`：`targetCount ≥ 2` 且 `hits = 1`
- `effect = revive` ⇔ `targetState = 'dead'`，且 `targetSide = 'ally'`，`targetCount = 1`
- `damageType = physical` 时，`animation` 必须同时有 `melee` 和 `ranged`；`damageType = magic` 时必须有 `cast`

### 4.2 已确定的技能
| id | 名称 | 职业 | MP | 效果 | 伤害类型 | 目标 | 数量 | 模式 | 段数 | 倍率 | 命中率 | 冲锋 | 动画（melee / ranged / cast） | 元素 | 其他 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `basic_physical` | 普攻 | common | 0 | damage | physical | 敌·存活 | 1 | single | 1 | 1.0 | 0.95 | 是 | meleeStrike / bowShot / — | none | — |
| `basic_magic` | 法术普攻 | common | 0 | damage | magic | 敌·存活 | 1 | single | 1 | 1.0 | 0.95 | 否 | — / — / castBolt | fire | — |
| `combo_slash` | 连斩 | physical | 30 | damage | physical | 敌·存活 | 1 | multiHit | 3 | 0.6 | 1.0 | 是 | comboSlash / tripleShot / — | none | 近战单位使用 |
| `triple_shot` | 三连射 | physical | 30 | damage | physical | 敌·存活 | 1 | multiHit | 3 | 0.6 | 1.0 | 是 | comboSlash / tripleShot / — | none | 连斩的弓箭手版本：数值相同，远程单位使用 |
| `whirlwind` | 旋风斩 | physical | 60 | damage | physical | 敌·存活 | 7 | sequential | 1 | 0.7 | 1.0 | 是 | whirlwind / arrowRain / — | none | `sequenceOrder: 'speedDesc'`；近战单位使用 |
| `arrow_rain` | 箭雨 | physical | 60 | damage | physical | 敌·存活 | 7 | sequential | 1 | 0.7 | 1.0 | 是 | whirlwind / arrowRain / — | none | 旋风斩的弓箭手版本：数值相同，远程单位使用 |
| `group_spell` | 群体法术·天雷 | magic | 60 | damage | magic | 敌·存活 | 6 | simultaneous | 1 | 0.8 | 1.0 | 否 | — / — / groupSpell | thunder | — |
| `triple_spell` | 三重魂火 | magic | 30 | damage | magic | 敌·存活 | 3 | simultaneous | 1 | 0.8 | 1.0 | 否 | — / — / groupSpellSmall | fire | 法术型宝宝的主动技能（步骤 9 新增） |
| `single_spell` | 单体法术·炎爆 | magic | 40 | damage | magic | 敌·存活 | 1 | single | 1 | 1.6 | 1.0 | 否 | — / — / singleSpell | fire | SPEC §7.1 中的“可选补充” |
| `seal` | 封印 | seal | 40 | seal | magic | 敌·存活且未被封印 | 1 | single | 1 | 0 | 0.75 | 否 | — / — / sealChain | seal | `status: { type: 'seal', duration: 3 }` |
| `group_heal` | 群体治疗 | heal | 60 | heal | magic | 友·存活 | 3 | simultaneous | 1 | 1.0 | 1.0 | 否 | — / — / groupHeal | heal | — |
| `revive` | 复活 | heal | 100 | revive | magic | 友·死亡 | 1 | single | 1 | 0 | 1.0 | 否 | — / — / revive | heal | `reviveHpRatio: 0.3` |

> 步骤 2 补充：`triple_shot`、`arrow_rain` 不是新技能，而是 SPEC §7.1 里连斩 / 旋风斩的“弓箭手版本”。它们在技能表里各占一行（用原技能改名称、说明得到，数值由测试保证相同），这样指令面板、日志、飘字和技能演示模式显示的名称完全一致。
>
> 步骤 9：删除 `group_spell_fire`（原来只有骨龙幼崽使用，宝宝改型后没有使用者）；新增 `triple_spell`。上表的 MP 列是步骤 9 下调后的数值（原值：连斩 / 三连射 40，旋风斩 / 箭雨 / 群体法术 / 群体治疗 80，单体法术 50，封印 60，复活 120；见 §9.4 V4）。

单体治疗（SPEC §7.1 中的“可选补充”）本期不做，表结构已能支持（`effect: heal, pattern: single`）。

### 4.3 职业技能库（`classes.ts`）
| 职业 | 技能库（不含普攻） |
|---|---|
| physical | `combo_slash`, `whirlwind`（近战）；`triple_shot`, `arrow_rain`（远程） |
| magic | `group_spell`, `single_spell`, `triple_spell`（仅法术型宝宝使用） |
| seal | `seal` |
| heal | `group_heal`, `revive` |

- 友方人物：`skillIds` 由 `heroSkillIds(职业, 出手方式)` 给出——物理系近战拿 `combo_slash, whirlwind`，弓箭手拿 `triple_shot, arrow_rain`；法术系拿 `group_spell, single_spell`；封印、恢复拿各自的全部技能。
- 宝宝：`skillIds` 和 `passiveIds` 由宝宝类型决定（§4.6）。
- 敌人：`skillIds` 在模板里写明，必须是所属职业技能库的子集。
- 敌人不能拥有 `revive`（敌人被击败即消失，见 §5.5）；步骤 2 用测试校验。

### 4.4 Delivery 与普攻的决定方式（SPEC §7、SPEC §7.3）
- 普攻：`basicAttackSkillId` 由武器决定（`weapons.ts`）：刀/剑/枪/弓 → `basic_physical`，法杖 → `basic_magic`。宝宝和敌人没有武器，在模板里直接写 `attackMode` 和 `basicAttackSkillId`。
- 实际 delivery：`damageType = magic` 时固定为 `cast`；`damageType = physical` 时取单位的 `attackMode`（`melee` 或 `ranged`）。`attackMode = cast` 的单位如果被配置成物理技能，按 `melee` 处理（防御性规则，默认数据里不会出现）。
- 实际冲锋 = `skill.meleeCharge && delivery === 'melee'`。
- 动画 = `skill.animation[delivery]`。

### 4.5 被动技能（`src/data/passives.ts`，类型为 `PassiveDef`；判定在 `src/core/passives.ts`）
被动技能不出现在指令里、不消耗 MP、不受封印和 MP 影响；单位通过 `passiveIds` 拥有它。引擎在对应的触发点查表、按概率判定、执行效果，并发出 `PassiveTriggered`。

| 字段 | 含义 |
|---|---|
| `id` / `name` / `description` | 键、名称（也是触发时的飘字）、说明 |
| `trigger` | 触发条件。目前只有 `basicAttack`（单位用普攻出手时，包括技能被改成普攻的情况） |
| `chance` | 触发概率 0~1 |
| `effect` | 效果。目前只有 `{ kind: 'extraHit', hits }`：对同一目标追加 `hits` 次攻击 |

| id | 名称 | 触发 | 概率 | 效果 |
|---|---|---|---|---|
| `double_strike` | 连击 | basicAttack | 0.5 | extraHit, hits: 1 |

**连击的结算**（SPEC §7.1 第 5 条）：
1. 普攻的目标确定、发出 `SkillCast` 之后，判定一次 `rand(0,1) < chance`。未触发就是普通的一次普攻。
2. 触发后计划段数为 2。第一击照常结算（`HitResolved`，`hitIndex 0`，`hitCount 2`）。
3. 第一击之后目标仍然存活：发出 `PassiveTriggered`，再结算第二击（`hitIndex 1`）。第二击用同一个普攻技能、同一个目标，重新独立判定命中、浮动、暴击（第一击未命中不影响第二击）。
4. 第一击已经打死目标：第二击取消，不发 `PassiveTriggered`，不换目标（与连斩中途目标死亡的规则一致，§6.6）。
5. 第二击不重新冲锋、不扣任何消耗；整个过程是该单位的一次出手。
6. 随机数消耗顺序：连击判定 →（每一击）命中 → 浮动 → 暴击。没有被动技能的单位不消耗“连击判定”那一次随机数，所以原有单位的结算序列不变。

新增被动技能的方法：在 `passives.ts` 加一行；需要新的触发点或效果时，扩展 `PassiveTrigger` / `PassiveEffect` 并在 `core/passives.ts` 加对应分支。

### 4.6 宝宝类型（`src/data/pets.ts`）
宝宝只有两种类型，类型决定职业、主动技能和被动技能；每只宝宝属于哪一型写在 `PET_ASSIGNMENT` 里，可以改。

| 类型 | classId | 主动技能 `skillIds` | 被动技能 `passiveIds` | 指令面板 |
|---|---|---|---|---|
| 物理型 `physical` | physical | 无 | `double_strike` | 攻击、防御 |
| 法术型 `magic` | magic | `triple_spell` | 无 | 攻击、技能、防御 |

| 宝宝 | 原职业 / 技能 | 新类型 | 出手方式 / 普攻 |
|---|---|---|---|
| A5 影狼·灰 | physical / 连斩 | 物理型 | melee / basic_physical |
| A6 影狼·赤 | physical / 连斩 | 物理型 | melee / basic_physical |
| A7 骨龙幼崽 | magic / 群体法术·烈焰 | 法术型 | cast / basic_magic |
| A8 幽灵 | seal / 封印 | 法术型 | cast / basic_magic |
| A9 魔偶 | heal / 群体治疗 | 物理型 | melee / basic_physical |

出手方式和普攻沿用原来的配置（幽灵本来就是原地施法，魔偶本来就是近战），所以模型和基础动作不用改。

---

## 5. 公式与规则（`src/core/damage.ts`、`status.ts`）

记号：`A` 为攻击者，`T` 为目标，`S` 为技能，`cfg` 为 `BattleConfig`，`rand(a,b)` 为注入的 RNG 产生的 [a,b) 均匀随机数。

### 5.1 物理伤害（近战和远程完全相同）
```
base   = max(1, A.physAtk × S.multiplier − T.defense)
v      = rand(cfg.varianceMin, cfg.varianceMax)          // 0.9 ~ 1.1
crit   = rand(0,1) < cfg.crit.physical.rate ? cfg.crit.physical.multiplier : 1
def    = T.defending ? cfg.defendDamageMult : 1
damage = max(1, round(base × v × crit × def))
```

### 5.2 法术伤害
```
base   = max(1, A.magAtk × S.multiplier − T.defense × cfg.magicDefenseCoef)
v      = rand(cfg.varianceMin, cfg.varianceMax)
crit   = rand(0,1) < cfg.crit.magic.rate ? cfg.crit.magic.multiplier : 1
def    = T.defending ? cfg.defendDamageMult : 1
damage = max(1, round(base × v × crit × def))
```

### 5.3 命中判定
- 伤害技能和封印每段先判定命中：`rand(0,1) < S.hitRate` 为命中。未命中时 `HitResolved.isMiss = true`、`damage = 0`，不判定暴击。
- 普攻命中率 0.95，所以普攻会小概率未命中；技能命中率见 §4.2。
- 治疗、复活不判定命中（命中率固定为 1.0）。
- 随机数消耗顺序固定为：命中 → 浮动 → 暴击。这样测试用固定种子时结果可复现。

### 5.4 治疗
```
v      = rand(cfg.varianceMin, cfg.varianceMax)
crit   = rand(0,1) < cfg.crit.heal.rate ? cfg.crit.heal.multiplier : 1
amount = round(A.magAtk × S.multiplier × v × crit)
实际回复 = min(amount, T.maxHp − T.hp)
```
治疗不受防御影响，可以暴击（`HealResolved.isCrit`），不能作用于死亡单位。

### 5.5 死亡与复活
- **敌方死亡**：播放死亡动画后从场上消失（`UnitDied.vanish = true`），不能再被任何技能选中。敌人没有复活技能（§4.3）。
- **友方死亡**：倒地并保持倒地姿态（`vanish = false`），只能被复活技能选中。
- **复活目标**：只能选倒地的友方单位；选中存活的友方会被拒绝（`invalidTarget`）。
- **复活效果**：`hp = max(1, floor(T.maxHp × S.reviveHpRatio))`，`mp` 保持死亡时的值，`statuses = []`，`defending = false`。
- **复活当回合可以行动**（步骤 9 修改，SPEC §7.1）：被复活者在本回合 `turnOrder` 中的位置（`turnOrder` 包含倒地的友方，§8.2）决定它什么时候出手：
  - 位置在复活施法者**之后**（速度更慢；同速时由回合开始时的随机排序决定）：本回合轮到它的位置时出手。`actsThisTurn = true`，`queuedAtEnd = false`。
  - 位置在施法者**之前**（速度更快，那个位置已经过去）：加入 `lateQueue`，在 `turnOrder` 全部走完之后出手；同一回合有多个这样的单位时，按复活的先后顺序。`actsThisTurn = true`，`queuedAtEnd = true`。
  - **每回合最多出手一次**：本回合已经出过手（在 `actedThisTurn` 里）、之后被击倒又被复活的单位，本回合不再出手。`actsThisTurn = false`，`queuedAtEnd = false`。
  - 排在队尾的单位如果在轮到它之前又被击倒，轮到时直接跳过并移出队列；还在队列里时再次被复活，保留原来的位置（不重复入队），已经移出后再被复活则重新排到队尾。
  - `turnOrder` 本身在回合内不改变，所以目标补足、重选用的“速度顺序”（§6.2）不受影响。
  - 本回合出手用的指令：见 §8.2 的“复活单位的指令”。
- 下一回合起正常下指令、参与排序。

### 5.6 暴击规则
- 物理伤害、法术伤害、治疗都会暴击；每段 / 每个目标独立判定（连斩 3 段、旋风斩 7 个目标、群体法术 6 个目标、群体治疗 3 个目标都分别判定）。
- 暴击率和倍率按类型分别配置在 `battleConfig.ts` 的 `crit` 中，默认都是 0.10 / 1.5。
- 封印、复活不暴击。

### 5.7 防御指令
- 选择“防御”的单位，从本回合**执行阶段开始**就处于防御状态（`defending = true`），一直到本回合结算阶段，期间受到的所有物理、法术伤害都 × `defendDamageMult (0.5)`。
- 防御单位在出手顺序里的那一次出手只发出 `UnitActStart` / `UnitActEnd`，不做其他事。
- 结算阶段把所有单位的 `defending` 清为 false；单位死亡时也会清除。

### 5.8 封印
- **目标限制**：只能选 1 个**存活且未被封印**的敌方单位。选中已被封印的单位时，指令面板不可点，`submitCommand` 返回 `invalidTarget`。
- **命中**：按 `seal.hitRate`（0.75）判定。命中发出 `StatusApplied`，未命中发出 `StatusResisted`（飘字“未命中”）。
- **效果**：`remainingTurns > 0` 期间不能使用任何技能（指令面板置灰，`submitCommand` 拒绝并返回 `sealed`），仍然可以普攻、防御。
- **立即生效**：如果目标本回合还没出手、提交的指令是技能，轮到它时发出 `CommandFallback(reason: 'sealed')`，改为普攻（目标规则见 §6.5）。
- **持续与递减**：施加时 `remainingTurns = duration (3)`。每回合结算阶段，所有封印 `remainingTurns −= 1`：减到 0 时发出 `StatusRemoved(expired)` 并移除，否则发出 `StatusTicked`。施加的那个回合也计入递减。例：第 R 回合施加 3 回合封印 → R 回合剩余时间 + 第 R+1、R+2 回合都被封，第 R+2 回合结算时解除。
- **不能重复封印**：已被封印的单位不能再被封印。如果出手时主目标已经被别人封印，按 §6.5 重选一个未被封印的敌人；没有就作废（不扣 MP）。所以一个单位身上最多只有 1 个 seal，到期前持续回合不会改变。
- **死亡**：清除全部状态（`StatusRemoved(death)`），复活后不带封印。

### 5.9 MP 规则
- MP 在 `SkillCast` 时一次性扣除整个技能的 `mpCost`；多目标、多段技能也只扣一次。
- `mp < mpCost` 时，该技能在指令面板置灰，`submitCommand` 返回 `noMp`。`mp = 0` 时所有技能不可用，只能普攻、防御。
- 执行时再检查一次：如果 MP 不足，发出 `CommandFallback(reason: 'noMp')`，改为普攻。（默认规则下 MP 不会在提交指令后减少，这是防御性分支。）
- 不自动回复 MP（§9 U9）。
- 出手作废（`ActionFizzled`）时不扣 MP。

---

## 6. 目标规则（`src/core/targeting.ts`）

### 6.1 目标合法性
| 技能 | 合法目标 |
|---|---|
| 敌对技能（普攻、连斩、旋风斩、群体法术、单体法术） | 存活的敌方单位（敌方死亡即消失，§5.5） |
| 封印 | 存活**且未被封印**的敌方单位 |
| 群体治疗 | 存活的友方单位（人物和宝宝，包括施法者本人） |
| 复活 | **倒地**的友方单位 |

UI 只允许点选合法目标；`submitCommand` 对不合法目标返回 `invalidTarget`。

### 6.2 速度顺序
所有补足、排序、重选都用同一种**速度顺序**：按单位在本回合 `turnOrder` 中的位置升序，即速度由快到慢；同速时按回合开始时的随机结果。不在 `turnOrder` 中的单位（防御性情况）排在最后，再按 `speed` 降序、`id` 升序。

### 6.3 多目标补足（敌对技能与群体治疗相同）
```
targets = [主目标] + 其余合法单位按速度顺序取前 (targetCount − 1) 个
```
- 主目标一定会被击中，并且排在第一个。
- 合法单位少于 `targetCount` 时全部命中（旋风斩不足 7、群体法术不足 6、群体治疗不足 3，SPEC §7.2）。
- 群体治疗的候选包括友方人物、宝宝和施法者本人。
- 复活不补足：`targetCount = 1`，只取主目标。
- `previewTargets()` 与执行时调用同一个函数。

### 6.4 执行顺序
- `sequential`：主目标第一个被攻击，其余目标按 `sequenceOrder`：
  - `speedDesc`（默认）：按速度由快到慢。
  - `leftToRight`：按 `col` 升序，`col` 相同时前排在先。
- `simultaneous`：顺序只影响事件排列，表现为同帧。
- `multiHit`：同一目标重复 `hits` 次。

### 6.5 出手时目标失效（重选或判空）
目标在**出手开始时**统一重新校验（SPEC §5.4）：
- **主目标已不合法**（敌方已被击败消失；封印时目标已被别人封印；群体治疗目标已倒地）：选一个新的合法单位作为主目标，发出 `TargetRetargeted`，再按 §6.3 补足。新主目标的选法：
  - 玩家下的指令，以及 `targetMode = 'focus'` 一方的 AI 指令：按速度顺序选第一个合法单位（原规则）。
  - `targetMode = 'spread'` 一方的 AI 指令（默认是敌方）：按 §8.4 的权重随机选，并计入本回合的被选次数。否则所有失效的攻击都会落到同一个“最快的友方”身上，变成变相集火。
- **复活**目标已不是倒地状态（被别人先复活了）：不重选，发出 `ActionFizzled`，不扣 MP。
- 找不到任何合法目标：发出 `ActionFizzled`，不扣 MP。
- **CommandFallback 改普攻后**：原主目标是存活的敌方就沿用；否则（例如原来是治疗友军）按上一条同样的方法选一个存活敌人。

### 6.6 执行中目标死亡
- `multiHit`（连斩/三连射）：目标死亡后剩余段数取消，不再发出 `HitResolved`。表现层随即返回原位。
- `sequential`（旋风斩/箭雨）：目标列表在出手开始时确定（即 `SkillCast.targets`）。`stepIndex` = 目标在该列表中的下标，`stepCount` = 列表长度。每一步执行前检查目标是否存活，已死亡的直接跳过（不发事件、不补位）。表现层只为实际收到 `HitResolved` 的步数播放冲刺，所以不会浪费动画时间（SPEC §7.2）。
- `multiHit` 中 `stepIndex = hitIndex`，`stepCount = hitCount = hits`（计划段数）；被取消的段数不发事件。
- `simultaneous`：所有目标同时结算，不存在“中途死亡”。
- 一方全灭后，当前出手剩余的步数全部跳过，发出 `UnitActEnd`、`BattleEnd`。

> 说明：在默认规则下，一个单位出手期间，只有它本人会造成伤害，旋风斩每个目标只打一次，所以 `sequential` 中“已在列表里的目标中途死亡”只可能来自未来扩展（如反击、溅射）。跳过逻辑仍然要实现并测试（用自定义测试技能构造）。

---

## 7. 阵型坐标规范（`src/data/formation.ts`）

### 7.1 世界坐标系
- Three.js 右手系：`+x` 向右，`+y` 向上，`+z` 朝向相机。
- 相机默认在 `+z` 一侧斜俯视原点（俯角 30°，可在 renderConfig 中调整），所以屏幕左上 ≈ (−x, −z)，右下 ≈ (+x, +z)。

### 7.2 阵型参数
```ts
export const FORMATION = {
  colSpacing: 2.2,   // 同排相邻格子间距（步骤 8 由 1.9 加大）
  rowSpacing: 2.3,   // 前后排间距（步骤 8 由 2.0 加大）
  allyFrontCenter:  { x:  2.7, z:  2.7 },  // 友方前排中心（col 2；步骤 8 由 3.4 收到 2.7）
  enemyFrontCenter: { x: -2.7, z: -2.7 },  // 敌方前排中心（col 2）
};
// 双方连线方向：友方面朝 fAlly = normalize(-1, 0, -1)，敌方面朝 fEnemy = normalize(1, 0, 1)
// 排方向（col 增大方向）：p = normalize(1, 0, -1)，两方相同，col 0 在屏幕左侧
position(side, row, col) = frontCenter(side)
                         + p × (col − 2) × colSpacing
                         − facing(side) × row × rowSpacing   // 后排远离对方
```
单位朝向固定为 `facing(side)`，出生后不变（近战冲锋途中平滑转向跑动方向、到位时正对目标，跑回原位的途中转回原朝向）。

> 步骤 8 调整：单位偏小且挤，所以把格子间距加大约 15%，同时把两军拉近（前排间距由 9.6 减到 7.6），整体占地基本不变，相机才能从 35 拉近到 32.5。

### 7.3 计算结果（保留 3 位小数，由 formation.ts 按上式生成，不手填）
| 格子 | 友方 (x, z) | 敌方 (x, z) |
|---|---|---|
| 前排 col0 | (−0.411, 5.811) | (−5.811, 0.411) |
| 前排 col1 | (1.144, 4.256) | (−4.256, −1.144) |
| 前排 col2 | (2.700, 2.700) | (−2.700, −2.700) |
| 前排 col3 | (4.256, 1.144) | (−1.144, −4.256) |
| 前排 col4 | (5.811, −0.411) | (0.411, −5.811) |
| 后排 | 对应前排 + (1.626, 1.626) | 对应前排 + (−1.626, −1.626) |

### 7.4 单位分配
- 友方：人物占后排 `row 1, col c`，他的宝宝占前排 `row 0, col c`（宝宝在主人身前一排，SPEC §4）。
- 敌方：Boss 在后排中央；详见 §8.3。
- 近战冲锋的落点 = 目标位置 + 目标朝向 × 1.2（站在目标面前），由表现层计算，逻辑层不涉及坐标。
- 逻辑层只用 `Slot`（row/col）；世界坐标只给 render 用。

---

## 8. 回合流程状态机

### 8.1 状态图
```
 init ──start()──► TurnStart(排序) ──► command ──beginExecution()──► execution
                        ▲                 ▲  │                           │  │
                        │                 └──┘ submitCommand()×n         │  │ 每次 stepAction() 后胜负判定；
                        │                                                │  │ 复活单位轮到时可暂停等指令
                        │                                                │  └──(一方全灭)──► ended
                        │                                   (全部出手完) ▼
                        └────────────── TurnEnd ◄──────────────── settlement
```

### 8.2 各阶段做什么
**TurnStart（回合开始）**
1. `turn += 1`（首回合为 1）。
2. 出手排序：取所有存活单位**和倒地的友方单位**（倒地友方可能在本回合被复活，§5.5；敌方被击败即消失，不参与），按 `speed` 降序；速度相同时用 RNG 打乱（Fisher–Yates，只在同速的组内打乱）。结果写入 `turnOrder`，`actionCursor = 0`，`commands = {}`，`lateQueue = []`，`actedThisTurn = []`，`aiTargetCounts` 清零。
3. 发出 `TurnStart`。

**command（指令阶段）**
- 指令顺序：`A0 人物 → A0 的宝宝 → A1 人物 → A1 的宝宝 …`（按 col 0→4）。跳过死亡单位，`petAutoCommand = true` 时跳过宝宝。
- UI 逐个调用 `submitCommand()`，校验内容：阶段、存活、可指挥、技能存在且属于该单位、MP、封印、主目标满足 `targetSide/targetState`。
- 允许对同一单位重复提交（覆盖之前的指令），方便 UI 做“返回上一个”。
- `beginExecution()`：如果有非自动单位未提交指令就抛错；然后由 `ai.ts` 给所有 `autoCommand` 单位生成指令，发出 `ExecutionPhaseStart` 和所有 `DefendApplied`，进入 execution。

**execution（执行阶段）**——每次 `stepAction()`：
1. 找下一个出手者：先从 `actionCursor` 往后找 `turnOrder` 里下一个**仍然存活**的单位（倒地单位直接跳过，不发事件）；`turnOrder` 走完后，再依次取 `lateQueue` 里存活的单位（队尾补出手，§5.5）。出手开始时把它记入 `actedThisTurn`。
   - **复活单位的指令**：本回合被复活且 `actsThisTurn = true` 的单位，指令阶段时处于倒地状态、没有指令（单位本回合内先死亡后复活的，死亡时其指令已作废）。轮到它时：
     - 友方人物，或 `petAutoCommand = false` 的宝宝：引擎**暂停**，`awaitingCommandFor = 该单位`，发出 `CommandRequested` 并返回本次事件。玩家通过 `submitCommand()` 现场下指令（校验规则与指令阶段相同；界面弹出指令面板）后，下一次 `stepAction()` 从这个单位的 `UnitActStart` 继续。
     - 敌方单位、`petAutoCommand = true` 的宝宝（即 `autoCommand = true` 的单位）：由 `ai.ts` 现场生成指令，不暂停。
     - 暂停期间调用 `stepAction()` 会抛错。
     - 自动战斗模式（友方全部由 AI 代打）里，控制器收到 `CommandRequested` 后用 `ai.ts` 生成指令并提交。
2. 发出 `UnitActStart`；按以下顺序处理：防御 → 只发 `UnitActEnd`；技能 → 检查封印/MP（必要时 `CommandFallback`）→ 校验目标（§6.5）→ 扣 MP + `SkillCast` → 按 pattern 结算 → `UnitActEnd`。
3. 胜负判定：任一方存活单位数为 0 → `winner = 另一方`，`phase = ended`，发出 `BattleEnd`，之后 `stepAction()` 返回 null。
4. 如果 `turnOrder` 和 `lateQueue` 里都已经没有剩余出手者 → 进入 settlement，在同一次返回值中附加结算事件。

**settlement（结算）**
1. 所有存活单位的状态 `remainingTurns −= 1`（`StatusTicked / StatusRemoved(expired)`）。
2. 清除所有 `defending`。
3. 发出 `TurnEnd`；再次执行胜负判定（防御性，默认规则下不会在此触发）；进入下一回合的 TurnStart → command。

### 8.3 初始阵容（`heroes.ts` / `enemies.ts`，下表为步骤 9 再平衡后的数值）

> 步骤 9 的再平衡（§9.4 V4、V5）：友方人物魔法 300/300/600/500/600 → 600/600/800/500/800，法术型宝宝 300/250 → 400/400；技能消耗下调（§4.2）；
> 敌方气血约 ×1.18、物伤 / 法伤约 ×1.05；治疗阈值 0.6 → 0.4。友方的气血、伤害、防御、速度没有改。
> 1000 个种子的自动战斗：友方胜率 60.3%，回合数中位 10（10% 分位 7，90% 分位 16），72.7% 的战斗在 8~14 回合内。

> 步骤 8 的平衡：友方物伤 / 法伤约 ×1.3；敌方气血约 ×0.7、物伤 / 法伤约 ×1.9；Boss 气血 4000 → 3200、物伤 220 → 340。
> 双方输出都提高、敌方变脆，战斗从平均 27 回合缩短到 11 回合。防御、速度、魔法、技能表、公式、规则都没有改。
> 1000 个种子的自动战斗：友方胜率 61.3%，回合数中位 11（10% 分位 8，90% 分位 15），83.7% 的战斗在 8~14 回合内。
> 调数值后用 `npm run balance` 核对，`tests/regression` 里有一条测试守着“胜率 50%~70%”。
**友方人物（后排）**
| id | 格子 | 名称 | 职业 | 武器 | attackMode | 普攻 | HP | MP | 物伤 | 法伤 | 防御 | 速度 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A0 | 1,0 | 夜隼 | physical（自由职业） | 弓 bow | ranged | basic_physical | 950 | 600 | 195 | 50 | 45 | 110 |
| A1 | 1,1 | 烬刃 | physical | 刀 blade | melee | basic_physical | 1200 | 600 | 210 | 50 | 60 | 90 |
| A2 | 1,2 | 雷咒 | magic | 法杖 staff | cast | basic_magic | 850 | 800 | 50 | 220 | 35 | 95 |
| A3 | 1,3 | 缚魂 | seal | 剑 sword | melee | basic_physical | 1000 | 500 | 145 | 155 | 50 | 120 |
| A4 | 1,4 | 守誓 | heal | 枪 spear | melee | basic_physical | 1000 | 800 | 130 | 180 | 50 | 85 |

**友方宝宝（前排，位于主人身前）**
| id | 格子 | 名称/形象 | 主人 | 类型（职业） | attackMode | 普攻 | 主动技能 | 被动技能 | HP | MP | 物伤 | 法伤 | 防御 | 速度 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A5 | 0,0 | 影狼·灰 | A0 | 物理型 physical | melee | basic_physical | — | double_strike | 650 | 150 | 145 | 25 | 40 | 105 |
| A6 | 0,1 | 影狼·赤 | A1 | 物理型 physical | melee | basic_physical | — | double_strike | 700 | 150 | 150 | 25 | 40 | 100 |
| A7 | 0,2 | 骨龙幼崽 | A2 | 法术型 magic | cast | basic_magic | triple_spell | — | 600 | 400 | 40 | 155 | 30 | 90 |
| A8 | 0,3 | 幽灵 | A3 | 法术型 magic | cast | basic_magic | triple_spell | — | 600 | 400 | 40 | 115 | 30 | 115 |
| A9 | 0,4 | 魔偶 | A4 | 物理型 physical | melee | basic_physical | — | double_strike | 900 | 250 | 105 | 115 | 60 | 70 |

**敌方**
| id | 格子 | 名称 | 级别 | 职业 | attackMode | 普攻 | 技能 | HP | MP | 物伤 | 法伤 | 防御 | 速度 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E0 | 0,0 | 骷髅兵 | minion | physical | melee | basic_physical | — | 495 | 0 | 240 | 0 | 40 | 80 |
| E1 | 0,1 | 骷髅兵 | minion | physical | melee | basic_physical | — | 495 | 0 | 240 | 0 | 40 | 82 |
| E2 | 0,2 | 堕落骑士 | elite | physical | melee | basic_physical | combo_slash | 910 | 200 | 300 | 55 | 70 | 75 |
| E3 | 0,3 | 骷髅兵 | minion | physical | melee | basic_physical | — | 495 | 0 | 240 | 0 | 40 | 84 |
| E4 | 0,4 | 骷髅兵 | minion | physical | melee | basic_physical | — | 495 | 0 | 240 | 0 | 40 | 86 |
| E5 | 1,0 | 恶魔祭司·缚 | elite | seal | cast | basic_magic | seal | 660 | 400 | 120 | 255 | 40 | 105 |
| E6 | 1,1 | 亡灵法师 | elite | magic | cast | basic_magic | group_spell, single_spell | 620 | 500 | 80 | 315 | 35 | 92 |
| E7 | 1,2 | 深渊魔将 | boss | physical | melee | basic_physical | combo_slash, whirlwind | 3780 | 600 | 355 | 200 | 90 | 70 |
| E8 | 1,3 | 堕落骑士 | elite | physical | melee | basic_physical | combo_slash | 910 | 200 | 300 | 55 | 70 | 78 |
| E9 | 1,4 | 恶魔祭司·愈 | elite | heal | cast | basic_magic | group_heal | 660 | 500 | 120 | 255 | 40 | 88 |

### 8.4 AI 规则（`ai.ts`，敌方与自动宝宝共用，阵营相对）
AI 在 `beginExecution()` 时、基于当时的状态，**按本回合出手顺序逐个**为 `autoCommand` 单位决定指令（顺序固定，结果才可复现）；出手时目标若失效，按 §6.5 处理。只考虑当前可用（MP 足够且未被封印）的技能。

**选什么技能**（规则步骤 9 未改；只把治疗阈值 `healHpThreshold` 由 0.6 调到 0.4，§9.4 V5）
- **恢复系**：
  1. 存在存活友军 `hp/maxHp < healHpThreshold (0.4)` 且有群体治疗 → 群体治疗。
  2. 否则存在倒地友军且有复活（敌人没有复活）→ 复活。
  3. 否则普攻。
- **封印系**：存在存活、未被封印、拥有主动技能的对方单位，且有封印 → 封印；否则普攻。
- **其他**（物理系、法术系）：
  1. 存活对方单位数 ≥ `aoeMinTargets (3)` 且有群体技能（目标数 > 1 的伤害技能：`whirlwind` / `arrow_rain` / `group_spell` / `triple_spell`）→ 使用群体技能。
  2. 否则有单体技能（目标数 = 1 的伤害技能：`combo_slash` / `triple_shot` / `single_spell`）→ 使用单体技能。
  3. 否则普攻。
- 物理型宝宝没有主动技能，自动时只会普攻；法术型宝宝按“其他”的规则使用 `triple_spell`。
- AI 不选防御指令。

**选哪个目标**（步骤 9 修改）——由 `AiConfig.targetMode[该单位的阵营]` 决定，默认敌方 `spread`、友方 `focus`：

`spread`（带权重的随机 + 分散，SPEC §8）：
```
n(T)      = 本回合己方 AI 已经把 T 选为同类目标的次数   // aiTargetCounts[side][kind][T]
weight(T) = baseWeight × repeatDecay ^ n(T) × 加权(T)
按 weight 做一次加权随机抽取；选中后 n(T) += 1
```
| 目标种类 `kind` | 候选 | 加权(T) |
|---|---|---|
| `attack`（普攻和所有伤害技能的主目标） | 存活的对方单位 | `1 + lowHpBonus × (1 − hp/maxHp)` |
| `seal` | 存活、未被封印、拥有主动技能的对方单位 | 法术 / 恢复职业 × `sealCasterBonus`，其余 × 1 |
| `heal`（群体治疗的主目标） | 气血比例低于 `healHpThreshold` 的存活友军 | `1 + lowHpBonus × (1 − hp/maxHp)` |
| `heal`（复活） | 倒地的友军 | 1 |

- 默认参数：`baseWeight 1`，`repeatDecay 0.5`，`lowHpBonus 0.3`，`sealCasterBonus 2`。残血加权最多 ×1.3，被选过一次就 ×0.5，所以随机和分散占主导。
- 三种目标分别计数：被攻击过不影响它被封印的权重。
- 只统计**主目标**：群体技能补足进来的其他目标不计数（补足规则 §6.3 不变）。
- 出手时目标失效的重选（§6.5）也走这套权重并计数。
- 计数每回合开始清零。

`focus`（步骤 8 及之前的规则，友方自动出手沿用）：
- 攻击目标 = `hp/maxHp` 最低的对方单位，相同时取 id 字典序更小的。
- 治疗主目标 = 气血比例最低的友军；复活目标 = id 最小的倒地友军。
- 封印目标 = 法术 / 恢复职业里法伤最高者；没有则任意拥有主动技能的单位里法伤最高者。

**随机数**：AI 选目标用一条独立的随机序列（由战斗种子派生），不和伤害 / 命中 / 暴击 / 同速排序共用。这样同一个种子下结果完全可复现，而且 AI 抽多少次随机数都不会改变战斗结算的随机序列。

---

## 9. 设计假设

### 9.1 用户裁定（2026-11-13 确认，其中 ★ 项修改了 SPEC 原文规则）
- **U1 武器与职业分配**：法杖给法术系；封印系持剑、恢复系持枪；自由职业为物理系，持弓。封印/恢复的技能是法术类、原地施放；他们的普攻按“武器决定出手方式”走近战物理。分配写在 `heroes.ts`。
- **U2 ★ 不能重复封印**：已被封印的单位不能再被封印（SPEC §7.1 原文为“刷新持续回合”）。见 §5.8。
- **U3 防御**：从本回合执行阶段一开始就生效，到本回合结束，对物理和法术伤害都生效。
- **U4 暴击**：物理伤害、法术伤害、治疗都会暴击，分别配置。见 §5.6。
- **U5 普攻会未命中**：普攻命中率 0.95。
- **U6 ★ 多目标补足和顺序按速度**：旋风斩、群体法术、群体治疗的目标 = 主目标 + 其余合法单位按速度由快到慢补足；主目标一定被击中且排第一，其余按速度由快到慢；目标重选也按速度（SPEC §7.2 原文为“按阵型邻近顺序”）。见 §6。
- **U7 ★ 敌方被击败即消失**：敌人死亡后消失、不能再被选中；友方倒地不消失，只有复活能选中倒地友方，复活不能选中未倒地的友方（SPEC §5.5 原文为所有单位都“保持倒地姿态”）。见 §5.5。
- **U8 复活当回合出手**（步骤 9 修改）：被复活者本回合一定可以出手——在出手顺序中排在施法者之后，就在自己的位置出手；排在之前（位置已过），排到本回合队尾。轮到它时暂停，让玩家现场下指令（敌方和开启宝宝自动的宝宝由 AI 决定）。见 §5.5、§8.2。
- **U9 不回蓝**：暂时不做回复 MP 的技能，也不自动回复。
- **U10 敌人没有复活技能**。

### 9.2 其他设计假设
- **A1 宝宝**（步骤 9 修改）：形象不变（影狼 ×2、骨龙幼崽、幽灵、魔偶）。宝宝只分物理型和法术型：影狼 ×2、魔偶为物理型（普攻 + 被动“连击”），骨龙幼崽、幽灵为法术型（普攻 + `triple_spell`）。见 §4.6。
- **A2 敌方构成**：骷髅兵 ×4（小怪），堕落骑士 ×2、恶魔祭司 ×2（1 封印、1 恢复）、亡灵法师 ×1（精英），深渊魔将 ×1（Boss）。
- **A3 技能命中率**：伤害类技能默认命中率 1.0，封印 0.75，都可配置；没有单独的闪避属性。
- **A4 封印计时**：施加回合计入递减；立即生效（未出手的技能指令改为普攻）。见 §5.8。
- **A5 速度相同**：同速单位的先后由回合开始时的随机排序决定，出手顺序、目标补足、复活当回合能否出手都用这个结果，保证一致。
- **A6 复活细节**：复活不回复 MP、清空状态；出手时目标已被他人复活则作废、不扣 MP。
- **A7 指令顺序与宝宝自动**：人物、宝宝交替下指令；`petAutoCommand` 默认 false（手动）。
- **A8 随机数**：所有随机通过可注入种子的 RNG，保证测试可复现；正式游戏用时间戳作为种子。
- **A9 无回合上限**：最低伤害为 1 且 MP 有限，战斗一定会结束，不设平局。
- **A10 数值**：§8.3 的数值在步骤 8、步骤 9 调过平衡，只改了配置表里的数，没有改公式。
- **A11 AI 细节**：阈值和选目标的权重见 `aiConfig.ts`；AI 不使用防御。

### 9.3 步骤 8 的调整与偏差
- **S1 阵型与相机**：格子间距 1.9 / 2.0 → 2.2 / 2.3，双方前排中心 ±3.4 → ±2.7（两军拉近，整体占地不变），相机距离 35 → 32.5，`fitAspect` 1.6 → 1.75。见 §7.2。
- **S2 头顶名字**：平时只显示血条；Boss 的名字始终显示，正在出手、被选中 / 会被命中、鼠标指着的单位才显示名字（SPEC §4 原文是“每个单位头顶有血条和名字”）。同时显示的名字如果互相重叠或压到别的血条，自动往上抬（`ui/hud/nameLayout.ts`，参数在 `uiConfig.ts` 的 `headName`）。
- **S3 雾**：指数雾密度 0.012 → 0.019，贴地雾片 26 片 / 不透明度 0.2 → 40 片 / 0.3。
- **S4 冲锋转身**：近战冲锋途中平滑转向跑动方向，到位时正对目标；返回时面朝对手退回原位，途中平滑转回原朝向（不做 180° 急转身）。`StageUnit.moveTo()` 多了一个可选参数 `face`（要正对的位置），由 Choreographer 传入目标的站位。
- **S5 绘制调用**：`assets/optimize.ts` 在模型创建后合并“不会单独运动”的网格（同一关节、同一材质合成一个；场景物件整体合并，实例化碎石烘进同一个网格），并给每个部件建一个只在阴影图层上的“阴影代理”，主光源的阴影相机只画阴影图层。20 个单位的战场每帧绘制调用 2458 → 729。哪些关节会动由 `render/units/animatedJoints.ts` 决定（肩、肘、腰、胸、头）；腿、手、颈目前没有单独的动画，它们下面的网格并进了上一级。
- **S6 低画质**：关闭辉光、阴影贴图 2048 → 1024、技能粒子 ×0.4、贴地雾片减半、渲染分辨率倍率上限 2 → 1。参数在 `renderConfig.ts` 的 `QUALITY_CONFIG`。
- **S7 音效**：`assets/audio/SoundEngine.ts` 用 Web Audio 合成 13 种音效和环境低频嗡鸣。第一次用户操作后才创建 AudioContext；音效由舞台在动作开始时触发（`render/units/soundCues.ts`），长度按战斗倍速缩短，跳过动画时不播放战斗音效；同一种音效 45 毫秒内只响一次，同时最多 14 个；标签页在后台时暂停。
- **S8 调试接口**：`window.__perf()`（性能快照）、`window.__capture(time)`（固定时间点截帧）、地址参数 `merge=0`、`quality=low`。

### 9.4 步骤 9（v0.2）的规则调整与取舍（取舍 a~d 已于 2026-11-15 确认）
- **V1 敌方不集火**：敌方 AI 选目标改为带权重的随机 + 同回合衰减（§8.4），出手时的目标重选也一样（§6.5）。SPEC §8 原来的“优先攻击残血 / 优先封印法术恢复职业 / 优先治疗低血量”改成了小幅加权。
  - 取舍 a：**只有敌方改成 `spread`，友方的自动出手（自动宝宝、自动战斗里的人物）仍然是 `focus`**。理由：需求针对的是敌方；友方自动出手是代替玩家操作，集火残血是合理打法；也符合“优先调敌方”。两边都是配置项（`targetMode`），可以改。
  - 取舍 b：只统计主目标，攻击 / 封印 / 治疗分别计数。
  - 取舍 c：AI 用独立的随机序列。
  - 统计口径（`npm run balance`）：**被集火率** = 所有“敌方至少有一次单体出手的回合”里，存在某个友方单位在该回合被敌方单体出手（普攻、连斩、单体法术，一次出手算一次，不按段数）选中 ≥ 3 次的回合占比；同时给出“每回合单个友方被单体出手的最大次数”的平均值和分布。
  - 结果（1000 个种子，同一口径）：被集火率 12.8% → 0.6%；只看敌方单体出手 ≥ 3 次的回合，68.7% → 3.6%；每回合最大次数平均 1.58 → 1.12。敌方封印目标由“A2 79.5% / A4 20.5%”变为 7 个单位各 8%~20%。
- **V2 复活当回合可行动**：原规则（U8）是有意设计成“位置已过就不出手”，不是代码缺陷；默认阵容里治疗师速度 85，比她快的单位有 8 个，所以绝大多数被复活的单位当回合都被跳过。现在改为排到队尾。
  - 取舍 d：**每个单位每回合最多出手一次**。已经出过手、被击倒后又被复活的单位不排到队尾，否则它一回合能出手两次。
  - 敌方复活：敌人被击败即消失、没有复活技能（U7、U10 不变），所以默认规则下不存在敌方复活。引擎的分支是通用的（`autoCommand` 单位由 AI 决定），测试用自动宝宝被复活的情况覆盖“AI 现场决定指令”。
- **V3 宝宝改型**：见 §4.5、§4.6。删除 `group_spell_fire` 的技能条目（火柱特效代码保留，`triple_spell` 正在复用），新增 `triple_spell`、被动技能表、`PassiveTriggered` 事件、`groupSpellSmall` 动画类型。连击的判定时机、第一击打死目标时取消第二击，见 §4.5。
- **V4 友方魔法量**：提高友方人物和法术型宝宝的 `maxMp`，并下调技能消耗（数值见 §4.2、§8.3）。物理型宝宝没有主动技能，魔法值保留原值、没有用处。敌方魔法值没有改（消耗下调后敌方的魔法不足占比 6.8% → 1.0%）。
  - 统计口径：**魔法不足占比** = 友方“拥有主动技能、未被封印、但 MP 不够用任何一个主动技能，因而只能普攻”的出手次数 ÷ 友方拥有主动技能的单位的全部出手次数。物理型宝宝没有主动技能，不计入分子和分母（计入会把比例冲淡）；汇报时同时给出按“友方全部出手”做分母的数字。目标是前一个口径 < 10%。
  - 结果（1000 个种子）：39.6% → 0.9%（有主动技能的单位的出手）；39.6% → 0.6%（友方全部出手）。
- **V5 再平衡**：敌方不集火、友方魔法够用之后，不调数值时友方胜率到了 93%。调整只动敌方数值和一个 AI 阈值：
  - 敌方气血约 ×1.18、物伤 / 法伤约 ×1.05（§8.3）。
  - `healHpThreshold` 0.6 → 0.4：敌方火力分散后，友方总有人气血低于 60%，治疗师每回合都在治疗、几乎从不复活（复活 0.05 次 / 场）。阈值下调后复活回到 0.47 次 / 场。这个阈值敌我共用。
  - 结果（1000 个种子）：友方胜率 60.3%，回合数中位 10、平均 11.1，8~14 回合占 72.7%（步骤 8 是 83.7%，分布变宽了）；每场封印命中 5.1 次、治疗 6.4 次、复活 0.47 次。
  - 不改伤害公式、出手排序、胜负判定。

---

### 9.5 步骤 10（v0.3）：建模细化、武器边缘发光、待机动画
只改画面，不改任何规则、数值、技能和 AI。

- **A1 配色可读性**：轮边光收窄减弱，并加“底色提亮”（`RimOptions.lift`：把表面自身的颜色按比例加进自发光），各部件的配色在暗场里分得开。友方人物、友方宝宝、武器、敌方五个兵种各有一套轮边光（`RIM_CONFIG`、`ENEMY_RIM_CONFIG`）；敌方不再统一用暗红，红色只留给 Boss。
- **A2 建模细化**：每个单位至少三种质感。新增贴图：锁子甲、毛皮、纹饰带、符文光点、裂纹光；布料贴图的纱线密度 96 → 40、各向异性过滤 16（原来的细密织纹远看有摩尔纹）。新增部件（`characters/parts.ts`）：叠层甲片、铆钉、手甲、靴子、毛领、成组圆锥、宝石、腰包、药瓶、纹饰带、披风镶边。
- **A3 宝宝按战场距离设计**：狼、骨龙、魔偶按“战场相机的实际距离”返工——体块优先、少而大的细节、用明度而不是杂色分块。狼保留两套体型参数（`BUILDS.burly` 默认、`BUILDS.lean` 备选）。骨龙整体放大到 1.12 倍（SPEC §3.1 是“约 0.6 倍”，按验收意见略增大）。验收手段：战场截图放大 4 倍 + 剪影测试（`?silhouette=1`，`render/debug/silhouette.ts`）。
- **A4 武器边缘发光**：`WeaponGlowDef` 新增 `edgeIntensity`；`WeaponGlow.edge()` 让刃、杆、金属件的轮廓带发光色亮边。发光以轮廓光 + 细发光线 + 流动光纹为主，光晕精灵缩小减弱；出手闪光时细光线吃满 `flareBoost`，光晕和轮廓光只吃 30%。法杖重做（杖身符文光纹、箍边细光、带切面的小水晶）。SPEC §3.2 的“杖顶悬浮发光宝珠”改成了小水晶核心，其余五种武器的发光要素不变。
- **A5 待机动画**：
  - 计算（`render/units/idleMotion.ts`，纯函数）：周期性动作是几个不成整数比的正弦叠加；偶发动作（张望、整理武器、张嘴）把时间切段，每段按种子决定做不做、朝哪边，段内是两端为 0 的平滑起落。全部是时间的连续函数，不保存状态。
  - 不同步：每个单位按 id 取种子，得到 8 个初相位和一个周期倍率（1 ± 18%）。
  - 风格：`data/idleConfig.ts` 的 9 种 `IDLE_STYLES`，单位用哪种在 `unitModels.ts` 的 `idle` 字段。
  - 驱动（`render/units/IdleAnimator.ts`）：UnitView 先摆出手 / 受击姿态，再把待机偏移“加”到人形关节上；宝宝的头、颈、尾、翅、臂和 Boss 的双翼只由待机驱动。整体的起伏、侧倾、漂浮加在模型根节点上（左右位移不超过 2 厘米，不算离开站位）。
  - 过渡：待机权重 = 平滑后的“空闲程度”× 倒地衰减。有蓄力、出手、受击、闪避、冲锋时目标为 0，否则为 1，每帧按 `1 − e^(−blendRate·dt)` 靠近目标；倒地后乘 `fallenScale`（0.07）。待机用场景的连续时间，不用演出时间，所以“跳过动画”不会让待机动作跳变。
  - 布料：顶点着色器按几何体上的 `aSway` 权重沿法线摆动（锁链用 `aSwayDir` 指定侧向）；全局时间和画质开关是共用的 uniform，相位、幅度、频率每个材质一份，由 IdleAnimator 按单位写入。不增加关节和绘制调用；阴影代理不跟着飘。
  - 发光：身上带 `GLOW_BASE_KEY` 的材质（眼睛、符文、核心、裂纹）按待机的发光倍率呼吸 / 闪烁；武器的发光仍由 `WeaponGlow` 自己管，出手增强不受影响。
  - 低画质：关闭布料飘动、偶发动作、颤动（`IDLE_CONFIG.lowQuality`）。
- **A6 关节登记**：`animatedJoints.ts` 除人形的肩、肘、腰、胸、头外，新增按名字登记的额外关节 `EXTRA_JOINT_NAMES`（neck、head、jaw、tail、torso、wingL/R、shoulderL/R、foreL/R）。
- **A7 性能**：20 个单位的战场每帧绘制调用 728 → 1167（低画质 698 → 1136），三角形约 37.6 万 → 58.1 万，每帧逻辑耗时约 1.0 → 1.0~1.6 毫秒（软件渲染下的单帧采样，波动大）。
- **A8 调试接口**：`window.__idle()`（每个单位的待机权重、呼吸相位、周期倍率）、地址参数 `silhouette=1`、预览页 `idle=0`。

### 9.6 步骤 11（v0.4）：进攻动画丰富化
只改画面，不改任何规则、数值、技能、AI 和事件格式（`src/core` 没有改动）。

- **B1 节奏**：每次进攻都是 预备（蓄力）→ 发力 → 命中顿住 → 余势（过冲、回弹）→ 停一拍 → 收招 → 回位。每个动作各阶段的时长（`MoveTiming`）、关键姿态、缓动曲线都在 `data/attackAnimConfig.ts`；`Choreographer` 只按顺序调用 `StageUnit` 的 `brace / moveTo / windup / release / hold / follow / recover / returnHome`。命中顿住是出手者自己的姿态停 2~4 帧（0.04~0.07 秒，带一点震颤），和原有的全局顿帧（暴击、击杀、重击的 hit stop）相互独立、可以叠加。
- **B2 姿态系统**（`render/units/UnitMotion.ts`，纯计算、不依赖 three）：动作姿态是“相对站姿的偏移量”，按通道名存放（`root.forward / lift / pitch / roll / turn / stretch / squash`、`<关节>.x/y/z`、`weapon.x/y/z/aim`）。每个阶段是一串关键姿态（`PoseKey`，带时长比例和缓动），从当前姿态出发依次补间，所以前一击的余势可以直接接下一击的预备，不必先回站姿。`root.turn` 在每个阶段开始时折回 (−π, π]，转过的整圈不会倒转回来。模型上没有的关节通道被忽略。`weapon.aim` 把武器尖端拧向正前方（枪、剑的突刺不管手臂怎么摆都指向目标）。
- **B3 步态**（`GAITS`）：位移是“匀加速 → 匀速 → 匀减速到 0”的梯形速度曲线（`dashProgress`）；前倾角随速度变化，刹车段有一下后仰；每一步有起伏和左右重心摆动；起步、每一步、到位各触发一次落脚事件，`UnitView` 把它接成尘土（`burst('dust')`）、火星和镜头轻震。步态还可以带腾空高度（扑跃、跃击）、弧线偏移和途中旋身圈数（旋风斩）、随步伐摆动的腿（魔偶）、途中的姿态关键帧（狼的蹬地 / 腾空 / 落地）。面朝对手后撤时，前倾自动变成后仰。
- **B4 各武器的招式**：刀 = 右上到左下斜劈 + 收刀到左腰；剑 = 右到左横斩（第二式是直刺）；枪 = 侧身沉腰蓄力突刺 + 回撤。连斩 3 击 = 各武器的普攻招式 → 反手横斩 → 跃起重劈。全部近战发力时都拖武器光轨；光轨只取武器靠尖端的一段（`FX_CONFIG.trailWidth`），大幅度挥击时是一道弧形光带。
- **B5 旋风斩**：第一个目标正常冲刺切入；之后每个目标都是“蹬地（尘土）→ 沿弧线跃进（左右交替）、途中旋身一圈、空中摆好预备姿态 → 落地（尘土）→ 旋身横扫 → 顿住 → 余势”。节奏表 `ATTACK_ANIM.whirlwind.tempo`（0.9 → 0.8 → … → 1.25）乘在跃进和出手时长上，前快后慢；最后一击用 `MELEE.spinFinish`：沉身蓄势、平伸武器连转两圈并腾起、砸地，配冲击波环（`burst('shockwave')`）、慢镜头、重击反馈，然后停一拍、收招、跑回。旋风斩途中不再停下来等每个目标的受击动作播完（受击表现在后台播，出手结束前统一等）。逻辑层没有结算事件的目标不演，所以目标死亡或不足时没有空挥。
- **B6 宝宝**：狼 = 原地下伏蓄势 → 扑跃（腾空、身体拉长）→ 张嘴撕咬并甩头 → 松口后撤 → 跳回；连击的第二击是人立爪击。魔偶 = 原地双臂举过头顶 → 沉重踏步（每步尘土 + 镜头轻震）→ 砸拳（冲击波、重击反馈）→ 缓慢退回；连击的第二击是拧身横扫。骨龙 / 幽灵施法 = 后仰张翼张口蓄火 / 上浮展臂，光点向“施法点”（`MotionProfile.muzzle`）汇聚成光团（`aura('gather')`），再探头喷吐 / 双手前推；光弹从施法点飞出。
- **B7 弓与施法**：弓 = 站姿调整 → 拉满、上身后仰 → 停一下 → 松弦 → 弓身回弹（弹性曲线）、身体后坐 → 收弓；箭雨的仰射蓄满时后仰更深。施法分三种：指向（法术普攻、单体、封印）、召唤（群体法术：高举后向下一顿）、祝祷（治疗、复活：双臂展开上举）。
- **B8 次级运动**：每个单位一个“拖在身后的弹簧质点”（`SECONDARY_MOTION`），质点相对身体的偏移量写进布料着色器的 `uSwayPush`，带飘动权重的顶点（披风、袍摆、链条、挂饰）按 权重 × 偏移量 位移——冲刺时被甩在身后，急停时向前甩出再回落；同时按速度加大飘动幅度。狼的尾巴用同一个偏移量甩动。用演出时间推进（倍速更快、顿帧时一起停）；跳过动画时直接归零。不增加关节和绘制调用。
- **B9 关节**：新增登记 `foreLegL/R`、`hindLegL/R`（狼的四条腿，整条腿绕肩 / 髋摆动）、`legL/R`（魔偶的双腿；骨龙的后腿同名，一并成为边界）。人形的腿和手指仍然没有关节，下蹲用整体下沉表现。
- **B10 过渡与跳过**：出手期间待机权重的目标为 0（`UnitMotion.busy`），沿用步骤 10 的平滑过渡。所有补间走 `Scheduler`，倍速、顿帧、跳过自动生效；跳过动画时每个补间直接落到终点、不触发落脚事件，一次出手结束后必然回到原位、原朝向、站姿（`UnitMotion` 的单元测试逐个动作档案核对）。
- **B11 低画质**：关闭次级运动（`ATTACK_ANIM.lowQuality`），尘土、冲击波的粒子按 `particleScale` 减少；主要动作不变。
- **B12 调试**：`window.__motion()`（每个单位的阶段、动作名、是否回到站姿、相对原位和原朝向的偏差）；`scripts/contactSheets.cjs` 生成关键帧联系表（见 README）。
- **B13 性能**：同一测量脚本（自动战斗页 `?auto=1`，1280×720，软件渲染）对比 v0.3 与 v0.4：开场静止帧绘制调用 1169 → 1207（低画质 1137 → 1176），战斗中峰值 1194 → 1234（低画质 1166 → 1206），三角形约 58.1 万不变。增加的约 38 次来自狼的四条腿、魔偶的双腿成为独立关节后不能再和身体合并；尘土、冲击波、汇聚光团都走已有的粒子池和特效对象池，技能演示页 29 个演示的峰值不超过 1228。均低于上限 1500。

### 9.7 步骤 11b（v0.4.1）：进攻动画修正
只改画面，不改任何规则、数值、技能、AI 和事件格式（`src/core` 没有改动）。

- **C1 Bug：狼攻击返回后四脚朝天**。原因：步骤 11 为狼新增了四条腿的关节（`foreLegL/R`、`hindLegL/R`），魔偶、骨龙新增了 `legL/R`。`UnitView` 对宝宝的这些“额外关节”是在待机动画摆好之后用 `rotation.x += 动作偏移` 叠加的，前提是待机动画每帧先把关节写回“站姿 + 待机偏移”；但 `IdleAnimator` 只重置它自己驱动的颈、头、下颌、尾、翅、肩、前肢，新加的腿不在其中。于是出手期间腿的转角每帧在上一帧的结果上继续累加（一次扑击就累加到 −11 弧度），动作偏移回到 0 之后累加出来的转角也不会退回去，腿翻到背上，看起来就是四脚朝天；魔偶每走一趟腿也多转一截。修复：`UnitView` 在建模时记下所有会动的关节的基准转角（`basePose`），每帧开头先把它们全部写回基准，再叠加待机、出手、受击——以基准为准重置，不靠反向抵消，也不依赖待机动画有没有覆盖到某个关节。另外，次级运动（披风、尾巴的弹簧质点）在身体停下后 `SECONDARY_MOTION.settle` 秒内平滑归零并清空弹簧，保证一次出手演完时尾巴也精确回到基准（受击后仰用正弦曲线，结束时是 1e-17 而不是精确的 0，“身体还在动”的判断改为阈值）。
- **C2 姿态复位的测试**：`tests/render/realStage.ts` 在 Node 里用真实模型（假 canvas 生成贴图）和真实 `UnitView` 跑演出，比较根节点的位置 / 转角 / 缩放、全部关节的转角、武器的四元数。`tests/regression/poseReset.regression.test.ts`：整场战斗（1 倍速两个种子、2 倍速、跳过动画、中途乱切跳过和倍速），每次出手后每个站着的单位都必须回到开战前的姿态、没有阵亡的单位不得倒地、不得离位。`tests/render/realMotion.test.ts`：20 个技能演示各在 1 倍速、2 倍速、跳过动画下演完后比对。修复前的代码在整场回归里会失败（狼、魔偶的腿）。
- **C3 大跳跃**：近战物理攻击（刀、剑、枪的普攻和连斩，狼和魔偶）的来回都是“原地下蹲蓄力 → 高抛物线腾空 → 落地（尘土 + 轻微震屏）→ 落地缓冲”，取消跑步的小碎步。步态新增 `crouch`（下蹲的时长、姿态）和 `land`（落地缓冲的时长、姿态）；`UnitMotion.moveTo / returnHome` 的总时长不变（= 编排给的时长），内部拆成下蹲、腾空、落地三段，新增阶段 `crouch`、`land`。水平方向近似匀速、竖直方向抛物线；腾空时整体前倾（跳回时面朝对手，前倾变成轻微后仰），腾空途中的姿态由 `poses` 给出（人形：蹬地伸展 → 最高点举起武器 → 落地前前送）。落回原位后按基准写回原位、原朝向（面对敌方）、站姿。魔偶：跳得最低（0.6 米）、下蹲最久、落地震屏最大；狼：腾空时间最短、身体拉长。
- **C4 旋风斩减速**：`ATTACK_ANIM.whirlwind.pace = 1.2` 乘在途中所有时长上，另加每一击之后的停顿 `hitPause`、落地停顿 `landPause`；目标之间改为连续的短跳跃（步态 `whirlHop`：0.1 秒短促下蹲、0.7 米高、沿弧线、途中旋身一圈，离地的一瞬间就开始摆横扫的预备姿态，`MoveOptions.onAirborne`），打完一个大跳跃回原位。实测（同一段事件脚本）：从第一次出手到开始跳回 5.23 → 7.43 秒（+42%），连同首尾两次大跳跃的总时长 6.78 → 10.23 秒（+51%）；最后一击仍然最重、最慢。
- **C5 拉弓**：弓弦改为上下两段，中点跟着拉弦手（右手）移动、两段连到两个弓梢（V 形）；弓臂按拉开的距离整体向后弯；箭随弦的中点后移（`setBowDraw`）。动作通道 `bow.aim`（把弓摆正：竖直、弓背朝瞄准方向、`weapon.aimPitch` 上扬）、`bow.draw`（1 = 搭在手上；负值 = 松弦后向前弹出，配合 `outElastic` 来回振一下）。节奏：侧身站定 → 举弓、右手搭弦 → 拉到脸侧 → 瞄准停顿一拍（0.22 秒）→ 放箭、弓弦回弹、弓身后坐上扬 → 收弓；三连射每一箭都重新搭弦、拉满、放箭；箭雨举弓朝天（上扬约 57°）、拉满时身体后仰。拉满时双臂的角度由 `scripts/solveBowPose.ts` 在真实骨架上求出（右手离箭的延长线 2 厘米以内）。
- **C6 法杖施法**：法杖施法者（法术系、封印系、法术普攻，以及敌方的恶魔祭司、亡灵法师）蓄力时双手握杖挥舞：普攻 = 短促一挑再前指，封印 = 身前画圈后前指，单体火 = 挥弧举过头顶后劈下，单体雷 = 画圈后高举，群体火 = 抡一整圈后全力劈下，群体雷 = 头顶画两圈后高举（群体法术幅度最大、蓄力最久，脚下符文阵照旧）。画圈的关键姿态由 `staffOrbit()` 按圈心、大小、圈数生成，写在配置里。双手握杖：动作通道 `grip.left`，左手按两段骨骼 IK（`render/units/armIK.ts`）握到杖身上，默认握点够不着时沿杖身滑动（`gripSlide`）。蓄力时杖顶拖出发光轨迹（敌方的杖长在模型上，沿右手武器挂点取样），释放时杖顶炸一团光；收招时杖回落到身侧。治疗、复活仍是祝祷动作。封印系的缚魂手持长剑，用同一套“画圈前指”的动作，剑尖拖光轨。
- **C7 联系表**：`docs/screenshots/step11b-sheet-*.png` 共 15 张（要求的 13 张 + 骨龙、幽灵）。截图时锁定机位（`__skillDemo.lockCamera`），取景中心停在站立时的身体中部，腾空时人物明显高出画面中心。
- **C8 性能**：同一测量脚本对比 v0.4 与 v0.4.1：开场静止帧 1207 → 1210（低画质 1176 → 1179），战斗中峰值 1234 → 1241（低画质 1206 → 1208）；增加的几次来自弓弦拆成两段。技能演示页 29 个演示的峰值不超过 1229，全部低于上限 1500。

### 9.8 步骤 11c（v0.4.2）：近战攻击衔接流畅化
只改近战的画面编排，不改任何规则、数值、技能、AI 和事件格式（`src/core` 没有改动）；弓箭手、法师的动作和待机动画不变。

- **D1 问题**：v0.4.1 的近战是“下蹲 → 腾空 → 落地 → 落地缓冲 → 预备 → 发力 → 命中”首尾相接，落地之后要过 0.6~0.7 秒才命中，中间有一段站定的空档。
- **D2 跳劈**（`Choreographer.jumpStrike`）：起跳和攻击并行编排。腾空进行到 `ATTACK_ANIM.jumpStrike.windupAt`（30%）时开始预备（举刀、扭身、蓄力，狼张嘴伸爪，魔偶举拳），预备一直持续到发力开始；发力（动作自己的发力时长）在下落段完成，落地的一瞬间正好命中。去程不再有单独的落地缓冲：`MoveOptions.land = false` 时腾空占满下蹲之后的全部时间，落地时身体被压下去再弹回（步态层 `gait.squash`，和挥击的姿态叠加——落地下蹲就是发力）。腾空时间放不下“预备 + 发力”时自动加长腾空（`jumpStrikeDuration`）。每段补间都要对齐到帧，首尾相接时误差会累积，所以预备和发力的时长都按预定的落地时刻倒推，命中和落地的误差不超过一帧。命中时的顿帧和受击反馈是唯一的停顿。
- **D3 衔接**：余势进行到一定比例就接下一个动作，被接上的余势补间直接让位（姿态层的令牌机制），没有站定——同一目标的下一击（连斩第 2、3 击、连击）的预备（`chainOverlap`），旋风斩下一次短跳的下蹲（`hopOverlap`），最后一击之后回程的下蹲（`returnOverlap`：收招和下蹲合成一个动作，不再单独收招、停一拍）。同一目标的下一击也不再等上一击的受击动作播完（受击在后台播，出手结束前统一等）。回程落地后的缓冲保留，然后平滑回到待机。
- **D4 旋风斩**：每一跳都是跳劈（空中蓄力、落地即斩、斩完直接跳向下一个目标），`pace` 仍是 1.2；去掉了 v0.4.1 的落地停顿、击后停顿、最后一击前的蓄势停顿。最后一击改为一次大跳跃（步态 `jump`），空中旋转劈下，落地砸出冲击波，慢镜头在发力开始时触发。
- **D5 测量**（`tests/render/meleeFlow.ts`、`scripts/measureMeleeFlow.ts`，真实模型逐帧，1/60 秒一帧）：起跳到命中 刀 / 剑 1.20 → 0.60 秒，枪 1.27 → 0.60，狼 0.77 → 0.43，魔偶 1.35 → 0.68；落地到命中 0.60~0.72 → 0.00 秒（旋风斩每个目标 0.13~0.17、最后一击 1.52 → 0.00）；命中前的站定时间（身体各取样点都慢于 0.3 米/秒的累计时长）0.07~0.38 → 不超过 0.05 秒。整段时长：刀普攻 3.67 → 2.53 秒，连斩 5.25 → 3.77，旋风斩 10.28 → 7.42，狼连击 3.70 → 2.72，魔偶 4.85 → 3.27。`realMotion.test.ts` 在 1 倍速和 2 倍速下断言“落地到命中不超过一帧、命中前站定不超过 0.05 秒（真实时间）”。
- **D6 联系表**：`docs/screenshots/step11c-sheet-{blade,sword,spear,combo,whirlwind,wolf,golem}.png`。

### 9.9 步骤 12（v0.5）：设置菜单与固定 16:10 画面比例
不改任何规则、数值、技能、AI 和事件格式（`src/core` 没有改动），不改已验收的动画、模型和特效；图标（齿轮）用 SVG 代码画。

- **E1 固定 16:10**（`ui/layout/Viewport.ts`、`viewportMath.ts`）：`#app` 里放一块“舞台”，排版尺寸固定为 `VIEWPORT_CONFIG.design`（1440 × 900）。画布和所有界面（头顶条、飘字、顺序条、指令面板、日志、结算、设置、标题界面）都在舞台里，用 CSS `transform: translate() scale()` 整体等比缩放、居中，窗口多出来的部分露出黑色背景。界面因此按同一套排版坐标摆放，不会跑到黑边上。`BattleScene.worldToScreen` 返回排版坐标；画布 CSS 铺满舞台，实际渲染像素由 `setViewport` 指定（像素比固定为 1，直接按目标像素设置缓冲，避免“宽 × 小数像素比”取整差一个像素）。
- **E2 分辨率**：适应窗口 = 窗口内最大的 16:10 区域，渲染像素 = 显示大小 × min(设备像素比, 画质上限)；固定分辨率 = 渲染像素就是该值，按 1:1 物理像素显示（显示大小 = 分辨率 ÷ 设备像素比），窗口放不下时等比缩小。切换立即生效（只改渲染尺寸和舞台缩放，不重开战斗）。
- **E3 鼠标坐标**：舞台被缩放后，事件的窗口坐标要换算回排版坐标：`clientToLocal(clientX, clientY, 元素屏幕矩形, 元素排版宽高)`，即 (client − rect.左上) × 排版宽 ÷ 屏幕宽。选目标（`TargetingInput.locate`）和头顶名字的悬停（`BattleHud.onPointerMove`）都用它；不缩放时结果与原来相同。
- **E4 暂停**：`Scheduler.setPaused` —— 暂停期间 `update()` 不推进时间（`delta = 0`），进行中的补间、等待、顿帧 / 慢镜头的剩余时长都不变，`nextFrame()` 也不完成，所以战斗流程整体停住。`BattleScene.setPaused` 同时停住场景时间（待机、火光、布料）、特效、镜头和头顶条，画面照常绘制；`SoundEngine.setPaused` 关上战斗音效的“暂停闸门”（正在响的淡出，新的不排），界面音和环境音不受影响。只在战斗中暂停，标题界面上打开设置不暂停背景。
- **E5 音量分路**：主音量（master）下挂两条总线——音效（战斗音效 + 界面音，战斗音效先过暂停闸门）和环境音。设置里拖动滑块时 `SoundEngine.preview(通道)` 放一声提示音（走被调的那条总线，限频 `AUDIO_CONFIG.previewInterval`）。
- **E6 设置持久化**（`ui/settings/settingsStore.ts`）：分辨率、画质、主音量、音效、环境音、静音存成一个 JSON（`SETTINGS_CONFIG.storageKey`），读写都在 try/catch 里，读不到 / 损坏 / 逐项非法时用默认值。地址参数 `quality=`、`res=`、`mute=` 优先，但只在本次生效：`SettingsStore` 分开保存“存储里的设置”和“本次生效的设置”，玩家改某一项时只把这一项写回。新键不存在时从步骤 8 的旧键（画质、音量各一个）迁移一次。演示页也读同一份设置。
- **E7 键盘总闸**（`PlayerBattleApp.onKeyCapture`，窗口捕获阶段）：`Esc` 在菜单打开时关闭菜单（有确认框时先取消确认框）；技能列表 / 选目标里交给指令面板当“返回”；其余情况打开菜单。菜单打开时其他按键一律不往下传（`A/W/D`、`1/2`、`S`、`M` 都不触发），滑块和下拉框的方向键是浏览器默认行为，照常可用。菜单层拦下点击、移动、右键事件，不穿透到战场。**偏差**：指令菜单里原来 `Esc` = 退回上一个单位，现在改成 `退格`（按钮上的提示同步改了）。
- **E8 重新开始 / 退出**（`ui/matchLifecycle.ts` 的 `drainMatch`）：中途放弃时导演可能正演到一半，直接复位舞台的话，那段演出剩下的步骤会在复位之后继续执行（倒地、飘字带进新的一场）。所以先停控制器、丢弃导演队列、解除暂停，再临时打开“跳过动画”让正在播的那一段立即走完，恢复玩家原来的跳过设置，最后复位舞台、特效、镜头、头顶条、日志、结算。“重新开始”与“再战一次”走同一条路径（换种子重开）；“退出游戏”复位后显示标题界面，场上单位回到原位待机作为背景。
- **E9 标题界面**（`ui/title/TitleScreen.ts`）：游戏名（暂定“深渊之战”，`TITLE_CONFIG`）、“开始游戏”“设置”。背景是战场本身加暗角压暗。点“开始游戏”时调用 `sound.unlock()` 解锁音频。标题界面上的设置没有“重新开始”“退出游戏”；右上角的倍速、跳过、设置按钮和顶部顺序条隐藏。
- **E10 右上角布局**：`1× 2× 跳过动画 ⚙`（齿轮在最右），下面是宝宝指令，再下面是战斗日志（整体上移 24 像素）。演示页不变。
- **E11 验收**（无头 Edge + 本机显卡）：五种窗口（16:10、2200×760、820×1180、1000×1000、1920×1080）画面宽高比都是 1.6000，界面元素和头顶条无一出界，鼠标移到 10 个敌人身上全部悬停正确；五档分辨率渲染像素正确，绘制调用都约 1212，帧耗时 14~21 毫秒；暂停期间演出时间和全部单位姿态不变、快捷键无效、点击不穿透，关闭后继续；“打几步 → 重新开始 → 打几步 → 退出 → 开始”循环 10 次无报错、无残留（离位单位 0、进行中动画 0、飘字 0、特效 0），几何体和贴图数量不变，JS 堆在 71~72 MB 波动（另跑 40 次在 74~75 MB 之间波动、没有持续增长）；刷新后设置保留，`?quality=high` 覆盖但不写回。截图 `docs/screenshots/step12-*.png`。

---

## 10. 里程碑（步骤 1~12）

每步结束：跑通该步测试 → 汇报（已完成 / 未完成 / 与 SPEC 偏差）→ 等确认 → git commit。

| 步骤 | 名称 | 交付内容 | 测试 / 验收 |
|---|---|---|---|
| 1 | 逻辑内核（无画面） | 初始化 Vite+TS+Vitest 工程；`core/types, rng, events, damage, turnOrder, commands, status(数据结构), battle` 的状态机；普攻、防御、死亡、胜负判定、目标死亡重选、MP 校验；`data/battleConfig, formation(slot 部分)` | 出手排序（含同速随机可复现）、物理/法术伤害公式、暴击、防御减伤、魔法不足（置灰与拒绝）、目标死亡重选、胜负判定、事件顺序 |
| 2 | 技能与 AI（无画面） | `targeting`（补足/顺序）、`skillExecutor` 全部 pattern、封印/治疗/复活、CommandFallback、`ai.ts`；完整 `data/skills, classes, weapons(逻辑字段), heroes, enemies, aiConfig`；无头模拟脚本能打完一整场 | 连斩中途目标死亡、旋风斩目标不足 7、群体法术不足 6、群体治疗少于 3 时缩减、封印命中/拒绝已封印目标/递减/到期/限制技能、复活及拒绝未倒地目标、复活当回合按速度决定能否出手及现场下指令暂停、敌方击败后不可选中、多目标（含群体治疗）主目标优先、其余按速度补足与排序、法术与治疗暴击、普攻未命中、多目标 MP 一次性扣除、技能表合法性、AI 选择、整场模拟必定结束 |
| 3 | 场景与相机 | Vite 页面、渲染器、2.5D 相机配置、暗色地面与氛围物件、冷色环境光 + 闪烁暖光、雾、后处理（Bloom/暗角/颗粒/色调映射）、AssetRegistry 骨架、20 个格子占位标记 | 画面检查；逻辑层无 three 依赖（加一个检查 import 的测试） |
| 4 | 角色、宝宝、敌人与发光武器 + 预览页 | 程序化贴图、人形骨架 builder、4 职业剪影、4 宝宝、5 种敌人（Boss 约 2 倍）、5 把发光武器（`weapons.ts` 发光参数）、描边/轮边光、`?preview=1` 预览页 | 预览页逐个查看；发光参数修改后生效 |
| 5 | 战斗表现层 | BattleDirector 事件时间线；待机/冲锋/攻击/返回/施法/受击/倒地/复活基础动画；头顶血条/魔法条/名字/封印图标；基础飘字；速度 1x/2x 与跳过动画的机制；自动对战跑通 | 整场自动战斗可视化；同一时刻只有一人行动；只有近战冲锋会离开站位 |
| 6 | 交互界面 | 指令面板（攻击/技能/防御、消耗与说明、置灰）、悬停高亮与地面光圈、多目标预览、复活只能选倒地队友、出手顺序条、战斗日志、结算与“再战一次”、设置（宝宝自动、速度、跳过动画） | 手动打完一整场 |
| 7 | 技能动画与特效 | 连斩、旋风斩、箭雨、三连射、群体法术、单体法术、封印锁链、群体治疗、复活的专属动画；粒子与发光精灵；武器出手时光芒增强；镜头推近/跟随/震动、顿帧、慢镜头 | 对照 SPEC §10 逐条检查；动画可被速度缩放和跳过 |
| 8 | 打磨收尾 | Web Audio 音效、性能优化（20 单位 + 特效接近 60fps）、数值平衡、README（运行、架构、扩展、外观调整、替换资源、设计假设） | 对照 SPEC §13 总验收逐条检查；全部测试通过 |
| 9 | 规则调整与再平衡（v0.2） | 敌方 AI 带权重随机 + 分散；复活单位当回合出手（位置已过排队尾）；宝宝改为物理型（被动“连击”）/ 法术型（`triple_spell`）；被动技能表；友方魔法量；再平衡；`npm run balance` 增加集火率、魔法不足占比 | 复活后更快 / 更慢 / 同速三种情况、自动单位被复活由 AI 决定；连击触发率约 50%、两击独立、第一击致死取消第二击；三目标法术补足与缩减；AI 选目标同种子可复现、同回合分散；宝宝无封印 / 治疗；整场回归（无同时行动、无离位、数值一致）；胜率 50%~70% |
| 10 | 建模细化与待机动画（v0.3） | 友方、宝宝、敌方建模细化与独立配色；武器边缘发光；宝宝按战场距离返工；全部单位的待机动画（按类型分风格、不同步、布料飘动、发光呼吸）；剪影测试 | 预览页与战场截图（含 4 倍放大和剪影）；待机的不同步、幅度上限、连续性单元测试；自动战斗中逐帧采样待机权重；绘制调用 ≤ 1500 |
| 11 | 进攻动画丰富化（v0.4） | 进攻节奏（预备 / 发力 / 命中顿住 / 余势 / 收招）与动作配置表；刀、剑、枪各自的招式和拖尾；连斩 3 击不同姿态；旋风斩弧线跃进 + 旋身 + 收尾冲击波；狼、魔偶、骨龙、幽灵的专属动作；弓与施法的预备和收招；冲刺步态与尘土；披风等次级运动 | 技能演示页逐个触发；12 张关键帧联系表；`attackAnim.test.ts`（阶段时序、跳过后的最终状态、倍速缩放、位移曲线、次级运动）；整场回归；绘制调用 ≤ 1500 |
| 11b | 进攻动画修正（v0.4.1） | 修复狼返回后四脚朝天（关节按基准每帧重置）；近战改为下蹲 → 大跳跃 → 落地缓冲；旋风斩放慢、目标之间连续短跳跃；弓弦 V 形拉弓；法杖双手握杖挥舞轨迹 | 真实模型的姿态复位测试（整场战斗 + 每个演示 × 1 倍速 / 2 倍速 / 跳过动画）；15 张关键帧联系表；绘制调用 ≤ 1500 |
| 11c | 近战衔接流畅化（v0.4.2） | 跳劈：空中预备、下落发力、落地即命中；余势接下一击 / 下一跳 / 回程下蹲；旋风斩每跳落地即斩；狼空中张嘴伸爪、魔偶空中举拳 | 落地到命中 ≤ 1 帧、命中前站定 ≤ 0.05 秒（真实模型，1 / 2 倍速）；7 张关键帧联系表；整场回归与姿态复位 |
| 12 | 设置菜单与固定 16:10（v0.5） | 16:10 舞台（黑边、界面等比缩放、鼠标坐标换算）；标题界面；设置菜单（分辨率、画质、三路音量、静音、重新开始、退出游戏）与暂停；设置持久化（地址参数优先） | 比例换算与坐标映射、设置读写、暂停与恢复、重新开始的状态重置单元测试；多种窗口比例截图；各档分辨率的绘制调用与帧耗时；重新开始 / 退出 / 开始循环 10 次无残留、无内存持续增长 |

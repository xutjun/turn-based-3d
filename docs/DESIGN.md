# 工程设计文档（DESIGN.md）

> 本文档是步骤 1~8 的唯一技术依据。需求以 `docs/SPEC.md` 为准；本文档只把 SPEC 落成可实现的接口、字段、公式和流程。若两者冲突，以 SPEC 为准，并在汇报中说明。
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
├─ src/
│  ├─ main.ts                 入口：?preview=1 进入模型预览页，否则进入战斗
│  ├─ core/                   规则逻辑层：纯 TS，禁止 import three / DOM / src/render / src/ui / src/assets
│  │  ├─ types.ts             §2 的全部接口
│  │  ├─ rng.ts               可注入种子的随机数（mulberry32）
│  │  ├─ events.ts            事件类型定义 + EventBus
│  │  ├─ damage.ts            伤害/治疗/暴击/防御公式（SPEC §6 要求集中于此并写注释）
│  │  ├─ turnOrder.ts         出手排序
│  │  ├─ targeting.ts         目标校验、补足、重选、执行顺序
│  │  ├─ status.ts            封印施加/递减/解除
│  │  ├─ commands.ts          指令校验、可用指令查询、回退
│  │  ├─ skillExecutor.ts     按 pattern 执行技能，产出事件
│  │  ├─ ai.ts                敌方与自动宝宝的指令决策
│  │  ├─ battle.ts            BattleEngine：状态机与对外 API
│  │  └─ setup.ts             由配置表构建 BattleState
│  ├─ data/                   配置表：纯数据 + 只依赖 core/types.ts
│  │  ├─ battleConfig.ts      全局数值（暴击、浮动、防御系数等）
│  │  ├─ skills.ts            技能表（§4）
│  │  ├─ classes.ts           职业 → 技能库
│  │  ├─ weapons.ts           武器：出手方式 + 普攻技能 + 发光参数
│  │  ├─ heroes.ts            友方 5 人物 + 5 宝宝
│  │  ├─ enemies.ts           敌方 10 单位
│  │  ├─ formation.ts         阵型格子与世界坐标（§7）
│  │  └─ aiConfig.ts          AI 阈值
│  ├─ assets/                 AssetFactory / AssetRegistry、程序化贴图、模型 builder、音效合成
│  │  ├─ AssetRegistry.ts     资源键 → 工厂；之后可替换为 glb 加载器
│  │  ├─ textures/            Canvas/DataTexture 噪声、划痕、铆钉、布料、法线、粒子贴图
│  │  ├─ models/              buildKnight()、buildSwordWithGlow() 等 builder
│  │  └─ audio/               Web Audio 合成器
│  ├─ render/                 场景、相机、灯光、后处理、动画、特效、BattleDirector
│  │  ├─ scene/  camera/  postfx/  animation/  fx/
│  │  └─ director/            把逻辑事件变成按顺序播放的时间线
│  ├─ ui/                     DOM 界面：指令面板、目标选择、出手顺序条、日志、头顶条、飘字、结算、设置
│  └─ preview/                模型预览页（SPEC §3.4）
└─ tests/
   └─ core/                   Vitest 单元测试，文件名 *.test.ts
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
  skillIds: SkillId[];     // 不含普攻
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
  turnOrder: UnitId[];                  // 本回合出手顺序（回合开始时生成，包含倒地的友方，见 §8.2）
  actionCursor: number;                 // 下一个出手者在 turnOrder 中的下标
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
  units: Unit[];             // 由 setup.ts 根据 heroes/enemies/formation 生成
  settings: BattleSettings;
  ai: AiConfig;
  seed: number;
}

export interface AiConfig {
  healHpThreshold: number;      // 友军 hp 比例低于该值时治疗，默认 0.6
  aoeMinTargets: number;        // 存活对方单位 ≥ 该值时优先用群体技能，默认 3
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
| `CommandRequested` | 执行阶段中复活单位轮到出手、需要玩家下指令时（§8.2） | `unitId` |
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
| `UnitRevived` | 复活成功 | `unitId`, `actorId`, `hpAfter`, `maxHp`, `actsThisTurn: boolean`（见 §5.5） |
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
- 群体法术 / 群体治疗：所有目标都是 step 0（同帧爆发、同时飘字）。

**死亡事件顺序**：`sequential` / `multiHit` 中，`UnitDied` 紧跟在致死的那条 `HitResolved` 之后；`simultaneous` 中，等该 step 的所有 `HitResolved` 都发出后，再统一发出 `UnitDied`。

### 3.4 一次出手的事件序列示例
```
UnitActStart
 [CommandFallback]       // 可选
 [TargetRetargeted]      // 可选
 SkillCast  或  ActionFizzled
 HitResolved / HealResolved / StatusApplied / StatusResisted / UnitRevived …（0..n 条）
 [UnitDied …]
UnitActEnd
[BattleEnd]              // 这次出手导致一方全灭时
```
最后一个单位出手后，同一次 `stepAction()` 的返回值末尾追加 `StatusTicked / StatusRemoved …`、`TurnEnd`、下一回合的 `TurnStart`、`CommandPhaseStart`。

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
| `combo_slash` | 连斩 | physical | 40 | damage | physical | 敌·存活 | 1 | multiHit | 3 | 0.6 | 1.0 | 是 | comboSlash / tripleShot / — | none | 近战单位使用 |
| `triple_shot` | 三连射 | physical | 40 | damage | physical | 敌·存活 | 1 | multiHit | 3 | 0.6 | 1.0 | 是 | comboSlash / tripleShot / — | none | 连斩的弓箭手版本：数值相同，远程单位使用 |
| `whirlwind` | 旋风斩 | physical | 80 | damage | physical | 敌·存活 | 7 | sequential | 1 | 0.7 | 1.0 | 是 | whirlwind / arrowRain / — | none | `sequenceOrder: 'speedDesc'`；近战单位使用 |
| `arrow_rain` | 箭雨 | physical | 80 | damage | physical | 敌·存活 | 7 | sequential | 1 | 0.7 | 1.0 | 是 | whirlwind / arrowRain / — | none | 旋风斩的弓箭手版本：数值相同，远程单位使用 |
| `group_spell` | 群体法术·天雷 | magic | 80 | damage | magic | 敌·存活 | 6 | simultaneous | 1 | 0.8 | 1.0 | 否 | — / — / groupSpell | thunder | — |
| `group_spell_fire` | 群体法术·烈焰 | magic | 80 | damage | magic | 敌·存活 | 6 | simultaneous | 1 | 0.8 | 1.0 | 否 | — / — / groupSpell | fire | 群体法术的火系版本：数值相同，骨龙幼崽使用 |
| `single_spell` | 单体法术·炎爆 | magic | 50 | damage | magic | 敌·存活 | 1 | single | 1 | 1.6 | 1.0 | 否 | — / — / singleSpell | fire | SPEC §7.1 中的“可选补充” |
| `seal` | 封印 | seal | 60 | seal | magic | 敌·存活且未被封印 | 1 | single | 1 | 0 | 0.75 | 否 | — / — / sealChain | seal | `status: { type: 'seal', duration: 3 }` |
| `group_heal` | 群体治疗 | heal | 80 | heal | magic | 友·存活 | 3 | simultaneous | 1 | 1.0 | 1.0 | 否 | — / — / groupHeal | heal | — |
| `revive` | 复活 | heal | 120 | revive | magic | 友·死亡 | 1 | single | 1 | 0 | 1.0 | 否 | — / — / revive | heal | `reviveHpRatio: 0.3` |

> 步骤 2 补充：`triple_shot`、`arrow_rain`、`group_spell_fire` 不是新技能，而是 SPEC §7.1 里连斩 / 旋风斩的“弓箭手版本”和群体法术的另一种元素。它们在技能表里各占一行（用原技能改名称、说明、元素得到，数值由测试保证相同），这样指令面板、日志、飘字和技能演示模式显示的名称完全一致。

单体治疗（SPEC §7.1 中的“可选补充”）本期不做，表结构已能支持（`effect: heal, pattern: single`）。

### 4.3 职业技能库（`classes.ts`）
| 职业 | 技能库（不含普攻） |
|---|---|
| physical | `combo_slash`, `whirlwind`（近战）；`triple_shot`, `arrow_rain`（远程） |
| magic | `group_spell`, `group_spell_fire`, `single_spell` |
| seal | `seal` |
| heal | `group_heal`, `revive` |

- 友方人物：`skillIds` 由 `heroSkillIds(职业, 出手方式)` 给出——物理系近战拿 `combo_slash, whirlwind`，弓箭手拿 `triple_shot, arrow_rain`；法术系拿 `group_spell, single_spell`；封印、恢复拿各自的全部技能。
- 宝宝与敌人：`skillIds` 在模板里写明，必须是所属职业技能库的子集。
- 敌人不能拥有 `revive`（敌人被击败即消失，见 §5.5）；步骤 2 用测试校验。

### 4.4 Delivery 与普攻的决定方式（SPEC §7、SPEC §7.3）
- 普攻：`basicAttackSkillId` 由武器决定（`weapons.ts`）：刀/剑/枪/弓 → `basic_physical`，法杖 → `basic_magic`。宝宝和敌人没有武器，在模板里直接写 `attackMode` 和 `basicAttackSkillId`。
- 实际 delivery：`damageType = magic` 时固定为 `cast`；`damageType = physical` 时取单位的 `attackMode`（`melee` 或 `ranged`）。`attackMode = cast` 的单位如果被配置成物理技能，按 `melee` 处理（防御性规则，默认数据里不会出现）。
- 实际冲锋 = `skill.meleeCharge && delivery === 'melee'`。
- 动画 = `skill.animation[delivery]`。

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
- **复活当回合能否出手**：取决于被复活者在本回合 `turnOrder` 中的位置（`turnOrder` 包含倒地的友方，§8.2）：
  - 位置在复活施法者**之后**（速度更慢；同速时由回合开始时的随机排序决定）：本回合到它时正常出手，`UnitRevived.actsThisTurn = true`。
  - 位置在施法者**之前**（速度更快，那个位置已经过去）：本回合不出手，`actsThisTurn = false`。
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
- **主目标已不合法**（敌方已被击败消失；封印时目标已被别人封印；群体治疗目标已倒地）：按速度顺序选第一个合法单位作为新主目标，发出 `TargetRetargeted`，再按 §6.3 补足。
- **复活**目标已不是倒地状态（被别人先复活了）：不重选，发出 `ActionFizzled`，不扣 MP。
- 找不到任何合法目标：发出 `ActionFizzled`，不扣 MP。
- **CommandFallback 改普攻后**：原主目标是存活的敌方就沿用；否则（例如原来是治疗友军）按速度顺序取第一个存活敌人。

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
  colSpacing: 1.9,   // 同排相邻格子间距
  rowSpacing: 2.0,   // 前后排间距
  allyFrontCenter:  { x:  3.4, z:  3.4 },  // 友方前排中心（col 2）
  enemyFrontCenter: { x: -3.4, z: -3.4 },  // 敌方前排中心（col 2）
};
// 双方连线方向：友方面朝 fAlly = normalize(-1, 0, -1)，敌方面朝 fEnemy = normalize(1, 0, 1)
// 排方向（col 增大方向）：p = normalize(1, 0, -1)，两方相同，col 0 在屏幕左侧
position(side, row, col) = frontCenter(side)
                         + p × (col − 2) × colSpacing
                         − facing(side) × row × rowSpacing   // 后排远离对方
```
单位朝向固定为 `facing(side)`，出生后不变（冲锋时临时转向目标，返回后恢复）。

### 7.3 计算结果（保留 3 位小数，由 formation.ts 按上式生成，不手填）
| 格子 | 友方 (x, z) | 敌方 (x, z) |
|---|---|---|
| 前排 col0 | (0.713, 6.087) | (−6.087, −0.713) |
| 前排 col1 | (2.056, 4.744) | (−4.744, −2.056) |
| 前排 col2 | (3.400, 3.400) | (−3.400, −3.400) |
| 前排 col3 | (4.744, 2.056) | (−2.056, −4.744) |
| 前排 col4 | (6.087, 0.713) | (−0.713, −6.087) |
| 后排 | 对应前排 + (1.414, 1.414) | 对应前排 + (−1.414, −1.414) |

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
2. 出手排序：取所有存活单位**和倒地的友方单位**（倒地友方可能在本回合被复活，§5.5；敌方被击败即消失，不参与），按 `speed` 降序；速度相同时用 RNG 打乱（Fisher–Yates，只在同速的组内打乱）。结果写入 `turnOrder`，`actionCursor = 0`，`commands = {}`。
3. 发出 `TurnStart`。

**command（指令阶段）**
- 指令顺序：`A0 人物 → A0 的宝宝 → A1 人物 → A1 的宝宝 …`（按 col 0→4）。跳过死亡单位，`petAutoCommand = true` 时跳过宝宝。
- UI 逐个调用 `submitCommand()`，校验内容：阶段、存活、可指挥、技能存在且属于该单位、MP、封印、主目标满足 `targetSide/targetState`。
- 允许对同一单位重复提交（覆盖之前的指令），方便 UI 做“返回上一个”。
- `beginExecution()`：如果有非自动单位未提交指令就抛错；然后由 `ai.ts` 给所有 `autoCommand` 单位生成指令，发出 `ExecutionPhaseStart` 和所有 `DefendApplied`，进入 execution。

**execution（执行阶段）**——每次 `stepAction()`：
1. 从 `actionCursor` 往后找下一个**仍然存活**的单位（倒地单位直接跳过，不发事件）。
   - **复活单位的指令**：本回合被复活且 `actsThisTurn = true` 的单位，指令阶段时处于倒地状态、没有指令（单位本回合内先死亡后复活的，死亡时其指令已作废）。轮到它时：
     - 人物，或 `petAutoCommand = false` 的宝宝：引擎**暂停**，`awaitingCommandFor = 该单位`，发出 `CommandRequested` 并返回本次事件。玩家通过 `submitCommand()` 现场下指令（校验规则与指令阶段相同）后，下一次 `stepAction()` 从这个单位的 `UnitActStart` 继续。
     - `petAutoCommand = true` 的宝宝：由 `ai.ts` 现场生成指令，不暂停。
     - 暂停期间调用 `stepAction()` 会抛错。
2. 发出 `UnitActStart`；按以下顺序处理：防御 → 只发 `UnitActEnd`；技能 → 检查封印/MP（必要时 `CommandFallback`）→ 校验目标（§6.5）→ 扣 MP + `SkillCast` → 按 pattern 结算 → `UnitActEnd`。
3. 胜负判定：任一方存活单位数为 0 → `winner = 另一方`，`phase = ended`，发出 `BattleEnd`，之后 `stepAction()` 返回 null。
4. 如果已经没有剩余出手者 → 进入 settlement，在同一次返回值中附加结算事件。

**settlement（结算）**
1. 所有存活单位的状态 `remainingTurns −= 1`（`StatusTicked / StatusRemoved(expired)`）。
2. 清除所有 `defending`。
3. 发出 `TurnEnd`；再次执行胜负判定（防御性，默认规则下不会在此触发）；进入下一回合的 TurnStart → command。

### 8.3 初始阵容（`heroes.ts` / `enemies.ts`，数值为初始值，步骤 8 可调平衡）
**友方人物（后排）**
| id | 格子 | 名称 | 职业 | 武器 | attackMode | 普攻 | HP | MP | 物伤 | 法伤 | 防御 | 速度 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A0 | 1,0 | 夜隼 | physical（自由职业） | 弓 bow | ranged | basic_physical | 950 | 300 | 150 | 40 | 45 | 110 |
| A1 | 1,1 | 烬刃 | physical | 刀 blade | melee | basic_physical | 1200 | 300 | 160 | 40 | 60 | 90 |
| A2 | 1,2 | 雷咒 | magic | 法杖 staff | cast | basic_magic | 850 | 600 | 40 | 170 | 35 | 95 |
| A3 | 1,3 | 缚魂 | seal | 剑 sword | melee | basic_physical | 1000 | 500 | 110 | 120 | 50 | 120 |
| A4 | 1,4 | 守誓 | heal | 枪 spear | melee | basic_physical | 1000 | 600 | 100 | 140 | 50 | 85 |

**友方宝宝（前排，位于主人身前）**
| id | 格子 | 名称/形象 | 主人 | 职业 | attackMode | 普攻 | 技能 | HP | MP | 物伤 | 法伤 | 防御 | 速度 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A5 | 0,0 | 影狼·灰 | A0 | physical | melee | basic_physical | combo_slash | 650 | 150 | 110 | 20 | 40 | 105 |
| A6 | 0,1 | 影狼·赤 | A1 | physical | melee | basic_physical | combo_slash | 700 | 150 | 115 | 20 | 40 | 100 |
| A7 | 0,2 | 骨龙幼崽 | A2 | magic | cast | basic_magic | group_spell_fire | 600 | 300 | 30 | 120 | 30 | 90 |
| A8 | 0,3 | 幽灵 | A3 | seal | cast | basic_magic | seal | 600 | 250 | 30 | 90 | 30 | 115 |
| A9 | 0,4 | 魔偶 | A4 | heal | melee | basic_physical | group_heal | 900 | 250 | 80 | 90 | 60 | 70 |

**敌方**
| id | 格子 | 名称 | 级别 | 职业 | attackMode | 普攻 | 技能 | HP | MP | 物伤 | 法伤 | 防御 | 速度 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E0 | 0,0 | 骷髅兵 | minion | physical | melee | basic_physical | — | 600 | 0 | 120 | 0 | 40 | 80 |
| E1 | 0,1 | 骷髅兵 | minion | physical | melee | basic_physical | — | 600 | 0 | 120 | 0 | 40 | 82 |
| E2 | 0,2 | 堕落骑士 | elite | physical | melee | basic_physical | combo_slash | 1100 | 200 | 150 | 30 | 70 | 75 |
| E3 | 0,3 | 骷髅兵 | minion | physical | melee | basic_physical | — | 600 | 0 | 120 | 0 | 40 | 84 |
| E4 | 0,4 | 骷髅兵 | minion | physical | melee | basic_physical | — | 600 | 0 | 120 | 0 | 40 | 86 |
| E5 | 1,0 | 恶魔祭司·缚 | elite | seal | cast | basic_magic | seal | 800 | 400 | 60 | 130 | 40 | 105 |
| E6 | 1,1 | 亡灵法师 | elite | magic | cast | basic_magic | group_spell, single_spell | 750 | 500 | 40 | 160 | 35 | 92 |
| E7 | 1,2 | 深渊魔将 | boss | physical | melee | basic_physical | combo_slash, whirlwind | 4000 | 600 | 220 | 100 | 90 | 70 |
| E8 | 1,3 | 堕落骑士 | elite | physical | melee | basic_physical | combo_slash | 1100 | 200 | 150 | 30 | 70 | 78 |
| E9 | 1,4 | 恶魔祭司·愈 | elite | heal | cast | basic_magic | group_heal | 800 | 500 | 60 | 130 | 40 | 88 |

### 8.4 AI 规则（`ai.ts`，敌方与自动宝宝共用，阵营相对）
AI 在 `beginExecution()` 时、基于当时的状态决定指令；出手时目标若失效，按 §6.5 处理。只考虑当前可用（MP 足够且未被封印）的技能。“残血”统一按 `hp / maxHp` 最低判断，相同时取 id 字典序更小的。
- **恢复系**（SPEC §8：优先治疗低血量友军）：
  1. 存在存活友军 `hp/maxHp < healHpThreshold (0.6)` 且有群体治疗 → 群体治疗，主目标为比例最低者。
  2. 否则存在倒地友军且有复活（只有友方自动宝宝/复活单位可能有，敌人没有复活）→ 复活，目标为 id 最小的倒地友军。
  3. 否则普攻残血敌人。
- **封印系**（SPEC §8：优先封印对方法术/恢复职业）：
  1. 候选 = 存活、未被封印、`classId ∈ {magic, heal}` 的对方单位，取法伤最高者封印。
  2. 没有候选时，对任意存活且未被封印、拥有技能的对方单位，取法伤最高者封印。
  3. 否则普攻残血敌人。
- **其他**（物理系、法术系；SPEC §8：优先攻击残血目标）：主目标 = 残血敌人。
  1. 存活对方单位数 ≥ `aoeMinTargets (3)` 且有群体技能（目标数 > 1 的伤害技能：`whirlwind` / `arrow_rain` / `group_spell` / `group_spell_fire`）→ 使用群体技能。
  2. 否则有单体技能（目标数 = 1 的伤害技能：`combo_slash` / `triple_shot` / `single_spell`）→ 使用单体技能。
  3. 否则普攻。
- AI 不选防御指令。

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
- **U8 复活当回合出手**：被复活者在本回合出手顺序中排在施法者之后，本回合可以正常出手；排在之前，则本回合不出手。轮到它时暂停，让玩家现场下指令（开启宝宝自动的宝宝由 AI 决定）。见 §5.5、§8.2。
- **U9 不回蓝**：暂时不做回复 MP 的技能，也不自动回复。
- **U10 敌人没有复活技能**。

### 9.2 其他设计假设
- **A1 宝宝形象**：物理=影狼（两只物理宝宝换配色），法术=骨龙幼崽，封印=幽灵，恢复=魔偶。每只宝宝 = 普攻 + 1 个本职业技能（“简化版”指技能数量更少、数值更低，技能模板复用）。
- **A2 敌方构成**：骷髅兵 ×4（小怪），堕落骑士 ×2、恶魔祭司 ×2（1 封印、1 恢复）、亡灵法师 ×1（精英），深渊魔将 ×1（Boss）。
- **A3 技能命中率**：伤害类技能默认命中率 1.0，封印 0.75，都可配置；没有单独的闪避属性。
- **A4 封印计时**：施加回合计入递减；立即生效（未出手的技能指令改为普攻）。见 §5.8。
- **A5 速度相同**：同速单位的先后由回合开始时的随机排序决定，出手顺序、目标补足、复活当回合能否出手都用这个结果，保证一致。
- **A6 复活细节**：复活不回复 MP、清空状态；出手时目标已被他人复活则作废、不扣 MP。
- **A7 指令顺序与宝宝自动**：人物、宝宝交替下指令；`petAutoCommand` 默认 false（手动）。
- **A8 随机数**：所有随机通过可注入种子的 RNG，保证测试可复现；正式游戏用时间戳作为种子。
- **A9 无回合上限**：最低伤害为 1 且 MP 有限，战斗一定会结束，不设平局。
- **A10 初始数值**：§8.3 的数值是初始值，步骤 8 调平衡时可以改数值，但不改规则。
- **A11 AI 细节**：阈值见 `aiConfig.ts`；AI 不使用防御。

---

## 10. 里程碑（步骤 1~8）

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

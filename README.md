# 暗黑风 3D 回合制战斗原型

浏览器里运行的 3D 回合制战斗（TypeScript + Vite + Three.js）。只有战斗场景：友方 5 个人物 + 5 只宝宝，对敌方 10 个单位（含 1 个 Boss）。
模型、贴图、特效、音效全部由代码程序化生成，没有任何外部美术或音频文件。

- 完整需求：[docs/SPEC.md](docs/SPEC.md)
- 工程设计（数据结构、事件、公式、目标规则、阵型、状态机、设计假设）：[docs/DESIGN.md](docs/DESIGN.md)

---

## 1. 运行与构建

需要 Node.js 20 以上。

```bash
npm install
npm run dev        # 开发服务器，按终端里显示的地址打开
npm run build      # 类型检查 + 打包到 dist/
npm test           # 全部单元测试与回归测试（Vitest）
npm run typecheck  # 只做类型检查
npm run sim        # 命令行里跑一场战斗并输出文字日志（--seed=42 固定种子，--quiet 只看概况）
npm run balance    # 批量模拟统计胜率、回合数、技能使用、敌方集火率、魔法不足占比（默认 500 场，--seeds=1000 指定场数）
```

### 页面入口（地址参数）

| 地址 | 内容 |
|---|---|
| `/` | 标题界面 → 探索模式（v0.6，见下方“操作”）→ 点 Boss 对话 →“我准备好了”→ 入场过场 → 战斗：你给 5 个人物下指令（宝宝可切换自动 / 手动）；`&start=1` 跳过标题、探索和过场直接开战 |
| `/?auto=1` | 自动战斗：双方都由 AI 出手 |
| `/?demo=skills` | 技能演示：每个技能的演出可以单独触发（`&play=whirlwind` 直接播放某一个，`&all=1` 依次全放） |
| `/?demo=1` | 演出样例：一段固定脚本，把各种演出路径演一遍 |
| `/?preview=1` | 模型预览：旋转查看每个角色、宝宝、敌人、武器（`&model=资源键`；`&idle=0` 关闭待机动画看静止站姿；`&walk=3.2` 让人物沿地台上的圆圈行走、`&walk=6.4` 跑步，面板里可切换速度） |

通用参数：`seed=数字`（固定随机种子，相同种子 + 相同指令 = 完全相同的战斗）、`speed=2`、`skip=1`（跳过动画）、
`pet=auto`（宝宝自动）、`quality=low` / `high`（画质）、`res=1920x1200` / `fit`（分辨率）、`mute=1` / `0`（静音）——这三项临时覆盖设置菜单里保存的值、不写回、`fps=0`（隐藏帧率）、`grid=1`（显示格子坐标）、`merge=0`（关闭网格合并，用来对比优化前后）、
`silhouette=1`（剪影测试：单位纯黑、背景浅灰，检查轮廓在战场距离下能不能分辨；预览页也可用）。

### 操作

- 探索模式（v0.6）：只显示队长（烬刃）和 Boss（深渊魔将，在它的战斗站位待机）；4 名队员、宝宝和其余敌人都不出现（队员在开战的过场里才现身），没有头顶条、顺序条和指令面板。
  `鼠标左键` 点地面：队长跑过去（6.4 米/秒），自动绕开火盆、石柱、断柱、旗杆、骨堆和 Boss，点到障碍里或场景外时跑到最近的可达处，地面有暗金色的点击标记；跑动中再点可以改道。
  鼠标指着 Boss 时光标变成手形、Boss 轮廓高亮；点 Boss 跑到它面前对话，选“我准备好了”进入入场过场（v0.6-intro）。`方向键` / `WASD` 是调试用的直线移动，同样撞不穿障碍物（贴着表面滑）。
  相机平滑跟随、不超出场景边界。`Esc` / 齿轮打开设置菜单（同样暂停），“重新开始”在探索中是“回到起点”。
- 入场过场（v0.6-intro，约 6.5 秒）：队员从队长的影子里显形 → Boss 怒吼、抬腿跺地 → 冲击波把 5 人震飞、落到战斗格子 → 宝宝跳入 → 镜头拉到战斗视角 → 第 1 回合，界面淡入。
  过场中倍速（`1` `2`）、跳过动画（`S`）、设置菜单（暂停）都可用；设置里“重新开始”= 跳过过场直接开战。
- 指令：`A` 攻击、`W` 技能、`D` 防御；技能列表和选目标里 `Esc` / 右键 返回，指令菜单里退回上一个单位用 `退格`（v0.5 起菜单里的 `Esc` 用来打开设置）；选目标时悬停预览会命中的全部目标，点击确认。
- 右上角：战斗速度 `1×` / `2×`（按键 `1` `2`）、跳过动画（`S`）、设置（齿轮，或按 `Esc`），下面是宝宝指令 自动 / 手动。
- 设置菜单（v0.5）：分辨率（1280×800 ~ 1920×1200 或适应窗口）、画质 高 / 低、主音量 / 音效 / 环境音（拖动时有试听提示音）、静音（也可按 `M`）；
  战斗中还有“重新开始”“退出游戏”（回标题界面），都要二次确认。菜单打开时战斗暂停，快捷键不起作用。设置保存在浏览器本地存储里，刷新后保留。
- 画面固定 16:10：窗口比例不同时上下或左右加黑边，所有界面都在画面区域内，随窗口等比缩放。
- 调试：`G` 格子坐标、`F` 帧率。控制台里 `__app.explore()` 查看探索模式的状态（队长位置、速度、行走权重、终点与剩余路径、显示的单位、Boss 悬停、相机），`__app.exploreClick(x, z)` 代替鼠标点地面，`__perf()` 查看绘制调用等性能数据，`__idle()` 查看每个单位的待机状态（权重、呼吸相位、周期倍率），`__motion()` 查看每个单位的进攻动作状态（阶段、动作名、是否回到站姿和原位），`__player` / `__battle` 查看战斗自检数据，`__app` 查看界面状态（当前界面、设置、暂停、渲染尺寸、场上残留）。
- 头顶平时只显示血条；Boss、正在出手的单位、被选中 / 会被命中的单位、鼠标指着的单位才显示名字。
- 浏览器不允许页面在你操作之前出声：标题界面点“开始游戏”时解锁音频。

---

## 2. 架构

```
src/
├─ core/      规则逻辑：回合、伤害、技能、目标、封印、AI。纯 TypeScript，不依赖 three、DOM 和配置表，可单独测试
├─ data/      配置表：技能、职业、人物、敌人、武器、阵型、数值、画面、演出时长、界面、音效。纯数据
├─ assets/    程序化资源：贴图、模型 builder、资源注册表、绘制优化、音效合成（assets/audio）
├─ render/    三维场景：相机、灯光、雾、后处理、单位动画、特效、把逻辑事件变成演出的导演（director）
├─ ui/        DOM 界面：指令面板、目标选择、头顶条、飘字、日志、结算、演示页；
│             layout/（固定 16:10 舞台与坐标换算）、settings/（设置存储与设置菜单）、title/（标题界面）
├─ preview/   模型预览页
└─ main.ts    入口：按地址参数选择页面
scripts/      命令行模拟（sim）与批量统计（balance）
tests/        core / data / render / ui 的单元测试，regression/ 是整场战斗回归
```

**逻辑和画面是分开的。** `core/battle.ts` 的 `BattleEngine` 同步、按步推进：`stepAction()` 一次只结算一个单位的一次出手，
并把结果作为事件（`SkillCast`、`HitResolved`、`UnitDied` …）发出。画面这边的 `BattleDirector` 订阅事件，排成演出播放；
控制器等演出播完才让引擎结算下一次出手，所以任意时刻只有一个单位在行动。画面只使用事件里的字段，不读引擎的实时状态。

依赖方向是单向的：`data → core/types`，`core` 只依赖自己，`assets → three + data`，`render → assets + data + core 的类型和事件`，
`ui → core + data + render`。`tests/core/purity.test.ts` 会检查 `core` 没有引入 three 或 DOM。

一次出手的流程：

```
玩家 / AI 提交指令 → engine.beginExecution() → engine.stepAction()
   → 事件：UnitActStart, SkillCast, HitResolved…, UnitDied…, UnitActEnd
   → BattleDirector 把这些事件交给 Choreographer 编排（冲锋、挥击、特效、镜头、顿帧）
   → 舞台（BattleStage / UnitView / FxSystem）播放动画并触发音效，界面更新头顶条、飘字、日志
   → 演出结束 → 下一次 stepAction()
```

---

## 3. 调整数值与画面

所有可调的数都在 `src/data/` 里，改完保存即可看到效果（开发服务器会自动刷新）。

| 想调什么 | 文件 |
|---|---|
| 人物、宝宝的气血 / 魔法 / 伤害 / 防御 / 速度 | `data/heroes.ts` |
| 每只宝宝是物理型还是法术型，两种类型各有什么技能 | `data/pets.ts` |
| 被动技能（连击）的触发概率、追加次数 | `data/passives.ts` |
| 敌人与 Boss 的数值、技能、站位 | `data/enemies.ts` |
| 技能的消耗、倍率、段数、目标数、命中率 | `data/skills.ts` |
| 暴击率与倍率、伤害浮动、法术防御系数、防御减伤 | `data/battleConfig.ts` |
| AI 阈值（多少血以下治疗、多少敌人以上用群体技能）、敌方选目标的权重（同回合衰减、残血加权）、哪一方集火 / 分散 | `data/aiConfig.ts` |
| 阵型间距、两军距离 | `data/formation.ts` |
| 相机（距离、视角、俯角）、灯光、雾、后处理、低画质参数 | `data/renderConfig.ts` |
| 动画时长、镜头推近 / 抖动 / 慢镜头、飘字、粒子上限、冲锋转身 | `data/presentationConfig.ts` |
| 目标光圈、日志行数、头顶名字的显示规则 | `data/uiConfig.ts` |
| 音量、各音效响度、环境音 | `data/audioConfig.ts` |

**调数值后请跑 `npm run balance`。** 它用几百个种子跑完整的自动战斗，输出友方胜率、回合数分布、每个技能的使用次数，
以及敌方的被集火率（一回合内同一个友方被敌方单体出手选中 3 次以上的回合占比）和双方因魔法不足被迫普攻的出手占比。
当前目标是胜率 50%~70%、多数战斗 8~14 回合、被集火率很低、友方魔法不足占比低于 10%，`tests/regression` 里有一条测试守着这些范围。
伤害公式在 `core/damage.ts`，不建议为了平衡去改公式，改配置表里的数即可。

**画面**：`CAMERA_CONFIG.distance` 越小人物越大；`fitAspect` 决定窗口多窄时开始自动放大可见范围（保证双方阵型都在画面内）。
`FOG_CONFIG.density` 是远处雾的浓度，`FOG_CONFIG.ground` 是贴地雾片的数量和不透明度。

---

## 4. 新增内容

### 4.1 新增一个技能（完整步骤）

以“给刀客加一个单体重击”为例。技能的结算方式由 `pattern` 决定，现有四种都已实现，新技能只要选一种，不用写结算代码：

| pattern | 含义 | 例子 |
|---|---|---|
| `single` | 单目标单段 | 普攻、单体法术、封印、复活 |
| `multiHit` | 单目标多段，目标中途倒下则剩余段数取消 | 连斩、三连射 |
| `sequential` | 多目标依次，每个目标一步 | 旋风斩、箭雨 |
| `simultaneous` | 多目标同时 | 群体法术、群体治疗 |

1. **在 `src/data/skills.ts` 里加一行**，并把它放进文件末尾的 `SKILL_LIST`：

   ```ts
   const HEAVY_STRIKE: SkillDef = {
     id: 'heavy_strike',
     name: '重击',
     description: '冲到一个敌人面前全力一击，造成高倍率物理伤害。',
     classId: 'physical',
     mpCost: 60,
     effect: 'damage',
     damageType: 'physical',
     targetSide: 'enemy',
     targetState: 'alive',
     targetCount: 1,
     pattern: 'single',
     hits: 1,
     multiplier: 1.8,
     hitRate: 1.0,
     meleeCharge: true,
     animation: { melee: 'meleeStrike', ranged: 'bowShot' }, // 复用现有演出
     element: 'none',
   };
   ```

   物理技能的 `animation` 必须同时写 `melee` 和 `ranged`，法术类技能写 `cast`。可用的演出名见 `core/types.ts` 的 `AnimType`。

2. **在 `src/data/classes.ts` 的 `CLASS_SKILLS.physical` 里加上 `'heavy_strike'`**（职业技能库：一个单位只能拥有本职业的技能）。

3. **把技能发给单位。** 人物的技能来自 `classes.ts` 的 `heroSkillIds()`，例如把物理近战那一行改成
   `['combo_slash', 'whirlwind', 'heavy_strike']`；敌人的技能直接写在 `enemies.ts` 的模板里；宝宝的技能由类型决定，写在 `pets.ts` 的 `PET_TYPES` 里。

4. **运行 `npm run dev`**：刀客的技能列表里出现“重击”，可以选目标、释放；魔法不足或被封印时自动置灰。
   AI 按“群体伤害技能 / 单体伤害技能 / 治疗 / 封印 / 复活”分类选技能，不认具体的技能 id；同一类里有多个技能时用 `skillIds` 里排在前面的那个
   （所以想让 AI 也用“重击”，把它排在“连斩”前面）。

5. **运行 `npm test`**，按提示更新写死了当前阵容的几条断言（按上面的例子实测，会有 3 条失败）：
   - `tests/core/data.test.ts` 的“五个人物的技能”；
   - `tests/ui/commandSession.test.ts` 的“技能列表显示技能表里的名称、消耗和说明”和“魔法不足的技能置灰……”，它们列出了刀客的技能表。

   另外，`tests/render/skillDemo.test.ts` 要求正式战斗里出现的每种“技能 + 出手方式 + 动画”在技能演示里都演过：
   如果新技能会被 AI 用到，就在 `src/ui/showcase/skillDemoScripts.ts` 里照着已有条目加一个演示（几行）。

6. **运行 `npm run balance`** 看胜率和回合数有没有跑出目标范围。

如果需要全新的结算方式（不属于上面四种 pattern）或全新的演出，才需要改 `core/skillExecutor.ts` 和 `render/director/Choreographer.ts`。

**被动技能**不需要下指令、不消耗魔法，写在 `src/data/passives.ts`（触发条件、概率、效果），再把 id 加到单位的 `passiveIds`（宝宝在 `pets.ts`）。
现在只有一种触发条件（`basicAttack`：用普攻出手时）和一种效果（`extraHit`：对同一目标追加攻击），改概率或追加次数只用改配置；
要加新的触发条件或效果，扩展 `core/types.ts` 的 `PassiveTrigger` / `PassiveEffect`，并在 `core/passives.ts` 和引擎的触发点加对应的判定。

### 4.2 新增一个敌人

1. 在 `src/data/enemies.ts` 的 `ARCHETYPES` 里加一个原型（名称、级别、职业、出手方式、普攻、技能、六项属性）。
2. 在 `ENEMY_TEMPLATES` 里把它放到某个格子上（前排 `row 0`、后排 `row 1`，`col 0~4`）。敌方固定 10 个格子，要替换掉原来的一个。
3. 外观：在 `src/data/unitModels.ts` 里把它的 `templateId` 指到一个已有模型（可以用 `params` 换颜色和比例）；
   没有登记的 `templateId` 会显示成占位体。要做新模型，见 4.4。

### 4.3 新增一个职业

1. `core/types.ts` 的 `ClassId` 加上新职业的 id。
2. `data/classes.ts` 的 `CLASS_SKILLS` 和 `heroSkillIds()` 里写它的技能库。
3. `core/ai.ts` 的 `decideCommand()` 里决定它的 AI 怎么选技能（不写的话按“物理 / 法术”以外的默认分支只会普攻）。
4. `ui/panels/CommandPanel.ts` 的 `CLASS_LABEL`、`data/renderConfig.ts` 的 `PLACEHOLDER_CONFIG.classColor` 各补一项显示名和占位色。
5. 把某个人物 / 敌人的 `classId` 改成新职业。

### 4.4 新增 / 调整模型

每个角色、武器、场景物件都是一个独立的 builder 函数（`src/assets/models/`），参数化颜色和比例。

- **只改外观参数**：在 `data/unitModels.ts` 的 `params` 里覆盖 builder 的默认值，例如
  `hero_blade: { assetKey: ASSET_KEYS.heroKnight, params: { clothColor: 0x123456, scale: 1.1 } }`。
  各 builder 有哪些参数，看对应文件开头的 `*_DEFAULTS`。`/?preview=1` 可以单独查看效果。
- **做新模型**：写一个 builder（人形可以用 `characters/rig.ts` 的骨架和 `characters/parts.ts` 的零件），
  在 `data/assetKeys.ts` 加资源键，在 `assets/registerDefaults.ts` 注册，再在 `data/unitModels.ts` 里引用。

### 4.5 调整武器发光

发光参数在 `src/data/weapons.ts` 每把武器的 `glow` 里：

| 参数 | 含义 |
|---|---|
| `color` / `accentColor` | 主色 / 辅色 |
| `intensity` | 自发光强度（细发光线、符文、水晶） |
| `edgeIntensity` | 边缘轮廓光强度：刃、杆、金属件轮廓上的一圈发光色亮边，0 = 关闭 |
| `breathHz` / `breathDepth` | 呼吸闪烁的频率 / 幅度 |
| `flowSpeed` | 光纹流动速度 |
| `lightIntensity` / `lightDistance` | 武器自带点光源的强度 / 范围 |
| `haloSize` / `haloStrength` | 光晕精灵的大小 / 亮度 |
| `particleCount` | 飘散光粒的数量 |
| `flareBoost` / `flareDecay` | 出手瞬间增强的倍率 / 衰减时间 |

武器的发光是“边缘发光”的思路（v0.3）：轮廓光 + 贴着刃口 / 箍边的细发光线 + 流动的光纹为主，光晕精灵只留一点柔光，
保证武器本身的形状在暗场里看得清。出手瞬间细光线按 `flareBoost` 变亮，光晕和轮廓光只吃其中三成，不会糊成一团。

法杖水晶按元素变色的配色在同一个文件的 `STAFF_ELEMENT_COLORS`。武器的形状参数（长度、弧度等）在 `data/unitModels.ts` 的 `WEAPON_MODELS.params` 里覆盖。
技能演出里武器逐击变亮的倍率在 `data/presentationConfig.ts` 的 `GLOW_FX`。


### 4.6 调整外观配色与待机动画（v0.3）

- **配色与轮边光**：友方人物、友方宝宝、敌方各兵种的轮边光分别在 `data/renderConfig.ts` 的 `RIM_CONFIG`（`ally` / `pet` / `weapon`）
  和 `ENEMY_RIM_CONFIG`（骷髅、堕落骑士、恶魔祭司、亡灵法师、Boss 各一套）里。`lift` 是“底色提亮”，让各部件自己的颜色在暗场里看得出来；
  `topShade` 是“顶面提亮、底面压暗”（魔偶用它靠明暗拉开石块的层次）。
- **待机风格**：`data/idleConfig.ts` 的 `IDLE_STYLES` 里有 9 种风格（僵硬、骨架、飘逸、轻捷、野兽、骨龙、幽灵、魔偶、Boss），
  每种是一组幅度和频率（呼吸、重心转移、张望、小动作、摆尾、扇翅、漂浮、布料飘动、发光呼吸 …）。
  哪个单位用哪种风格，在 `data/unitModels.ts` 每个单位的 `idle` 字段里指定。
- **不同步**：每个单位按自己的 id 取随机种子，相位和周期（±18%，`IDLE_CONFIG.periodJitter`）都不一样。
- **过渡**：出手、受击、冲锋时待机权重按 `IDLE_CONFIG.blendRate` 平滑降到 0，结束后平滑回升；倒地后只保留 `fallenScale`（7%）的幅度。
- **布料飘动**：披风、袍摆、破旗、锁链在顶点着色器里按“飘动权重”摆动，不占关节和绘制调用。新做的布片用 `parts.ts` 的
  `capeMesh` / `robeSkirt` / `chain` 就自带权重。
- **给新关节加待机动作**：把关节名加到 `render/units/animatedJoints.ts` 的 `EXTRA_JOINT_NAMES`，再在 `render/units/IdleAnimator.ts` 里写它怎么转。
- **宝宝按战场距离设计**：狼有两套体型参数（`creatures/wolf.ts` 的 `BUILDS`），默认 `burly`，`lean` 是保留的备选，
  在 `data/unitModels.ts` 的 `params` 里写 `build: 'lean'` 即可切换。

### 4.7 调整进攻动画（v0.4 ~ v0.4.2）

所有进攻动作的参数都在 `data/attackAnimConfig.ts`，改完刷新页面，用 `/?demo=skills` 单独触发来看。

- **节奏**：每个动作（`MoveDef`）的 `timing` 有六段——`anticipation` 预备、`strike` 发力、`hold` 命中顿住（2~4 帧）、
  `follow` 余势、`beat` 停一拍、`recover` 收招。想让某一招更重，就把预备和余势加长、发力保持很短。
- **姿态**：`ready` / `strike` / `follow` / `recover` 各是一串关键姿态，姿态是“相对站姿的偏移量”，通道名在文件开头有说明
  （`root.forward`、`root.pitch`、`shoulderR.x`、`spine.y`、`weapon.aim` …）。每个关键姿态可以指定占这一阶段的比例（`span`）和缓动曲线（`ease`）。
- **谁用哪套动作**：`MOTION_PROFILES`（刀、剑、枪、弓、法杖、狼、魔偶、骨龙、幽灵、通用）。人物按武器取，宝宝在 `MOTION_OF_TEMPLATE` 里指定；
  没列出的人形用刀的动作，非人形用通用的扑击。近战动作的编号见 `MELEE`（0 普攻、1 第二式、2 跃起重劈、3 旋身横扫、4 旋风斩收尾）。
- **大跳跃（v0.4.1）**：近战的来回都是“原地下蹲蓄力 → 高抛物线腾空 → 落地（尘土、轻微震屏）→ 落地缓冲”。`GAITS` 里
  `jump` / `jumpBack`（人形）、`pounce` / `pounceBack`（狼，轻快）、`slamJump` / `slamJumpBack`（魔偶，跳得低、落地震动大）：
  `crouch` 是下蹲的时长和姿态，`hop` 是最高点（米），`land` 是落地缓冲的时长和姿态，`lean` 是腾空时的前倾，`poses` 是腾空途中的姿态，
  `shake` 是落地震屏。总时长在 `MOTION_PROFILES` 的 `approach` / `retreat.duration`，减去下蹲和落地缓冲就是腾空时间。
- **旋风斩的节奏**：`ATTACK_ANIM.whirlwind`——`tempo` 每一击一个倍率（越小越快），`pace` 整体放慢倍率（1 = v0.4 的速度），
  `leap` 是目标之间短跳跃的时长（步态 `whirlHop`：下蹲短、高度低、沿弧线、途中旋身）。
- **跳劈 / 衔接（v0.4.2）**：近战的去程是“跳劈”——起跳后在空中就开始预备，下落段发力，落地的一瞬间正好命中，没有单独的落地缓冲和站定的预备；
  余势进行到一部分就接下一个动作。全部比例在 `ATTACK_ANIM.jumpStrike`：`windupAt`（腾空进行到多少开始预备）、`chainOverlap`（连斩 / 连击：
  余势接下一击的预备）、`hopOverlap`（旋风斩：余势接下一次短跳）、`returnOverlap`（最后一击：余势接回程的下蹲）、`landSquash` / `landSquashTime`
  （落地被压下去的幅度和回弹时间）。重叠比例越大衔接越紧，设成 0 就是等上一段播完。用 `npx tsx scripts/measureMeleeFlow.ts` 量“落地到命中”和“命中前的站定时间”。
- **弓（v0.4.1）**：`BOW_SHOT` / `BOW_QUICK` / `BOW_SKY` 是平射、三连射的后两箭、箭雨。弓有两个专用通道：`bow.aim`（0~1，把弓摆正）、
  `bow.draw`（1 = 弓弦的中点搭在右手上，负值 = 松弦后向前弹）；拉满时双臂的角度是用 `npx tsx scripts/solveBowPose.ts` 在真实骨架上求出来的
  （左手持弓伸向目标，右手落在箭的延长线上），改了身体姿态要重新求一次。弓弦最远拉开多少、松弦弹多远在 `ATTACK_ANIM.bow`，拉满后的瞄准停顿是 `bowFullDrawPause`。
- **法杖施法（v0.4.1）**：`CAST` 是施法动作的编号——普攻挑指、封印画圈、火系挥弧劈下、雷系画圈高举、群体火 / 群体雷（幅度最大）。
  画圈用 `staffOrbit()` 生成（圈心、大小、圈数、方向）。`grip.left = 1` 时左手按 IK 握到杖身上（握点在 `LEFT_GRIP`，够不着时沿杖身在 `gripSlide` 范围内滑动）；
  `fx.trail` 打开时杖顶拖出发光轨迹。敌方祭司、亡灵法师的杖长在模型上，取样点在 `MOUNTED_STAFF`。
- **披风、袍摆、链条的惯性**：`SECONDARY_MOTION`（弹簧刚度、阻尼、偏移上限、飘动增益；`settle` 是身体停下后甩动归零的时间，
  要短于镜头复位，这样每次出手演完时所有单位都已静止、精确回到基准姿态）。
- **新增一招**：写一个 `MoveDef`，放进对应档案的 `melee` / `cast` 列表；要用到新的关节时，先在 `render/units/animatedJoints.ts` 登记关节名，
  姿态里就可以直接写 `<关节名>.x`。
- **关键帧联系表**：`scripts/contactSheets.cjs` 把每种进攻逐帧推进，在各阶段截 8~12 帧拼成一张标好“下蹲 / 腾空 / 落地 / 预备 / 发力 / 命中 / 收招”的图
  （输出到 `docs/screenshots/step11b-sheet-*.png`，截图时锁定机位、取景中心不随跳跃升高，看得出跳了多高）。它需要 playwright（不是本项目的依赖）：
  先 `npm run dev`，再 `NODE_PATH=<playwright 所在的 node_modules> node scripts/contactSheets.cjs --url http://localhost:5173`；
  只装了 playwright-core 时再加环境变量 `BROWSER_PATH` 指向本机的 Chrome / Edge。加 `--only blade,wolf` 只出其中几张，`--frames` 另存每一帧的大图。

### 4.8 调整行走、跑步与探索（v0.6）

参数都在 `data/exploreConfig.ts`，改完用 `/?preview=1&model=unit.hero.knight&walk=3.2`（走路）/ `&walk=6.4`（跑步）或探索模式查看。

- **步态**（`WALK_GAIT`）：相位按走过的距离推进（不是按时间），所以步频自动跟着速度变、支撑脚不在地上滑。
  `cycleBase` / `cycleK` 决定一个周期（左右各一步）走多远（越大步子越大、步频越低）；`dutySlow` / `dutyFast` 是每只脚着地的时间比例；
  `liftBase` / `liftK` 是抬脚高度；`heelLift` / `toeUp` 是推离时抬脚跟、落地时翘脚尖；`armSwing`、`heldArmScale`（持武器的手摆得小）、
  `lean`、`twist`、`roll`、`shift` 是手臂和身体；`blendIn` / `blendOut` 是起步、停步过渡到待机的快慢。身体起伏不用单独调：着地的脚够得着地面需要身体下沉多少，就下沉多少。
- **跑步**（`RUN_GAIT`，v0.6-move）：同一个步态按速度从走路过渡到跑步（`runFrom` → `runFull`，3.2 → 5.0 米/秒），速度 ≤ 3.2 时与走路完全一样。
  `cycleK`（每个周期的时长）、`duty`（每只脚着地的比例，小于 0.5 的部分是两脚都离地的腾空）、`lift` / `liftPeak`（抬脚高度与最高点位置，脚跟上踢）、
  `swingSnap`（离地后继续后退、落地前回扒的长短）、`sink` / `bob` / `flightLift`（支撑中段下沉、腾空上抛的起伏）、`lean` / `center`（前倾与着地范围）、
  `armSwing` / `elbowBend` / `heldArmScale` / `heldElbowScale`（摆臂、屈肘，持武器的手压低）、`capeOffset` / `capeFlutter`（披风、袍摆甩开的程度）。
- **腿部关节**：会走路的人物在 `data/unitModels.ts` 里标 `walk: true`（目前是友方 5 人），髋、膝、踝成为动画关节（`render/units/animatedJoints.ts`），
  由 `render/units/legPose.ts` 的两段骨骼 IK 求角度。战斗中身体下沉（下蹲蓄力、落地缓冲）时同样屈膝、脚留在地面上，腾空时收腿（`LEG_PLANT`）。
- **袍摆被腿顶开**：髋部下方的袍摆、裙甲、挂件在建模时写入 `aStride` 属性，布料着色器按膝和踝的实际位置把被腿碰到的布料推开（`robeClearance` 是腿的粗细）。
- **探索**（`EXPLORE_CONFIG`）：队长、出生点 (8.5, 8.5)、可走区域 `bounds`；`move`：跑速 6.4 米/秒、起跑加速度、到达减速度（停下前的一两步缓冲）、
  转身与转弯速度、卡住重算；`collision`：单位与各类障碍物的碰撞半径；`nav`：寻路格子边长、路径与障碍之间的余量；点击标记 `clickMarker`、悬停高亮 `bossHover`；
  探索相机（距离、平滑时间、领先量、离边界的余量）；交谈距离、战败复位距离给后续步骤用。
- **场景物件的位置**在 `data/battlefieldLayout.ts`：场景搭建和探索的碰撞 / 寻路读同一份，挪动物件后寻路自动跟着变。
- **联系表**：`scripts/walkSheets.cjs` 在预览页里逐帧推进，按步态相位取 8 帧（侧面、斜前方）拼成每人一张图，另有骑士三种速度的对比
  （输出 `docs/screenshots/step14-walk-*.png`，用法同 `contactSheets.cjs`）；`scripts/runSheets.cjs` 是跑步的（`step15-run-*.png`），
  `scripts/exploreShots.cjs` 在游戏里用真实鼠标点击跑动，画出俯视路线图并检查全程离障碍物的最小距离（`step15-explore-*.png`）。
- **入场过场**（`data/cutsceneConfig.ts`）：各段的时刻与时长、显形站位、冲击波速度、飞行时长与最高点、落地缓冲、宝宝入场方式；过场里的关节姿态在 `INTRO_POSES`。
  走位规划在 `explore/introPlan.ts`（纯计算：谁站哪里、每人的抛物线如何绕开火盆石柱和 Boss）。
  `scripts/introShots.cjs`（先 `npm run build && npx vite preview`）从近、中、远、Boss 左右两侧开打各出一张关键帧联系表（`step17-intro-*.png`），并检查落点、残留、倍速、跳过、暂停。
- **新阵型**：前排人物从左到右的顺序在 `data/heroes.ts` 的 `ALLY_LINEUP`（默认 夜隼、雷咒、烬刃、缚魂、守誓），宝宝站在主人身后同一列。

---

## 5. 以后替换成真实 glb 模型

所有模型都通过 `AssetRegistry` 的“资源键 → 工厂函数”创建，使用方只认资源键。替换步骤：

1. 用 three 的 `GLTFLoader` 在进入战斗前把 glb 加载好（现在的启动流程是同步的，需要在 `main.ts` 里加一步“等资源加载完再创建页面”）。
2. 在 `assets/registerDefaults.ts` 里把同一个资源键注册成“克隆已加载场景”的工厂：

   ```ts
   registry.register(ASSET_KEYS.heroKnight, () => SkeletonUtils.clone(loaded.knight.scene), { label: '骑士', category: 'hero' });
   ```

3. 模型需要满足的约定（现在的程序化模型都遵守）：
   - 面朝 `+z`，脚底在 `y = 0`；
   - 有一个名为 `hpAnchor` 的空节点标出头顶血条的位置；
   - 想沿用现在的程序化出手动作，需要提供 `characters/rig.ts` 里 `HumanoidRig` 那样的关节引用
     （`createRig()` 创建骨架时会把它记在模型根节点上，`getRig()` 取回；glb 模型要自己按骨骼名填一份）；
     如果改用 glb 自带的骨骼动画，则在 `render/units/UnitView.ts` 里把 `windup / release / hit / die / revive` 换成播放对应的动画片段——
     这几个方法就是演出层对“一个单位”的全部要求（接口见 `render/director/types.ts` 的 `StageUnit`）。
   - 武器挂在 `weaponMount` 节点下，发光控制通过 `weapons/glow.ts` 的 `finishWeapon()` 挂到武器根节点上。
4. glb 一般自带合并好的蒙皮网格，不需要 `assets/optimize.ts` 的网格合并（对它是空操作）。

贴图、粒子图、音效同理：都集中在 `assets/textures/`、`assets/audio/`，换成加载文件只需要改这些工厂函数的内部。

---

## 6. 性能

- **绘制调用**：程序化模型由很多小几何体拼成，`assets/optimize.ts` 在创建后把“不会单独运动”的网格按材质合并，
  并用“阴影代理”让阴影那一遍每个部件只画一次。v0.6 起 20 个单位的战场每帧约 1280 次绘制调用、战斗中峰值约 1340
  （友方 5 人的髋、膝、踝成为动画关节后多了约 70 次；v0.4.1 约 1210 / 1280，v0.3 约 1170 次，v0.2 约 730 次；上限按 1500 控制），每帧逻辑耗时约 1~1.6 毫秒。
  探索模式只显示队长和 Boss，约 190 次（v0.6-walk 显示 6 个单位时约 530~580 次）。
  `/?merge=0` 可以关掉合并做对比，控制台 `__perf()` 查看实时数字。
- **低画质**：右上角“画质”按钮或 `?quality=low`——关闭辉光、阴影贴图降到 1024、技能粒子减到 40%、贴地雾片减半、不按高分屏放大分辨率；
  待机的次要动画（布料飘动、张望和小动作、骷髅的颤动）也关闭，呼吸、翅膀、漂浮和发光呼吸保留。
  选择会记在浏览器本地存储里。
- 给新模型加了会动的部件（例如给腿加动画）时，把对应关节加到 `render/units/animatedJoints.ts`，否则它下面的网格会被并进上一级而不跟着动。
  每多登记一个关节，这个单位就多出“关节下的材质数 + 1”次绘制调用，登记前先看 `__perf()` 的余量。

---

## 7. 设计假设（摘要）

完整内容和理由见 [docs/DESIGN.md §9](docs/DESIGN.md)。其中带 ★ 的几条修改了 SPEC 原文，已经过确认：

- 武器与职业：法杖给法术系，封印系持剑、恢复系持枪，自由职业是持弓的物理系。封印 / 恢复的技能是法术类、原地施放，普攻按武器走近战物理。
- ★ 已被封印的单位不能再被封印（SPEC 原文是“刷新持续回合”）。封印 3 回合，施加的那一回合也计入；命中率 75%。
- ★ 多目标技能的目标 = 主目标 + 其余单位按速度由快到慢补足（SPEC 原文是“按阵型邻近”）。主目标一定被击中且排第一。
- ★ 敌人被击败后消失，不能再被选中；友方倒地后保持倒地，只有复活能选中。敌人没有复活技能。
- 防御从本回合执行阶段一开始就生效，对物理和法术伤害都减半，只持续一回合。
- 物理伤害、法术伤害、治疗都会暴击（默认 10%、1.5 倍）；普攻命中率 95%，技能默认必中。
- 被复活的单位当回合就能行动：速度位置还没到就在自己的位置出手，位置已过则排到本回合队尾；轮到它时暂停让玩家现场下指令（自动单位由 AI 决定）。每个单位每回合最多出手一次。复活恢复 30% 气血，不恢复魔法。
- 不自动回复魔法；没有回合上限（最低伤害为 1，战斗一定会结束）。
- 三连射、箭雨是连斩、旋风斩的弓箭手版本：数值与原技能相同，只是名称、说明不同。
- 宝宝只分物理型和法术型，没有封印和治疗。物理型（影狼 ×2、魔偶）没有主动技能，被动“连击”：普攻 50% 概率再打同一目标一次，第一击打死目标时第二击取消。法术型（骨龙幼崽、幽灵）有“三重魂火”，一次同时攻击 3 个单位。
- AI 选技能：恢复系先治疗（有人低于 40% 气血），其次复活；封印系用封印；其他职业对方 ≥ 3 人时用群体技能，否则用单体技能。
- AI 选目标：敌方不集火——带权重的随机，同一回合内已被选中的单位权重减半，残血只有小幅加权，封印偏向法术 / 恢复职业；随机走带种子的随机数。友方的自动出手（自动宝宝、自动战斗）仍然固定打残血、封印法伤最高的法术 / 恢复职业。
- 相机俯角 30°（SPEC 建议 35°~45°，按验收意见压低，人物更立体）。

---

## 8. 已知限制

- **帧率没有在真实显卡上测过。** 开发环境只有无显卡的软件渲染，能测的只有绘制调用（约 1170）、每帧逻辑耗时（约 1~1.6 毫秒）和内存是否增长；
  实际 FPS 请在自己的浏览器里按 `F` 查看，卡顿时切到低画质。
  v0.5 用本机核显（AMD Radeon，D3D11）+ 无头 Edge 测过一次：1280×800 ~ 1680×1050 每帧约 14 毫秒，1920×1200 约 21 毫秒，绘制调用都是约 1212 次。
- 不是每一场自动战斗都会出现全部十个技能：AI 优先用群体技能、优先治疗，所以三连射、单体法术、复活只在部分对局里出现
  （复活约每 3 场出现一次）。想单独看某个技能，用 `/?demo=skills`。
- 默认阵容里被复活的单位几乎都是排到队尾出手：治疗师速度 85，只有魔偶（70）比她慢。
- 敌方的治疗很少出现（约每 100 场 1 次）：恶魔祭司·愈通常在前几回合就被友方封印或击败。步骤 8 时也是如此。
- 魔法现在很宽裕（友方因魔法不足被迫普攻的出手不到 1%），魔法值对胜负的影响很小。
- 友方 5 人的腿有髋、膝、踝关节（v0.6，行走和屈膝踩地），Boss 也有（v0.6-intro，入场跺地）；其余敌人的腿、所有人的手和颈仍然没有单独的动画，为了减少绘制调用，这些关节下的网格已合并。狼的四条腿、魔偶的双腿各只有一个关节（整条腿摆动，膝不弯）。
- 行走的脚只在前后方向上做 IK，左右方向按重心位移近似补偿；转弯时（相机跟随的队长原地转身）脚会跟着身体转，不会一步一步踩着转。
- 9 个小怪目前在入场过场结束时直接出现（召唤演出在步骤 18）；战后回到探索在步骤 19。跑步时急转弯不做身体内倾。
- 新阵型里近战宝宝在后排：冲锋路线会自动侧偏、从前排人物之间穿过（`render/units/detour.ts`），不会从主人身上穿过去。
- 走速 3.2 米/秒对 1.75 米高的人物偏快，看起来是快步走（每秒约 4.6 步）；想更像散步就调低 `EXPLORE_CONFIG.move.walkSpeed`。
- 披风、袍摆的惯性甩动是“整块布按权重平移”的近似（一个弹簧质点），不是布料模拟：急转身时方向是对的，但不会卷起来。
- 弓弦是两段直线（中点跟着拉弦手），不是弯曲的弦；弓臂的弯曲是整组部件沿前后方向拉伸的近似。箭雨时弓举向天空约 57°，从斜后方的镜头看弓身接近水平展开。
- 双手握杖的左手用 IK 握到杖身上，量的是手腕关节，个别挥到身体最右侧的瞬间离杖身 3~5 厘米；人形没有手指关节，握杖、拉弦都靠手的位置表现。
- 旋风斩的 `pace` 仍是 1.2，但 v0.4.2 去掉了每个目标处的站定空档（落地停顿、击后停顿、落地缓冲），整套从 v0.4.1 的约 10.3 秒缩短到约 7.4 秒（v0.4 约 6.8 秒）；想更慢就调大 `pace`。
- 跳劈的预备在空中摆出，腾空时间放不下“预备 + 发力”时会自动加长腾空（旋风斩最后一击用一次大跳跃，空中时间约 1 秒，配合慢镜头）。落地和命中按预定的落地时刻对齐，误差不超过一帧。
- 布料飘动只改画面里的顶点，地上的影子不跟着飘（阴影用的是合并后的静态代理）；幅度只有几厘米，战场距离下看不出来。
- 预览页有一盏很强的暖色火光，模型颜色会偏暖（灰狼偏棕、骨龙偏粉）；配色以战场里的冷光为准。
- 窗口很小的时候，左下角的指令面板在选目标时会遮住敌方最左侧的单位；窗口很窄时双方的血条会互相靠得很近（名字仍然不重叠）。
- 启动时所有贴图和模型同步生成，首次进入会有一次短暂的卡顿，没有加载进度条。
- 音效是合成的简单音色，没有做立体声定位；手机浏览器没有专门适配（界面按桌面鼠标操作设计）。
- 固定分辨率按 1:1 物理像素显示（显示大小 = 分辨率 ÷ 设备像素比）：在 150% 缩放的笔记本上选 1280×800 时画面只占约 853×533 个 CSS 像素；想铺满窗口请用“适应窗口”。
- 界面按 1440×900 排版后整体缩放：窗口很小时文字也跟着变小（例如 820 宽的窗口里约为原来的 0.57 倍），不会单独放大字号。
- 设置菜单暂停时只停战斗音效，环境音照常（拖动环境音滑块时要能听到效果）。演示页（`?auto=1`、`?demo=…`、`?preview=1`）没有标题界面和设置菜单，也不固定 16:10，右上角仍是原来的画质按钮和音量滑块（改动同样保存）。
- 游戏名“深渊之战”是暂定的，改 `src/data/uiConfig.ts` 的 `TITLE_CONFIG`。
- 只有一套固定阵容和一张战场，没有存档、关卡、成长系统（不在本期范围内）。

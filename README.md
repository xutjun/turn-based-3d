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
npm run balance    # 批量模拟统计胜率、回合数、技能使用（--seeds=1000 指定场数）
```

### 页面入口（地址参数）

| 地址 | 内容 |
|---|---|
| `/` | 玩家战斗：你给 5 个人物下指令（宝宝可切换自动 / 手动） |
| `/?auto=1` | 自动战斗：双方都由 AI 出手 |
| `/?demo=skills` | 技能演示：每个技能的演出可以单独触发（`&play=whirlwind` 直接播放某一个，`&all=1` 依次全放） |
| `/?demo=1` | 演出样例：一段固定脚本，把各种演出路径演一遍 |
| `/?preview=1` | 模型预览：旋转查看每个角色、宝宝、敌人、武器（`&model=资源键`） |

通用参数：`seed=数字`（固定随机种子，相同种子 + 相同指令 = 完全相同的战斗）、`speed=2`、`skip=1`（跳过动画）、
`pet=auto`（宝宝自动）、`quality=low`（低画质）、`fps=0`（隐藏帧率）、`grid=1`（显示格子坐标）、`merge=0`（关闭网格合并，用来对比优化前后）。

### 操作

- 指令：`A` 攻击、`W` 技能、`D` 防御、`Esc` / 右键 返回；选目标时悬停预览会命中的全部目标，点击确认。
- 右上角：战斗速度 `1×` / `2×`（按键 `1` `2`）、跳过动画（`S`）、画质 高 / 低、音效 开 / 关（`M`）和音量滑块、宝宝指令 自动 / 手动。
- 调试：`G` 格子坐标、`F` 帧率。控制台里 `__perf()` 查看绘制调用等性能数据，`__player` / `__battle` 查看战斗自检数据。
- 头顶平时只显示血条；Boss、正在出手的单位、被选中 / 会被命中的单位、鼠标指着的单位才显示名字。
- 浏览器不允许页面在你操作之前出声：第一次点击或按键之后才有声音。

---

## 2. 架构

```
src/
├─ core/      规则逻辑：回合、伤害、技能、目标、封印、AI。纯 TypeScript，不依赖 three、DOM 和配置表，可单独测试
├─ data/      配置表：技能、职业、人物、敌人、武器、阵型、数值、画面、演出时长、界面、音效。纯数据
├─ assets/    程序化资源：贴图、模型 builder、资源注册表、绘制优化、音效合成（assets/audio）
├─ render/    三维场景：相机、灯光、雾、后处理、单位动画、特效、把逻辑事件变成演出的导演（director）
├─ ui/        DOM 界面：指令面板、目标选择、头顶条、飘字、日志、结算、设置、演示页
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
| 人物、宝宝的气血 / 魔法 / 伤害 / 防御 / 速度、技能 | `data/heroes.ts` |
| 敌人与 Boss 的数值、技能、站位 | `data/enemies.ts` |
| 技能的消耗、倍率、段数、目标数、命中率 | `data/skills.ts` |
| 暴击率与倍率、伤害浮动、法术防御系数、防御减伤 | `data/battleConfig.ts` |
| AI 阈值（多少血以下治疗、多少敌人以上用群体技能） | `data/aiConfig.ts` |
| 阵型间距、两军距离 | `data/formation.ts` |
| 相机（距离、视角、俯角）、灯光、雾、后处理、低画质参数 | `data/renderConfig.ts` |
| 动画时长、镜头推近 / 抖动 / 慢镜头、飘字、粒子上限、冲锋转身 | `data/presentationConfig.ts` |
| 目标光圈、日志行数、头顶名字的显示规则 | `data/uiConfig.ts` |
| 音量、各音效响度、环境音 | `data/audioConfig.ts` |

**调数值后请跑 `npm run balance`。** 它用几百个种子跑完整的自动战斗，输出友方胜率、回合数分布、每个技能的使用次数。
当前目标是胜率 50%~70%、多数战斗 8~14 回合，`tests/regression` 里有一条测试守着这个范围。
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
   `['combo_slash', 'whirlwind', 'heavy_strike']`；宝宝和敌人的技能直接写在 `heroes.ts` / `enemies.ts` 的模板里。

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
| `intensity` | 自发光强度 |
| `breathHz` / `breathDepth` | 呼吸闪烁的频率 / 幅度 |
| `flowSpeed` | 光纹流动速度 |
| `lightIntensity` / `lightDistance` | 武器自带点光源的强度 / 范围 |
| `haloSize` / `haloStrength` | 光晕精灵的大小 / 亮度 |
| `particleCount` | 飘散光粒的数量 |
| `flareBoost` / `flareDecay` | 出手瞬间增强的倍率 / 衰减时间 |

法杖宝珠按元素变色的配色在同一个文件的 `STAFF_ELEMENT_COLORS`。武器的形状参数（长度、弧度等）在 `data/unitModels.ts` 的 `WEAPON_MODELS.params` 里覆盖。
技能演出里武器逐击变亮的倍率在 `data/presentationConfig.ts` 的 `GLOW_FX`。

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
  并用“阴影代理”让阴影那一遍每个部件只画一次。20 个单位的战场每帧约 730 次绘制调用（合并前约 2460 次），外观和动画不变。
  `/?merge=0` 可以关掉合并做对比，控制台 `__perf()` 查看实时数字。
- **低画质**：右上角“画质”按钮或 `?quality=low`——关闭辉光、阴影贴图降到 1024、技能粒子减到 40%、贴地雾片减半、不按高分屏放大分辨率。
  选择会记在浏览器本地存储里。
- 给新模型加了会动的部件（例如给腿加动画）时，把对应关节加到 `render/units/animatedJoints.ts`，否则它下面的网格会被并进上一级而不跟着动。

---

## 7. 设计假设（摘要）

完整内容和理由见 [docs/DESIGN.md §9](docs/DESIGN.md)。其中带 ★ 的几条修改了 SPEC 原文，已经过确认：

- 武器与职业：法杖给法术系，封印系持剑、恢复系持枪，自由职业是持弓的物理系。封印 / 恢复的技能是法术类、原地施放，普攻按武器走近战物理。
- ★ 已被封印的单位不能再被封印（SPEC 原文是“刷新持续回合”）。封印 3 回合，施加的那一回合也计入；命中率 75%。
- ★ 多目标技能的目标 = 主目标 + 其余单位按速度由快到慢补足（SPEC 原文是“按阵型邻近”）。主目标一定被击中且排第一。
- ★ 敌人被击败后消失，不能再被选中；友方倒地后保持倒地，只有复活能选中。敌人没有复活技能。
- 防御从本回合执行阶段一开始就生效，对物理和法术伤害都减半，只持续一回合。
- 物理伤害、法术伤害、治疗都会暴击（默认 10%、1.5 倍）；普攻命中率 95%，技能默认必中。
- 被复活的单位如果在本回合出手顺序里排在施法者之后，本回合还能出手，轮到它时暂停让玩家现场下指令。复活恢复 30% 气血，不恢复魔法。
- 不自动回复魔法；没有回合上限（最低伤害为 1，战斗一定会结束）。
- 三连射、箭雨是连斩、旋风斩的弓箭手版本，群体法术·烈焰是群体法术的火系版本：数值与原技能相同，只是名称、说明、元素不同。
- AI：恢复系先治疗（有人低于 60% 气血），其次复活；封印系优先封印法术 / 恢复职业；其他职业对方 ≥ 3 人时用群体技能，否则用单体技能；都优先打残血。
- 相机俯角 30°（SPEC 建议 35°~45°，按验收意见压低，人物更立体）。

---

## 8. 已知限制

- **帧率没有在真实显卡上测过。** 开发环境只有无显卡的软件渲染，能测的只有绘制调用（约 730）、每帧逻辑耗时（约 1 毫秒）和内存是否增长；
  实际 FPS 请在自己的浏览器里按 `F` 查看，卡顿时切到低画质。
- 不是每一场自动战斗都会出现全部十个技能：AI 优先用群体技能、优先治疗，所以三连射、单体法术、复活只在部分对局里出现
  （复活约每 3 场出现一次）。想单独看某个技能，用 `/?demo=skills`。
- 默认阵容里“复活后本回合还能出手”很少触发：治疗师速度 85，只有魔偶（70）比她慢。
- 人物的腿、手、颈目前没有单独的动画（近战冲锋是整体滑步加小跳），为了减少绘制调用，这些关节下的网格已合并。
- 窗口很小的时候，左下角的指令面板在选目标时会遮住敌方最左侧的单位；窗口很窄时双方的血条会互相靠得很近（名字仍然不重叠）。
- 启动时所有贴图和模型同步生成，首次进入会有一次短暂的卡顿，没有加载进度条。
- 音效是合成的简单音色，没有做立体声定位；手机浏览器没有专门适配（界面按桌面鼠标操作设计）。
- 只有一套固定阵容和一张战场，没有存档、关卡、成长系统（不在本期范围内）。

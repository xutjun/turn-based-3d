// 指令会话：玩家给单位下指令的交互状态机（菜单 → 技能列表 → 选目标 → 提交）。
// 不依赖 DOM 和 three，只通过引擎的公开接口查询和提交，可以直接做单元测试。
//
// 规则判断全部以引擎为准：
// - 技能是否可用、置灰原因：engine.getCommandOptions()
// - 多目标预览：engine.previewTargets()
// - 指令是否合法：engine.submitCommand() 的返回值
// 这里只负责“现在轮到谁、处在哪一步”，以及把拒绝原因翻译成给玩家看的提示。

import { isSealed } from '../../core/status';
import { isValidTarget } from '../../core/targeting';
import type {
  BattleState,
  Command,
  CommandOptions,
  CommandRejectReason,
  SkillDef,
  SkillId,
  SubmitResult,
  Unit,
  UnitId,
} from '../../core/types';

/** 会话用到的引擎接口（BattleEngine 的子集） */
export interface CommandEngine {
  getState(): Readonly<BattleState>;
  getPendingCommandUnits(): UnitId[];
  getCommandOptions(unitId: UnitId): CommandOptions;
  previewTargets(unitId: UnitId, skillId: SkillId, primaryId: UnitId): UnitId[];
  submitCommand(unitId: UnitId, cmd: Command): SubmitResult;
}

/** idle = 当前不需要玩家下指令 */
export type SessionMode = 'idle' | 'menu' | 'skills' | 'target';

export interface Notice {
  kind: 'error' | 'info';
  text: string;
}

export interface SessionHooks {
  /** 会话状态变化（界面据此重画） */
  onChange?(): void;
  /** 给玩家的提示（非法操作等） */
  onNotice?(notice: Notice): void;
}

/** 技能列表里的一行 */
export interface SkillRow {
  skill: SkillDef;
  enabled: boolean;
  disabledReason?: 'noMp' | 'sealed';
}

type PendingAction = { kind: 'attack' } | { kind: 'skill'; skillId: SkillId };

const REJECT_TEXT: Record<CommandRejectReason, string> = {
  wrongPhase: '现在不能下指令',
  unitDead: '该单位已倒地，不能下指令',
  notCommandable: '该单位不由你指挥',
  unknownSkill: '该技能暂时无法使用',
  noMp: '魔法不足，无法使用该技能',
  sealed: '被封印，无法使用技能（仍可攻击或防御）',
  invalidTarget: '目标不合法',
};

/** 把引擎的拒绝原因翻译成提示文字 */
export function rejectText(reason: CommandRejectReason): string {
  return REJECT_TEXT[reason];
}

/** 置灰原因的短标签 */
export function disabledLabel(reason: 'noMp' | 'sealed'): string {
  return reason === 'sealed' ? '被封印' : '魔法不足';
}

/** 某目标对某技能不合法的具体原因；合法时返回 null */
export function invalidTargetText(actor: Unit, skill: SkillDef, target: Unit): string | null {
  if (isValidTarget(actor, skill, target)) return null;
  const sameSide = actor.side === target.side;
  if (skill.targetSide === 'enemy' && sameSide) return `目标不合法：「${skill.name}」只能选择敌方单位`;
  if (skill.targetSide === 'ally' && !sameSide) return `目标不合法：「${skill.name}」只能选择我方单位`;
  if (skill.targetState === 'dead' && target.alive) return `目标不合法：「${skill.name}」只能选择倒地的队友`;
  if (skill.targetState === 'alive' && !target.alive) return `目标不合法：${target.name} 已倒地`;
  if (skill.effect === 'seal') return `目标不合法：${target.name} 已被封印`;
  return '目标不合法';
}

export class CommandSession {
  private currentMode: SessionMode = 'idle';
  private currentUnit: UnitId | null = null;
  private action: PendingAction | null = null;
  private hovered: UnitId | null = null;
  /** 本回合已下过指令的单位（按先后），用于“返回上一个” */
  private history: UnitId[] = [];
  /** 执行阶段里给刚复活的单位现场下指令：只有一个单位，不能返回上一个 */
  private single = false;
  private finish: (() => void) | null = null;

  constructor(
    private readonly engine: CommandEngine,
    private readonly skills: Readonly<Record<SkillId, SkillDef>>,
    private readonly hooks: SessionHooks = {},
  ) {}

  // ------------------------------------------------------------------
  // 开始 / 结束
  // ------------------------------------------------------------------

  /** 指令阶段：依次给所有待指令单位下指令，全部下完时完成 */
  begin(): Promise<void> {
    this.history = [];
    this.single = false;
    return this.open(this.engine.getPendingCommandUnits()[0] ?? null);
  }

  /** 执行阶段：只给一个单位（刚复活、轮到它出手）现场下指令 */
  beginFor(unitId: UnitId): Promise<void> {
    this.history = [];
    this.single = true;
    return this.open(unitId);
  }

  private open(unitId: UnitId | null): Promise<void> {
    this.finish?.();
    this.finish = null;
    if (unitId === null) {
      this.setIdle();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.finish = resolve;
      this.focus(unitId);
    });
  }

  /** 中止会话（战斗被关闭、再战一次时），等待中的 begin() 随之完成 */
  abort(): void {
    const finish = this.finish;
    this.finish = null;
    this.setIdle();
    finish?.();
  }

  /** 设置变化（宝宝自动 / 手动）后重新核对：自动的单位不再需要下指令 */
  refresh(): void {
    if (this.currentMode === 'idle' || this.single) return;
    const state = this.engine.getState();
    const commandable = (id: UnitId): boolean => {
      const u = state.units[id];
      return !!u && u.alive && !u.autoCommand;
    };
    this.history = this.history.filter(commandable);
    if (this.currentUnit !== null && commandable(this.currentUnit)) {
      this.changed();
      return;
    }
    this.advance();
  }

  // ------------------------------------------------------------------
  // 查询（界面用）
  // ------------------------------------------------------------------

  get mode(): SessionMode {
    return this.currentMode;
  }

  /** 当前待下令的单位 */
  get unitId(): UnitId | null {
    return this.currentUnit;
  }

  get unit(): Unit | null {
    return this.currentUnit === null ? null : (this.engine.getState().units[this.currentUnit] ?? null);
  }

  /** 正在选目标的技能（普攻也是一种技能）；不在选目标时为 null */
  get targetingSkill(): SkillDef | null {
    const unit = this.unit;
    if (this.currentMode !== 'target' || !unit || !this.action) return null;
    return this.skillOf(unit, this.action);
  }

  get hoverId(): UnitId | null {
    return this.hovered;
  }

  /** 能否返回（选目标 → 菜单 / 技能列表；菜单 → 上一个单位） */
  get canGoBack(): boolean {
    if (this.currentMode === 'skills' || this.currentMode === 'target') return true;
    return this.currentMode === 'menu' && !this.single && this.history.length > 0;
  }

  /** 进度：第几个 / 共几个 */
  get progress(): { index: number; total: number } {
    if (this.currentMode === 'idle') return { index: 0, total: 0 };
    if (this.single) return { index: 1, total: 1 };
    const pending = this.engine.getPendingCommandUnits();
    const others = pending.filter((id) => id !== this.currentUnit).length;
    return { index: this.history.length + 1, total: this.history.length + 1 + others };
  }

  /** 当前单位的技能列表（含置灰原因） */
  get skillRows(): SkillRow[] {
    if (this.currentUnit === null) return [];
    const rows: SkillRow[] = [];
    for (const opt of this.engine.getCommandOptions(this.currentUnit).skills) {
      const skill = this.skills[opt.skillId];
      if (!skill) continue;
      rows.push(opt.enabled ? { skill, enabled: true } : { skill, enabled: false, disabledReason: opt.disabledReason });
    }
    return rows;
  }

  /** 被封印时技能整体不可用（界面在“技能”按钮上标出来） */
  get sealed(): boolean {
    const unit = this.unit;
    return !!unit && isSealed(unit);
  }

  /** 选目标时所有可以点的单位 */
  get candidates(): UnitId[] {
    const unit = this.unit;
    const skill = this.targetingSkill;
    if (!unit || !skill) return [];
    return this.validTargets(unit, skill);
  }

  /** 鼠标指着某个合法目标时，这次出手会命中的全部目标（主目标在内） */
  get preview(): UnitId[] {
    const unit = this.unit;
    const skill = this.targetingSkill;
    if (!unit || !skill || this.hovered === null) return [];
    return this.engine.previewTargets(unit.id, skill.id, this.hovered);
  }

  // ------------------------------------------------------------------
  // 操作
  // ------------------------------------------------------------------

  /** 选“攻击”：进入选目标 */
  chooseAttack(): void {
    const unit = this.unit;
    if (!unit || this.currentMode === 'idle') return;
    if (!this.engine.getCommandOptions(unit.id).canAttack) {
      this.notify('error', rejectText('unitDead'));
      return;
    }
    this.enterTargeting(unit, { kind: 'attack' });
  }

  /** 选“技能”：打开技能列表 */
  openSkills(): void {
    if (this.currentMode === 'idle') return;
    this.action = null;
    this.hovered = null;
    this.currentMode = 'skills';
    if (this.sealed) this.notify('error', rejectText('sealed'));
    this.changed();
  }

  /** 在技能列表里选一个技能：可用则进入选目标，否则提示原因 */
  chooseSkill(skillId: SkillId): void {
    const unit = this.unit;
    if (!unit || this.currentMode === 'idle') return;
    const row = this.skillRows.find((r) => r.skill.id === skillId);
    if (!row) {
      this.notify('error', rejectText('unknownSkill'));
      return;
    }
    if (!row.enabled) {
      this.notify(
        'error',
        row.disabledReason === 'sealed'
          ? rejectText('sealed')
          : `魔法不足：「${row.skill.name}」需要 ${row.skill.mpCost} 点魔法，当前只有 ${unit.mp} 点`,
      );
      return;
    }
    this.enterTargeting(unit, { kind: 'skill', skillId });
  }

  /** 选“防御”：直接提交 */
  chooseDefend(): void {
    if (this.currentUnit === null || this.currentMode === 'idle') return;
    this.submit({ kind: 'defend' });
  }

  /** 返回上一步；在菜单里则回到上一个已下令的单位重新下令 */
  back(): void {
    if (this.currentMode === 'target') {
      const fromSkill = this.action?.kind === 'skill';
      this.action = null;
      this.hovered = null;
      this.currentMode = fromSkill ? 'skills' : 'menu';
      this.changed();
    } else if (this.currentMode === 'skills') {
      this.currentMode = 'menu';
      this.changed();
    } else if (this.currentMode === 'menu' && !this.single && this.history.length > 0) {
      this.focus(this.history.pop()!);
    }
  }

  /** 鼠标指向某单位（null = 没有指着任何单位）。只有合法目标才会被记为悬停 */
  hover(id: UnitId | null): void {
    let next: UnitId | null = null;
    if (id !== null && this.currentMode === 'target' && this.candidates.includes(id)) next = id;
    if (next === this.hovered) return;
    this.hovered = next;
    this.changed();
  }

  /** 点击确认目标。目标不合法时给出提示并留在选目标状态 */
  confirmTarget(id: UnitId): boolean {
    const unit = this.unit;
    const skill = this.targetingSkill;
    if (!unit || !skill || !this.action) return false;
    const target = this.engine.getState().units[id];
    if (!target) {
      this.notify('error', rejectText('invalidTarget'));
      return false;
    }
    const invalid = invalidTargetText(unit, skill, target);
    if (invalid) {
      this.notify('error', invalid);
      return false;
    }
    const cmd: Command =
      this.action.kind === 'attack'
        ? { kind: 'attack', targetId: id }
        : { kind: 'skill', skillId: this.action.skillId, targetId: id };
    return this.submit(cmd);
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  private skillOf(unit: Unit, action: PendingAction): SkillDef | null {
    const id = action.kind === 'attack' ? unit.basicAttackSkillId : action.skillId;
    return this.skills[id] ?? null;
  }

  private validTargets(unit: Unit, skill: SkillDef): UnitId[] {
    const state = this.engine.getState();
    return state.unitIds.filter((id) => isValidTarget(unit, skill, state.units[id]!));
  }

  private enterTargeting(unit: Unit, action: PendingAction): void {
    const skill = this.skillOf(unit, action);
    if (!skill) {
      this.notify('error', rejectText('unknownSkill'));
      return;
    }
    if (this.validTargets(unit, skill).length === 0) {
      this.notify(
        'error',
        skill.targetState === 'dead' ? `没有可选目标：「${skill.name}」只能选择倒地的队友` : `没有可选目标：「${skill.name}」`,
      );
      return;
    }
    this.action = action;
    this.hovered = null;
    this.currentMode = 'target';
    this.changed();
  }

  /** 提交指令；被引擎拒绝时提示原因，不改变引擎状态 */
  private submit(cmd: Command): boolean {
    const unitId = this.currentUnit;
    if (unitId === null) return false;
    const result = this.engine.submitCommand(unitId, cmd);
    if (!result.ok) {
      this.notify('error', rejectText(result.reason));
      // 技能本身已不可用（魔法不足 / 被封印）：退回技能列表，让玩家改选
      if (result.reason === 'noMp' || result.reason === 'sealed' || result.reason === 'unknownSkill') {
        this.action = null;
        this.hovered = null;
        this.currentMode = 'skills';
      }
      this.changed();
      return false;
    }
    if (this.single) {
      this.complete();
      return true;
    }
    this.history = this.history.filter((id) => id !== unitId);
    this.history.push(unitId);
    this.advance();
    return true;
  }

  /** 轮到下一个还没下指令的单位；没有了就结束会话 */
  private advance(): void {
    const next = this.engine.getPendingCommandUnits()[0];
    if (next === undefined) this.complete();
    else this.focus(next);
  }

  private focus(unitId: UnitId): void {
    this.currentUnit = unitId;
    this.action = null;
    this.hovered = null;
    this.currentMode = 'menu';
    this.changed();
  }

  private complete(): void {
    const finish = this.finish;
    this.finish = null;
    this.setIdle();
    finish?.();
  }

  private setIdle(): void {
    this.currentMode = 'idle';
    this.currentUnit = null;
    this.action = null;
    this.hovered = null;
    this.changed();
  }

  private changed(): void {
    this.hooks.onChange?.();
  }

  private notify(kind: Notice['kind'], text: string): void {
    this.hooks.onNotice?.({ kind, text });
  }
}

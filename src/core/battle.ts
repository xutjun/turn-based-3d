// 战斗引擎：回合状态机与对外接口（对应 DESIGN.md §3.1、§3.2、§8）。
//
// 引擎是同步、按步推进的：stepAction() 一次只结算一个单位的一次出手，
// 所以任意时刻只有一个单位在行动。所有结果通过事件发出，引擎不操作任何画面。

import { decideCommand, pickAiTarget, type AiContext } from './ai';
import { getCommandOptions, validateCommand, type SkillTable } from './commands';
import { EventBus, type BattleEvent, type BattleEventInput, type UnitSnapshot } from './events';
import { rollExtraHits, type PassiveTable } from './passives';
import { createRng, type Rng } from './rng';
import {
  executeSkill,
  resolveAnimation,
  resolveDelivery,
  type ExecContext,
} from './skillExecutor';
import { isSealed, tickStatuses } from './status';
import { isValidTarget, pickRetarget, resolveTargets } from './targeting';
import { buildTurnOrder } from './turnOrder';
import type {
  AiConfig,
  BattleConfig,
  BattleSettings,
  BattleSetup,
  BattleState,
  Command,
  CommandOptions,
  SkillDef,
  SkillId,
  SubmitResult,
  Unit,
  UnitId,
} from './types';

export interface BattleEngineOptions {
  /** 注入自定义随机数发生器（测试用）；不传则用 setup.seed 创建 */
  rng?: Rng;
  /** 注入 AI 选目标用的随机数发生器（测试用）；不传则由 setup.seed 派生 */
  aiRng?: Rng;
}

/** 深拷贝一个单位，避免引擎修改调用方传入的对象 */
function cloneUnit(u: Unit): Unit {
  return {
    ...u,
    slot: { ...u.slot },
    stats: { ...u.stats },
    skillIds: [...u.skillIds],
    passiveIds: [...(u.passiveIds ?? [])],
    statuses: u.statuses.map((s) => ({ ...s })),
  };
}

function emptyTargetCounts(): BattleState['aiTargetCounts'] {
  return {
    ally: { attack: {}, seal: {}, heal: {} },
    enemy: { attack: {}, seal: {}, heal: {} },
  };
}

function snapshot(u: Unit): UnitSnapshot {
  return {
    id: u.id,
    templateId: u.templateId,
    name: u.name,
    side: u.side,
    kind: u.kind,
    classId: u.classId,
    rank: u.rank,
    slot: { ...u.slot },
    weaponId: u.weaponId,
    attackMode: u.attackMode,
    stats: { ...u.stats },
    hp: u.hp,
    mp: u.mp,
  };
}

export class BattleEngine {
  readonly events = new EventBus();

  private readonly state: BattleState;
  private readonly config: BattleConfig;
  private readonly skills: SkillTable;
  private readonly ai: AiConfig;
  private readonly passives: PassiveTable;
  private readonly rng: Rng;
  /** AI 选目标专用的随机序列：与伤害 / 命中 / 暴击 / 同速排序分开，AI 抽多少次都不影响战斗结算 */
  private readonly aiRng: Rng;
  /** stepAction() 执行期间收集本次发出的事件 */
  private buffer: BattleEvent[] | null = null;

  constructor(setup: BattleSetup, options: BattleEngineOptions = {}) {
    this.config = setup.config;
    this.skills = setup.skills;
    this.ai = setup.ai;
    this.passives = setup.passives ?? {};
    this.rng = options.rng ?? createRng(setup.seed);
    this.aiRng = options.aiRng ?? createRng((setup.seed ^ 0x9e3779b9) >>> 0);

    const units: Record<UnitId, Unit> = {};
    const unitIds: UnitId[] = [];
    for (const src of setup.units) {
      if (units[src.id]) throw new Error(`单位 id 重复：${src.id}`);
      for (const skillId of [src.basicAttackSkillId, ...src.skillIds]) {
        if (!this.skills[skillId]) throw new Error(`单位 ${src.id} 引用了不存在的技能：${skillId}`);
      }
      units[src.id] = cloneUnit(src);
      for (const pid of units[src.id]!.passiveIds) {
        if (!this.passives[pid]) throw new Error(`单位 ${src.id} 引用了不存在的被动技能：${pid}`);
      }
      unitIds.push(src.id);
    }

    this.state = {
      turn: 0,
      phase: 'init',
      units,
      unitIds,
      turnOrder: [],
      actionCursor: 0,
      lateQueue: [],
      actedThisTurn: [],
      aiTargetCounts: emptyTargetCounts(),
      commands: {},
      awaitingCommandFor: null,
      winner: null,
      settings: { ...setup.settings },
      eventSeq: 0,
    };
  }

  // ------------------------------------------------------------------
  // 查询
  // ------------------------------------------------------------------

  /** 只读状态快照，供界面判断按钮状态；不要修改返回的对象 */
  getState(): Readonly<BattleState> {
    return this.state;
  }

  /** 本回合还没有下指令的单位（按指令顺序），跳过倒地和自动出手的单位 */
  getPendingCommandUnits(): UnitId[] {
    if (this.state.phase !== 'command') return [];
    return this.listCommandableUnits().filter((id) => this.state.commands[id] === undefined);
  }

  /** 某单位可用的指令/技能，以及置灰原因 */
  getCommandOptions(unitId: UnitId): CommandOptions {
    return getCommandOptions(this.state, this.skills, unitId);
  }

  /**
   * 某技能以某主目标出手时会命中的全部目标（界面预览用），与执行时用的是同一个函数。
   * 主目标不合法时返回空数组。
   */
  previewTargets(unitId: UnitId, skillId: SkillId, primaryId: UnitId): UnitId[] {
    const unit = this.state.units[unitId];
    const skill = this.skills[skillId];
    if (!unit || !skill) return [];
    return resolveTargets(this.state, unit, skill, primaryId);
  }

  /** 按 AI 规则给出该单位的建议指令（自动战斗、命令行模拟用） */
  suggestCommand(unitId: UnitId): Command {
    if (!this.state.units[unitId]) throw new Error(`单位不存在：${unitId}`);
    return decideCommand(this.aiContext(), unitId);
  }

  // ------------------------------------------------------------------
  // 流程控制
  // ------------------------------------------------------------------

  /** 开始战斗：发出 BattleStart，进入第 1 回合的指令阶段 */
  start(): void {
    if (this.state.phase !== 'init') throw new Error('战斗已经开始，不能重复调用 start()');
    this.emit({
      type: 'BattleStart',
      units: this.state.unitIds.map((id) => snapshot(this.state.units[id]!)),
    });
    if (this.checkBattleEnd()) return;
    this.startTurn();
  }

  /**
   * 提交指令。
   * 指令阶段：给任意待指令单位下指令，可重复提交覆盖。
   * 执行阶段：只接受 awaitingCommandFor 指向的单位（刚复活、轮到它出手的单位现场下指令）。
   */
  submitCommand(unitId: UnitId, cmd: Command): SubmitResult {
    const { state } = this;
    const awaiting = state.phase === 'execution' && state.awaitingCommandFor === unitId;
    if (state.phase !== 'command' && !awaiting) return { ok: false, reason: 'wrongPhase' };

    const unit = state.units[unitId];
    if (!unit) return { ok: false, reason: 'notCommandable' };
    if (!unit.alive) return { ok: false, reason: 'unitDead' };
    if (unit.autoCommand) return { ok: false, reason: 'notCommandable' };

    const reason = validateCommand(state, this.skills, unit, cmd);
    if (reason) return { ok: false, reason };

    state.commands[unitId] = { ...cmd };
    if (awaiting) state.awaitingCommandFor = null;
    return { ok: true };
  }

  /** 结束指令阶段：AI 为自动单位补指令，防御立即生效，进入执行阶段 */
  beginExecution(): void {
    const { state } = this;
    if (state.phase !== 'command') throw new Error('只有指令阶段才能调用 beginExecution()');
    const pending = this.getPendingCommandUnits();
    if (pending.length > 0) throw new Error(`还有单位没有下指令：${pending.join(', ')}`);

    // 自动单位（敌方、自动宝宝）由 AI 决定指令
    // 按本回合出手顺序逐个决定：顺序固定，带随机的选目标才可复现
    for (const id of state.turnOrder) {
      const u = state.units[id]!;
      if (u.alive && u.autoCommand) {
        state.commands[id] = decideCommand(this.aiContext(), id);
      }
    }

    state.phase = 'execution';
    state.actionCursor = 0;
    this.emit({
      type: 'ExecutionPhaseStart',
      commands: { ...(state.commands as Record<UnitId, Command>) },
    });

    // 防御从执行阶段一开始就生效，持续到本回合结束
    for (const id of state.turnOrder) {
      const u = state.units[id]!;
      if (u.alive && state.commands[id]?.kind === 'defend') {
        u.defending = true;
        this.emit({ type: 'DefendApplied', unitId: id });
      }
    }
  }

  /**
   * 执行下一个单位的一次出手，返回这次出手发出的全部事件。
   * 最后一个单位出手后，同一次返回值里会附带回合结算和下一回合开始的事件。
   * 轮到本回合刚被复活、还没有指令的手动单位时，只发出 CommandRequested 并暂停，等 submitCommand()。
   * 战斗已结束时返回 null。
   */
  stepAction(): BattleEvent[] | null {
    const { state } = this;
    if (state.phase === 'ended') return null;
    if (state.phase !== 'execution') throw new Error('只有执行阶段才能调用 stepAction()');
    if (state.awaitingCommandFor !== null) {
      throw new Error(`正在等待 ${state.awaitingCommandFor} 的指令，不能继续执行`);
    }

    const collected: BattleEvent[] = [];
    this.buffer = collected;
    try {
      const next = this.peekNextActor();
      if (!next) {
        this.settleTurn();
      } else {
        const { actor } = next;
        if (state.commands[actor.id] === undefined && !actor.autoCommand) {
          // 本回合被复活的手动单位：倒地时没有指令（或指令已作废），暂停等玩家现场下指令
          if (next.index !== -1) state.actionCursor = next.index;
          state.awaitingCommandFor = actor.id;
          this.emit({ type: 'CommandRequested', unitId: actor.id });
          return collected;
        }
        // 出手顺序里的单位推进游标；队尾补出手的单位从队列里取出
        if (next.index !== -1) state.actionCursor = next.index + 1;
        else state.lateQueue.shift();
        state.actedThisTurn.push(actor.id);
        this.performAction(actor);
        // 每次出手后做胜负判定；没有剩余出手者时进入结算
        if (!this.checkBattleEnd() && !this.peekNextActor()) {
          this.settleTurn();
        }
      }
    } finally {
      this.buffer = null;
    }
    return collected;
  }

  /** 修改设置，只能在指令阶段调用 */
  setSettings(patch: Partial<BattleSettings>): void {
    const { state } = this;
    if (state.phase !== 'command') throw new Error('只有指令阶段才能修改设置');
    Object.assign(state.settings, patch);
    for (const id of state.unitIds) {
      const u = state.units[id]!;
      if (u.side !== 'ally' || u.kind !== 'pet') continue;
      u.autoCommand = state.settings.petAutoCommand;
      // 改为自动后，已提交的手动指令作废，由 AI 决定
      if (u.autoCommand) delete state.commands[id];
    }
  }

  // ------------------------------------------------------------------
  // 内部实现
  // ------------------------------------------------------------------

  private emit(input: BattleEventInput): void {
    this.state.eventSeq += 1;
    const event = { ...input, seq: this.state.eventSeq, turn: this.state.turn } as BattleEvent;
    this.buffer?.push(event);
    this.events.emit(event);
  }

  private aiContext(): AiContext {
    return { state: this.state, skills: this.skills, ai: this.ai, rng: this.aiRng };
  }

  private execContext(): ExecContext {
    return {
      state: this.state,
      config: this.config,
      rng: this.rng,
      emit: (e) => this.emit(e),
    };
  }

  /**
   * 需要玩家（或测试）下指令的单位，按指令顺序：
   * 人物 → 该人物的宝宝 → 下一个人物 …（按列从左到右），最后是其余非自动单位。
   */
  private listCommandableUnits(): UnitId[] {
    const { state } = this;
    const ordered: UnitId[] = [];
    const heroes = state.unitIds
      .map((id) => state.units[id]!)
      .filter((u) => u.side === 'ally' && u.kind === 'hero')
      .sort((a, b) => a.slot.col - b.slot.col);
    for (const h of heroes) {
      ordered.push(h.id);
      if (h.petId !== undefined && state.units[h.petId]) ordered.push(h.petId);
    }
    for (const id of state.unitIds) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered.filter((id) => {
      const u = state.units[id]!;
      return u.alive && !u.autoCommand;
    });
  }

  /** 回合开始：回合号加一，按速度重新排序，进入指令阶段 */
  private startTurn(): void {
    const { state } = this;
    state.turn += 1;
    state.turnOrder = buildTurnOrder(
      state.unitIds.map((id) => state.units[id]!),
      this.rng,
    );
    state.actionCursor = 0;
    state.lateQueue = [];
    state.actedThisTurn = [];
    state.aiTargetCounts = emptyTargetCounts();
    state.commands = {};
    state.awaitingCommandFor = null;
    state.phase = 'command';
    this.emit({ type: 'TurnStart', turnOrder: [...state.turnOrder] });
    this.emit({ type: 'CommandPhaseStart', pending: this.listCommandableUnits() });
  }

  /**
   * 下一个出手者（不改变游标）：先找 turnOrder 里游标之后仍然存活的单位；
   * 出手顺序走完后，再取队尾补出手队列（本回合被复活、速度位置已过的单位）。
   * index 是它在 turnOrder 中的下标，来自队尾队列时为 -1。没有则返回 null。
   */
  private peekNextActor(): { actor: Unit; index: number } | null {
    const { state } = this;
    for (let i = state.actionCursor; i < state.turnOrder.length; i++) {
      const u = state.units[state.turnOrder[i]!]!;
      if (u.alive) return { actor: u, index: i };
    }
    // 队列里又倒地的单位直接移出（再次被复活时会重新入队）
    while (state.lateQueue.length > 0) {
      const u = state.units[state.lateQueue[0]!]!;
      if (u.alive) return { actor: u, index: -1 };
      state.lateQueue.shift();
    }
    return null;
  }

  /**
   * 主目标失效时重选（DESIGN §6.5）：
   * 玩家的指令和 focus 一方的 AI 按速度顺序取第一个合法目标；
   * spread 一方的 AI 按权重随机并计入被选次数，否则失效的攻击会全部落到同一个单位身上。
   */
  private retarget(actor: Unit, skill: SkillDef): UnitId | null {
    if (actor.autoCommand && this.ai.targetMode[actor.side] === 'spread') {
      return pickAiTarget(this.aiContext(), actor, skill);
    }
    return pickRetarget(this.state, actor, skill);
  }

  /** 一个单位的一次出手 */
  private performAction(actor: Unit): void {
    const { state } = this;
    // 正常情况下每个存活单位都有指令；本回合被复活的自动单位没有，由 AI 现场决定
    const cmd = state.commands[actor.id] ?? decideCommand(this.aiContext(), actor.id);
    this.emit({ type: 'UnitActStart', actorId: actor.id, command: { ...cmd } });

    if (cmd.kind === 'defend') {
      // 防御已在执行阶段开始时生效，这里不做其他事
      this.emit({ type: 'UnitActEnd', actorId: actor.id });
      return;
    }

    const basic = this.skills[actor.basicAttackSkillId]!;
    let skill: SkillDef = basic;
    if (cmd.kind === 'skill') {
      skill = this.skills[cmd.skillId]!;
      // 出手时再检查一次：被封印或魔法不足则改为普攻
      const reason = isSealed(actor) ? 'sealed' : actor.mp < skill.mpCost ? 'noMp' : null;
      if (reason) {
        this.emit({
          type: 'CommandFallback',
          actorId: actor.id,
          fromSkillId: skill.id,
          toSkillId: basic.id,
          reason,
        });
        skill = basic;
      }
    }

    // 目标在出手开始时重新校验：失效则重选，复活不重选
    let primary = state.units[cmd.targetId];
    if (!primary || !isValidTarget(actor, skill, primary)) {
      const nextId = skill.effect === 'revive' ? null : this.retarget(actor, skill);
      if (nextId === null) {
        // 没有任何合法目标：本次出手作废，不扣魔法
        this.emit({
          type: 'ActionFizzled',
          actorId: actor.id,
          skillId: skill.id,
          reason: 'noValidTarget',
        });
        this.emit({ type: 'UnitActEnd', actorId: actor.id });
        return;
      }
      this.emit({
        type: 'TargetRetargeted',
        actorId: actor.id,
        fromId: cmd.targetId,
        toId: nextId,
      });
      primary = state.units[nextId]!;
    }

    // 按主目标补足全部目标；魔法在出手瞬间一次性扣除（多段、多目标也只扣一次）
    const targets = resolveTargets(state, actor, skill, primary.id);
    const delivery = resolveDelivery(skill, actor);
    const mpBefore = actor.mp;
    actor.mp = mpBefore - skill.mpCost;
    this.emit({
      type: 'SkillCast',
      actorId: actor.id,
      skillId: skill.id,
      delivery,
      animation: resolveAnimation(skill, delivery),
      meleeCharge: skill.meleeCharge && delivery === 'melee',
      element: skill.element,
      targets: [...targets],
      mpCost: skill.mpCost,
      mpBefore,
      mpAfter: actor.mp,
    });

    // 被动技能：用普攻出手时（包括技能被改成普攻）判定连击，追加的攻击紧接着打同一目标
    const extra =
      skill.id === actor.basicAttackSkillId
        ? rollExtraHits(this.passives, actor, 'basicAttack', this.rng)
        : null;
    executeSkill(this.execContext(), actor, skill, targets, extra);
    this.emit({ type: 'UnitActEnd', actorId: actor.id });
  }

  /** 回合结算：状态递减，清除防御，发出 TurnEnd，进入下一回合 */
  private settleTurn(): void {
    const { state } = this;
    state.phase = 'settlement';
    // 状态（封印）剩余回合递减，到期解除
    tickStatuses(
      state.unitIds.map((id) => state.units[id]!),
      (e) => this.emit(e),
    );
    for (const id of state.unitIds) state.units[id]!.defending = false;
    this.emit({ type: 'TurnEnd' });
    if (this.checkBattleEnd()) return;
    this.startTurn();
  }

  /** 胜负判定：任一方没有存活单位则战斗结束。返回战斗是否已结束。 */
  private checkBattleEnd(): boolean {
    const { state } = this;
    if (state.phase === 'ended') return true;
    let allyAlive = false;
    let enemyAlive = false;
    for (const id of state.unitIds) {
      const u = state.units[id]!;
      if (!u.alive) continue;
      if (u.side === 'ally') allyAlive = true;
      else enemyAlive = true;
    }
    if (allyAlive && enemyAlive) return false;
    state.winner = allyAlive ? 'ally' : 'enemy';
    state.phase = 'ended';
    state.awaitingCommandFor = null;
    this.emit({ type: 'BattleEnd', winner: state.winner, turns: state.turn });
    return true;
  }
}

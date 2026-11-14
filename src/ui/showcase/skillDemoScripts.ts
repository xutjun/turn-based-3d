// 技能演示模式（?demo=skills）的事件脚本：每个演示是一次出手的事件序列，可以单独触发。
//
// 说明：逻辑层目前只结算普攻，连斩、旋风斩、群体法术、封印、治疗、复活的结算属于步骤 2。
// 这里用 core/events.ts 已经定义好的事件格式手工编排，喂给和正式战斗同一个 BattleDirector，
// 所以这里看到的演出，就是这些技能的事件在正式战斗里出现时的演出。
// 伤害数值是演示数据，不代表任何规则或公式；技能名、消耗取自 DESIGN.md §4.2。

import type { BattleEventInput, UnitSnapshot } from '../../core/events';
import type { AnimType, Delivery, Element, SkillId, UnitId } from '../../core/types';

/** 演示里用到的技能：显示名与消耗（DESIGN §4.2） */
export const DEMO_SKILLS: Record<SkillId, { name: string; mpCost: number }> = {
  basic_physical: { name: '普攻', mpCost: 0 },
  basic_magic: { name: '法术普攻', mpCost: 0 },
  combo_slash: { name: '连斩', mpCost: 40 },
  triple_shot: { name: '三连射', mpCost: 40 },
  whirlwind: { name: '旋风斩', mpCost: 80 },
  arrow_rain: { name: '箭雨', mpCost: 80 },
  group_spell: { name: '群体法术·天雷', mpCost: 80 },
  group_spell_fire: { name: '群体法术·烈焰', mpCost: 80 },
  single_spell: { name: '单体法术·炎爆', mpCost: 50 },
  seal: { name: '封印', mpCost: 60 },
  group_heal: { name: '群体治疗', mpCost: 80 },
  revive: { name: '复活', mpCost: 120 },
};

export interface SkillDemo {
  id: string; // 地址参数 play=<id> 用
  group: string; // 按钮分组
  label: string;
  note: string; // 这个演示要看什么
  /** 铺垫事件：在跳过动画的状态下瞬间演完（例如先让某个队友倒地） */
  setup: BattleEventInput[];
  /** 正式演示的事件 */
  events: BattleEventInput[];
}

interface HitOpts {
  crit?: boolean;
  miss?: boolean;
  magic?: boolean;
}

/** 编排一段事件：自己记着气血和魔法，保证 hpBefore / hpAfter 前后连续 */
class Script {
  readonly events: BattleEventInput[] = [];
  private actor: UnitId = '';
  private skill: SkillId = '';
  private stepCount = 1;
  private hitCount = 1;

  constructor(
    private readonly units: ReadonlyMap<UnitId, UnitSnapshot>,
    private readonly hp: Map<UnitId, number>,
    private readonly mp: Map<UnitId, number>,
  ) {}

  /** 开始一次出手并施放技能 */
  cast(
    actorId: UnitId,
    skillId: SkillId,
    delivery: Delivery,
    animation: AnimType,
    targets: UnitId[],
    opts: { element?: Element; stepCount?: number; hitCount?: number } = {},
  ): this {
    const cost = DEMO_SKILLS[skillId]?.mpCost ?? 0;
    const before = this.mp.get(actorId)!;
    this.actor = actorId;
    this.skill = skillId;
    this.stepCount = opts.stepCount ?? 1;
    this.hitCount = opts.hitCount ?? 1;
    this.mp.set(actorId, before - cost);
    this.events.push(
      { type: 'UnitActStart', actorId, command: { kind: 'skill', skillId, targetId: targets[0]! } },
      {
        type: 'SkillCast',
        actorId,
        skillId,
        delivery,
        animation,
        meleeCharge: delivery === 'melee',
        element: opts.element ?? 'none',
        targets,
        mpCost: cost,
        mpBefore: before,
        mpAfter: before - cost,
      },
    );
    return this;
  }

  /** 一段伤害；返回目标是否被打死 */
  hit(targetId: UnitId, step: number, damage: number, opts: HitOpts = {}, hitIndex = 0): boolean {
    const before = this.hp.get(targetId)!;
    const dealt = opts.miss ? 0 : Math.min(before, damage);
    const after = before - dealt;
    this.hp.set(targetId, after);
    const killed = !opts.miss && after === 0;
    this.events.push({
      type: 'HitResolved',
      actorId: this.actor,
      targetId,
      skillId: this.skill,
      stepIndex: step,
      stepCount: this.stepCount,
      hitIndex,
      hitCount: this.hitCount,
      damageType: opts.magic ? 'magic' : 'physical',
      isMiss: opts.miss ?? false,
      isCrit: opts.crit ?? false,
      defended: false,
      damage: dealt,
      hpBefore: before,
      hpAfter: after,
      killed,
    });
    return killed;
  }

  die(unitId: UnitId): this {
    this.events.push({ type: 'UnitDied', unitId, killerId: this.actor, vanish: this.units.get(unitId)!.side === 'enemy' });
    return this;
  }

  /** 打一段并在致死时立刻发出死亡（多段 / 依次攻击的技能用） */
  strike(targetId: UnitId, step: number, damage: number, opts: HitOpts = {}, hitIndex = 0): boolean {
    const killed = this.hit(targetId, step, damage, opts, hitIndex);
    if (killed) this.die(targetId);
    return killed;
  }

  heal(targetId: UnitId, amount: number, crit = false): this {
    const before = this.hp.get(targetId)!;
    const after = Math.min(this.units.get(targetId)!.stats.maxHp, before + amount);
    this.hp.set(targetId, after);
    this.events.push({
      type: 'HealResolved',
      actorId: this.actor,
      targetId,
      skillId: this.skill,
      stepIndex: 0,
      stepCount: 1,
      isCrit: crit,
      amount: after - before,
      hpBefore: before,
      hpAfter: after,
    });
    return this;
  }

  push(e: BattleEventInput): this {
    this.events.push(e);
    return this;
  }

  revive(targetId: UnitId, ratio: number): this {
    const maxHp = this.units.get(targetId)!.stats.maxHp;
    const after = Math.max(1, Math.floor(maxHp * ratio));
    this.hp.set(targetId, after);
    return this.push({ type: 'UnitRevived', unitId: targetId, actorId: this.actor, hpAfter: after, maxHp, actsThisTurn: false });
  }

  end(): this {
    return this.push({ type: 'UnitActEnd', actorId: this.actor });
  }
}

/**
 * 生成全部演示。需要默认阵容：A0 弓手、A1 刀客、A2 法师、A3 封印师、A4 治疗师、A5~A9 宝宝；E0~E9 敌人（E7 为 Boss）。
 * 每个演示都从满状态的战场开始，互不影响。
 */
export function buildSkillDemos(units: readonly UnitSnapshot[]): SkillDemo[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  for (const id of ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A7', 'E0', 'E7', 'E9']) {
    if (!byId.has(id)) throw new Error(`技能演示需要单位 ${id}`);
  }
  const demos: SkillDemo[] = [];
  const add = (
    id: string,
    group: string,
    label: string,
    note: string,
    build: (main: Script, setup: Script) => void,
  ): void => {
    const hp = new Map(units.map((u) => [u.id, u.hp]));
    const mp = new Map(units.map((u) => [u.id, u.mp]));
    const setup = new Script(byId, hp, mp);
    const main = new Script(byId, hp, mp);
    build(main, setup);
    demos.push({ id, group, label, note, setup: setup.events, events: main.events });
  };
  // 旋风斩 / 箭雨的 7 个目标：主目标在前，其余按速度由快到慢（DESIGN §6.3）
  const SEVEN = ['E2', 'E5', 'E6', 'E9', 'E4', 'E3', 'E1'];
  const SIX = ['E7', 'E5', 'E6', 'E9', 'E4', 'E3'];

  // ---------------- 物理系 ----------------
  add('combo', '物理系', '连斩', '3 击轨迹各不相同，武器越来越亮，第 3 击跃起重劈、抖动和顿帧更大', (s) => {
    s.cast('A1', 'combo_slash', 'melee', 'comboSlash', ['E2'], { stepCount: 3, hitCount: 3 });
    s.strike('E2', 0, 92, {}, 0);
    s.strike('E2', 1, 141, { crit: true }, 1);
    s.strike('E2', 2, 104, {}, 2);
    s.end();
  });
  add('combo_kill', '物理系', '连斩·中途击杀', '第 2 击打死目标，第 3 击取消，直接跑回', (s) => {
    s.cast('A1', 'combo_slash', 'melee', 'comboSlash', ['E0'], { stepCount: 3, hitCount: 3 });
    s.strike('E0', 0, 340, {}, 0);
    s.strike('E0', 1, 9999, {}, 1);
    s.end();
  });
  add('combo_pet', '物理系', '连斩·影狼', '没有武器的宝宝：同样 3 种扑击轨迹', (s) => {
    s.cast('A5', 'combo_slash', 'melee', 'comboSlash', ['E1'], { stepCount: 3, hitCount: 3 });
    s.strike('E1', 0, 71, {}, 0);
    s.strike('E1', 1, 66, {}, 1);
    s.strike('E1', 2, 108, { crit: true }, 2);
    s.end();
  });
  add('whirlwind', '物理系', '旋风斩 ×7', '连环突进切入 7 个目标，拖尾光轨，镜头跟随，最后一击慢镜头', (s) => {
    s.cast('A1', 'whirlwind', 'melee', 'whirlwind', SEVEN, { stepCount: 7 });
    const dmg = [88, 131, 126, 122, 9999, 118, 171];
    SEVEN.forEach((id, i) => s.strike(id, i, dmg[i]!, { crit: i === 6 }));
    s.end();
  });
  add('whirlwind_few', '物理系', '旋风斩·目标不足', '场上只剩 3 个敌人：只打 3 个', (s, setup) => {
    // 铺垫：先清掉 7 个敌人
    setup.cast('A2', 'group_spell', 'cast', 'groupSpell', ['E0', 'E1', 'E3', 'E4', 'E5', 'E6', 'E9'], { element: 'thunder' });
    const gone = ['E0', 'E1', 'E3', 'E4', 'E5', 'E6', 'E9'];
    for (const id of gone) setup.hit(id, 0, 9999, { magic: true });
    for (const id of gone) setup.die(id);
    setup.end();
    const three = ['E2', 'E8', 'E7'];
    s.cast('A1', 'whirlwind', 'melee', 'whirlwind', three, { stepCount: 3 });
    s.strike('E2', 0, 95);
    s.strike('E8', 1, 0, { miss: true });
    s.strike('E7', 2, 74);
    s.end();
  });
  add('whirlwind_boss', '物理系', '旋风斩·Boss', '敌方 Boss 对我方 7 人施放', (s) => {
    const targets = ['A2', 'A3', 'A8', 'A0', 'A5', 'A6', 'A1'];
    s.cast('E7', 'whirlwind', 'melee', 'whirlwind', targets, { stepCount: 7 });
    const dmg = [141, 122, 9999, 133, 128, 124, 96];
    targets.forEach((id, i) => s.strike(id, i, dmg[i]!));
    s.end();
  });
  add('triple_shot', '物理系', '三连射', '弓箭手版连斩：原地连射 3 箭', (s) => {
    s.cast('A0', 'triple_shot', 'ranged', 'tripleShot', ['E6'], { stepCount: 3, hitCount: 3 });
    s.strike('E6', 0, 58, {}, 0);
    s.strike('E6', 1, 0, { miss: true }, 1);
    s.strike('E6', 2, 93, { crit: true }, 2);
    s.end();
  });
  add('arrow_rain', '物理系', '箭雨 ×7', '原地拉满弓射向天空，7 道光箭依次落下，落点有光圈和火花', (s) => {
    s.cast('A0', 'arrow_rain', 'ranged', 'arrowRain', SEVEN, { stepCount: 7 });
    const dmg = [41, 66, 71, 0, 9999, 68, 99];
    SEVEN.forEach((id, i) => s.strike(id, i, dmg[i]!, { miss: i === 3, crit: i === 6 }));
    s.end();
  });

  // ---------------- 法术系 ----------------
  add('group_spell', '法术系', '群体法术·天雷 ×6', '蓄力时宝珠光芒暴涨、地面符文阵；6 个目标同一帧落雷，6 个飘字同时出现', (s) => {
    s.cast('A2', 'group_spell', 'cast', 'groupSpell', SIX, { element: 'thunder' });
    const dmg = [96, 118, 121, 174, 9999, 9999];
    const dead = SIX.filter((id, i) => s.hit(id, 0, dmg[i]!, { magic: true, crit: i === 3 }));
    for (const id of dead) s.die(id);
    s.end();
  });
  add('group_spell_fire', '法术系', '群体法术·烈焰', '骨龙幼崽施放的火系版本：6 道火柱同帧爆发', (s) => {
    s.cast('A7', 'group_spell_fire', 'cast', 'groupSpell', SIX, { element: 'fire' });
    const dmg = [52, 78, 81, 77, 86, 84];
    SIX.forEach((id, i) => s.hit(id, 0, dmg[i]!, { magic: true }));
    s.end();
  });
  add('single_spell', '法术系', '单体法术·炎爆', '蓄力后火球飞向目标并爆炸', (s) => {
    s.cast('A2', 'single_spell', 'cast', 'singleSpell', ['E7'], { element: 'fire' });
    s.strike('E7', 0, 337, { magic: true, crit: true });
    s.end();
  });

  // ---------------- 封印系 ----------------
  add('seal', '封印系', '封印·命中', '暗紫锁链光束命中，目标缠绕锁链，头顶出现封印图标与剩余回合', (s) => {
    s.cast('A3', 'seal', 'cast', 'sealChain', ['E7'], { element: 'seal' });
    s.push({ type: 'StatusApplied', unitId: 'E7', sourceId: 'A3', status: 'seal', remainingTurns: 3 });
    s.end();
  });
  add('seal_resist', '封印系', '封印·被抵抗', '锁链命中后崩碎，没有封印图标', (s) => {
    s.cast('A3', 'seal', 'cast', 'sealChain', ['E6'], { element: 'seal' });
    s.push({ type: 'StatusResisted', unitId: 'E6', sourceId: 'A3', status: 'seal' });
    s.end();
  });
  add('seal_expire', '封印系', '封印·递减到期', '封印后经过 3 次回合结算：图标数字 3 → 2 → 1 → 解除，身上的锁链消失', (s) => {
    s.cast('A3', 'seal', 'cast', 'sealChain', ['E2'], { element: 'seal' });
    s.push({ type: 'StatusApplied', unitId: 'E2', sourceId: 'A3', status: 'seal', remainingTurns: 3 });
    s.end();
    // 回合结算：剩余回合递减；下一回合开始的横幅正好当作回合之间的停顿
    s.push({ type: 'StatusTicked', unitId: 'E2', status: 'seal', remainingTurns: 2 });
    s.push({ type: 'TurnEnd' });
    s.push({ type: 'TurnStart', turnOrder: [] });
    s.push({ type: 'StatusTicked', unitId: 'E2', status: 'seal', remainingTurns: 1 });
    s.push({ type: 'TurnEnd' });
    s.push({ type: 'TurnStart', turnOrder: [] });
    s.push({ type: 'StatusRemoved', unitId: 'E2', status: 'seal', reason: 'expired' });
    s.push({ type: 'TurnEnd' });
  });

  // ---------------- 恢复系 ----------------
  /** 铺垫：Boss 一记旋风斩把几个队友打残 / 打倒 */
  const wound = (setup: Script, targets: [UnitId, number][]): void => {
    setup.cast('E7', 'basic_physical', 'melee', 'meleeStrike', targets.map(([id]) => id), { stepCount: targets.length });
    targets.forEach(([id, dmg], i) => setup.strike(id, i, dmg));
    setup.end();
  };
  add('group_heal', '恢复系', '群体治疗 ×3', '3 个目标脚下同时升起金绿光柱和上升光点，血条平滑回升', (s, setup) => {
    wound(setup, [['A1', 760], ['A6', 520], ['A2', 610]]);
    s.cast('A4', 'group_heal', 'cast', 'groupHeal', ['A2', 'A1', 'A6'], { element: 'heal' });
    s.heal('A2', 151).heal('A1', 143).heal('A6', 212, true);
    s.end();
  });
  add('revive', '恢复系', '复活', '光芒从高处降到倒地的队友身上，队友缓缓站起，血条回到 30%', (s, setup) => {
    wound(setup, [['A1', 9999]]);
    s.cast('A4', 'revive', 'cast', 'revive', ['A1'], { element: 'heal' });
    s.revive('A1', 0.3);
    s.end();
  });

  // ---------------- 普攻 ----------------
  add('basic_melee', '普攻', '近战普攻·暴击击杀', '镜头推近、斩击光弧、暴击与击杀顿帧', (s) => {
    s.cast('A1', 'basic_physical', 'melee', 'meleeStrike', ['E3']);
    s.strike('E3', 0, 9999, { crit: true });
    s.end();
  });
  add('basic_bow', '普攻', '弓箭普攻', '原地射击，光箭带光轨', (s) => {
    s.cast('A0', 'basic_physical', 'ranged', 'bowShot', ['E5']);
    s.strike('E5', 0, 112);
    s.end();
  });
  add('basic_magic', '普攻', '法术普攻', '原地施法，光弹飞向目标', (s) => {
    s.cast('A2', 'basic_magic', 'cast', 'castBolt', ['E8'], { element: 'fire' });
    s.strike('E8', 0, 128, { magic: true });
    s.end();
  });
  add('basic_spear', '普攻', '枪 / 剑普攻', '守誓持枪突刺，随后缚魂持剑出手：武器出手瞬间光芒增强', (s) => {
    s.cast('A4', 'basic_physical', 'melee', 'meleeStrike', ['E4']);
    s.strike('E4', 0, 61);
    s.end();
    s.cast('A3', 'basic_physical', 'melee', 'meleeStrike', ['E4']);
    s.strike('E4', 0, 0, { miss: true });
    s.end();
  });

  return demos;
}

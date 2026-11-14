// 演出样例的事件脚本：手工编排一段事件序列，把连斩、旋风斩、箭雨、三连射、群体法术、单体法术、
// 封印（命中 / 抵抗 / 递减 / 到期）、治疗、倒地、复活后再次出手、防御、指令回退都演一遍。
//
// 这份脚本只用 core/events.ts 里定义的事件，技能 id 和名称取自技能表，用来在真实画面里集中检查这些演出路径。
// 这里的伤害数值是随手写的演示数据，不代表任何规则或公式。

import type { BattleEventInput, UnitSnapshot } from '../../core/events';
import type { AnimType, Command, Delivery, Element, SkillId, UnitId, UnitTemplate } from '../../core/types';
import { SKILLS } from '../../data/skills';

/** 样例里用到的技能显示名：取自技能表 */
export const SHOWCASE_SKILL_NAMES: Record<SkillId, string> = Object.fromEntries(
  Object.values(SKILLS).map((s) => [s.id, s.name]),
);

/** 带回合号的事件（seq 由播放方补上） */
export type ShowcaseEvent = BattleEventInput & { turn: number };

/** 用模板生成满状态的单位快照 */
export function snapshotOf(t: UnitTemplate): UnitSnapshot {
  return {
    id: t.id,
    templateId: t.templateId,
    name: t.name,
    side: t.side,
    kind: t.kind,
    classId: t.classId,
    rank: t.rank,
    slot: t.slot,
    weaponId: t.weaponId,
    attackMode: t.attackMode,
    stats: t.stats,
    hp: t.stats.maxHp,
    mp: t.stats.maxMp,
  };
}

interface CastSpec {
  skillId: SkillId;
  delivery: Delivery;
  animation: AnimType;
  element?: Element;
  targets: UnitId[];
  mpCost?: number;
}

interface HitSpec {
  step: number;
  stepCount: number;
  hitIndex?: number;
  hitCount?: number;
  magic?: boolean;
  miss?: boolean;
  crit?: boolean;
  defended?: boolean;
}

/**
 * 生成样例脚本。
 * 需要默认阵容里的这些单位：A0 弓手、A1 刀客、A2 法师、A3 封印师、A4 治疗师；E0~E9 敌人（E7 为 Boss）。
 */
export function buildShowcaseScript(units: readonly UnitSnapshot[]): ShowcaseEvent[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const hp = new Map(units.map((u) => [u.id, u.hp]));
  const mp = new Map(units.map((u) => [u.id, u.mp]));
  const out: ShowcaseEvent[] = [];
  let turn = 1;
  let actor: UnitId = '';
  let skill: SkillId = '';

  const unit = (id: UnitId): UnitSnapshot => {
    const u = byId.get(id);
    if (!u) throw new Error(`演出样例需要单位 ${id}`);
    return u;
  };
  const push = (e: BattleEventInput): void => void out.push({ ...e, turn });
  const alive = (id: UnitId): boolean => (hp.get(id) ?? 0) > 0;
  /** 出手顺序：按速度从快到慢，包含倒地的友方，不包含已消失的敌人 */
  const turnStart = (): void => {
    const order = units
      .filter((u) => u.side === 'ally' || alive(u.id))
      .sort((a, b) => b.stats.speed - a.stats.speed)
      .map((u) => u.id);
    push({ type: 'TurnStart', turnOrder: order });
  };
  const begin = (id: UnitId, command: Command): void => {
    actor = id;
    push({ type: 'UnitActStart', actorId: id, command });
  };
  const end = (): void => push({ type: 'UnitActEnd', actorId: actor });
  const cast = (spec: CastSpec): void => {
    const cost = SKILLS[spec.skillId]?.mpCost ?? 0; // 消耗取自技能表
    const before = mp.get(actor)!;
    mp.set(actor, before - cost);
    skill = spec.skillId;
    push({
      type: 'SkillCast',
      actorId: actor,
      skillId: spec.skillId,
      delivery: spec.delivery,
      animation: spec.animation,
      meleeCharge: spec.delivery === 'melee',
      element: spec.element ?? 'none',
      targets: spec.targets,
      mpCost: cost,
      mpBefore: before,
      mpAfter: before - cost,
    });
  };
  /** 一段伤害；返回目标是否被打死（死亡事件由调用处决定何时发出） */
  const hit = (targetId: UnitId, damage: number, spec: HitSpec): boolean => {
    const before = hp.get(targetId)!;
    const dealt = spec.miss ? 0 : Math.min(before, damage);
    const after = before - dealt;
    hp.set(targetId, after);
    const killed = !spec.miss && after === 0;
    push({
      type: 'HitResolved',
      actorId: actor,
      targetId,
      skillId: skill,
      stepIndex: spec.step,
      stepCount: spec.stepCount,
      hitIndex: spec.hitIndex ?? 0,
      hitCount: spec.hitCount ?? 1,
      damageType: spec.magic ? 'magic' : 'physical',
      isMiss: spec.miss ?? false,
      isCrit: spec.crit ?? false,
      defended: spec.defended ?? false,
      damage: dealt,
      hpBefore: before,
      hpAfter: after,
      killed,
    });
    return killed;
  };
  const die = (id: UnitId): void =>
    push({ type: 'UnitDied', unitId: id, killerId: actor, vanish: unit(id).side === 'enemy' });
  const heal = (targetId: UnitId, amount: number, crit = false): void => {
    const before = hp.get(targetId)!;
    const after = Math.min(unit(targetId).stats.maxHp, before + amount);
    hp.set(targetId, after);
    push({
      type: 'HealResolved',
      actorId: actor,
      targetId,
      skillId: skill,
      stepIndex: 0,
      stepCount: 1,
      isCrit: crit,
      amount: after - before,
      hpBefore: before,
      hpAfter: after,
    });
  };

  // ---------------- 第 1 回合 ----------------
  turnStart();
  push({ type: 'DefendApplied', unitId: 'E2' });

  // 封印命中 Boss
  begin('A3', { kind: 'skill', skillId: 'seal', targetId: 'E7' });
  cast({ skillId: 'seal', delivery: 'cast', animation: 'sealChain', element: 'seal', targets: ['E7'] });
  push({ type: 'StatusApplied', unitId: 'E7', sourceId: 'A3', status: 'seal', remainingTurns: 2 });
  end();

  // 箭雨：原地依次射 3 个目标（命中 / 未命中 / 暴击）
  begin('A0', { kind: 'skill', skillId: 'arrow_rain', targetId: 'E0' });
  cast({ skillId: 'arrow_rain', delivery: 'ranged', animation: 'arrowRain', targets: ['E0', 'E1', 'E3'] });
  hit('E0', 140, { step: 0, stepCount: 3 });
  hit('E1', 0, { step: 1, stepCount: 3, miss: true });
  hit('E3', 260, { step: 2, stepCount: 3, crit: true });
  end();

  // 群体法术：4 个目标同帧结算，其中 2 个被打死（死亡在这一步的全部命中之后统一发出）
  begin('A2', { kind: 'skill', skillId: 'group_spell', targetId: 'E0' });
  cast({ skillId: 'group_spell', delivery: 'cast', animation: 'groupSpell', element: 'thunder', targets: ['E0', 'E1', 'E3', 'E4'] });
  {
    const dead: UnitId[] = [];
    for (const [id, dmg] of [['E0', 9999], ['E1', 230], ['E3', 9999], ['E4', 250]] as const) {
      if (hit(id, dmg, { step: 0, stepCount: 1, magic: true })) dead.push(id);
    }
    for (const id of dead) die(id);
  }
  end();

  // 连斩：冲锋一次，对同一目标连砍 3 段，最后一段打死
  begin('A1', { kind: 'skill', skillId: 'combo_slash', targetId: 'E1' });
  cast({ skillId: 'combo_slash', delivery: 'melee', animation: 'comboSlash', targets: ['E1'] });
  hit('E1', 120, { step: 0, stepCount: 3, hitIndex: 0, hitCount: 3 });
  hit('E1', 130, { step: 1, stepCount: 3, hitIndex: 1, hitCount: 3, crit: true });
  if (hit('E1', 9999, { step: 2, stepCount: 3, hitIndex: 2, hitCount: 3 })) die('E1');
  end();

  // 被封印的 Boss：技能改为普攻，打倒刀客（友方倒地后保持倒地）
  begin('E7', { kind: 'skill', skillId: 'whirlwind', targetId: 'A1' });
  push({ type: 'CommandFallback', actorId: 'E7', fromSkillId: 'whirlwind', toSkillId: 'basic_physical', reason: 'sealed' });
  cast({ skillId: 'basic_physical', delivery: 'melee', animation: 'meleeStrike', targets: ['A1'] });
  if (hit('A1', 9999, { step: 0, stepCount: 1, crit: true })) die('A1');
  end();

  // 敌方封印被抵抗
  begin('E5', { kind: 'skill', skillId: 'seal', targetId: 'A2' });
  cast({ skillId: 'seal', delivery: 'cast', animation: 'sealChain', element: 'seal', targets: ['A2'] });
  push({ type: 'StatusResisted', unitId: 'A2', sourceId: 'E5', status: 'seal' });
  end();

  // 敌方普攻：近战冲锋打弓手，法师原地施法打法师（让后面的群体治疗有血可加）
  begin('E8', { kind: 'attack', targetId: 'A0' });
  cast({ skillId: 'basic_physical', delivery: 'melee', animation: 'meleeStrike', targets: ['A0'] });
  hit('A0', 320, { step: 0, stepCount: 1 });
  end();
  begin('E6', { kind: 'attack', targetId: 'A2' });
  cast({ skillId: 'basic_magic', delivery: 'cast', animation: 'castBolt', element: 'fire', targets: ['A2'] });
  hit('A2', 420, { step: 0, stepCount: 1, magic: true });
  end();

  // 复活倒地的刀客
  begin('A4', { kind: 'skill', skillId: 'revive', targetId: 'A1' });
  cast({ skillId: 'revive', delivery: 'cast', animation: 'revive', element: 'heal', targets: ['A1'] });
  {
    const maxHp = unit('A1').stats.maxHp;
    const after = Math.round(maxHp * 0.3);
    hp.set('A1', after);
    push({ type: 'UnitRevived', unitId: 'A1', actorId: 'A4', hpAfter: after, maxHp, actsThisTurn: false });
  }
  end();

  // 防御的单位轮到自己时不动
  begin('E2', { kind: 'defend' });
  end();

  push({ type: 'StatusTicked', unitId: 'E7', status: 'seal', remainingTurns: 1 });
  push({ type: 'TurnEnd' });

  // ---------------- 第 2 回合 ----------------
  turn = 2;
  turnStart();

  // 群体治疗（其中一个暴击）
  begin('A4', { kind: 'skill', skillId: 'group_heal', targetId: 'A1' });
  cast({ skillId: 'group_heal', delivery: 'cast', animation: 'groupHeal', element: 'heal', targets: ['A1', 'A0', 'A2'] });
  heal('A1', 380);
  heal('A0', 300);
  heal('A2', 560, true);
  end();

  // 复活后的刀客再次出手——旋风斩：依次冲向 3 个目标，打完才回原位
  begin('A1', { kind: 'skill', skillId: 'whirlwind', targetId: 'E2' });
  cast({ skillId: 'whirlwind', delivery: 'melee', animation: 'whirlwind', targets: ['E2', 'E4', 'E8'] });
  hit('E2', 150, { step: 0, stepCount: 3 });
  if (hit('E4', 9999, { step: 1, stepCount: 3 })) die('E4');
  hit('E8', 170, { step: 2, stepCount: 3 });
  end();

  // 三连射：原地对同一目标连射 3 箭
  begin('A0', { kind: 'skill', skillId: 'triple_shot', targetId: 'E6' });
  cast({ skillId: 'triple_shot', delivery: 'ranged', animation: 'tripleShot', targets: ['E6'] });
  hit('E6', 130, { step: 0, stepCount: 3, hitIndex: 0, hitCount: 3 });
  hit('E6', 0, { step: 1, stepCount: 3, hitIndex: 1, hitCount: 3, miss: true });
  hit('E6', 240, { step: 2, stepCount: 3, hitIndex: 2, hitCount: 3, crit: true });
  end();

  // 单体法术：光弹飞向目标并打死
  begin('A2', { kind: 'skill', skillId: 'single_spell', targetId: 'E6' });
  cast({ skillId: 'single_spell', delivery: 'cast', animation: 'singleSpell', element: 'fire', targets: ['E6'] });
  if (hit('E6', 9999, { step: 0, stepCount: 1, magic: true, crit: true })) die('E6');
  end();

  // 魔法不足改为普攻 + 没有可打的目标
  begin('A7', { kind: 'skill', skillId: 'single_spell', targetId: 'E6' });
  push({ type: 'CommandFallback', actorId: 'A7', fromSkillId: 'single_spell', toSkillId: 'basic_magic', reason: 'noMp' });
  push({ type: 'TargetRetargeted', actorId: 'A7', fromId: 'E6', toId: 'E5' });
  cast({ skillId: 'basic_magic', delivery: 'cast', animation: 'castBolt', element: 'fire', targets: ['E5'] });
  hit('E5', 110, { step: 0, stepCount: 1, magic: true });
  end();

  // 封印到期
  push({ type: 'StatusTicked', unitId: 'E7', status: 'seal', remainingTurns: 0 });
  push({ type: 'StatusRemoved', unitId: 'E7', status: 'seal', reason: 'expired' });
  push({ type: 'TurnEnd' });

  return out;
}

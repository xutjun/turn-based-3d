import { describe, expect, it } from 'vitest';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { buildShowcaseScript, SHOWCASE_SKILL_NAMES, snapshotOf } from '../../src/ui/showcase/showcaseScript';

// 演出样例脚本是手工编排的事件：这里检查它自身前后一致，符合 DESIGN §3 的事件约定
describe('演出样例脚本', () => {
  const units = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES].map(snapshotOf);
  const script = buildShowcaseScript(units);

  it('每次出手都以 UnitActStart 开始、UnitActEnd 结束，结算事件都在出手之内', () => {
    let actor: string | null = null;
    for (const e of script) {
      if (e.type === 'UnitActStart') {
        expect(actor).toBeNull();
        actor = e.actorId;
      } else if (e.type === 'UnitActEnd') {
        expect(e.actorId).toBe(actor);
        actor = null;
      } else if (e.type === 'SkillCast' || e.type === 'HitResolved' || e.type === 'HealResolved') {
        expect(e.actorId).toBe(actor);
      }
    }
    expect(actor).toBeNull();
  });

  it('气血、魔法前后连续；倒地单位不出手，复活后才能再次出手；死亡紧跟致死的结算', () => {
    const hp = new Map(units.map((u) => [u.id, u.hp]));
    const mp = new Map(units.map((u) => [u.id, u.mp]));
    const dead = new Set<string>();
    const pendingDeaths = new Set<string>();
    for (const e of script) {
      switch (e.type) {
        case 'UnitActStart':
          expect(pendingDeaths.size).toBe(0);
          expect(dead.has(e.actorId)).toBe(false);
          break;
        case 'SkillCast':
          expect(e.mpBefore).toBe(mp.get(e.actorId));
          expect(e.mpAfter).toBe(e.mpBefore - e.mpCost);
          expect(e.mpAfter).toBeGreaterThanOrEqual(0);
          mp.set(e.actorId, e.mpAfter);
          for (const id of e.targets) expect(hp.has(id)).toBe(true);
          break;
        case 'HitResolved':
          expect(dead.has(e.targetId)).toBe(false);
          expect(e.hpBefore).toBe(hp.get(e.targetId));
          expect(e.hpAfter).toBe(e.hpBefore - e.damage);
          expect(e.killed).toBe(!e.isMiss && e.hpAfter === 0);
          hp.set(e.targetId, e.hpAfter);
          if (e.killed) pendingDeaths.add(e.targetId);
          break;
        case 'HealResolved':
          expect(dead.has(e.targetId)).toBe(false);
          expect(e.hpBefore).toBe(hp.get(e.targetId));
          expect(e.hpAfter).toBe(e.hpBefore + e.amount);
          hp.set(e.targetId, e.hpAfter);
          break;
        case 'UnitDied':
          expect(pendingDeaths.delete(e.unitId)).toBe(true);
          expect(e.vanish).toBe(e.unitId.startsWith('E'));
          dead.add(e.unitId);
          break;
        case 'UnitRevived':
          expect(dead.delete(e.unitId)).toBe(true);
          expect(e.hpAfter).toBeGreaterThan(0);
          hp.set(e.unitId, e.hpAfter);
          break;
        case 'TurnStart':
          // 出手顺序里没有已消失的敌人
          for (const id of e.turnOrder) expect(id.startsWith('E') && dead.has(id)).toBe(false);
          break;
        default:
          break;
      }
    }
    expect(pendingDeaths.size).toBe(0);
  });

  it('覆盖了需要检查的演出路径，且用到的技能都有显示名', () => {
    const types = new Set(script.map((e) => e.type));
    for (const t of ['DefendApplied', 'CommandFallback', 'StatusApplied', 'StatusResisted', 'StatusTicked', 'StatusRemoved', 'HealResolved', 'UnitDied', 'UnitRevived'] as const) {
      expect(types.has(t)).toBe(true);
    }
    const casts = script.filter((e) => e.type === 'SkillCast');
    expect(new Set(casts.map((c) => c.delivery))).toEqual(new Set(['melee', 'ranged', 'cast']));
    for (const c of casts) expect(SHOWCASE_SKILL_NAMES[c.skillId]).toBeTruthy();
    // 复活后的单位再次出手
    const revived = script.findIndex((e) => e.type === 'UnitRevived');
    const revivedId = (script[revived] as { unitId: string }).unitId;
    expect(script.slice(revived).some((e) => e.type === 'UnitActStart' && e.actorId === revivedId)).toBe(true);
  });
});

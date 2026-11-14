import { describe, expect, it } from 'vitest';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { snapshotOf } from '../../src/ui/showcase/showcaseScript';
import { buildSkillDemos, DEMO_SKILLS } from '../../src/ui/showcase/skillDemoScripts';

// 技能演示脚本是手工编排的事件：检查每个演示自身前后一致，符合 DESIGN §3 的事件约定
describe('技能演示脚本（?demo=skills）', () => {
  const units = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES].map(snapshotOf);
  const byId = new Map(units.map((u) => [u.id, u]));
  const demos = buildSkillDemos(units);

  it('SPEC 要求的每个技能演出都能单独触发', () => {
    const animations = new Set(demos.flatMap((d) => d.events.flatMap((e) => (e.type === 'SkillCast' ? [e.animation] : []))));
    for (const a of ['comboSlash', 'whirlwind', 'arrowRain', 'tripleShot', 'groupSpell', 'singleSpell', 'sealChain', 'groupHeal', 'revive', 'meleeStrike', 'bowShot', 'castBolt']) {
      expect(animations.has(a as never), a).toBe(true);
    }
    expect(new Set(demos.map((d) => d.id)).size).toBe(demos.length);
  });

  it('目标数量符合规则：旋风斩 / 箭雨 7 个，群体法术 6 个，群体治疗 3 个，封印和复活 1 个', () => {
    const targetsOf = (id: string): number => {
      const c = demos.find((d) => d.id === id)!.events.find((e) => e.type === 'SkillCast');
      return c?.type === 'SkillCast' ? c.targets.length : 0;
    };
    expect(targetsOf('whirlwind')).toBe(7);
    expect(targetsOf('arrow_rain')).toBe(7);
    expect(targetsOf('group_spell')).toBe(6);
    expect(targetsOf('group_heal')).toBe(3);
    expect(targetsOf('seal')).toBe(1);
    expect(targetsOf('revive')).toBe(1);
    expect(targetsOf('whirlwind_few')).toBe(3);
  });

  for (const demo of demos) {
    it(`「${demo.label}」的事件前后一致`, () => {
      const hp = new Map(units.map((u) => [u.id, u.hp]));
      const mp = new Map(units.map((u) => [u.id, u.mp]));
      const dead = new Set<string>();
      const pendingDeaths = new Set<string>();
      let actor: string | null = null;
      for (const e of [...demo.setup, ...demo.events]) {
        switch (e.type) {
          case 'UnitActStart':
            expect(actor).toBeNull();
            expect(dead.has(e.actorId)).toBe(false);
            actor = e.actorId;
            break;
          case 'UnitActEnd':
            expect(e.actorId).toBe(actor);
            expect(pendingDeaths.size).toBe(0);
            actor = null;
            break;
          case 'SkillCast':
            expect(e.actorId).toBe(actor);
            expect(DEMO_SKILLS[e.skillId]).toBeTruthy();
            expect(e.mpBefore).toBe(mp.get(e.actorId));
            expect(e.mpAfter).toBe(e.mpBefore - e.mpCost);
            expect(e.mpAfter).toBeGreaterThanOrEqual(0);
            mp.set(e.actorId, e.mpAfter);
            // 只有近战会冲锋；弓箭和法术原地出手
            expect(e.meleeCharge).toBe(byId.get(e.actorId)!.attackMode === 'melee' && e.delivery === 'melee');
            for (const id of e.targets) expect(byId.has(id)).toBe(true);
            break;
          case 'HitResolved':
            expect(dead.has(e.targetId)).toBe(false);
            expect(e.hpBefore).toBe(hp.get(e.targetId));
            expect(e.hpAfter).toBe(e.hpBefore - e.damage);
            expect(e.killed).toBe(!e.isMiss && e.hpAfter === 0);
            expect(e.hitIndex).toBeLessThan(e.hitCount);
            expect(e.stepIndex).toBeLessThan(e.stepCount);
            hp.set(e.targetId, e.hpAfter);
            if (e.killed) pendingDeaths.add(e.targetId);
            break;
          case 'HealResolved':
            expect(dead.has(e.targetId)).toBe(false);
            expect(e.hpAfter).toBe(e.hpBefore + e.amount);
            expect(e.hpBefore).toBe(hp.get(e.targetId));
            hp.set(e.targetId, e.hpAfter);
            break;
          case 'UnitDied':
            expect(pendingDeaths.delete(e.unitId)).toBe(true);
            expect(e.vanish).toBe(byId.get(e.unitId)!.side === 'enemy');
            dead.add(e.unitId);
            break;
          case 'UnitRevived':
            expect(dead.delete(e.unitId)).toBe(true);
            expect(e.hpAfter).toBe(Math.floor(e.maxHp * 0.3));
            hp.set(e.unitId, e.hpAfter);
            break;
          default:
            break;
        }
      }
      expect(actor).toBeNull();
    });
  }
});

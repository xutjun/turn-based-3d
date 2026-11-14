import { describe, expect, it } from 'vitest';
import { BattleEngine } from '../../src/core/battle';
import type { BattleEvent } from '../../src/core/events';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { autoPlay } from '../helpers';
import { SKILLS } from '../../src/data/skills';
import { buildShowcaseScript, snapshotOf } from '../../src/ui/showcase/showcaseScript';
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

  it('技能 id、名称、消耗、动画、元素都与技能表一致', () => {
    expect(DEMO_SKILLS).toBe(SKILLS);
    expect(SKILLS['group_spell_fire']!.name).toBe('群体法术·烈焰');
    expect(SKILLS['triple_shot']!.name).toBe('三连射');
    expect(SKILLS['arrow_rain']!.name).toBe('箭雨');
    const scripts = [...demos.map((d) => d.events), buildShowcaseScript(units)];
    for (const events of scripts) {
      for (const e of events) {
        if (e.type !== 'SkillCast') continue;
        const skill = SKILLS[e.skillId];
        expect(skill, e.skillId).toBeDefined();
        expect(e.mpCost, e.skillId).toBe(skill!.mpCost);
        expect(e.animation, e.skillId).toBe(skill!.animation[e.delivery]);
        expect(e.targets.length, e.skillId).toBeLessThanOrEqual(skill!.targetCount);
        if (skill!.classId !== 'common') expect(e.element, e.skillId).toBe(skill!.element);
        // 演示里的施放者在正式战斗里确实拥有这个技能
        if (skill!.classId !== 'common') {
          const owner = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES].find((t) => t.id === e.actorId)!;
          expect(owner.skillIds, `${e.actorId} ${e.skillId}`).toContain(e.skillId);
        }
      }
    }
  });

  it('逻辑层在正式战斗里发出的事件与演示脚本格式相同：同类事件的字段完全一致', () => {
    const fields = (e: object): string => Object.keys(e).filter((k) => k !== 'seq' && k !== 'turn').sort().join(',');
    const demoShapes = new Map<string, string>();
    for (const e of demos.flatMap((d) => d.events)) demoShapes.set(e.type, fields(e));

    const engineEvents: BattleEvent[] = [];
    const engine = new BattleEngine(createDefaultSetup(64));
    engine.events.onAny((e) => engineEvents.push(e));
    autoPlay(engine);
    const seen = new Set<string>();
    for (const e of engineEvents) {
      const expected = demoShapes.get(e.type);
      if (expected === undefined) continue;
      expect(fields(e), e.type).toBe(expected);
      seen.add(e.type);
    }
    for (const type of ['SkillCast', 'HitResolved', 'HealResolved', 'UnitDied', 'UnitRevived', 'StatusApplied', 'StatusResisted', 'StatusTicked', 'StatusRemoved']) {
      expect(seen.has(type), type).toBe(true);
    }
    // 正式战斗里出现的 技能 + 出手方式 + 动画 组合，演示里都演过
    const combo = (e: { skillId: string; delivery: string; animation: string; element: string }): string =>
      `${e.skillId}/${e.delivery}/${e.animation}/${e.element}`;
    const demoCombos = new Set(demos.flatMap((d) => d.events).flatMap((e) => (e.type === 'SkillCast' ? [combo(e)] : [])));
    for (const e of engineEvents) if (e.type === 'SkillCast') expect(demoCombos.has(combo(e)), combo(e)).toBe(true);
  });
});

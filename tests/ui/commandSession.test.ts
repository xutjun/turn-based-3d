import { describe, expect, it } from 'vitest';
import { CommandSession, type CommandEngine, type Notice } from '../../src/ui/command/CommandSession';
import type { SkillDef, Unit } from '../../src/core/types';
import { BattleEngine } from '../../src/core/battle';
import type { BattleState } from '../../src/core/types';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { SKILLS } from '../../src/data/skills';
import { makeEngine, makeUnit, TEST_SKILLS } from '../helpers';

/** 用真实引擎建一个会话，并收集提示 */
function setup(units: Unit[], skills: Record<string, SkillDef> = TEST_SKILLS) {
  const { engine } = makeEngine(units, { setup: { skills } });
  engine.start();
  const notices: Notice[] = [];
  let changes = 0;
  const session = new CommandSession(engine, skills, {
    onNotice: (n) => notices.push(n),
    onChange: () => (changes += 1),
  });
  return { engine, session, notices, changes: () => changes };
}

const hero = (id: string, col: number, extra: Parameters<typeof makeUnit>[2] = {}): Unit =>
  makeUnit(id, 'ally', { slot: { row: 1, col: col as 0 }, ...extra });
const enemy = (id: string, extra: Parameters<typeof makeUnit>[2] = {}): Unit =>
  makeUnit(id, 'enemy', { autoCommand: true, ...extra });

describe('指令会话：基本流程', () => {
  it('按指令顺序逐个下令，全部下完后会话结束', async () => {
    const { engine, session } = setup([hero('A0', 0), hero('A1', 1), enemy('E0')]);
    let done = false;
    const finished = session.begin().then(() => (done = true));

    expect(session.mode).toBe('menu');
    expect(session.unitId).toBe('A0');
    expect(session.progress).toEqual({ index: 1, total: 2 });

    session.chooseAttack();
    expect(session.mode).toBe('target');
    expect(session.candidates).toEqual(['E0']);
    expect(session.confirmTarget('E0')).toBe(true);

    expect(session.unitId).toBe('A1');
    expect(session.progress).toEqual({ index: 2, total: 2 });
    expect(done).toBe(false);
    session.chooseDefend();

    await finished;
    expect(session.mode).toBe('idle');
    expect(engine.getPendingCommandUnits()).toEqual([]);
    expect(engine.getState().commands).toEqual({
      A0: { kind: 'attack', targetId: 'E0' },
      A1: { kind: 'defend' },
    });
  });

  it('没有待指令单位时立即结束', async () => {
    const { session } = setup([hero('A0', 0, { autoCommand: true }), enemy('E0')]);
    await session.begin();
    expect(session.mode).toBe('idle');
  });

  it('返回：选目标 → 菜单；菜单 → 上一个单位，重新下令会覆盖原指令', async () => {
    const { engine, session } = setup([hero('A0', 0), hero('A1', 1), enemy('E0'), enemy('E1')]);
    const finished = session.begin();
    expect(session.canGoBack).toBe(false);

    session.chooseAttack();
    session.back();
    expect(session.mode).toBe('menu');
    expect(session.unitId).toBe('A0');

    session.chooseAttack();
    session.confirmTarget('E0');
    expect(session.unitId).toBe('A1');
    expect(session.canGoBack).toBe(true);

    session.back();
    expect(session.unitId).toBe('A0');
    expect(session.progress).toEqual({ index: 1, total: 2 });
    session.chooseAttack();
    session.confirmTarget('E1');
    expect(engine.getState().commands['A0']).toEqual({ kind: 'attack', targetId: 'E1' });

    // 回到之前没下完的单位
    expect(session.unitId).toBe('A1');
    session.chooseDefend();
    await finished;
  });

  it('悬停只对合法目标生效，预览来自引擎', () => {
    const { session } = setup([hero('A0', 0), hero('A1', 1), enemy('E0')]);
    void session.begin();
    session.chooseAttack();
    session.hover('A1'); // 普攻不能打队友
    expect(session.hoverId).toBeNull();
    expect(session.preview).toEqual([]);
    session.hover('E0');
    expect(session.hoverId).toBe('E0');
    expect(session.preview).toEqual(['E0']);
    session.hover(null);
    expect(session.preview).toEqual([]);
  });

  it('abort() 中止会话，等待中的 begin() 随之完成', async () => {
    const { session } = setup([hero('A0', 0), enemy('E0')]);
    const finished = session.begin();
    session.abort();
    await finished;
    expect(session.mode).toBe('idle');
    // 中止后的操作不报错、不生效
    session.chooseAttack();
    session.chooseDefend();
    expect(session.mode).toBe('idle');
  });
});

describe('指令会话：非法操作给出提示且不崩溃', () => {
  it('魔法不足：技能置灰，点击提示原因，不进入选目标', () => {
    const { engine, session, notices } = setup([
      hero('A0', 0, { skillIds: ['test_bolt'], stats: { maxMp: 30 } }),
      enemy('E0'),
    ]);
    void session.begin();
    session.openSkills();
    expect(session.mode).toBe('skills');
    expect(session.skillRows).toMatchObject([{ enabled: false, disabledReason: 'noMp' }]);

    session.chooseSkill('test_bolt');
    expect(session.mode).toBe('skills');
    expect(notices.at(-1)).toEqual({ kind: 'error', text: '魔法不足：「测试法术」需要 50 点魔法，当前只有 30 点' });
    expect(engine.getState().commands).toEqual({});
  });

  it('魔法足够：技能可用，选目标后提交技能指令', async () => {
    const { engine, session, notices } = setup([
      hero('A0', 0, { skillIds: ['test_bolt'], stats: { maxMp: 60 } }),
      enemy('E0'),
    ]);
    const finished = session.begin();
    session.openSkills();
    expect(session.skillRows).toMatchObject([{ enabled: true }]);
    session.chooseSkill('test_bolt');
    expect(session.mode).toBe('target');
    expect(session.targetingSkill?.id).toBe('test_bolt');
    session.confirmTarget('E0');
    await finished;
    expect(notices).toEqual([]);
    expect(engine.getState().commands['A0']).toEqual({ kind: 'skill', skillId: 'test_bolt', targetId: 'E0' });
  });

  it('被封印：技能全部置灰并提示，仍可攻击和防御', async () => {
    const { engine, session, notices } = setup([
      hero('A0', 0, {
        skillIds: ['test_bolt'],
        stats: { maxMp: 100 },
        statuses: [{ type: 'seal', remainingTurns: 2, sourceId: 'E0', appliedTurn: 0 }],
      }),
      enemy('E0'),
    ]);
    const finished = session.begin();
    expect(session.sealed).toBe(true);
    session.openSkills();
    expect(notices.at(-1)?.text).toContain('被封印');
    expect(session.skillRows).toMatchObject([{ enabled: false, disabledReason: 'sealed' }]);
    session.chooseSkill('test_bolt');
    expect(session.mode).toBe('skills');
    expect(notices.at(-1)?.text).toContain('被封印');
    expect(engine.getState().commands).toEqual({});

    session.back();
    session.chooseAttack();
    expect(session.confirmTarget('E0')).toBe(true);
    await finished;
  });

  it('目标不合法：提示原因，留在选目标状态，不提交', () => {
    const { engine, session, notices } = setup([
      hero('A0', 0),
      hero('A1', 1),
      enemy('E0'),
      enemy('E1', { hp: 0, alive: false }),
    ]);
    void session.begin();
    session.chooseAttack();
    expect(session.candidates).toEqual(['E0']);

    expect(session.confirmTarget('A1')).toBe(false);
    expect(notices.at(-1)?.text).toBe('目标不合法：「普攻」只能选择敌方单位');
    expect(session.confirmTarget('E1')).toBe(false);
    expect(notices.at(-1)?.text).toBe('目标不合法：E1 已倒地');
    expect(session.confirmTarget('不存在')).toBe(false);
    expect(notices.at(-1)?.text).toBe('目标不合法');

    expect(session.mode).toBe('target');
    expect(session.unitId).toBe('A0');
    expect(engine.getState().commands).toEqual({});
  });

  it('引擎拒绝指令时提示原因而不是抛错', () => {
    const { engine, session, notices } = setup([hero('A0', 0), enemy('E0')]);
    void session.begin();
    session.chooseAttack();
    // 假装界面状态落后：引擎此时已不在指令阶段
    engine.submitCommand('A0', { kind: 'defend' });
    engine.beginExecution();
    expect(session.confirmTarget('E0')).toBe(false);
    expect(notices.at(-1)).toEqual({ kind: 'error', text: '现在不能下指令' });
  });

  it('没有技能的单位：不能打开技能列表，技能列表为空，不报错', () => {
    const { session } = setup([hero('A0', 0), enemy('E0')]);
    void session.begin();
    expect(session.hasSkills).toBe(false);
    session.openSkills();
    expect(session.mode).toBe('menu');
    expect(session.skillRows).toEqual([]);
    session.chooseSkill('不存在');
    expect(session.mode).toBe('menu');
  });
});

// ----------------------------------------------------------------------
// 多目标技能与复活（桩引擎）：只验证界面这一侧——
// 会话把引擎给出的预览原样交给界面，目标合法性按技能表的 targetSide / targetState 判断。
// 用真实引擎和正式技能表的验证见本文件最后一组。
// ----------------------------------------------------------------------

const skillOf = (id: string, name: string, patch: Partial<SkillDef>): SkillDef => ({
  ...TEST_SKILLS['basic_physical']!,
  id,
  name,
  classId: 'physical',
  mpCost: 20,
  ...patch,
});

const MULTI_SKILLS: Record<string, SkillDef> = {
  ...TEST_SKILLS,
  combo: skillOf('combo', '连斩', { pattern: 'multiHit', hits: 3, targetCount: 1 }),
  whirlwind: skillOf('whirlwind', '旋风斩', { pattern: 'sequential', targetCount: 7 }),
  groupSpell: skillOf('groupSpell', '群体法术', { pattern: 'simultaneous', targetCount: 6, damageType: 'magic' }),
  groupHeal: skillOf('groupHeal', '群体治疗', {
    pattern: 'simultaneous',
    targetCount: 3,
    effect: 'heal',
    targetSide: 'ally',
    damageType: 'magic',
  }),
  revive: skillOf('revive', '复活', { effect: 'revive', targetSide: 'ally', targetState: 'dead', damageType: 'magic' }),
  seal: skillOf('seal', '封印', { effect: 'seal', damageType: 'magic' }),
};

/** 桩引擎：预览按“主目标 + 同侧其余合法目标，补足到 targetCount”给出，提交一律接受 */
function stubSession(units: Unit[]) {
  const { engine: real } = makeEngine(units, { setup: { skills: MULTI_SKILLS } });
  real.start();
  const submitted: unknown[] = [];
  const engine: CommandEngine = {
    getState: () => real.getState(),
    getPendingCommandUnits: () => (submitted.length === 0 ? ['A0'] : []),
    getCommandOptions: (id) => real.getCommandOptions(id),
    previewTargets: (_unitId, skillId, primaryId) => {
      const skill = MULTI_SKILLS[skillId]!;
      const state = real.getState();
      const primary = state.units[primaryId]!;
      const rest = state.unitIds.filter((id) => {
        const u = state.units[id]!;
        return id !== primaryId && u.side === primary.side && u.alive === primary.alive;
      });
      return [primaryId, ...rest].slice(0, skill.targetCount);
    },
    submitCommand: (_id, cmd) => {
      submitted.push(cmd);
      return { ok: true };
    },
  };
  const notices: Notice[] = [];
  const session = new CommandSession(engine, MULTI_SKILLS, { onNotice: (n) => notices.push(n) });
  void session.begin();
  return { session, notices, submitted };
}

describe('指令会话：多目标预览与复活目标', () => {
  const caster = (extra: Parameters<typeof makeUnit>[2] = {}): Unit =>
    hero('A0', 0, { skillIds: Object.keys(MULTI_SKILLS).filter((id) => !id.startsWith('basic')), stats: { maxMp: 200 }, ...extra });
  const allies = [1, 2, 3, 4].map((i) => hero(`A${i}`, i));
  const enemies = Array.from({ length: 10 }, (_, i) => enemy(`E${i}`));

  it.each([
    ['combo', 1],
    ['whirlwind', 7],
    ['groupSpell', 6],
  ])('%s 预览 %i 个敌方目标', (skillId, count) => {
    const { session } = stubSession([caster(), ...allies, ...enemies]);
    session.openSkills();
    session.chooseSkill(skillId);
    expect(session.mode).toBe('target');
    expect(session.candidates).toHaveLength(10);
    session.hover('E3');
    expect(session.preview).toHaveLength(count);
    expect(session.preview[0]).toBe('E3');
  });

  it('敌人不足时预览数量随之减少', () => {
    const { session } = stubSession([caster(), ...enemies.slice(0, 4)]);
    session.openSkills();
    session.chooseSkill('whirlwind');
    session.hover('E1');
    expect(session.preview).toHaveLength(4);
  });

  it('群体治疗预览 3 个我方目标，不能选敌人', () => {
    const { session, notices } = stubSession([caster(), ...allies, ...enemies]);
    session.openSkills();
    session.chooseSkill('groupHeal');
    expect(session.candidates).toEqual(['A0', 'A1', 'A2', 'A3', 'A4']);
    session.hover('A2');
    expect(session.preview).toHaveLength(3);
    expect(session.confirmTarget('E0')).toBe(false);
    expect(notices.at(-1)?.text).toBe('目标不合法：「群体治疗」只能选择我方单位');
  });

  it('复活只能选倒地的队友，不扩展目标', () => {
    const fallen = hero('A1', 1, { hp: 0, alive: false });
    const { session, notices, submitted } = stubSession([caster(), fallen, hero('A2', 2), ...enemies]);
    session.openSkills();
    session.chooseSkill('revive');
    expect(session.candidates).toEqual(['A1']);
    session.hover('A2'); // 活着的队友不能选
    expect(session.hoverId).toBeNull();
    expect(session.confirmTarget('A2')).toBe(false);
    expect(notices.at(-1)?.text).toBe('目标不合法：「复活」只能选择倒地的队友');
    session.hover('A1');
    expect(session.preview).toEqual(['A1']);
    expect(session.confirmTarget('A1')).toBe(true);
    expect(submitted).toEqual([{ kind: 'skill', skillId: 'revive', targetId: 'A1' }]);
  });

  it('没有倒地的队友时，选复活会提示没有可选目标', () => {
    const { session, notices } = stubSession([caster(), ...allies, ...enemies]);
    session.openSkills();
    session.chooseSkill('revive');
    expect(session.mode).toBe('skills');
    expect(notices.at(-1)?.text).toBe('没有可选目标：「复活」只能选择倒地的队友');
  });

  it('已被封印的敌人不能再选为封印目标', () => {
    const sealed = enemy('E0', { statuses: [{ type: 'seal', remainingTurns: 2, sourceId: 'A0', appliedTurn: 1 }] });
    const { session, notices } = stubSession([caster(), sealed, enemy('E1')]);
    session.openSkills();
    session.chooseSkill('seal');
    expect(session.candidates).toEqual(['E1']);
    expect(session.confirmTarget('E0')).toBe(false);
    expect(notices.at(-1)?.text).toBe('目标不合法：E0 已被封印');
  });
});

// ----------------------------------------------------------------------
// 真实引擎 + 正式技能表 + 默认 10v10 阵容：界面里能选到、预览到、提交每一个技能
// ----------------------------------------------------------------------

describe('指令会话：默认阵容的技能（真实引擎）', () => {
  function realSession() {
    const engine = new BattleEngine(createDefaultSetup(1));
    engine.start();
    const notices: Notice[] = [];
    const session = new CommandSession(engine, SKILLS, { onNotice: (n) => notices.push(n) });
    void session.begin();
    const state = engine.getState() as BattleState;
    /** 把前面的单位都防御掉，轮到指定单位 */
    const goTo = (id: string): void => {
      for (let i = 0; i < 10 && session.unitId !== id; i++) session.chooseDefend();
      expect(session.unitId).toBe(id);
    };
    return { engine, session, notices, state, goTo };
  }

  it('技能列表显示技能表里的名称、消耗和说明', () => {
    const { session, goTo } = realSession();
    const names = (id: string): string[] => {
      goTo(id);
      session.openSkills();
      const rows = session.skillRows;
      for (const r of rows) {
        expect(r.enabled).toBe(true);
        expect(r.skill.mpCost).toBeGreaterThan(0);
        expect(r.skill.description.length).toBeGreaterThan(0);
      }
      session.back();
      return rows.map((r) => r.skill.name);
    };
    expect(names('A0')).toEqual(['三连射', '箭雨']);
    expect(names('A5')).toEqual([]); // 物理型宝宝没有主动技能
    expect(names('A1')).toEqual(['连斩', '旋风斩']);
    expect(names('A2')).toEqual(['群体法术·天雷', '单体法术·炎爆']);
    expect(names('A7')).toEqual(['三重魂火']);
    expect(names('A3')).toEqual(['封印']);
    expect(names('A8')).toEqual(['三重魂火']);
    expect(names('A4')).toEqual(['群体治疗', '复活']);
    expect(names('A9')).toEqual([]);
  });

  it('物理型宝宝没有“技能”选项：hasSkills 为 false，openSkills 不会打开技能列表；法术型宝宝有', () => {
    const { session, goTo } = realSession();
    // 按下指令的顺序依次检查
    for (const [id, has] of [['A5', false], ['A6', false], ['A7', true], ['A8', true], ['A9', false]] as const) {
      goTo(id);
      expect(session.hasSkills, id).toBe(has);
      session.openSkills();
      expect(session.mode, id).toBe(has ? 'skills' : 'menu');
      if (has) session.back();
    }
  });

  it.each([
    ['A0', 'triple_shot', 1],
    ['A0', 'arrow_rain', 7],
    ['A1', 'combo_slash', 1],
    ['A1', 'whirlwind', 7],
    ['A2', 'group_spell', 6],
    ['A2', 'single_spell', 1],
    ['A7', 'triple_spell', 3],
    ['A8', 'triple_spell', 3],
    ['A3', 'seal', 1],
  ])('%s 的 %s：可选 10 个敌人，预览命中 %i 个，提交后引擎收到技能指令', (unitId, skillId, count) => {
    const { engine, session, goTo } = realSession();
    goTo(unitId);
    session.openSkills();
    session.chooseSkill(skillId);
    expect(session.mode).toBe('target');
    expect(session.candidates).toHaveLength(10);
    expect(session.candidates.every((id) => id.startsWith('E'))).toBe(true);
    session.hover('E7');
    expect(session.preview).toHaveLength(count);
    expect(session.preview[0]).toBe('E7'); // 鼠标指着的主目标一定在内
    expect(session.confirmTarget('E7')).toBe(true);
    expect(engine.getState().commands[unitId]).toEqual({ kind: 'skill', skillId, targetId: 'E7' });
  });

  it('敌人减少后，旋风斩和群体法术的预览随之减少', () => {
    const { session, state, goTo } = realSession();
    for (const id of ['E0', 'E1', 'E2', 'E3', 'E4', 'E5']) Object.assign(state.units[id]!, { hp: 0, alive: false });
    goTo('A1');
    session.openSkills();
    session.chooseSkill('whirlwind');
    expect(session.candidates).toEqual(['E6', 'E7', 'E8', 'E9']);
    session.hover('E8');
    expect(session.preview).toHaveLength(4);
  });

  it('群体治疗：可选存活的我方单位，预览 3 个；存活不足 3 个时减少', () => {
    const { session, state, goTo } = realSession();
    goTo('A4');
    session.openSkills();
    session.chooseSkill('group_heal');
    expect(session.candidates).toHaveLength(10);
    expect(session.candidates.every((id) => id.startsWith('A'))).toBe(true);
    session.hover('A9');
    expect(session.preview).toHaveLength(3);
    expect(session.preview[0]).toBe('A9');
    for (const id of ['A0', 'A1', 'A2', 'A3', 'A5', 'A6', 'A7', 'A8']) Object.assign(state.units[id]!, { hp: 0, alive: false });
    session.hover(null);
    session.hover('A4');
    expect(session.preview).toEqual(['A4', 'A9']);
  });

  it('复活：没有人倒地时不能选；有人倒地时只能选倒地的队友，预览 1 个', () => {
    const { engine, session, notices, state, goTo } = realSession();
    goTo('A4');
    session.openSkills();
    session.chooseSkill('revive');
    expect(session.mode).toBe('skills');
    expect(notices.at(-1)?.text).toBe('没有可选目标：「复活」只能选择倒地的队友');

    Object.assign(state.units['A1']!, { hp: 0, alive: false });
    session.chooseSkill('revive');
    expect(session.mode).toBe('target');
    expect(session.candidates).toEqual(['A1']);
    expect(session.confirmTarget('A2')).toBe(false);
    expect(notices.at(-1)?.text).toBe('目标不合法：「复活」只能选择倒地的队友');
    session.hover('A1');
    expect(session.preview).toEqual(['A1']);
    expect(session.confirmTarget('A1')).toBe(true);
    expect(engine.getState().commands['A4']).toEqual({ kind: 'skill', skillId: 'revive', targetId: 'A1' });
  });

  it('魔法不足的技能置灰，其余仍可用；被封印时全部置灰', () => {
    const { session, notices, state, goTo } = realSession();
    state.units['A1']!.mp = 50; // 够连斩（30），不够旋风斩（60）
    goTo('A1');
    session.openSkills();
    expect(session.skillRows.map((r) => [r.skill.id, r.enabled, r.disabledReason])).toEqual([
      ['combo_slash', true, undefined],
      ['whirlwind', false, 'noMp'],
    ]);
    session.chooseSkill('whirlwind');
    expect(session.mode).toBe('skills');
    expect(notices.at(-1)?.text).toBe('魔法不足：「旋风斩」需要 60 点魔法，当前只有 50 点');

    state.units['A1']!.statuses.push({ type: 'seal', remainingTurns: 2, sourceId: 'E5', appliedTurn: 1 });
    expect(session.sealed).toBe(true);
    expect(session.skillRows.every((r) => !r.enabled && r.disabledReason === 'sealed')).toBe(true);
    session.chooseSkill('combo_slash');
    expect(session.mode).toBe('skills');
    session.back();
    session.chooseAttack(); // 仍可普攻
    expect(session.mode).toBe('target');
  });

  it('已被封印的敌人不在封印的可选目标里', () => {
    const { session, notices, state, goTo } = realSession();
    state.units['E6']!.statuses.push({ type: 'seal', remainingTurns: 3, sourceId: 'A8', appliedTurn: 1 });
    goTo('A3');
    session.openSkills();
    session.chooseSkill('seal');
    expect(session.candidates).toHaveLength(9);
    expect(session.candidates).not.toContain('E6');
    expect(session.confirmTarget('E6')).toBe(false);
    expect(notices.at(-1)?.text).toBe('目标不合法：亡灵法师 已被封印');
  });
});

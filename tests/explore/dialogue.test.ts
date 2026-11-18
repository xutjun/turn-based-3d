import { describe, expect, it } from 'vitest';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { BOSS_DIALOGUE_ID, DIALOGUE_EMOTES, DIALOGUES, type DialogueDef } from '../../src/data/dialogues';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { facingOf, slotPosition } from '../../src/data/formation';
import { LeaderAgent } from '../../src/explore/agent';
import { CameraFollow } from '../../src/explore/cameraFollow';
import { DialogueSession, resolveLine, validateDialogue } from '../../src/explore/dialogueSession';
import { ExploreSession } from '../../src/explore/exploreSession';
import { ExploreWorld } from '../../src/explore/exploreWorld';
import { wrapAngle } from '../../src/explore/walker';

// 步骤 16：与 Boss 的对话——对话数据解析与校验、对话进度（逐字显示 / 推进 / 选项分支）、交谈流程与对话中禁止移动（纯逻辑）

const DT = 1 / 60;
const boss = ENEMY_TEMPLATES.find((t) => t.rank === 'boss')!;
const BOSS = slotPosition('enemy', boss.slot);
const FACING = facingOf('enemy');
const leader = ALLY_TEMPLATES.find((t) => t.id === EXPLORE_CONFIG.leaderId)!;
const NAMES = { leader: leader.name, boss: boss.name };
const world = new ExploreWorld(BOSS);

function newSession(): ExploreSession {
  const a = new LeaderAgent(world);
  const s = EXPLORE_CONFIG.start;
  a.place(s.x, s.z, 0);
  return new ExploreSession(a, BOSS, FACING);
}

/** 推进到交谈开始（返回用了多少秒）；超过 maxSeconds 还没开始返回 Infinity */
function runUntilTalk(s: ExploreSession, maxSeconds = 15): number {
  for (let t = 0; t < maxSeconds; t += DT) if (s.update(DT) === 'talk') return t;
  return Infinity;
}

describe('对话数据：解析与校验', () => {
  it('表里所有对话都合法（至少一句、至少一个选项、取值合法、热键不重复），键与 id 一致', () => {
    for (const [key, def] of Object.entries(DIALOGUES)) expect(validateDialogue(def, key), key).toEqual([]);
    expect(DIALOGUES[BOSS_DIALOGUE_ID]).toBeDefined();
  });

  it('默认内容：骑士（显示“烬刃”）→ 深渊魔将（狂笑）→ “我准备好了” / “再等等”', () => {
    const def = DIALOGUES[BOSS_DIALOGUE_ID]!;
    const lines = def.lines.map((l) => resolveLine(l, NAMES));
    expect(lines.map((l) => l.name)).toEqual(['烬刃', '深渊魔将']);
    expect(lines[0]!.text).toBe('深渊魔将，你的末日到了，准备受死吧！');
    expect(lines[1]!.text).toBe('就凭你们几个凡人，也想来挑战我？');
    expect(lines[1]!.aside).toBe('狂笑');
    expect(lines.map((l) => l.emote)).toEqual(['point', 'laugh']);
    expect(def.choices.map((c) => [c.label, c.action])).toEqual([
      ['我准备好了', 'startBattle'],
      ['再等等', 'close'],
    ]);
  });

  it('解析：省略 name 时用单位名，写了 name 时用它；正文开头的括号神态拆成 aside；按字切分不劈开码点', () => {
    const a = resolveLine({ speaker: 'boss', text: '（狂笑）凡人！' }, NAMES);
    expect(a).toMatchObject({ name: '深渊魔将', aside: '狂笑', text: '凡人！', emote: 'none' });
    const b = resolveLine({ speaker: 'leader', name: '无名骑士', text: '(冷笑) 来吧', aside: '怒视' }, NAMES);
    expect(b).toMatchObject({ name: '无名骑士', aside: '怒视', text: '来吧' }); // 单独给了 aside 时优先用它
    expect(resolveLine({ speaker: 'leader', text: '𠀋字' }, NAMES).chars).toEqual(['𠀋', '字']);
  });

  it('校验能查出：没有台词、没有选项、说话人 / 动作 / 选项动作不合法、正文为空、热键重复', () => {
    const bad = {
      id: 'bad',
      lines: [
        { speaker: 'npc', text: '你好' },
        { speaker: 'boss', text: '（笑）', emote: 'dance' },
      ],
      choices: [
        { label: '好', action: 'startBattle', hotkey: '1' },
        { label: '', action: 'flee', hotkey: '1' },
      ],
    } as unknown as DialogueDef;
    const errs = validateDialogue(bad).join('\n');
    expect(errs).toMatch(/说话人 npc 不合法/);
    expect(errs).toMatch(/正文为空/);
    expect(errs).toMatch(/动作 dance 不合法/);
    expect(errs).toMatch(/文字为空/);
    expect(errs).toMatch(/动作 flee 不合法/);
    expect(errs).toMatch(/热键 1 重复/);
    expect(validateDialogue({ id: 'empty', lines: [], choices: [] }).join('\n')).toMatch(/至少要有一句台词[\s\S]*至少要有一个选项/);
    expect(() => new DialogueSession(bad, NAMES, 20)).toThrow(/对话数据有误/);
  });

  it('说话动作的姿态都是有限数，指向用 weapon.aim，狂笑张开双翼', () => {
    for (const [id, e] of Object.entries(DIALOGUE_EMOTES)) {
      for (const v of [...Object.values(e.pose), ...Object.values(e.wobble?.pose ?? {})]) expect(Number.isFinite(v), id).toBe(true);
    }
    expect(DIALOGUE_EMOTES.point.pose['weapon.aim']).toBe(1);
    expect(DIALOGUE_EMOTES.laugh.pose['wingL.y']).toBeLessThan(0); // Boss 的翼 y 为负 = 向两侧展开
    expect(DIALOGUE_EMOTES.laugh.pose['wingR.y']).toBeGreaterThan(0);
    expect(DIALOGUE_EMOTES.laugh.pose['head.x']).toBeLessThan(0); // 仰头
  });
});

describe('对话进度：逐字显示、推进与选项分支', () => {
  const def = DIALOGUES[BOSS_DIALOGUE_ID]!;

  it('逐字显示：按速度一个字一个字出来，不推进时（暂停）不动', () => {
    const d = new DialogueSession(def, NAMES, 20);
    expect(d.visibleText).toBe('');
    d.update(0.5); // 20 字/秒 × 0.5 秒 = 10 个字
    expect(d.visibleText).toBe(d.line.text.slice(0, 10));
    const before = d.visibleText;
    d.update(0); // 暂停时不调用 / dt = 0
    expect(d.visibleText).toBe(before);
    d.update(10);
    expect(d.lineComplete).toBe(true);
    expect(d.visibleText).toBe(d.line.text);
  });

  it('点击：逐字显示中 → 立即整句；再点 → 下一句（从头逐字）；最后一句之后 → 显示选项；再点无效', () => {
    const d = new DialogueSession(def, NAMES, 20);
    d.update(0.1);
    expect(d.advance()).toBe('reveal');
    expect(d.visibleText).toBe('深渊魔将，你的末日到了，准备受死吧！');
    expect(d.lineIndex).toBe(0);
    expect(d.advance()).toBe('next');
    expect(d.lineIndex).toBe(1);
    expect(d.line.speaker).toBe('boss');
    expect(d.visibleText).toBe('');
    expect(d.advance()).toBe('reveal');
    expect(d.showingChoices).toBe(false);
    expect(d.advance()).toBe('choices');
    expect(d.showingChoices).toBe(true);
    expect(d.advance()).toBe('none');
    expect(d.lineIndex).toBe(1);
  });

  it('选项分支：显示选项之前选择无效；“我准备好了” → startBattle，“再等等” → close；选完不能再选', () => {
    const toChoices = (): DialogueSession => {
      const d = new DialogueSession(def, NAMES, 0); // 0 = 每句立即整句
      expect(d.choose(0)).toBeNull();
      while (!d.showingChoices) d.advance();
      return d;
    };
    const a = toChoices();
    expect(a.choose(5)).toBeNull();
    expect(a.choose(0)).toBe('startBattle');
    expect(a.done).toBe(true);
    expect(a.choose(1)).toBeNull();
    expect(a.result).toBe('startBattle');
    const b = toChoices();
    expect(b.choose(1)).toBe('close');
    // 热键
    expect(toChoices().chooseHotkey('1')).toBe('startBattle');
    expect(toChoices().chooseHotkey('2')).toBe('close');
    expect(toChoices().chooseHotkey('3')).toBeNull();
    expect(new DialogueSession(def, NAMES, 0).chooseHotkey('1')).toBeNull(); // 还没到选项
    // Esc / 回到起点：直接以“再等等”结束
    const c = new DialogueSession(def, NAMES, 20);
    expect(c.cancel()).toBe('close');
    expect(c.done).toBe(true);
  });
});

describe('交谈流程：点击 Boss → 跑到交谈点 → 面向 Boss → 对话', () => {
  it('交谈点在 Boss 正前方 talkDistance 米（≈ (−1.5, −1.5)），能站人', () => {
    const s = newSession();
    const t = s.talkPoint;
    expect(Math.hypot(t.x - BOSS.x, t.z - BOSS.z)).toBeCloseTo(EXPLORE_CONFIG.talkDistance, 6);
    expect(t.x).toBeCloseTo(-1.5, 1);
    expect(t.z).toBeCloseTo(-1.5, 1);
    const r = s.clickBoss()!;
    expect(r.exact).toBe(true);
  });

  it('点 Boss 后跑过去，停在交谈点、面向 Boss 才触发对话，且只触发一次；随后锁定', () => {
    const s = newSession();
    expect(s.clickBoss()).not.toBeNull();
    expect(s.phase).toBe('approach');
    const t = runUntilTalk(s);
    expect(t).toBeLessThan(6);
    const a = s.agent;
    expect(Math.hypot(a.x - s.talkPoint.x, a.z - s.talkPoint.z)).toBeLessThan(0.05);
    expect(a.actualSpeed).toBeLessThan(0.05);
    expect(Math.abs(wrapAngle(a.yaw - s.yawToBoss()))).toBeLessThanOrEqual(EXPLORE_CONFIG.dialog.faceTolerance);
    expect(s.phase).toBe('dialog');
    expect(s.locked).toBe(true);
    for (let i = 0; i < 120; i++) expect(s.update(DT)).toBeNull();
  });

  it('从背对 Boss 的位置出发也会先转身：停下时面向 Boss', () => {
    const s = newSession();
    const tp = s.talkPoint;
    s.agent.place(tp.x, tp.z, s.yawToBoss(tp.x, tp.z) + Math.PI); // 就站在交谈点上，背对 Boss
    s.clickBoss();
    expect(runUntilTalk(s)).toBeLessThan(2);
    expect(Math.abs(wrapAngle(s.agent.yaw - s.yawToBoss()))).toBeLessThanOrEqual(EXPLORE_CONFIG.dialog.faceTolerance);
  });

  it('跑过去的途中点地面 = 取消对话，改为普通移动；方向键同样取消', () => {
    const s = newSession();
    s.clickBoss();
    for (let i = 0; i < 30; i++) s.update(DT);
    expect(s.clickGround(6, 2)).not.toBeNull();
    expect(s.phase).toBe('none');
    expect(runUntilTalk(s, 8)).toBe(Infinity);
    s.clickBoss();
    for (let i = 0; i < 30; i++) s.update(DT);
    s.setManual(1, 0);
    expect(s.phase).toBe('none');
    s.setManual(0, 0);
    expect(runUntilTalk(s, 4)).toBe(Infinity);
  });

  it('对话中禁止移动：点地面、点 Boss、方向键都无效，队长原地不动', () => {
    const s = newSession();
    s.clickBoss();
    runUntilTalk(s);
    const { x, z, yaw } = s.agent;
    expect(s.clickGround(8, 8)).toBeNull();
    expect(s.clickBoss()).toBeNull();
    s.setManual(1, 1);
    for (let i = 0; i < 180; i++) s.update(DT);
    expect(s.agent.x).toBe(x);
    expect(s.agent.z).toBe(z);
    expect(s.agent.yaw).toBeCloseTo(yaw, 6);
    expect(s.agent.hasPath).toBe(false);
    expect(s.locked).toBe(true);
  });

  it('选项分支：“再等等”解锁、回到自由移动（可以再点地面、再找 Boss）；“我准备好了”交给战斗、保持锁定', () => {
    const s = newSession();
    s.clickBoss();
    runUntilTalk(s);
    expect(s.endDialog('close')).toBe('explore');
    expect(s.locked).toBe(false);
    expect(s.clickGround(6, 6)).not.toBeNull();
    for (let i = 0; i < 60; i++) s.update(DT);
    expect(s.agent.actualSpeed).toBeGreaterThan(1);
    s.clickBoss();
    expect(runUntilTalk(s)).toBeLessThan(Infinity); // 可以再次对话
    expect(s.endDialog('startBattle')).toBe('battle');
    expect(s.locked).toBe(true);
    expect(s.clickGround(6, 6)).toBeNull();
    s.reset(); // 离开探索 / 回到起点
    expect(s.locked).toBe(false);
    expect(s.phase).toBe('none');
  });

  it('Boss 不在场时点 Boss 无效', () => {
    const s = newSession();
    s.setBossPresent(false);
    expect(s.clickBoss()).toBeNull();
    expect(s.phase).toBe('none');
  });
});

describe('对话镜头：注视点移到队长与 Boss 之间，距离平滑拉近再恢复', () => {
  it('拉近不跳变，最终到达配置的距离；恢复后回到探索距离', () => {
    const cam = new CameraFollow();
    cam.snap(0, 0);
    expect(cam.distance).toBe(EXPLORE_CONFIG.camera.distance);
    const c = EXPLORE_CONFIG.dialog.camera;
    expect(c.distance).toBeLessThan(EXPLORE_CONFIG.camera.distance);
    cam.setDistance(c.distance);
    let prev = cam.distance;
    let maxStep = 0;
    for (let i = 0; i < 300; i++) {
      cam.update(-3, -3, 0, 0, DT, c.smoothTime);
      maxStep = Math.max(maxStep, Math.abs(cam.distance - prev));
      prev = cam.distance;
    }
    expect(maxStep).toBeLessThan(0.3);
    expect(cam.distance).toBeCloseTo(c.distance, 2);
    expect(cam.x).toBeCloseTo(-3, 2);
    cam.setDistance();
    for (let i = 0; i < 300; i++) cam.update(0, 0, 0, 0, DT);
    expect(cam.distance).toBeCloseTo(EXPLORE_CONFIG.camera.distance, 2);
  });
});

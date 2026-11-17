import { Group, Mesh, BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { IDLE_CONFIG, IDLE_STYLES, type IdleStyleId } from '../../src/data/idleConfig';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { UNIT_MODELS } from '../../src/data/unitModels';
import { EXTRA_JOINT_NAMES, extraJointsOf, JOINT_PREFIX } from '../../src/render/units/animatedJoints';
import { createIdleTraits, eventAt, sampleIdle, seedOf, zeroOffsets, type IdleOffsets } from '../../src/render/units/idleMotion';

const TEMPLATES = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES];
const styleOf = (templateId: string): IdleStyleId => UNIT_MODELS[templateId]?.idle ?? 'stiff';
const KEYS = Object.keys(zeroOffsets()) as (keyof IdleOffsets)[];

/** 某个单位在一段时间里的全部采样 */
function trace(unitId: string, templateId: string, seconds: number, step: number): IdleOffsets[] {
  const style = IDLE_STYLES[styleOf(templateId)];
  const traits = createIdleTraits(seedOf(unitId), style, IDLE_CONFIG.periodJitter);
  const out: IdleOffsets[] = [];
  for (let t = 0; t <= seconds; t += step) out.push(sampleIdle(style, traits, t));
  return out;
}

describe('待机动画：配置', () => {
  it('场上 20 个单位都指定了待机风格', () => {
    for (const t of TEMPLATES) expect(UNIT_MODELS[t.templateId]?.idle, t.templateId).toBeDefined();
  });

  it('风格按单位类型区分：骑士和骷髅偏僵硬，法系飘逸，宝宝活泼，Boss 缓慢', () => {
    const s = IDLE_STYLES;
    // 僵硬：身体摇晃和布料飘动都比飘逸的小
    expect(s.stiff.sway).toBeLessThan(s.flowing.sway);
    expect(s.stiff.cloth).toBeLessThan(s.flowing.cloth);
    expect(s.rattle.sway).toBeLessThan(s.flowing.sway);
    expect(s.rattle.tremble).toBeGreaterThan(0); // 只有骷髅会颤
    // 宝宝更活泼：呼吸更快，张望更频繁
    expect(s.beast.breathHz).toBeGreaterThan(s.stiff.breathHz);
    expect(s.beast.lookEvery[1]).toBeLessThan(s.stiff.lookEvery[1]);
    // Boss 更缓慢：呼吸最慢、最深
    expect(s.overlord.breathHz).toBeLessThan(s.stiff.breathHz);
    expect(s.overlord.breath).toBeGreaterThan(s.stiff.breath);
  });
});

describe('待机动画：不同步', () => {
  it('任意两个单位的相位和周期都不相同', () => {
    const traits = TEMPLATES.map((t) => createIdleTraits(seedOf(t.id), IDLE_STYLES[styleOf(t.templateId)], IDLE_CONFIG.periodJitter));
    for (let i = 0; i < traits.length; i++) {
      for (let j = i + 1; j < traits.length; j++) {
        expect(Math.abs(traits[i]!.phase[0]! - traits[j]!.phase[0]!), `${i}-${j}`).toBeGreaterThan(1e-3);
        expect(Math.abs(traits[i]!.rate - traits[j]!.rate), `${i}-${j}`).toBeGreaterThan(1e-5);
      }
    }
  });

  it('同一种单位（4 个骷髅兵、2 个恶魔祭司、2 只狼）的呼吸曲线互不相关', () => {
    const groups = new Map<string, string[]>();
    for (const t of TEMPLATES) groups.set(t.templateId, [...(groups.get(t.templateId) ?? []), t.id]);
    let pairs = 0;
    for (const [templateId, ids] of groups) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = trace(ids[i]!, templateId, 60, 0.1).map((o) => o.breath);
          const b = trace(ids[j]!, templateId, 60, 0.1).map((o) => o.breath);
          // 两条呼吸曲线的相关系数：完全同步是 1，这里要求明显小于 1
          const corr = a.reduce((sum, v, k) => sum + v * b[k]!, 0) / Math.sqrt(a.reduce((s, v) => s + v * v, 0) * b.reduce((s, v) => s + v * v, 0));
          expect(Math.abs(corr), `${ids[i]} vs ${ids[j]}`).toBeLessThan(0.95);
          pairs += 1;
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it('同一时刻，全场 20 个单位的呼吸相位分散在整个周期里', () => {
    const breaths = TEMPLATES.map((t) => trace(t.id, t.templateId, 0, 1)[0]!.breath);
    expect(breaths.filter((b) => b > 0.2).length).toBeGreaterThanOrEqual(3);
    expect(breaths.filter((b) => b < -0.2).length).toBeGreaterThanOrEqual(3);
  });
});

describe('待机动画：动作克制、连续', () => {
  it('所有偏移都在配置的幅度之内', () => {
    for (const t of TEMPLATES) {
      const style = IDLE_STYLES[styleOf(t.templateId)];
      for (const o of trace(t.id, t.templateId, 120, 0.05)) {
        expect(Math.abs(o.chestPitch)).toBeLessThanOrEqual(style.breath + 1e-9);
        expect(Math.abs(o.bob)).toBeLessThanOrEqual(style.bob + 1e-9);
        expect(Math.abs(o.roll)).toBeLessThanOrEqual(style.sway + 1e-9);
        expect(Math.abs(o.shift)).toBeLessThanOrEqual(style.shift + 1e-9);
        expect(Math.abs(o.float)).toBeLessThanOrEqual(style.float + 1e-9);
        expect(Math.abs(o.headYaw)).toBeLessThanOrEqual(style.look * 1.08 + 1e-9);
        expect(Math.abs(o.tailYaw)).toBeLessThanOrEqual(style.tail + 1e-9);
        expect(Math.abs(o.wing)).toBeLessThanOrEqual(style.wing + 1e-9);
        expect(o.glow).toBeGreaterThan(0.2);
        expect(o.glow).toBeLessThan(1.8);
      }
    }
  });

  it('待机不让单位离开站位：左右位移不超过 2 厘米，起伏和漂浮不超过 6 厘米', () => {
    for (const style of Object.values(IDLE_STYLES)) {
      expect(style.shift).toBeLessThanOrEqual(0.02);
      expect(style.bob + style.float).toBeLessThanOrEqual(0.06);
      // 身体的摇晃不超过 2 度，转头不超过 25 度
      expect(style.sway).toBeLessThanOrEqual((2 * Math.PI) / 180);
      expect(style.look).toBeLessThanOrEqual((25 * Math.PI) / 180);
    }
  });

  it('相邻两帧（1/60 秒）之间没有跳变', () => {
    const dt = 1 / 60;
    for (const t of TEMPLATES) {
      const style = IDLE_STYLES[styleOf(t.templateId)];
      const samples = trace(t.id, t.templateId, 90, dt);
      // 先求每个量在 90 秒里最大的帧间变化，再各断言一次
      const maxStep = Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<keyof IdleOffsets, number>;
      for (let i = 1; i < samples.length; i++) {
        for (const key of KEYS) maxStep[key] = Math.max(maxStep[key], Math.abs(samples[i]![key] - samples[i - 1]![key]));
      }
      // 每帧的变化不超过“一帧走完全程的 1/8”：即使是最快的张望，也要 8 帧以上
      const limit = Math.max(style.look, style.tail, style.wing, style.fidget * 1.3, 0.05) / 8;
      for (const key of KEYS) {
        // 颤动和闪烁本来就是高频的；breath 是 −1~1 的相位量，不是角度：这三个单独检查
        if (key === 'tremble' || key === 'glow' || key === 'breath') continue;
        expect(maxStep[key], `${t.id} ${key}`).toBeLessThan(limit);
      }
      expect(maxStep.tremble, t.id).toBeLessThanOrEqual(style.tremble * 2 + 1e-9);
      // 呼吸最快 0.42 Hz（再乘周期抖动），一帧里相位量的变化远小于 0.1
      expect(maxStep.breath, t.id).toBeLessThan(0.1);
      expect(maxStep.glow, t.id).toBeLessThan(0.2);
    }
  });

  it('偶发动作在时间段的两端为 0（首尾相接不跳变），并且确实会发生', () => {
    let seen = 0;
    for (let k = 0; k < 40; k++) {
      expect(Math.abs(eventAt(k * 6, 6, 12345, 101, 0.75))).toBe(0);
      expect(Math.abs(eventAt(k * 6 + 5.999, 6, 12345, 101, 0.75))).toBeLessThan(1e-3);
      if (Math.abs(eventAt(k * 6 + 2.6, 6, 12345, 101, 0.75)) > 0.1) seen += 1;
    }
    expect(seen).toBeGreaterThan(10);
    expect(seen).toBeLessThan(40); // 不是每一段都做
  });

  it('关掉次要动画后，张望、小动作、颤动都为 0，呼吸仍在', () => {
    const style = IDLE_STYLES.rattle;
    const traits = createIdleTraits(seedOf('E1'), style, IDLE_CONFIG.periodJitter);
    let breath = 0;
    for (let t = 0; t < 60; t += 0.1) {
      const o = sampleIdle(style, traits, t, zeroOffsets(), { events: false, tremble: false });
      expect(o.tremble).toBe(0);
      expect(o.jaw).toBe(0);
      expect(o.elbowR).toBe(0);
      expect(Math.abs(o.headYaw)).toBeLessThanOrEqual(style.look * 0.08 + 1e-9);
      breath = Math.max(breath, Math.abs(o.breath));
    }
    expect(breath).toBeGreaterThan(0.9);
  });
});

describe('待机动画：关节登记', () => {
  it('按名字找出登记过的额外关节，没登记的不算', () => {
    const root = new Group();
    const named = (name: string, parent: Group): Group => {
      const g = new Group();
      g.name = `${JOINT_PREFIX}${name}`;
      g.add(new Mesh(new BoxGeometry(1, 1, 1)));
      parent.add(g);
      return g;
    };
    const body = named('body', root);
    const tail = named('tail', body);
    const head = named('head', body);
    // 步骤 11 起狼的四条腿（foreLegL …）登记为进攻动画的关节；膝、爪仍然没有登记
    const leg = named('foreLegL', body);
    named('foreLegLKnee', leg);
    const found = extraJointsOf(root);
    expect(found['tail']).toBe(tail);
    expect(found['head']).toBe(head);
    expect(found['foreLegL']).toBe(leg);
    expect(Object.keys(found).sort()).toEqual(['foreLegL', 'head', 'tail']);
    expect(EXTRA_JOINT_NAMES).toContain('wingL');
  });
});

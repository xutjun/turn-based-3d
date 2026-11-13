import { describe, expect, it } from 'vitest';
import { magicBase, physicalBase, resolveDamage } from '../../src/core/damage';
import type { BattleConfig } from '../../src/core/types';
import { TEST_CONFIG, constRng, seqRng } from '../helpers';

const source = { physAtk: 100, magAtk: 80 };
const target = { defense: 40, defending: false };
const physical = { damageType: 'physical', multiplier: 1, hitRate: 0.95 } as const;
const magic = { damageType: 'magic', multiplier: 1, hitRate: 0.95 } as const;

describe('伤害公式', () => {
  it('物理基础伤害 = 物伤 × 倍率 − 防御', () => {
    expect(physicalBase(100, 1, 40)).toBe(60);
    expect(physicalBase(100, 0.6, 40)).toBe(20);
  });

  it('法术基础伤害 = 法伤 × 倍率 − 防御 × 系数', () => {
    expect(magicBase(80, 1, 40, TEST_CONFIG)).toBe(60); // 80 − 40×0.5
    expect(magicBase(80, 1.5, 40, TEST_CONFIG)).toBe(100);
  });

  it('基础伤害最低为 1', () => {
    expect(physicalBase(10, 1, 999)).toBe(1);
    expect(magicBase(10, 1, 999, TEST_CONFIG)).toBe(1);
  });

  it('浮动系数为 1.0、不暴击时，结果等于基础伤害', () => {
    // 随机数恒为 0.5：命中(0.5<0.95)、浮动 0.9+0.2×0.5=1.0、不暴击(0.5≥0.1)
    expect(resolveDamage(source, target, physical, TEST_CONFIG, constRng(0.5))).toEqual({
      isMiss: false,
      isCrit: false,
      defended: false,
      damage: 60,
    });
    expect(resolveDamage(source, target, magic, TEST_CONFIG, constRng(0.5)).damage).toBe(60);
  });

  it('随机浮动在 0.9 ~ 1.1 之间', () => {
    // 序列：命中、浮动、暴击
    const low = resolveDamage(source, target, physical, TEST_CONFIG, seqRng([0, 0, 0.99]));
    const high = resolveDamage(source, target, physical, TEST_CONFIG, seqRng([0, 0.999999, 0.99]));
    expect(low.damage).toBe(54); // 60 × 0.9
    expect(high.damage).toBe(66); // 60 × 1.1（四舍五入）
  });

  it('近战与远程使用同一套物理公式（公式不接收出手方式）', () => {
    const a = resolveDamage(source, target, physical, TEST_CONFIG, constRng(0.5));
    const b = resolveDamage(source, target, { ...physical }, TEST_CONFIG, constRng(0.5));
    expect(a).toEqual(b);
  });

  it('最终伤害最低为 1（防御远高于攻击且处于防御时）', () => {
    const r = resolveDamage(
      { physAtk: 1, magAtk: 1 },
      { defense: 999, defending: true },
      physical,
      TEST_CONFIG,
      constRng(0.5),
    );
    expect(r.damage).toBe(1);
  });

  it('系数全部来自配置：修改配置后结果随之变化', () => {
    const cfg: BattleConfig = {
      ...TEST_CONFIG,
      magicDefenseCoef: 1,
      defendDamageMult: 0.25,
      varianceMin: 2,
      varianceMax: 2,
    };
    // 法术：80 − 40×1 = 40，浮动恒为 2 → 80
    expect(resolveDamage(source, target, magic, cfg, constRng(0.5)).damage).toBe(80);
    // 防御倍率 0.25 → 20
    expect(
      resolveDamage(source, { ...target, defending: true }, magic, cfg, constRng(0.5)).damage,
    ).toBe(20);
  });
});

describe('暴击', () => {
  it('物理暴击：随机数小于暴击率时伤害乘以暴击倍率', () => {
    const r = resolveDamage(source, target, physical, TEST_CONFIG, seqRng([0, 0.5, 0.05]));
    expect(r.isCrit).toBe(true);
    expect(r.damage).toBe(90); // 60 × 1.5
  });

  it('随机数不小于暴击率时不暴击', () => {
    const r = resolveDamage(source, target, physical, TEST_CONFIG, seqRng([0, 0.5, 0.1]));
    expect(r.isCrit).toBe(false);
    expect(r.damage).toBe(60);
  });

  it('法术也会暴击，使用法术自己的暴击率和倍率', () => {
    // 测试配置：法术暴击率 0.2、倍率 2
    const r = resolveDamage(source, target, magic, TEST_CONFIG, seqRng([0, 0.5, 0.15]));
    expect(r.isCrit).toBe(true);
    expect(r.damage).toBe(120); // 60 × 2
    // 同样的随机数对物理（暴击率 0.1）不暴击
    const p = resolveDamage(source, target, physical, TEST_CONFIG, seqRng([0, 0.5, 0.15]));
    expect(p.isCrit).toBe(false);
  });

  it('暴击率为 0 时永不暴击，为 1 时必定暴击', () => {
    const never: BattleConfig = {
      ...TEST_CONFIG,
      crit: { ...TEST_CONFIG.crit, physical: { rate: 0, multiplier: 1.5 } },
    };
    const always: BattleConfig = {
      ...TEST_CONFIG,
      crit: { ...TEST_CONFIG.crit, physical: { rate: 1, multiplier: 3 } },
    };
    expect(resolveDamage(source, target, physical, never, seqRng([0, 0.5, 0])).isCrit).toBe(false);
    const r = resolveDamage(source, target, physical, always, seqRng([0, 0.5, 0.999]));
    expect(r.isCrit).toBe(true);
    expect(r.damage).toBe(180);
  });
});

describe('防御减伤', () => {
  it('目标处于防御时伤害 ×0.5，物理和法术都生效', () => {
    const defending = { ...target, defending: true };
    const p = resolveDamage(source, defending, physical, TEST_CONFIG, constRng(0.5));
    const m = resolveDamage(source, defending, magic, TEST_CONFIG, constRng(0.5));
    expect(p).toMatchObject({ damage: 30, defended: true });
    expect(m).toMatchObject({ damage: 30, defended: true });
  });

  it('暴击与防御同时生效', () => {
    const r = resolveDamage(
      source,
      { ...target, defending: true },
      physical,
      TEST_CONFIG,
      seqRng([0, 0.5, 0]),
    );
    expect(r.damage).toBe(45); // 60 × 1.5 × 0.5
  });
});

describe('命中', () => {
  it('随机数不小于命中率时未命中，伤害为 0，且只消耗一个随机数', () => {
    const rng = seqRng([0.95, 0.5, 0.5]);
    const r = resolveDamage(source, target, physical, TEST_CONFIG, rng);
    expect(r).toEqual({ isMiss: true, isCrit: false, defended: false, damage: 0 });
    expect(rng.used()).toBe(1);
  });

  it('命中时固定消耗三个随机数：命中 → 浮动 → 暴击', () => {
    const rng = seqRng([0.94, 0.5, 0.5, 0.123]);
    const r = resolveDamage(source, target, physical, TEST_CONFIG, rng);
    expect(r.isMiss).toBe(false);
    expect(rng.used()).toBe(3);
  });
});

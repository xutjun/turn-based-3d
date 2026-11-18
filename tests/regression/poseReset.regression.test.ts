import { describe, expect, it } from 'vitest';
import { runBattleReal } from '../render/realStage';

// 姿态复位回归（步骤 11b）：用真实模型和真实 UnitView 把整场战斗演一遍，
// 每次出手结束后，每个站着的单位的根节点和全部关节都必须回到开战前的基准姿态，
// 没有阵亡的单位不得处于倒地姿态，也不得留在站位之外。任何一处没复位都算失败。
// （旧 bug：狼攻击返回后四脚朝天——腿关节的动作偏移每帧被累加，演出结束后没有归位。）

describe('整场战斗回归：姿态复位', () => {
  it.each([4, 64])('种子 %i：1 倍速演完整场，每次出手后所有单位姿态复位', async (seed) => {
    const { engine, problems, maxAway } = await runBattleReal(seed);
    expect(engine.getState().phase).toBe('ended');
    expect(problems).toEqual([]);
    expect(maxAway).toBeLessThanOrEqual(1);
  }, 120_000);

  it('2 倍速演完整场，姿态复位', async () => {
    const { engine, problems } = await runBattleReal(131, { timeScale: 2 });
    expect(engine.getState().phase).toBe('ended');
    expect(problems).toEqual([]);
  }, 120_000);

  it('跳过动画跑完整场，姿态复位', async () => {
    const { engine, problems } = await runBattleReal(21, { skip: true });
    expect(engine.getState().phase).toBe('ended');
    expect(problems).toEqual([]);
  }, 120_000);

  it('演出中途反复开关跳过动画、切换倍速，姿态仍然复位', async () => {
    let frame = 0;
    const { engine, problems } = await runBattleReal(7, {
      tweak: (s) => {
        frame += 1;
        if (frame % 7 === 0) s.setSkip(!s.skip);
        if (frame % 5 === 0) s.setTimeScale(s.timeScale === 1 ? 2 : 1);
      },
    });
    expect(engine.getState().phase).toBe('ended');
    expect(problems).toEqual([]);
  }, 120_000);
});

describe('整场战斗回归（步骤 17）：入场过场之后', () => {
  it.each([
    ['交谈点', { x: -1.5, z: -1.5 }, 1],
    ['出生点', { x: 8.5, z: 8.5 }, 2],
  ] as const)('从%s开打：过场结束后与直接开战的开场姿态一致，之后整场战斗每次出手后姿态复位、无离位（%i 倍速）', async (_name, at, timeScale) => {
    const { engine, problems, maxAway } = await runBattleReal(33, { intro: at, timeScale });
    expect(engine.getState().phase).toBe('ended');
    expect(problems).toEqual([]);
    expect(maxAway).toBeLessThanOrEqual(1);
  }, 180_000);
});

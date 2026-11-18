import { describe, expect, it } from 'vitest';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { createFlow, LEADER, seedFor } from './outroFlow';

// 完整流程（步骤 19 / v0.6.1）：探索 → 对话 → 入场过场 → 战斗（真实导演演出）→ 结算 → 战后过场 → 探索，连续多轮，
// 胜利（“重新开始”）、失败（“再来一次”）、中途放弃（设置菜单“重新开始”）交替进行。真实模型、真实 UnitView、真实调度器。
// 每轮回到探索后：只显示队长和 Boss、没有特技层 / 倒地 / 离位 / 说话动作 / 副本材质 / 地面特效 / 黑场残留；
// 每次入场过场结束后：全部 20 个单位与直接开战的开场姿态完全一致（上一场的倒地、封印、防御、武器光、材质都没带进来）。

describe('完整流程：连续多轮无残留', () => {
  it('胜利 → 失败 → 中途放弃 → 胜利 → 失败 → 退出重开：每轮回到探索都干净，每场开战都与第一场相同', async () => {
    const win = seedFor('ally');
    const lose = seedFor('enemy');
    const f = createFlow();
    f.explore.enter();
    const log: string[] = [];

    const begin = async (): Promise<void> => {
      const start = await f.talkAndStart();
      await f.playIntro(start);
      expect(f.startDiff(), `第 ${log.length + 1} 场开战`).toEqual([]);
    };
    /** 战斗演出用跳过动画（只为跑得快），过场照常 1 倍速 */
    const fight = async (seed: number, abortAfter?: number) => {
      f.scheduler.setSkip(true);
      const winner = await f.fight(seed, abortAfter);
      f.scheduler.setSkip(false);
      return winner;
    };
    const settled = async (what: string, at?: { x: number; z: number }) => {
      await f.steps(30);
      expect(f.residue(), what).toEqual([]);
      expect(f.explore.active, what).toBe(true);
      expect(f.explore.snapshot().talk, what).toBe('none');
      expect(f.scheduler.pending, what).toBe(0);
      expect(f.boss.model.visible, what).toBe(true);
      if (at) {
        const g = f.views.get(LEADER)!.groundPosition;
        expect(Math.hypot(g.x - at.x, g.z - at.z), what).toBeLessThan(0.3);
      }
      log.push(what);
    };

    // 1. 胜利 → “重新开始”：回到出生点，Boss 在原位
    await begin();
    expect(await fight(win)).toBe('ally');
    await f.playOutro('victory');
    await settled('胜利', EXPLORE_CONFIG.start);

    // 2. 失败 → “再来一次”：队长在复位点，Boss 在原位
    await begin();
    expect(await fight(lose)).toBe('enemy');
    const lost = await f.playOutro('defeat');
    await settled('失败', lost.leader);

    // 3. 中途放弃（设置菜单“重新开始”）：回到探索起点
    await begin();
    expect(await fight(win, 6)).toBeNull();
    await settled('中途放弃', EXPLORE_CONFIG.start);

    // 4. 再胜利一次、5. 再失败一次
    await begin();
    expect(await fight(win)).toBe('ally');
    await f.playOutro('victory');
    await settled('第二次胜利', EXPLORE_CONFIG.start);
    await begin();
    expect(await fight(lose)).toBe('enemy');
    await f.playOutro('defeat');
    await settled('第二次失败');

    // 退出到标题再开始（标题背景 = 探索初始布置）
    f.explore.enter();
    await settled('退出后重新开始', EXPLORE_CONFIG.start);
    expect(log).toHaveLength(6);
  }, 600_000);
});

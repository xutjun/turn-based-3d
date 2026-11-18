import { describe, expect, it } from 'vitest';
import { createFlow, LEADER, seedFor } from './outroFlow';

// 完整流程（步骤 19）：探索 → 对话 → 入场过场 → 战斗（真实导演演出）→ 战后过场 → 探索，连续多轮，
// 胜利、失败、中途放弃（重新开始）、再挑战一次交替进行。真实模型、真实 UnitView、真实调度器。
// 每轮回到探索后：只显示探索布置、没有特技层 / 倒地 / 离位 / 说话动作 / 副本材质 / 地面特效 / 黑场残留；
// 每次入场过场结束后：全部 20 个单位与直接开战的开场姿态完全一致（上一场的倒地、封印、防御、武器光、材质都没带进来）。

describe('完整流程：连续多轮无残留', () => {
  it('胜利 → 再挑战一次 → 失败 → 中途放弃 → 胜利 → 失败：每轮回到探索都干净，每场开战都与第一场相同', async () => {
    const win = seedFor('ally');
    const lose = seedFor('enemy');
    const f = createFlow();
    f.explore.enter();
    const log: string[] = [];

    /** 开一场：对话、入场过场；返回开战时与基准的差异 */
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
    const settled = async (what: string) => {
      await f.steps(30);
      expect(f.residue(), what).toEqual([]);
      expect(f.explore.active, what).toBe(true);
      expect(f.explore.snapshot().talk, what).toBe('none');
      expect(f.scheduler.pending, what).toBe(0);
      log.push(what);
    };

    // 1. 胜利：Boss 不再出现
    await begin();
    expect(await fight(win)).toBe('ally');
    await f.playOutro('victory');
    await settled('胜利');
    expect(f.explore.bossPresent).toBe(false);
    expect(f.boss.model.visible).toBe(false);

    // 2. 再挑战一次：Boss 重新出现，可以对话
    f.explore.beginBossReturn();
    await f.until(f.outro.bossReturn());
    f.explore.finishBossReturn();
    await settled('再挑战一次');
    expect(f.explore.bossPresent).toBe(true);

    // 3. 失败：队长在复位点，Boss 在原位
    await begin();
    expect(await fight(lose)).toBe('enemy');
    const lost = await f.playOutro('defeat');
    await settled('失败');
    expect(lost.visible.sort()).toEqual([LEADER, f.boss.id].sort());

    // 4. 中途放弃（战斗中“重新开始”）：回到探索起点，Boss 在场
    await begin();
    expect(await fight(win, 6)).toBeNull();
    await settled('中途放弃');
    expect(f.explore.bossPresent).toBe(true);

    // 5. 再胜利一次、6. 再失败一次（Boss 先重新出现）
    await begin();
    expect(await fight(win)).toBe('ally');
    await f.playOutro('victory');
    await settled('第二次胜利');
    f.explore.beginBossReturn();
    await f.until(f.outro.bossReturn());
    f.explore.finishBossReturn();
    await begin();
    expect(await fight(lose)).toBe('enemy');
    await f.playOutro('defeat');
    await settled('第二次失败');

    // 退出到标题再开始（标题背景 = 探索初始布置，Boss 在场）
    f.explore.enter(true);
    await settled('退出后重新开始');
    expect(log).toHaveLength(7);
  }, 600_000);
});

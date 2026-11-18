import { describe, expect, it } from 'vitest';
import { OUTRO_CONFIG } from '../../src/data/cutsceneConfig';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { facingOf } from '../../src/data/formation';
import { createFlow, fakeEnd, LEADER, type Flow } from './outroFlow';

// 战后过场（步骤 19）：真实模型、真实 UnitView、真实调度器，按帧推进。
// 检查：胜利时倒地的人先站起、宝宝跳回主人身后淡出、4 名队员化入暗影，只留队长在原地，相机回到探索取景；
// 失败时黑场中复位（队长到离 Boss 9 米的复位点，Boss 在原位），淡入后相机回到探索取景；
// 结束时材质换回原材质、特技层清空、地面特效清空、黑场归零；倍速、跳过动画（开头 / 中途）、暂停。

/** 从探索开打：对话 → 入场过场（战斗本身用 fakeEnd 摆出结果） */
async function toBattle(f: Flow): Promise<void> {
  const start = await f.talkAndStart();
  await f.playIntro(start);
}

const exploreFrame = (f: Flow, x: number, z: number) => f.explore.frameAt(x, z);

describe('战后过场：胜利', () => {
  it('倒地的队员站起 → 宝宝跳回主人身后淡出、队员化入暗影 → 只留队长在原地，相机回到探索取景，Boss 不再出现', async () => {
    const f = createFlow();
    f.explore.enter();
    await toBattle(f);
    await fakeEnd(f, 'victory', ['A0', 'A3']);
    const views = f.views;
    const leaderHome = views.get(LEADER)!.home;
    const pets = [...views.values()].filter((v) => v.side === 'ally' && v.kind === 'pet');
    const members = [...views.values()].filter((v) => v.side === 'ally' && v.kind === 'hero' && v.id !== LEADER);
    // 逐帧记录：站起的时刻、宝宝离主人身后的距离、队员沉入地下的深度
    let stoodAt = -1;
    let deepest = 0;
    const petTravel = new Map<string, number>();
    const petStart = new Map(pets.map((p) => [p.id, { ...p.groundPosition }]));
    f.setOnFrame((n) => {
      if (stoodAt < 0 && views.get('A0')!.fallen === 0 && views.get('A3')!.fallen === 0) stoodAt = n;
      for (const m of members) if (m.model.visible) deepest = Math.min(deepest, m.stuntHeight);
      for (const p of pets) {
        const s = petStart.get(p.id)!;
        const g = p.groundPosition;
        petTravel.set(p.id, Math.max(petTravel.get(p.id) ?? 0, Math.hypot(g.x - s.x, g.z - s.z)));
      }
    });
    const report = await f.playOutro('victory');
    f.setOnFrame(null);

    expect(report.result).toBe('victory');
    expect(report.stoodUp.sort()).toEqual(['A0', 'A3']);
    expect(stoodAt).toBeGreaterThan(0);
    // 队员沉入地下（化入暗影），宝宝真的往回跳了（离开自己的格子一段距离）
    expect(deepest).toBeLessThan(-OUTRO_CONFIG.vanish.sink * 0.5);
    for (const p of pets) expect(petTravel.get(p.id)!, p.id).toBeGreaterThan(1.2);
    // 结束：只剩队长在他的战斗格子上，Boss 不在场
    expect(report.visible).toEqual([LEADER]);
    expect(report.maxFade).toBe(0);
    const g = views.get(LEADER)!.groundPosition;
    expect(Math.hypot(g.x - leaderHome.x, g.z - leaderHome.z)).toBeLessThan(0.3);
    expect(f.explore.bossPresent).toBe(false);
    expect(f.explore.active).toBe(true);
    expect(f.residue()).toEqual([]);
    // 相机：最后停在探索取景上（与探索跟随队长的取景相同）
    const last = f.frames.at(-1)!;
    const want = exploreFrame(f, g.x, g.z);
    expect(last.x).toBeCloseTo(want.x, 5);
    expect(last.z).toBeCloseTo(want.z, 5);
    expect(last.distance).toBeCloseTo(want.distance, 5);
    // Boss 不在场：点 Boss 无效，可以走到 Boss 原来站的地方
    expect(f.explore.clickBoss()).toBeNull();
    const r = f.explore.clickGround(f.boss.home.x, f.boss.home.z)!;
    expect(r.exact).toBe(true);
  }, 120_000);

  it('“再挑战一次”：Boss 在原位重新出现（灵魂凝形），出现前点不到，出现后才能对话；不会自动开打', async () => {
    const f = createFlow();
    f.explore.enter();
    await toBattle(f);
    await fakeEnd(f, 'victory', []);
    await f.playOutro('victory');
    // 队长跑到 Boss 原来站的位置，再点“再挑战一次”：先被挤到旁边能站的地方，不和 Boss 重叠
    f.explore.clickGround(f.boss.home.x, f.boss.home.z);
    await f.steps(400);
    f.explore.beginBossReturn();
    const back = f.outro.bossReturn();
    expect(f.outro.bossReturning).toBe(true);
    await f.steps(10);
    expect(f.explore.clickBoss()).toBeNull(); // 出现过程中还不能对话
    let shown = -1;
    f.setOnFrame((n) => {
      if (shown < 0 && f.boss.model.visible) shown = n;
    });
    await f.until(back);
    f.setOnFrame(null);
    f.explore.finishBossReturn();
    await f.steps(240);
    expect(shown).toBeGreaterThanOrEqual(0);
    expect(f.boss.model.visible).toBe(true);
    expect(f.explore.bossPresent).toBe(true);
    expect(f.leaderClearance()).toBeGreaterThan(0.3);
    expect(f.residue()).toEqual([]);
    expect(f.explore.snapshot().talk).toBe('none'); // 没有自动开打
    // 可以再次对话、开战
    const start = await f.talkAndStart();
    await f.playIntro(start);
    expect(f.startDiff()).toEqual([]);
  }, 120_000);
});

describe('战后过场：失败', () => {
  it('黑场淡出 → 黑场中复位（队长到离 Boss 9 米的复位点，队员和宝宝隐藏，Boss 在原位）→ 淡入 → 相机回到探索取景', async () => {
    const f = createFlow();
    f.explore.enter();
    await toBattle(f);
    await fakeEnd(f, 'defeat');
    // 全黑停留的最后一帧：场上已经是探索布置（淡入之前就复位好了）
    let atBlack: { visible: string[]; leader: { x: number; z: number } } | null = null;
    f.setOnFrame(() => {
      if (f.outro.fadeLevel >= 1) {
        atBlack = {
          visible: [...f.views.values()].filter((v) => v.model.visible).map((v) => v.id).sort(),
          leader: f.views.get(LEADER)!.groundPosition,
        };
      }
    });
    const report = await f.playOutro('defeat');
    f.setOnFrame(null);
    expect(report.maxFade).toBe(1);
    expect(f.fades.at(-1)).toBe(0);
    expect(atBlack).not.toBeNull();
    expect(atBlack!.visible).toEqual([LEADER, f.boss.id].sort());
    // 复位点：Boss 正前方 9 米、面向 Boss
    const boss = f.boss.home;
    const e = facingOf('enemy');
    const want = { x: boss.x + e.x * EXPLORE_CONFIG.respawnDistance, z: boss.z + e.z * EXPLORE_CONFIG.respawnDistance };
    expect(Math.hypot(report.leader.x - want.x, report.leader.z - want.z)).toBeLessThan(0.3);
    expect(Math.hypot(report.leader.x - boss.x, report.leader.z - boss.z)).toBeCloseTo(EXPLORE_CONFIG.respawnDistance, 0);
    expect(report.visible.sort()).toEqual([LEADER, f.boss.id].sort());
    expect(f.explore.bossPresent).toBe(true);
    expect(f.residue()).toEqual([]);
    for (const v of f.views.values()) expect(v.fallen, v.id).toBe(0);
    // Boss 在原位、原朝向
    const bg = f.boss.groundPosition;
    expect(Math.hypot(bg.x - boss.x, bg.z - boss.z)).toBeLessThan(1e-6);
    // 可以再次对话挑战
    const start = await f.talkAndStart();
    await f.playIntro(start);
    expect(f.startDiff()).toEqual([]);
  }, 120_000);
});

describe('战后过场：倍速、跳过动画、暂停', () => {
  /** 1 倍速下战后过场用多少演出时间 / 帧 */
  async function timed(result: 'victory' | 'defeat', tweak?: (f: Flow) => void, during?: (f: Flow, n: number) => void) {
    const f = createFlow();
    f.explore.enter();
    await toBattle(f);
    await fakeEnd(f, result);
    tweak?.(f);
    let frames = 0;
    f.setOnFrame((n) => {
      frames += 1;
      during?.(f, n);
    });
    const report = await f.playOutro(result);
    f.setOnFrame(null);
    return { f, report, frames };
  }

  it('2 倍速用时约为 1 倍速的一半；结果相同', async () => {
    const one = await timed('victory');
    const two = await timed('victory', (f) => f.scheduler.setTimeScale(2));
    expect(two.frames).toBeLessThan(one.frames * 0.62);
    expect(two.report.visible).toEqual(one.report.visible);
    expect(two.f.residue()).toEqual([]);
    // 胜利：1 倍速约 2.5~4 秒
    expect(one.frames / 60).toBeGreaterThan(2.5);
    expect(one.frames / 60).toBeLessThan(4.5);
  }, 180_000);

  it('开头就跳过动画 / 中途打开跳过：几帧内走完，最终状态与正常播完相同', async () => {
    for (const result of ['victory', 'defeat'] as const) {
      const normal = await timed(result);
      const skipped = await timed(result, (f) => f.scheduler.setSkip(true));
      expect(skipped.frames, result).toBeLessThan(10);
      expect(skipped.report.skipped).toBe(true);
      expect(skipped.report.visible.sort()).toEqual(normal.report.visible.sort());
      expect(skipped.report.leader.x).toBeCloseTo(normal.report.leader.x, 6);
      expect(skipped.f.residue()).toEqual([]);
      const mid = await timed(result, undefined, (f, n) => {
        if (n === 40) f.scheduler.setSkip(true);
      });
      expect(mid.frames, result).toBeLessThan(60);
      expect(mid.report.visible.sort()).toEqual(normal.report.visible.sort());
      expect(mid.f.residue()).toEqual([]);
    }
  }, 240_000);

  it('暂停期间战后过场停住（单位位置、黑场不变），恢复后接着播完', async () => {
    let frozen: { fade: number; y: number } | null = null;
    let changed = false;
    const { f, report } = await timed('defeat', undefined, (g, n) => {
      if (n === 20) {
        g.scheduler.setPaused(true);
        frozen = { fade: g.outro.fadeLevel, y: g.views.get('A0')!.stuntHeight };
      } else if (n > 20 && n < 200) {
        if (g.outro.fadeLevel !== frozen!.fade) changed = true;
      } else if (n === 200) g.scheduler.setPaused(false);
    });
    expect(frozen).not.toBeNull();
    expect(changed).toBe(false);
    expect(report.maxFade).toBe(1);
    expect(f.residue()).toEqual([]);
  }, 120_000);
});

describe('战后过场：预热', () => {
  it('预热后材质全部换回原材质、显隐恢复原样', async () => {
    const f = createFlow();
    f.explore.enter();
    const before = [...f.views.values()].map((v) => v.model.visible);
    let compiled = 0;
    f.outro.prewarm(() => void (compiled += 1));
    expect(compiled).toBe(1);
    expect(f.outro.shadedUnits()).toEqual([]);
    expect([...f.views.values()].map((v) => v.model.visible)).toEqual(before);
  });
});

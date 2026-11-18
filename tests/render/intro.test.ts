import { describe, expect, it } from 'vitest';
import { INTRO_CONFIG } from '../../src/data/cutsceneConfig';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { facingOf } from '../../src/data/formation';
import { ExploreWorld } from '../../src/explore/exploreWorld';
import { obstacleDistance } from '../../src/explore/collision';
import { nearestStandable } from '../../src/explore/introPlan';
import { yawOf } from '../../src/explore/walker';
import type { BattleCamera } from '../../src/render/camera/battleCamera';
import type { CameraRig } from '../../src/render/camera/CameraRig';
import { IntroCutscene, type CameraFrame, type IntroStart } from '../../src/render/cutscene/introCutscene';
import { IntroFx } from '../../src/render/cutscene/introFx';
import { Scheduler } from '../../src/render/director/Scheduler';
import type { FxSystem } from '../../src/render/fx/FxSystem';
import type { BattleStage } from '../../src/render/units/BattleStage';
import type { UnitView } from '../../src/render/units/UnitView';
import { createRealViews, poseDiff, poseSnapshot } from './realStage';

// 入场过场（步骤 17）：真实模型、真实 UnitView、真实调度器，按帧推进。
// 检查：落点误差为 0、结束时全员在格子上面向敌方并显示、姿态与直接开战完全一致、材质换回原材质、
// 地面特效清空、相机回到战斗机位；倍速、跳过动画（开头 / 中途）、暂停；全程无单位穿过障碍物、空中不相撞。

const LEADER = EXPLORE_CONFIG.leaderId;

function setup() {
  const scheduler = new Scheduler();
  const views = createRealViews(scheduler);
  const boss = [...views.values()].find((v) => v.id === 'E9' || v.radius > 1)!;
  const world = new ExploreWorld(boss.home);
  const frames: (CameraFrame | null)[] = [];
  const camera = { setFrame: (f: CameraFrame | null) => frames.push(f ? { ...f } : null), target: { x: 0, z: 0 } } as unknown as BattleCamera;
  let shakes = 0;
  const rig = { shake: () => void (shakes += 1) } as unknown as CameraRig;
  const fx = { burst: () => Promise.resolve(), rubble: () => undefined, flashLight: () => undefined } as unknown as FxSystem;
  const sounds: string[] = [];
  const stage = {
    views,
    unit: (id: string) => views.get(id)!,
    reset: () => {
      scheduler.flush();
      for (const v of views.values()) v.reset();
    },
  } as unknown as BattleStage;
  const introFx = new IntroFx();
  const intro = new IntroCutscene({
    stage,
    scheduler,
    camera,
    rig,
    fx,
    sound: { play: (n) => void sounds.push(n) },
    introFx,
    world,
    leaderId: LEADER,
    bossId: boss.id,
  });
  // 基准：直接开战时的开场姿态（待机时间固定为 0）
  for (const v of views.values()) v.update(0, 0);
  const baseline = new Map([...views].map(([id, v]) => [id, poseSnapshot(v)]));
  return { scheduler, views, boss, world, intro, introFx, frames, sounds, baseline, shakes: () => shakes };
}

/** 探索模式里的样子：只有队长和 Boss 显示，队长在 at、面向 Boss */
function exploreLayout(views: Map<string, UnitView>, boss: UnitView, world: ExploreWorld, at: { x: number; z: number }): IntroStart {
  const p = nearestStandable(world, at.x, at.z);
  const yaw = yawOf(boss.home.x - p.x, boss.home.z - p.z);
  for (const v of views.values()) v.model.visible = v.id === LEADER || v === boss;
  views.get(LEADER)!.placeAt(p.x, p.z, yaw);
  return { leader: { x: p.x, z: p.z, yaw }, camera: { x: p.x, y: 1.2, z: p.z, distance: 17 } };
}

interface Watch {
  frames: number;
  /** 全程离障碍物的最小余量（身体在障碍物上方越过时不算） */
  worstObstacle: number;
  /** 两人在空中的最小间距 */
  worstSeparation: number;
  maxHeight: number;
  /** 每帧可见的队员数（显形顺序） */
  shownAt: number[];
}

async function play(
  s: ReturnType<typeof setup>,
  start: IntroStart,
  tweak?: (frame: number, scheduler: Scheduler) => void,
): Promise<{ watch: Watch; report: Awaited<ReturnType<IntroCutscene['play']>> }> {
  const { scheduler, views, world } = s;
  let done = false;
  let report: Awaited<ReturnType<IntroCutscene['play']>> | null = null;
  void s.intro.play(start).then((r) => {
    report = r;
    done = true;
  });
  const watch: Watch = { frames: 0, worstObstacle: Infinity, worstSeparation: Infinity, maxHeight: 0, shownAt: [] };
  const H = INTRO_CONFIG.obstacleHeight;
  const heroes = [...views.values()].filter((v) => v.side === 'ally' && v.kind === 'hero');
  for (let i = 0; i < 20000 && !done; i++) {
    tweak?.(i, scheduler);
    scheduler.update(1 / 60);
    for (const v of views.values()) v.update(scheduler.time, i / 60);
    await new Promise((r) => setImmediate(r));
    watch.frames += 1;
    // 人物不穿过障碍物（地面投影离得够远，或从上方越过）
    for (const v of heroes) {
      if (!v.model.visible) continue;
      const g = v.groundPosition;
      const y = v.stuntHeight;
      watch.maxHeight = Math.max(watch.maxHeight, y);
      for (const o of world.obstacles) {
        const d = obstacleDistance(o, g.x, g.z) - 0.4; // 身体半径
        const over = y - (H[o.tag] ?? Infinity);
        watch.worstObstacle = Math.min(watch.worstObstacle, Math.max(d, over));
      }
    }
    for (let a = 0; a < heroes.length; a++) {
      for (let b = a + 1; b < heroes.length; b++) {
        const p = heroes[a]!;
        const q = heroes[b]!;
        if (!p.model.visible || !q.model.visible) continue;
        if (p.stuntHeight <= 0.05 && q.stuntHeight <= 0.05) continue;
        const gp = p.groundPosition;
        const gq = q.groundPosition;
        watch.worstSeparation = Math.min(watch.worstSeparation, Math.hypot(gp.x - gq.x, gp.z - gq.z, p.stuntHeight - q.stuntHeight));
      }
    }
    watch.shownAt.push(heroes.filter((v) => v.model.visible).length);
  }
  if (!done) throw new Error('过场没有结束（卡死）');
  return { watch, report: report! };
}

/** 结束后的状态：与“直接开战”的开场完全一致 */
function expectBattleReady(s: ReturnType<typeof setup>): void {
  const { views, baseline, intro, introFx, scheduler, frames } = s;
  for (const v of views.values()) v.update(scheduler.time, 0);
  for (const [id, v] of views) {
    expect(v.model.visible, `${id} 显示`).toBe(true);
    const g = v.groundPosition;
    expect(Math.hypot(g.x - v.home.x, g.z - v.home.z), `${id} 在格子上`).toBe(0);
    expect(g.yaw, `${id} 朝向`).toBeCloseTo(yawOf(v.facing.x, v.facing.z), 12);
    expect(v.stuntActive, `${id} 特技层清空`).toBe(false);
    expect(v.away, `${id} 没有离开站位`).toBe(false);
    expect(poseDiff(baseline.get(id)!, poseSnapshot(v), 1e-6), `${id} 姿态复位`).toEqual([]);
  }
  expect(intro.shadedUnits()).toEqual([]);
  expect(introFx.activeCount).toBe(0);
  expect(scheduler.pending).toBe(0);
  expect(frames.at(-1)).toBeNull(); // 相机回到战斗机位
  expect(intro.active).toBe(false);
}

const BOSS_FACING = facingOf('enemy');

describe('入场过场（真实模型）', () => {
  it('1 倍速：队员先显形，再被震飞落到格子上（落点误差 0），宝宝最后入场；结束时与直接开战的开场完全一致', async () => {
    const s = setup();
    const talk = { x: s.boss.home.x + BOSS_FACING.x * 4, z: s.boss.home.z + BOSS_FACING.z * 4 };
    const start = exploreLayout(s.views, s.boss, s.world, talk);
    const { watch, report } = await play(s, start);
    // 时长：约 6 秒（1 倍速）
    const seconds = watch.frames / 60;
    expect(seconds).toBeGreaterThan(5);
    expect(seconds).toBeLessThan(8.5);
    // 落点误差为 0
    for (const id of ['A0', 'A1', 'A2', 'A3', 'A4']) expect(report.landing[id], id).toBe(0);
    for (const [id, f] of Object.entries(report.final)) {
      expect(f.dist, id).toBe(0);
      expect(f.visible, id).toBe(true);
    }
    // 显形：一开始只有队长，之后 5 人都出现
    expect(watch.shownAt[0]).toBe(1);
    expect(watch.shownAt.at(-1)).toBe(5);
    // 不穿过障碍物、空中不相撞、确实被震飞到空中
    expect(watch.worstObstacle).toBeGreaterThanOrEqual(0);
    expect(watch.worstSeparation).toBeGreaterThanOrEqual(0.9);
    expect(watch.maxHeight).toBeGreaterThan(2.3);
    expect(s.sounds).toEqual(expect.arrayContaining(['shadow', 'roar', 'quake']));
    expect(s.shakes()).toBeGreaterThan(3);
    expectBattleReady(s);
  }, 120_000);

  it('2 倍速：时长减半，结果相同', async () => {
    const s = setup();
    s.scheduler.setTimeScale(2);
    const start = exploreLayout(s.views, s.boss, s.world, EXPLORE_CONFIG.start);
    const { watch, report } = await play(s, start);
    expect(watch.frames / 60).toBeLessThan(4.3);
    for (const id of ['A0', 'A1', 'A2', 'A3', 'A4']) expect(report.landing[id], id).toBe(0);
    expect(watch.worstObstacle).toBeGreaterThanOrEqual(0);
    expectBattleReady(s);
  }, 120_000);

  it('一开始就跳过动画：不用推进时间就走完，所有单位直接到最终位置和姿态', async () => {
    const s = setup();
    s.scheduler.setSkip(true);
    const start = exploreLayout(s.views, s.boss, s.world, { x: -9, z: 1 });
    const report = await s.intro.play(start);
    expect(report.skipped).toBe(true);
    for (const id of ['A0', 'A1', 'A2', 'A3', 'A4']) expect(report.landing[id], id).toBe(0);
    expectBattleReady(s);
  }, 120_000);

  it('中途打开跳过动画（被震飞的半空中）：立即走完，结果与正常播放一致；切换倍速、暂停也不影响结果', async () => {
    const s = setup();
    const start = exploreLayout(s.views, s.boss, s.world, { x: 1, z: -9 });
    let pausedAt = -1;
    let frozen: { x: number; z: number } | null = null;
    const { report } = await play(s, start, (frame, scheduler) => {
      if (frame === 40) scheduler.setTimeScale(2);
      if (frame === 60) {
        scheduler.setPaused(true);
        pausedAt = frame;
        frozen = s.views.get('A2')!.groundPosition;
      }
      if (frame === 90) {
        // 暂停期间什么都没动
        const g = s.views.get('A2')!.groundPosition;
        expect(g.x).toBe(frozen!.x);
        expect(g.z).toBe(frozen!.z);
        scheduler.setPaused(false);
      }
      if (frame === 150) scheduler.setSkip(true);
    });
    expect(pausedAt).toBe(60);
    expect(report.skipped).toBe(true);
    for (const [id, f] of Object.entries(report.final)) expect(f.dist, id).toBe(0);
    expectBattleReady(s);
  }, 120_000);

  it('连续播放两次（再挑战）：第二次同样复位，材质副本复用、没有残留', async () => {
    const s = setup();
    for (const at of [{ x: -1.5, z: -1.5 }, { x: -9, z: 1 }]) {
      const start = exploreLayout(s.views, s.boss, s.world, at);
      s.scheduler.setSkip(false);
      const { report } = await play(s, start, (frame, scheduler) => {
        if (frame === 100) scheduler.setSkip(true);
      });
      expect(Object.values(report.final).every((f) => f.dist === 0 && f.visible)).toBe(true);
      expectBattleReady(s);
    }
  }, 120_000);
});

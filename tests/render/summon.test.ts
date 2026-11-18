import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Mesh, Object3D } from 'three';
import { SUMMON_CONFIG } from '../../src/data/cutsceneConfig';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { ExploreWorld } from '../../src/explore/exploreWorld';
import { nearestStandable } from '../../src/explore/introPlan';
import { yawOf } from '../../src/explore/walker';
import type { BattleCamera } from '../../src/render/camera/battleCamera';
import type { CameraRig } from '../../src/render/camera/CameraRig';
import { IntroCutscene } from '../../src/render/cutscene/introCutscene';
import { IntroFx } from '../../src/render/cutscene/introFx';
import { SummonCutscene, type SummonOptions, type SummonReport } from '../../src/render/cutscene/summonCutscene';
import { SummonFx } from '../../src/render/cutscene/summonFx';
import { BoneAssembly } from '../../src/render/cutscene/boneAssembly';
import { Scheduler } from '../../src/render/director/Scheduler';
import type { BattleStage } from '../../src/render/units/BattleStage';
import type { UnitView } from '../../src/render/units/UnitView';
import { createRealViews, cutsceneFx, poseDiff, poseSnapshot } from './realStage';

// 召唤演出（步骤 18）：真实模型、真实 UnitView、真实调度器，按帧推进。
// 检查：出场时序（按批次、光束先到）、骷髅兵逐部件拼合 / 盔甲落下 / 眼火点亮、亡灵法师骨杖最后出现；
// 跳过（开头 / 中途）后的最终状态；暂停；重复召唤后的完全复位；过场期间没有任何单位进入战斗动作。

function setup() {
  const scheduler = new Scheduler();
  const views = createRealViews(scheduler);
  const boss = [...views.values()].find((v) => v.side === 'enemy' && v.radius > 1)!;
  const sounds: string[] = [];
  let shakes = 0;
  const stage = {
    views,
    unit: (id: string) => views.get(id)!,
    reset: () => {
      scheduler.flush();
      for (const v of views.values()) v.reset();
    },
  } as unknown as BattleStage;
  const fx = cutsceneFx(scheduler);
  const summonFx = new SummonFx();
  const rig = { shake: () => void (shakes += 1) } as unknown as CameraRig;
  const sound = { play: (n: string) => void sounds.push(n) };
  const summon = new SummonCutscene({ stage, scheduler, fx, rig, sound, summonFx, bossId: boss.id });
  for (const v of views.values()) v.update(0, 0);
  const baseline = new Map([...views].map(([id, v]) => [id, poseSnapshot(v)]));
  const prints = new Map([...views].map(([id, v]) => [id, fingerprint(v.model)]));
  return { scheduler, views, boss, stage, fx, summonFx, summon, sounds, rig, baseline, prints, shakes: () => shakes };
}

/** 模型里每个节点的位置、朝向、缩放、显隐，以及网格用的材质：召唤前后必须完全相同 */
function fingerprint(model: Object3D): string[] {
  const out: string[] = [];
  model.traverse((o) => {
    if (o === model) return; // 根节点由 UnitView 每帧摆放，另外用姿态指纹核对
    const mat = (o as Mesh).isMesh ? (o as Mesh).material : null;
    const mats = mat ? (Array.isArray(mat) ? mat : [mat]).map((m) => m.uuid).join('+') : '';
    out.push(
      [o.name, ...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray(), o.visible, mats]
        .map((n) => (typeof n === 'number' ? n.toFixed(9) : String(n)))
        .join(','),
    );
  });
  return out;
}

interface Sample {
  time: number;
  visible: Record<string, boolean>;
}

/** 按帧推进召唤；every 每帧调用一次（time = 召唤开始后的演出时间） */
async function run(
  s: ReturnType<typeof setup>,
  opts: SummonOptions = {},
  every?: (frame: number, time: number) => void,
): Promise<{ report: SummonReport; frames: number; samples: Sample[]; busyFrames: number; fxSeen: number }> {
  const { scheduler, views, summon } = s;
  let done = false;
  let report: SummonReport | null = null;
  const t0 = scheduler.time;
  void summon.play(opts).then((r) => {
    report = r;
    done = true;
  });
  const samples: Sample[] = [];
  let busyFrames = 0;
  let fxSeen = 0;
  let frames = 0;
  for (let i = 0; i < 20000 && !done; i++) {
    scheduler.update(1 / 60);
    for (const v of views.values()) v.update(scheduler.time, 0);
    await new Promise((r) => setImmediate(r));
    frames += 1;
    const time = scheduler.time - t0;
    every?.(i, time);
    samples.push({ time, visible: Object.fromEntries([...views].map(([id, v]) => [id, v.model.visible])) });
    // 过场期间没有任何战斗行动：没有单位在出手 / 冲锋 / 离开站位
    for (const v of views.values()) if (v.phase !== 'idle' || v.away) busyFrames += 1;
    fxSeen = Math.max(fxSeen, s.summonFx.activeCount);
  }
  if (!done) throw new Error('召唤没有结束（卡死）');
  return { report: report!, frames, samples, busyFrames, fxSeen };
}

/** 召唤结束后：所有小怪完整显示在阵位上，姿态、部件、材质与召唤前完全一致，没有残留特效 */
function expectComplete(s: ReturnType<typeof setup>): void {
  const { views, baseline, prints, summon, summonFx, scheduler } = s;
  for (const v of views.values()) v.update(scheduler.time, 0);
  for (const [id, v] of views) {
    expect(v.model.visible, `${id} 显示`).toBe(true);
    const g = v.groundPosition;
    expect(Math.hypot(g.x - v.home.x, g.z - v.home.z), `${id} 在阵位上`).toBe(0);
    expect(g.yaw, `${id} 朝向`).toBeCloseTo(yawOf(v.facing.x, v.facing.z), 12);
    expect(v.stuntActive, `${id} 特技层清空`).toBe(false);
    expect(poseDiff(baseline.get(id)!, poseSnapshot(v), 1e-6), `${id} 姿态复位`).toEqual([]);
    expect(fingerprint(v.model), `${id} 部件位置 / 显隐 / 材质复位`).toEqual(prints.get(id));
  }
  expect(summon.shadedUnits()).toEqual([]);
  expect(summon.unrestoredUnits()).toEqual([]);
  expect(summonFx.activeCount).toBe(0);
  expect(scheduler.pending).toBe(0);
  expect(summon.active).toBe(false);
}

const byTemplate = (s: ReturnType<typeof setup>, key: string): UnitView[] => s.summon.minions.filter((v) => v.templateKey === key);

describe('召唤演出：时间轴（配置）', () => {
  it('骷髅兵的每块骨头都在盔甲落下之前拼完', () => {
    const s = setup();
    const B = SUMMON_CONFIG.bones;
    const skeleton = byTemplate(s, 'enemy_skeleton')[0]!;
    const counts = new BoneAssembly(skeleton.model).counts.parts;
    const last = Math.max(...Object.entries(counts).map(([part, n]) => (B.parts[part] ?? 0) + (n - 1) * B.stagger + B.fly));
    expect(last).toBeLessThan(B.gearAt - 0.04);
  });

  it('按配置分批：骷髅兵 → 堕落骑士 → 亡灵法师 → 恶魔祭司；光束先到再出场；整段 5~7 秒', () => {
    const s = setup();
    const tl = s.summon.timeline();
    expect(tl.entries).toHaveLength(9);
    expect(tl.entries.map((e) => e.id).sort()).toEqual(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E8', 'E9']);
    const order = ['enemy_skeleton', 'enemy_fallen_knight', 'enemy_necromancer', 'enemy_demon_priest'];
    for (const e of tl.entries) {
      const v = s.views.get(e.id)!;
      expect(e.batch, e.id).toBe(order.indexOf(v.templateKey));
      expect(e.style, e.id).toBe(SUMMON_CONFIG.styles[v.templateKey]);
      expect(e.beamAt, e.id).not.toBeNull();
      expect(e.startAt - e.beamAt!, `${e.id} 光束飞到才出场`).toBeCloseTo(SUMMON_CONFIG.beam.travel, 9);
      expect(e.beamAt!, `${e.id} 在 Boss 举臂之后`).toBeGreaterThanOrEqual(SUMMON_CONFIG.cast.raise);
    }
    // 后一批整体晚于前一批开始；同一批内按间隔错开
    for (let b = 1; b < 4; b++) {
      const prev = Math.max(...tl.entries.filter((e) => e.batch === b - 1).map((e) => e.startAt));
      const cur = Math.min(...tl.entries.filter((e) => e.batch === b).map((e) => e.startAt));
      expect(cur, `第 ${b} 批`).toBeGreaterThan(prev);
    }
    const skel = tl.entries.filter((e) => e.batch === 0).map((e) => e.startAt);
    expect(skel[1]! - skel[0]!).toBeCloseTo(SUMMON_CONFIG.batches[0]!.stagger, 9);
    // 全部就位后才短吼
    expect(tl.roarAt!).toBeGreaterThan(Math.max(...tl.entries.map((e) => e.endAt)));
    expect(tl.endAt).toBeGreaterThanOrEqual(5);
    expect(tl.endAt).toBeLessThanOrEqual(7);
  });

  it('入场过场：召唤在宝宝全部就位、镜头到达战斗视角之后开始，整段过场的结束时刻包含召唤', () => {
    const s = setup();
    const world = new ExploreWorld(s.boss.home);
    const intro = new IntroCutscene({
      stage: s.stage,
      scheduler: s.scheduler,
      camera: { setFrame: () => undefined } as unknown as BattleCamera,
      rig: s.rig,
      fx: s.fx,
      sound: { play: () => undefined },
      introFx: new IntroFx(),
      world,
      leaderId: EXPLORE_CONFIG.leaderId,
      bossId: s.boss.id,
    });
    const p = nearestStandable(world, EXPLORE_CONFIG.start.x, EXPLORE_CONFIG.start.z);
    const plan = intro.makePlan({ leader: { x: p.x, z: p.z, yaw: 0 }, camera: { x: p.x, y: 1.2, z: p.z, distance: 17 } });
    const petsEnd = Math.max(...plan.pets.map((e) => plan.petsAt + e.start + e.duration));
    expect(plan.summonAt).toBeGreaterThan(petsEnd);
    expect(plan.summonAt).toBeGreaterThanOrEqual(0.6 + 1.6); // 镜头过渡结束
    expect(plan.endAt).toBeCloseTo(plan.summonAt + intro.summon.timeline().endAt, 9);
  });
});

describe('召唤演出（真实模型）', () => {
  it('1 倍速：按批次依次出场，骷髅兵逐部件拼合、盔甲后落、眼火最后点亮，骨杖最后出现；结束后完全复位', async () => {
    const s = setup();
    const tl = s.summon.timeline();
    const skeleton = byTemplate(s, 'enemy_skeleton')[0]!;
    const necro = byTemplate(s, 'enemy_necromancer')[0]!;
    const sk = tl.entries.find((e) => e.id === skeleton.id)!;
    const ne = tl.entries.find((e) => e.id === necro.id)!;
    const B = SUMMON_CONFIG.bones;
    const W = SUMMON_CONFIG.wisps;
    const checks: string[] = [];
    let bonesTotal = 0;
    const { report, frames, samples, busyFrames, fxSeen } = await run(s, {}, (_f, time) => {
      const asm = s.summon.assemblyOf(skeleton.id);
      const local = time - sk.startAt;
      if (asm && local > 0.25 && local < 0.35) {
        // 刚开始拼：脊椎已经在飞，四肢还没出来；盔甲、眼火都没有
        bonesTotal = asm.counts.bones;
        expect(asm.bonesInPlace).toBeLessThan(asm.counts.bones);
        expect(asm.eyesLit).toBe(false);
        checks.push('early');
      }
      if (asm && local > B.gearAt - 0.04 && local < B.gearAt - 0.002) {
        // 骨架拼完、盔甲还没落下
        expect(asm.bonesInPlace).toBe(asm.counts.bones);
        expect(asm.eyesLit).toBe(false);
        checks.push('bones');
      }
      if (asm && local > B.eyesAt + 0.05 && local < B.duration - 0.05) {
        expect(asm.eyesLit).toBe(true);
        checks.push('eyes');
      }
      const staff = necro.model.getObjectByName('joint:weaponMount')!;
      const nl = time - ne.startAt;
      if (nl > W.appearAt + 0.1 && nl < W.staffAt - 0.05) {
        // 灵魂已显现，骨杖还没出现
        expect(necro.model.visible).toBe(true);
        expect(staff.visible).toBe(false);
        checks.push('staff-hidden');
      }
      if (nl > W.staffAt + 0.05) {
        expect(staff.visible).toBe(true);
        checks.push('staff');
      }
    });
    expect(new Set(checks)).toEqual(new Set(['early', 'bones', 'eyes', 'staff-hidden', 'staff']));
    // 骨架按部件拆开：五类都有，腿是单独的部件
    const counts = s.summon.assemblyOf(skeleton.id)!.counts;
    expect(bonesTotal).toBe(counts.bones);
    for (const part of ['spine', 'ribs', 'skull', 'arms', 'legs'] as const) expect(counts.parts[part], part).toBeGreaterThan(0);
    expect(counts.gear).toBeGreaterThan(0);
    expect(counts.eyes).toBeGreaterThan(0);
    // 时长：5~7 秒（1 倍速）
    expect(frames / 60).toBeGreaterThanOrEqual(5);
    expect(frames / 60).toBeLessThanOrEqual(7.1);
    // 每只在自己的出场时刻之前都看不见；出场顺序与批次一致
    for (const e of tl.entries) {
      const before = samples.filter((p) => p.time < e.startAt - 1e-6);
      expect(before.every((p) => !p.visible[e.id]), `${e.id} 出场前隐藏`).toBe(true);
      expect(report.appeared[e.id], e.id).toBeGreaterThanOrEqual(e.startAt - 1e-6);
      expect(report.ready[e.id], e.id).toBeGreaterThanOrEqual(e.endAt - 1 / 30);
    }
    for (const a of tl.entries) {
      for (const b of tl.entries) if (a.batch < b.batch) expect(report.appeared[a.id]!).toBeLessThan(report.appeared[b.id]!);
    }
    expect(report.roared).toBe(true);
    expect(report.skipped).toBe(false);
    expect(s.sounds).toEqual(expect.arrayContaining(['cast', 'bolt', 'roar']));
    expect(fxSeen).toBeGreaterThan(3); // 法阵、光束、阵位贴花确实出现过
    expect(s.fx.emitted).toBeGreaterThan(100);
    expect(busyFrames).toBe(0); // 过场期间没有任何战斗动作
    expectComplete(s);
  }, 120_000);

  it('2 倍速：时长减半，结果相同', async () => {
    const s = setup();
    s.scheduler.setTimeScale(2);
    const { frames } = await run(s);
    expect(frames / 60).toBeLessThan(3.6);
    expectComplete(s);
  }, 120_000);

  it('一开始就跳过动画：不用推进时间就走完，所有小怪完整就位、没有粒子和残留特效', async () => {
    const s = setup();
    s.scheduler.setSkip(true);
    const report = await s.summon.play();
    expect(report.skipped).toBe(true);
    expect(s.fx.emitted).toBe(0);
    expectComplete(s);
  });

  it('中途跳过（骷髅兵拼到一半、光束在飞）：立即走完，与正常播放的结果一致；暂停期间画面停住', async () => {
    const s = setup();
    const skeleton = byTemplate(s, 'enemy_skeleton')[0]!;
    let frozen: string[] | null = null;
    const { report } = await run(s, {}, (frame) => {
      if (frame === 50) {
        s.scheduler.setPaused(true);
        frozen = fingerprint(skeleton.model);
      }
      if (frame === 70) {
        expect(fingerprint(skeleton.model)).toEqual(frozen);
        s.scheduler.setPaused(false);
      }
      if (frame === 85) s.scheduler.setSkip(true);
    });
    expect(report.skipped).toBe(true);
    expectComplete(s);
  }, 120_000);

  it('重复召唤（第二次开战）：开始前完全复位，第二次的每一帧与第一次相同', async () => {
    const s = setup();
    const ids = s.summon.minions.map((v) => v.id);
    const record = async (): Promise<{ report: SummonReport; frames: string[][] }> => {
      const frames: string[][] = [];
      const { report } = await run(s, {}, (frame) => {
        // 抽几帧记下所有小怪的部件状态（拼到一半、灵魂半透明、法阵升起中）
        if (frame % 23 === 0) frames.push(ids.flatMap((id) => fingerprint(s.views.get(id)!.model)));
      });
      return { report, frames };
    };
    const first = await record();
    expectComplete(s);
    // 第二次之前故意弄乱：小怪全部显示、站在别处（召唤开始时必须自己复位）
    for (const v of s.summon.minions) {
      v.model.visible = true;
      v.placeAt(v.home.x + 3, v.home.z - 2, 1);
    }
    const second = await record();
    expectComplete(s);
    for (const id of ids) expect(second.report.appeared[id]!, id).toBeCloseTo(first.report.appeared[id]!, 9);
    expect(second.frames).toEqual(first.frames);
  }, 120_000);

  it('召唤演示：单独播放一种小怪（没有施法段），只有这一种出场，结束后同样完整复位', async () => {
    const s = setup();
    for (const style of ['bones', 'soul', 'wisps', 'rise'] as const) {
      const ids = s.summon.minions.filter((v) => s.summon.styleOf(v) === style).map((v) => v.id);
      expect(ids.length, style).toBeGreaterThan(0);
      const tl = s.summon.timeline({ ids, cast: false, roar: false });
      expect(tl.entries.map((e) => e.id)).toEqual(ids);
      expect(Math.min(...tl.entries.map((e) => e.startAt))).toBe(0);
      const others = s.summon.minions.filter((v) => !ids.includes(v.id));
      const { report } = await run(s, { ids, cast: false, roar: false }, () => {
        for (const v of others) expect(v.model.visible, `${v.id} 不受影响`).toBe(true);
      });
      expect(Object.keys(report.appeared).sort()).toEqual([...ids].sort());
      expect(report.roared).toBe(false);
      expectComplete(s);
    }
  }, 120_000);

  it('召唤模块不依赖战斗引擎（过场期间不可能产生战斗行动：引擎在过场结束后才建）', () => {
    for (const file of ['src/render/cutscene/summonCutscene.ts', 'src/render/cutscene/boneAssembly.ts', 'src/render/cutscene/summonFx.ts', 'src/render/cutscene/introCutscene.ts']) {
      const src = readFileSync(file, 'utf8');
      const runtime = [...src.matchAll(/^import\s+(?!type\b)[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]!).filter((p) => p.includes('/core/'));
      expect(runtime, file).toEqual([]);
    }
  });
});

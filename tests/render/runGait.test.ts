import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getRig } from '../../src/assets/models/characters/rig';
import { EXPLORE_CONFIG, RUN_GAIT, WALK_GAIT } from '../../src/data/exploreConfig';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { SECONDARY_MOTION } from '../../src/data/attackAnimConfig';
import { Scheduler } from '../../src/render/director/Scheduler';
import { legAngles, type LegDims } from '../../src/render/units/legPose';
import type { UnitView } from '../../src/render/units/UnitView';
import { gaitParams, runWeight, WalkGait } from '../../src/render/units/walkGait';
import { createRealViews } from './realStage';

// 步骤 15：跑步步态（DESIGN §11.5）。不是把走路加速：有腾空、前倾更多、提膝更高、屈肘大幅摆臂、起伏更明显、披风甩得更开；
// 支撑脚同样不滑；起跑、停步平滑。

const DT = 1 / 60;
const DIMS: LegDims = { hipHeight: 0.9, thigh: 0.42, shin: 0.4 };
const RUN = EXPLORE_CONFIG.move.runSpeed;

interface Sample {
  stanceL: boolean;
  stanceR: boolean;
  /** 两只脚在“地面坐标”里的位置（累计距离 + 相对身体的位置） */
  groundL: number;
  groundR: number;
  yL: number;
  yR: number;
  drop: number;
  lean: number;
  elbowL: number;
  shoulderL: number;
  thighL: number;
}

/** 以恒定速度跑 seconds 秒，逐帧采样（先跑 1 秒进入稳态） */
function steady(speed: number, seconds = 2): Sample[] {
  const g = new WalkGait(DIMS);
  let x = 0;
  const out: Sample[] = [];
  const frames = Math.round((1 + seconds) / DT);
  for (let i = 0; i < frames; i++) {
    g.advance(speed * DT, DT);
    x += speed * DT;
    const o = g.sample();
    if (i * DT < 1) continue;
    const ang = legAngles(DIMS, o.left, o.leanFull, -o.dropFull);
    out.push({
      stanceL: o.left.stance,
      stanceR: o.right.stance,
      groundL: x + o.left.contactZ,
      groundR: x + o.right.contactZ,
      yL: o.left.y,
      yR: o.right.y,
      drop: o.dropFull,
      lean: o.lean,
      elbowL: o.elbowL,
      shoulderL: o.shoulderL,
      // 大腿在世界里向前抬起的角度 = 相对身体的角度 − 身体前倾
      thighL: -ang.hip - o.leanFull,
    });
  }
  return out;
}

const range = (v: number[]): number => Math.max(...v) - Math.min(...v);

describe('步骤 15：跑步步态（纯计算）', () => {
  it('跑步权重：走速及以下为 0（与步骤 14 的走路完全一样），runFull 以上为 1，中间连续', () => {
    expect(runWeight(0)).toBe(0);
    expect(runWeight(WALK_GAIT.dutySpeed[1])).toBe(0);
    expect(runWeight(RUN_GAIT.runFull)).toBe(1);
    expect(runWeight(RUN)).toBe(1);
    const p = gaitParams(3.2);
    expect(p.run).toBe(0);
    expect(p.duty).toBe(WALK_GAIT.dutyFast);
    expect(p.peak).toBe(0.5);
    let prev = gaitParams(3.2);
    for (let v = 3.25; v <= 6.4; v += 0.05) {
      const q = gaitParams(v);
      expect(Math.abs(q.cycle - prev.cycle)).toBeLessThan(0.08); // 速度每变 0.05 米/秒，周期长度连续变化
      expect(Math.abs(q.duty - prev.duty)).toBeLessThan(0.02);
      prev = q;
    }
  });

  it('跑速下有腾空：每个周期里两脚同时离地的时间约占 1 − 2·duty（走路时为 0）', () => {
    const run = steady(RUN);
    const flight = run.filter((s) => !s.stanceL && !s.stanceR).length / run.length;
    expect(flight).toBeGreaterThan(1 - 2 * RUN_GAIT.duty - 0.06);
    expect(flight).toBeLessThan(1 - 2 * RUN_GAIT.duty + 0.06);
    const walk = steady(3.2);
    expect(walk.filter((s) => !s.stanceL && !s.stanceR)).toHaveLength(0);
  });

  it('支撑脚不滑：着地期间脚在地面上的位置不变（跑速、起跑加速、停步减速都一样）', () => {
    const g = new WalkGait(DIMS);
    let x = 0;
    let v = 0;
    let lastL: number | null = null;
    let lastR: number | null = null;
    let worst = 0;
    let checked = 0;
    for (let i = 0; i < 360; i++) {
      // 0~1 秒加速到 6.4，1~3 秒匀速，3~4 秒减速
      const t = i * DT;
      v = t < 1 ? Math.min(RUN, v + EXPLORE_CONFIG.move.accel * DT) : t < 3 ? RUN : Math.max(0.5, v - EXPLORE_CONFIG.move.arriveDecel * DT);
      g.advance(v * DT, DT);
      x += v * DT;
      const o = g.sample();
      const gl = o.left.contact === 'ankle' ? x + o.left.contactZ : null;
      const gr = o.right.contact === 'ankle' ? x + o.right.contactZ : null;
      if (gl !== null && lastL !== null) {
        worst = Math.max(worst, Math.abs(gl - lastL));
        checked += 1;
      }
      if (gr !== null && lastR !== null) {
        worst = Math.max(worst, Math.abs(gr - lastR));
        checked += 1;
      }
      lastL = gl;
      lastR = gr;
    }
    expect(checked).toBeGreaterThan(40);
    expect(worst).toBeLessThan(1e-9);
  });

  it('比走路：摆动脚抬得高得多、大腿前抬（提膝）更高、身体起伏更明显、前倾更多', () => {
    const run = steady(RUN);
    const walk = steady(3.2);
    const maxY = (s: Sample[]): number => Math.max(...s.map((x) => Math.max(x.yL, x.yR)));
    expect(maxY(run)).toBeGreaterThan(RUN_GAIT.lift * 0.8);
    expect(maxY(run)).toBeGreaterThan(maxY(walk) * 1.6);
    // 提膝：大腿向前抬起的最大角度
    const thigh = (s: Sample[]): number => Math.max(...s.map((x) => x.thighL));
    expect(thigh(run)).toBeGreaterThan(thigh(walk) + 0.12);
    expect(thigh(run)).toBeGreaterThan(0.95); // 大腿前抬超过 54°（走路约 49°）
    expect(range(run.map((s) => s.drop))).toBeGreaterThan(range(walk.map((s) => s.drop)) * 1.5);
    expect(Math.min(...run.map((s) => s.lean))).toBeGreaterThan(Math.max(...walk.map((s) => s.lean)) * 2);
  });

  it('起伏：支撑中段最低、腾空中段最高（每步一次）', () => {
    const run = steady(RUN);
    const both = run.filter((s) => !s.stanceL && !s.stanceR).map((s) => s.drop);
    const single = run.filter((s) => s.stanceL !== s.stanceR).map((s) => s.drop);
    // 腾空时身体比支撑时高（下沉量小）
    expect(Math.max(...both)).toBeLessThan(Math.max(...single));
    expect(Math.min(...both)).toBeLessThan(Math.min(...single) + 1e-9);
  });

  it('手臂：肘始终明显屈起（约 75°），肩的摆幅比走路大', () => {
    const run = steady(RUN);
    const walk = steady(3.2);
    expect(Math.max(...run.map((s) => s.elbowL))).toBeLessThan(-1.1);
    expect(range(run.map((s) => s.shoulderL))).toBeGreaterThan(range(walk.map((s) => s.shoulderL)) * 1.3);
  });

  it('停步：权重平滑降到 0，输出回到站姿；跑步程度（披风用）随之归零', () => {
    const g = new WalkGait(DIMS);
    for (let i = 0; i < 120; i++) g.advance(RUN * DT, DT);
    g.sample();
    expect(g.run).toBeGreaterThan(0.99);
    let prevW = g.weight;
    for (let i = 0; i < 90; i++) {
      g.advance(0, DT);
      g.sample();
      expect(prevW - g.weight).toBeLessThan(0.15); // 每帧变化有限
      prevW = g.weight;
    }
    expect(g.weight).toBe(0);
    expect(g.run).toBe(0);
  });
});

// ----------------------------------------------------------------------
// 真实模型
// ----------------------------------------------------------------------

const HEROES = ALLY_TEMPLATES.filter((t) => t.kind === 'hero');
const world = (o: { getWorldPosition(v: Vector3): Vector3 }): Vector3 => o.getWorldPosition(new Vector3());

function heroView(id: string): UnitView {
  const t = ALLY_TEMPLATES.find((u) => u.id === id)!;
  return createRealViews(new Scheduler(), [t]).get(id)!;
}

describe('步骤 15：跑步（真实模型）', () => {
  it.each(HEROES.map((t) => [t.id, t.name]))('%s（%s）：6.4 米/秒时支撑脚不滑、不陷地，两脚同时离地的腾空确实出现', (id) => {
    const view = heroView(id);
    const rig = getRig(view.model)!;
    view.placeAt(0, 0, Math.PI / 2);
    view.update(0, 0);
    view.model.updateMatrixWorld(true);
    const ankle0 = (rig.hips.position.y - rig.legL.knee.position.length() - rig.legL.foot.position.length()) * view.model.scale.y;
    const gait = (view as unknown as { legs: { walk: { out: { left: { stance: boolean; contact: string }; right: { stance: boolean; contact: string } } } } }).legs.walk;
    const feet = [
      { joint: rig.legL.foot, side: 'left' as const },
      { joint: rig.legR.foot, side: 'right' as const },
    ];
    const last = new Map<string, Vector3>();
    let maxSlip = 0;
    let checked = 0;
    let minY = Infinity;
    let flight = 0;
    let frames = 0;
    let x = 0;
    let t = 0;
    for (let i = 0; i < 180; i++) {
      t += DT;
      x += RUN * DT;
      view.locomote(x, 0, Math.PI / 2);
      view.update(t, t);
      view.model.updateMatrixWorld(true);
      if (i < 60) continue;
      frames += 1;
      let airborne = 0;
      for (const f of feet) {
        const p = world(f.joint);
        minY = Math.min(minY, p.y);
        if (p.y > ankle0 + 0.01) airborne += 1;
        const s = gait.out[f.side];
        if (s.stance && s.contact === 'ankle') {
          const prev = last.get(f.side);
          if (prev) {
            maxSlip = Math.max(maxSlip, Math.hypot(p.x - prev.x, p.z - prev.z));
            checked += 1;
          }
          last.set(f.side, p);
        } else last.delete(f.side);
      }
      if (airborne === 2) flight += 1;
    }
    expect(view.walkWeight).toBeGreaterThan(0.99);
    expect(checked).toBeGreaterThan(10);
    // 每帧身体前进 10.7 厘米，着地的脚移动不超过 3 毫米
    expect(maxSlip).toBeLessThan(0.003);
    expect(minY).toBeGreaterThan(ankle0 - 0.005);
    expect(flight / frames).toBeGreaterThan(0.3);
  });

  it('披风被甩得更开：跑步时次级运动的偏移量超过走路时的上限', () => {
    const view = heroView('A1');
    const motion = (view as unknown as { act: { push: { x: number; y: number; z: number } } }).act;
    const sched = (view as unknown as { scheduler: Scheduler }).scheduler;
    const measure = (speed: number): number => {
      view.reset();
      view.placeAt(0, 0, Math.PI / 2);
      let x = 0;
      let t = 0;
      let peak = 0;
      for (let i = 0; i < 150; i++) {
        t += DT;
        x += speed * DT;
        sched.update(DT);
        view.locomote(x, 0, Math.PI / 2);
        view.update(t, t);
        if (i > 60) peak = Math.max(peak, Math.hypot(motion.push.x, motion.push.y, motion.push.z));
      }
      return peak;
    };
    const walk = measure(3.2);
    const run = measure(RUN);
    expect(walk).toBeLessThanOrEqual(SECONDARY_MOTION.maxOffset + 1e-9);
    expect(run).toBeGreaterThan(SECONDARY_MOTION.maxOffset * 1.3);
    expect(run).toBeLessThanOrEqual(SECONDARY_MOTION.maxOffset * (1 + RUN_GAIT.capeOffset) + 1e-9);
  });
});

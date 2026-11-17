import { describe, expect, it } from 'vitest';
import { WALK_GAIT } from '../../src/data/exploreConfig';
import { forwardLeg, legAngles, restFoot, solveLeg, type LegDims } from '../../src/render/units/legPose';
import { dropNeeded, footAt, gaitParams, WalkGait } from '../../src/render/units/walkGait';

// 步骤 14：腿部两段骨骼 IK 与行走步态（纯计算）

const DIMS: LegDims = { hipHeight: 0.9, thigh: 0.42, shin: 0.4 };
const DT = 1 / 60;

/** 身体前倾 pitch、根节点离地 lift 时，按关节转角正向算出踝关节的地面坐标（相对根节点） */
function ankleWorld(d: LegDims, hip: number, knee: number, pitch: number, lift: number): { z: number; y: number } {
  const f = forwardLeg(d.thigh, d.shin, hip, knee);
  // 身体坐标：髋在 (0, hipHeight, 0)，踝 = 髋 + (dz, dy)；再按 pitch 转回地面坐标
  const by = d.hipHeight + f.dy;
  const bz = f.dz;
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  return { y: by * c - bz * s + lift, z: by * s + bz * c };
}

describe('腿部 IK', () => {
  it('站姿：脚在正下方地面上时三个关节都是 0（与模型原本的站姿一致）', () => {
    const a = legAngles(DIMS, restFoot(DIMS), 0, 0);
    expect(a.hip).toBeCloseTo(0, 9);
    expect(a.knee).toBeCloseTo(0, 9);
    expect(a.foot).toBeCloseTo(0, 9);
  });

  it('够得着的目标：正向运动学回到目标点，膝盖朝前弯', () => {
    for (const [dz, dy] of [
      [0.2, -0.7],
      [-0.25, -0.6],
      [0.0, -0.5],
      [0.35, -0.65],
    ] as const) {
      const { hip, knee } = solveLeg(DIMS.thigh, DIMS.shin, dz, dy);
      const f = forwardLeg(DIMS.thigh, DIMS.shin, hip, knee);
      expect(f.dz).toBeCloseTo(dz, 6);
      expect(f.dy).toBeCloseTo(dy, 6);
      expect(knee).toBeGreaterThan(0); // 正角 = 小腿向后折 = 膝盖朝前
    }
  });

  it('够不着：腿伸直指向目标', () => {
    const { hip, knee } = solveLeg(DIMS.thigh, DIMS.shin, 0.5, -1.2);
    expect(knee).toBeCloseTo(0, 9);
    expect(hip).toBeCloseTo(-Math.atan2(0.5, 1.2), 9);
  });

  it('身体下沉、前倾时屈膝：脚仍在地面上的原处，脚掌放平', () => {
    for (const [pitch, lift] of [
      [0, -0.1],
      [0.3, -0.12],
      [0.46, -0.22],
      [-0.2, -0.05],
    ] as const) {
      const a = legAngles(DIMS, restFoot(DIMS), pitch, lift);
      const w = ankleWorld(DIMS, a.hip, a.knee, pitch, lift);
      expect(w.y).toBeCloseTo(restFoot(DIMS).y, 5);
      expect(w.z).toBeCloseTo(0, 5);
      // 脚掌的总转角（身体前倾 + 髋 + 膝 + 踝）为 0 = 平放
      expect(pitch + a.hip + a.knee + a.foot).toBeCloseTo(0, 9);
    }
  });

  it('腾空时收腿：膝盖弯起，脚离开地面', () => {
    const a = legAngles(DIMS, restFoot(DIMS), 0, 0.5, 0.3);
    expect(a.knee).toBeGreaterThan(0.5);
    const w = ankleWorld(DIMS, a.hip, a.knee, 0, 0.5);
    expect(w.y).toBeGreaterThan(restFoot(DIMS).y + 0.4);
  });
});

describe('行走步态', () => {
  it('步频随速度变化：走得越快，每秒迈的步越多，步幅也越大', () => {
    const cadence = (v: number): number => (2 * v) / gaitParams(v).cycle; // 每秒步数（一个周期两步）
    expect(cadence(3.2)).toBeGreaterThan(cadence(2.2));
    expect(cadence(2.2)).toBeGreaterThan(cadence(1.2));
    expect(gaitParams(3.2).cycle).toBeGreaterThan(gaitParams(1.2).cycle);
    // 满速每秒 3.5~5 步：快步走，不是小碎步
    expect(cadence(3.2)).toBeGreaterThan(3.5);
    expect(cadence(3.2)).toBeLessThan(5);
  });

  it.each([1.2, 2.2, 3.2])('速度 %f：支撑脚的着地点在地面上不动（不滑步）', (v) => {
    const p = gaitParams(v);
    const a0 = restFoot(DIMS).y;
    // 身体以 v 匀速前进，相位按距离推进
    let maxSlip = 0;
    let checked = 0;
    for (const off of [0, 0.5]) {
      let prev: { at: number; kind: string } | null = null;
      for (let i = 0; i < 600; i++) {
        const dist = v * DT * i;
        const u = (dist / p.cycle + off) % 1;
        const f = footAt(u, p, a0);
        if (!f.stance) {
          prev = null;
          continue;
        }
        const at = dist + f.contactZ; // 着地点的世界坐标
        // 推离开始时着地点由踝（脚掌放平）换成脚尖：换的那一帧不比较
        if (prev !== null && prev.kind === f.contact) {
          maxSlip = Math.max(maxSlip, Math.abs(at - prev.at));
          checked += 1;
        }
        prev = { at, kind: f.contact };
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(maxSlip).toBeLessThan(1e-9);
  });

  it('离地、落地的瞬间摆动脚与支撑相衔接（位置连续）', () => {
    const p = gaitParams(3.2);
    const a0 = restFoot(DIMS).y;
    for (const u of [p.duty, 1]) {
      const before = footAt(u - 1e-6, p, a0);
      const after = footAt(u % 1 === 0 ? 0 : u + 1e-6, p, a0);
      expect(after.z).toBeCloseTo(before.z, 4);
      expect(after.y).toBeCloseTo(before.y, 4);
      expect(after.pitch).toBeCloseTo(before.pitch, 3);
    }
  });

  it('满速行走：着地的脚都够得着地面（身体下沉量刚好），起伏每步一次、幅度合理，脚从不陷进地面', () => {
    const gait = new WalkGait(DIMS);
    const a0 = restFoot(DIMS).y;
    const drops: number[] = [];
    let minAnkle = Infinity;
    for (let i = 0; i < 360; i++) {
      gait.advance(3.2 * DT, DT);
      const o = gait.sample();
      if (i < 120) continue; // 先走两秒到满速、满权重
      drops.push(o.drop);
      for (const f of [o.left, o.right]) {
        const a = legAngles(DIMS, f, o.lean, -o.drop);
        const w = ankleWorld(DIMS, a.hip, a.knee, o.lean, -o.drop);
        minAnkle = Math.min(minAnkle, w.y);
        if (f.stance) {
          // 着地脚：IK 精确到达目标（没有被“够不着”截断）
          expect(w.y).toBeCloseTo(f.y, 4);
          expect(w.z).toBeCloseTo(f.z, 4);
        }
      }
    }
    expect(minAnkle).toBeGreaterThan(a0 - 1e-4);
    const amp = Math.max(...drops) - Math.min(...drops);
    expect(amp).toBeGreaterThan(0.015); // 看得出起伏
    expect(amp).toBeLessThan(0.1); // 不会一蹲一蹲
    // 每步一次：一个周期里下沉量有两个峰
    const p = gaitParams(3.2);
    const framesPerCycle = Math.round(p.cycle / (3.2 * DT));
    let peaks = 0;
    for (let i = 1; i < framesPerCycle; i++) if (drops[i]! > drops[i - 1]! && drops[i]! >= drops[i + 1]!) peaks += 1;
    expect(peaks).toBe(2);
  });

  it('双臂与对侧腿同步：左脚在前时右臂向前；持武器的手摆得小', () => {
    const gait = new WalkGait(DIMS, { heldLeft: false, heldRight: true });
    let checked = 0;
    for (let i = 0; i < 240; i++) {
      gait.advance(3.2 * DT, DT);
      const o = gait.sample();
      if (i < 120 || Math.abs(o.left.z - o.right.z) < 0.2) continue;
      if (o.left.z > o.right.z) {
        expect(o.shoulderR).toBeLessThan(0); // 右臂向前（负角）
      } else {
        expect(o.shoulderL).toBeLessThan(0);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
    // 持武器的右手幅度只有空手的 heldArmScale 倍
    const free = new WalkGait(DIMS);
    const held = new WalkGait(DIMS, { heldLeft: true, heldRight: true });
    let maxFree = 0;
    let maxHeld = 0;
    for (let i = 0; i < 240; i++) {
      free.advance(3.2 * DT, DT);
      held.advance(3.2 * DT, DT);
      maxFree = Math.max(maxFree, Math.abs(free.sample().shoulderR));
      maxHeld = Math.max(maxHeld, Math.abs(held.sample().shoulderR));
    }
    expect(maxHeld / maxFree).toBeCloseTo(WALK_GAIT.heldArmScale, 2);
  });

  it('停下后平滑回到站姿：权重降到 0，身体不再下沉，手臂、袍摆不再摆动', () => {
    const gait = new WalkGait(DIMS);
    for (let i = 0; i < 120; i++) gait.advance(3.2 * DT, DT);
    expect(gait.weight).toBeGreaterThan(0.99);
    let prevDrop = gait.sample().drop;
    let maxJump = 0;
    for (let i = 0; i < 60; i++) {
      gait.advance(0, DT);
      const o = gait.sample();
      maxJump = Math.max(maxJump, Math.abs(o.drop - prevDrop));
      prevDrop = o.drop;
    }
    expect(maxJump).toBeLessThan(0.02); // 没有跳变
    expect(gait.active).toBe(false);
    const o = gait.sample();
    expect(o.drop).toBe(0);
    expect(o.strideL).toBeCloseTo(0, 12);
    expect(o.strideR).toBeCloseTo(0, 12);
    expect(o.shoulderL).toBeCloseTo(0, 12);
  });

  it('身体下沉量的要求：髋到踝不超过腿长 × reach', () => {
    const f = { x: 0, z: 0.3, y: restFoot(DIMS).y, pitch: 0 };
    const d = dropNeeded(DIMS, f, 0, DIMS.hipHeight, 0.985);
    const R = (DIMS.thigh + DIMS.shin) * 0.985;
    expect(Math.hypot(0.3, DIMS.hipHeight - d - f.y)).toBeCloseTo(R, 9);
  });
});

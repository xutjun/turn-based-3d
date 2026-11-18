import { Matrix4, Vector3, type BufferAttribute, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { getRig } from '../../src/assets/models/characters/rig';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { WALK_GAIT } from '../../src/data/exploreConfig';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { Scheduler } from '../../src/render/director/Scheduler';
import { allAnimatedJoints, LEG_JOINT_NAMES } from '../../src/render/units/animatedJoints';
import type { UnitView } from '../../src/render/units/UnitView';
import { createRealViews } from './realStage';

// 步骤 14：用真实模型（真实骨架尺寸、真实 UnitView）检查行走——不滑步、不陷进地面、停下后回到站姿；
// 以及战斗中身体下沉（下蹲蓄力、落地缓冲）时屈膝踩地。

const HEROES = ALLY_TEMPLATES.filter((t) => t.kind === 'hero');
const DT = 1 / 60;

function heroView(id: string): UnitView {
  const t = ALLY_TEMPLATES.find((u) => u.id === id)!;
  return createRealViews(new Scheduler(), [t]).get(id)!;
}

const world = (o: { getWorldPosition(v: Vector3): Vector3 }): Vector3 => o.getWorldPosition(new Vector3());

/** 让单位沿 +x 方向以 speed 走 seconds 秒（每帧 locomote + update，与探索模式相同），逐帧回调 */
function walk(view: UnitView, speed: number, seconds: number, each?: (frame: number, t: number) => void, start = { t: 0, x: 0 }): { t: number; x: number } {
  let { t, x } = start;
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i++) {
    t += DT;
    x += speed * DT;
    view.locomote(x, 0, Math.PI / 2);
    view.update(t, t);
    view.model.updateMatrixWorld(true);
    each?.(i, t);
  }
  return { t, x };
}

describe('真实模型：行走', () => {
  it('友方 5 人都有腿部关节（髋、膝、踝）；敌人里只有 Boss 有（步骤 17 入场跺地），其余敌人没有（腿仍并在身体里）', () => {
    for (const t of HEROES) {
      const v = heroView(t.id);
      expect(v.canWalk, t.id).toBe(true);
      const joints = allAnimatedJoints(v.model, getRig(v.model));
      for (const name of LEG_JOINT_NAMES) expect(joints[name], `${t.id} ${name}`).toBeDefined();
    }
    const enemies = createRealViews(new Scheduler(), ENEMY_TEMPLATES);
    for (const [id, v] of enemies) {
      const boss = ENEMY_TEMPLATES.find((t) => t.id === id)?.rank === 'boss';
      expect(v.canWalk, id).toBe(boss);
      if (boss) for (const name of LEG_JOINT_NAMES) expect(allAnimatedJoints(v.model, getRig(v.model))[name], `${id} ${name}`).toBeDefined();
      else expect(allAnimatedJoints(v.model, getRig(v.model))['hipL'], id).toBeUndefined();
    }
  });

  it.each(HEROES.map((t) => [t.id, t.name]))('%s（%s）：满速行走时支撑脚不滑、不陷进地面，摆动脚抬起', (id) => {
    const view = heroView(id);
    const rig = getRig(view.model)!;
    view.placeAt(0, 0, Math.PI / 2);
    view.update(0, 0);
    view.model.updateMatrixWorld(true);
    // 站姿时踝关节的离地高度（按骨架尺寸，不含待机的轻微起伏）
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
    let blendMinY = Infinity;
    let maxLift = 0;
    walk(view, 3.2, 3, (frame) => {
      for (const f of feet) {
        const p = world(f.joint);
        blendMinY = Math.min(blendMinY, p.y);
        if (frame < 90) continue; // 先走 1.5 秒到满速
        minY = Math.min(minY, p.y);
        maxLift = Math.max(maxLift, p.y - ankle0);
        const s = gait.out[f.side];
        // 脚掌放平着地的那一段：踝关节在地面上原地不动
        if (s.stance && s.contact === 'ankle') {
          const prev = last.get(f.side);
          if (prev) {
            maxSlip = Math.max(maxSlip, Math.hypot(p.x - prev.x, p.z - prev.z));
            checked += 1;
          }
          last.set(f.side, p);
        } else {
          last.delete(f.side);
        }
      }
    });
    expect(view.walkWeight).toBeGreaterThan(0.99);
    expect(checked).toBeGreaterThan(30);
    // 每帧身体前进 5.3 厘米，着地的脚移动不超过 3 毫米（重心左右摆带来的一点点横移）
    expect(maxSlip).toBeLessThan(0.003);
    // 脚从不陷进地面（允许 5 毫米的数值误差），摆动时抬起 5 厘米以上
    expect(minY).toBeGreaterThan(ankle0 - 0.005);
    // 起步（行走权重从 0 升到 1）途中最多陷 1.5 厘米
    expect(blendMinY).toBeGreaterThan(ankle0 - 0.015);
    expect(maxLift).toBeGreaterThan(0.05);
  });

  it.each(HEROES.map((t) => [t.id, t.name]))('%s（%s）：停下后平滑回到站姿（腿、手臂、身体都复位）', (id) => {
    const view = heroView(id);
    view.placeAt(0, 0, Math.PI / 2);
    view.update(0, 0);
    const rig = getRig(view.model)!;
    const end = walk(view, 3.2, 2);
    // 停下：位置不再变化
    let maxStep = 0;
    let prevHip = rig.legL.hip.rotation.x;
    const t0 = end.t;
    for (let i = 0; i < 90; i++) {
      const t = t0 + (i + 1) * DT;
      view.locomote(end.x, 0, Math.PI / 2);
      view.update(t, t);
      maxStep = Math.max(maxStep, Math.abs(rig.legL.hip.rotation.x - prevHip));
      prevHip = rig.legL.hip.rotation.x;
    }
    expect(view.walkWeight).toBe(0);
    expect(maxStep).toBeLessThan(0.12); // 平滑：每帧髋关节转动不超过约 7°
    // 回到站姿：与一个从没走过、在同一时刻待机的同一单位完全一样（待机的侧倾会让腿有一点点屈伸，两边相同）
    const ref = heroView(id);
    ref.placeAt(end.x, 0, Math.PI / 2);
    const tEnd = t0 + 90 * DT;
    for (let i = 0; i <= 120; i++) ref.update(tEnd - (120 - i) * DT, tEnd - (120 - i) * DT);
    const refRig = getRig(ref.model)!;
    for (const name of LEG_JOINT_NAMES) {
      const now = allAnimatedJoints(view.model, rig)[name]!.rotation;
      const want = allAnimatedJoints(ref.model, refRig)[name]!.rotation;
      expect(Math.abs(now.x - want.x), `${id} ${name}.x`).toBeLessThan(0.01);
      expect(Math.abs(now.z - want.z), `${id} ${name}.z`).toBeLessThan(0.01);
    }
    for (const name of ['shoulderL', 'shoulderR', 'spine'] as const) {
      const now = allAnimatedJoints(view.model, rig)[name]!.rotation;
      const want = allAnimatedJoints(ref.model, refRig)[name]!.rotation;
      expect(Math.abs(now.x - want.x) + Math.abs(now.y - want.y), `${id} ${name}`).toBeLessThan(0.01);
    }
    expect(Math.abs(view.model.position.y - ref.model.position.y)).toBeLessThan(0.002);
  });

  it.each([
    ['A2', '雷咒'],
    ['A3', '缚魂'],
    ['A4', '守誓'],
  ])('%s（%s，长袍）：行走时腿不从袍子里戳出来（袍摆被腿顶开，按布料着色器的同一公式核对）', (id) => {
    const view = heroView(id);
    const rig = getRig(view.model)!;
    const reach = (view as unknown as { legReach: Record<'kneeL' | 'kneeR' | 'footL' | 'footR', { z: number; depth: number }> }).legReach;
    const H = rig.hips.position.y;
    const SHIN = 0.06; // 小腿半径（模型里约 5.5~7 厘米）
    // 这个深度上一条腿的前后位置：髋 → 膝 → 踝 的折线（与 materials.ts 的 strideLegZ 相同）
    const legAt = (d: number, k: { z: number; depth: number }, f: { z: number; depth: number }): number =>
      d <= k.depth ? (k.z * d) / Math.max(1e-3, k.depth) : k.z + (f.z - k.z) * Math.min(1, Math.max(0, (d - k.depth) / Math.max(1e-3, f.depth - k.depth)));
    // 袍摆（髋部下方的大块布料，合并后挂在根节点上）
    const robes: Mesh[] = [];
    view.model.traverse((o) => {
      const m = o as Mesh;
      const a = m.isMesh ? (m.geometry.getAttribute('aStride') as BufferAttribute | undefined) : undefined;
      if (a && a.count >= 1000) robes.push(m);
    });
    expect(robes.length, id).toBeGreaterThan(0);
    let worst = -Infinity;
    let checked = 0;
    view.placeAt(0, 0, 0);
    let z = 0;
    let t = 0;
    for (let i = 0; i < 240; i++) {
      t += DT;
      z += 3.2 * DT;
      view.locomote(0, z, 0);
      view.update(t, t);
      if (i < 120 || i % 3 !== 0) continue;
      view.model.updateMatrixWorld(true);
      const inv = new Matrix4().copy(rig.hips.matrixWorld).invert();
      for (const leg of [rig.legL, rig.legR]) {
        const k = leg.knee.getWorldPosition(new Vector3()).applyMatrix4(inv);
        const f = leg.foot.getWorldPosition(new Vector3()).applyMatrix4(inv);
        for (let s = 0; s <= 4; s++) {
          const p = k.clone().lerp(f, s / 4); // 膝到踝之间的点（髋部坐标）
          for (const m of robes) {
            const a = m.geometry.getAttribute('aStride') as BufferAttribute;
            const pos = m.geometry.getAttribute('position') as BufferAttribute;
            // 同一高度、同一横向位置附近，推开后的袍子前片最前 / 后片最后的位置
            let front = -Infinity;
            let back = Infinity;
            for (let j = 0; j < a.count; j++) {
              const d = a.getX(j);
              if (Math.abs(-d * H - p.y) > 0.04 || Math.abs(pos.getX(j) - p.x) > 0.03) continue;
              const zv = a.getZ(j);
              const legL = legAt(d, reach.kneeL, reach.footL) * a.getY(j);
              const legR = legAt(d, reach.kneeR, reach.footR) * a.getW(j);
              const c = WALK_GAIT.robeClearance;
              if (zv >= 0) front = Math.max(front, zv + Math.max(0, Math.max(legL, legR) + c - zv) - Math.max(0, c - zv));
              else back = Math.min(back, zv + Math.min(0, Math.min(legL, legR) - c - zv) - Math.min(0, -c - zv));
            }
            if (front > -Infinity) {
              worst = Math.max(worst, p.z + SHIN - front);
              checked += 1;
            }
            if (back < Infinity) {
              worst = Math.max(worst, back - (p.z - SHIN));
              checked += 1;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    // 腿的前后缘最多比袍面突出 1 厘米（布料有厚度，看不出来）
    expect(worst).toBeLessThan(0.01);
  });

  it('战斗中身体下沉、前倾（下蹲蓄力、跳劈落地）：屈膝，脚留在地面上，不陷进地里', () => {
    for (const t of HEROES) {
      const view = heroView(t.id);
      const rig = getRig(view.model)!;
      view.update(0, 0);
      view.model.updateMatrixWorld(true);
      const rest = world(rig.legL.foot);
      const internal = view as unknown as { act: { pose: Record<string, number> }; idleWeight: number };
      // 旋风斩最后一击的蓄势姿态：深蹲 + 大幅前倾
      Object.assign(internal.act.pose, { 'root.lift': -0.22, 'root.pitch': 0.46 });
      internal.idleWeight = 0;
      view.update(0, 0);
      view.model.updateMatrixWorld(true);
      const now = world(rig.legL.foot);
      expect(Math.abs(now.y - rest.y), t.id).toBeLessThan(0.01);
      // 髋部原有的外张角让屈膝的平面略微倾斜，脚会有 1~3 厘米的移动
      expect(Math.hypot(now.x - rest.x, now.z - rest.z), t.id).toBeLessThan(0.04);
      expect(rig.legL.knee.rotation.x, t.id).toBeGreaterThan(0.4); // 明显屈膝
    }
  });
});

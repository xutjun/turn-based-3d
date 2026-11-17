// 拉弓姿态求解（步骤 11b 调姿态用的工具，不参与运行）：在真实的游侠骨架上，
// 给定身体的姿态（侧身、后仰）和瞄准方向，搜索双臂的关节角，使
//   - 左手（握弓）伸向瞄准方向、在左肩前方约一臂远；
//   - 右手（拉弦）正好落在箭的延长线上、离握把 pull 米（搭弦时近，拉满时到脸侧）；
//   - 右肘抬到和肩差不多高、向后（拉弓的自然姿态）。
// 结果打印成可以直接粘进 data/attackAnimConfig.ts 的姿态通道。
//
// 用法：npx tsx scripts/solveBowPose.ts

import { Vector3 } from 'three';
import { getRig } from '../src/assets/models/characters/rig';
import { ALLY_TEMPLATES } from '../src/data/heroes';
import { Scheduler } from '../src/render/director/Scheduler';
import { createRealViews } from '../tests/render/realStage';

const ARM_L = ['shoulderL.x', 'shoulderL.y', 'shoulderL.z', 'elbowL.x'] as const;
const ARM_R = ['shoulderR.x', 'shoulderR.y', 'shoulderR.z', 'elbowR.x'] as const;
/** 关节活动范围（相对站姿的偏移，弧度）：肘只能向前弯，肩不转到背后去 */
const RANGE: Record<string, [number, number]> = {
  'shoulderL.x': [-2.9, 0.3], 'shoulderL.y': [-1.2, 1.2], 'shoulderL.z': [-0.3, 1.6], 'elbowL.x': [-0.6, 0.25],
  'shoulderR.x': [-2.9, 0.6], 'shoulderR.y': [-1.6, 1.6], 'shoulderR.z': [-1.6, 0.4], 'elbowR.x': [-2.4, 0.2],
};
let rand = 12345;
const random = (): number => ((rand = (rand * 16807) % 2147483647) / 2147483647);

interface Case {
  name: string;
  body: Record<string, number>; // 身体（不求解的通道）
  pitch: number; // 瞄准的上扬角
  pull: number; // 右手离握把的距离（米，沿箭）
  reach: number; // 握把离左肩的距离（米）
  seed: Record<string, number>; // 初值
}

const scheduler = new Scheduler();
const archer = ALLY_TEMPLATES.find((t) => t.weaponId === 'bow')!;
const view = createRealViews(scheduler, [archer]).get(archer.id)!;
const v = view as unknown as { act: { pose: Record<string, number>; phase: string; yaw: number }; idleWeight: number };
const rig = getRig(view.model)!;

function apply(pose: Record<string, number>): void {
  const p = v.act.pose;
  for (const k of Object.keys(p)) delete p[k];
  Object.assign(p, pose);
  v.idleWeight = 0;
  view.update(0, 0);
  view.model.updateMatrixWorld(true);
}

const world = (o: { getWorldPosition(v: Vector3): Vector3 }): Vector3 => o.getWorldPosition(new Vector3());

function solve(c: Case): Record<string, number> {
  const yaw = v.act.yaw;
  const aim = new Vector3(Math.sin(yaw) * Math.cos(c.pitch), Math.sin(c.pitch), Math.cos(yaw) * Math.cos(c.pitch));
  const pose: Record<string, number> = { ...c.body, ...c.seed, 'bow.aim': 1, 'weapon.aimPitch': c.pitch };
  const parts = { grip: 0, hand: 0, elbow: 0 };
  const cost = (): number => {
    apply(pose);
    const sL = world(rig.armL.shoulder);
    const grip = world(rig.armL.hand);
    const wantGrip = sL.clone().addScaledVector(aim, c.reach);
    const hand = world(rig.armR.hand);
    const wantHand = grip.clone().addScaledVector(aim, -c.pull);
    const elbow = world(rig.armR.elbow);
    const sR = world(rig.armR.shoulder);
    // 右肘：和右肩差不多高，在右肩后方（沿箭的反方向）
    const wantElbow = sR.clone().addScaledVector(aim, -0.12).add(new Vector3(0, 0.02, 0));
    parts.grip = grip.distanceTo(wantGrip);
    parts.hand = hand.distanceTo(wantHand);
    parts.elbow = elbow.distanceTo(wantElbow);
    // 右手相对握把落在箭线上最重要；左手的绝对位置只要大致在肩前方；右肘的位置只是偏好
    return 0.3 * grip.distanceToSquared(wantGrip) + 4 * hand.distanceToSquared(wantHand) + 0.05 * elbow.distanceToSquared(wantElbow);
  };
  const vars = [...ARM_L, ...ARM_R];
  const descend = (): number => {
    let best = cost();
    let step = 0.2;
    for (let iter = 0; iter < 3000 && step > 2e-4; iter++) {
      let improved = false;
      for (const k of vars) {
        const [lo, hi] = RANGE[k]!;
        for (const d of [step, -step]) {
          const old = pose[k] ?? 0;
          pose[k] = Math.max(lo, Math.min(hi, old + d));
          const c2 = cost();
          if (c2 < best - 1e-9) {
            best = c2;
            improved = true;
          } else pose[k] = old;
        }
      }
      if (!improved) step *= 0.5;
    }
    return best;
  };
  // 多个起点（第一个是给定的初值），取最好的
  let best = Infinity;
  let bestPose = { ...pose };
  for (let restart = 0; restart < 24; restart++) {
    if (restart > 0) for (const k of vars) pose[k] = RANGE[k]![0] + random() * (RANGE[k]![1] - RANGE[k]![0]);
    const c2 = descend();
    if (c2 < best) {
      best = c2;
      bestPose = { ...pose };
    }
  }
  Object.assign(pose, bestPose);
  cost();
  console.log(`  分项：握把 ${parts.grip.toFixed(3)} 米，右手 ${parts.hand.toFixed(3)} 米，右肘 ${parts.elbow.toFixed(3)} 米`);
  apply(pose);
  const grip = world(rig.armL.hand);
  const hand = world(rig.armR.hand);
  const head = world(rig.head);
  console.log(`\n// ${c.name}：残差 ${Math.sqrt(best).toFixed(3)} 米；右手离头 ${hand.distanceTo(head).toFixed(2)} 米，离握把 ${hand.distanceTo(grip).toFixed(2)} 米`);
  const out: Record<string, number> = {};
  for (const k of vars) out[k] = Math.round((pose[k] ?? 0) * 100) / 100;
  console.log(Object.entries(out).map(([k, x]) => `'${k}': ${x}`).join(', '));
  return out;
}

// 平射：侧身（右转约 60°），头转回来看着目标，上身微微后仰
const SIDE = { 'root.turn': -1.0, 'spine.y': -0.15, 'head.y': 0.95, 'head.x': 0.05, 'root.side': 0.04 };
const seedL = { 'shoulderL.x': -1.4, 'shoulderL.z': 0.4, 'elbowL.x': -0.1 };
const seedR = { 'shoulderR.x': -1.5, 'shoulderR.z': -0.6, 'elbowR.x': -2.0 };
solve({ name: '平射·搭弦（举弓）', body: SIDE, pitch: 0.02, pull: 0.22, reach: 0.5, seed: { ...seedL, ...seedR } });
solve({ name: '平射·拉满（到脸侧）', body: { ...SIDE, 'spine.x': -0.08 }, pitch: 0.02, pull: 0.62, reach: 0.52, seed: { ...seedL, ...seedR } });
// 仰射（箭雨）：弓举向天空，身体后仰
const SKY = { 'root.turn': -0.95, 'spine.y': -0.15, 'head.y': 0.8, 'head.x': -0.35, 'root.pitch': -0.32, 'spine.x': -0.15, 'root.side': 0.05 };
solve({ name: '仰射·搭弦（举弓朝天）', body: SKY, pitch: 0.95, pull: 0.22, reach: 0.5, seed: { ...seedL, ...seedR } });
solve({ name: '仰射·拉满（后仰）', body: { ...SKY, 'root.pitch': -0.45, 'chest.x': -0.1 }, pitch: 1.0, pull: 0.62, reach: 0.52, seed: { ...seedL, ...seedR } });

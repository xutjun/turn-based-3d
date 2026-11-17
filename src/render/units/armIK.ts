// 手臂的两段骨骼 IK（步骤 11b）：把手放到指定的世界坐标上（双手握杖时，左手握到杖身上）。
//
// 做法：上臂、前臂长度取自骨架（肘、手关节相对上一级的距离）；
//   1. 余弦定理求出肘部需要弯多少（只绕肘的 x 轴弯，和骨架的约定一致：x 负 = 前臂向前弯）；
//   2. 在胸的坐标系里，把“弯好肘后手的方向”转到“肩指向目标的方向”；
//   3. 再绕这条方向扭转，让肘尖朝向外下方（pole），不翻到身前或头顶；
//   4. 按权重 weight 和原来的姿态（动作姿态 + 待机）混合。
// 只改肩和肘两个关节的转角，每帧开头 UnitView 会把它们写回基准，所以不会跨帧累积。

import { Quaternion, Vector3, type Object3D } from 'three';
import type { ArmRig } from '../../assets/models/characters/rig';

const t = new Vector3();
const hand = new Vector3();
const elbowDir = new Vector3();
const pole = new Vector3();
const axis = new Vector3();
const q = new Quaternion();
const twist = new Quaternion();
const DOWN = new Vector3(0, -1, 0);

/**
 * @param arm 手臂（肩、肘、手关节）
 * @param target 手要到达的世界坐标
 * @param weight 0~1：0 = 不动，1 = 完全由 IK 决定
 * @param side 1 = 左臂（肘尖朝 +x 外侧），−1 = 右臂
 */
export function solveArmIK(arm: ArmRig, target: Vector3, weight: number, side: 1 | -1): void {
  const shoulder = arm.shoulder;
  const parent = shoulder.parent as Object3D | null;
  if (!parent || weight <= 0) return;
  parent.updateWorldMatrix(true, false);
  // 目标在胸的坐标系里、相对肩关节的位置
  t.copy(target);
  parent.worldToLocal(t).sub(shoulder.position);
  const l1 = arm.elbow.position.length();
  const l2 = arm.hand.position.length();
  const d = Math.min(l1 + l2 - 1e-4, Math.max(Math.abs(l1 - l2) + 1e-4, t.length()));
  // 1. 肘的弯曲角（0 = 伸直）
  const cosInner = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2);
  const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosInner)));
  // 弯好肘之后，手在肩的局部坐标里的位置（肢体沿 −y，肘绕 x 轴转 −bend：前臂向前 +z 弯）
  hand.set(0, -l1 - l2 * Math.cos(bend), l2 * Math.sin(bend)).normalize();
  // 2. 把手的方向转到目标方向
  axis.copy(t).normalize();
  q.setFromUnitVectors(hand, axis);
  // 3. 绕目标方向扭转，让肘尖朝外下方
  elbowDir.copy(DOWN).applyQuaternion(q); // 肘关节（上臂末端）的方向
  pole.set(0.55 * side, -0.8, -0.25);
  const project = (v: Vector3): Vector3 => v.addScaledVector(axis, -v.dot(axis));
  project(elbowDir);
  project(pole);
  if (elbowDir.lengthSq() > 1e-8 && pole.lengthSq() > 1e-8) {
    elbowDir.normalize();
    pole.normalize();
    let angle = Math.acos(Math.max(-1, Math.min(1, elbowDir.dot(pole))));
    if (elbowDir.clone().cross(pole).dot(axis) < 0) angle = -angle;
    twist.setFromAxisAngle(axis, angle);
    q.premultiply(twist);
  }
  // 4. 混合
  shoulder.quaternion.slerp(q, weight);
  const e = arm.elbow.rotation;
  e.set(e.x + (-bend - e.x) * weight, e.y * (1 - weight), e.z * (1 - weight));
}

// 演出会单独转动的关节。UnitView、待机动画（IdleAnimator）和绘制优化（assets/optimize.ts）都以这里为准：
// 登记在这里的关节在合并网格时作为边界保留，其余关节（腿、手、颈、披风挂点 …）始终保持站姿，
// 挂在它们下面的网格并进上一级。以后给别的关节加动画时，把它加到这里即可。
//
// 两类：
//   - 人形骨架的关节（rig.ts）：出手 / 受击 / 待机都会用到；
//   - 按名字找的“额外关节”（步骤 10 · C 组）：宝宝的头、尾、翅膀、手臂等，以及 Boss 的双翼；
//     待机动画先摆好它们，进攻动画（步骤 11，data/attackAnimConfig.ts 的动作姿态）再把偏移加上去。
//     名字是模型里 `joint:<名字>` 的后半段（characters/rig.ts 与 creatures/common.ts 的约定）。
//   - 步骤 11 为进攻动画新增：狼的四条腿（foreLegL/R、hindLegL/R，整条腿绕肩 / 髋摆动，用于下伏、蹬地、扑跃），
//     魔偶的双腿（legL/R，踏步；骨龙的后腿与之同名，一并登记）。人形的腿和手指仍然没有登记（不动）。

import type { Object3D } from 'three';
import type { HumanoidRig } from '../../assets/models/characters/rig';

export function animatedJointsOf(rig: HumanoidRig): Record<string, Object3D> {
  return {
    shoulderR: rig.armR.shoulder,
    elbowR: rig.armR.elbow,
    shoulderL: rig.armL.shoulder,
    elbowL: rig.armL.elbow,
    spine: rig.spine,
    chest: rig.chest,
    head: rig.head,
  };
}

/** 模型里关节节点的名字前缀 */
export const JOINT_PREFIX = 'joint:';

/**
 * 待机 / 进攻动画会转动的额外关节（按名字）。
 *   狼：neck、head、jaw、tail，foreLegL / foreLegR、hindLegL / hindLegR（步骤 11）
 *   骨龙：head、jaw、wingL / wingR、foreL / foreR（小前肢的前臂），legL / legR（步骤 11，与魔偶同名）
 *   幽灵：head、shoulderL / shoulderR
 *   魔偶：torso、head、shoulderL / shoulderR，legL / legR（步骤 11）
 *   Boss（人形骨架之外）：wingL / wingR
 */
export const EXTRA_JOINT_NAMES = [
  'neck',
  'head',
  'jaw',
  'tail',
  'torso',
  'wingL',
  'wingR',
  'shoulderL',
  'shoulderR',
  'foreL',
  'foreR',
  // 步骤 11：进攻动画用
  'foreLegL',
  'foreLegR',
  'hindLegL',
  'hindLegR',
  'legL',
  'legR',
] as const;

/**
 * 找出模型里登记过的额外关节。人形模型上与骨架同名的关节（head、shoulderL …）以骨架为准，这里跳过。
 */
export function extraJointsOf(model: Object3D, rig?: HumanoidRig): Record<string, Object3D> {
  const taken = new Set<Object3D>(rig ? Object.values(animatedJointsOf(rig)) : []);
  const rigNodes = rig ? new Set<Object3D>([rig.neck, rig.head, rig.spine, rig.chest]) : undefined;
  const out: Record<string, Object3D> = {};
  model.traverse((o) => {
    if (!o.name.startsWith(JOINT_PREFIX)) return;
    const name = o.name.slice(JOINT_PREFIX.length);
    if (!(EXTRA_JOINT_NAMES as readonly string[]).includes(name)) return;
    if (taken.has(o) || rigNodes?.has(o)) return; // 人形骨架自己的关节
    if (rig && (name === 'neck' || name === 'head' || name === 'shoulderL' || name === 'shoulderR')) return;
    if (!(name in out)) out[name] = o;
  });
  return out;
}

/** 一个模型上全部会动的关节：人形骨架的 + 额外的 */
export function allAnimatedJoints(model: Object3D, rig?: HumanoidRig): Record<string, Object3D> {
  return { ...extraJointsOf(model, rig), ...(rig ? animatedJointsOf(rig) : {}) };
}

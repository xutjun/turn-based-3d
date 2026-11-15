// 演出会单独转动的人形关节。
// UnitView 的出手 / 受击 / 待机动画只转这几个关节；其余关节（腿、手、颈、披风挂点 …）目前始终保持站姿，
// 所以绘制优化（assets/optimize.ts）可以把挂在它们下面的网格并进上一级。
// 以后给别的关节加动画时，把它加到这里即可：UnitView 和绘制优化都以这张表为准。

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

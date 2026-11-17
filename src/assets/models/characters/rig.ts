// 人形骨架：用 Group 层级搭出的关节树。
// 模型的所有部件都挂在关节上，动画只需要旋转这些关节（目前实际会转的关节见 render/units/animatedJoints.ts）：
//   待机 = 胸、头、披风的轻微起伏；攻击 = 肩、肘、脊柱；施法 = 双臂上举；
//   受击 = 脊柱后仰；倒地 / 复活 = 根节点与髋部整体旋转。
//
// 约定：模型面朝 +z，左手在 +x 一侧；肢体沿关节的 −y 方向延伸；脚底在 y = 0。

import { Group, Object3D } from 'three';

export interface ArmRig {
  shoulder: Group; // 肩
  elbow: Group; // 肘
  hand: Group; // 手
}

export interface LegRig {
  hip: Group; // 髋
  knee: Group; // 膝
  foot: Group; // 踝
}

export interface HumanoidRig {
  root: Group; // 根：站位、整体朝向、倒地
  hips: Group; // 髋部
  spine: Group; // 腰（躯干下半）
  chest: Group; // 胸（躯干上半）
  neck: Group;
  head: Group;
  armL: ArmRig;
  armR: ArmRig;
  legL: LegRig;
  legR: LegRig;
  cape: Group; // 披风挂点（后背）
  weaponMount: Group; // 右手武器挂点：武器的 +y 轴朝向握持方向的“上”
  offhandMount: Group; // 左手挂点
  hpAnchor: Object3D; // 头顶血条挂点
  height: number; // 模型总高度（未乘整体缩放）
  /**
   * 腿会动（步骤 14）：髋、膝、踝登记为动画关节（render/units/animatedJoints.ts）。
   * 由摆放单位的代码按外观配置（UNIT_MODELS 的 walk）打开，必须在合并网格之前设置。
   */
  legsAnimated?: boolean;
}

/** 骨架尺寸（单位：米，人物总高约 1.75） */
export interface RigDims {
  hipHeight: number; // 髋关节离地高度
  hipWidth: number; // 髋关节到中线的距离
  thigh: number; // 大腿长
  shin: number; // 小腿长
  torso: number; // 髋到颈根的躯干长
  shoulderWidth: number; // 肩关节到中线的距离
  upperArm: number;
  forearm: number;
  neck: number;
  headHeight: number; // 颈顶到头顶
}

export const DEFAULT_DIMS: RigDims = {
  hipHeight: 0.9,
  hipWidth: 0.1,
  thigh: 0.42,
  shin: 0.4,
  torso: 0.52,
  shoulderWidth: 0.23,
  upperArm: 0.29,
  forearm: 0.27,
  neck: 0.07,
  headHeight: 0.24,
};

const RIG_KEY = 'rig';

function joint(name: string, parent: Object3D, x = 0, y = 0, z = 0): Group {
  const g = new Group();
  g.name = `joint:${name}`;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** 创建一副空骨架（只有关节，没有任何可见部件），并摆成自然站姿 */
export function createRig(dims: RigDims = DEFAULT_DIMS): HumanoidRig {
  const root = new Group();
  root.name = 'character';

  const hips = joint('hips', root, 0, dims.hipHeight, 0);
  const spine = joint('spine', hips);
  const chest = joint('chest', spine, 0, dims.torso * 0.55, 0);
  const neck = joint('neck', chest, 0, dims.torso * 0.45, 0);
  const head = joint('head', neck, 0, dims.neck, 0);
  const shoulderY = dims.torso * 0.38;

  const arm = (side: 1 | -1, tag: string): ArmRig => {
    const shoulder = joint(`shoulder${tag}`, chest, side * dims.shoulderWidth, shoulderY, 0);
    const elbow = joint(`elbow${tag}`, shoulder, 0, -dims.upperArm, 0);
    const hand = joint(`hand${tag}`, elbow, 0, -dims.forearm, 0);
    return { shoulder, elbow, hand };
  };
  const leg = (side: 1 | -1, tag: string): LegRig => {
    const hip = joint(`hip${tag}`, hips, side * dims.hipWidth, 0, 0);
    const knee = joint(`knee${tag}`, hip, 0, -dims.thigh, 0);
    const foot = joint(`foot${tag}`, knee, 0, -dims.shin, 0);
    return { hip, knee, foot };
  };

  const armL = arm(1, 'L');
  const armR = arm(-1, 'R');
  const legL = leg(1, 'L');
  const legR = leg(-1, 'R');
  const cape = joint('cape', chest, 0, dims.torso * 0.4, -0.1);

  const weaponMount = joint('weaponMount', armR.hand);
  weaponMount.rotation.x = Math.PI / 2; // 武器 +y 轴对齐手的“前方”
  const offhandMount = joint('offhandMount', armL.hand);
  offhandMount.rotation.x = Math.PI / 2;

  const height = dims.hipHeight + dims.torso + dims.neck + dims.headHeight;
  const hpAnchor = new Object3D();
  hpAnchor.name = 'hpAnchor';
  hpAnchor.position.y = height + 0.3;
  root.add(hpAnchor);

  // 自然站姿：双臂略外张，右手前伸持武器，双脚略分开
  armL.shoulder.rotation.set(-0.08, 0, 0.12);
  armL.elbow.rotation.x = -0.25;
  armR.shoulder.rotation.set(-0.3, 0, -0.14);
  armR.elbow.rotation.x = -0.75;
  legL.hip.rotation.z = 0.05;
  legR.hip.rotation.z = -0.05;

  const rig: HumanoidRig = {
    root,
    hips,
    spine,
    chest,
    neck,
    head,
    armL,
    armR,
    legL,
    legR,
    cape,
    weaponMount,
    offhandMount,
    hpAnchor,
    height,
  };
  root.userData[RIG_KEY] = rig;
  return rig;
}

/** 从模型根节点取回骨架；不是人形模型时返回 undefined */
export function getRig(root: Object3D): HumanoidRig | undefined {
  return root.userData[RIG_KEY] as HumanoidRig | undefined;
}

/** 设置模型的实际总高度（头盔、兜帽等会超出骨架高度），同时把血条挂点移到头顶上方 */
export function setRigHeight(rig: HumanoidRig, height: number, gap = 0.3): void {
  rig.height = height;
  rig.hpAnchor.position.y = height + gap;
}

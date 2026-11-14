// 非人形生物（宝宝）的公共参数与收尾逻辑。
// 约定与人形角色一致：面朝 +z，脚底在 y = 0；可动部位用带名字的 Group 作关节，供步骤 5 做动画。

import { Group, Object3D } from 'three';
import type { RimOptions } from '../../materials';

export interface CreatureBaseParams {
  scale: number; // 整体缩放
  rim: RimOptions; // 轮边光
}

const HEIGHT_KEY = 'modelHeight';

/** 创建一个带名字的关节 */
export function joint(name: string, parent: Object3D, x = 0, y = 0, z = 0): Group {
  const g = new Group();
  g.name = `joint:${name}`;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** 收尾：命名、挂头顶血条挂点、记录高度、应用整体缩放 */
export function finishCreature(root: Group, name: string, height: number, scale: number, gap = 0.25): Group {
  root.name = name;
  const hpAnchor = new Object3D();
  hpAnchor.name = 'hpAnchor';
  hpAnchor.position.y = height + gap;
  root.add(hpAnchor);
  root.userData[HEIGHT_KEY] = height;
  root.scale.setScalar(scale);
  return root;
}

/** 生物模型的总高度（未乘整体缩放）；不是生物模型时返回 undefined */
export function getCreatureHeight(root: Object3D): number | undefined {
  return root.userData[HEIGHT_KEY] as number | undefined;
}

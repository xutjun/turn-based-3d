// 角色 builder 的公共参数与收尾逻辑。

import type { Group } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import type { RimOptions } from '../../materials';
import { setRigHeight, type HumanoidRig } from './rig';

/** 所有角色 builder 共有的参数 */
export interface CharacterBaseParams {
  scale: number; // 整体缩放
  rim: RimOptions; // 轮边光
}

export const ALLY_RIM: RimOptions = RIM_CONFIG.ally;
export const ENEMY_RIM: RimOptions = RIM_CONFIG.enemy;

/** 收尾：记录总高度、应用整体缩放，返回根节点 */
export function finishCharacter(rig: HumanoidRig, name: string, height: number, scale: number): Group {
  setRigHeight(rig, height);
  rig.root.name = name;
  rig.root.scale.setScalar(scale);
  return rig.root;
}

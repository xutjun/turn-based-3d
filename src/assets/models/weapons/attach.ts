// 把武器装到人形角色的手上。

import type { Object3D } from 'three';
import { getRig } from '../characters/rig';
import { getWeaponHold } from './glow';

const EQUIPPED_KEY = 'equippedWeapon';

/**
 * 把武器挂到角色的手部挂点上（哪只手、什么角度由武器自己的握持方式决定）。
 * 角色不是人形骨架时不做任何事并返回 false。
 */
export function equipWeapon(character: Object3D, weapon: Object3D): boolean {
  const rig = getRig(character);
  if (!rig) return false;
  const hold = getWeaponHold(weapon) ?? { hand: 'right' as const, rotation: [0, 0, 0] as [number, number, number] };
  unequipWeapon(character);
  const mount = hold.hand === 'left' ? rig.offhandMount : rig.weaponMount;
  weapon.position.set(0, 0, 0);
  weapon.rotation.set(...hold.rotation);
  mount.add(weapon);
  character.userData[EQUIPPED_KEY] = weapon;
  return true;
}

/** 卸下当前武器并返回它 */
export function unequipWeapon(character: Object3D): Object3D | undefined {
  const weapon = character.userData[EQUIPPED_KEY] as Object3D | undefined;
  if (weapon) {
    weapon.removeFromParent();
    delete character.userData[EQUIPPED_KEY];
  }
  return weapon;
}

/** 角色当前手持的武器 */
export function getEquippedWeapon(character: Object3D): Object3D | undefined {
  return character.userData[EQUIPPED_KEY] as Object3D | undefined;
}

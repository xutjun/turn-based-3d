// 共享材质：石材、旧铁、骨头、旧木。场景物件复用同一份材质以减少开销。

import { Color, MeshStandardMaterial, Vector2 } from 'three';
import { boneTextures, ironTextures, stoneTextures } from './textures/surfaces';

let stone: MeshStandardMaterial | undefined;
let iron: MeshStandardMaterial | undefined;
let bone: MeshStandardMaterial | undefined;
let wood: MeshStandardMaterial | undefined;

/** 粗糙的灰色石材 */
export function stoneMaterial(): MeshStandardMaterial {
  if (!stone) {
    const t = stoneTextures();
    stone = new MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.roughnessMap,
      normalScale: new Vector2(1.4, 1.4),
      roughness: 1,
      metalness: 0,
    });
  }
  return stone;
}

/** 发黑生锈的旧铁 */
export function ironMaterial(): MeshStandardMaterial {
  if (!iron) {
    const t = ironTextures();
    iron = new MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.roughnessMap,
      roughness: 1,
      metalness: 0.85,
    });
  }
  return iron;
}

/** 发黄的骨头 */
export function boneMaterial(): MeshStandardMaterial {
  if (!bone) {
    const t = boneTextures();
    bone = new MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      roughnessMap: t.roughnessMap,
      roughness: 1,
      metalness: 0,
    });
  }
  return bone;
}

/** 发黑的旧木（旗杆） */
export function woodMaterial(): MeshStandardMaterial {
  if (!wood) {
    const t = stoneTextures(11);
    wood = new MeshStandardMaterial({
      map: t.map,
      normalMap: t.normalMap,
      color: new Color(0x5a4030),
      roughness: 0.9,
      metalness: 0,
    });
  }
  return wood;
}

// 剪影测试（调试用，地址加 ?silhouette=1）：把所有单位画成纯黑，背景换成浅灰，其余场景物件全部隐藏。
// 用来检查单位在战场相机的实际距离下，头、四肢、尾巴、翼这些体块光靠轮廓能不能分辨。

import { Color, DoubleSide, MeshBasicMaterial, type Material, type Mesh, type Object3D, type Scene, type Texture } from 'three';

const BACKGROUND = 0xd9d9d9;

export function silhouetteRequested(): boolean {
  const v = new URLSearchParams(location.search).get('silhouette');
  return v !== null && v !== '0';
}

/**
 * @param scene 整个场景
 * @param units 要画成剪影的节点（单位模型的根，或它们共同的父节点）
 */
export function applySilhouette(scene: Scene, units: Object3D): void {
  scene.background = new Color(BACKGROUND);
  scene.fog = null;
  for (const child of scene.children) {
    if (child !== units && !(child as { isLight?: boolean }).isLight) child.visible = false;
  }
  const solid = new MeshBasicMaterial({ color: 0x000000, side: DoubleSide });
  const cutouts = new Map<Texture, MeshBasicMaterial>();
  units.traverse((o) => {
    const r = o as Object3D & { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean; isLight?: boolean };
    if (r.isSprite || r.isPoints || r.isLight) {
      o.visible = false;
      return;
    }
    if (!r.isMesh) return;
    const mesh = o as Mesh;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material & { alphaMap?: Texture | null };
    // 叠加混合的光效（符文环、裂纹光）和只在阴影图层上的代理不算轮廓
    if (mat.transparent || !mesh.layers.isEnabled(0)) {
      o.visible = false;
      return;
    }
    if (mat.alphaMap) {
      // 破布下摆等镂空材质：剪影也要镂空
      let cut = cutouts.get(mat.alphaMap);
      if (!cut) {
        cut = new MeshBasicMaterial({ color: 0x000000, side: DoubleSide, alphaMap: mat.alphaMap, alphaTest: 0.5 });
        cutouts.set(mat.alphaMap, cut);
      }
      mesh.material = cut;
    } else {
      mesh.material = solid;
    }
  });
}

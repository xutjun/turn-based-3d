// 绘制调用优化：把一个模型里“不会单独运动”的网格按材质合并，减少每帧的绘制次数。
//
// 程序化模型是用很多小几何体拼出来的（一个人物五十多个网格），每个网格每帧要画两次（画面 + 阴影）。
// 这些小网格绝大多数只是跟着所在的关节一起动，所以可以把同一个关节下、同一种材质的网格合成一个，
// 外观和动画完全不变，绘制次数降到原来的几分之一。
//
// 哪些节点必须保留（不能被合并掉）：
//   - 有名字的节点（关节、武器、血条挂点 …，代码会按名字或引用去找它们）；
//   - userData 里有内容的节点，以及被任何 userData 引用到的节点（骨架、已装备的武器、弓上的箭 …）；
//   - 每帧更新函数（tick）会改动位置 / 旋转 / 缩放 / 显隐 / 顶点的节点——通过试运行 tick 找出来；
//   - 不是普通网格的东西（灯光、精灵、粒子、线、实例化网格）。
// 其余的普通网格都合并到离它最近的“保留节点”下面。
//
// 换成 glb 模型后不需要这一步（glb 自带蒙皮网格），createFormationView 里对没有可合并内容的模型是空操作。

import {
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type InstancedMesh,
  type Material,
  type Object3D,
  type Side,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TickFn } from './AssetRegistry';

export interface MergeStats {
  meshesBefore: number;
  meshesAfter: number;
}

/** 试运行 tick 时用的几个时间点（秒），彼此不成整数倍，周期性动画也能测出变化 */
const PROBE_TIMES = [0.731, 2.917, 5.303];
const PROBE_DT = 1 / 60;

type MeshLike = Mesh & { isInstancedMesh?: boolean; isSkinnedMesh?: boolean };

function isPlainMesh(o: Object3D): o is Mesh {
  const m = o as MeshLike;
  return m.isMesh === true && m.isInstancedMesh !== true && m.isSkinnedMesh !== true;
}

/** 没有逐实例颜色的实例化网格：每个实例只是一个变换，可以直接烘进合并后的几何体 */
function isBakeableInstanced(o: Object3D): o is InstancedMesh {
  const m = o as InstancedMesh;
  return m.isInstancedMesh === true && m.instanceColor === null && m.morphTexture === null;
}

function isObject3D(v: unknown): v is Object3D {
  return typeof v === 'object' && v !== null && (v as { isObject3D?: boolean }).isObject3D === true;
}

/** 收集 userData 里引用到的所有节点（骨架表、已装备的武器等都是这样记的） */
function collectReferenced(root: Object3D, keep: Set<Object3D>): void {
  const seen = new Set<unknown>();
  const walk = (value: unknown, depth: number): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) return;
    seen.add(value);
    if (isObject3D(value)) {
      keep.add(value);
      return;
    }
    if (depth <= 0) return;
    for (const v of Object.values(value as Record<string, unknown>)) walk(v, depth - 1);
  };
  root.traverse((o) => {
    if (Object.keys(o.userData).length > 0) keep.add(o);
    walk(o.userData, 4);
  });
}

/** 试运行每帧更新函数，找出会被它们改动的节点 */
function collectAnimated(root: Object3D, keep: Set<Object3D>): void {
  const ticks: TickFn[] = [];
  root.traverse((o) => {
    const t = o.userData['tick'] as TickFn | undefined;
    if (typeof t === 'function') ticks.push(t);
  });
  if (ticks.length === 0) return;

  const snapshot = (): Map<Object3D, string> => {
    const out = new Map<Object3D, string>();
    root.traverse((o) => {
      const geo = (o as Mesh).geometry as BufferGeometry | undefined;
      const version = (geo?.getAttribute?.('position') as BufferAttribute | undefined)?.version ?? 0;
      out.set(
        o,
        [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()].map((n) => n.toFixed(5)).join(',') +
          `|${o.visible}|${version}`,
      );
    });
    return out;
  };
  let before = snapshot();
  for (const time of PROBE_TIMES) {
    for (const tick of ticks) tick(time, PROBE_DT);
    const after = snapshot();
    for (const [o, sig] of after) if (before.get(o) !== sig) keep.add(o);
    before = after;
  }
}

/** 合并时用来区分“能不能合到一起”的键：材质、阴影设置、渲染顺序、顶点属性都相同才合并 */
function bucketKey(mesh: Mesh, geo: BufferGeometry): string {
  const attrs = Object.keys(geo.attributes)
    .sort()
    .map((name) => `${name}${geo.attributes[name]!.itemSize}`)
    .join('+');
  const mat = mesh.material as Material;
  return `${mat.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}|${mesh.frustumCulled}|${mesh.layers.mask}|${attrs}`;
}

/** 镜像变换（行列式为负）会把三角形的正反面翻过来：交换每个三角形的后两个顶点翻回去 */
function flipWinding(geo: BufferGeometry): void {
  for (const attr of Object.values(geo.attributes)) {
    const a = attr as BufferAttribute;
    const size = a.itemSize;
    const arr = a.array;
    for (let i = 0; i + 2 < a.count; i += 3) {
      for (let k = 0; k < size; k++) {
        const p = (i + 1) * size + k;
        const q = (i + 2) * size + k;
        const tmp = arr[p]!;
        arr[p] = arr[q]!;
        arr[q] = tmp;
      }
    }
  }
}

export interface MergeOptions {
  /**
   * 指出哪些“有名字 / 被引用”的节点其实从不单独运动（例如目前没有动画的腿部关节）：
   * 这些节点本身仍然留在树上，但挂在它们下面的网格可以并进上一级，进一步减少绘制次数。
   * 被每帧更新函数改动的节点不受这个选项影响，始终保留。
   */
  isStatic?: (node: Object3D) => boolean;
  /**
   * 阴影专用图层。设置后，同一个节点下所有投射阴影的网格再合成一个“阴影代理”：
   * 代理只在这个图层上（画面里不画，只进阴影贴图），原来的网格不再进阴影贴图。
   * 阴影只需要形状、不需要材质，所以不管一个部件用了几种材质，阴影那一遍都只画一次。
   * 需要配合 enableShadowLayer() 和主光源的 shadow.camera.layers 使用。
   */
  shadowLayer?: number;
}

/** 标记：这个网格的阴影已经由阴影代理负责 */
const PROXIED_KEY = 'shadowProxied';

/** 阴影代理共用的材质（画面里不会画到它，只用来生成阴影遍的深度材质） */
const proxyMaterials = new Map<number, MeshBasicMaterial>();
function proxyMaterial(side: number): MeshBasicMaterial {
  let mat = proxyMaterials.get(side);
  if (!mat) proxyMaterials.set(side, (mat = new MeshBasicMaterial({ side: side as Side })));
  return mat;
}

/** 镂空材质（靠贴图透明度决定形状）的阴影也是镂空的，不能用只有形状的代理代替 */
function hasCutout(mat: Material): boolean {
  const m = mat as Material & { alphaMap?: unknown; map?: unknown };
  return mat.alphaTest > 0 || m.alphaMap != null || mat.transparent;
}

/**
 * 让 root 下所有投射阴影、且没有交给阴影代理的物体进入阴影图层。
 * 主光源的阴影相机只看这个图层（见 render/scene/lighting.ts）。
 */
export function enableShadowLayer(root: Object3D, layer: number): void {
  root.traverse((o) => {
    if (o.castShadow && o.userData[PROXIED_KEY] !== true) o.layers.enable(layer);
  });
}

/** 给合并后的网格按所在节点建立阴影代理 */
function addShadowProxies(meshes: readonly Mesh[], layer: number): void {
  const groups = new Map<string, { parent: Object3D; side: number; casters: Mesh[] }>();
  for (const mesh of meshes) {
    const mat = mesh.material as Material;
    if (!mesh.castShadow || !mesh.parent || hasCutout(mat)) continue;
    // 深度材质按“shadowSide，否则按 side 翻面”取面，代理沿用原材质的设置，阴影形状才一致
    const side = mat.side;
    if (mat.shadowSide !== null) continue;
    const key = `${mesh.parent.uuid}|${side}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { parent: mesh.parent, side, casters: [] }));
    g.casters.push(mesh);
  }
  for (const { parent, side, casters } of groups.values()) {
    if (casters.length < 2) continue; // 只有一个网格时代理没有收益
    // 阴影只需要顶点位置
    const parts = casters.map((m) => {
      const g = new BufferGeometry();
      g.setAttribute('position', m.geometry.getAttribute('position').clone());
      return g;
    });
    const geometry = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (!geometry) continue;
    const proxy = new Mesh(geometry, proxyMaterial(side));
    proxy.castShadow = true;
    proxy.layers.set(layer); // 只在阴影图层：画面里不画
    proxy.userData[PROXIED_KEY] = true;
    parent.add(proxy);
    for (const m of casters) m.userData[PROXIED_KEY] = true;
  }
}

/**
 * 合并 root 下的静态网格。会直接修改 root 的子树：被合并的网格从树上移除，合并后的网格挂到保留节点下。
 */
export function mergeStaticMeshes(root: Object3D, options: MergeOptions = {}): MergeStats {
  // keep：不能从树上删掉的节点；pivot：会单独运动、合并时要作为坐标系边界的节点
  const keep = new Set<Object3D>([root]);
  collectReferenced(root, keep);
  root.traverse((o) => {
    const plainGroup = (o as { isGroup?: boolean }).isGroup === true || o.type === 'Object3D';
    if (o.name !== '' || !(plainGroup || isPlainMesh(o) || isBakeableInstanced(o))) keep.add(o);
  });
  const animated = new Set<Object3D>();
  collectAnimated(root, animated);
  const pivots = new Set<Object3D>([root, ...animated]);
  for (const o of keep) {
    if (!options.isStatic?.(o)) pivots.add(o);
    // 静止节点下面如果挂着会运动的东西，它仍然只是一个普通的中间节点，不影响合并
  }
  for (const o of animated) keep.add(o);

  let meshesBefore = 0;
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshesBefore += 1;
  });

  root.updateMatrixWorld(true);
  const inverse = new Matrix4();
  const relative = new Matrix4();
  const instanceMatrix = new Matrix4();
  const buckets = new Map<Object3D, Map<string, { sample: Mesh; parts: BufferGeometry[] }>>();
  const merged: Object3D[] = [];
  const created: Mesh[] = [];

  root.traverse((o) => {
    const instanced = isBakeableInstanced(o);
    if (!(isPlainMesh(o) || instanced) || keep.has(o) || o.children.length > 0 || !o.visible) return;
    if (Object.keys(o.userData).length > 0) return;
    if (Array.isArray(o.material)) return; // 多材质网格保持原样
    const mat = o.material as Material;
    if (mat.transparent) return; // 半透明物体的绘制顺序与外观有关，保持原样
    const source = o.geometry;
    if (!source.getAttribute('position') || Object.keys(source.morphAttributes).length > 0) return;

    // 最近的保留节点；途中如果有隐藏的节点，这个网格本来就不显示，不参与合并
    let pivot: Object3D | null = o.parent;
    while (pivot && !pivots.has(pivot)) {
      if (!pivot.visible) return;
      pivot = pivot.parent;
    }
    if (!pivot) return;

    // 把几何体变换到保留节点的局部坐标系；实例化网格的每个实例各烘一份
    relative.multiplyMatrices(inverse.copy(pivot.matrixWorld).invert(), o.matrixWorld);
    const copies = instanced ? o.count : 1;
    for (let i = 0; i < copies; i++) {
      const matrix = instanced ? (o.getMatrixAt(i, instanceMatrix), instanceMatrix.premultiply(relative)) : relative;
      const geo = source.index ? source.toNonIndexed() : source.clone();
      geo.applyMatrix4(matrix);
      if (matrix.determinant() < 0) flipWinding(geo);

      let byKey = buckets.get(pivot);
      if (!byKey) buckets.set(pivot, (byKey = new Map()));
      const key = bucketKey(o, geo);
      let bucket = byKey.get(key);
      if (!bucket) byKey.set(key, (bucket = { sample: o, parts: [] }));
      bucket.parts.push(geo);
    }
    merged.push(o);
  });

  for (const [pivot, byKey] of buckets) {
    for (const { sample, parts } of byKey.values()) {
      const geometry = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
      if (!geometry) throw new Error('几何体合并失败：顶点属性不一致');
      if (parts.length > 1) for (const p of parts) p.dispose();
      const mesh = new Mesh(geometry, sample.material);
      mesh.castShadow = sample.castShadow;
      mesh.receiveShadow = sample.receiveShadow;
      mesh.renderOrder = sample.renderOrder;
      mesh.frustumCulled = sample.frustumCulled;
      mesh.layers.mask = sample.layers.mask;
      pivot.add(mesh);
      created.push(mesh);
    }
  }
  if (options.shadowLayer !== undefined) addShadowProxies(created, options.shadowLayer);
  for (const m of merged) m.removeFromParent();

  // 清掉合并后变空的分组
  const prune = (o: Object3D): void => {
    for (const child of [...o.children]) prune(child);
    if (!keep.has(o) && !pivots.has(o) && o.children.length === 0 && !(o as Mesh).isMesh) o.removeFromParent();
  };
  for (const child of [...root.children]) prune(child);

  let meshesAfter = 0;
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshesAfter += 1;
  });
  return { meshesBefore, meshesAfter };
}

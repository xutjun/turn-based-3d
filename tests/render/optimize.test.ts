import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PointLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { setTick } from '../../src/assets/AssetRegistry';
import { enableShadowLayer, mergeStaticMeshes } from '../../src/assets/optimize';

const SHADOW_LAYER = 1;
const box = (mat: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh => {
  const m = new Mesh(new BoxGeometry(1, 1, 1), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
};
const meshes = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
};
const triangles = (root: Object3D, layer = 0): number =>
  meshes(root)
    .filter((m) => m.layers.isEnabled(layer) && !(layer === 0 && m.userData['shadowProxied'] && !m.layers.isEnabled(0)))
    .reduce((n, m) => {
      const g = m.geometry;
      const count = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      return n + count * ((m as InstancedMesh).isInstancedMesh ? (m as InstancedMesh).count : 1);
    }, 0);

/** 一个带“关节”的小模型：根 → 身体（静止关节）→ 手臂（会动的关节） */
function buildModel() {
  const iron = new MeshStandardMaterial({ color: 0x555555 });
  const cloth = new MeshStandardMaterial({ color: 0x552222 });
  const root = new Group();
  const body = new Group();
  body.name = 'joint:body';
  body.position.y = 1;
  const arm = new Group();
  arm.name = 'joint:arm';
  arm.position.x = 0.6;
  root.add(body);
  body.add(arm);
  // 身体：3 块铁 + 2 块布，其中一块挂在没有名字的中间分组里
  body.add(box(iron), box(iron, 0, 1), box(cloth, 0, -1));
  const inner = new Group();
  inner.position.z = 0.5;
  inner.rotation.y = 0.4;
  inner.add(box(iron, 1), box(cloth, -1));
  body.add(inner);
  // 手臂：2 块铁
  arm.add(box(iron, 0, -0.5), box(iron, 0, -1.5));
  return { root, body, arm, iron, cloth };
}

describe('静态网格合并', () => {
  it('同一个关节下、同一种材质的网格合成一个，三角形总数不变', () => {
    const { root, body, arm, iron, cloth } = buildModel();
    const before = triangles(root);
    const stats = mergeStaticMeshes(root);
    expect(stats.meshesBefore).toBe(7);
    expect(stats.meshesAfter).toBe(3); // 身体的铁、身体的布、手臂的铁
    expect(triangles(root)).toBe(before);
    expect(meshes(body).filter((m) => m.parent === body).map((m) => m.material)).toEqual(
      expect.arrayContaining([iron, cloth]),
    );
    expect(meshes(arm)).toHaveLength(1);
    // 有名字的关节都还在，层级不变
    expect(root.getObjectByName('joint:body')).toBe(body);
    expect(arm.parent).toBe(body);
  });

  it('合并后顶点的世界坐标不变（中间分组的位移和旋转被烘进几何体）', () => {
    const { root } = buildModel();
    const bounds = (): number[] => {
      root.updateMatrixWorld(true);
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      const v = new Vector3();
      for (const m of meshes(root)) {
        const pos = m.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          min.min(v);
          max.max(v);
        }
      }
      return [...min.toArray(), ...max.toArray()].map((n) => Math.round(n * 1e4) / 1e4);
    };
    const before = bounds();
    mergeStaticMeshes(root);
    expect(bounds()).toEqual(before);
  });

  it('指定为静止的关节不再是边界：它下面的网格并进上一级', () => {
    const { root, arm } = buildModel();
    const stats = mergeStaticMeshes(root, { isStatic: (o) => o.name.startsWith('joint:') });
    expect(stats.meshesAfter).toBe(2); // 整个模型只剩铁、布两个网格
    expect(meshes(root).every((m) => m.parent === root)).toBe(true);
    expect(arm.parent).not.toBeNull(); // 关节节点本身仍然留在树上
  });

  it('镜像（负缩放）的部件合并后三角形朝向仍然朝外', () => {
    const mat = new MeshStandardMaterial();
    const root = new Group();
    const left = box(mat, 1);
    const right = box(mat, -1);
    right.scale.x = -1; // 左右对称的部件常用负缩放镜像
    root.add(left, right);
    mergeStaticMeshes(root);
    const [merged] = meshes(root);
    const pos = merged!.geometry.getAttribute('position');
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const normal = new Vector3();
    const center = new Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      normal.subVectors(b, a).cross(c.clone().sub(a));
      center.copy(a).add(b).add(c).divideScalar(3);
      const boxCenter = new Vector3(center.x > 0 ? 1 : -1, 0, 0);
      expect(normal.dot(center.sub(boxCenter))).toBeGreaterThan(0); // 法线指向盒子外面
    }
  });

  it('每帧更新函数会改动的节点自动保留，动画不受影响', () => {
    const mat = new MeshStandardMaterial();
    const root = new Group();
    const spinner = new Group(); // 没有名字，只在 tick 的闭包里被引用
    spinner.add(box(mat), box(mat, 1));
    const flame = box(mat, 0, 2); // 网格自己被 tick 缩放
    root.add(box(mat, 3), box(mat, 4), spinner, flame);
    setTick(root, (time) => {
      spinner.rotation.y = time;
      flame.scale.setScalar(1 + 0.2 * Math.sin(time * 7));
    });
    mergeStaticMeshes(root);
    expect(spinner.parent).toBe(root);
    expect(flame.parent).toBe(root);
    expect(meshes(spinner)).toHaveLength(1); // 转动分组里面的两块仍然会合并
    expect(meshes(root)).toHaveLength(3); // 根下的两块、转动分组、火焰
  });

  it('灯光、半透明网格、带 userData 的节点和被 userData 引用的节点保持原样', () => {
    const mat = new MeshStandardMaterial();
    const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.5 });
    const root = new Group();
    const light = new PointLight();
    const window = box(glass);
    const arrow = box(mat, 5);
    root.userData['arrow'] = arrow; // 例如弓上的箭：代码会通过引用去开关它
    const tagged = box(mat, 6);
    tagged.userData['unitId'] = 'A0';
    root.add(light, window, arrow, tagged, box(mat, 1), box(mat, 2));
    mergeStaticMeshes(root);
    expect(light.parent).toBe(root);
    expect(window.parent).toBe(root);
    expect(arrow.parent).toBe(root);
    expect(tagged.parent).toBe(root);
    expect(meshes(root)).toHaveLength(4);
  });

  it('实例化网格的每个实例烘进合并后的几何体', () => {
    const mat = new MeshStandardMaterial();
    const root = new Group();
    const rubble = new InstancedMesh(new BoxGeometry(1, 1, 1), mat, 5);
    for (let i = 0; i < 5; i++) rubble.setMatrixAt(i, new Matrix4().makeTranslation(i * 2, 0, 0));
    rubble.castShadow = true;
    root.add(rubble, box(mat, 0, 5));
    const before = triangles(root);
    mergeStaticMeshes(root);
    expect(meshes(root)).toHaveLength(1);
    expect(triangles(root)).toBe(before);
  });

  it('没有可合并内容的模型原样返回', () => {
    const root = new Group();
    const only = box(new MeshStandardMaterial());
    root.add(only);
    expect(mergeStaticMeshes(root)).toEqual({ meshesBefore: 1, meshesAfter: 1 });
    expect(meshes(root)[0]!.geometry.getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('阴影代理', () => {
  it('一个部件用了几种材质，阴影图层上也只有一个网格，且形状（三角形数）与原来相同', () => {
    const { root, body } = buildModel();
    const before = triangles(root);
    mergeStaticMeshes(root, { shadowLayer: SHADOW_LAYER });
    enableShadowLayer(root, SHADOW_LAYER);
    const onShadow = meshes(root).filter((m) => m.castShadow && m.layers.isEnabled(SHADOW_LAYER));
    // 身体：铁 + 布 → 1 个代理；手臂只有 1 个网格，自己投影
    expect(onShadow).toHaveLength(2);
    expect(onShadow.filter((m) => m.parent === body)).toHaveLength(1);
    expect(onShadow.reduce((n, m) => n + m.geometry.getAttribute('position').count / 3, 0)).toBe(before);
    // 代理不在画面图层上；画面里的网格数不变
    const proxy = onShadow.find((m) => m.material instanceof MeshBasicMaterial)!;
    expect(proxy.layers.isEnabled(0)).toBe(false);
    expect(meshes(root).filter((m) => m.layers.isEnabled(0))).toHaveLength(3);
  });

  it('镂空材质（破布）不用代理，自己投射镂空的阴影', () => {
    const solid = new MeshStandardMaterial();
    const solid2 = new MeshStandardMaterial({ color: 0x222222 });
    const tatter = new MeshStandardMaterial({ alphaTest: 0.5 });
    const root = new Group();
    root.add(box(solid), box(solid2, 1), box(tatter, 2));
    mergeStaticMeshes(root, { shadowLayer: SHADOW_LAYER });
    enableShadowLayer(root, SHADOW_LAYER);
    const cloth = meshes(root).find((m) => m.material === tatter)!;
    expect(cloth.layers.isEnabled(SHADOW_LAYER)).toBe(true);
    expect(cloth.layers.isEnabled(0)).toBe(true);
    // 两个实心网格由一个代理代替，自己不再进阴影图层
    for (const m of meshes(root).filter((x) => x.material === solid || x.material === solid2)) {
      expect(m.layers.isEnabled(SHADOW_LAYER)).toBe(false);
    }
  });

  it('没有合并过的投影物体由 enableShadowLayer 放进阴影图层，不投影的不放', () => {
    const root = new Group();
    const caster = box(new MeshStandardMaterial());
    const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    root.add(caster, ground);
    enableShadowLayer(root, SHADOW_LAYER);
    expect(caster.layers.isEnabled(SHADOW_LAYER)).toBe(true);
    expect(ground.layers.isEnabled(SHADOW_LAYER)).toBe(false);
  });
});

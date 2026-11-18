// 入场过场自己的地面特效（步骤 17）：队长脚下铺开的暗影池（3 片：队长脚下 + 左右两片）、Boss 跺地后发光的地面裂纹。
// 启动时建好、常驻场景（不用时隐藏，不绘制），过场中只改位置、大小和不透明度，不新建对象。
// 冲击波环、尘土、碎石用现有的特效系统（FxSystem）。

import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, NormalBlending, PlaneGeometry, type Texture } from 'three';
import { groundCrackTexture, ringTexture, shadowPoolTexture } from '../../assets/textures/fxTextures';

function flatDecal(map: Texture, additive: boolean, renderOrder: number): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const geo = new PlaneGeometry(2, 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({
    map,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: additive ? AdditiveBlending : NormalBlending,
    depthWrite: false,
    fog: !additive,
  });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = renderOrder;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

export class IntroFx {
  readonly group = new Group();
  /** 暗影池：0 = 队长脚下，1 / 2 = 左右两片 */
  private readonly pools: Mesh<PlaneGeometry, MeshBasicMaterial>[];
  private readonly cracks: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** 冲击波环：匀速扩散（到达某人的时刻 = 距离 / 速度，与震飞的时刻一致） */
  private readonly wave: Mesh<PlaneGeometry, MeshBasicMaterial>;

  constructor() {
    this.group.name = 'introFx';
    this.pools = [0, 1, 2].map(() => flatDecal(shadowPoolTexture(), false, 2));
    this.cracks = flatDecal(groundCrackTexture(), true, 2);
    this.wave = flatDecal(ringTexture(), true, 3);
    this.group.add(...this.pools, this.cracks, this.wave);
  }

  /** 摆一片暗影池（opacity ≤ 0 时隐藏） */
  setPool(i: number, x: number, z: number, radius: number, opacity: number, color: number): void {
    const m = this.pools[i];
    if (!m) return;
    m.visible = opacity > 0.001 && radius > 0.001;
    m.position.set(x, 0.025 + i * 0.002, z);
    m.scale.setScalar(Math.max(0.001, radius));
    m.material.opacity = Math.max(0, Math.min(1, opacity));
    m.material.color.setHex(color);
  }

  /** 地面裂纹（opacity ≤ 0 时隐藏）；rotation 让每次的裂纹朝向不同 */
  setCracks(x: number, z: number, radius: number, opacity: number, color: number, rotation = 0): void {
    const m = this.cracks;
    m.visible = opacity > 0.001;
    m.position.set(x, 0.03, z);
    m.rotation.y = rotation;
    m.scale.setScalar(Math.max(0.001, radius));
    m.material.opacity = Math.max(0, Math.min(1, opacity));
    m.material.color.setHex(color);
  }

  /** 冲击波环（opacity ≤ 0 时隐藏） */
  setWave(x: number, z: number, radius: number, opacity: number, color: number): void {
    const m = this.wave;
    m.visible = opacity > 0.001 && radius > 0.001;
    m.position.set(x, 0.05, z);
    m.scale.setScalar(Math.max(0.001, radius));
    m.material.opacity = Math.max(0, Math.min(1, opacity));
    m.material.color.setHex(color);
  }

  /** 全部隐藏（过场结束、跳过、中途退出） */
  clear(): void {
    for (const m of this.pools) {
      m.visible = false;
      m.material.opacity = 0;
    }
    for (const m of [this.cracks, this.wave]) {
      m.visible = false;
      m.material.opacity = 0;
    }
  }

  /** 正在显示的贴花数量（残留检查） */
  get activeCount(): number {
    return [...this.pools, this.cracks, this.wave].filter((m) => m.visible).length;
  }

  /** 预热着色器：临时全部显示（不透明度 0） */
  setPrewarm(on: boolean): void {
    for (const m of [...this.pools, this.cracks, this.wave]) m.visible = on;
  }
}

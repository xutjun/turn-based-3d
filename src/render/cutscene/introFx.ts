// 入场过场自己的地面特效（步骤 17）：队长脚下铺开的暗影池（3 片：队长脚下 + 左右两片，各带一圈暗紫发光边和缓慢旋转的符文）、
// Boss 怒吼的暗红气浪环、Boss 跺地后发光的地面裂纹与冲击波环。
// 启动时建好、常驻场景（不用时隐藏，不绘制），过场中只改位置、大小和不透明度，不新建对象。
// 冲击波环、尘土、碎石用现有的特效系统（FxSystem）。

import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, NormalBlending, PlaneGeometry, type Texture } from 'three';
import { groundCrackTexture, ringTexture, runeCircleTexture, shadowPoolTexture } from '../../assets/textures/fxTextures';

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
  /** 每片暗影池的暗紫发光边（叠加发光）与旋转的符文 */
  private readonly rims: Mesh<PlaneGeometry, MeshBasicMaterial>[];
  private readonly runes: Mesh<PlaneGeometry, MeshBasicMaterial>[];
  /** Boss 怒吼时向外扩散的暗红气浪（两道） */
  private readonly roars: Mesh<PlaneGeometry, MeshBasicMaterial>[];
  private readonly cracks: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** 冲击波环：匀速扩散（到达某人的时刻 = 距离 / 速度，与震飞的时刻一致） */
  private readonly wave: Mesh<PlaneGeometry, MeshBasicMaterial>;

  constructor() {
    this.group.name = 'introFx';
    this.pools = [0, 1, 2].map(() => flatDecal(shadowPoolTexture(), false, 2));
    this.rims = [0, 1, 2].map(() => flatDecal(ringTexture(), true, 3));
    this.runes = [0, 1, 2].map(() => flatDecal(runeCircleTexture(5, 13), true, 3));
    this.roars = [0, 1].map(() => flatDecal(ringTexture(), true, 3));
    this.cracks = flatDecal(groundCrackTexture(), true, 2);
    this.wave = flatDecal(ringTexture(), true, 3);
    this.group.add(...this.pools, ...this.rims, ...this.runes, ...this.roars, this.cracks, this.wave);
  }

  /**
   * 摆一片暗影池（opacity ≤ 0 时隐藏）：暗色的池子 + 一圈暗紫发光边 + 缓慢旋转的符文（spin 弧度），暗色地面上也看得清。
   * @param glow 发光边和符文的颜色
   */
  setPool(i: number, x: number, z: number, radius: number, opacity: number, color: number, glow = 0x7a34c8, spin = 0): void {
    const m = this.pools[i];
    const rim = this.rims[i];
    const rune = this.runes[i];
    if (!m || !rim || !rune) return;
    const on = opacity > 0.001 && radius > 0.001;
    const a = Math.max(0, Math.min(1, opacity));
    m.visible = rim.visible = rune.visible = on;
    m.position.set(x, 0.025 + i * 0.002, z);
    m.scale.setScalar(Math.max(0.001, radius));
    m.material.opacity = a;
    m.material.color.setHex(color);
    // 发光边：环贴图的亮环在半径 0.88 处，放大到池子边缘
    rim.position.set(x, 0.035 + i * 0.002, z);
    rim.scale.setScalar(Math.max(0.001, radius * 0.95));
    rim.material.opacity = a * 0.9;
    rim.material.color.setHex(glow);
    rune.position.set(x, 0.04 + i * 0.002, z);
    rune.rotation.y = spin;
    rune.scale.setScalar(Math.max(0.001, radius * 0.78));
    rune.material.opacity = a * 0.7;
    rune.material.color.setHex(glow);
  }

  /** Boss 怒吼的暗红气浪环（i = 0 / 1；opacity ≤ 0 时隐藏），离地 y 米 */
  setRoar(i: number, x: number, y: number, z: number, radius: number, opacity: number, color: number): void {
    const m = this.roars[i];
    if (!m) return;
    m.visible = opacity > 0.001 && radius > 0.001;
    m.position.set(x, y, z);
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
    for (const m of [...this.pools, ...this.rims, ...this.runes, ...this.roars]) {
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
    return [...this.pools, ...this.rims, ...this.runes, ...this.roars, this.cracks, this.wave].filter((m) => m.visible).length;
  }

  /** 预热着色器：临时全部显示（不透明度 0） */
  setPrewarm(on: boolean): void {
    for (const m of [...this.pools, ...this.rims, ...this.runes, ...this.roars, this.cracks, this.wave]) m.visible = on;
  }
}

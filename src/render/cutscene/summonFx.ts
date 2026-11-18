// 召唤演出自己的特效（步骤 18）：每个阵位脚下的地面贴花（骷髅兵的地裂、堕落骑士的黑烟池、亡灵法师的鬼火圈、
// 恶魔祭司的暗影法阵和身影穿出地面处的光环）。
// 与 introFx 相同的做法：启动时全部建好、常驻场景（不用时隐藏，不绘制），演出中只改位置、大小、不透明度和贴图，
// 不新建对象；全部用不受光照的 MeshBasicMaterial，不增减光源，不会触发材质重编译。尘土、粒子用现有的特效系统。

import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, NormalBlending, PlaneGeometry, type Texture } from 'three';
import { groundCrackTexture, ringTexture, runeCircleTexture, shadowPoolTexture } from '../../assets/textures/fxTextures';

type Decal = Mesh<PlaneGeometry, MeshBasicMaterial>;

function flatDecal(map: Texture, additive: boolean, renderOrder: number): Decal {
  const g = new PlaneGeometry(2, 2);
  g.rotateX(-Math.PI / 2);
  const mat = new MeshBasicMaterial({
    map,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: additive ? AdditiveBlending : NormalBlending,
    depthWrite: false,
    fog: !additive,
  });
  const mesh = new Mesh(g, mat);
  mesh.renderOrder = renderOrder;
  mesh.visible = false;
  mesh.frustumCulled = false;
  return mesh;
}

/** 每个阵位脚下的贴花种类 */
export type SlotDecal = 'crack' | 'ring' | 'rune';

/** 阵位贴花的个数上限（9 个小怪） */
export const SUMMON_SLOTS = 10;

export class SummonFx {
  readonly group = new Group();
  /** 阵位贴花：暗色底（普通混合）、发光层（叠加，贴图按种类换）、随身影升起的光环 */
  private readonly pools: Decal[];
  private readonly glows: Decal[];
  private readonly rings: Decal[];
  private readonly maps: Record<SlotDecal, Texture>;

  constructor() {
    this.group.name = 'summonFx';
    this.maps = { crack: groundCrackTexture(47), ring: ringTexture(), rune: runeCircleTexture(5, 59) };
    this.pools = Array.from({ length: SUMMON_SLOTS }, () => flatDecal(shadowPoolTexture(), false, 2));
    this.glows = Array.from({ length: SUMMON_SLOTS }, () => flatDecal(this.maps.crack, true, 3));
    this.rings = Array.from({ length: SUMMON_SLOTS }, () => flatDecal(ringTexture(), true, 4));
    this.group.add(...this.pools, ...this.glows, ...this.rings);
  }

  private get all(): Decal[] {
    return [...this.pools, ...this.glows, ...this.rings];
  }

  /** 第 i 个阵位的暗色底（opacity ≤ 0 时隐藏） */
  setPool(i: number, x: number, z: number, radius: number, opacity: number, color: number): void {
    const m = this.pools[i];
    if (!m) return;
    m.visible = opacity > 0.001 && radius > 0.001;
    m.position.set(x, 0.026, z);
    m.scale.setScalar(Math.max(0.001, radius));
    m.material.opacity = Math.max(0, Math.min(1, opacity));
    m.material.color.setHex(color);
  }

  /** 第 i 个阵位的发光贴花：地裂 / 光圈 / 符文阵（opacity ≤ 0 时隐藏；spin 为绕竖直轴的转角） */
  setGlow(i: number, kind: SlotDecal, x: number, z: number, radius: number, opacity: number, color: number, spin = 0): void {
    const m = this.glows[i];
    if (!m) return;
    m.visible = opacity > 0.001 && radius > 0.001;
    if (m.material.map !== this.maps[kind]) m.material.map = this.maps[kind]; // 只换贴图，不改着色器
    m.position.set(x, 0.036, z);
    m.rotation.y = spin;
    m.scale.setScalar(Math.max(0.001, radius));
    m.material.opacity = Math.max(0, Math.min(1, opacity));
    m.material.color.setHex(color);
  }

  /** 第 i 个阵位随身影升起的光环（离地 y 米；opacity ≤ 0 时隐藏） */
  setRing(i: number, x: number, y: number, z: number, radius: number, opacity: number, color: number): void {
    const m = this.rings[i];
    if (!m) return;
    m.visible = opacity > 0.001 && radius > 0.001;
    m.position.set(x, y, z);
    m.scale.setScalar(Math.max(0.001, radius));
    m.material.opacity = Math.max(0, Math.min(1, opacity));
    m.material.color.setHex(color);
  }

  /** 全部隐藏（召唤结束、跳过、中途退出） */
  clear(): void {
    for (const m of this.all) {
      m.visible = false;
      m.material.opacity = 0;
    }
  }

  /** 正在显示的贴花数量（残留检查） */
  get activeCount(): number {
    return this.all.filter((m) => m.visible).length;
  }

  /** 预热着色器：临时全部显示（不透明度 0）；三种阵位贴图各用一次 */
  setPrewarm(on: boolean): void {
    const kinds: SlotDecal[] = ['crack', 'ring', 'rune'];
    this.glows.forEach((m, i) => (m.material.map = this.maps[kinds[i % kinds.length]!]));
    for (const m of this.all) m.visible = on;
  }
}

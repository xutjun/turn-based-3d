// 暗影显形的材质工具（步骤 17，DESIGN §11.4；步骤 18 召唤、步骤 19 化入暗影共用）。
//
// 模型的材质有的是多个单位共用的（石材、旧铁 …），不能直接改原材质的透明度和颜色，否则别人也会跟着变。
// 做法：显形期间把这个模型网格上的材质换成它自己的一份副本（第一次用时创建，之后复用），
// 副本共用原材质的贴图和着色器注入（onBeforeCompile / customProgramCacheKey），只改不透明度、颜色和自发光；
// 进度到 1（或 restore()）时换回原材质，原材质一个参数都不动。

import { Color, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';

interface Slot {
  mesh: Mesh;
  original: Material | Material[];
  copies: Material | Material[];
}

interface Copy {
  source: Material;
  copy: Material;
}

/** 显形时的幽影外观 */
export interface ShadeLook {
  tint: number; // 幽影的颜色
  glow: number; // 幽影的自发光
  glowStrength: number;
}

const tmp = new Color();
const tmp2 = new Color();

/** 材质副本：共用贴图与着色器注入，透明 */
function copyMaterial(source: Material): Material {
  const ud = source.userData;
  source.userData = {};
  const copy = source.clone();
  source.userData = ud;
  copy.userData = ud;
  copy.onBeforeCompile = source.onBeforeCompile;
  copy.customProgramCacheKey = source.customProgramCacheKey;
  copy.transparent = true;
  copy.depthWrite = true;
  return copy;
}

export class ShadeReveal {
  private slots: Slot[] | null = null;
  private copies: Copy[] = [];
  /** 精灵、粒子等非网格的发光物（眼睛的光点）：幽影阶段先藏起来 */
  private extras: { o: Object3D; visible: boolean }[] = [];
  private on = false;
  private level = 1;

  constructor(private readonly model: Object3D) {}

  /** 是否正在显形（副本材质在用） */
  get active(): boolean {
    return this.on;
  }

  /** 当前进度（1 = 实体） */
  get progress(): number {
    return this.level;
  }

  /** 提前造好副本（预热着色器用）；已经造过时什么都不做 */
  prepare(): void {
    if (this.slots) return;
    const slots: Slot[] = [];
    const made = new Map<Material, Material>();
    const copyOf = (m: Material): Material => {
      let c = made.get(m);
      if (!c) {
        c = copyMaterial(m);
        made.set(m, c);
        this.copies.push({ source: m, copy: c });
      }
      return c;
    };
    this.model.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        const original = mesh.material;
        const copies = Array.isArray(original) ? original.map(copyOf) : copyOf(original);
        slots.push({ mesh, original, copies });
      } else if ((o as { isSprite?: boolean }).isSprite || (o as { isPoints?: boolean }).isPoints) {
        this.extras.push({ o, visible: o.visible });
      }
    });
    this.slots = slots;
  }

  /** 换上副本材质（预热、开始显形时） */
  private engage(): void {
    this.prepare();
    if (this.on) return;
    this.on = true;
    for (const s of this.slots!) s.mesh.material = s.copies;
    for (const e of this.extras) e.visible = e.o.visible;
  }

  /**
   * 显形进度：0 = 完全是幽影（透明、暗紫），1 = 实体（换回原材质）。
   * 不透明度先升，颜色和自发光稍后才转为原值，看起来是“暗影凝成实体”。
   */
  set(k: number, look: ShadeLook): void {
    const t = Math.max(0, Math.min(1, k));
    this.level = t;
    if (t >= 1) {
      this.restore();
      return;
    }
    this.engage();
    const alpha = Math.min(1, t * 1.6);
    const solid = t * t; // 颜色转为原值
    const glow = (1 - t) * look.glowStrength;
    for (const { source, copy } of this.copies) {
      copy.opacity = source.opacity * alpha * alpha * (3 - 2 * alpha);
      const src = source as MeshStandardMaterial;
      const dst = copy as MeshStandardMaterial;
      if (src.color && dst.color) dst.color.copy(tmp.setHex(look.tint)).lerp(src.color, solid);
      if (src.emissive && dst.emissive) {
        // 自发光：幽影的暗紫 → 原材质的自发光
        tmp.setHex(look.glow).multiplyScalar(glow);
        tmp2.copy(src.emissive).multiplyScalar((src.emissiveIntensity ?? 1) * solid);
        dst.emissive.copy(tmp).add(tmp2);
        dst.emissiveIntensity = 1;
      }
    }
    // 眼睛等光点：快成实体时才出现
    for (const e of this.extras) e.o.visible = e.visible && t > 0.6;
  }

  /** 换回原材质（显形结束、中途被打断、重置时） */
  restore(): void {
    this.level = 1;
    if (!this.on || !this.slots) return;
    this.on = false;
    for (const s of this.slots) s.mesh.material = s.original;
    for (const e of this.extras) e.o.visible = e.visible;
  }

  /** 预热：临时换上副本（不透明度 0），交给调用方编译一次着色器后再 restore() */
  engageForPrewarm(look: ShadeLook): void {
    this.set(0, look);
  }

  /** 调试 / 测试：所有网格是否都用着原材质 */
  usingOriginals(): boolean {
    if (!this.slots) return true;
    return this.slots.every((s) => s.mesh.material === s.original);
  }
}

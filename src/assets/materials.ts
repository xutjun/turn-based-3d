// 共享材质：石材、旧铁、骨头、旧木。场景物件复用同一份材质以减少开销。

import {
  Color,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  Vector2,
  type Mesh,
  type Object3D,
  type Texture,
} from 'three';
import type { TextureSet } from './textures/canvas';
import {
  boneTextures,
  chainmailTextures,
  clothTextures,
  furTextures,
  ironTextures,
  leatherTextures,
  plateTextures,
  stoneTextures,
} from './textures/surfaces';

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

// ---------------------------------------------------------------------------
// 角色材质：铁甲、皮革、布料、发光体，以及轮边光。
// ---------------------------------------------------------------------------

/** 轮边光参数 */
export interface RimOptions {
  color: number;
  strength: number;
  power: number; // 越大亮边越窄
  /** 底色提亮：把表面自身的颜色按这个比例加到自发光里，暗场中也能分辨出材质的配色（默认 0） */
  lift?: number;
}

/**
 * 给材质加轮边光（菲涅耳）：视线与表面法线夹角越大（越靠近轮廓）越亮。
 * 实现方式是在标准材质的片元着色器里往自发光项上加一项。
 */
export function applyRimLight<T extends MeshStandardMaterial>(material: T, rim: RimOptions): T {
  const uniforms = {
    uRimColor: { value: new Color(rim.color) },
    uRimStrength: { value: rim.strength },
    uRimPower: { value: rim.power },
    uRimLift: { value: rim.lift ?? 0 },
  };
  material.userData['rimUniforms'] = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;\nuniform float uRimLift;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float rimDot = 1.0 - saturate(dot(normalize(vViewPosition), normal));
          totalEmissiveRadiance += uRimColor * pow(rimDot, uRimPower) * uRimStrength;
          totalEmissiveRadiance += diffuseColor.rgb * uRimLift;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'rim';
  return material;
}

/** 角色表面材质的公共参数 */
export interface SurfaceOptions {
  color: number;
  rim?: RimOptions;
  metalness?: number;
  roughness?: number; // 粗糙度贴图的整体倍率
  doubleSide?: boolean;
  /** 透明度贴图（破布下摆等），配合 alphaTest 使用 */
  alphaMap?: Texture;
  /** 贴图重复次数 */
  repeat?: number;
}

function surface(
  textures: TextureSet,
  opts: SurfaceOptions,
  defaults: { metalness: number; roughness: number; normal: number },
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: opts.color,
    map: textures.map,
    normalMap: textures.normalMap,
    roughnessMap: textures.roughnessMap,
    normalScale: new Vector2(defaults.normal, defaults.normal),
    metalness: opts.metalness ?? defaults.metalness,
    roughness: opts.roughness ?? defaults.roughness,
    side: opts.doubleSide ? DoubleSide : FrontSide,
  });
  if (opts.alphaMap) {
    mat.alphaMap = opts.alphaMap;
    mat.alphaTest = 0.5;
  }
  if (opts.rim) applyRimLight(mat, opts.rim);
  return mat;
}

/** 旧铁甲片（高金属度，粗糙度随划痕和锈迹变化） */
export function plateMaterial(opts: SurfaceOptions): MeshStandardMaterial {
  return surface(plateTextures(), opts, { metalness: 0.85, roughness: 1, normal: 1.2 });
}

/** 皮革 */
export function leatherMaterial(opts: SurfaceOptions): MeshStandardMaterial {
  return surface(leatherTextures(), opts, { metalness: 0.05, roughness: 1, normal: 1.3 });
}

/** 布料 / 破布 */
export function clothMaterial(opts: SurfaceOptions): MeshStandardMaterial {
  return surface(clothTextures(), opts, { metalness: 0, roughness: 1, normal: 1.1 });
}

/** 锁子甲：密排的小铁环 */
export function mailMaterial(opts: SurfaceOptions): MeshStandardMaterial {
  // 锁环的疏密由各部件的贴图坐标决定（见 parts.ts 的 scaleUv）
  return surface(chainmailTextures(), opts, { metalness: 0.8, roughness: 1, normal: 1.6 });
}

/** 毛皮：顺着一个方向的毛流 */
export function furMaterial(opts: SurfaceOptions): MeshStandardMaterial {
  return surface(furTextures(), opts, { metalness: 0, roughness: 1, normal: 1.8 });
}

/**
 * 花边 / 纹饰带：贴图本身带颜色（见 textures/sprites.ts 的 ornamentStripTexture），用在袍边、领口、披风镶边。
 */
export function bandMaterial(
  map: Texture,
  opts: { rim?: RimOptions; metalness?: number; roughness?: number; doubleSide?: boolean } = {},
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    map,
    metalness: opts.metalness ?? 0.35,
    roughness: opts.roughness ?? 0.6,
    side: opts.doubleSide ? DoubleSide : FrontSide,
  });
  if (opts.rim) applyRimLight(mat, opts.rim);
  return mat;
}

/** 骨质（带轮边光，可染色） */
export function boneSurfaceMaterial(opts: SurfaceOptions): MeshStandardMaterial {
  return surface(boneTextures(), opts, { metalness: 0, roughness: 1, normal: 1 });
}

/** 石质（魔偶等，带轮边光，可染色） */
export function stoneSurfaceMaterial(opts: SurfaceOptions): MeshStandardMaterial {
  return surface(stoneTextures(), opts, { metalness: 0.05, roughness: 1, normal: 1.5 });
}

/** 发光强度可整体缩放的材质上，记录基础强度的键 */
export const GLOW_BASE_KEY = 'glowBase';

/**
 * 发光材质：自发光颜色 + 可选的自发光贴图（符文带等）。
 * 基础强度记在 userData 里，方便之后整体调节发光强度（预览页的强度切换、出手瞬间增强）。
 */
export function glowMaterial(
  color: number,
  intensity: number,
  opts: {
    emissiveMap?: Texture;
    baseColor?: number;
    doubleSide?: boolean;
    /** 底面用的表面贴图（石头、铁甲 …）：发光符文刻在有质感的表面上，而不是纯色底上 */
    surface?: TextureSet;
    metalness?: number;
    rim?: RimOptions;
  } = {},
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: opts.baseColor ?? 0x050505,
    emissive: new Color(color),
    emissiveIntensity: intensity,
    emissiveMap: opts.emissiveMap ?? null,
    roughness: opts.surface ? 1 : 0.6,
    metalness: opts.metalness ?? 0,
    side: opts.doubleSide ? DoubleSide : FrontSide,
  });
  if (opts.surface) {
    mat.map = opts.surface.map;
    mat.normalMap = opts.surface.normalMap;
    mat.roughnessMap = opts.surface.roughnessMap;
  }
  if (opts.rim) applyRimLight(mat, opts.rim);
  mat.userData[GLOW_BASE_KEY] = intensity;
  return mat;
}

/** 模型节点上的“发光倍率回调”键：武器等自己管理发光的模型用它接收整体倍率 */
export const GLOW_SCALE_HOOK = 'glowScaleHook';

/**
 * 整体缩放一个模型上所有发光材质的强度。scale = 1 为配置的基础强度。
 * 自己管理发光的子模型（武器的呼吸、出手闪光）通过 GLOW_SCALE_HOOK 接收倍率。
 */
export function setGlowScale(root: Object3D, scale: number): void {
  root.traverse((o) => {
    const hook = o.userData[GLOW_SCALE_HOOK] as ((scale: number) => void) | undefined;
    if (typeof hook === 'function') hook(scale);
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const base = m.userData[GLOW_BASE_KEY] as number | undefined;
      if (base !== undefined) (m as MeshStandardMaterial).emissiveIntensity = base * scale;
    }
  });
}

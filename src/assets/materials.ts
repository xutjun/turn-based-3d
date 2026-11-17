// 共享材质：石材、旧铁、骨头、旧木。场景物件复用同一份材质以减少开销。

import {
  Color,
  DoubleSide,
  FrontSide,
  MeshStandardMaterial,
  Vector2,
  Vector3,
  Vector4,
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
  /**
   * 顶面提亮 / 底面压暗：朝上的面按 1 + topShade 提亮，朝下的面按 1 − topShade 压暗，侧面不变（默认 0）。
   * 给石块这类大体块用，靠明暗而不是杂色拉开层次。
   */
  topShade?: number;
}

/**
 * 布料飘动（步骤 10 · C 组）：在顶点着色器里让“带飘动权重的顶点”沿法线方向缓慢摆动。
 * 权重是几何体上的 aSway 属性（披风、袍摆、破旗、锁链在 parts.ts 里写入，挂点处为 0、下摆处为 1）；
 * 没有这个属性的几何体权重恒为 0，完全不受影响。这样飘动不需要任何额外的关节和绘制调用。
 *
 * 全局量（所有材质共用同一个对象）：时间、画质开关；每个材质自己的量：相位、幅度、频率，
 * 由单位的待机动画按“这个单位自己的相位”写入（见 render/units/IdleAnimator.ts）。
 */
export const SWAY_GLOBAL = {
  uSwayTime: { value: 0 },
  uSwayQuality: { value: 1 }, // 低画质下置 0，关闭飘动
};

export interface SwayUniforms {
  uSwayPhase: { value: number };
  uSwayAmp: { value: number }; // 最大位移（米，模型缩放前）
  uSwayHz: { value: number };
  /**
   * 次级运动（步骤 11）：身体运动把布料“甩”出去的偏移量（世界坐标，米）。
   * 带飘动权重的顶点按 权重 × 偏移量 位移；由单位的弹簧质点每帧写入（render/units/UnitMotion.ts），静止时为 0。
   */
  uSwayPush: { value: Vector3 };
  /**
   * 腿把布料顶开（步骤 14）：膝关节相对髋关节的位置（身体坐标）= (左膝前后（米）, 左膝深度（÷ 髋高）, 右膝前后, 右膝深度)。
   * 带 aStride 属性的顶点（髋部的袍摆、裙甲、挂件）被腿顶开（见着色器）。腿在正下方时前后位置为 0。
   */
  uSwayStride: { value: Vector4 };
  /** 同上，踝关节：(左踝前后, 左踝深度, 右踝前后, 右踝深度) */
  uSwayStrideFoot: { value: Vector4 };
  /** 腿的粗细（米） */
  uSwayStrideMargin: { value: number };
}

export const SWAY_UNIFORMS_KEY = 'swayUniforms';
const SWAY_DEFAULT_AMP = 0.03;
const SWAY_DEFAULT_HZ = 0.45;

const SWAY_VERTEX_DECL = `
attribute float aSway;
attribute vec3 aSwayDir;
uniform float uSwayTime;
uniform float uSwayQuality;
uniform float uSwayPhase;
uniform float uSwayAmp;
uniform float uSwayHz;
uniform vec3 uSwayPush;
attribute vec4 aStride;
uniform vec4 uSwayStride;
uniform vec4 uSwayStrideFoot;
uniform float uSwayStrideMargin;
// 这个深度上一条腿的前后位置：髋 (0, 0) → 膝 (kz, kd) → 踝 (fz, fd) 的折线，踝以下取踝
float strideLegZ(float d, float kz, float kd, float fz, float fd) {
  if (d <= kd) return kz * d / max(1e-3, kd);
  return mix(kz, fz, clamp((d - kd) / max(1e-3, fd - kd), 0.0, 1.0));
}`;

const SWAY_VERTEX_BODY = `
{
  float swayW = aSway * uSwayAmp * uSwayQuality;
  if (swayW != 0.0) {
    float swayPh = uSwayTime * uSwayHz * 6.2832 + uSwayPhase + position.y * 5.0 + position.x * 2.5;
    vec3 swayDir = dot(aSwayDir, aSwayDir) > 0.0 ? aSwayDir : objectNormal;
    transformed += swayDir * swayW * (0.65 * sin(swayPh) + 0.35 * sin(swayPh * 1.83 + 1.7));
  }
  float pushW = aSway * uSwayQuality;
  if (pushW != 0.0 && dot(uSwayPush, uSwayPush) > 0.0) {
    // 世界坐标的偏移量换回模型坐标（旋转 + 等比缩放的逆 = 转置 / 缩放的平方）
    mat3 swayM = mat3(modelMatrix);
    transformed += (uSwayPush * swayM) * (pushW / dot(swayM[0], swayM[0]));
  }
  // 腿把布料顶开（步骤 14，防穿模，低画质也保留）：在“髋 → 膝 → 踝”之间插出这个高度上腿的前后位置，
  // 腿（加上腿的粗细）碰到布料时把布料推开刚好那么多——迈出的腿把前片顶向前，蹬地的腿把后片顶向后，腿没碰到的地方不动。
  // aStride = (深度, 正对左腿的程度, 顶点在髋部坐标里的前后位置, 正对右腿的程度)，与网格合并与否无关；
  // 两条腿各算一次，前片取更靠前的推开量，后片取更靠后的
  if (aStride.x != 0.0 && aStride.y + aStride.w != 0.0 && (uSwayStride.x != 0.0 || uSwayStride.z != 0.0 || uSwayStrideFoot.x != 0.0 || uSwayStrideFoot.z != 0.0)) {
    float legL = strideLegZ(aStride.x, uSwayStride.x, uSwayStride.y, uSwayStrideFoot.x, uSwayStrideFoot.y) * aStride.y;
    float legR = strideLegZ(aStride.x, uSwayStride.z, uSwayStride.w, uSwayStrideFoot.z, uSwayStrideFoot.w) * aStride.w;
    float margin = uSwayStrideMargin;
    float zv = aStride.z;
    float pushFwd = max(0.0, max(legL, legR) + margin - zv) - max(0.0, margin - zv);
    float pushBack = min(0.0, min(legL, legR) - margin - zv) - min(0.0, -margin - zv);
    transformed.z += zv >= 0.0 ? pushFwd : pushBack;
  }
}`;

/**
 * 给材质装上角色用的着色器补丁：布料飘动（总是装），以及可选的轮边光。
 */
function patchCharacterShader<T extends MeshStandardMaterial>(material: T, rim?: RimOptions): T {
  const sway: SwayUniforms = {
    uSwayPhase: { value: 0 },
    uSwayAmp: { value: SWAY_DEFAULT_AMP },
    uSwayHz: { value: SWAY_DEFAULT_HZ },
    uSwayPush: { value: new Vector3() },
    uSwayStride: { value: new Vector4() },
    uSwayStrideFoot: { value: new Vector4() },
    uSwayStrideMargin: { value: 0 },
  };
  material.userData[SWAY_UNIFORMS_KEY] = sway;
  const rimUniforms = rim
    ? {
        uRimColor: { value: new Color(rim.color) },
        uRimStrength: { value: rim.strength },
        uRimPower: { value: rim.power },
        uRimLift: { value: rim.lift ?? 0 },
        uTopShade: { value: rim.topShade ?? 0 },
      }
    : undefined;
  if (rimUniforms) material.userData['rimUniforms'] = rimUniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SWAY_GLOBAL, sway, rimUniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>${SWAY_VERTEX_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>${SWAY_VERTEX_BODY}`);
    if (!rimUniforms) return;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStrength;\nuniform float uRimPower;\nuniform float uRimLift;\nuniform float uTopShade;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float rimDot = 1.0 - saturate(dot(normalize(vViewPosition), normal));
          totalEmissiveRadiance += uRimColor * pow(rimDot, uRimPower) * uRimStrength;
          vec3 upView = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          diffuseColor.rgb *= 1.0 + uTopShade * dot(normal, upView);
          totalEmissiveRadiance += diffuseColor.rgb * uRimLift;
        }`,
      );
  };
  material.customProgramCacheKey = () => (rimUniforms ? 'rim+sway' : 'sway');
  return material;
}

/**
 * 给材质加轮边光（菲涅耳）：视线与表面法线夹角越大（越靠近轮廓）越亮。
 * 实现方式是在标准材质的片元着色器里往自发光项上加一项（同时装上布料飘动，见上）。
 */
export function applyRimLight<T extends MeshStandardMaterial>(material: T, rim: RimOptions): T {
  return patchCharacterShader(material, rim);
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
  return surface(furTextures(), opts, { metalness: 0, roughness: 1, normal: 1.0 });
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
  // 没有轮边光的发光材质也装上飘动（符文长带、翼膜脉络这类发光的布面要跟着一起飘）
  patchCharacterShader(mat, opts.rim);
  mat.userData[GLOW_BASE_KEY] = intensity;
  return mat;
}

/** 发光材质上记录“当前整体倍率”的键（setGlowScale 写入） */
export const GLOW_SCALE_KEY = 'glowScale';

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
      if (base === undefined) continue;
      m.userData[GLOW_SCALE_KEY] = scale; // 待机的发光呼吸在这个倍率之上再乘（见 IdleAnimator）
      (m as MeshStandardMaterial).emissiveIntensity = base * scale;
    }
  });
}

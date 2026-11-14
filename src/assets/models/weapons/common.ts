// 武器 builder 的公共参数与小工具。

import { ExtrudeGeometry, Shape, type BufferGeometry, type Texture } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import type { WeaponGlowDef } from '../../../data/weapons';
import type { RimOptions } from '../../materials';

/** 所有武器 builder 共有的参数 */
export interface WeaponBaseParams {
  scale: number; // 整体缩放
  rim: RimOptions; // 轮边光
  glow: WeaponGlowDef; // 发光参数，默认取 data/weapons.ts
}

export const WEAPON_RIM: RimOptions = RIM_CONFIG.ally;

/**
 * 把二维轮廓拉伸成刃片：轮廓画在“宽度 × 长度”平面上（x = 朝刃口方向，y = 朝尖端方向），
 * 成品的刃面朝 ±x，刃口朝 +z，长度沿 +y。
 * @param bevel 大于 0 时四周削出斜面，形成刃口
 */
export function bladeGeometry(points: [number, number][], thickness: number, bevel = 0): BufferGeometry {
  const shape = new Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const core = Math.max(0.001, thickness - bevel * 2);
  const geo = new ExtrudeGeometry(shape, {
    depth: core,
    steps: 1,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel * 2.2,
    bevelOffset: -bevel * 2.2, // 斜面向内收，不改变外轮廓
    bevelSegments: 1,
  });
  geo.translate(0, 0, -core / 2);
  geo.rotateY(-Math.PI / 2); // 轮廓的 x 轴转到 +z（刃口方向）
  return geo;
}

/** 复制一份贴图（共用图像数据），这样每把武器可以各自滚动、平铺 */
export function ownTexture(tex: Texture, repeatX = 1, repeatY = 1): Texture {
  const t = tex.clone();
  t.repeat.set(repeatX, repeatY);
  t.needsUpdate = true;
  return t;
}

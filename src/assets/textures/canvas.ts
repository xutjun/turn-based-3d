// Canvas 贴图工具：逐像素生成“颜色 + 高度 + 粗糙度”，并由高度推导法线贴图。

import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 Canvas 2D 上下文');
  return ctx;
}

/** 一个像素的材质取样：颜色 0~1、高度 0~1、粗糙度 0~1 */
export interface TexelSample {
  r: number;
  g: number;
  b: number;
  height: number;
  roughness: number;
}

/** 一套 PBR 贴图 */
export interface TextureSet {
  map: Texture;
  normalMap: Texture;
  roughnessMap: Texture;
}

const toByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

function finishTexture(canvas: HTMLCanvasElement, srgb: boolean): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 16; // 各向异性过滤（显卡不支持这么高时由 three 自动取上限），斜看布料、地面时不糊不闪
  tex.needsUpdate = true;
  return tex;
}

/**
 * 逐像素生成一套可平铺的 PBR 贴图。
 * @param size 贴图边长（像素）
 * @param sample 取样函数，u、v ∈ [0, 1)
 * @param normalStrength 法线强度，越大凹凸感越强
 */
export function generateTextureSet(
  size: number,
  sample: (u: number, v: number, out: TexelSample) => void,
  normalStrength = 2,
): TextureSet {
  const colorCanvas = createCanvas(size, size);
  const normalCanvas = createCanvas(size, size);
  const roughCanvas = createCanvas(size, size);
  const colorCtx = get2d(colorCanvas);
  const normalCtx = get2d(normalCanvas);
  const roughCtx = get2d(roughCanvas);
  const colorData = colorCtx.createImageData(size, size);
  const normalData = normalCtx.createImageData(size, size);
  const roughData = roughCtx.createImageData(size, size);
  const heights = new Float32Array(size * size);
  const out: TexelSample = { r: 0, g: 0, b: 0, height: 0, roughness: 1 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      sample(x / size, y / size, out);
      const i = y * size + x;
      const p = i * 4;
      heights[i] = out.height;
      colorData.data[p] = toByte(out.r);
      colorData.data[p + 1] = toByte(out.g);
      colorData.data[p + 2] = toByte(out.b);
      colorData.data[p + 3] = 255;
      // 粗糙度贴图读取 G 通道
      const rough = toByte(out.roughness);
      roughData.data[p] = rough;
      roughData.data[p + 1] = rough;
      roughData.data[p + 2] = rough;
      roughData.data[p + 3] = 255;
    }
  }

  // 由高度差分得到法线（边界环绕，保证平铺无缝）
  for (let y = 0; y < size; y++) {
    const yu = (y - 1 + size) % size;
    const yd = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size;
      const xr = (x + 1) % size;
      const dx = (heights[y * size + xr]! - heights[y * size + xl]!) * normalStrength;
      const dy = (heights[yd * size + x]! - heights[yu * size + x]!) * normalStrength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const p = (y * size + x) * 4;
      normalData.data[p] = toByte(-dx * inv * 0.5 + 0.5);
      normalData.data[p + 1] = toByte(dy * inv * 0.5 + 0.5);
      normalData.data[p + 2] = toByte(inv * 0.5 + 0.5);
      normalData.data[p + 3] = 255;
    }
  }

  colorCtx.putImageData(colorData, 0, 0);
  normalCtx.putImageData(normalData, 0, 0);
  roughCtx.putImageData(roughData, 0, 0);
  return {
    map: finishTexture(colorCanvas, true),
    normalMap: finishTexture(normalCanvas, false),
    roughnessMap: finishTexture(roughCanvas, false),
  };
}

/** 把普通画布包装成贴图（精灵、旗帜等用） */
export function canvasTexture(canvas: HTMLCanvasElement, srgb = true): CanvasTexture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

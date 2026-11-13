// 精灵与粒子贴图：光晕、火焰、烟雾、旗帜布面、占位血条、调试文字。全部用 Canvas 绘制。

import { type Texture } from 'three';
import { createRng } from '../../core/rng';
import { fbm } from '../noise';
import { canvasTexture, createCanvas, get2d } from './canvas';

const cache = new Map<string, Texture>();
function cached(key: string, build: () => Texture): Texture {
  let tex = cache.get(key);
  if (!tex) {
    tex = build();
    cache.set(key, tex);
  }
  return tex;
}

/** 柔和的圆形光晕（白色，透明度向外衰减），用于光点、火星、光晕精灵 */
export function glowTexture(): Texture {
  return cached('glow', () => {
    const size = 128;
    const canvas = createCanvas(size, size);
    const ctx = get2d(canvas);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvasTexture(canvas);
  });
}

/** 火焰：下宽上尖的火舌形状，内芯亮、边缘透明，带噪声撕裂 */
export function flameTexture(): Texture {
  return cached('flame', () => {
    const w = 128;
    const h = 256;
    const canvas = createCanvas(w, h);
    const ctx = get2d(canvas);
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w - 0.5;
        const v = 1 - y / h; // 0 = 底部，1 = 顶部
        // 火舌宽度随高度收窄
        const width = 0.42 * Math.pow(1 - v, 0.75) * (0.55 + 0.45 * Math.min(1, v * 6));
        const n = fbm(x / 22, y / 30, 5, 3) - 0.5;
        const d = Math.abs(u + n * 0.16 * v) / Math.max(0.001, width);
        const a = Math.max(0, 1 - d * d) * Math.min(1, v * 8) * (0.75 + n * 0.8);
        const p = (y * w + x) * 4;
        img.data[p] = 255;
        img.data[p + 1] = 255;
        img.data[p + 2] = 255;
        img.data[p + 3] = Math.max(0, Math.min(255, a * 255));
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvasTexture(canvas);
  });
}

/** 烟雾/雾气：噪声云团乘以圆形衰减 */
export function smokeTexture(): Texture {
  return cached('smoke', () => {
    const size = 256;
    const canvas = createCanvas(size, size);
    const ctx = get2d(canvas);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x / size - 0.5;
        const dy = y / size - 0.5;
        const falloff = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2);
        const n = fbm(x / 48, y / 48, 21, 5);
        const a = falloff * falloff * Math.max(0, n * 1.6 - 0.3);
        const p = (y * size + x) * 4;
        img.data[p] = 255;
        img.data[p + 1] = 255;
        img.data[p + 2] = 255;
        img.data[p + 3] = Math.max(0, Math.min(255, a * 255));
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvasTexture(canvas);
  });
}

/**
 * 残破旗帜的布面：暗红底色、布纹、污渍、旧金色徽记，下摆撕裂成不规则的破口（透明）。
 */
export function bannerTexture(seed = 1): Texture {
  return cached(`banner:${seed}`, () => {
    const w = 256;
    const h = 512;
    const canvas = createCanvas(w, h);
    const ctx = get2d(canvas);
    const rng = createRng(seed);

    // 底色
    ctx.fillStyle = '#4a0d0b';
    ctx.fillRect(0, 0, w, h);
    // 布纹与污渍（逐像素调制）
    const img = ctx.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const weave = 0.9 + 0.1 * ((x % 3 === 0 ? 1 : 0) + (y % 3 === 0 ? 1 : 0));
        const grime = 0.45 + 0.75 * fbm(x / 60, y / 60, seed + 3, 4);
        const fade = 1 - (y / h) * 0.35; // 越往下越脏越暗
        const k = weave * grime * fade;
        const p = (y * w + x) * 4;
        img.data[p] = Math.min(255, img.data[p]! * k);
        img.data[p + 1] = Math.min(255, img.data[p + 1]! * k);
        img.data[p + 2] = Math.min(255, img.data[p + 2]! * k);
      }
    }
    ctx.putImageData(img, 0, 0);

    // 旧金色边线和徽记
    ctx.strokeStyle = 'rgba(168,130,58,0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, w - 28, h - 60);
    ctx.lineWidth = 5;
    const cx = w / 2;
    const cy = h * 0.36;
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath(); // 倒三角
    ctx.moveTo(cx - 50, cy - 29);
    ctx.lineTo(cx + 50, cy - 29);
    ctx.lineTo(cx, cy + 58);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); // 竖线与横杠
    ctx.moveTo(cx, cy - 86);
    ctx.lineTo(cx, cy + 120);
    ctx.moveTo(cx - 34, cy + 88);
    ctx.lineTo(cx + 34, cy + 88);
    ctx.stroke();

    // 撕裂：在下摆和布面上挖出透明的破口
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,1)';
    let x = 0;
    while (x < w) {
      const tw = 14 + rng.next() * 30;
      const depth = 40 + rng.next() * 150;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x + tw * 0.5 + (rng.next() - 0.5) * 10, h - depth);
      ctx.lineTo(x + tw, h);
      ctx.closePath();
      ctx.fill();
      x += tw * (0.5 + rng.next() * 0.6);
    }
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(
        20 + rng.next() * (w - 40),
        h * 0.3 + rng.next() * h * 0.6,
        3 + rng.next() * 10,
        5 + rng.next() * 18,
        rng.next() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    return canvasTexture(canvas);
  });
}

/**
 * 占位血条：深色边框 + 红色气血条；友方下面多一条蓝色魔法条。
 * 步骤 5 接入战斗后换成可变长度的正式血条。
 */
export function placeholderBarTexture(withMp: boolean): Texture {
  return cached(`bar:${withMp}`, () => {
    const w = 128;
    const h = 32;
    const canvas = createCanvas(w, h);
    const ctx = get2d(canvas);
    const bar = (y: number, height: number, color: string): void => {
      ctx.fillStyle = 'rgba(8,8,10,0.92)';
      ctx.fillRect(0, y, w, height);
      ctx.strokeStyle = 'rgba(150,120,70,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, y + 1, w - 2, height - 2);
      ctx.fillStyle = color;
      ctx.fillRect(4, y + 4, w - 8, height - 8);
    };
    bar(0, withMp ? 18 : 22, '#a81d16');
    if (withMp) bar(19, 13, '#2456b8');
    return canvasTexture(canvas);
  });
}

/** 调试用文字贴图（多行），使用系统衬线字体 */
export function labelTexture(lines: string[], color = '#e8d9b0'): Texture {
  const fontSize = 30;
  const lineH = fontSize + 6;
  const canvas = createCanvas(256, lineH * lines.length + 12);
  const ctx = get2d(canvas);
  ctx.font = `bold ${fontSize}px "Times New Roman", "Songti SC", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.fillStyle = color;
  lines.forEach((line, i) => {
    ctx.strokeText(line, canvas.width / 2, 6 + i * lineH);
    ctx.fillText(line, canvas.width / 2, 6 + i * lineH);
  });
  return canvasTexture(canvas);
}

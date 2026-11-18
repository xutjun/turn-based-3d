// 技能特效用的贴图：粒子图集、光柱、冲击环、符文阵、斩击光弧、光束、锁链、武器拖尾。
// 全部用 Canvas 2D 绘制（白色 + 透明度），颜色由材质决定；不使用任何外部图片。

import { ClampToEdgeWrapping, LinearFilter, RepeatWrapping, type Texture } from 'three';
import { createRng } from '../../core/rng';
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

const TAU = Math.PI * 2;

/** 粒子图集里的格子编号（2×2） */
export const PARTICLE_CELL = {
  glow: 0, // 柔和光点
  spark: 1, // 四芒星火花
  ember: 2, // 实心小亮点（火星）
  smoke: 3, // 松散的烟团
} as const;

/**
 * 粒子图集：2×2 四种粒子形状画在同一张贴图上，一个粒子池只用一次绘制调用。
 * 每格四周留透明边，避免相邻格子串色。
 */
export function particleAtlasTexture(): Texture {
  return cached('particleAtlas', () => {
    const cell = 64;
    const canvas = createCanvas(cell * 2, cell * 2);
    const ctx = get2d(canvas);
    const center = (i: number): [number, number] => [(i % 2) * cell + cell / 2, Math.floor(i / 2) * cell + cell / 2];
    const radial = (i: number, r: number, stops: [number, number][]): void => {
      const [cx, cy] = center(i);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      for (const [at, a] of stops) g.addColorStop(at, `rgba(255,255,255,${a})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
    };

    // 0：柔和光点
    radial(PARTICLE_CELL.glow, 28, [[0, 1], [0.25, 0.6], [0.6, 0.14], [1, 0]]);

    // 1：四芒星火花（两条细长的光芒 + 小光核）
    {
      const [cx, cy] = center(PARTICLE_CELL.spark);
      radial(PARTICLE_CELL.spark, 12, [[0, 1], [0.5, 0.35], [1, 0]]);
      ctx.save();
      ctx.translate(cx, cy);
      for (let k = 0; k < 2; k++) {
        const g = ctx.createLinearGradient(-27, 0, 27, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-27, 0);
        ctx.lineTo(0, -2.6);
        ctx.lineTo(27, 0);
        ctx.lineTo(0, 2.6);
        ctx.closePath();
        ctx.fill();
        ctx.rotate(Math.PI / 2);
      }
      ctx.restore();
    }

    // 2：实心小亮点
    radial(PARTICLE_CELL.ember, 16, [[0, 1], [0.55, 0.9], [0.8, 0.25], [1, 0]]);

    // 3：烟团（几个偏心的柔和圆叠在一起）
    {
      const [cx, cy] = center(PARTICLE_CELL.smoke);
      const rng = createRng(77);
      for (let k = 0; k < 9; k++) {
        const a = rng.next() * TAU;
        const d = rng.next() * 9;
        const r = 9 + rng.next() * 9;
        const x = cx + Math.cos(a) * d;
        const y = cy + Math.sin(a) * d;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.3)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
      }
    }

    const tex = canvasTexture(canvas);
    tex.generateMipmaps = false;
    tex.minFilter = LinearFilter;
    return tex;
  });
}

/**
 * 光柱：贴在圆柱侧面。竖向的明暗条纹，底部最亮、向上渐隐（v = 0 是底部）。
 * 横向可平铺，滚动 offset.y 可以得到向上流动的感觉。
 */
export function pillarTexture(): Texture {
  return cached('fxPillar', () => {
    const w = 128;
    const h = 256;
    const canvas = createCanvas(w, h);
    const ctx = get2d(canvas);
    const rng = createRng(31);
    const img = ctx.createImageData(w, h);
    // 每一列一个亮度，左右首尾相接
    const cols = new Float32Array(w);
    for (let k = 1; k <= 6; k++) {
      const amp = 1 / k;
      const phase = rng.next() * TAU;
      for (let x = 0; x < w; x++) cols[x] = cols[x]! + amp * Math.sin((x / w) * TAU * k * 2 + phase);
    }
    for (let y = 0; y < h; y++) {
      const v = 1 - y / h; // 0 = 底部
      const fade = Math.pow(1 - v, 1.6) * Math.min(1, v * 14 + 0.35);
      for (let x = 0; x < w; x++) {
        const streak = 0.45 + 0.55 * Math.max(0, cols[x]! * 0.5 + 0.5);
        const a = Math.max(0, Math.min(1, fade * streak));
        const p = (y * w + x) * 4;
        img.data[p] = 255;
        img.data[p + 1] = 255;
        img.data[p + 2] = 255;
        img.data[p + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = canvasTexture(canvas);
    tex.wrapS = RepeatWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    return tex;
  });
}

/** 冲击环：一圈柔和的亮环，用于落点光圈、冲击波 */
export function ringTexture(): Texture {
  return cached('fxRing', () => {
    const size = 256;
    const canvas = createCanvas(size, size);
    const ctx = get2d(canvas);
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.88, 'rgba(255,255,255,1)');
    g.addColorStop(0.95, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvasTexture(canvas);
  });
}

/**
 * 符文阵：同心圆环、内接多角星、一圈随机符文和刻度。
 * @param points 多角星的角数（群体法术 6，治疗 / 蓄力用别的角数区分）
 */
export function runeCircleTexture(points = 6, seed = 5): Texture {
  return cached(`fxRune:${points}:${seed}`, () => {
    const size = 512;
    const canvas = createCanvas(size, size);
    const ctx = get2d(canvas);
    const rng = createRng(seed);
    const c = size / 2;
    ctx.translate(c, c);
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;

    // 中心淡淡的光
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-c, -c, size, size);

    const circle = (r: number, width: number): void => {
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    };
    circle(236, 5);
    circle(222, 1.5);
    circle(178, 3);
    circle(96, 2);
    circle(40, 2.5);

    // 多角星：隔一个点连线
    const skip = points % 2 === 0 ? 2 : Math.floor(points / 2);
    ctx.lineWidth = 2.5;
    for (let i = 0; i < points; i++) {
      const a = (i / points) * TAU;
      const b = ((i + skip) / points) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 178, Math.sin(a) * 178);
      ctx.lineTo(Math.cos(b) * 178, Math.sin(b) * 178);
      ctx.stroke();
      // 角上的小圆
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 178, Math.sin(a) * 178, 9, 0, TAU);
      ctx.stroke();
    }

    // 外圈符文：在 3×4 的格点上随机连几条线
    const count = 24;
    ctx.lineWidth = 2.6;
    for (let i = 0; i < count; i++) {
      ctx.save();
      ctx.rotate((i / count) * TAU);
      ctx.translate(0, -200);
      const pt = (): [number, number] => [(Math.floor(rng.next() * 3) - 1) * 7, (Math.floor(rng.next() * 4) - 1.5) * 7];
      ctx.beginPath();
      ctx.moveTo(0, -11);
      ctx.lineTo(0, 11);
      const strokes = 2 + Math.floor(rng.next() * 3);
      for (let s = 0; s < strokes; s++) {
        const [x1, y1] = pt();
        const [x2, y2] = pt();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 内圈刻度
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const r0 = i % 4 === 0 ? 82 : 89;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * 96, Math.sin(a) * 96);
      ctx.stroke();
    }
    return canvasTexture(canvas);
  });
}

/** 斩击光弧：一道月牙形的亮弧，外缘锐利、内侧拖出淡光，两端收尖 */
export function slashTexture(): Texture {
  return cached('fxSlash', () => {
    const size = 256;
    const canvas = createCanvas(size, size);
    const ctx = get2d(canvas);
    const img = ctx.createImageData(size, size);
    // 圆心在画面下方偏外，弧线横跨画面上部
    const cx = size / 2;
    const cy = size * 1.02;
    const radius = size * 0.82;
    const half = 0.62; // 弧线张角的一半（弧度）
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dx, -dy); // 0 = 正上方
        const along = Math.abs(ang) / half;
        let a = 0;
        if (along < 1) {
          const taper = Math.pow(1 - along * along, 0.9); // 两端收尖
          const width = 30 * taper + 1;
          const off = radius - d; // > 0 在弧线内侧
          if (off >= 0) a = Math.exp(-off / width) * taper;
          else a = Math.max(0, 1 + off / 3) * taper; // 外缘锐利
          a += Math.exp(-(off * off) / 18) * taper * 0.9; // 刃线
        }
        const p = (y * size + x) * 4;
        img.data[p] = 255;
        img.data[p + 1] = 255;
        img.data[p + 2] = 255;
        img.data[p + 3] = Math.max(0, Math.min(1, a)) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvasTexture(canvas);
  });
}

/** 光束 / 光箭：沿 u 方向的一道光，宽度方向中间亮、两侧渐隐；u = 1 是头部（最亮） */
export function streakTexture(): Texture {
  return cached('fxStreak', () => {
    const w = 128;
    const h = 32;
    const canvas = createCanvas(w, h);
    const ctx = get2d(canvas);
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = Math.abs(y / (h - 1) - 0.5) * 2;
      const across = Math.pow(Math.max(0, 1 - v), 2.2);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const along = Math.pow(u, 1.5) * Math.min(1, (1 - u) * 14);
        const p = (y * w + x) * 4;
        img.data[p] = 255;
        img.data[p + 1] = 255;
        img.data[p + 2] = 255;
        img.data[p + 3] = Math.min(1, across * along * 1.4) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvasTexture(canvas);
  });
}

/** 闪电：宽度方向中间一条很亮的细线 + 两侧辉光，沿 u 方向均匀 */
export function boltTexture(): Texture {
  return cached('fxBolt', () => {
    const w = 8;
    const h = 64;
    const canvas = createCanvas(w, h);
    const ctx = get2d(canvas);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.46, 'rgba(255,255,255,1)');
    g.addColorStop(0.54, 'rgba(255,255,255,1)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return canvasTexture(canvas);
  });
}

/** 锁链：一节横环、一节竖环交替相扣，沿 u 方向可平铺（一张贴图 = 4 节） */
export function chainTexture(): Texture {
  return cached('fxChain', () => {
    const w = 256;
    const h = 64;
    const canvas = createCanvas(w, h);
    const ctx = get2d(canvas);
    // 贯穿的暗光
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 6;
    const link = w / 4;
    for (let i = -1; i <= 4; i++) {
      const x = i * link + link / 2;
      // 横环（正对镜头）
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(x, h / 2, link * 0.36, h * 0.24, 0, 0, TAU);
      ctx.stroke();
      // 竖环（侧对镜头，看起来是一道短杠）
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(x + link * 0.26, h / 2);
      ctx.lineTo(x + link * 0.74, h / 2);
      ctx.stroke();
    }
    const tex = canvasTexture(canvas);
    tex.wrapS = RepeatWrapping;
    return tex;
  });
}

/** 武器拖尾：u = 0 是最新的一段（最亮），u = 1 是尾巴（消失）；v = 1 一侧是刃尖（更亮） */
export function trailTexture(): Texture {
  return cached('fxTrail', () => {
    const w = 128;
    const h = 32;
    const canvas = createCanvas(w, h);
    const ctx = get2d(canvas);
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = 1 - y / (h - 1); // 1 = 刃尖
      const across = 0.18 + 0.82 * Math.pow(v, 2.5);
      const edge = Math.min(1, (1 - v) * 10 + 0.4) * Math.min(1, v * 6);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const along = Math.pow(1 - u, 1.6);
        const p = (y * w + x) * 4;
        img.data[p] = 255;
        img.data[p + 1] = 255;
        img.data[p + 2] = 255;
        img.data[p + 3] = Math.min(1, across * along * edge) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvasTexture(canvas);
  });
}

/**
 * 暗影池（步骤 17，队员从队长的影子里显形）：中心浓、边缘渐淡、带几道不规则的烟丝，白色 + 透明度（颜色由材质决定）。
 */
export function shadowPoolTexture(): Texture {
  return cached('fxShadowPool', () => {
    const size = 256;
    const canvas = createCanvas(size, size);
    const ctx = get2d(canvas);
    const c = size / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    // 边缘不规则：几团向外伸出的烟丝
    const rand = createRng(17);
    const rng = (): number => rand.next();
    for (let i = 0; i < 14; i++) {
      const a = rng() * TAU;
      const r = c * (0.55 + rng() * 0.3);
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      const blob = ctx.createRadialGradient(x, y, 0, x, y, c * (0.12 + rng() * 0.12));
      blob.addColorStop(0, 'rgba(255,255,255,0.5)');
      blob.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = blob;
      ctx.fillRect(0, 0, size, size);
    }
    return canvasTexture(canvas);
  });
}

/**
 * 地面裂纹（步骤 17，Boss 跺地）：从中心向外分叉的发光裂缝，越往外越细越淡；白色 + 透明度，叠加混合发光。
 */
export function groundCrackTexture(seed = 29): Texture {
  return cached(`fxCrack:${seed}`, () => {
    const size = 512;
    const canvas = createCanvas(size, size);
    const ctx = get2d(canvas);
    const c = size / 2;
    const rand = createRng(seed);
    const rng = (): number => rand.next();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const crack = (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
      let px = x;
      let py = y;
      let a = angle;
      const steps = 6 + Math.floor(rng() * 4);
      const seg = length / steps;
      for (let i = 0; i < steps; i++) {
        a += (rng() - 0.5) * 0.9;
        const nx = px + Math.cos(a) * seg;
        const ny = py + Math.sin(a) * seg;
        const w = width * (1 - i / steps) + 0.6;
        // 外层柔光 + 内层亮芯
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = w * 3.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        if (depth > 0 && rng() < 0.32) crack(nx, ny, a + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6), length * 0.45, w * 0.7, depth - 1);
        px = nx;
        py = ny;
      }
    };
    const arms = 9;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + (rng() - 0.5) * 0.5;
      crack(c + Math.cos(a) * 10, c + Math.sin(a) * 10, a, c * (0.62 + rng() * 0.3), 7, 2);
    }
    // 中心踏出的坑：一团亮光
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.16);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return canvasTexture(canvas);
  });
}

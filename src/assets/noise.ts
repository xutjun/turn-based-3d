// 程序化噪声：可平铺的二维值噪声与分形噪声（fbm）。贴图生成都基于它。

/** 把整数格点坐标和种子散列成 [0, 1) 的数 */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * 二维值噪声，返回 [0, 1)。
 * @param period 平铺周期（格点数）；传入后噪声在 x、y 方向按该周期无缝循环
 */
export function valueNoise(x: number, y: number, seed: number, period = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrap = period > 0 ? (v: number): number => mod(v, period) : (v: number): number => v;
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * 分形噪声：多层值噪声叠加，返回 [0, 1)。
 * @param period 第一层的平铺周期；每层频率翻倍，周期同步翻倍，整体仍然无缝
 */
export function fbm(x: number, y: number, seed: number, octaves = 4, period = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 101, period * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

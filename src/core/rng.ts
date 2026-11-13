// 可注入种子的随机数（mulberry32）。
// 逻辑层所有随机都必须走这里，保证相同种子得到相同战斗过程。

export interface Rng {
  /** 返回 [0, 1) 的均匀随机数 */
  next(): number;
}

/** 用 32 位整数种子创建随机数发生器 */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** [min, max) 的均匀随机数 */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng.next();
}

/** [0, n) 的随机整数 */
export function randInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng.next() * n));
}

/** Fisher–Yates 原地洗牌 */
export function shuffleInPlace<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

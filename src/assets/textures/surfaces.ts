// 表面贴图：石板地面、石材、旧铁、骨头。全部用噪声逐像素生成，可平铺。

import { createRng } from '../../core/rng';
import { clamp01, fbm, lerp, smoothstep, valueNoise } from '../noise';
import { generateTextureSet, type TextureSet } from './canvas';

const cache = new Map<string, TextureSet>();
function cached(key: string, build: () => TextureSet): TextureSet {
  let set = cache.get(key);
  if (!set) {
    set = build();
    cache.set(key, set);
  }
  return set;
}

/**
 * 暗色石板/焦土地面：错缝铺设的不规则石板，带砖缝、裂纹、污渍和烧焦的斑块。
 */
export function groundTextures(seed = 7): TextureSet {
  return cached(`ground:${seed}`, () => {
    const size = 1024;
    const rows = 7;
    const rowH = 1 / rows;
    const rng = createRng(seed);

    // 每一行：随机的水平偏移和石板宽度；记录每块石板的左右边界和随机明暗
    interface Stone {
      left: number;
      right: number;
      tone: number;
      cracked: boolean;
    }
    const rowShift: number[] = [];
    const rowStones: Stone[][] = [];
    for (let r = 0; r < rows; r++) {
      rowShift.push(rng.next());
      const stones: Stone[] = [];
      let x = 0;
      while (x < 1) {
        let w = 0.13 + rng.next() * 0.13;
        if (1 - (x + w) < 0.1) w = 1 - x; // 最后一块补满，避免出现过窄的石板
        stones.push({ left: x, right: x + w, tone: rng.next(), cracked: rng.next() > 0.55 });
        x += w;
      }
      rowStones.push(stones);
    }

    const mortar = 0.0045; // 砖缝半宽（相对贴图边长）
    return generateTextureSet(
      size,
      (u, v, out) => {
        const r = Math.min(rows - 1, Math.floor(v / rowH));
        const lu = (u - rowShift[r]! + 1) % 1; // 行内坐标（带偏移、环绕）
        const stones = rowStones[r]!;
        let stone = stones[stones.length - 1]!;
        for (const s of stones) {
          if (lu < s.right) {
            stone = s;
            break;
          }
        }
        // 到石板边缘的距离，用噪声扰动出不规则的边
        const edgeNoise = (fbm(u * 24, v * 24, seed + 11, 3, 24) - 0.5) * 0.012;
        const dx = Math.min(lu - stone.left, stone.right - lu);
        const dy = Math.min(v - r * rowH, (r + 1) * rowH - v);
        const edge = Math.min(dx, dy) + edgeNoise;
        const inStone = smoothstep(mortar, mortar + 0.004, edge); // 0 = 砖缝，1 = 石板
        const bevel = smoothstep(mortar, mortar + 0.022, edge); // 石板边缘的倒角

        const grain = fbm(u * 40, v * 40, seed + 23, 4, 40); // 细颗粒
        const blotch = fbm(u * 6, v * 6, seed + 37, 4, 6); // 大块污渍
        const scorch = smoothstep(0.52, 0.72, fbm(u * 3, v * 3, seed + 53, 3, 3)); // 烧焦斑块
        const blood = smoothstep(0.68, 0.8, fbm(u * 4, v * 4, seed + 71, 3, 4)); // 暗红污迹

        // 裂纹：噪声等值线附近的细缝，只出现在部分石板上
        let crack = 0;
        if (stone.cracked) {
          const c = Math.abs(fbm(u * 9, v * 9, seed + 89, 4, 9) - 0.5);
          crack = (1 - smoothstep(0.004, 0.014, c)) * inStone;
        }
        // 小坑
        const pit = smoothstep(0.78, 0.9, valueNoise(u * 90, v * 90, seed + 97, 90)) * inStone;

        // 高度：砖缝最低，石板带倒角，裂纹和小坑下陷
        let h = lerp(0.12, 0.5 + stone.tone * 0.18 + (grain - 0.5) * 0.16, inStone);
        h = lerp(0.12, h, 0.35 + 0.65 * bevel);
        h -= crack * 0.3 + pit * 0.1;
        out.height = clamp01(h);

        // 颜色：低饱和灰石，按石板随机明暗，叠加污渍；砖缝近黑
        const tone = (0.085 + stone.tone * 0.075) * (0.7 + 0.6 * grain) * (0.75 + 0.5 * blotch);
        let cr = tone * 1.02;
        let cg = tone * 1.0;
        let cb = tone * 1.06;
        // 烧焦：压暗并略带暖色
        const sc = scorch * 0.7;
        cr = lerp(cr, 0.03, sc);
        cg = lerp(cg, 0.024, sc);
        cb = lerp(cb, 0.022, sc);
        // 暗红污迹
        cr = lerp(cr, 0.16, blood * 0.45);
        cg = lerp(cg, 0.035, blood * 0.45);
        cb = lerp(cb, 0.03, blood * 0.45);
        // 裂纹和砖缝
        const dark = Math.max(1 - inStone, crack * 0.85);
        out.r = lerp(cr, 0.016, dark);
        out.g = lerp(cg, 0.015, dark);
        out.b = lerp(cb, 0.017, dark);

        // 粗糙度：石板略有变化，污迹处稍微光滑（像干掉的血或油）
        out.roughness = clamp01(lerp(0.98, 0.78 + grain * 0.18 - blood * 0.3, inStone));
      },
      5.5,
    );
  });
}

/** 石材（石柱、碎石用）：带裂纹和坑洼的灰色岩石 */
export function stoneTextures(seed = 3): TextureSet {
  return cached(`stone:${seed}`, () =>
    generateTextureSet(
      512,
      (u, v, out) => {
        const base = fbm(u * 5, v * 5, seed, 5, 5);
        const grain = fbm(u * 36, v * 36, seed + 5, 3, 36);
        const c = Math.abs(fbm(u * 7, v * 7, seed + 9, 4, 7) - 0.5);
        const crack = 1 - smoothstep(0.004, 0.02, c);
        const pit = smoothstep(0.74, 0.9, valueNoise(u * 50, v * 50, seed + 13, 50));
        const moss = smoothstep(0.6, 0.78, fbm(u * 4, v * 4, seed + 17, 3, 4));
        out.height = clamp01(0.45 + (base - 0.5) * 0.7 + (grain - 0.5) * 0.12 - crack * 0.35 - pit * 0.12);
        const tone = (0.2 + base * 0.2) * (0.8 + 0.4 * grain) * (1 - crack * 0.75);
        out.r = lerp(tone * 1.0, tone * 0.62, moss * 0.5);
        out.g = lerp(tone * 0.99, tone * 0.72, moss * 0.5);
        out.b = lerp(tone * 1.04, tone * 0.55, moss * 0.5);
        out.roughness = clamp01(0.82 + grain * 0.16);
      },
      4,
    ),
  );
}

/** 旧铁（火盆用）：发黑的铁，带锈斑和划痕 */
export function ironTextures(seed = 5): TextureSet {
  return cached(`iron:${seed}`, () =>
    generateTextureSet(
      256,
      (u, v, out) => {
        const base = fbm(u * 6, v * 6, seed, 4, 6);
        const rust = smoothstep(0.5, 0.72, fbm(u * 9, v * 9, seed + 3, 4, 9));
        const scratch = smoothstep(0.86, 0.95, valueNoise(u * 4, v * 120, seed + 7, 4));
        const tone = 0.1 + base * 0.1;
        out.r = lerp(tone, 0.24, rust * 0.7) + scratch * 0.1;
        out.g = lerp(tone, 0.1, rust * 0.7) + scratch * 0.1;
        out.b = lerp(tone * 1.05, 0.05, rust * 0.7) + scratch * 0.1;
        out.height = clamp01(0.5 + (base - 0.5) * 0.3 + rust * 0.2 - scratch * 0.2);
        out.roughness = clamp01(0.45 + rust * 0.45 + base * 0.15 - scratch * 0.2);
      },
      3,
    ),
  );
}

/** 骨头：发黄发灰的骨质，带细纹 */
export function boneTextures(seed = 9): TextureSet {
  return cached(`bone:${seed}`, () =>
    generateTextureSet(
      256,
      (u, v, out) => {
        const base = fbm(u * 5, v * 5, seed, 4, 5);
        const streak = fbm(u * 3, v * 40, seed + 3, 3, 3);
        const dirt = smoothstep(0.55, 0.8, fbm(u * 7, v * 7, seed + 7, 3, 7));
        const tone = 0.42 + base * 0.2 + (streak - 0.5) * 0.1;
        out.r = lerp(tone, 0.14, dirt * 0.7);
        out.g = lerp(tone * 0.93, 0.11, dirt * 0.7);
        out.b = lerp(tone * 0.76, 0.08, dirt * 0.7);
        out.height = clamp01(0.5 + (streak - 0.5) * 0.4 + (base - 0.5) * 0.3);
        out.roughness = clamp01(0.7 + dirt * 0.25);
      },
      2,
    ),
  );
}

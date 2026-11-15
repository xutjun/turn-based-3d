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

// ---------------------------------------------------------------------------
// 角色用表面贴图。颜色都是接近中性的灰度，由材质的 color 再染色，
// 这样同一张贴图可以做出不同颜色的铁甲、皮革和布料。
// ---------------------------------------------------------------------------

/** 旧铁甲片：划痕、凹坑、锈迹，粗糙度有明显变化 */
export function plateTextures(seed = 21): TextureSet {
  return cached(`plate:${seed}`, () =>
    generateTextureSet(
      512,
      (u, v, out) => {
        const base = fbm(u * 5, v * 5, seed, 4, 5);
        const grime = smoothstep(0.45, 0.75, fbm(u * 8, v * 8, seed + 3, 4, 8));
        // 两个方向的细划痕
        const s1 = smoothstep(0.8, 0.93, valueNoise(u * 6, v * 160, seed + 5, 6));
        const s2 = smoothstep(0.84, 0.95, valueNoise(u * 140 + v * 60, v * 9, seed + 7, 0));
        const scratch = Math.max(s1, s2 * 0.8);
        const dent = smoothstep(0.7, 0.9, valueNoise(u * 14, v * 14, seed + 9, 14));
        const rust = smoothstep(0.62, 0.8, fbm(u * 11, v * 11, seed + 11, 3, 11)) * grime;
        const tone = 0.62 + (base - 0.5) * 0.25 - grime * 0.22 + scratch * 0.22;
        out.r = clamp01(lerp(tone, tone * 0.95 + 0.1, rust));
        out.g = clamp01(lerp(tone, tone * 0.62, rust));
        out.b = clamp01(lerp(tone * 1.03, tone * 0.42, rust));
        out.height = clamp01(0.55 + (base - 0.5) * 0.2 - scratch * 0.3 - dent * 0.25 + rust * 0.1);
        // 划痕处更亮更光滑，污垢和锈迹处更粗糙
        out.roughness = clamp01(0.42 + grime * 0.3 + rust * 0.3 - scratch * 0.2 + (base - 0.5) * 0.2);
      },
      3,
    ),
  );
}

/** 皮革：毛孔颗粒和折痕 */
export function leatherTextures(seed = 31): TextureSet {
  return cached(`leather:${seed}`, () =>
    generateTextureSet(
      512,
      (u, v, out) => {
        const pore = valueNoise(u * 110, v * 110, seed, 110);
        const base = fbm(u * 6, v * 6, seed + 3, 4, 6);
        const c = Math.abs(fbm(u * 10, v * 10, seed + 5, 4, 10) - 0.5);
        const crease = 1 - smoothstep(0.0, 0.035, c);
        const wear = smoothstep(0.55, 0.8, fbm(u * 4, v * 4, seed + 7, 3, 4));
        const tone = 0.6 + (base - 0.5) * 0.3 + (pore - 0.5) * 0.12 - crease * 0.25 + wear * 0.12;
        out.r = clamp01(tone);
        out.g = clamp01(tone * 0.96);
        out.b = clamp01(tone * 0.9);
        out.height = clamp01(0.5 + (pore - 0.5) * 0.3 - crease * 0.4 + (base - 0.5) * 0.2);
        out.roughness = clamp01(0.72 + (pore - 0.5) * 0.15 - wear * 0.2 + crease * 0.1);
      },
      2.5,
    ),
  );
}

/** 粗布/破布：经纬织纹、起球和污渍 */
export function clothTextures(seed = 41): TextureSet {
  return cached(`cloth:${seed}`, () =>
    generateTextureSet(
      512,
      (u, v, out) => {
        const n = 96; // 每张贴图的纱线数
        const warp = 0.5 + 0.5 * Math.sin(u * n * Math.PI * 2);
        const weft = 0.5 + 0.5 * Math.sin(v * n * Math.PI * 2);
        const weave = warp * weft;
        const fuzz = valueNoise(u * 200, v * 200, seed, 200);
        const stain = smoothstep(0.5, 0.78, fbm(u * 5, v * 5, seed + 3, 4, 5));
        const fold = fbm(u * 3, v * 12, seed + 5, 3, 3);
        const tone = 0.74 + (weave - 0.25) * 0.16 + (fuzz - 0.5) * 0.1 - stain * 0.3 + (fold - 0.5) * 0.14;
        out.r = clamp01(tone);
        out.g = clamp01(tone * 0.98);
        out.b = clamp01(tone * 0.95);
        out.height = clamp01(0.4 + weave * 0.35 + (fold - 0.5) * 0.3 + (fuzz - 0.5) * 0.1);
        out.roughness = clamp01(0.9 + (fuzz - 0.5) * 0.1);
      },
      2.2,
    ),
  );
}

/** 锁子甲：错行密排的小铁环，环与环之间是深色的缝隙 */
export function chainmailTextures(seed = 51): TextureSet {
  return cached(`mail:${seed}`, () =>
    generateTextureSet(
      512,
      (u, v, out) => {
        const n = 30; // 每张贴图的环数（偶数行，保证上下平铺）
        const gy = v * n;
        const row = Math.floor(gy);
        const fx = (u * n + (row % 2) * 0.5) % 1;
        const fy = gy - row;
        const d = Math.hypot(fx - 0.5, fy - 0.5);
        const ringShape = 1 - smoothstep(0.05, 0.17, Math.abs(d - 0.33));
        const grime = smoothstep(0.4, 0.75, fbm(u * 6, v * 6, seed + 3, 4, 6));
        const rust = smoothstep(0.62, 0.82, fbm(u * 9, v * 9, seed + 7, 3, 9));
        const tone = (0.2 + 0.62 * ringShape) * (1 - grime * 0.35);
        out.r = clamp01(lerp(tone, tone * 0.9 + 0.08, rust));
        out.g = clamp01(lerp(tone, tone * 0.62, rust));
        out.b = clamp01(lerp(tone * 1.04, tone * 0.45, rust));
        out.height = clamp01(0.2 + 0.7 * ringShape);
        out.roughness = clamp01(0.75 - 0.35 * ringShape + grime * 0.2 + rust * 0.2);
      },
      4,
    ),
  );
}

/** 毛皮：沿 v 方向的毛流，成簇的明暗和少量杂色毛 */
export function furTextures(seed = 61): TextureSet {
  return cached(`fur:${seed}`, () =>
    generateTextureSet(
      512,
      (u, v, out) => {
        const strand = valueNoise(u * 120, v * 10, seed, 0);
        const fine = valueNoise(u * 260, v * 22, seed + 3, 0);
        const clump = fbm(u * 9, v * 5, seed + 5, 3, 0);
        const patch = smoothstep(0.5, 0.8, fbm(u * 4, v * 4, seed + 9, 3, 4));
        const tone = 0.56 + (strand - 0.5) * 0.24 + (fine - 0.5) * 0.14 + (clump - 0.5) * 0.3 - patch * 0.18;
        out.r = clamp01(tone);
        out.g = clamp01(tone * 0.97);
        out.b = clamp01(tone * 0.93);
        out.height = clamp01(0.5 + (strand - 0.5) * 0.7 + (clump - 0.5) * 0.3);
        out.roughness = clamp01(0.82 + (fine - 0.5) * 0.2);
      },
      3,
    ),
  );
}

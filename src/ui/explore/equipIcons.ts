// 装备图标（步骤 22，DESIGN §12.5）：按装备表里的形状和颜色程序化生成 SVG，不使用任何图片文件。
// 每个图标：主体剪影（上亮下暗的线性渐变）+ 镶边 / 次要部件 + 可选的发光部分（高斯模糊光晕）
// + 一层程序噪声做旧（feTurbulence，只叠在主体上）+ 暗色描边。生成一次后按装备 id 缓存（字符串，不进 WebGL）。
// 原 DESIGN 写的是 Canvas 2D 画到 dataURL；改用 SVG：同样程序化、矢量清晰、在测试（没有 canvas）里也能生成。

import type { EquipIconShape, EquipIconSpec } from '../../data/equipment';

/** 0xRRGGBB → #rrggbb，k 为亮度倍率（< 1 变暗，> 1 变亮） */
function hex(color: number, k = 1): string {
  const ch = (shift: number): string => {
    const v = (color >> shift) & 0xff;
    const out = k >= 1 ? v + (255 - v) * (k - 1) : v * k;
    return Math.round(Math.max(0, Math.min(255, out)))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

interface ShapeArt {
  viewBox: string;
  /** 主体（用主色渐变填充、做旧） */
  body: string;
  /** 镶边、次要部件（用次色填充） */
  trim?: string;
  /** 发光部分（用发光色，带光晕） */
  glow?: string;
}

const SHAPES: Record<EquipIconShape, ShapeArt> = {
  // ---------- 头盔 ----------
  helmBarrel: {
    viewBox: '0 0 64 64',
    body: '<path d="M14 26c0-10 8-17 18-17s18 7 18 17v22c0 4-3 7-7 7H21c-4 0-7-3-7-7Z"/>',
    trim: '<path d="M30 6h4l2 7h-8Z"/><rect x="30.5" y="13" width="3" height="40" rx="1"/><rect x="14" y="44" width="36" height="3" rx="1"/>',
    glow: '<rect x="18" y="29" width="28" height="3.2" rx="1.2"/>',
  },
  hoodPointed: {
    viewBox: '0 0 64 64',
    body: '<path d="M32 4c-6 6-17 16-19 30-1 9 2 18 7 22h24c5-4 8-13 7-22C49 22 40 12 32 4Z"/>',
    trim: '<path d="M21 40c3 6 19 6 22 0v10H21Z"/><path d="M44 12c5 1 9 4 11 8-4-1-8-1-10 1Z"/>',
    glow: '<circle cx="27" cy="35" r="1.6"/><circle cx="37" cy="35" r="1.6"/>',
  },
  hoodDeep: {
    viewBox: '0 0 64 64',
    body: '<path d="M32 5C18 5 11 18 11 32c0 10 3 19 7 24h28c4-5 7-14 7-24C53 18 46 5 32 5Z"/>',
    trim: '<path d="M18 56c1-14 5-24 14-27 9 3 13 13 14 27Z" fill-opacity=".55"/><path d="M26 15l6-4 6 4-6 5Z"/>',
    glow: '<circle cx="27" cy="38" r="1.7"/><circle cx="37" cy="38" r="1.7"/>',
  },
  crownMask: {
    viewBox: '0 0 64 64',
    body: '<path d="M32 2l6 14 5-8 3 14c4 3 6 8 6 14v10H12V36c0-6 2-11 6-14l3-14 5 8Z"/>',
    trim: '<path d="M20 30c3-3 21-3 24 0v18c-3 5-8 9-12 10-4-1-9-5-12-10Z"/>',
    glow: '<path d="M24 37h6v2.4h-6Zm10 0h6v2.4h-6Z"/><circle cx="32" cy="22" r="2.2"/>',
  },
  hoodSoft: {
    viewBox: '0 0 64 64',
    body: '<path d="M32 7C19 7 12 18 12 31c0 9 3 18 8 24h24c5-6 8-15 8-24C52 18 45 7 32 7Z"/>',
    trim: '<path d="M16 24c8-6 24-6 32 0l-2 5c-8-5-20-5-28 0Z"/><circle cx="32" cy="22" r="3"/>',
  },
  // ---------- 武器（竖长） ----------
  blade: {
    viewBox: '0 0 64 128',
    body: '<path d="M30 10c10 10 16 30 14 58l-10 4c1-24-2-44-8-58Z"/>',
    trim: '<rect x="20" y="72" width="24" height="5" rx="2"/><rect x="29" y="77" width="6" height="30" rx="2"/><circle cx="32" cy="111" r="4"/>',
    glow: '<path d="M33 14c8 10 12 28 10 52l-3 1c1-22-2-38-7-50Z"/>',
  },
  bow: {
    viewBox: '0 0 64 128',
    body: '<path d="M22 8c22 18 26 38 26 56s-4 38-26 56l-3-3c18-16 22-34 22-53S37 27 19 11Z"/>',
    trim: '<rect x="38" y="56" width="8" height="16" rx="2"/>',
    glow: '<path d="M20 10l1.5 0 0 108-1.5 0Z"/><path d="M14 63h34l-4 2H14Z"/>',
  },
  staff: {
    viewBox: '0 0 64 128',
    body: '<rect x="29" y="30" width="6" height="94" rx="2.5"/>',
    trim: '<path d="M32 8c-9 4-13 12-11 22h22c2-10-2-18-11-22Zm0 7c4 3 6 7 5 12H27c-1-5 1-9 5-12Z"/><rect x="26" y="58" width="12" height="4" rx="1.5"/>',
    glow: '<circle cx="32" cy="22" r="6"/>',
  },
  sword: {
    viewBox: '0 0 64 128',
    body: '<path d="M28 82V18l4-10 4 10v64Z"/>',
    trim: '<rect x="14" y="80" width="36" height="5" rx="2"/><rect x="29" y="85" width="6" height="24" rx="2"/><circle cx="32" cy="113" r="4.5"/>',
    glow: '<rect x="31" y="20" width="2" height="58" rx="1"/><circle cx="32" cy="82.5" r="2.2"/>',
  },
  spear: {
    viewBox: '0 0 64 128',
    body: '<rect x="29.5" y="34" width="5" height="90" rx="2"/>',
    trim: '<path d="M32 4l9 18-9 14-9-14Z"/><rect x="26" y="36" width="12" height="4" rx="1.5"/><path d="M29 40c-6 4-8 10-6 16 3-5 5-8 6-9Z"/>',
    glow: '<path d="M32 9l5 13-5 8-5-8Z"/>',
  },
  // ---------- 铠甲 ----------
  plate: {
    viewBox: '0 0 64 64',
    body: '<path d="M18 10l8-3c2 3 4 4 6 4s4-1 6-4l8 3 10 6-3 12-7-2v28c-5 3-9 4-14 4s-9-1-14-4V26l-7 2-3-12Z"/>',
    trim: '<rect x="30.5" y="13" width="3" height="40" rx="1"/><path d="M22 46h20v10c-6 3-14 3-20 0Z"/>',
  },
  leather: {
    viewBox: '0 0 64 64',
    body: '<path d="M20 9l7-2c1 3 3 5 5 5s4-2 5-5l7 2 9 7-3 11-6-2v29c-5 3-8 4-12 4s-7-1-12-4V25l-6 2-3-11Z"/>',
    trim: '<path d="M38 8l16 9-5 12-9-5c-1 10-2 20-6 30h-4c5-14 7-28 8-46Z"/>',
  },
  robe: {
    viewBox: '0 0 64 64',
    body: '<path d="M22 8l6-2 4 6 4-6 6 2 10 10-4 8-5-3 5 35H16l5-35-5 3-4-8Z"/>',
    trim: '<path d="M29.5 12h5v46h-5Z"/><path d="M16 56h32v4H16Z"/>',
  },
  // ---------- 腰带（横长） ----------
  beltBuckle: {
    viewBox: '0 0 96 48',
    body: '<rect x="4" y="16" width="88" height="16" rx="4"/>',
    trim: '<path d="M38 11h20v26H38Zm5 5v16h10V16Z"/><rect x="70" y="30" width="12" height="12" rx="3"/>',
  },
  beltSash: {
    viewBox: '0 0 96 48',
    body: '<path d="M4 14c30 4 58 4 88 0v18c-30 4-58 4-88 0Z"/>',
    trim: '<path d="M44 18h8l3 26-7-4-7 4Z"/><circle cx="48" cy="22" r="4"/>',
  },
  // ---------- 鞋子 ----------
  bootPlate: {
    viewBox: '0 0 64 64',
    body: '<path d="M20 6h18v30l14 8c3 2 4 5 4 8v4H14V36l2-4V6Z"/>',
    trim: '<rect x="18" y="16" width="22" height="3" rx="1"/><rect x="18" y="26" width="22" height="3" rx="1"/><path d="M14 52h42v5H14Z"/>',
  },
  bootLeather: {
    viewBox: '0 0 64 64',
    body: '<path d="M20 8h16v28l13 7c4 2 6 6 6 10v3H16V38l2-6Z"/>',
    trim: '<path d="M18 8h20l1 7H17Z"/><rect x="19" y="22" width="18" height="2.5" rx="1"/><path d="M16 53h39v4H16Z"/>',
  },
  // ---------- 项链 ----------
  pendant: {
    viewBox: '0 0 64 64',
    body: '<path d="M10 8c2 18 10 28 22 32 12-4 20-14 22-32l-3-1c-2 16-9 25-19 29C22 32 15 23 13 7Z"/>',
    trim: '<path d="M32 38l7 9-7 13-7-13Z"/>',
    glow: '<path d="M32 42l4 5-4 8-4-8Z"/>',
  },
  beads: {
    viewBox: '0 0 64 64',
    body: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      .map((i) => {
        const a = Math.PI * (0.08 + (i / 10) * 0.84);
        return `<circle cx="${(32 - Math.cos(a) * 22).toFixed(1)}" cy="${(8 + Math.sin(a) * 28).toFixed(1)}" r="3.4"/>`;
      })
      .join(''),
    trim: '<path d="M32 38l6 6-6 6-6-6Z"/>',
    glow: '<circle cx="32" cy="55" r="5"/>',
  },
};

const cache = new Map<string, string>();

/**
 * 某件装备的图标 SVG 代码。key 用来区分渐变 / 滤镜的 id（同一页面上多个图标不冲突），同一个 key 只生成一次。
 */
export function equipIconSvg(key: string, spec: EquipIconSpec): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const art = SHAPES[spec.shape];
  const id = `eqi-${key.replace(/[^\w-]/g, '_')}`;
  const glow = spec.glow ?? spec.secondary;
  const svg =
    `<svg viewBox="${art.viewBox}" aria-hidden="true" class="dk-equip-svg">` +
    '<defs>' +
    `<linearGradient id="${id}-b" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${hex(spec.primary, 1.35)}"/><stop offset=".55" stop-color="${hex(spec.primary)}"/><stop offset="1" stop-color="${hex(spec.primary, 0.45)}"/></linearGradient>` +
    `<linearGradient id="${id}-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(spec.secondary, 1.4)}"/><stop offset="1" stop-color="${hex(spec.secondary, 0.6)}"/></linearGradient>` +
    // 做旧：分形噪声 → 只保留暗斑 → 裁到主体形状里
    `<filter id="${id}-w" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${key.length * 7}" result="n"/>` +
    '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.05" result="d"/>' +
    '<feComposite in="d" in2="SourceAlpha" operator="in" result="s"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="s"/></feMerge></filter>' +
    `<filter id="${id}-g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    '</defs>' +
    `<g fill="url(#${id}-b)" stroke="#0a0806" stroke-width="1.4" stroke-linejoin="round" filter="url(#${id}-w)">${art.body}</g>` +
    (art.trim ? `<g fill="url(#${id}-t)" stroke="#0a0806" stroke-width="1" stroke-linejoin="round">${art.trim}</g>` : '') +
    (art.glow ? `<g fill="${hex(glow, 1.25)}" filter="url(#${id}-g)">${art.glow}</g>` : '') +
    '</svg>';
  cache.set(key, svg);
  return svg;
}

/** 测试用：全部形状 */
export const EQUIP_ICON_SHAPES = Object.keys(SHAPES) as EquipIconShape[];

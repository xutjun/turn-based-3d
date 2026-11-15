// 画面配置：相机、光照、雾、后处理、占位体颜色、调试开关。
// 纯数据。调整观感时只改这里。颜色用 0xRRGGBB。

import type { ClassId, Side } from '../core/types';

export const CAMERA_CONFIG = {
  /** 'perspective' = 小 FOV 透视（默认）；'orthographic' = 正交 */
  type: 'perspective' as 'perspective' | 'orthographic',
  fov: 22, // 透视相机的垂直视角（度），越小越接近“伪等距”
  elevationDeg: 30, // 俯角（SPEC 建议 35°~45°，按验收意见压低到 30°，人物更立体）
  azimuthDeg: 0, // 水平方位角：0 = 相机在 +z 一侧（敌方在左上、友方在右下）
  distance: 32.5, // 相机到注视点的距离（越近人物越大；步骤 8 由 35 拉近）
  target: { x: 0, y: 2.3, z: 1.0 }, // 注视点（偏高一些，把画面顶部留给出手顺序条）
  orthoHeight: 13.7, // 正交相机可见的世界高度
  fitAspect: 1.75, // 窗口宽高比小于该值时自动放大可见范围，保证双方阵型都在画面内
  near: 1,
  far: 160,
};

export const LIGHT_CONFIG = {
  // 低饱和冷色环境光
  hemisphere: { sky: 0x5a6c88, ground: 0x0d0c0c, intensity: 1.25 },
  // 冷色“月光”主光，带阴影
  moon: {
    color: 0x7d93b8,
    intensity: 2.8,
    position: { x: -14, y: 26, z: 10 },
    shadowMapSize: 2048,
    shadowArea: 18, // 阴影覆盖范围（以原点为中心的半边长）
  },
  // 火盆暖色点光源
  brazier: {
    color: 0xff7a2e,
    intensity: 72, // 点光源强度（原 115，按验收意见调暗）
    glow: 0.6, // 火焰与光晕精灵的亮度倍率（1 = 最亮）
    distance: 22,
    decay: 1.8,
    height: 2.0,
    flicker: 0.22, // 闪烁幅度（相对强度）
    flickerSpeed: 7, // 闪烁速度
  },
};

/** 程序化环境贴图（给金属材质提供反光），见 assets/environment.ts */
export const ENVIRONMENT_CONFIG = {
  intensity: 0.55, // 环境反光的整体强度
  ambient: 0x06080c, // 四周的底色
  sky: { color: 0x7f97c4, intensity: 1.6 }, // 头顶冷色天光
  fire: { color: 0xff8a3c, intensity: 5 }, // 侧面暖色火光
  back: { color: 0x6f8fd0, intensity: 2.2 }, // 背后冷色轮廓光
};

export const FOG_CONFIG = {
  color: 0x0e131b,
  density: 0.019, // 指数雾密度（步骤 8 由 0.012 加浓：远处的柱子、旗帜更快隐入雾里）
  // 贴地流动的雾片（模拟轻微体积雾；步骤 8 由 26 片 / 不透明度 0.2 加强）
  ground: { count: 40, radius: 24, opacity: 0.3, color: 0x8794a8, size: 14, speed: 0.25 },
};

export const POSTFX_CONFIG = {
  exposure: 1.05, // 色调映射曝光
  bloom: { strength: 0.62, radius: 0.55, threshold: 0.82 },
  // 暗角：offset = 完全变暗的半径（1 = 画面四角），softness = 过渡宽度，darkness = 最暗处压暗比例
  vignette: { offset: 1.15, softness: 0.9, darkness: 0.8 },
  grain: 0.045, // 颗粒强度
  desaturate: 0.18, // 整体降饱和
  tint: { r: 0.96, g: 0.98, b: 1.04 }, // 轻微冷色偏移
};

export const BATTLEFIELD_CONFIG = {
  groundSize: 90, // 地面边长
  groundTextureRepeat: 5,
  seed: 20261113, // 场景物件散布的随机种子
  // 火盆位置（地面坐标）
  braziers: [
    { x: -6.6, z: 6.4 },
    { x: 6.4, z: -6.6 },
    { x: -12.2, z: -5.2 },
    { x: -1.5, z: -12.6 },
    { x: 12.4, z: 3.4 },
  ],
};

/** 占位体（没有登记正式模型的单位使用）的外观 */
export const PLACEHOLDER_CONFIG = {
  classColor: {
    physical: 0x9a3324, // 物理：暗红
    magic: 0x3f5fb8, // 法术：蓝
    seal: 0x7440a6, // 封印：紫
    heal: 0xc9b46a, // 恢复：浅金
  } satisfies Record<ClassId, number>,
  sideColor: {
    ally: 0x4fc3ff, // 友方底座：冷青
    enemy: 0xff3b24, // 敌方底座：暗红
  } satisfies Record<Side, number>,
  heroHeight: 1.8, // 人物占位体高度
  petScale: 0.6, // 宝宝约为人物的 0.6 倍
  eliteScale: 1.12,
  bossScale: 2.0, // Boss 约 2 倍
  hpBarGap: 0.35, // 头顶血条离头顶的距离
};

/** 轮边光：模型轮廓边缘的一圈亮边，增强暗场里的可读性 */
export const RIM_CONFIG = {
  // 步骤 10：亮边收窄、减弱，并加一点“底色提亮”（lift），让各部件自己的配色在暗场里也看得出来，
  // 不再被一整圈同色亮边盖成单色。
  ally: { color: 0x9fc2ff, strength: 0.5, power: 3.0, lift: 0.18 }, // 友方：冷蓝白
  enemy: { color: 0xff5a3a, strength: 0.6, power: 2.4, lift: 0 }, // 敌方：暗红
  weapon: { color: 0x8fb8ff, strength: 0.85, power: 2.2, lift: 0 }, // 友方武器（保持步骤 4 的观感）
} satisfies Record<Side | 'weapon', { color: number; strength: number; power: number; lift: number }>;

/**
 * 低画质模式（右上角“画质”按钮，或地址加 ?quality=low）：给没有独立显卡的机器用。
 * 关闭辉光、降低阴影贴图分辨率、减少粒子和雾片、不按高分屏放大渲染分辨率。
 */
export const QUALITY_CONFIG = {
  storageKey: 'dk-battle-quality', // 记住玩家选择用的本地存储键
  maxPixelRatio: 2, // 高画质下渲染分辨率倍率的上限（高分屏）
  low: {
    bloom: false, // 关闭辉光
    shadowMapSize: 1024, // 阴影贴图分辨率（高画质见 LIGHT_CONFIG.moon.shadowMapSize）
    particleScale: 0.4, // 技能粒子数量的比例
    groundFogRatio: 0.5, // 保留多少比例的贴地雾片
    maxPixelRatio: 1,
  },
};

/** 绘制调用优化（步骤 8）。关掉后回到“每个小几何体画一次”，用来对比外观是否有变化（地址加 ?merge=0） */
export const RENDER_OPTIMIZE = {
  mergeStaticMeshes: true,
  // 阴影专用图层：主光源的阴影只画这个图层上的物体（阴影代理 + 没有代理的投影物体）
  shadowLayer: 1,
};

export const DEBUG_CONFIG = {
  showGrid: false, // 显示网格坐标（按 G 切换，或地址加 ?grid=1）
  showFps: true, // 显示 FPS（按 F 切换，或地址加 ?fps=0 关闭）
};

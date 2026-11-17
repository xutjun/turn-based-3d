// 固定 16:10 画面的比例换算：窗口里放多大的游戏区域、渲染多少像素、鼠标坐标怎么换回界面坐标。
// 纯计算，不依赖 DOM 和 three，可以直接做单元测试。

import { VIEWPORT_CONFIG } from '../../data/uiConfig';

/** 分辨率选项：适应窗口，或某个固定的 16:10 分辨率（“宽x高”） */
export type ResolutionId = 'fit' | `${number}x${number}`;

/** 设置里能选的全部分辨率（适应窗口在最后，是默认值） */
export const RESOLUTION_IDS: readonly ResolutionId[] = [
  ...VIEWPORT_CONFIG.resolutions.map((r): ResolutionId => `${r.width}x${r.height}`),
  'fit',
];

export function isResolutionId(v: unknown): v is ResolutionId {
  return typeof v === 'string' && (RESOLUTION_IDS as readonly string[]).includes(v);
}

export function resolutionLabel(id: ResolutionId): string {
  if (id === 'fit') return '适应窗口';
  const [w, h] = id.split('x');
  return `${w} × ${h}`;
}

/** 固定分辨率的像素尺寸；适应窗口返回 null */
export function resolutionSize(id: ResolutionId): { width: number; height: number } | null {
  if (id === 'fit') return null;
  const [w, h] = id.split('x').map(Number);
  return { width: w!, height: h! };
}

/** 游戏区域在窗口里的摆放，以及渲染分辨率 */
export interface ViewportLayout {
  /** 游戏区域左上角在容器里的位置（CSS 像素） */
  left: number;
  top: number;
  /** 游戏区域显示出来的大小（CSS 像素），宽高比恒为 16:10 */
  width: number;
  height: number;
  /** 界面缩放倍率：显示宽度 / 排版宽度 */
  scale: number;
  /** 画布的实际渲染像素 */
  renderWidth: number;
  renderHeight: number;
}

/** 在 availW × availH 里放下的最大的 aspect 比例矩形 */
export function fitAspect(availW: number, availH: number, aspect = VIEWPORT_CONFIG.aspect): { width: number; height: number } {
  const w = Math.max(1, availW);
  const h = Math.max(1, availH);
  return w / h > aspect ? { width: h * aspect, height: h } : { width: w, height: w / aspect };
}

/**
 * 计算游戏区域的摆放。
 * - 适应窗口：取窗口内最大的 16:10 区域，渲染像素 = 显示大小 × min(设备像素比, 画质上限)。
 * - 固定分辨率：渲染像素就是该分辨率；按 1:1 物理像素显示（显示大小 = 分辨率 / 设备像素比），
 *   窗口放不下时等比缩小到窗口内最大的 16:10 区域。
 * 两种情况都在窗口里居中，多出来的部分是黑边。
 */
export function computeLayout(
  availW: number,
  availH: number,
  resolution: ResolutionId,
  devicePixelRatio = 1,
  maxPixelRatio = 2,
  config = VIEWPORT_CONFIG,
): ViewportLayout {
  const aspect = config.aspect;
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const fit = fitAspect(availW, availH, aspect);
  const fixed = resolutionSize(resolution);
  let width: number;
  let renderWidth: number;
  if (fixed) {
    renderWidth = fixed.width;
    width = Math.min(fit.width, fixed.width / dpr);
  } else {
    width = fit.width;
    renderWidth = Math.max(1, Math.round(width * Math.min(dpr, maxPixelRatio)));
  }
  const height = width / aspect;
  return {
    left: Math.max(0, (Math.max(1, availW) - width) / 2),
    top: Math.max(0, (Math.max(1, availH) - height) / 2),
    width,
    height,
    scale: width / config.design.width,
    renderWidth,
    renderHeight: fixed ? fixed.height : Math.max(1, Math.round(renderWidth / aspect)),
  };
}

/**
 * 鼠标的窗口坐标 → 某个元素内部的排版坐标。
 * rect 是元素在屏幕上实际占的矩形（getBoundingClientRect，已含缩放），local 是元素的排版尺寸（clientWidth / clientHeight）。
 * 元素被整体缩放时（固定 16:10 画面），要按缩放倍率换算回去，射线检测和悬停才准确。
 */
export function clientToLocal(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  localWidth: number,
  localHeight: number,
): { x: number; y: number } {
  const sx = rect.width > 0 ? localWidth / rect.width : 1;
  const sy = rect.height > 0 ? localHeight / rect.height : 1;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

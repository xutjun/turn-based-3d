// 预览视口的矩形换算（步骤 21，DESIGN §12.4）：纯函数，可单元测试。
// 面板里留一个透明的 div 作为“窗口”；每帧读它和画布的窗口矩形（getBoundingClientRect，已含 16:10 舞台的缩放和黑边），
// 换成画布缓冲区像素（含渲染像素比），原点在左下（WebGL 的 viewport / scissor 坐标）。

export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 画布像素里的矩形，原点在左下 */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * @param el      视口元素的窗口矩形
 * @param canvas  画布元素的窗口矩形
 * @param bufferW 画布缓冲区宽（像素）
 * @param bufferH 画布缓冲区高（像素）
 * @returns 与画布相交的部分；完全在画布外或面积为 0 时返回 null
 */
export function previewPixelRect(el: ClientRect, canvas: ClientRect, bufferW: number, bufferH: number): PixelRect | null {
  if (canvas.width <= 0 || canvas.height <= 0 || el.width <= 0 || el.height <= 0) return null;
  const sx = bufferW / canvas.width;
  const sy = bufferH / canvas.height;
  // 先在画布内裁剪（窗口坐标），再换算
  const left = Math.max(el.left, canvas.left);
  const top = Math.max(el.top, canvas.top);
  const right = Math.min(el.left + el.width, canvas.left + canvas.width);
  const bottom = Math.min(el.top + el.height, canvas.top + canvas.height);
  if (right <= left || bottom <= top) return null;
  const x = Math.round((left - canvas.left) * sx);
  const w = Math.round((right - canvas.left) * sx) - x;
  const yTop = Math.round((top - canvas.top) * sy);
  const h = Math.round((bottom - canvas.top) * sy) - yTop;
  if (w <= 0 || h <= 0) return null;
  return { x, y: bufferH - yTop - h, width: w, height: h };
}

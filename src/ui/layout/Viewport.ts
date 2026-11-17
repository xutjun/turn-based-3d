// 固定 16:10 的游戏区域（步骤 12）。
//
// 容器（#app，铺满窗口）里放一块“舞台”元素：它的排版尺寸固定为 VIEWPORT_CONFIG.design（1440 × 900），
// 3D 画布和所有界面覆盖层（顺序条、指令面板、日志、头顶条、飘字、结算、设置、标题界面）都放在舞台里，
// 再用 CSS transform 把整块舞台等比缩放、居中到窗口里——所以界面跟着画面一起缩放，不会跑到黑边上。
// 窗口比例不是 16:10 时，舞台之外露出容器的黑色背景（上下或左右的黑边）。
//
// 鼠标坐标：舞台被缩放了，事件的窗口坐标要用 clientToLocal 换算回排版坐标（见 viewportMath.ts）。

import { VIEWPORT_CONFIG } from '../../data/uiConfig';
import { computeLayout, type ResolutionId, type ViewportLayout } from './viewportMath';

export class Viewport {
  /** 舞台：排版尺寸固定为 design，整体缩放到窗口里 */
  readonly stage: HTMLDivElement;
  private resolution: ResolutionId = 'fit';
  private maxPixelRatio = 2;
  private current: ViewportLayout;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly onChange: (layout: ViewportLayout) => void,
  ) {
    const { width, height } = VIEWPORT_CONFIG.design;
    const c = container.style;
    c.position = 'relative';
    c.overflow = 'hidden';
    c.background = '#000';
    this.stage = document.createElement('div');
    this.stage.className = 'dk-stage';
    const s = this.stage.style;
    s.position = 'absolute';
    s.left = '0';
    s.top = '0';
    s.width = `${width}px`;
    s.height = `${height}px`;
    s.overflow = 'hidden';
    s.transformOrigin = '0 0';
    s.background = '#050607';
    container.appendChild(this.stage);
    this.current = this.compute();
    this.apply();
    this.observer = new ResizeObserver(() => this.update());
    this.observer.observe(container);
    // 设备像素比变化（拖到另一块屏幕、浏览器缩放）不一定触发容器尺寸变化
    addEventListener('resize', this.onWindowResize);
  }

  get layout(): Readonly<ViewportLayout> {
    return this.current;
  }

  get resolutionId(): ResolutionId {
    return this.resolution;
  }

  dispose(): void {
    this.observer.disconnect();
    removeEventListener('resize', this.onWindowResize);
    this.stage.remove();
  }

  setResolution(id: ResolutionId): void {
    this.resolution = id;
    this.update();
  }

  /** 适应窗口时渲染像素比的上限（低画质 1，高画质 2） */
  setMaxPixelRatio(ratio: number): void {
    this.maxPixelRatio = ratio;
    this.update();
  }

  /** 重新计算摆放；有变化时通知（渲染尺寸跟着改） */
  update(): void {
    const next = this.compute();
    const prev = this.current;
    this.current = next;
    this.apply();
    if (
      next.renderWidth !== prev.renderWidth ||
      next.renderHeight !== prev.renderHeight ||
      next.width !== prev.width ||
      next.left !== prev.left ||
      next.top !== prev.top
    ) {
      this.onChange(next);
    }
  }

  private readonly onWindowResize = (): void => this.update();

  private compute(): ViewportLayout {
    return computeLayout(
      this.container.clientWidth,
      this.container.clientHeight,
      this.resolution,
      typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
      this.maxPixelRatio,
    );
  }

  private apply(): void {
    const l = this.current;
    this.stage.style.transform = `translate(${l.left}px,${l.top}px) scale(${l.scale})`;
  }
}

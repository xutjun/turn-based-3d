// 面板里的 3D 预览视口（步骤 21，DESIGN §12.4）：不新增 WebGL 上下文。
//
// 做法：主渲染器画完一帧（含后处理）之后，对每个打开着的视口，在画布上用剪裁区域（scissor）再画一个独立的小场景。
// - 视口是面板里一个透明的 div：每帧读它的窗口矩形换算成画布像素（previewRect.ts），面板移动、舞台缩放都自然跟上。
// - 预览场景是独立的 Scene（不受战场的雾、火盆闪光影响，也不会把战场画进来），自己的灯光，共用主场景的环境贴图。
// - 模型：用同一套 builder 另建一份实例（不挪用战场上的 UnitView），按单位 id 缓存，整个会话复用；
//   播放现有待机动画；发光整体乘 PREVIEW_CONFIG.glowBoost（没有 Bloom 的补偿，只改这份实例自己的材质）。
// - 没有打开的视口时 render() 直接返回：面板关闭后没有任何渲染开销。
// - 直接画到屏幕（不经过后处理）时，渲染器的色调映射和输出色彩空间照常生效，颜色与主画面一致（只是没有辉光）。

import {
  AmbientLight,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Object3D,
  type Texture,
} from 'three';
import { collectTicks, type TickFn } from '../../assets/AssetRegistry';
import { setGlowScale } from '../../assets/materials';
import type { UnitId } from '../../core/types';
import { PREVIEW_CONFIG } from '../../data/uiConfig';
import { IdleAnimator } from '../units/IdleAnimator';
import type { IdleStyleId } from '../../data/idleConfig';
import { seedOf } from '../units/idleMotion';
import { previewPixelRect, type ClientRect, type PixelRect } from './previewRect';

/** 预览要用到的渲染器接口（主渲染器满足它；测试里用假的） */
export interface PreviewRenderer {
  autoClear: boolean;
  readonly domElement: { width: number; height: number; getBoundingClientRect(): ClientRect };
  setRenderTarget(target: null): void;
  setScissorTest(on: boolean): void;
  setScissor(x: number, y: number, w: number, h: number): void;
  setViewport(x: number, y: number, w: number, h: number): void;
  getClearColor(target: Color): Color;
  getClearAlpha(): number;
  setClearColor(color: Color | number, alpha?: number): void;
  clear(color?: boolean, depth?: boolean, stencil?: boolean): void;
  render(scene: Object3D, camera: PerspectiveCamera): void;
}

export interface PanelPreviewDeps {
  /** 建一个单位的预览模型（全新实例） */
  build(id: UnitId): Object3D;
  /** 单位的待机风格（没有则不播待机） */
  idleStyle(id: UnitId): IdleStyleId | undefined;
  /** 共用主场景的程序化环境贴图 */
  environment?: Texture | null;
}

/** 一个缓存的预览模型 */
interface PreviewModel {
  /** 转台：拖拽旋转作用在它上面 */
  turntable: Group;
  model: Object3D;
  idle: IdleAnimator | null;
  ticks: TickFn[];
  height: number;
  baseScale: number;
}

/** 一个打开着的视口 */
export class PreviewView {
  /** 绕竖直轴的朝向（弧度，0 = 正面朝镜头） */
  yaw = 0;
  readonly camera = new PerspectiveCamera(PREVIEW_CONFIG.fov, 1, 0.05, 60);
  private closed = false;

  constructor(
    readonly unitId: UnitId,
    readonly element: { getBoundingClientRect(): ClientRect },
    private readonly onClose: (v: PreviewView) => void,
  ) {}

  get isOpen(): boolean {
    return !this.closed;
  }

  /** 关闭视口（面板关闭时）：之后不再绘制；模型留在缓存里，下次打开不重建 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose(this);
  }
}

export class PanelPreview {
  readonly scene = new Scene();
  private readonly models = new Map<UnitId, PreviewModel>();
  private readonly views = new Set<PreviewView>();
  private time = 0;
  private readonly clearSave = new Color();
  private readonly tmpBox = new Box3();
  private readonly tmpSize = new Vector3();
  /** 最近一次 render() 画了几个视口（自检用） */
  lastRendered = 0;

  constructor(private readonly deps: PanelPreviewDeps) {
    const c = PREVIEW_CONFIG;
    this.scene.name = 'panelPreview';
    if (deps.environment) {
      this.scene.environment = deps.environment;
      this.scene.environmentIntensity = c.environmentIntensity;
    }
    const key = new DirectionalLight(c.keyLight.color, c.keyLight.intensity);
    key.position.set(...c.keyLight.position);
    const rim = new DirectionalLight(c.rimLight.color, c.rimLight.intensity);
    rim.position.set(...c.rimLight.position);
    this.scene.add(key, rim, new AmbientLight(c.ambient.color, c.ambient.intensity));
  }

  /** 打开着的视口数 */
  get activeCount(): number {
    return this.views.size;
  }

  /** 已经建好、缓存着的模型数 */
  get cachedCount(): number {
    return this.models.size;
  }

  /** 某单位的预览模型（没建过返回 undefined；测试用） */
  modelOf(id: UnitId): Object3D | undefined {
    return this.models.get(id)?.model;
  }

  /** 在 element 的位置打开一个显示 id 的视口 */
  open(id: UnitId, element: { getBoundingClientRect(): ClientRect }): PreviewView {
    this.ensureModel(id);
    const view = new PreviewView(id, element, (v) => this.views.delete(v));
    this.views.add(view);
    return view;
  }

  /** 关掉全部视口 */
  closeAll(): void {
    for (const v of [...this.views]) v.close();
  }

  /** 推进待机动画和模型自带的每帧更新（发光呼吸等）；没有视口时什么都不做 */
  update(dt: number): void {
    if (this.views.size === 0) return;
    this.time += dt;
    const shown = new Set([...this.views].map((v) => v.unitId));
    for (const id of shown) {
      const m = this.models.get(id);
      if (!m) continue;
      for (const tick of m.ticks) tick(this.time, dt);
      if (m.idle) {
        const idle = m.idle;
        idle.update(this.time, 1, true);
        idle.addToRig();
        idle.setSecondary(0, 0, 0, 0);
        const k = m.baseScale;
        m.model.position.set(idle.offsets.shift * k, (idle.offsets.bob + idle.offsets.float) * k, 0);
        m.model.rotation.z = idle.offsets.roll;
      }
    }
  }

  /** 在主画面之上画全部视口（主渲染器画完后调用） */
  render(renderer: PreviewRenderer): void {
    this.lastRendered = 0;
    if (this.views.size === 0) return;
    const canvas = renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const rects: { view: PreviewView; rect: PixelRect }[] = [];
    for (const view of this.views) {
      const rect = previewPixelRect(view.element.getBoundingClientRect(), canvasRect, canvas.width, canvas.height);
      if (rect) rects.push({ view, rect });
    }
    if (rects.length === 0) return;

    const autoClear = renderer.autoClear;
    renderer.getClearColor(this.clearSave);
    const clearAlpha = renderer.getClearAlpha();
    renderer.autoClear = false;
    renderer.setRenderTarget(null); // 画到屏幕（后处理最后一遍已经画到屏幕上）
    renderer.setScissorTest(true);
    renderer.setClearColor(PREVIEW_CONFIG.clearColor, 1);
    for (const { view, rect } of rects) {
      const m = this.models.get(view.unitId);
      if (!m) continue;
      // 同一个场景里只显示这个视口的模型
      for (const [id, other] of this.models) other.turntable.visible = id === view.unitId;
      m.turntable.rotation.y = view.yaw;
      this.frame(view.camera, m, rect.width / rect.height);
      renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
      renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
      renderer.clear(true, true, false);
      renderer.render(this.scene, view.camera);
      this.lastRendered += 1;
    }
    // 恢复主画面的设置
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.setClearColor(this.clearSave, clearAlpha);
    renderer.autoClear = autoClear;
  }

  /** 释放全部模型（页面关闭时） */
  dispose(): void {
    this.closeAll();
    for (const m of this.models.values()) m.turntable.removeFromParent();
    this.models.clear();
  }

  /** 相机取景：模型整个身高放进视口，略高处往下看 */
  private frame(camera: PerspectiveCamera, m: PreviewModel, aspect: number): void {
    const c = PREVIEW_CONFIG;
    camera.aspect = aspect;
    const vFov = (c.fov * Math.PI) / 180;
    const h = m.height / c.fill;
    // 竖直方向放下 h；视口偏窄时按水平方向放下（模型宽度按身高的 0.6 估计）
    const fitV = h / 2 / Math.tan(vFov / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const fitH = (m.height * 0.6) / c.fill / 2 / Math.tan(hFov / 2);
    const dist = Math.max(fitV, fitH);
    const cy = m.height * 0.5;
    camera.position.set(0, cy + Math.sin(c.pitch) * dist, Math.cos(c.pitch) * dist);
    camera.lookAt(0, cy, 0);
    camera.updateProjectionMatrix();
  }

  private ensureModel(id: UnitId): PreviewModel {
    const cached = this.models.get(id);
    if (cached) return cached;
    const model = this.deps.build(id);
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0); // 模型默认面朝 +z，相机在 +z：正面朝镜头
    // 没有 Bloom 的补偿：整体提高发光强度（这份实例自己的材质，DESIGN §9.17 M7）
    setGlowScale(model, PREVIEW_CONFIG.glowBoost);
    model.updateMatrixWorld(true);
    const size = this.tmpBox.setFromObject(model).getSize(this.tmpSize);
    const height = Math.max(0.3, size.y);
    const turntable = new Group();
    turntable.name = `previewTurntable:${id}`;
    turntable.add(model);
    // 脚下的暗色圆台
    const r = PREVIEW_CONFIG.stand.radius * Math.max(0.6, height / 1.8);
    const stand = new Mesh(new CircleGeometry(r, 40), new MeshStandardMaterial({ color: PREVIEW_CONFIG.stand.color, roughness: 0.95, metalness: 0.1 }));
    stand.rotation.x = -Math.PI / 2;
    stand.position.y = 0.002;
    turntable.add(stand);
    turntable.visible = false;
    this.scene.add(turntable);
    const style = this.deps.idleStyle(id);
    const entry: PreviewModel = {
      turntable,
      model,
      idle: style ? new IdleAnimator(model, style, seedOf(`preview:${id}`)) : null,
      ticks: collectTicks(model),
      height,
      baseScale: model.scale.y,
    };
    this.models.set(id, entry);
    return entry;
  }
}

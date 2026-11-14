// 战斗场景：渲染器、场景、相机、渲染循环、窗口自适应，以及演出用的时间调度器和舞台。
// 这里不包含战斗逻辑：逻辑事件由 director/BattleDirector 转成演出，界面在 ui/ 里。

import { Color, FogExp2, PCFShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { collectTicks, type TickFn } from '../assets/AssetRegistry';
import { createEnvironmentMap } from '../assets/environment';
import { createDefaultRegistry } from '../assets/registerDefaults';
import { ENEMY_TEMPLATES } from '../data/enemies';
import { ALLY_TEMPLATES } from '../data/heroes';
import { ENVIRONMENT_CONFIG, FOG_CONFIG } from '../data/renderConfig';
import { createBattleCamera, type BattleCamera } from './camera/battleCamera';
import { createDebugOverlay, type DebugOverlay } from './debug/debugOverlay';
import { Scheduler } from './director/Scheduler';
import { SimpleFx } from './fx/simpleFx';
import { createPostFx, type PostFx } from './postfx/composer';
import { createBattlefield } from './scene/battlefield';
import { createFormationView, type FormationView } from './scene/formationView';
import { createGroundFog } from './scene/groundFog';
import { createLighting } from './scene/lighting';
import { SelectionRings } from './scene/selectionRings';
import { BattleStage } from './units/BattleStage';

const MAX_PIXEL_RATIO = 2; // 高分屏上限，避免后处理开销过大
const MAX_FRAME_DT = 0.1; // 切回标签页时限制单帧时间跨度

export class BattleScene {
  readonly scene = new Scene();
  readonly renderer: WebGLRenderer;
  readonly battleCamera: BattleCamera;
  readonly formation: FormationView;
  readonly debug: DebugOverlay;
  /** 演出的统一时间调度：倍速、跳过动画都在这里 */
  readonly scheduler = new Scheduler();
  /** 舞台：单位表现与基础光效 */
  readonly stage: BattleStage;
  /** 目标选择用的地面光圈 */
  readonly rings: SelectionRings;

  private readonly postFx: PostFx;
  private readonly ticks: TickFn[];
  private readonly resizeObserver: ResizeObserver;
  private readonly frameListeners: (() => void)[] = [];
  private readonly projected = new Vector3();
  private width = 1;
  private height = 1;
  private time = 0;
  private lastMs = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    // 背景与雾同色，远处自然隐入黑暗
    this.scene.background = new Color(FOG_CONFIG.color);
    this.scene.fog = new FogExp2(FOG_CONFIG.color, FOG_CONFIG.density);
    // 程序化环境贴图：让金属材质有冷暖反光
    this.scene.environment = createEnvironmentMap(this.renderer);
    this.scene.environmentIntensity = ENVIRONMENT_CONFIG.intensity;

    const registry = createDefaultRegistry();
    const templates = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES];
    this.formation = createFormationView(registry, templates);
    const fx = new SimpleFx(this.scheduler);
    this.stage = new BattleStage(templates, this.formation.units, this.scheduler, fx);
    this.scene.add(
      createLighting(),
      createBattlefield(registry),
      createGroundFog(),
      this.formation.group,
      fx.group,
    );
    this.rings = new SelectionRings(templates);
    this.scene.add(this.rings.group);

    this.debug = createDebugOverlay(container, templates);
    this.scene.add(this.debug.grid);

    this.battleCamera = createBattleCamera();
    this.postFx = createPostFx(this.renderer, this.scene, this.battleCamera.camera);
    this.ticks = collectTicks(this.scene);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** 开始渲染循环 */
  start(): void {
    this.lastMs = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  /** 停止渲染并释放资源 */
  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.debug.dispose();
    this.rings.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private frame(nowMs: number): void {
    const dt = Math.min(MAX_FRAME_DT, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    this.time += dt;
    for (const tick of this.ticks) tick(this.time, dt);
    // 演出：先推进调度器（动画改姿态参数），再把姿态应用到模型，最后通知界面层更新
    this.scheduler.update(dt);
    this.stage.update();
    this.rings.update(this.time);
    for (const fn of this.frameListeners) fn();
    this.postFx.render(this.time);
    this.debug.frame(nowMs);
  }

  /** 注册每帧回调（界面层用它更新头顶条和飘字），在渲染之前调用 */
  onFrame(fn: () => void): void {
    this.frameListeners.push(fn);
  }

  /** 世界坐标 → 容器内的像素坐标；visible 为 false 表示在镜头背后 */
  worldToScreen(world: Vector3): { x: number; y: number; visible: boolean } {
    const p = this.projected.copy(world).project(this.battleCamera.camera);
    return {
      x: (p.x * 0.5 + 0.5) * this.width,
      y: (-p.y * 0.5 + 0.5) * this.height,
      visible: p.z > -1 && p.z < 1,
    };
  }

  /** 窗口自适应：渲染尺寸、相机宽高比、后处理缓冲一起更新 */
  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const pixelRatio = Math.min(MAX_PIXEL_RATIO, devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.battleCamera.resize(width, height);
    this.postFx.setSize(width, height, pixelRatio);
  }
}

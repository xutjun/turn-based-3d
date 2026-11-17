// 战斗场景：渲染器、场景、相机、渲染循环、窗口自适应，以及演出用的时间调度器和舞台。
// 这里不包含战斗逻辑：逻辑事件由 director/BattleDirector 转成演出，界面在 ui/ 里。

import { Color, FogExp2, PCFShadowMap, Scene, Vector3, WebGLRenderer, type DirectionalLight, type Object3D } from 'three';
import { collectTicks, type TickFn } from '../assets/AssetRegistry';
import { SoundEngine } from '../assets/audio/SoundEngine';
import { createEnvironmentMap } from '../assets/environment';
import { createDefaultRegistry } from '../assets/registerDefaults';
import { ENEMY_TEMPLATES } from '../data/enemies';
import { ALLY_TEMPLATES } from '../data/heroes';
import { enableShadowLayer } from '../assets/optimize';
import { ENVIRONMENT_CONFIG, FOG_CONFIG, LIGHT_CONFIG, QUALITY_CONFIG, RENDER_OPTIMIZE } from '../data/renderConfig';
import { createBattleCamera, type BattleCamera } from './camera/battleCamera';
import { createDebugOverlay, type DebugOverlay } from './debug/debugOverlay';
import { Scheduler } from './director/Scheduler';
import { CameraRig } from './camera/CameraRig';
import { FxSystem } from './fx/FxSystem';
import { createPostFx, type PostFx } from './postfx/composer';
import { createBattlefield } from './scene/battlefield';
import { createFormationView, type FormationView } from './scene/formationView';
import { createGroundFog } from './scene/groundFog';
import { createLighting } from './scene/lighting';
import { SelectionRings } from './scene/selectionRings';
import { applySilhouette, silhouetteRequested } from './debug/silhouette';
import { SWAY_GLOBAL } from '../assets/materials';
import { IDLE_CONFIG } from '../data/idleConfig';
import { IDLE_RUNTIME } from './units/IdleAnimator';
import { ATTACK_RUNTIME } from './units/UnitView';
import { ATTACK_ANIM } from '../data/attackAnimConfig';
import { BattleStage } from './units/BattleStage';

const MAX_FRAME_DT = 0.1; // 切回标签页时限制单帧时间跨度

/** 开场用哪种画质：地址参数 ?quality=low / high 优先，其次是上次的选择，默认高画质 */
function initialLowQuality(): boolean {
  const param = new URLSearchParams(location.search).get('quality');
  if (param === 'low') return true;
  if (param === 'high') return false;
  try {
    return localStorage.getItem(QUALITY_CONFIG.storageKey) === 'low';
  } catch {
    return false;
  }
}

/** 性能快照，见 BattleScene.perfSnapshot() */
export interface PerfSnapshot {
  drawCalls: number; // 整帧的绘制调用（含阴影和后处理各遍）
  triangles: number;
  frameMs: number; // 上一帧到这一帧的真实间隔
  updateMs: number; // 逻辑部分（动画、特效、界面更新，不含渲染）的耗时
  geometries: number; // 显存里的几何体数量
  textures: number;
  programs: number; // 着色器程序数量
  objects: Record<string, number>; // 场景各部分当前要画的物体数
  units: Record<string, string>; // 每个单位的明细
}

declare global {
  interface Window {
    __perf?: () => PerfSnapshot;
    /** 调试：所有单位当前的待机状态（权重、呼吸相位、周期倍率 …） */
    __idle?: () => Record<string, { weight: number; breath: number; headYaw: number; roll: number; rate: number; style: string }>;
    __capture?: (time: number) => string;
    /** 调试：所有单位当前的动作状态（阶段、动作名、是否回到站姿、相对原位和原朝向的偏差） */
    __motion?: () => Record<string, { phase: string; move: string | null; atRest: boolean; yawOffset: number; x: number; z: number }>;
  }
}

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
  /** 技能特效（粒子、光柱、拖尾 …） */
  readonly fx: FxSystem;
  /** 演出镜头：推近、跟随、抖动 */
  readonly cameraRig: CameraRig;
  /** 音效：全部用 Web Audio 合成；第一次点击 / 按键后才能出声 */
  readonly sound: SoundEngine;
  /** 最近一帧的真实耗时（秒），性能自检用 */
  lastFrameDt = 0;
  /** 最近一帧里逻辑部分（动画、特效、界面更新，不含渲染）的耗时（毫秒） */
  lastUpdateMs = 0;
  /** 最近一帧的绘制调用数（含后处理各遍） */
  lastDrawCalls = 0;
  /** 最近一帧画的三角形数 */
  lastTriangles = 0;

  private readonly postFx: PostFx;
  private readonly ticks: TickFn[];
  private readonly resizeObserver: ResizeObserver;
  private readonly frameListeners: (() => void)[] = [];
  private readonly projected = new Vector3();
  private low = false;
  /** 画质开关，给界面上的“画质”按钮用 */
  readonly quality = {
    isLow: (): boolean => this.low,
    setLow: (on: boolean): void => this.setLowQuality(on, true),
  };
  private width = 1;
  private height = 1;
  private time = 0;
  private lastMs = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.info.autoReset = false; // 每帧手动清零，这样统计的是整帧（含后处理）的绘制调用
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

    // 调试：地址加 ?merge=0 关闭网格合并，用来对比优化前后的外观和绘制调用
    if (new URLSearchParams(location.search).get('merge') === '0') RENDER_OPTIMIZE.mergeStaticMeshes = false;

    const registry = createDefaultRegistry();
    const templates = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES];
    this.formation = createFormationView(registry, templates);
    this.battleCamera = createBattleCamera();
    this.cameraRig = new CameraRig(this.battleCamera, this.scheduler);
    const fx = new FxSystem(this.scheduler, this.battleCamera.camera);
    this.fx = fx;
    this.sound = new SoundEngine({ rate: () => this.scheduler.timeScale, skip: () => this.scheduler.skip });
    this.stage = new BattleStage(templates, this.formation.units, this.scheduler, fx, this.cameraRig, this.sound);
    this.scene.add(
      createLighting(),
      createBattlefield(registry),
      createGroundFog(),
      this.formation.group,
      fx.group,
    );
    // 其余投射阴影的物体（没有交给阴影代理的）进入阴影图层
    enableShadowLayer(this.scene, RENDER_OPTIMIZE.shadowLayer);
    this.rings = new SelectionRings(templates);
    this.scene.add(this.rings.group);

    this.debug = createDebugOverlay(container, templates);
    this.scene.add(this.debug.grid);

    this.postFx = createPostFx(this.renderer, this.scene, this.battleCamera.camera);
    this.ticks = collectTicks(this.scene);

    this.setLowQuality(initialLowQuality(), false);
    // 调试：地址加 ?silhouette=1 做剪影测试（单位纯黑、背景浅灰、隐藏其余物件）
    if (silhouetteRequested()) {
      applySilhouette(this.scene, this.formation.group);
      this.postFx.setBloom(false);
    }
    window.__perf = () => this.perfSnapshot();
    window.__idle = () => this.stage.idleSnapshot();
    window.__motion = () => this.stage.motionSnapshot();
    window.__capture = (time) => this.captureAt(time);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  /** 开始渲染循环 */
  start(): void {
    this.lastMs = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  /**
   * 调试用：停掉自动渲染循环，改为手动逐帧推进（配合 stepFrame），用来逐帧检查演出。
   * 传 false 恢复自动渲染。
   */
  setManual(on: boolean): void {
    this.lastMs = performance.now();
    this.renderer.setAnimationLoop(on ? null : (now) => this.frame(now));
  }

  /** 调试用：手动推进一帧，dt 为这一帧的时长（秒）；render 为 false 时只推进动画、不画（快进用） */
  stepFrame(dt: number, render = true): void {
    this.frame(this.lastMs + dt * 1000, render);
  }

  /**
   * 调试用（联系表）：只把画面中的一块矩形放大到整个画布来画（坐标为占整幅画面的比例，0~1）；传 null 恢复。
   * 不改变相机位置，只裁剪投影，所以演出镜头的推近、跟随照常叠加。
   */
  setCrop(rect: { x: number; y: number; w: number; h: number } | null): void {
    const camera = this.battleCamera.camera;
    if (!rect) camera.clearViewOffset();
    else camera.setViewOffset(1, 1, rect.x, rect.y, rect.w, rect.h);
  }

  /** 调试用（联系表）：不推进时间，按当前状态重画一帧并返回 PNG（data URL） */
  snapshot(): string {
    this.frame(this.lastMs);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /**
   * 调试用：停掉自动渲染，把场景时间和演出时间都定在 time 秒，画一帧并返回这一帧的 PNG（data URL）。
   * 用来在完全相同的时间点对比两种配置的画面（例如合并网格开 / 关）。
   */
  captureAt(time: number): string {
    this.setManual(true);
    this.time = time;
    this.scheduler.time = time;
    this.frame(this.lastMs); // 间隔为 0：不推进任何动画，只按给定时间摆姿态
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** 停止渲染并释放资源 */
  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.debug.dispose();
    this.rings.dispose();
    this.fx.dispose();
    this.sound.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private frame(nowMs: number, render = true): void {
    this.lastFrameDt = (nowMs - this.lastMs) / 1000;
    const dt = Math.min(MAX_FRAME_DT, this.lastFrameDt);
    this.lastMs = nowMs;
    this.time += dt;
    const updateStart = performance.now();
    for (const tick of this.ticks) tick(this.time, dt);
    // 演出：先推进调度器（动画改姿态参数），再把姿态应用到模型，最后通知界面层更新
    this.scheduler.update(dt);
    SWAY_GLOBAL.uSwayTime.value = this.time;
    this.stage.update(this.time);
    this.fx.update();
    this.cameraRig.update(dt);
    this.rings.update(this.time);
    for (const fn of this.frameListeners) fn();
    this.lastUpdateMs = performance.now() - updateStart;
    if (!render) return;
    this.renderer.info.reset();
    this.postFx.render(this.time);
    this.lastDrawCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;
    this.debug.frame(nowMs);
  }

  /**
   * 切换低画质：关闭辉光、降低阴影贴图分辨率、减少粒子和雾片、不按高分屏放大分辨率。
   * @param remember 是否记住这次选择（下次打开页面沿用）
   */
  setLowQuality(on: boolean, remember: boolean): void {
    this.low = on;
    const low = QUALITY_CONFIG.low;
    this.postFx.setBloom(on ? low.bloom : true);
    // 待机的次要动画（布料飘动、张望和小动作、颤动）在低画质下关闭；呼吸、翅膀、漂浮、发光呼吸保留
    SWAY_GLOBAL.uSwayQuality.value = on && !IDLE_CONFIG.lowQuality.cloth ? 0 : 1;
    IDLE_RUNTIME.cloth = !(on && !IDLE_CONFIG.lowQuality.cloth);
    IDLE_RUNTIME.events = !(on && !IDLE_CONFIG.lowQuality.events);
    IDLE_RUNTIME.tremble = !(on && !IDLE_CONFIG.lowQuality.tremble);
    // 进攻动画的次级运动（披风、链条、尾巴的惯性）在低画质下关闭；主要动作不受影响
    ATTACK_RUNTIME.secondary = !(on && !ATTACK_ANIM.lowQuality.secondary);
    this.fx.particleScale = on ? low.particleScale : 1;
    this.scene.traverse((o) => {
      const light = o as DirectionalLight;
      if (!light.isDirectionalLight || !light.castShadow) return;
      const size = on ? low.shadowMapSize : LIGHT_CONFIG.moon.shadowMapSize;
      if (light.shadow.mapSize.x === size) return;
      light.shadow.mapSize.set(size, size);
      // 换分辨率要丢掉旧的阴影贴图，下一帧会按新尺寸重建
      light.shadow.map?.dispose();
      light.shadow.map = null;
    });
    const fog = this.scene.getObjectByName('groundFog');
    fog?.children.forEach((puff, i) => {
      puff.visible = !on || i < fog.children.length * low.groundFogRatio;
    });
    this.resize();
    if (remember) {
      try {
        localStorage.setItem(QUALITY_CONFIG.storageKey, on ? 'low' : 'high');
      } catch {
        // 无痕模式等情况下不能写本地存储：不影响本次生效
      }
    }
  }

  /**
   * 性能快照（window.__perf() 可在控制台查看）：最近一帧的绘制调用、三角形数、逻辑耗时，
   * 显存里的几何体 / 贴图 / 着色器数量，以及场景里各部分各有多少个要画的物体。
   */
  perfSnapshot(): PerfSnapshot {
    const info = this.renderer.info;
    const objects: Record<string, number> = {};
    for (const child of this.scene.children) {
      let count = 0;
      child.traverseVisible((o) => {
        const r = o as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
        if (r.isMesh || r.isPoints || r.isLine || r.isSprite) count += 1;
      });
      if (count > 0) objects[child.name || child.type] = count;
    }
    // 每个单位的明细：网格 / 精灵 / 粒子各多少个，用了多少种材质
    const units: Record<string, string> = {};
    for (const [id, model] of this.formation.units) {
      let meshes = 0;
      let sprites = 0;
      let points = 0;
      let transparent = 0;
      const materials = new Set<unknown>();
      model.traverseVisible((o) => {
        const r = o as Object3D & { isMesh?: boolean; isPoints?: boolean; isSprite?: boolean; material?: { transparent?: boolean } };
        if (r.isMesh) {
          meshes += 1;
          materials.add(r.material);
          if (r.material?.transparent) transparent += 1;
        } else if (r.isSprite) sprites += 1;
        else if (r.isPoints) points += 1;
      });
      units[id] = `网格 ${meshes}（半透明 ${transparent}，材质 ${materials.size} 种） 精灵 ${sprites} 粒子 ${points}`;
    }
    return {
      units,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      frameMs: this.lastFrameDt * 1000,
      updateMs: this.lastUpdateMs,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      objects,
    };
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
    const cap = this.low ? QUALITY_CONFIG.low.maxPixelRatio : QUALITY_CONFIG.maxPixelRatio;
    const pixelRatio = Math.min(cap, devicePixelRatio || 1);
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.battleCamera.resize(width, height);
    this.postFx.setSize(width, height, pixelRatio);
  }
}

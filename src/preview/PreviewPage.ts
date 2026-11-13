// 模型预览页（地址加 ?preview=1 进入）：逐个查看注册表里的角色、宝宝、敌人和武器。
//
// 操作：鼠标左键拖动旋转，滚轮缩放，右键拖动平移；← / → 切换模型；
//       右侧面板可切换模型、发光强度、自动旋转。
// 地址参数（方便截图和直达某个模型）：
//   model=资源键   glow=发光倍率   spin=0 关闭自动旋转   yaw=初始水平角（度）

import {
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector2,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { collectTicks, type AssetEntry, type AssetRegistry, type TickFn } from '../assets/AssetRegistry';
import { createEnvironmentMap } from '../assets/environment';
import { setGlowScale } from '../assets/materials';
import { getRig } from '../assets/models/characters/rig';
import { createDefaultRegistry } from '../assets/registerDefaults';
import { groundTextures } from '../assets/textures/surfaces';
import { ENVIRONMENT_CONFIG, FOG_CONFIG, LIGHT_CONFIG } from '../data/renderConfig';
import { createPostFx, type PostFx } from '../render/postfx/composer';

const GLOW_LEVELS = [0, 0.5, 1, 2]; // 可切换的发光倍率
const CATEGORY_LABEL: Record<string, string> = {
  hero: '友方人物',
  weapon: '武器',
  pet: '宝宝',
  enemy: '敌人',
};
const SPIN_SPEED = 0.5; // 自动旋转速度（弧度/秒）

export class PreviewPage {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly postFx: PostFx;
  private readonly registry: AssetRegistry = createDefaultRegistry();
  private readonly entries: AssetEntry[];
  private readonly turntable = new Group();
  private readonly panel: HTMLDivElement;
  private readonly info: HTMLDivElement;
  private readonly resizeObserver: ResizeObserver;

  private model: Object3D | null = null;
  private ticks: TickFn[] = [];
  private index = 0;
  private glow = 1;
  private spin = true;
  private time = 0;
  private lastMs = 0;

  constructor(private readonly container: HTMLElement) {
    const query = new URLSearchParams(location.search);
    this.entries = this.registry.list('hero', 'weapon', 'pet', 'enemy');

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    // 与战场一致的暗色氛围：冷色环境光 + 冷色主光 + 一盏暖色“火光”
    this.scene.background = new Color(FOG_CONFIG.color);
    this.scene.fog = new FogExp2(FOG_CONFIG.color, 0.03);
    this.scene.environment = createEnvironmentMap(this.renderer);
    this.scene.environmentIntensity = ENVIRONMENT_CONFIG.intensity;
    const h = LIGHT_CONFIG.hemisphere;
    this.scene.add(new HemisphereLight(h.sky, h.ground, h.intensity * 1.6));
    const key = new DirectionalLight(LIGHT_CONFIG.moon.color, LIGHT_CONFIG.moon.intensity * 1.5);
    key.position.set(-3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -1;
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const fire = new PointLight(LIGHT_CONFIG.brazier.color, 60, 14, LIGHT_CONFIG.brazier.decay);
    fire.position.set(2.6, 1.6, 1.8);
    this.scene.add(fire);

    // 地台
    const tex = groundTextures();
    const floor = new Mesh(
      new CircleGeometry(3.2, 48),
      new MeshStandardMaterial({
        map: tex.map,
        normalMap: tex.normalMap,
        roughnessMap: tex.roughnessMap,
        normalScale: new Vector2(1.6, 1.6),
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor, this.turntable);

    // 相机与轨道控制
    const yaw = (Number(query.get('yaw') ?? 25) * Math.PI) / 180;
    this.camera.position.set(Math.sin(yaw) * 5.6, 2.0, Math.cos(yaw) * 5.6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 14;
    this.controls.maxPolarAngle = Math.PI * 0.52;
    this.controls.update();

    this.postFx = createPostFx(this.renderer, this.scene, this.camera);

    // 面板
    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'position:absolute;right:12px;top:12px;width:230px;max-height:calc(100% - 24px);overflow:auto;' +
      'padding:10px 12px;box-sizing:border-box;font:14px/1.5 "Times New Roman","Songti SC",serif;' +
      'color:#d8c690;background:rgba(10,10,12,0.78);border:1px solid rgba(150,120,70,0.7);';
    this.info = document.createElement('div');
    this.info.style.cssText =
      'position:absolute;left:12px;bottom:12px;padding:6px 10px;white-space:pre;pointer-events:none;' +
      'font:13px/1.5 "Times New Roman","Songti SC",serif;color:#d8c690;' +
      'background:rgba(10,10,12,0.7);border:1px solid rgba(150,120,70,0.6);';
    container.append(this.panel, this.info);

    // 初始状态
    const wanted = query.get('model');
    const found = this.entries.findIndex((e) => e.key === wanted);
    this.index = found >= 0 ? found : 0;
    const glow = Number(query.get('glow'));
    if (query.has('glow') && Number.isFinite(glow)) this.glow = glow;
    this.spin = query.get('spin') !== '0';

    addEventListener('keydown', this.onKey);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.showModel(this.index);
  }

  start(): void {
    this.lastMs = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    removeEventListener('keydown', this.onKey);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.panel.remove();
    this.info.remove();
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowRight') this.showModel(this.index + 1);
    else if (e.key === 'ArrowLeft') this.showModel(this.index - 1);
  };

  /** 切换到第 i 个模型（循环） */
  private showModel(i: number): void {
    const n = this.entries.length;
    if (n === 0) return;
    this.index = ((i % n) + n) % n;
    const entry = this.entries[this.index]!;

    if (this.model) this.turntable.remove(this.model);
    this.model = this.registry.create(entry.key, entry.previewParams ?? {});
    this.turntable.add(this.model);
    this.ticks = collectTicks(this.model);
    setGlowScale(this.model, this.glow);
    this.renderPanel();
    this.renderInfo(entry);
  }

  private setGlow(level: number): void {
    this.glow = level;
    if (this.model) setGlowScale(this.model, level);
    this.renderPanel();
  }

  private renderPanel(): void {
    this.panel.replaceChildren();
    const button = (text: string, active: boolean, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText =
        'display:block;width:100%;margin:3px 0;padding:4px 8px;text-align:left;cursor:pointer;' +
        'font:inherit;color:' +
        (active ? '#1a1408' : '#d8c690') +
        ';background:' +
        (active ? '#c9a85a' : 'rgba(40,36,30,0.9)') +
        ';border:1px solid rgba(150,120,70,0.7);';
      b.onclick = onClick;
      return b;
    };
    const heading = (text: string): HTMLDivElement => {
      const d = document.createElement('div');
      d.textContent = text;
      d.style.cssText = 'margin:8px 0 2px;color:#a8935a;border-bottom:1px solid rgba(150,120,70,0.4);';
      return d;
    };

    const title = document.createElement('div');
    title.textContent = '模型预览';
    title.style.cssText = 'font-size:17px;font-weight:bold;';
    this.panel.append(title);

    let lastCategory = '';
    this.entries.forEach((e, i) => {
      if (e.category !== lastCategory) {
        lastCategory = e.category;
        this.panel.append(heading(CATEGORY_LABEL[e.category] ?? e.category));
      }
      this.panel.append(button(e.label, i === this.index, () => this.showModel(i)));
    });

    this.panel.append(heading('发光强度'));
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;';
    for (const level of GLOW_LEVELS) {
      const b = button(`${level}×`, level === this.glow, () => this.setGlow(level));
      b.style.textAlign = 'center';
      row.append(b);
    }
    this.panel.append(row);

    this.panel.append(heading('其他'));
    this.panel.append(
      button(`自动旋转：${this.spin ? '开' : '关'}`, this.spin, () => {
        this.spin = !this.spin;
        this.renderPanel();
      }),
    );
    const tip = document.createElement('div');
    tip.textContent = '拖动旋转 · 滚轮缩放 · ← → 切换';
    tip.style.cssText = 'margin-top:8px;font-size:12px;color:#8a7a50;';
    this.panel.append(tip);
  }

  private renderInfo(entry: AssetEntry): void {
    let meshes = 0;
    let triangles = 0;
    this.model?.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      meshes += 1;
      const g = m.geometry;
      triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    const rig = this.model ? getRig(this.model) : undefined;
    const lines = [`${entry.label}`, `资源键：${entry.key}`, `网格 ${meshes} 个，三角面 ${Math.round(triangles)}`];
    if (rig && this.model) lines.push(`高度 ${(rig.height * this.model.scale.y).toFixed(2)}，带骨架关节`);
    this.info.textContent = lines.join('\n');
  }

  private frame(nowMs: number): void {
    const dt = Math.min(0.1, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    this.time += dt;
    if (this.spin) this.turntable.rotation.y += dt * SPIN_SPEED;
    for (const tick of this.ticks) tick(this.time, dt);
    this.controls.update();
    this.postFx.render(this.time);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const pixelRatio = Math.min(2, devicePixelRatio || 1);
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.postFx.setSize(width, height, pixelRatio);
  }
}

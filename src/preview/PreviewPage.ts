// 模型预览页（地址加 ?preview=1 进入）：逐个查看注册表里的角色、宝宝、敌人和武器。
//
// 操作：鼠标左键拖动旋转，滚轮缩放，右键拖动平移；← / → 切换模型；
//       右侧面板可切换模型、发光强度、自动旋转。
// 地址参数（方便截图和直达某个模型）：
//   model=资源键   glow=发光倍率   spin=0 关闭自动旋转   yaw=初始水平角（度）
//   weapon=0 人物不持武器   element=fire|thunder|seal|heal 法杖元素   dist=相机距离
//   silhouette=1 剪影测试（模型纯黑、背景浅灰）   idle=0 关闭待机动画（看静止站姿）
//   walk=速度（米/秒）  步骤 14：会走路的人物沿地台上的圆圈行走（与探索模式同一套步态和腿部 IK）；
//                       步骤 15：速度高于 3.2 时是跑步步态（6.4 = 探索中的跑速），圆圈放大到 RUN_RADIUS
//   emote=point|laugh|roar  步骤 16：对话中的说话动作（data/dialogues.ts 的 DIALOGUE_EMOTES），原地站着做，便于调姿态

import {
  Box3,
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
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { collectTicks, type AssetEntry, type AssetRegistry, type TickFn } from '../assets/AssetRegistry';
import { createEnvironmentMap } from '../assets/environment';
import { setGlowScale, SWAY_GLOBAL } from '../assets/materials';
import { getRig } from '../assets/models/characters/rig';
import { getCreatureHeight } from '../assets/models/creatures';
import { equipWeapon, getWeaponGlow, setStaffElement } from '../assets/models/weapons';
import { ASSET_KEYS } from '../data/assetKeys';
import { createDefaultRegistry } from '../assets/registerDefaults';
import { groundTextures } from '../assets/textures/surfaces';
import { ENVIRONMENT_CONFIG, FOG_CONFIG, LIGHT_CONFIG } from '../data/renderConfig';
import { STAFF_ELEMENT_COLORS, type StaffElement } from '../data/weapons';
import { applySilhouette, silhouetteRequested } from '../render/debug/silhouette';
import { createPostFx, type PostFx } from '../render/postfx/composer';
import { IdleAnimator } from '../render/units/IdleAnimator';
import { seedOf } from '../render/units/idleMotion';
import { idleStyleOfAsset, UNIT_MODELS, walksOfAsset } from '../data/unitModels';
import { ALLY_TEMPLATES } from '../data/heroes';
import { ENEMY_TEMPLATES } from '../data/enemies';
import { DIALOGUE_EMOTES, type EmotePose } from '../data/dialogues';
import { enableLegJoints } from '../render/units/animatedJoints';
import { UnitView } from '../render/units/UnitView';
import { Scheduler } from '../render/director/Scheduler';
import type { FxSystem } from '../render/fx/FxSystem';

/** 行走演示可选的速度（米/秒），0 = 不走；最快一档就是探索模式的走速 */
const WALK_SPEEDS = [0, 1.2, 2.2, 3.2, 4.5, 6.4];
const WALK_RADIUS = 1.8; // 行走演示的圆圈半径（地台半径 3.2）
const RUN_RADIUS = 3.0; // 跑步（速度 > 3.2）时圆圈放大，弯不那么急
/** 行走演示不需要特效：尘土、拖尾都不画 */
const NO_FX = { burst: () => Promise.resolve(), startTrail: () => ({ stop: () => undefined }) } as unknown as FxSystem;

declare global {
  interface Window {
    /** 调试（联系表）：预览页逐帧推进与截图 */
    __preview?: {
      manual(on: boolean): void;
      step(dt: number): void;
      walk(): { phase: number; weight: number };
      shot(azimuthDeg: number, dist: number, height?: number): string;
    };
  }
}

const GLOW_LEVELS = [0, 0.5, 1, 2]; // 可切换的发光倍率
const CATEGORY_LABEL: Record<string, string> = {
  hero: '友方人物',
  weapon: '武器',
  pet: '宝宝',
  enemy: '敌人',
};
const SPIN_SPEED = 0.5; // 自动旋转速度（弧度/秒）
const WEAPON_LIFT = 0.25; // 单独预览武器时离地的高度
const STAFF_ELEMENTS = Object.keys(STAFF_ELEMENT_COLORS) as StaffElement[];

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
  private weapon: Object3D | null = null; // 当前画面里的武器（单独预览的，或人物手持的）
  private weaponKey = '';
  private baseDistance = 5.6; // 人物大小的模型的相机距离
  private holdWeapon = true; // 人物是否手持武器
  private element: StaffElement = 'thunder';
  private ticks: TickFn[] = [];
  private idle: IdleAnimator | null = null; // 当前模型的待机动画（武器没有）
  private idleOn = true;
  private index = 0;
  private glow = 1;
  private spin = true;
  private time = 0;
  private lastMs = 0;
  /** 行走演示（步骤 14）：速度（0 = 不走）、绕圈的角度、驱动模型的 UnitView */
  private walkSpeed = 0;
  private walkAngle = 0;
  private walkView: UnitView | null = null;
  private readonly walkScheduler = new Scheduler();
  /** 说话动作演示（步骤 16）：原地站着做这个动作 */
  private emote: EmotePose | null = null;

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
    key.shadow.camera.top = 6;
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
    const dist = Number(query.get('dist')) || 5.6;
    this.baseDistance = dist;
    this.camera.position.set(Math.sin(yaw) * dist, 2.0, Math.cos(yaw) * dist);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 22;
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
    this.idleOn = query.get('idle') !== '0';
    this.holdWeapon = query.get('weapon') !== '0';
    const element = query.get('element') as StaffElement | null;
    if (element && STAFF_ELEMENTS.includes(element)) this.element = element;
    const walk = Number(query.get('walk'));
    const emote = query.get('emote');
    if (emote && emote in DIALOGUE_EMOTES) {
      this.emote = DIALOGUE_EMOTES[emote as keyof typeof DIALOGUE_EMOTES];
      this.spin = false;
    }
    if (query.has('walk') && Number.isFinite(walk) && walk > 0) {
      this.walkSpeed = walk;
      this.spin = false;
    }

    addEventListener('keydown', this.onKey);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.showModel(this.index);
    this.installDebug();
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
    else if (e.key === ' ' && this.weapon) {
      e.preventDefault();
      getWeaponGlow(this.weapon)?.flare();
    }
  };

  /** 切换到第 i 个模型（循环） */
  private showModel(i: number): void {
    const n = this.entries.length;
    if (n === 0) return;
    this.index = ((i % n) + n) % n;
    const entry = this.entries[this.index]!;

    if (this.model) this.turntable.remove(this.model);
    this.model = this.registry.create(entry.key, entry.previewParams ?? {});
    // 会走路的人物：腿部关节登记为动画关节（与战场一致）
    if (walksOfAsset(entry.key)) enableLegJoints(this.model);
    this.turntable.add(this.model);
    this.walkView = null;

    // 找出画面里的武器：单独预览的武器，或人物手持的武器
    this.weapon = null;
    this.weaponKey = '';
    // 相机对准模型中部；比人物高的模型（Boss）按比例拉远
    const bounds = new Box3().setFromObject(this.model);
    let focusY = Math.max(0.5, bounds.max.y / 2);
    const fit = Math.max(1, bounds.max.y / 2.3);
    if (entry.category === 'weapon') {
      this.weapon = this.model;
      this.weaponKey = entry.key;
      // 武器原点在握持点，抬高到整把武器都在地面以上，并让相机对准中部
      this.model.position.y = WEAPON_LIFT - bounds.min.y;
      focusY = WEAPON_LIFT + (bounds.max.y - bounds.min.y) / 2;
    } else if (entry.previewWeapon && this.holdWeapon && this.registry.has(entry.previewWeapon.key)) {
      this.weapon = this.registry.create(entry.previewWeapon.key, entry.previewWeapon.params ?? {});
      this.weaponKey = entry.previewWeapon.key;
      equipWeapon(this.model, this.weapon);
    }
    if (this.weapon && this.weaponKey === ASSET_KEYS.weaponStaff) setStaffElement(this.weapon as Group, this.element);
    this.controls.target.y = focusY;
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), this.baseDistance * fit);
    this.ticks = collectTicks(this.model);
    setGlowScale(this.model, this.glow);
    // 待机动画：与战场里同一套（预览页不合并网格，所以这里看到的就是各关节原本的动作）
    const idleStyle = idleStyleOfAsset(entry.key);
    this.idle = idleStyle ? new IdleAnimator(this.model, idleStyle, seedOf(entry.key)) : null;
    if (this.walkSpeed > 0 || this.emote) this.startWalk(entry);
    // 调试：地址加 ?silhouette=1 做剪影测试
    if (silhouetteRequested()) applySilhouette(this.scene, this.turntable);
    this.renderPanel();
    this.renderInfo(entry);
  }

  /** 切换行走演示的速度（0 = 停下，重新摆回转台中央） */
  private setWalk(speed: number): void {
    const was = this.walkSpeed;
    this.walkSpeed = speed;
    if (speed > 0) this.spin = false;
    // 走 ↔ 跑切换时圆圈半径变了：重新摆回起点，避免位置跳变被当成走了一大步
    if (speed === 0 || was === 0 || speed > 3.2 !== was > 3.2) this.showModel(this.index);
    else this.renderPanel();
  }

  /** 用战场里的 UnitView 驱动当前模型行走（同一套步态、腿部 IK、袍摆跟随） */
  private startWalk(entry: AssetEntry): void {
    const template = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES].find((t) => UNIT_MODELS[t.templateId]?.assetKey === entry.key);
    if (!template || !this.model) return;
    this.walkView = new UnitView(template, this.model, this.walkScheduler, NO_FX);
    if (this.walkSpeed <= 0) {
      // 说话动作演示：站在转台中央、面朝相机
      this.walkView.placeAt(0, 0, 0);
      this.walkView.setGesture(this.emote);
      return;
    }
    const p = this.walkPoint();
    this.walkView.placeAt(p.x, p.z, p.yaw);
  }

  /** 圆圈上当前的位置和行进方向（逆时针看是顺时针走） */
  private walkPoint(): { x: number; z: number; yaw: number } {
    const a = this.walkAngle;
    const r = this.walkRadius;
    return { x: r * Math.sin(a), z: r * Math.cos(a), yaw: Math.atan2(Math.cos(a), -Math.sin(a)) };
  }

  /** 行走演示的圆圈半径：跑步时更大 */
  private get walkRadius(): number {
    return this.walkSpeed > 3.2 ? RUN_RADIUS : WALK_RADIUS;
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

    // 武器相关：出手闪光（测试“出手瞬间强度增强”的接口）、法杖元素、人物是否持武器
    const entry = this.entries[this.index]!;
    if (this.weapon || entry.previewWeapon) this.panel.append(heading('武器'));
    if (this.weapon) {
      const weapon = this.weapon;
      this.panel.append(button('出手闪光（空格）', false, () => getWeaponGlow(weapon)?.flare()));
    }
    if (this.weapon && this.weaponKey === ASSET_KEYS.weaponStaff) {
      const elements = document.createElement('div');
      elements.style.cssText = 'display:flex;gap:4px;';
      for (const e of STAFF_ELEMENTS) {
        const b = button(STAFF_ELEMENT_COLORS[e].name, e === this.element, () => {
          this.element = e;
          if (this.weapon) setStaffElement(this.weapon as Group, e);
          this.renderPanel();
          this.renderInfo(this.entries[this.index]!);
        });
        b.style.textAlign = 'center';
        elements.append(b);
      }
      this.panel.append(elements);
    }
    if (entry.previewWeapon) {
      this.panel.append(
        button(`手持武器：${this.holdWeapon ? '开' : '关'}`, this.holdWeapon, () => {
          this.holdWeapon = !this.holdWeapon;
          this.showModel(this.index);
        }),
      );
    }

    if (walksOfAsset(entry.key)) {
      // 行走演示：沿圆圈走，速度越快步幅越大、步频越高
      this.panel.append(heading('行走 / 跑步（米/秒）'));
      const walkRow = document.createElement('div');
      walkRow.style.cssText = 'display:flex;gap:4px;';
      for (const speed of WALK_SPEEDS) {
        const b = button(speed === 0 ? '停' : String(speed), speed === this.walkSpeed, () => this.setWalk(speed));
        b.style.textAlign = 'center';
        walkRow.append(b);
      }
      this.panel.append(walkRow);
    }

    this.panel.append(heading('其他'));
    this.panel.append(
      button(`自动旋转：${this.spin ? '开' : '关'}`, this.spin, () => {
        this.spin = !this.spin;
        this.renderPanel();
      }),
    );
    if (this.idle) {
      this.panel.append(
        button(`待机动画：${this.idleOn ? '开' : '关'}`, this.idleOn, () => {
          this.idleOn = !this.idleOn;
          this.renderPanel();
        }),
      );
    }
    const tip = document.createElement('div');
    tip.textContent = '拖动旋转 · 滚轮缩放 · ← → 切换 · 空格闪光';
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
    const creatureHeight = this.model ? getCreatureHeight(this.model) : undefined;
    if (creatureHeight !== undefined && this.model) {
      lines.push(`高度 ${(creatureHeight * this.model.scale.y).toFixed(2)}，带关节`);
    }
    const weaponGlow = this.weapon ? getWeaponGlow(this.weapon) : undefined;
    if (weaponGlow) {
      const def = { ...weaponGlow.def, ...weaponGlow.currentColors };
      const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
      lines.push(
        `发光：主色 ${hex(def.color)}  辅色 ${hex(def.accentColor)}  强度 ${def.intensity}`,
        `呼吸 ${def.breathHz} Hz ±${Math.round(def.breathDepth * 100)}%  出手 ×${def.flareBoost}`,
      );
    }
    this.info.textContent = lines.join('\n');
  }

  /**
   * 调试（联系表，scripts/walkSheets.cjs）：停掉自动渲染、逐帧推进、读步态相位、从指定角度对着行走的人物截图。
   */
  private installDebug(): void {
    window.__preview = {
      manual: (on) => {
        this.lastMs = performance.now();
        this.renderer.setAnimationLoop(on ? null : (now) => this.frame(now));
      },
      step: (dt) => this.frame(this.lastMs + dt * 1000, false),
      walk: () => ({ phase: this.walkView?.walkPhase ?? 0, weight: this.walkView?.walkWeight ?? 0 }),
      shot: (azimuthDeg, dist, height = 1.0) => {
        const m = this.model;
        if (!m) return '';
        m.updateMatrixWorld(true);
        const p = m.getWorldPosition(new Vector3());
        // 方位角相对人物的朝向：0 = 正前方，90 = 人物的左手侧
        const a = m.rotation.y + (azimuthDeg * Math.PI) / 180;
        this.camera.position.set(p.x + Math.sin(a) * dist, height + 0.35, p.z + Math.cos(a) * dist);
        this.camera.lookAt(p.x, height, p.z);
        this.postFx.render(this.time);
        return this.renderer.domElement.toDataURL('image/png');
      },
    };
  }

  private frame(nowMs: number, render = true): void {
    const dt = Math.min(0.1, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    this.time += dt;
    if (this.spin) this.turntable.rotation.y += dt * SPIN_SPEED;
    for (const tick of this.ticks) tick(this.time, dt);
    SWAY_GLOBAL.uSwayTime.value = this.time;
    if (this.walkView) {
      // 行走演示：沿圆圈前进，UnitView 按走过的距离迈步（它自带待机动画）
      this.walkScheduler.update(dt);
      if (this.walkSpeed > 0) {
        this.walkAngle += (this.walkSpeed * dt) / this.walkRadius;
        const p = this.walkPoint();
        this.walkView.locomote(p.x, p.z, p.yaw);
      }
      this.walkView.update(this.time, this.time);
    } else if (this.idle && this.model) {
      const idle = this.idle;
      idle.update(this.time, this.idleOn ? 1 : 0, true);
      idle.addToRig();
      const k = this.model.scale.y;
      this.model.position.set(idle.offsets.shift * k, (idle.offsets.bob + idle.offsets.float) * k, 0);
      this.model.rotation.z = idle.offsets.roll;
    }
    if (!render) return;
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

// 武器发光控制器：把一把武器上的全部发光部件（自发光材质、光晕精灵、点光源、粒子、流光贴图）
// 收在一起统一驱动。强度 = 配置的基础强度 × 整体倍率 × 呼吸 × 出手闪光。
//
// 对外接口（单位动画与技能演出使用）：
//   getWeaponGlow(weapon)?.flare()            出手瞬间短暂增强
//   getWeaponGlow(weapon)?.setColor(c, a)     换发光颜色（法杖按施法元素变色）
//   getWeaponGlow(weapon)?.setScale(k)        整体倍率

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
  type Texture,
} from 'three';
import { createRng, type Rng } from '../../../core/rng';
import type { WeaponGlowDef } from '../../../data/weapons';
import { setTick } from '../../AssetRegistry';
import { GLOW_SCALE_HOOK } from '../../materials';
import { glowTexture } from '../../textures/sprites';

/** 用主色还是辅色 */
export type GlowSlot = 'main' | 'accent';

type Vec3 = [number, number, number];

export interface EmissiveOptions {
  slot?: GlowSlot;
  factor?: number; // 相对基础强度的倍率
  map?: Texture; // 自发光贴图（符文、流光）
  additive?: boolean; // 叠加混合（悬浮的符文环等没有实体的部件）
  doubleSide?: boolean;
}

export interface ParticleOptions {
  count: number;
  size: number; // 粒子直径（米）
  slot?: GlowSlot;
  /** rise = 从一条线段上冒出并向上飘散；orbit = 绕一个中心环绕 */
  mode: 'rise' | 'orbit';
  from: Vec3; // rise：发射线段起点；orbit：环绕中心
  to?: Vec3; // rise：发射线段终点
  speed?: number; // rise：上升速度；orbit：角速度
  spread?: number; // rise：横向散开的速度
  life?: number; // rise：寿命（秒）
  radius?: number; // orbit：环绕半径
}

const TAU = Math.PI * 2;
const GLOW_KEY = 'weaponGlow';

export class WeaponGlow {
  private readonly colors: Record<GlowSlot, Color>;
  private readonly emissives: { mat: MeshStandardMaterial; factor: number; slot: GlowSlot }[] = [];
  private readonly tints: { color: Color; factor: number; slot: GlowSlot }[] = [];
  private readonly lights: PointLight[] = [];
  private readonly flows: { tex: Texture; dirX: number; dirY: number }[] = [];
  private readonly updaters: ((time: number, dt: number, level: number) => void)[] = [];
  private readonly rng: Rng;
  private readonly phase: number;
  private scale = 1;
  private flareLevel = 0;

  constructor(
    readonly def: WeaponGlowDef,
    seed = 1,
  ) {
    this.colors = { main: new Color(def.color), accent: new Color(def.accentColor) };
    this.rng = createRng(seed);
    this.phase = this.rng.next() * TAU; // 每把武器的呼吸相位错开
  }

  /** 当前的主色与辅色（setColor 之后会变） */
  get currentColors(): { color: number; accentColor: number } {
    return { color: this.colors.main.getHex(), accentColor: this.colors.accent.getHex() };
  }

  /** 创建一个受控的自发光材质 */
  emissive(opts: EmissiveOptions = {}): MeshStandardMaterial {
    const slot = opts.slot ?? 'main';
    const factor = opts.factor ?? 1;
    const mat = new MeshStandardMaterial({
      color: 0x040404,
      emissive: this.colors[slot].clone(),
      emissiveIntensity: this.def.intensity * factor,
      emissiveMap: opts.map ?? null,
      roughness: 0.5,
      metalness: 0,
      side: opts.doubleSide ? DoubleSide : FrontSide,
    });
    if (opts.additive) {
      mat.color.set(0x000000);
      mat.transparent = true;
      mat.blending = AdditiveBlending;
      mat.depthWrite = false;
    }
    this.emissives.push({ mat, factor, slot });
    return mat;
  }

  /** 让一张自发光贴图持续滚动（贴图要先 clone，避免影响其他武器） */
  flow(tex: Texture, dirX: number, dirY: number): Texture {
    this.flows.push({ tex, dirX, dirY });
    return tex;
  }

  /** 光晕精灵：始终朝向相机的柔和光斑 */
  halo(parent: Object3D, position: Vec3, sizeFactor = 1, slot: GlowSlot = 'main', strengthFactor = 1): Sprite {
    const mat = new SpriteMaterial({
      map: glowTexture(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new Sprite(mat);
    sprite.position.set(...position);
    sprite.scale.setScalar(this.def.haloSize * sizeFactor);
    parent.add(sprite);
    this.tints.push({ color: mat.color, factor: this.def.haloStrength * strengthFactor, slot });
    return sprite;
  }

  /** 点光源：照亮持武器的人和周围地面。配置里强度为 0 时不创建 */
  light(parent: Object3D, position: Vec3): PointLight | null {
    if (this.def.lightIntensity <= 0) return null;
    const light = new PointLight(this.colors.main, this.def.lightIntensity, this.def.lightDistance, 2);
    light.position.set(...position);
    parent.add(light);
    this.lights.push(light);
    return light;
  }

  /** 少量飘散的光点 */
  particles(parent: Object3D, opts: ParticleOptions): Points | null {
    const n = Math.floor(opts.count);
    if (n <= 0) return null;
    const slot = opts.slot ?? 'accent';
    const positions = new Float32Array(n * 3);
    const fades = new Float32Array(n * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    geo.setAttribute('color', new BufferAttribute(fades, 3));
    const mat = new PointsMaterial({
      map: glowTexture(),
      size: opts.size,
      sizeAttenuation: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false; // 粒子位置每帧变化，不做视锥剔除
    parent.add(points);
    this.tints.push({ color: mat.color, factor: 1.4, slot });

    const rng = this.rng;
    const setFade = (i: number, f: number): void => {
      fades[i * 3] = f;
      fades[i * 3 + 1] = f;
      fades[i * 3 + 2] = f;
    };

    if (opts.mode === 'rise') {
      const from = opts.from;
      const to = opts.to ?? opts.from;
      const life = opts.life ?? 1.4;
      const speed = opts.speed ?? 0.25;
      const spread = opts.spread ?? 0.06;
      const vel = new Float32Array(n * 3);
      const age = new Float32Array(n);
      const span = new Float32Array(n);
      const up = new Vector3();
      const quat = new Quaternion();
      const spawn = (i: number): void => {
        const t = rng.next();
        for (let k = 0; k < 3; k++) {
          positions[i * 3 + k] = from[k]! + (to[k]! - from[k]!) * t + (rng.next() - 0.5) * 0.02;
          vel[i * 3 + k] = (rng.next() - 0.5) * 2 * spread;
        }
        age[i] = 0;
        span[i] = life * (0.6 + rng.next() * 0.8);
      };
      for (let i = 0; i < n; i++) {
        spawn(i);
        age[i] = rng.next() * span[i]!; // 初始错开，避免同时出生
      }
      this.updaters.push((_time, dt) => {
        // “向上”取世界坐标的上方，换算到粒子所在的局部坐标系
        points.getWorldQuaternion(quat).invert();
        up.set(0, 1, 0).applyQuaternion(quat);
        for (let i = 0; i < n; i++) {
          age[i] = age[i]! + dt;
          if (age[i]! >= span[i]!) spawn(i);
          const rise = speed * dt;
          positions[i * 3] = positions[i * 3]! + vel[i * 3]! * dt + up.x * rise;
          positions[i * 3 + 1] = positions[i * 3 + 1]! + vel[i * 3 + 1]! * dt + up.y * rise;
          positions[i * 3 + 2] = positions[i * 3 + 2]! + vel[i * 3 + 2]! * dt + up.z * rise;
          setFade(i, Math.sin((Math.PI * age[i]!) / span[i]!));
        }
        geo.getAttribute('position').needsUpdate = true;
        geo.getAttribute('color').needsUpdate = true;
      });
    } else {
      const center = opts.from;
      const radius = opts.radius ?? 0.2;
      const speed = opts.speed ?? 1.2;
      const orbit = Array.from({ length: n }, () => ({
        r: radius * (0.7 + rng.next() * 0.6),
        angle: rng.next() * TAU,
        w: speed * (0.6 + rng.next() * 0.8) * (rng.next() < 0.5 ? -1 : 1),
        tilt: (rng.next() - 0.5) * 1.6, // 轨道倾角
        twinkle: rng.next() * TAU,
      }));
      this.updaters.push((time, dt) => {
        for (let i = 0; i < n; i++) {
          const o = orbit[i]!;
          o.angle += o.w * dt;
          const x = Math.cos(o.angle) * o.r;
          const z = Math.sin(o.angle) * o.r;
          positions[i * 3] = center[0] + x;
          positions[i * 3 + 1] = center[1] + z * Math.sin(o.tilt);
          positions[i * 3 + 2] = center[2] + z * Math.cos(o.tilt);
          setFade(i, 0.55 + 0.45 * Math.sin(time * 3 + o.twinkle));
        }
        geo.getAttribute('position').needsUpdate = true;
        geo.getAttribute('color').needsUpdate = true;
      });
    }
    return points;
  }

  /** 注册一个每帧回调（宝珠浮动、符文环旋转等），level 为当前发光强度倍率 */
  onUpdate(fn: (time: number, dt: number, level: number) => void): void {
    this.updaters.push(fn);
  }

  /** 整体倍率：1 = 配置的基础强度，0 = 熄灭 */
  setScale(scale: number): void {
    this.scale = Math.max(0, scale);
  }

  /**
   * 出手瞬间增强：强度立刻升到 flareBoost 倍，然后按 flareDecay 衰减回常态。
   * @param strength 0~1，本次闪光的力度（1 = 配置的满倍率）
   */
  flare(strength = 1): void {
    this.flareLevel = Math.max(this.flareLevel, strength);
  }

  /** 换发光颜色（法杖按施法元素变色）；不传辅色时辅色不变 */
  setColor(color: number, accentColor?: number): void {
    this.colors.main.set(color);
    if (accentColor !== undefined) this.colors.accent.set(accentColor);
    for (const e of this.emissives) e.mat.emissive.copy(this.colors[e.slot]);
    for (const l of this.lights) l.color.copy(this.colors.main);
  }

  /** 每帧更新，由场景的渲染循环通过 tick 调用 */
  update(time: number, dt: number): void {
    const d = this.def;
    this.flareLevel *= Math.exp(-dt / Math.max(0.01, d.flareDecay));
    const breath = 1 + d.breathDepth * Math.sin(time * d.breathHz * TAU + this.phase);
    const level = this.scale * breath * (1 + (d.flareBoost - 1) * this.flareLevel);

    for (const e of this.emissives) e.mat.emissiveIntensity = d.intensity * e.factor * level;
    for (const t of this.tints) t.color.copy(this.colors[t.slot]).multiplyScalar(t.factor * level);
    for (const l of this.lights) l.intensity = d.lightIntensity * level;
    for (const f of this.flows) {
      f.tex.offset.x = (f.tex.offset.x + f.dirX * d.flowSpeed * dt) % 1;
      f.tex.offset.y = (f.tex.offset.y + f.dirY * d.flowSpeed * dt) % 1;
    }
    for (const u of this.updaters) u(time, dt, level);
  }
}

/** 握持方式：用哪只手，以及武器相对手部挂点的旋转（弧度） */
export interface WeaponHold {
  hand: 'right' | 'left';
  rotation: Vec3;
}

const HOLD_KEY = 'weaponHold';

/**
 * 武器 builder 的收尾：把发光控制器和握持方式记到根节点上，并接上每帧更新与发光倍率回调。
 * 约定：武器原点在握持点，+y 指向武器尖端，刃口朝 +z。
 */
export function finishWeapon<T extends Object3D>(root: T, name: string, glow: WeaponGlow, hold: WeaponHold): T {
  root.name = name;
  root.userData[GLOW_KEY] = glow;
  root.userData[HOLD_KEY] = hold;
  root.userData[GLOW_SCALE_HOOK] = (scale: number): void => glow.setScale(scale);
  setTick(root, (time, dt) => glow.update(time, dt));
  glow.update(0, 0);
  return root;
}

/** 取武器的发光控制器；不是武器时返回 undefined */
export function getWeaponGlow(weapon: Object3D): WeaponGlow | undefined {
  return weapon.userData[GLOW_KEY] as WeaponGlow | undefined;
}

export function getWeaponHold(weapon: Object3D): WeaponHold | undefined {
  return weapon.userData[HOLD_KEY] as WeaponHold | undefined;
}

/** 发光部件用的网格：不投射也不接收阴影 */
export function glowMesh(geometry: BufferGeometry, material: MeshStandardMaterial, parent: Object3D): Mesh {
  const m = new Mesh(geometry, material);
  parent.add(m);
  return m;
}

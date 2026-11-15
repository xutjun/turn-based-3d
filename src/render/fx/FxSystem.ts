// 技能特效系统：粒子、发光精灵、光柱、地面符文阵、斩击光弧、闪电、锁链、光箭、武器拖尾。
//
// - 全部用程序化贴图和简单几何体，不使用外部素材。
// - 对象池：精灵、网格都从池里取、用完放回（只切换 visible），粒子在定长数组里循环使用；
//   演出过程中不创建也不销毁显卡资源，避免卡顿和垃圾回收抖动。
// - 所有特效都是“一个 Scheduler.tween”：倍速、顿帧、慢镜头、跳过动画自动生效；
//   跳过动画或再战一次时 tween 立即结束，特效随即归还到池里，不会残留。

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
  type Object3D,
  type Texture,
} from 'three';
import {
  boltTexture,
  chainTexture,
  PARTICLE_CELL,
  particleAtlasTexture,
  pillarTexture,
  ringTexture,
  runeCircleTexture,
  slashTexture,
  streakTexture,
  trailTexture,
} from '../../assets/textures/fxTextures';
import { glowTexture } from '../../assets/textures/sprites';
import { FX_CONFIG } from '../../data/presentationConfig';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { AuraKind, BurstKind, Point3, ProjectileKind } from '../director/types';
import { ParticlePool } from './particles';

type FxMesh = Mesh<BufferGeometry, MeshBasicMaterial>;
type FxSprite = Sprite;

/** 武器拖尾的取样函数：每帧写入拖尾两端（握持端、刃尖端）的世界坐标 */
export type TrailSource = (base: Vector3, tip: Vector3) => void;

export interface TrailHandle {
  /** 停止取样；已有的拖尾自然消散 */
  stop(): void;
}

const TAU = Math.PI * 2;
const BOLT_SEGMENTS = 12;
const GROUND_Y = 0.07; // 地面贴花离地高度（高于选择光圈）
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
/** 各类特效的整体亮度（配合 Bloom 调：太高会整屏泛白） */
const BRIGHTNESS = { sprite: 0.5, pillar: 0.65, decal: 0.8 };

/** 简单对象池：取出时显示，归还时隐藏；对象一直留在场景里 */
class Pool<T extends Object3D> {
  private readonly free: T[] = [];
  private readonly used = new Set<T>();

  constructor(
    private readonly parent: Object3D,
    private readonly make: () => T,
  ) {}

  acquire(): T {
    let o = this.free.pop();
    if (!o) {
      o = this.make();
      this.parent.add(o);
    }
    o.visible = true;
    this.used.add(o);
    return o;
  }

  /** 归还；重复归还（例如已被 releaseAll 收回）不做任何事 */
  release(o: T): void {
    if (!this.used.delete(o)) return;
    o.visible = false;
    this.free.push(o);
  }

  releaseAll(): void {
    for (const o of this.used) {
      o.visible = false;
      this.free.push(o);
    }
    this.used.clear();
  }

  get active(): number {
    return this.used.size;
  }

  get size(): number {
    return this.used.size + this.free.length;
  }
}

function fxMaterial(map: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
}

/** 锁链环带用的贴图：绕一圈重复若干节 */
let bandTexture: Texture | null = null;
function chainBandTexture(): Texture {
  if (!bandTexture) {
    bandTexture = chainTexture().clone();
    bandTexture.repeat.set(3, 1);
    bandTexture.needsUpdate = true;
  }
  return bandTexture;
}

let unitCylinder: CylinderGeometry | null = null;
/** 半径 1、高 1、底面在 y = 0 的开口圆柱（光柱、锁链环带共用） */
function unitCylinderGeometry(): CylinderGeometry {
  if (!unitCylinder) {
    unitCylinder = new CylinderGeometry(1, 1, 1, 24, 1, true);
    unitCylinder.translate(0, 0.5, 0);
  }
  return unitCylinder;
}

/**
 * 一圈发光锁链（半径 1、高 1，用 scale 调整大小）。
 * 被封印的单位身上常驻的锁链用它；不走对象池，由使用方自己管理显示与隐藏。
 */
export function createChainBand(color: number, brightness = 1): FxMesh {
  const mat = fxMaterial(chainBandTexture());
  mat.color.setHex(color).multiplyScalar(brightness);
  const mesh = new Mesh<BufferGeometry, MeshBasicMaterial>(unitCylinderGeometry(), mat);
  mesh.renderOrder = 4;
  return mesh;
}

interface Trail {
  mesh: FxMesh;
  source: TrailSource | null; // null = 已停止取样，等尾巴消散
  base: Float32Array;
  tip: Float32Array;
  age: Float32Array;
  count: number;
}

export class FxSystem {
  /** 粒子数量的比例（低画质模式下调小）：1 = 配置的数量 */
  particleScale = 1;
  readonly group = new Group();
  readonly particles: ParticlePool;

  private readonly sprites: Pool<FxSprite>;
  private readonly pillars: Pool<FxMesh>;
  private readonly decals: Pool<FxMesh>;
  private readonly beams: Pool<FxMesh>;
  private readonly chains: Pool<FxMesh>;
  private readonly bands: Pool<FxMesh>;
  private readonly bolts: Pool<FxMesh>;
  private readonly trailMeshes: Pool<FxMesh>;
  private readonly pools: Pool<Object3D>[];
  private readonly trails: Trail[] = [];
  private readonly lights: PointLight[] = [];
  private prewarm: (() => void) | null = null;
  private prewarmFrames = 3;

  // 复用的临时对象
  private readonly c = new Color();
  private readonly v1 = new Vector3();
  private readonly v2 = new Vector3();
  private readonly v3 = new Vector3();
  private readonly v4 = new Vector3();
  private readonly m4 = new Matrix4();

  constructor(
    private readonly scheduler: Scheduler,
    private readonly camera: Camera,
  ) {
    const g = this.group;
    g.name = 'fx';
    this.particles = new ParticlePool(FX_CONFIG.maxParticles, particleAtlasTexture());
    g.add(this.particles.points);

    this.sprites = new Pool(g, () => {
      const s = new Sprite(
        new SpriteMaterial({ map: glowTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }),
      ) as FxSprite;
      s.renderOrder = 4;
      return s;
    });
    this.pillars = new Pool(g, () => {
      const m = new Mesh<BufferGeometry, MeshBasicMaterial>(unitCylinderGeometry(), fxMaterial(pillarTexture()));
      m.renderOrder = 4;
      return m;
    });
    const flat = new PlaneGeometry(2, 2);
    flat.rotateX(-Math.PI / 2);
    this.decals = new Pool(g, () => {
      const m = new Mesh<BufferGeometry, MeshBasicMaterial>(flat, fxMaterial(ringTexture()));
      m.renderOrder = 3;
      return m;
    });
    // 光束 / 锁链：沿 +x 方向长 1 的平面，用 scale.x 拉到需要的长度
    const strip = new PlaneGeometry(1, 1);
    strip.translate(0.5, 0, 0);
    this.beams = new Pool(g, () => {
      const m = new Mesh<BufferGeometry, MeshBasicMaterial>(strip, fxMaterial(streakTexture()));
      m.renderOrder = 4;
      return m;
    });
    this.chains = new Pool(g, () => {
      // 每条锁链自己一份贴图（共用同一张画布），这样可以各自设置重复次数
      const tex = chainTexture().clone();
      tex.needsUpdate = true;
      const m = new Mesh<BufferGeometry, MeshBasicMaterial>(strip, fxMaterial(tex));
      m.renderOrder = 4;
      return m;
    });
    this.bands = new Pool(g, () => createChainBand(0xffffff));
    this.bolts = new Pool(g, () => {
      const m = new Mesh<BufferGeometry, MeshBasicMaterial>(stripGeometry(BOLT_SEGMENTS), fxMaterial(boltTexture()));
      m.frustumCulled = false;
      m.renderOrder = 4;
      return m;
    });
    this.trailMeshes = new Pool(g, () => {
      const m = new Mesh<BufferGeometry, MeshBasicMaterial>(stripGeometry(FX_CONFIG.trailSamples - 1), fxMaterial(trailTexture()));
      m.frustumCulled = false;
      m.renderOrder = 4;
      return m;
    });
    this.pools = [this.sprites, this.pillars, this.decals, this.beams, this.chains, this.bands, this.bolts, this.trailMeshes];

    // 闪光用的点光源：始终留在场景里（强度为 0），避免中途增减光源导致所有材质重新编译
    for (let i = 0; i < 2; i++) {
      const light = new PointLight(0xffffff, 0, 10, 2);
      light.name = 'fxLight';
      g.add(light);
      this.lights.push(light);
    }

    this.startPrewarm();
  }

  // ------------------------------------------------------------------
  // 每帧 / 收尾
  // ------------------------------------------------------------------

  /** 每帧调用（在单位姿态更新之后）：推进粒子、拖尾、闪光 */
  update(): void {
    const dt = this.scheduler.delta;
    if (this.prewarm && --this.prewarmFrames <= 0) {
      this.prewarm();
      this.prewarm = null;
    }
    if (this.scheduler.skip) {
      // 跳过动画：不留任何粒子、拖尾和闪光
      if (this.particles.count > 0) this.particles.clear();
      for (const t of this.trails) this.trailMeshes.release(t.mesh);
      this.trails.length = 0;
      for (const l of this.lights) l.intensity = 0;
    }
    this.particles.update(dt);
    this.updateTrails(dt);
    const decay = Math.exp(-dt * 9);
    for (const l of this.lights) l.intensity = l.intensity < 0.05 ? 0 : l.intensity * decay;
  }

  /** 立即清掉场上所有特效（再战一次、重置演示时调用；调用前应先 scheduler.flush()） */
  clear(): void {
    this.prewarm = null;
    for (const p of this.pools) p.releaseAll();
    this.trails.length = 0;
    this.particles.clear();
    for (const l of this.lights) l.intensity = 0;
  }

  /** 当前还在场上的特效数量（验收“跳过动画后无残留”用） */
  activeCount(): { objects: number; particles: number; trails: number } {
    let objects = 0;
    for (const p of this.pools) objects += p.active;
    return { objects, particles: this.particles.count, trails: this.trails.length };
  }

  /** 对象池里一共创建过多少个对象（验收“对象被复用、不会越建越多”用） */
  pooledCount(): number {
    let n = 0;
    for (const p of this.pools) n += p.size;
    return n;
  }

  dispose(): void {
    this.clear();
    this.particles.dispose();
    this.group.traverse((o) => {
      const mesh = o as FxMesh;
      if (mesh.isMesh || (o as Sprite).isSprite) mesh.material.dispose();
    });
  }

  // ------------------------------------------------------------------
  // 飞行物
  // ------------------------------------------------------------------

  /** 光箭 / 法术光弹 / 火球从 from 飞到 to */
  projectile(kind: ProjectileKind, from: Point3, to: Point3, color: number, duration: number): Promise<void> {
    const ax = from.x;
    const ay = from.y;
    const az = from.z;
    const dx = to.x - ax;
    const dy = to.y - ay;
    const dz = to.z - az;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const isArrow = kind === 'arrow' || kind === 'skyArrow' || kind === 'rainArrow';
    const arc = kind === 'arrow' ? Math.min(0.6, dist * 0.05) : kind === 'bolt' ? 0.25 : kind === 'fireball' ? 0.5 : 0;
    const big = kind === 'fireball';
    const glow = this.sprite(glowTexture(), color, isArrow ? 2.2 : 2.6);
    const core = this.sprite(glowTexture(), 0xffffff, 1.6);
    glow.material.opacity = 1;
    core.material.opacity = 1;
    const glowSize = kind === 'skyArrow' ? 1.1 : kind === 'rainArrow' ? 0.8 : isArrow ? 0.5 : big ? 1.7 : 0.95;
    const shaft = isArrow ? this.beams.acquire() : null;
    const length = kind === 'skyArrow' ? 2.2 : kind === 'rainArrow' ? 2.6 : 1.1;
    const width = kind === 'arrow' ? 0.2 : 0.34;
    if (shaft) {
      shaft.material.map = streakTexture();
      shaft.material.color.setHex(color).multiplyScalar(1.7);
      shaft.material.opacity = 1;
    }
    let px = ax;
    let py = ay;
    let pz = az;
    return this.scheduler
      .tween(duration, (t) => {
        const x = ax + dx * t;
        const y = ay + dy * t + Math.sin(Math.PI * t) * arc;
        const z = az + dz * t;
        glow.position.set(x, y, z);
        glow.scale.setScalar(glowSize * (big ? 0.7 + 0.3 * t : 1));
        core.position.set(x, y, z);
        core.scale.setScalar(glowSize * 0.4);
        // 箭身沿飞行方向：尾巴拖在后面
        if (shaft) {
          let tx = x - px;
          let ty = y - py;
          let tz = z - pz;
          let len = Math.hypot(tx, ty, tz);
          if (len < 1e-5) {
            tx = dx;
            ty = dy + arc * Math.PI;
            tz = dz;
            len = Math.hypot(tx, ty, tz);
          }
          tx /= len;
          ty /= len;
          tz /= len;
          const l = Math.min(length, dist * t + 0.05);
          this.orientStrip(shaft, x - tx * l, y - ty * l, z - tz * l, tx, ty, tz, l, width);
        }
        // 飞行轨迹上撒下的光点
        const n = this.emitCount(kind === 'arrow' ? 45 : kind === 'bolt' ? 70 : 110);
        this.c.setHex(color);
        for (let i = 0; i < n; i++) {
          const f = Math.random();
          const sx = px + (x - px) * f + rnd(-0.05, 0.05);
          const sy = py + (y - py) * f + rnd(-0.05, 0.05);
          const sz = pz + (z - pz) * f + rnd(-0.05, 0.05);
          if (big && Math.random() < 0.3) {
            this.spawn(sx, sy, sz, rnd(-0.2, 0.2), rnd(0.2, 0.6), rnd(-0.2, 0.2), rnd(0.4, 0.7), 0.5, this.c, 0.25, PARTICLE_CELL.smoke, -0.4, 1, 1.6);
          } else {
            this.spawn(sx, sy, sz, rnd(-0.3, 0.3), rnd(-0.2, 0.4), rnd(-0.3, 0.3), rnd(0.2, 0.45), rnd(0.08, big ? 0.24 : 0.16), this.c, 1.6, big ? PARTICLE_CELL.ember : PARTICLE_CELL.glow, big ? 1.5 : 0, 1.5, -0.5);
          }
        }
        px = x;
        py = y;
        pz = z;
      })
      .then(() => {
        this.sprites.release(glow);
        this.sprites.release(core);
        if (shaft) this.beams.release(shaft);
      });
  }

  // ------------------------------------------------------------------
  // 爆发类
  // ------------------------------------------------------------------

  /** 在某点爆开 / 落下 / 升起的光效 */
  burst(kind: BurstKind, at: Point3, color: number, duration: number): Promise<void> {
    switch (kind) {
      case 'impact':
        return this.impact(at, color, duration, false);
      case 'heavyImpact':
        return this.impact(at, color, duration, true);
      case 'thunder':
        return this.thunder(at, color, duration);
      case 'pillarDown':
        return this.firePillar(at, color, duration);
      case 'pillarUp':
        return this.healPillar(at, color, duration);
      case 'reviveLight':
        return this.reviveLight(at, color, duration);
      case 'landing':
        return this.landing(at, color, duration);
      case 'shatter':
        return this.shatter(at, color, duration);
      case 'explosion':
        return this.explosion(at, color, duration);
    }
  }

  /** 命中闪光 + 火花；heavy = 重击（更大、带冲击环和闪光） */
  private impact(at: Point3, color: number, duration: number, heavy: boolean): Promise<void> {
    const flash = this.sprite(glowTexture(), color, heavy ? 2.2 : 1.8);
    const core = this.sprite(glowTexture(), 0xffffff, heavy ? 0.9 : 0.8);
    const ring = heavy ? this.sprite(ringTexture(), color, 2.4) : null;
    flash.position.set(at.x, at.y, at.z);
    core.position.set(at.x, at.y, at.z);
    ring?.position.set(at.x, at.y, at.z);
    this.sparks(at.x, at.y, at.z, color, heavy ? 22 : 9, heavy ? 6.5 : 4.2, heavy ? 0.16 : 0.11);
    if (heavy) this.flashLight(at.x, at.y + 0.3, at.z, color, 14);
    const size = heavy ? 1.7 : 1.2;
    return this.scheduler
      .tween(duration, (t) => {
        const k = EASE.out(t);
        flash.scale.setScalar(0.4 + size * k);
        flash.material.opacity = 1 - t;
        core.scale.setScalar((0.3 + size * 0.35 * k) * (1 - t * 0.5));
        core.material.opacity = Math.max(0, 1 - t * 2.2);
        if (ring) {
          ring.scale.setScalar(0.5 + 2.6 * k);
          ring.material.opacity = (1 - t) * (1 - t);
        }
      })
      .then(() => {
        this.sprites.release(flash);
        this.sprites.release(core);
        if (ring) this.sprites.release(ring);
      });
  }

  /** 落雷：从天而降的闪电（闪烁几次）+ 细光柱 + 地面冲击环和电火花 */
  private thunder(at: Point3, color: number, duration: number): Promise<void> {
    const sky = FX_CONFIG.skyHeight;
    const bolt = this.bolts.acquire();
    const branch = this.bolts.acquire();
    const pillar = this.pillar(color, 1.6);
    const ring = this.decal(ringTexture(), color, 2.6, at.x, at.z);
    const glow = this.sprite(glowTexture(), color, 3);
    bolt.material.color.setHex(color).lerp(this.c.setHex(0xffffff), 0.55).multiplyScalar(1.9);
    branch.material.color.setHex(color).multiplyScalar(1.2);
    pillar.position.set(at.x, 0, at.z);
    glow.position.set(at.x, 0.35, at.z);
    const topX = at.x + rnd(-1.2, 1.2);
    const topZ = at.z + rnd(-0.6, 0.6);
    this.sparks(at.x, 0.25, at.z, color, 16, 5.5, 0.13);
    this.flashLight(at.x, 1.2, at.z, color, 26);
    let phase = -1;
    return this.scheduler
      .tween(duration, (t) => {
        // 闪电只在前半段出现，每隔一小段时间重新抖一次形状
        const strike = t < 0.5;
        bolt.visible = branch.visible = strike;
        const p = Math.floor(t * 9);
        if (strike && p !== phase) {
          phase = p;
          this.shapeBolt(bolt, topX, sky, topZ, at.x, 0.05, at.z, 0.34, 0.75);
          this.shapeBolt(branch, topX + rnd(-0.6, 0.6), sky, topZ, at.x + rnd(-0.4, 0.4), 0.05, at.z + rnd(-0.3, 0.3), 0.16, 1.1);
          bolt.material.opacity = rnd(0.7, 1);
          branch.material.opacity = rnd(0.3, 0.8);
        }
        const fade = (1 - t) * (1 - t);
        pillar.scale.set(0.42 * (1 - 0.5 * t), FX_CONFIG.pillarHeight, 0.42 * (1 - 0.5 * t));
        pillar.rotation.y = t * 3;
        pillar.material.opacity = fade;
        ring.scale.setScalar(0.4 + 1.5 * EASE.out(t));
        ring.material.opacity = fade;
        glow.scale.setScalar(1.2 + 2.2 * EASE.out(t));
        glow.material.opacity = 1 - t;
      })
      .then(() => {
        this.bolts.release(bolt);
        this.bolts.release(branch);
        this.pillars.release(pillar);
        this.decals.release(ring);
        this.sprites.release(glow);
      });
  }

  /** 火柱 / 通用的法术光柱：从地面喷起，伴随上升的火星 */
  private firePillar(at: Point3, color: number, duration: number): Promise<void> {
    const outer = this.pillar(color, 1.15);
    const inner = this.pillar(0xffffff, 0.45);
    const ring = this.decal(ringTexture(), color, 2.2, at.x, at.z);
    const glow = this.sprite(glowTexture(), color, 1.7);
    outer.position.set(at.x, 0, at.z);
    inner.position.set(at.x, 0, at.z);
    glow.position.set(at.x, 0.4, at.z);
    this.flashLight(at.x, 1.2, at.z, color, 26);
    const h = FX_CONFIG.pillarHeight;
    return this.scheduler
      .tween(duration, (t) => {
        const rise = EASE.out(Math.min(1, t * 5));
        const fade = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
        const r = 0.3 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.4));
        outer.scale.set(r, h * rise, r);
        outer.rotation.y = t * 5;
        outer.material.opacity = fade;
        inner.scale.set(r * 0.45, h * 0.8 * rise, r * 0.45);
        inner.rotation.y = -t * 7;
        inner.material.opacity = fade * 0.8;
        ring.scale.setScalar(0.4 + 1.3 * EASE.out(t));
        ring.material.opacity = fade;
        glow.scale.setScalar(1.4 + 1.6 * EASE.out(t));
        glow.material.opacity = fade;
        if (t < 0.6) {
          const n = this.emitCount(70);
          this.c.setHex(color);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const d = Math.random() * 0.45;
            this.spawn(at.x + Math.cos(a) * d, rnd(0.1, 1.2), at.z + Math.sin(a) * d, rnd(-0.4, 0.4), rnd(2, 4.5), rnd(-0.4, 0.4), rnd(0.35, 0.7), rnd(0.08, 0.18), this.c, 1.8, PARTICLE_CELL.ember, 0, 0.8, -0.4);
          }
        }
      })
      .then(() => {
        this.pillars.release(outer);
        this.pillars.release(inner);
        this.decals.release(ring);
        this.sprites.release(glow);
      });
  }

  /** 治疗光柱：从脚下升起的金绿光柱 + 旋转的小符文阵 + 上升的光点 */
  private healPillar(at: Point3, color: number, duration: number): Promise<void> {
    const outer = this.pillar(color, 0.85);
    const inner = this.pillar(0xfff6c8, 0.5);
    const rune = this.decal(runeCircleTexture(8, 11), color, 1.5, at.x, at.z);
    const glow = this.sprite(glowTexture(), color, 1.5);
    outer.position.set(at.x, 0, at.z);
    inner.position.set(at.x, 0, at.z);
    glow.position.set(at.x, 0.3, at.z);
    const h = FX_CONFIG.pillarHeight * 0.75;
    return this.scheduler
      .tween(duration, (t) => {
        const rise = EASE.out(Math.min(1, t / 0.35));
        const fade = Math.min(1, t * 8) * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
        outer.scale.set(0.58, h * rise, 0.58);
        outer.rotation.y = t * 2.5;
        outer.material.opacity = fade;
        inner.scale.set(0.3, h * 0.85 * rise, 0.3);
        inner.rotation.y = -t * 4;
        inner.material.opacity = fade;
        rune.scale.setScalar(0.75 + 0.15 * rise);
        rune.rotation.y = t * 2;
        rune.material.opacity = fade;
        glow.scale.setScalar(1.5 + 0.8 * rise);
        glow.material.opacity = fade * 0.8;
        if (t < 0.8) {
          const n = this.emitCount(42);
          this.c.setHex(color);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const d = rnd(0.15, 0.65);
            const spark = Math.random() < 0.25;
            this.spawn(at.x + Math.cos(a) * d, rnd(0.05, 0.8), at.z + Math.sin(a) * d, 0, rnd(1.1, 2.6), 0, rnd(0.6, 1.1), spark ? rnd(0.2, 0.3) : rnd(0.07, 0.15), this.c, 1.5, spark ? PARTICLE_CELL.spark : PARTICLE_CELL.glow, 0, 0.3, -0.3);
          }
        }
      })
      .then(() => {
        this.pillars.release(outer);
        this.pillars.release(inner);
        this.decals.release(rune);
        this.sprites.release(glow);
      });
  }

  /** 复活光芒：一道宽阔的光从高处落到倒地的单位身上，光点缓缓飘落，地面光环扩散 */
  private reviveLight(at: Point3, color: number, duration: number): Promise<void> {
    const beam = this.pillar(color, 0.9);
    const core = this.pillar(0xffffff, 0.55);
    const ring = this.decal(ringTexture(), color, 1.8, at.x, at.z);
    const rune = this.decal(runeCircleTexture(8, 11), color, 1.2, at.x, at.z);
    const glow = this.sprite(glowTexture(), color, 1.8);
    const top = FX_CONFIG.skyHeight;
    const h = FX_CONFIG.pillarHeight * 1.2;
    glow.position.set(at.x, 0.4, at.z);
    let landed = false;
    return this.scheduler
      .tween(duration, (t) => {
        const fall = EASE.inOut(Math.min(1, t / 0.28));
        const fade = Math.min(1, t * 10) * (t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35);
        // 整道光从高处落到地面
        beam.position.set(at.x, top * (1 - fall), at.z);
        beam.scale.set(0.85, h, 0.85);
        beam.rotation.y = t * 1.5;
        beam.material.opacity = fade * 0.9;
        core.position.set(at.x, top * (1 - fall), at.z);
        core.scale.set(0.4, h, 0.4);
        core.material.opacity = fade * 0.7;
        const spread = Math.max(0, (t - 0.25) / 0.75);
        ring.scale.setScalar(0.3 + 1.6 * EASE.out(spread));
        ring.material.opacity = t < 0.25 ? 0 : (1 - spread) * (1 - spread);
        rune.scale.setScalar(0.9);
        rune.rotation.y = -t * 1.5;
        rune.material.opacity = fall * fade;
        glow.scale.setScalar(1 + 2.4 * fall);
        glow.material.opacity = fall * fade;
        this.c.setHex(color);
        if (!landed && t >= 0.28) {
          landed = true;
          this.flashLight(at.x, 1, at.z, color, 30);
          for (let i = 0; i < this.burstCount(14); i++) {
            const a = Math.random() * TAU;
            this.spawn(at.x, 0.2, at.z, Math.cos(a) * rnd(1, 2.4), rnd(0.4, 1.4), Math.sin(a) * rnd(1, 2.4), rnd(0.5, 0.9), rnd(0.12, 0.26), this.c, 1.6, PARTICLE_CELL.spark, 0.5, 1.6, 0);
          }
        }
        if (t < 0.85) {
          // 从高处缓缓飘落的光点
          const n = this.emitCount(34);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * TAU;
            const d = rnd(0.05, 0.75);
            this.spawn(at.x + Math.cos(a) * d, rnd(1.6, 4.2) * fall + 0.3, at.z + Math.sin(a) * d, 0, rnd(-1.5, -0.5), 0, rnd(0.8, 1.3), rnd(0.07, 0.16), this.c, 1.5, PARTICLE_CELL.glow, 0, 0.2, -0.3);
          }
        }
      })
      .then(() => {
        this.pillars.release(beam);
        this.pillars.release(core);
        this.decals.release(ring);
        this.decals.release(rune);
        this.sprites.release(glow);
      });
  }

  /** 箭雨落点：地面光圈扩散 + 向上溅起的火花 */
  private landing(at: Point3, color: number, duration: number): Promise<void> {
    const ring = this.decal(ringTexture(), color, 2.6, at.x, at.z);
    const inner = this.decal(ringTexture(), 0xffffff, 1.2, at.x, at.z);
    const glow = this.sprite(glowTexture(), color, 2.4);
    glow.position.set(at.x, 0.25, at.z);
    this.c.setHex(color);
    for (let i = 0; i < this.burstCount(12); i++) {
      const a = Math.random() * TAU;
      const s = rnd(0.6, 2.2);
      this.spawn(at.x, 0.12, at.z, Math.cos(a) * s, rnd(2, 5), Math.sin(a) * s, rnd(0.3, 0.6), rnd(0.08, 0.2), this.c, 2, Math.random() < 0.4 ? PARTICLE_CELL.spark : PARTICLE_CELL.ember, 9, 0.6, -0.4);
    }
    return this.scheduler
      .tween(duration, (t) => {
        const k = EASE.out(t);
        ring.scale.setScalar(0.2 + 1.0 * k);
        ring.material.opacity = (1 - t) * (1 - t);
        inner.scale.setScalar(0.1 + 0.55 * k);
        inner.material.opacity = Math.max(0, 1 - t * 2);
        glow.scale.setScalar(0.6 + 1.3 * k);
        glow.material.opacity = Math.max(0, 1 - t * 1.8);
      })
      .then(() => {
        this.decals.release(ring);
        this.decals.release(inner);
        this.sprites.release(glow);
      });
  }

  /** 锁链崩碎（封印被抵抗）：碎光四散 */
  private shatter(at: Point3, color: number, duration: number): Promise<void> {
    const flash = this.sprite(glowTexture(), color, 2);
    flash.position.set(at.x, at.y, at.z);
    this.sparks(at.x, at.y, at.z, color, 20, 4.5, 0.14);
    return this.scheduler
      .tween(duration, (t) => {
        flash.scale.setScalar(0.5 + 1.4 * EASE.out(t));
        flash.material.opacity = 1 - t;
      })
      .then(() => this.sprites.release(flash));
  }

  /** 火球爆炸：强光、地面冲击环、四溅的火星和烟 */
  private explosion(at: Point3, color: number, duration: number): Promise<void> {
    const flash = this.sprite(glowTexture(), color, 3.4);
    const core = this.sprite(glowTexture(), 0xffffff, 2.6);
    const ring = this.decal(ringTexture(), color, 2.8, at.x, at.z);
    const shock = this.sprite(ringTexture(), color, 2.2);
    flash.position.set(at.x, at.y, at.z);
    core.position.set(at.x, at.y, at.z);
    shock.position.set(at.x, at.y, at.z);
    this.flashLight(at.x, at.y + 0.4, at.z, color, 40);
    this.c.setHex(color);
    for (let i = 0; i < this.burstCount(34); i++) {
      const a = Math.random() * TAU;
      const up = rnd(-0.2, 1);
      const s = rnd(2, 7);
      const h = Math.sqrt(Math.max(0, 1 - up * up));
      this.spawn(at.x, at.y, at.z, Math.cos(a) * h * s, up * s, Math.sin(a) * h * s, rnd(0.4, 0.85), rnd(0.08, 0.22), this.c, 2.2, PARTICLE_CELL.ember, 7, 1.4, -0.5);
    }
    for (let i = 0; i < this.burstCount(8); i++) {
      const a = Math.random() * TAU;
      this.spawn(at.x + Math.cos(a) * 0.3, at.y + rnd(-0.2, 0.4), at.z + Math.sin(a) * 0.3, Math.cos(a) * 0.8, rnd(0.6, 1.6), Math.sin(a) * 0.8, rnd(0.7, 1.1), rnd(0.7, 1.1), this.c, 0.22, PARTICLE_CELL.smoke, -0.3, 1.2, 1.4);
    }
    return this.scheduler
      .tween(duration, (t) => {
        const k = EASE.out(t);
        flash.scale.setScalar(0.8 + 3.6 * k);
        flash.material.opacity = (1 - t) * (1 - t);
        core.scale.setScalar(0.5 + 1.6 * k);
        core.material.opacity = Math.max(0, 1 - t * 2.5);
        ring.scale.setScalar(0.4 + 2.0 * k);
        ring.material.opacity = (1 - t) * (1 - t);
        shock.scale.setScalar(0.5 + 3.4 * k);
        shock.material.opacity = Math.max(0, 1 - t * 1.6);
      })
      .then(() => {
        this.sprites.release(flash);
        this.sprites.release(core);
        this.decals.release(ring);
        this.sprites.release(shock);
      });
  }

  // ------------------------------------------------------------------
  // 斩击、锁链、地面法阵
  // ------------------------------------------------------------------

  /**
   * 斩击光弧：一道月牙形的光划过目标。
   * @param variant 0 = 斜劈，1 = 横斩，2 = 自上而下的重劈（每种轨迹角度不同）
   */
  slash(at: Point3, variant: number, color: number, duration: number, scale: number): Promise<void> {
    const v = ((variant % 3) + 3) % 3;
    const arc = this.sprite(slashTexture(), color, 2.6 + v * 0.5);
    const edge = this.sprite(slashTexture(), 0xffffff, 1.5);
    const base = v === 0 ? -0.95 : v === 1 ? Math.PI + 0.18 : 1.25;
    const sweep = v === 1 ? -0.9 : 0.8;
    arc.position.set(at.x, at.y, at.z);
    edge.position.set(at.x, at.y, at.z);
    const size = scale * (v === 2 ? 2.7 : 2.1);
    return this.scheduler
      .tween(duration, (t) => {
        const k = EASE.out(t);
        const rot = base + sweep * (k - 0.5);
        const fade = t < 0.15 ? t / 0.15 : (1 - t) / 0.85;
        arc.material.rotation = rot;
        arc.material.opacity = fade;
        arc.scale.set(size * (0.75 + 0.4 * k), size * (0.75 + 0.4 * k), 1);
        edge.material.rotation = rot;
        edge.material.opacity = fade * fade;
        edge.scale.set(size * (0.7 + 0.36 * k), size * (0.7 + 0.36 * k), 1);
      })
      .then(() => {
        arc.material.rotation = 0;
        edge.material.rotation = 0;
        this.sprites.release(arc);
        this.sprites.release(edge);
      });
  }

  /**
   * 锁链光束：从 from 伸向 to（travel 秒到达），命中后绷紧抖动并在 linger 秒内消散。
   */
  beam(from: Point3, to: Point3, color: number, travel: number, linger: number): Promise<void> {
    const chain = this.chains.acquire();
    const core = this.beams.acquire();
    const head = this.sprite(glowTexture(), color, 2.4);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const uz = dz / dist;
    chain.material.color.setHex(color).multiplyScalar(1.6);
    core.material.map = boltTexture();
    core.material.color.setHex(color).multiplyScalar(1.1);
    const total = travel + linger;
    const reach = travel / total;
    return this.scheduler
      .tween(total, (t) => {
        const grow = Math.min(1, t / reach);
        const len = Math.max(0.01, dist * grow);
        const after = t <= reach ? 0 : (t - reach) / (1 - reach);
        const fade = 1 - after * after;
        // 命中后锁链绷紧：宽度抖动
        const wobble = after > 0 ? 1 + 0.25 * Math.sin(after * 40) * (1 - after) : 1;
        this.orientStrip(chain, from.x, from.y, from.z, ux, uy, uz, len, 0.34 * wobble);
        chain.material.map!.repeat.x = len / 0.55; // 每节锁链长度固定，不随长度拉伸
        chain.material.map!.offset.x = -t * 3; // 锁链向前滚动
        chain.material.opacity = fade;
        this.orientStrip(core, from.x, from.y, from.z, ux, uy, uz, len, 0.5);
        core.material.opacity = fade * 0.7;
        head.position.set(from.x + ux * len, from.y + uy * len, from.z + uz * len);
        head.scale.setScalar(grow < 1 ? 0.7 : 0.7 + 1.2 * after);
        head.material.opacity = fade;
        if (grow < 1) {
          const n = this.emitCount(60);
          this.c.setHex(color);
          for (let i = 0; i < n; i++) {
            this.spawn(head.position.x, head.position.y, head.position.z, rnd(-0.6, 0.6), rnd(-0.4, 0.8), rnd(-0.6, 0.6), rnd(0.25, 0.5), rnd(0.07, 0.15), this.c, 1.5, PARTICLE_CELL.glow, 0, 1, -0.4);
          }
        }
      })
      .then(() => {
        this.chains.release(chain);
        this.beams.release(core);
        this.sprites.release(head);
      });
  }

  /** 持续一段时间的范围光效：地面符文阵 / 蓄力光环 / 缠绕的锁链 */
  aura(kind: AuraKind, at: Point3, color: number, duration: number, radius: number): Promise<void> {
    if (kind === 'bind') return this.bind(at, color, duration, radius);
    const big = kind === 'runeCircle';
    const rune = this.decal(big ? runeCircleTexture(6, 5) : runeCircleTexture(8, 11), color, big ? 1.5 : 1.7, at.x, at.z);
    const halo = this.decal(ringTexture(), color, 0.8, at.x, at.z);
    return this.scheduler
      .tween(duration, (t) => {
        const open = EASE.out(Math.min(1, t / 0.3));
        const fade = Math.min(1, t / 0.12) * (t < 0.8 ? 1 : (1 - t) / 0.2);
        const pulse = 1 + 0.18 * Math.sin(t * duration * 14);
        rune.scale.setScalar(radius * (0.55 + 0.45 * open));
        rune.rotation.y = t * duration * (big ? 0.7 : -1.6);
        rune.material.opacity = fade * pulse;
        halo.scale.setScalar(radius * (1.05 + 0.08 * Math.sin(t * duration * 9)));
        halo.material.opacity = fade * 0.5;
        if (t < 0.8) {
          this.c.setHex(color);
          if (big) {
            // 符文阵里零星升起的光点
            const n = this.emitCount(radius * radius * 2.2);
            for (let i = 0; i < n; i++) {
              const a = Math.random() * TAU;
              const d = Math.sqrt(Math.random()) * radius * 0.92;
              this.spawn(at.x + Math.cos(a) * d, 0.05, at.z + Math.sin(a) * d, 0, rnd(0.5, 1.6), 0, rnd(0.5, 0.9), rnd(0.06, 0.14), this.c, 1.4, PARTICLE_CELL.glow, 0, 0.2, -0.4);
            }
          } else {
            // 蓄力：光点从四周向施法者汇聚并上升
            const n = this.emitCount(55);
            for (let i = 0; i < n; i++) {
              const a = Math.random() * TAU;
              const d = radius * rnd(0.8, 1.15);
              const s = rnd(1.5, 2.8);
              this.spawn(at.x + Math.cos(a) * d, rnd(0.05, 0.5), at.z + Math.sin(a) * d, -Math.cos(a) * s, rnd(1.6, 3.2), -Math.sin(a) * s, rnd(0.35, 0.6), rnd(0.07, 0.15), this.c, 1.6, Math.random() < 0.2 ? PARTICLE_CELL.spark : PARTICLE_CELL.glow, 0, 1.2, -0.5);
            }
          }
        }
      })
      .then(() => {
        this.decals.release(rune);
        this.decals.release(halo);
      });
  }

  /** 锁链缠绕：三圈发光锁链从外向内收紧，箍在目标身上 */
  private bind(at: Point3, color: number, duration: number, radius: number): Promise<void> {
    const k = Math.min(2.4, radius / 0.45);
    const rings = [this.bands.acquire(), this.bands.acquire(), this.bands.acquire()];
    const tilt = [0.32, -0.26, 0.2];
    rings.forEach((b, i) => {
      b.material.color.setHex(color).multiplyScalar(2.2);
      b.rotation.set(tilt[i]!, i * 2.1, tilt[(i + 1) % 3]!);
    });
    let snapped = false;
    return this.scheduler
      .tween(duration, (t) => {
        const close = EASE.out(Math.min(1, t / 0.45));
        const r = radius * (2.6 - 1.6 * close);
        const fade = Math.min(1, t * 8) * (t < 0.75 ? 1 : (1 - t) / 0.25);
        rings.forEach((b, i) => {
          b.position.set(at.x, (0.35 + i * 0.42) * k, at.z);
          b.scale.set(r, 0.2 * k, r);
          b.rotation.y = i * 2.1 + (i % 2 ? -1 : 1) * t * 6;
          b.material.opacity = fade;
        });
        if (!snapped && t >= 0.45) {
          snapped = true;
          this.sparks(at.x, 0.8 * k, at.z, color, 14, 3.2, 0.12);
        }
      })
      .then(() => {
        for (const b of rings) this.bands.release(b);
      });
  }

  // ------------------------------------------------------------------
  // 武器拖尾
  // ------------------------------------------------------------------

  /** 开始一条拖尾：之后每帧调用 source 取武器两端的位置，连成一条发光的带子 */
  startTrail(source: TrailSource, color: number, brightness = 1): TrailHandle {
    if (this.scheduler.skip) return { stop: () => undefined };
    const n = FX_CONFIG.trailSamples;
    const mesh = this.trailMeshes.acquire();
    mesh.material.color.setHex(color).multiplyScalar(1.4 * brightness);
    mesh.material.opacity = 1;
    mesh.geometry.setDrawRange(0, 0);
    // 取样缓冲区跟着网格走，网格复用时缓冲区也复用
    const buf = (mesh.userData['trail'] ??= {
      base: new Float32Array(n * 3),
      tip: new Float32Array(n * 3),
      age: new Float32Array(n),
    }) as Pick<Trail, 'base' | 'tip' | 'age'>;
    const trail: Trail = { mesh, source, base: buf.base, tip: buf.tip, age: buf.age, count: 0 };
    this.trails.push(trail);
    return {
      stop: () => {
        trail.source = null;
      },
    };
  }

  private updateTrails(dt: number): void {
    const n = FX_CONFIG.trailSamples;
    const life = FX_CONFIG.trailLife;
    for (let k = this.trails.length - 1; k >= 0; k--) {
      const t = this.trails[k]!;
      for (let i = 0; i < t.count; i++) t.age[i] = t.age[i]! + dt;
      while (t.count > 0 && t.age[t.count - 1]! >= life) t.count--;
      if (t.source) {
        // 新的取样放在最前面，旧的依次后移
        const keep = Math.min(t.count, n - 1);
        t.base.copyWithin(3, 0, keep * 3);
        t.tip.copyWithin(3, 0, keep * 3);
        t.age.copyWithin(1, 0, keep);
        t.source(this.v1, this.v2);
        this.v1.toArray(t.base, 0);
        this.v2.toArray(t.tip, 0);
        t.age[0] = 0;
        t.count = keep + 1;
      } else if (t.count === 0) {
        this.trailMeshes.release(t.mesh);
        this.trails.splice(k, 1);
        continue;
      }
      const pos = t.mesh.geometry.getAttribute('position') as BufferAttribute;
      const uv = t.mesh.geometry.getAttribute('uv') as BufferAttribute;
      const p = pos.array as Float32Array;
      const u = uv.array as Float32Array;
      for (let i = 0; i < t.count; i++) {
        const i3 = i * 3;
        const o = i * 6;
        p[o] = t.base[i3]!;
        p[o + 1] = t.base[i3 + 1]!;
        p[o + 2] = t.base[i3 + 2]!;
        p[o + 3] = t.tip[i3]!;
        p[o + 4] = t.tip[i3 + 1]!;
        p[o + 5] = t.tip[i3 + 2]!;
        const a = Math.min(1, t.age[i]! / life);
        u[i * 4] = a;
        u[i * 4 + 2] = a;
      }
      pos.needsUpdate = true;
      uv.needsUpdate = true;
      t.mesh.geometry.setDrawRange(0, Math.max(0, t.count - 1) * 6);
    }
  }

  // ------------------------------------------------------------------
  // 内部工具
  // ------------------------------------------------------------------

  /** 闪光：借用一盏常驻点光源，亮一下后自动衰减 */
  flashLight(x: number, y: number, z: number, color: number, intensity: number): void {
    if (this.scheduler.skip) return;
    let light = this.lights[0]!;
    for (const l of this.lights) if (l.intensity < light.intensity) light = l;
    light.position.set(x, y, z);
    light.color.setHex(color);
    light.intensity = intensity;
  }

  private sprite(map: Texture, color: number, brightness: number): FxSprite {
    const s = this.sprites.acquire();
    s.material.map = map;
    s.material.color.setHex(color).multiplyScalar(brightness * BRIGHTNESS.sprite);
    s.material.opacity = 0;
    s.scale.setScalar(1);
    return s;
  }

  private pillar(color: number, brightness: number): FxMesh {
    const m = this.pillars.acquire();
    m.material.color.setHex(color).multiplyScalar(brightness * BRIGHTNESS.pillar);
    m.material.opacity = 0;
    m.rotation.set(0, 0, 0);
    m.scale.set(0.01, 0.01, 0.01);
    return m;
  }

  private decal(map: Texture, color: number, brightness: number, x: number, z: number): FxMesh {
    const m = this.decals.acquire();
    m.material.map = map;
    m.material.color.setHex(color).multiplyScalar(brightness * BRIGHTNESS.decal);
    m.material.opacity = 0;
    m.position.set(x, GROUND_Y, z);
    m.rotation.set(0, 0, 0);
    m.scale.setScalar(0.01);
    return m;
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    color: Color,
    brightness: number,
    cell: number,
    gravity: number,
    drag: number,
    grow: number,
  ): void {
    if (this.scheduler.skip) return;
    this.particles.spawn(x, y, z, vx, vy, vz, life, size, color, brightness, cell, gravity, drag, grow);
  }

  /** 持续发射：按“每秒 rate 个”折算出这一帧该发射几个（跳过动画时为 0） */
  private emitCount(rate: number): number {
    if (this.scheduler.skip) return 0;
    return Math.floor(rate * this.particleScale * this.scheduler.delta + Math.random());
  }

  /** 一次性爆发的粒子数（跳过动画时为 0） */
  private burstCount(n: number): number {
    return this.scheduler.skip ? 0 : Math.ceil(n * this.particleScale);
  }

  /** 向四周迸溅的火花 */
  private sparks(x: number, y: number, z: number, color: number, count: number, speed: number, size: number): void {
    this.c.setHex(color);
    for (let i = 0; i < this.burstCount(count); i++) {
      const a = Math.random() * TAU;
      const up = rnd(-0.5, 1);
      const h = Math.sqrt(Math.max(0, 1 - up * up));
      const s = speed * rnd(0.35, 1);
      const star = Math.random() < 0.35;
      this.spawn(x, y, z, Math.cos(a) * h * s, up * s + 1, Math.sin(a) * h * s, rnd(0.22, 0.5), star ? size * 2.2 : size, this.c, 2.2, star ? PARTICLE_CELL.spark : PARTICLE_CELL.ember, 8, 2.2, -0.5);
    }
  }

  /**
   * 摆放一条沿 (ux,uy,uz) 方向的带子：起点在 (x,y,z)，长 length、宽 width，
   * 并绕自身长轴转到正对镜头（这样从任何角度看都是一条完整的光带）。
   */
  private orientStrip(mesh: FxMesh, x: number, y: number, z: number, ux: number, uy: number, uz: number, length: number, width: number): void {
    const axis = this.v1.set(ux, uy, uz);
    const toCamera = this.v2.copy(this.camera.position).sub(this.v3.set(x, y, z));
    const normal = toCamera.addScaledVector(axis, -toCamera.dot(axis));
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    normal.normalize();
    const side = this.v4.crossVectors(normal, axis);
    this.m4.makeBasis(axis, side, normal);
    mesh.quaternion.setFromRotationMatrix(this.m4);
    mesh.position.set(x, y, z);
    mesh.scale.set(length, width, 1);
  }

  /** 生成一道闪电的形状：从 (ax,ay,az) 到 (bx,by,bz) 的折线带，中段随机偏移，宽度方向正对镜头 */
  private shapeBolt(mesh: FxMesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, jitter: number): void {
    const pos = mesh.geometry.getAttribute('position') as BufferAttribute;
    const p = pos.array as Float32Array;
    // 镜头的右方向
    const e = this.camera.matrixWorld.elements;
    const rx = e[0]!;
    const ry = e[1]!;
    const rz = e[2]!;
    const half = width / 2;
    for (let i = 0; i <= BOLT_SEGMENTS; i++) {
      const f = i / BOLT_SEGMENTS;
      const amp = i === BOLT_SEGMENTS ? 0 : jitter * Math.min(1, (1 - f) * 3 + 0.25);
      const off = rnd(-amp, amp);
      const x = ax + (bx - ax) * f + rx * off;
      const y = ay + (by - ay) * f + ry * off;
      const z = az + (bz - az) * f + rz * off + rnd(-amp, amp) * 0.3;
      const o = i * 6;
      p[o] = x - rx * half;
      p[o + 1] = y - ry * half;
      p[o + 2] = z - rz * half;
      p[o + 3] = x + rx * half;
      p[o + 4] = y + ry * half;
      p[o + 5] = z + rz * half;
    }
    pos.needsUpdate = true;
  }

  /**
   * 预热：开场时把每种特效对象各创建一个并以全透明画几帧，
   * 让着色器在战斗开始前编译好，第一次放技能时不卡顿。
   */
  private startPrewarm(): void {
    const sprite = this.sprite(glowTexture(), 0xffffff, 1);
    const pillar = this.pillar(0xffffff, 1);
    const decal = this.decal(ringTexture(), 0xffffff, 1, 0, 0);
    const beam = this.beams.acquire();
    const chain = this.chains.acquire();
    const band = this.bands.acquire();
    const bolt = this.bolts.acquire();
    const trail = this.trailMeshes.acquire();
    for (const m of [beam, chain, band, bolt, trail]) m.material.opacity = 0;
    for (const m of [beam, chain, band]) m.scale.setScalar(0.01);
    this.prewarm = () => {
      this.sprites.release(sprite);
      this.pillars.release(pillar);
      this.decals.release(decal);
      this.beams.release(beam);
      this.chains.release(chain);
      this.bands.release(band);
      this.bolts.release(bolt);
      this.trailMeshes.release(trail);
    };
  }
}

/** 一条由 segments 段四边形组成的带子（顶点成对排列），位置和 uv 每帧改写 */
function stripGeometry(segments: number): BufferGeometry {
  const points = segments + 1;
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(points * 2 * 3), 3);
  const uv = new BufferAttribute(new Float32Array(points * 2 * 2), 2);
  position.setUsage(DynamicDrawUsage);
  uv.setUsage(DynamicDrawUsage);
  const index: number[] = [];
  for (let i = 0; i < points; i++) {
    uv.setXY(i * 2, i / segments, 0);
    uv.setXY(i * 2 + 1, i / segments, 1);
    if (i < segments) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute('position', position);
  geometry.setAttribute('uv', uv);
  geometry.setIndex(index);
  return geometry;
}

// 待机动画：把 idleMotion.ts 算出的偏移量加到模型上。
//
// 用法（每帧）：
//   1. 调用方先把自己负责的关节摆好（UnitView 的出手 / 受击姿态；预览页没有，就是站姿）；
//   2. animator.update(time, weight) —— 计算偏移，直接写“只有待机会动”的额外关节、布料飘动和发光呼吸；
//   3. animator.addToRig() —— 把偏移“加”到人形骨架的关节上（UnitView 在摆完出手姿态之后调用）；
//   4. 整体的起伏、侧倾、漂浮通过 animator.offsets 读取，由调用方加到模型根节点上。
//
// weight 是 0~1 的权重（出手、受击时调用方把它平滑降到 0，倒地后只剩一点点），所有偏移都乘它，
// 所以待机和其他动作之间的切换是连续的。

import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { GLOW_BASE_KEY, GLOW_SCALE_HOOK, GLOW_SCALE_KEY, SWAY_UNIFORMS_KEY, type SwayUniforms } from '../../assets/materials';
import { getRig } from '../../assets/models/characters/rig';
import { IDLE_CONFIG, IDLE_STYLES, type IdleStyle, type IdleStyleId } from '../../data/idleConfig';
import { allAnimatedJoints } from './animatedJoints';
import { createIdleTraits, sampleIdle, zeroOffsets, type IdleOffsets, type IdleTraits } from './idleMotion';

/** 待机动画的全局开关（低画质时关掉次要动画），所有单位共用 */
export const IDLE_RUNTIME = {
  events: true, // 张望、小动作、张嘴
  tremble: true,
  cloth: true, // 布料飘动（着色器那边另有 SWAY_GLOBAL.uSwayQuality 总开关）
};

interface Rest {
  joint: Object3D;
  x: number;
  y: number;
  z: number;
}

export class IdleAnimator {
  readonly style: IdleStyle;
  readonly traits: IdleTraits;
  /** 最近一次 update 算出的偏移（已乘权重） */
  readonly offsets: IdleOffsets = zeroOffsets();
  private readonly raw: IdleOffsets = zeroOffsets();
  private readonly joints: Record<string, Rest> = {};
  private readonly hasRig: boolean;
  private readonly glows: { mat: MeshStandardMaterial; base: number }[] = [];
  private readonly sways: SwayUniforms[] = [];

  constructor(
    readonly model: Object3D,
    styleId: IdleStyleId,
    seed: number,
  ) {
    this.style = IDLE_STYLES[styleId];
    this.traits = createIdleTraits(seed, this.style, IDLE_CONFIG.periodJitter);
    const rig = getRig(model);
    this.hasRig = rig !== undefined;
    for (const [name, joint] of Object.entries(allAnimatedJoints(model, rig))) {
      this.joints[name] = { joint, x: joint.rotation.x, y: joint.rotation.y, z: joint.rotation.z };
    }
    // 身上的发光材质（眼睛、符文、核心）和带飘动的材质。武器自己管理发光（GLOW_SCALE_HOOK），不在这里处理
    const walk = (o: Object3D): void => {
      if (typeof o.userData[GLOW_SCALE_HOOK] === 'function') return;
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const base = m.userData[GLOW_BASE_KEY] as number | undefined;
          if (base !== undefined && !this.glows.some((g) => g.mat === m)) this.glows.push({ mat: m as MeshStandardMaterial, base });
          const sway = m.userData[SWAY_UNIFORMS_KEY] as SwayUniforms | undefined;
          if (sway && !this.sways.includes(sway)) this.sways.push(sway);
        }
      }
      for (const child of o.children) walk(child);
    };
    walk(model);
    for (const s of this.sways) {
      s.uSwayPhase.value = this.traits.phase[0]!;
      s.uSwayHz.value = this.style.clothHz * this.traits.rate;
      s.uSwayAmp.value = this.style.cloth;
    }
  }

  /**
   * 计算这一帧的待机偏移，并写入额外关节、布料和发光。
   * @param weight 待机权重 0~1
   * @param restFirst 额外关节之外，是否先把人形骨架的关节也恢复成站姿（预览页用；UnitView 自己会摆）
   */
  update(time: number, weight: number, restFirst = false): void {
    const o = this.offsets;
    sampleIdle(this.style, this.traits, time, this.raw, IDLE_RUNTIME);
    for (const key of Object.keys(o) as (keyof IdleOffsets)[]) o[key] = this.raw[key] * weight;
    // 发光不乘权重归零：没有待机时回到基础强度 1
    o.glow = 1 + (this.raw.glow - 1) * weight;

    const set = (name: string, dx: number, dy = 0, dz = 0): void => {
      const j = this.joints[name];
      if (j) j.joint.rotation.set(j.x + dx, j.y + dy, j.z + dz);
    };
    if (this.hasRig) {
      if (restFirst) for (const j of Object.values(this.joints)) j.joint.rotation.set(j.x, j.y, j.z);
      // Boss 的双翼：缓缓开合
      set('wingL', 0, o.wing, o.wing * 0.4);
      set('wingR', 0, -o.wing, -o.wing * 0.4);
    } else {
      // 非人形：头、颈、尾、翅、臂都由待机直接驱动
      set('neck', o.chestPitch * 1.5 + o.headPitch * 0.5, o.headYaw * 0.35, 0);
      set('head', o.headPitch + o.tremble, o.headYaw * (this.joints['neck'] ? 0.65 : 1), o.roll * -0.6);
      set('jaw', o.jaw, 0, 0);
      set('tail', o.tailPitch, o.tailYaw, 0);
      set('torso', o.chestPitch, o.twist, 0);
      set('wingL', 0, -o.wing, o.wing * 0.5 + o.breath * 0.02);
      set('wingR', 0, o.wing, -o.wing * 0.5 - o.breath * 0.02);
      set('shoulderL', o.armL, 0, o.armL * 0.4);
      set('shoulderR', o.armR - o.armL * 0.6, 0, -o.armL * 0.4);
      set('foreL', o.claw, 0, 0);
      set('foreR', -o.claw * 0.7, 0, 0);
    }

    for (const g of this.glows) {
      const scale = (g.mat.userData[GLOW_SCALE_KEY] as number | undefined) ?? 1;
      g.mat.emissiveIntensity = g.base * scale * o.glow;
    }
    const cloth = IDLE_RUNTIME.cloth ? this.style.cloth * weight : 0;
    for (const s of this.sways) s.uSwayAmp.value = cloth;
  }

  /** 把待机偏移加到人形骨架的关节上（在调用方摆完出手 / 受击姿态之后调用）。非人形模型是空操作 */
  addToRig(): void {
    if (!this.hasRig) return;
    const o = this.offsets;
    const add = (name: string, dx: number, dy = 0, dz = 0): void => {
      const j = this.joints[name]?.joint;
      if (!j) return;
      j.rotation.x += dx;
      j.rotation.y += dy;
      j.rotation.z += dz;
    };
    add('chest', o.chestPitch);
    add('spine', o.tremble * 0.5, o.twist, 0);
    add('head', o.headPitch + o.tremble, o.headYaw, 0);
    add('shoulderR', o.armR);
    add('elbowR', o.elbowR);
    add('shoulderL', o.armL);
  }
}

// 骷髅兵拼骨架（步骤 18 召唤演出）：逐部件动画。
//
// 模型的网格在启动时已按“关节 + 材质”合并（assets/optimize.ts），所以一个“部件”就是挂在某个关节下的一块合并网格：
//   骨盆和脊椎（模型根 / spine）、肋骨（chest，连同颈椎）、头骨（head）、双臂（shoulder / elbow，连同手骨）、
//   双腿（hipL / hipR，召唤专用的合并边界，见 data/unitModels.ts 的 summonParts）。
// 按材质名（skeleton.ts 的 SKELETON_PART）分三类：骨头先从地下飞起、翻转着拼到身上；其余（盔甲、剑、盾、破布）
// 最后从上方落下；眼火（eye）最后点亮。
// 只改这些网格自己的位置、朝向和显隐，不碰材质（不换材质、不改透明度，不会触发着色器编译）；
// restore() 把每块网格的位置、朝向、显隐写回建模时的原值，阴影代理一并恢复。

import { Quaternion, Vector3, type Mesh, type Object3D } from 'three';
import { SKELETON_PART } from '../../assets/models/characters/skeleton';

/** 骨头部件按什么顺序拼上 */
export type BonePart = 'spine' | 'ribs' | 'skull' | 'arms' | 'legs';

interface Piece {
  mesh: Mesh;
  part: BonePart;
  /** 同一部件里的第几块（错开一点点时间） */
  order: number;
  basePos: Vector3;
  baseQuat: Quaternion;
  baseVisible: boolean;
  /** 几何中心（网格自己的坐标） */
  center: Vector3;
  /** 飞行的起点（世界坐标，每次召唤重新抽） */
  from: Vector3;
  axis: Vector3;
}

interface Simple {
  mesh: Object3D;
  basePos: Vector3;
  baseQuat: Quaternion;
  baseVisible: boolean;
  center: Vector3;
}

/** 关节名（joint:<名字>）→ 部件 */
function partOf(node: Object3D | null): BonePart {
  const name = node?.name ?? '';
  if (/joint:(hipL|hipR)$/.test(name)) return 'legs';
  if (/joint:(shoulder|elbow|hand)/.test(name)) return 'arms';
  if (/joint:head$/.test(name)) return 'skull';
  if (/joint:(chest|neck|cape)$/.test(name)) return 'ribs';
  return 'spine'; // 模型根（骨盆）、spine
}

function materialName(mesh: Mesh): string {
  const m = mesh.material;
  return Array.isArray(m) ? (m[0]?.name ?? '') : m.name;
}

/** 阴影代理（只在阴影图层、画面里不画，见 optimize.ts）：拼合期间藏起来，否则地上会提前出现完整的影子 */
function isShadowProxy(mesh: Mesh): boolean {
  return mesh.userData['shadowProxied'] === true && !mesh.layers.isEnabled(0);
}

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();
const UP = new Vector3(0, 1, 0);

export interface AssemblyTiming {
  parts: Record<string, number>;
  stagger: number;
  fly: number;
  arc: number;
  tumble: number;
  gearAt: number;
  gearFall: number;
  drop: number;
  eyesAt: number;
}

export class BoneAssembly {
  private readonly bones: Piece[] = [];
  private readonly gear: Simple[] = [];
  private readonly eyes: Simple[] = [];
  private readonly proxies: { mesh: Object3D; visible: boolean }[] = [];
  private touched = false;

  constructor(private readonly model: Object3D) {
    const counts: Record<string, number> = {};
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if (isShadowProxy(mesh)) {
        this.proxies.push({ mesh, visible: mesh.visible });
        return;
      }
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const base = {
        mesh,
        basePos: mesh.position.clone(),
        baseQuat: mesh.quaternion.clone(),
        baseVisible: mesh.visible,
        center: mesh.geometry.boundingSphere ? mesh.geometry.boundingSphere.center.clone() : new Vector3(),
      };
      const name = materialName(mesh);
      if (name === SKELETON_PART.bone) {
        const part = partOf(mesh.parent);
        const order = (counts[part] = (counts[part] ?? -1) + 1);
        this.bones.push({ ...base, part, order, from: new Vector3(), axis: new Vector3(1, 0, 0) });
      } else if (name === SKELETON_PART.eye) {
        this.eyes.push(base);
      } else {
        this.gear.push(base);
      }
    });
  }

  /** 测试 / 调试：各类部件的块数 */
  get counts(): { bones: number; gear: number; eyes: number; parts: Record<BonePart, number> } {
    const parts = { spine: 0, ribs: 0, skull: 0, arms: 0, legs: 0 } as Record<BonePart, number>;
    for (const b of this.bones) parts[b.part] += 1;
    return { bones: this.bones.length, gear: this.gear.length, eyes: this.eyes.length, parts };
  }

  /** 眼火当前是否点亮（全部眼睛网格显示） */
  get eyesLit(): boolean {
    return this.eyes.length > 0 && this.eyes.every((e) => e.mesh.visible);
  }

  /** 已经拼到原位的骨头块数 */
  get bonesInPlace(): number {
    return this.bones.filter((b) => b.mesh.visible && b.mesh.position.equals(b.basePos) && b.mesh.quaternion.equals(b.baseQuat)).length;
  }

  /** 第一次显示时的状态：骨头、盔甲、眼火全部藏起来；随机抽每块骨头的起点（地下、阵位周围） */
  begin(slot: { x: number; z: number }, scatter: { min: number; max: number }, depth: number, random: () => number): void {
    this.restore();
    this.touched = true;
    for (const b of this.bones) {
      const a = random() * Math.PI * 2;
      const r = scatter.min + (scatter.max - scatter.min) * random();
      b.from.set(slot.x + Math.cos(a) * r, -depth, slot.z + Math.sin(a) * r);
      b.axis.set(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      if (b.axis.lengthSq() === 0) b.axis.set(1, 0, 0);
      b.mesh.visible = false;
    }
    for (const g of [...this.gear, ...this.eyes]) g.mesh.visible = false;
    for (const p of this.proxies) p.mesh.visible = false;
  }

  /**
   * 按这只骷髅兵开始出场后的时间 time（秒）摆好每一块：还没开始飞的藏着，飞行中的沿弧线从起点飞向原位
   * （原位按当前关节的世界变换算，身体在动也能对准），到位后写回原值。
   * @returns 这一帧刚刚落位的盔甲块数、刚刚点亮的眼睛（给调用方放尘土 / 火光）
   */
  pose(time: number, c: AssemblyTiming): { gearLanded: boolean; eyesLit: boolean } {
    this.model.updateMatrixWorld(true);
    for (const b of this.bones) {
      const start = (c.parts[b.part] ?? 0) + b.order * c.stagger;
      const u = (time - start) / c.fly;
      if (u <= 0) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.visible = b.baseVisible;
      if (u >= 1) {
        b.mesh.position.copy(b.basePos);
        b.mesh.quaternion.copy(b.baseQuat);
        continue;
      }
      const e = 1 - (1 - u) ** 3;
      // 原位的几何中心（世界坐标）
      const parent = b.mesh.parent!;
      const restCenter = tmpV.copy(b.center).applyQuaternion(b.baseQuat).add(b.basePos);
      parent.localToWorld(restCenter);
      // 弧线：从地下冒出、往上飞起再落到身上
      const p = tmpV2.copy(b.from).lerp(restCenter, e).addScaledVector(UP, c.arc * Math.sin(Math.PI * u));
      parent.worldToLocal(p);
      // 绕几何中心翻转，落位时归零
      b.mesh.quaternion.copy(b.baseQuat).multiply(tmpQ.setFromAxisAngle(b.axis, c.tumble * (1 - e)));
      b.mesh.position.copy(p).sub(tmpV.copy(b.center).applyQuaternion(b.mesh.quaternion));
    }
    // 盔甲、武器、破布：从上方落下
    let gearLanded = false;
    const g = (time - c.gearAt) / c.gearFall;
    for (const s of this.gear) {
      if (g <= 0) {
        s.mesh.visible = false;
        continue;
      }
      s.mesh.visible = s.baseVisible;
      if (g >= 1) {
        if (!s.mesh.position.equals(s.basePos)) gearLanded = true;
        s.mesh.position.copy(s.basePos);
        s.mesh.quaternion.copy(s.baseQuat);
        continue;
      }
      const parent = s.mesh.parent!;
      const fall = c.drop * (1 - g * g);
      const at = tmpV.copy(s.basePos);
      parent.localToWorld(at);
      at.y += fall;
      parent.worldToLocal(at);
      s.mesh.position.copy(at);
      s.mesh.quaternion.copy(s.baseQuat);
    }
    if (g >= 1) for (const p of this.proxies) p.mesh.visible = p.visible;
    // 眼火
    let eyesLit = false;
    const lit = time >= c.eyesAt;
    for (const e of this.eyes) {
      if (lit && !e.mesh.visible) eyesLit = true;
      e.mesh.visible = lit && e.baseVisible;
    }
    return { gearLanded, eyesLit };
  }

  /** 眼睛的世界坐标（点亮时放火光用） */
  eyePositions(): Vector3[] {
    this.model.updateMatrixWorld(true);
    return this.eyes.map((e) => e.mesh.localToWorld(e.center.clone()));
  }

  /** 每块网格写回建模时的位置、朝向、显隐，阴影代理恢复 */
  restore(): void {
    if (!this.touched) return;
    this.touched = false;
    for (const b of [...this.bones, ...this.gear, ...this.eyes]) {
      b.mesh.position.copy(b.basePos);
      b.mesh.quaternion.copy(b.baseQuat);
      b.mesh.visible = b.baseVisible;
    }
    for (const p of this.proxies) p.mesh.visible = p.visible;
  }

  /** 测试：是否每块都在原值 */
  isRestored(): boolean {
    return [...this.bones, ...this.gear, ...this.eyes].every(
      (b) => b.mesh.position.equals(b.basePos) && b.mesh.quaternion.equals(b.baseQuat) && b.mesh.visible === b.baseVisible,
    ) && this.proxies.every((p) => p.mesh.visible === p.visible);
  }
}

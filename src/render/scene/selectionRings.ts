// 地面光圈：标出当前待下令的单位、可选目标、以及这次出手会命中的全部目标。
// 每个单位脚下预先放一个圆环，平时隐藏；界面层通过 set() 决定谁亮、什么颜色。
// 几何体程序化生成，不使用外部素材。

import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { UnitId, UnitTemplate } from '../../core/types';
import { slotPosition } from '../../data/formation';
import { SELECTION_CONFIG } from '../../data/uiConfig';

/** 光圈状态：commander = 待下令单位；candidate = 可选；target = 会被命中；primary = 鼠标指着的主目标 */
export type RingState = keyof typeof SELECTION_CONFIG.opacity;

export interface RingMark {
  state: RingState;
  color: number;
}

interface Ring {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  mark: RingMark | null;
  phase: number;
}

export class SelectionRings {
  readonly group = new Group();
  private readonly rings = new Map<UnitId, Ring>();

  constructor(templates: readonly UnitTemplate[]) {
    this.group.name = 'selectionRings';
    const c = SELECTION_CONFIG;
    for (const t of templates) {
      const radius = t.rank === 'boss' ? c.ringRadius.boss : c.ringRadius[t.kind];
      const half = (radius * c.ringWidth) / 2;
      const geometry = new RingGeometry(radius - half, radius + half, 56);
      const material = new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      });
      const mesh = new Mesh(geometry, material);
      const pos = slotPosition(t.side, t.slot);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pos.x, c.ringHeight, pos.z);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.rings.set(t.id, { mesh, mark: null, phase: t.slot.col * 0.6 });
    }
  }

  /** 设置要显示的光圈；不在表里的单位全部熄灭 */
  set(marks: ReadonlyMap<UnitId, RingMark>): void {
    for (const [id, ring] of this.rings) {
      const mark = marks.get(id) ?? null;
      ring.mark = mark;
      ring.mesh.visible = mark !== null;
      if (mark) {
        ring.mesh.material.color.setHex(mark.color);
        ring.mesh.scale.setScalar(mark.state === 'primary' ? 1.08 : 1);
      }
    }
  }

  /** 全部熄灭（离开战斗时） */
  clear(): void {
    this.set(new Map());
  }

  /** 正在显示的光圈数（残留检查） */
  get visibleCount(): number {
    let n = 0;
    for (const ring of this.rings.values()) if (ring.mesh.visible) n += 1;
    return n;
  }

  /** 每帧调用：呼吸闪烁（time 为真实时间，不随战斗倍速变化） */
  update(time: number): void {
    const c = SELECTION_CONFIG;
    for (const ring of this.rings.values()) {
      if (!ring.mark) continue;
      const o = c.opacity[ring.mark.state];
      ring.mesh.material.opacity = o.base + o.pulse * Math.sin(time * c.pulseSpeed + ring.phase);
    }
  }

  dispose(): void {
    for (const ring of this.rings.values()) {
      ring.mesh.geometry.dispose();
      ring.mesh.material.dispose();
    }
  }
}

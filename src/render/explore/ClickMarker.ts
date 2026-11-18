// 点击标记（步骤 15）：在队长要去的地面位置显示一圈暗金色光圈，从小扩开、淡出。
// 几何体程序化生成；同一时刻只有一个标记，再次点击时从头播放。不显示时 visible = false，不产生绘制调用。

import { AdditiveBlending, CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { EXPLORE_CONFIG } from '../../data/exploreConfig';

export class ClickMarker {
  readonly group = new Group();
  private readonly ring: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly disc: Mesh<CircleGeometry, MeshBasicMaterial>;
  /** 播放进度（秒）；< 0 = 不显示 */
  private t = -1;

  constructor(private readonly cfg = EXPLORE_CONFIG.clickMarker) {
    this.group.name = 'clickMarker';
    const mat = (): MeshBasicMaterial =>
      new MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      });
    // 单位半径的环，按 radius 缩放
    this.ring = new Mesh(new RingGeometry(1 - cfg.width, 1, 48), mat());
    this.disc = new Mesh(new CircleGeometry(1 - cfg.width, 32), mat());
    for (const m of [this.ring, this.disc]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 2;
      this.group.add(m);
    }
    this.group.position.y = 0.03;
    this.group.visible = false;
  }

  /** 在 (x, z) 显示（从头播放） */
  show(x: number, z: number): void {
    this.group.position.set(x, 0.03, z);
    this.t = 0;
    this.group.visible = true;
    this.apply();
  }

  /** 立即隐藏 */
  hide(): void {
    this.t = -1;
    this.group.visible = false;
  }

  /** 是否正在显示（调试 / 测试） */
  get active(): boolean {
    return this.t >= 0;
  }

  /** 推进（场景时间，秒） */
  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t >= this.cfg.duration) {
      this.hide();
      return;
    }
    this.apply();
  }

  private apply(): void {
    const c = this.cfg;
    const k = Math.min(1, this.t / c.duration);
    const grow = 1 - (1 - k) * (1 - k) * (1 - k); // 先快后慢地扩开
    const s = c.radius * (c.startScale + (1 - c.startScale) * grow);
    this.group.scale.set(s, 1, s);
    // 开头 10% 淡入，之后淡出
    const fade = k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9;
    this.ring.material.opacity = c.opacity * fade;
    this.disc.material.opacity = c.opacity * 0.18 * fade * (1 - k);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.disc.geometry.dispose();
    this.disc.material.dispose();
  }
}

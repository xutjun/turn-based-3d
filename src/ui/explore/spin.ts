// 3D 预览的拖拽旋转（步骤 21，DESIGN §12.4）：纯计算，可单元测试。
// 左键拖拽：水平位移 × dragRadPerPx = 绕竖直轴旋转，可无限转（360 度）；
// 松开后按松手前的角速度继续转一小段，按指数衰减停下（轻微惯性）。

import { PREVIEW_CONFIG } from '../../data/uiConfig';

export interface SpinConfig {
  dragRadPerPx: number;
  /** 惯性衰减率（每秒）：速度 × e^(−decay·t) */
  inertiaDecay: number;
  /** 松手时的最大角速度（弧度 / 秒） */
  maxSpin: number;
  /** 低于这个角速度就停下 */
  minSpin: number;
  /** 松手前这么久（秒）没有移动，视为停住再松手：没有惯性 */
  releaseHold: number;
}

export class Spin {
  /** 当前朝向（弧度，0 = 正面朝镜头） */
  yaw = 0;
  /** 当前角速度（弧度 / 秒，只在松手后的惯性阶段非 0） */
  velocity = 0;
  private dragging = false;
  private lastX = 0;
  private lastT = 0;
  /** 拖拽中估计的角速度（平滑过） */
  private dragVelocity = 0;

  constructor(private readonly config: SpinConfig = PREVIEW_CONFIG.spin) {}

  get isDragging(): boolean {
    return this.dragging;
  }

  /** 回到正面、停住（每次打开面板时） */
  reset(): void {
    this.yaw = 0;
    this.velocity = 0;
    this.dragVelocity = 0;
    this.dragging = false;
  }

  /** 按下：停掉惯性，开始跟手 */
  begin(x: number, t: number): void {
    this.dragging = true;
    this.velocity = 0;
    this.dragVelocity = 0;
    this.lastX = x;
    this.lastT = t;
  }

  /** 拖动到 x（像素），t 为时刻（秒） */
  move(x: number, t: number): void {
    if (!this.dragging) return;
    const delta = (x - this.lastX) * this.config.dragRadPerPx;
    this.yaw += delta;
    const dt = t - this.lastT;
    if (dt > 1e-4) {
      const v = delta / dt;
      // 指数平滑：抖动的单帧不会给出夸张的速度
      this.dragVelocity = this.dragVelocity * 0.5 + v * 0.5;
    }
    this.lastX = x;
    this.lastT = t;
  }

  /** 松开：按最后的速度进入惯性（停住一会儿再松手则没有惯性） */
  end(t: number): void {
    if (!this.dragging) return;
    this.dragging = false;
    const held = t - this.lastT > this.config.releaseHold;
    const max = this.config.maxSpin;
    this.velocity = held ? 0 : Math.max(-max, Math.min(max, this.dragVelocity));
    if (Math.abs(this.velocity) < this.config.minSpin) this.velocity = 0;
  }

  /** 推进 dt 秒的惯性 */
  step(dt: number): void {
    if (this.dragging || this.velocity === 0 || dt <= 0) return;
    // 解析积分：∫v·e^(−k·t) dt，与帧率无关
    const k = this.config.inertiaDecay;
    const decay = Math.exp(-k * dt);
    this.yaw += (this.velocity * (1 - decay)) / k;
    this.velocity *= decay;
    if (Math.abs(this.velocity) < this.config.minSpin) this.velocity = 0;
  }
}

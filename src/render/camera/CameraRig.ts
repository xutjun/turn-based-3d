// 演出镜头：出手时轻微推近并朝关注点平移、旋风斩时跟随、受击时抖动，结束后复位。
// 推近 / 平移 / 复位走 Scheduler（随倍速缩放、可被跳过）；抖动按真实时间衰减，顿帧期间也会继续抖。
// 实现 director/types.ts 的 StageCamera 接口。

import { CAMERA_FX } from '../../data/presentationConfig';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { GroundPoint, StageCamera } from '../director/types';
import type { BattleCamera } from './battleCamera';

export class CameraRig implements StageCamera {
  private panX = 0;
  private panZ = 0;
  private zoom = 1;
  private trauma = 0; // 当前抖动幅度（米）
  private clock = 0;
  private move = 0; // 最近一次镜头移动的编号：新的移动开始后，旧的不再生效
  private applied = false;

  constructor(
    private readonly battleCamera: BattleCamera,
    private readonly scheduler: Scheduler,
  ) {}

  /** 朝地面上的某点平移 pan 比例，并推近到 zoom 倍 */
  focus(point: GroundPoint, zoom: number, pan: number, duration: number): Promise<void> {
    const base = this.battleCamera.target;
    return this.glide((point.x - base.x) * pan, (point.z - base.z) * pan, zoom, duration);
  }

  /** 回到原始机位 */
  reset(duration: number): Promise<void> {
    return this.glide(0, 0, 1, duration);
  }

  /** 抖动一下：amount 为幅度（米），多次抖动取最大的 */
  shake(amount: number): void {
    if (this.scheduler.skip) return;
    this.trauma = Math.max(this.trauma, amount);
  }

  /** 立即回到原始机位并停止抖动（再战一次、重置演示时调用） */
  resetNow(): void {
    this.move += 1;
    this.panX = this.panZ = 0;
    this.zoom = 1;
    this.trauma = 0;
    this.battleCamera.setView(0, 0, 1, 0, 0);
    this.applied = false;
  }

  /** 每帧调用：realDt 为真实经过的秒数 */
  update(realDt: number): void {
    if (this.scheduler.skip) this.trauma = 0;
    this.clock += realDt;
    this.trauma *= Math.exp(-realDt * CAMERA_FX.shakeDecay);
    if (this.trauma < 0.002) this.trauma = 0;
    const idle = this.panX === 0 && this.panZ === 0 && this.zoom === 1 && this.trauma === 0;
    // 镜头在原位且不抖动时不必每帧重算
    if (idle && !this.applied) return;
    const t = this.clock;
    const sx = this.trauma * (Math.sin(t * 71.3) * 0.6 + Math.sin(t * 43.7 + 1.3) * 0.4);
    const sy = this.trauma * (Math.sin(t * 59.9 + 2.1) * 0.6 + Math.sin(t * 37.1 + 0.4) * 0.4);
    this.battleCamera.setView(this.panX, this.panZ, this.zoom, sx, sy);
    this.applied = !idle;
  }

  private glide(panX: number, panZ: number, zoom: number, duration: number): Promise<void> {
    const id = (this.move += 1);
    const fromX = this.panX;
    const fromZ = this.panZ;
    const fromZoom = this.zoom;
    return this.scheduler.tween(
      duration,
      (t) => {
        if (id !== this.move) return;
        this.panX = fromX + (panX - fromX) * t;
        this.panZ = fromZ + (panZ - fromZ) * t;
        this.zoom = fromZoom + (zoom - fromZoom) * t;
      },
      EASE.inOut,
    );
  }
}

// 粒子池：场上所有技能粒子共用一个 Points 对象和一组定长数组，一次绘制调用。
// 粒子出生 / 死亡只是在数组里挪位置，不创建任何对象，避免垃圾回收造成的卡顿。

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  Vector2,
  type Color,
  type Texture,
} from 'three';

const VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aCell;
  uniform float uScale;
  varying vec3 vColor;
  varying float vCell;
  void main() {
    vColor = aColor;
    vCell = aCell;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // aSize 是世界里的直径（米）：透视相机按距离缩小，正交相机不变
    bool perspective = projectionMatrix[2][3] == -1.0;
    gl_PointSize = aSize * uScale * projectionMatrix[1][1] * (perspective ? 1.0 / -mv.z : 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vCell;
  void main() {
    // 图集 2×2：按格子编号取对应的四分之一
    vec2 cell = vec2(mod(vCell, 2.0), floor(vCell * 0.5));
    vec2 uv = vec2((cell.x + gl_PointCoord.x) * 0.5, 1.0 - (cell.y + gl_PointCoord.y) * 0.5);
    float a = texture2D(uMap, uv).a;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class ParticlePool {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  /** 当前存活的粒子数 */
  count = 0;
  /** 出现过的最大粒子数（性能自检用） */
  peak = 0;

  // 显卡需要的数据
  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private readonly size: Float32Array;
  private readonly cell: Float32Array;
  // 只在 CPU 上用的模拟数据
  private readonly velocity: Float32Array;
  private readonly base: Float32Array; // 基础颜色（已乘亮度）
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly grow: Float32Array; // 寿命内直径的增长比例
  private readonly gravity: Float32Array; // 向下的加速度（负值 = 向上飘）
  private readonly drag: Float32Array; // 速度衰减
  private readonly attributes: BufferAttribute[];
  private readonly bufferSize = new Vector2();
  private dirty = false;

  /**
   * @param capacity 粒子上限
   * @param atlas 粒子图集贴图（2×2，见 assets/textures/fxTextures.ts 的 particleAtlasTexture）
   */
  constructor(
    readonly capacity: number,
    atlas: Texture,
  ) {
    const n = capacity;
    this.position = new Float32Array(n * 3);
    this.color = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    this.cell = new Float32Array(n);
    this.velocity = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.drag = new Float32Array(n);

    const geometry = new BufferGeometry();
    const attr = (name: string, array: Float32Array, itemSize: number): BufferAttribute => {
      const a = new BufferAttribute(array, itemSize);
      a.setUsage(DynamicDrawUsage);
      geometry.setAttribute(name, a);
      return a;
    };
    this.attributes = [
      attr('position', this.position, 3),
      attr('aColor', this.color, 3),
      attr('aSize', this.size, 1),
      attr('aCell', this.cell, 1),
    ];
    geometry.setDrawRange(0, 0);

    const material = new ShaderMaterial({
      uniforms: { uMap: { value: atlas }, uScale: { value: 400 } },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.points = new Points(geometry, material);
    this.points.name = 'fxParticles';
    this.points.frustumCulled = false; // 粒子位置每帧变化，不做视锥剔除
    this.points.renderOrder = 5;
    // 点的像素大小取决于画面高度
    this.points.onBeforeRender = (renderer) => {
      material.uniforms['uScale']!.value = renderer.getDrawingBufferSize(this.bufferSize).y / 2;
    };
  }

  /** 生成一个粒子；池满时丢弃（宁可少几个粒子，也不分配新内存） */
  spawn(
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
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const i3 = i * 3;
    this.position[i3] = x;
    this.position[i3 + 1] = y;
    this.position[i3 + 2] = z;
    this.velocity[i3] = vx;
    this.velocity[i3 + 1] = vy;
    this.velocity[i3 + 2] = vz;
    this.base[i3] = color.r * brightness;
    this.base[i3 + 1] = color.g * brightness;
    this.base[i3 + 2] = color.b * brightness;
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = size;
    this.size[i] = size;
    this.cell[i] = cell;
    this.gravity[i] = gravity;
    this.drag[i] = drag;
    this.grow[i] = grow;
    if (this.count > this.peak) this.peak = this.count;
  }

  /** 每帧推进全部粒子 */
  update(dt: number): void {
    if (this.count === 0 && !this.dirty) return;
    const { position, velocity, color, base, age, life } = this;
    let i = 0;
    while (i < this.count) {
      const t = (age[i] = age[i]! + dt) / life[i]!;
      if (t >= 1) {
        this.remove(i);
        continue; // 末尾的粒子被换到了 i，这一格要重新处理
      }
      const i3 = i * 3;
      const damp = Math.max(0, 1 - this.drag[i]! * dt);
      velocity[i3] = velocity[i3]! * damp;
      velocity[i3 + 1] = (velocity[i3 + 1]! - this.gravity[i]! * dt) * damp;
      velocity[i3 + 2] = velocity[i3 + 2]! * damp;
      position[i3] = position[i3]! + velocity[i3]! * dt;
      position[i3 + 1] = position[i3 + 1]! + velocity[i3 + 1]! * dt;
      position[i3 + 2] = position[i3 + 2]! + velocity[i3 + 2]! * dt;
      // 亮度：很快亮起，然后逐渐熄灭
      const fade = Math.min(1, t * 10) * (1 - t) * (1 - t * 0.5);
      color[i3] = base[i3]! * fade;
      color[i3 + 1] = base[i3 + 1]! * fade;
      color[i3 + 2] = base[i3 + 2]! * fade;
      this.size[i] = this.size0[i]! * (1 + this.grow[i]! * t);
      i++;
    }
    for (const a of this.attributes) a.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.count);
    this.dirty = this.count > 0;
  }

  /** 立即清空（跳过动画、再战一次时） */
  clear(): void {
    this.count = 0;
    this.dirty = true;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }

  /** 删除第 i 个粒子：把最后一个粒子挪过来补位 */
  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    const i3 = i * 3;
    const l3 = last * 3;
    for (let k = 0; k < 3; k++) {
      this.position[i3 + k] = this.position[l3 + k]!;
      this.velocity[i3 + k] = this.velocity[l3 + k]!;
      this.base[i3 + k] = this.base[l3 + k]!;
    }
    this.age[i] = this.age[last]!;
    this.life[i] = this.life[last]!;
    this.size0[i] = this.size0[last]!;
    this.cell[i] = this.cell[last]!;
    this.gravity[i] = this.gravity[last]!;
    this.drag[i] = this.drag[last]!;
    this.grow[i] = this.grow[last]!;
  }
}

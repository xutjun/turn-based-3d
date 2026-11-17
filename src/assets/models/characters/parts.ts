// 拼装角色用的小部件：肢体段、方块、球、旋转体、披风、长袍下摆、兜帽等。
// 所有部件默认投射和接收阴影。

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  ConeGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  OctahedronGeometry,
  Quaternion,
  Mesh,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** 飘动权重的顶点属性名（配合 materials.ts 的布料飘动着色器） */
export const SWAY_ATTR = 'aSway';
export const SWAY_DIR_ATTR = 'aSwayDir';
/** 袍摆的飘动比披风克制：下沿的权重上限 */
const SKIRT_SWAY = 0.5;
/**
 * 跟着迈步的权重（步骤 14，配合 materials.ts 的 uSwayStride）：袍摆、裙甲、战袍、腰间挂件挂在髋部，
 * 腿往前迈时膝盖把前片顶开，往后蹬时脚跟把后片顶开——只在腿碰到布料时推开刚好那么多。
 * 四个分量（在髋部坐标里算好，与网格合并与否无关）：
 *   x = 深度：顶点在髋下方的深度 ÷ 髋高（腰部 0，地面 1），着色器据此在“髋 → 膝 → 踝”之间插出这个高度上腿的前后位置；
 *   y / w = 在不在左腿 / 右腿的正前 / 正后方（离那条腿的横向距离越远越小，侧面的布料不被推）；
 *   z = 顶点在髋部坐标里的前后位置（米）：前片只会被往前顶，后片只会被往后顶。
 * 着色器对两条腿各算一次推开量，前片取更靠前的，后片取更靠后的（中线附近的布料被迈出的那条腿顶开，不会对半削弱）。
 */
export const STRIDE_ATTR = 'aStride';

/**
 * 给挂在髋部（hips）下面的所有网格写入“跟着迈步”的权重；exclude 里的子树（两条腿、上半身）跳过。
 * 只给会走路的人形调用（在合并网格之前）：没有这个属性的网格权重为 0，不受影响。
 */
export function addHipStrideWeights(hips: Object3D, exclude: readonly Object3D[], legLength: number, legX: number): void {
  const skip = new Set(exclude);
  const done = new Set<BufferGeometry>();
  const rel = new Matrix4();
  const v = new Vector3();
  const visit = (o: Object3D): void => {
    if (skip.has(o)) return;
    const m = o as Mesh;
    if (m.isMesh && m.geometry.getAttribute('position')) {
      // 网格相对髋部的变换
      rel.identity();
      for (let n: Object3D | null = m; n && n !== hips; n = n.parent) {
        n.updateMatrix();
        rel.premultiply(n.matrix);
      }
      // 几何体被别的网格共用（铆钉之类）时复制一份，各自写自己的权重
      if (done.has(m.geometry)) m.geometry = m.geometry.clone();
      const geo = m.geometry;
      done.add(geo);
      const pos = geo.getAttribute('position') as BufferAttribute;
      const w = new Float32Array(pos.count * 4);
      const ramp = (t: number): number => {
        const k = Math.max(0, Math.min(1, t));
        return k * k * (3 - 2 * k);
      };
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(rel);
        const depth = Math.max(0, Math.min(1, -v.y / legLength));
        // 离左腿（+x）/ 右腿（−x）的横向距离：12 厘米以内算“正对着腿”，到 24 厘米降为 0
        const inLine = (legCenter: number): number => 1 - ramp((Math.abs(v.x - legCenter) - 0.12) / 0.12);
        w[i * 4] = depth;
        w[i * 4 + 1] = inLine(legX);
        w[i * 4 + 2] = v.z;
        w[i * 4 + 3] = inLine(-legX);
      }
      geo.setAttribute(STRIDE_ATTR, new BufferAttribute(w, 4));
    }
    for (const c of o.children) visit(c);
  };
  for (const c of hips.children) visit(c);
}

export function mesh(geometry: BufferGeometry, material: Material, parent?: Object3D): Mesh {
  const m = new Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  parent?.add(m);
  return m;
}

/** 肢体段：从关节原点沿 −y 延伸 len 的锥形圆柱（硬质护甲用） */
export function seg(
  parent: Object3D,
  material: Material,
  len: number,
  rTop: number,
  rBottom: number,
  radial = 10,
): Mesh {
  const m = mesh(new CylinderGeometry(rTop, rBottom, len, radial, 1), material, parent);
  m.position.y = -len / 2;
  return m;
}

/** 肢体段：胶囊（布料、皮革包裹的肢体用，两端圆润） */
export function softSeg(parent: Object3D, material: Material, len: number, radius: number): Mesh {
  const m = mesh(new CapsuleGeometry(radius, Math.max(0.01, len - radius * 2), 4, 10), material, parent);
  m.position.y = -len / 2;
  return m;
}

export function box(
  parent: Object3D,
  material: Material,
  w: number,
  h: number,
  d: number,
  x = 0,
  y = 0,
  z = 0,
): Mesh {
  const m = mesh(new BoxGeometry(w, h, d), material, parent);
  m.position.set(x, y, z);
  return m;
}

/** 球（可按三个方向缩放成椭球） */
export function ball(
  parent: Object3D,
  material: Material,
  radius: number,
  x = 0,
  y = 0,
  z = 0,
  scale: [number, number, number] = [1, 1, 1],
): Mesh {
  const m = mesh(new SphereGeometry(radius, 16, 12), material, parent);
  m.position.set(x, y, z);
  m.scale.set(...scale);
  return m;
}

/** 旋转体：profile 为 [半径, 高度] 的折线，绕 y 轴旋转成型 */
export function lathe(
  parent: Object3D,
  material: Material,
  profile: [number, number][],
  segments = 16,
): Mesh {
  // LatheGeometry 要求轮廓从低到高排列，法线才会朝外；这里统一处理，调用方不用关心顺序
  const first = profile[0]!;
  const last = profile[profile.length - 1]!;
  const ordered = first[1] <= last[1] ? profile : [...profile].reverse();
  return mesh(new LatheGeometry(ordered.map(([r, y]) => new Vector2(r, y)), segments), material, parent);
}

/** 圆环（腰带、箍、光环） */
export function ring(
  parent: Object3D,
  material: Material,
  radius: number,
  tube: number,
  y = 0,
  radial = 6,
  tubular = 20,
): Mesh {
  const m = mesh(new TorusGeometry(radius, tube, radial, tubular), material, parent);
  m.rotation.x = Math.PI / 2;
  m.position.y = y;
  return m;
}

/**
 * 肩甲：封闭的椭球甲片（不留开口，避免从下方看到破面），可压扁或拉宽。
 */
export function pauldron(
  parent: Object3D,
  material: Material,
  radius: number,
  scale: [number, number, number] = [1, 1, 1],
): Mesh {
  const m = mesh(new SphereGeometry(radius, 14, 10), material, parent);
  m.scale.set(...scale);
  return m;
}

/**
 * 披风：细分平面，顶边挂在后背，向下逐渐变宽并向后鼓出，左右向前裹住肩背。
 * 原点在顶边中点，向 −y 垂下、向 −z 飘出；需要双面材质。顶点按行排列，步骤 5 可以逐行摆动。
 */
export interface ClothShape {
  topWidth: number;
  bottomWidth: number;
  length: number;
  wrap?: number; // 两侧向前弯的程度
  flare?: number; // 下摆向后飘出的程度（负值 = 向前）
  folds?: number; // 竖向褶皱的条数（0 = 只有细微的起伏）
  foldDepth?: number; // 褶皱深度（米），越往下摆越深
}

export function capeMesh(parent: Object3D, material: Material, opts: ClothShape): Mesh {
  return mesh(clothGeometry(opts), material, parent);
}

/**
 * 披风/布片的几何体（见 capeMesh）。
 * @param range 只生成整块布的一段（0 = 顶边，1 = 下摆），用来在同一个曲面上贴镶边
 * @param offset 沿 −z（布的外侧）偏移一点，避免镶边和布面重叠闪烁
 */
export function clothGeometry(opts: ClothShape, range: [number, number] = [0, 1], offset = 0): BufferGeometry {
  const folds = opts.folds ?? 0;
  const foldDepth = opts.foldDepth ?? 0.03;
  const segX = folds > 0 ? Math.min(28, folds * 4) : 8;
  const segY = Math.max(1, Math.round(12 * (range[1] - range[0])));
  const geo = new PlaneGeometry(1, 1, segX, segY);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const wrap = opts.wrap ?? 0.1;
  const flare = opts.flare ?? 0.22;
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i); // −0.5 ~ 0.5
    const t = range[0] + (range[1] - range[0]) * (0.5 - pos.getY(i)); // 0 = 顶边，1 = 下摆
    const width = opts.topWidth + (opts.bottomWidth - opts.topWidth) * t;
    const x = u * width;
    // 两侧向前弯（裹住肩背），越往下越向后飘
    let z = wrap * (4 * u * u) - flare * t * t - 0.02 * Math.sin(u * 14 + t * 5) * t;
    // 竖向褶皱：顶边收拢处几乎没有，越往下越深
    if (folds > 0) z += foldDepth * Math.sin(u * folds * Math.PI * 2 + 0.6) * (0.25 + 0.75 * t);
    pos.setXYZ(i, x, -t * opts.length, z - offset);
    sway[i] = Math.pow(t, 1.4); // 飘动权重：顶边（挂点）不动，越往下摆越大
  }
  geo.setAttribute(SWAY_ATTR, new BufferAttribute(sway, 1));
  geo.computeVertexNormals();
  return geo;
}

/**
 * 披风镶边：贴在同一块披风曲面上的一条横带（from、to 为沿长度方向的位置，0 = 顶边，1 = 下摆）。
 * 放在与披风相同的位置即可严丝合缝。
 */
export function capeTrim(
  parent: Object3D,
  material: Material,
  shape: ClothShape,
  from: number,
  to: number,
  repeat = 1,
): Mesh {
  const m = mesh(clothGeometry(shape, [from, to], 0.006), material, parent);
  if (repeat !== 1) scaleUv(m, repeat, 1);
  return m;
}

/**
 * 长袍下摆：从腰部向下展开的旋转体，带纵向褶皱。原点在腰部，向 −y 延伸。
 */
export function robeSkirt(
  parent: Object3D,
  material: Material,
  opts: { topRadius: number; bottomRadius: number; length: number; folds?: number; depthScale?: number },
): Mesh {
  const rows = 10;
  const profile: Vector2[] = [];
  for (let i = rows; i >= 0; i--) {
    const t = i / rows; // 从下摆到腰部（从低到高），保证法线朝外
    // 先贴身后展开
    const r = opts.topRadius + (opts.bottomRadius - opts.topRadius) * Math.pow(t, 1.35);
    profile.push(new Vector2(r, -t * opts.length));
  }
  const geo = new LatheGeometry(profile, 28);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const folds = opts.folds ?? 9;
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t = -pos.getY(i) / opts.length;
    const ang = Math.atan2(z, x);
    const k = 1 + 0.07 * Math.sin(ang * folds) * t; // 褶皱越往下越深
    pos.setX(i, x * k);
    pos.setZ(i, z * k * (opts.depthScale ?? 0.85));
    sway[i] = SKIRT_SWAY * t * t; // 腰部不动，下沿轻轻鼓动
  }
  geo.setAttribute(SWAY_ATTR, new BufferAttribute(sway, 1));
  geo.computeVertexNormals();
  return mesh(geo, material, parent);
}

/**
 * 兜帽：正面开口的球壳，后上方拉出尖角。原点在头部中心。
 * @param peak 帽尖向后上方拉出的长度
 */
export function hood(
  parent: Object3D,
  material: Material,
  opts: { radius: number; opening?: number; peak?: number },
): Mesh {
  const gap = opts.opening ?? 1.5; // 正面开口的弧度
  const geo = new SphereGeometry(opts.radius, 20, 14, Math.PI / 2 + gap / 2, Math.PI * 2 - gap);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const peak = opts.peak ?? 0.1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // 后上方的顶点向后上拉，形成帽尖；下缘略微外扩垂到肩上
    const back = Math.max(0, -z / opts.radius) * Math.max(0, y / opts.radius + 0.3);
    const drape = Math.max(0, -y / opts.radius);
    pos.setXYZ(i, x * (1 + drape * 0.25), y + back * peak * 0.7 - drape * 0.06, z * (1 + drape * 0.2) - back * peak);
  }
  geo.computeVertexNormals();
  return mesh(geo, material, parent);
}

/** 把二维轮廓拉伸成薄片（盔顶的鳍、圣徽等）。轮廓在 xy 平面，沿 z 拉伸并居中 */
export function extruded(
  parent: Object3D,
  material: Material,
  points: [number, number][],
  depth: number,
): Mesh {
  const shape = new Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return mesh(geo, material, parent);
}

/**
 * 锁链：沿给定的折线路径排一串交替转向的小圆环，合并成一个网格。
 */
export function chain(
  parent: Object3D,
  material: Material,
  path: [number, number, number][],
  linkRadius = 0.022,
): Mesh {
  const parts: BufferGeometry[] = [];
  const link = new TorusGeometry(linkRadius, linkRadius * 0.32, 5, 10);
  let index = 0;
  // 飘动：只有两个点的链是“垂挂”的（上端固定，越往下摆得越大）；多个点的链两端都挂着，只有中段轻轻晃
  const hanging = path.length === 2;
  const total = path.length - 1;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay, az] = path[i]!;
    const [bx, by, bz] = path[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const count = Math.max(1, Math.round(len / (linkRadius * 1.55)));
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      const g = link.clone();
      // 相邻链环互相垂直
      if (index % 2 === 1) g.rotateY(Math.PI / 2);
      // 让链环平面大致沿路径方向
      g.rotateZ(Math.atan2(by - ay, Math.hypot(bx - ax, bz - az)) + Math.PI / 2);
      g.rotateY(-Math.atan2(bz - az, bx - ax));
      g.translate(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
      const along = (i + t) / total;
      const weight = hanging ? along : 0.35 * Math.sin(Math.PI * along);
      const n = g.getAttribute('position').count;
      g.setAttribute(SWAY_ATTR, new BufferAttribute(new Float32Array(n).fill(weight), 1));
      // 链环整体侧向摆动（不是沿各自的法线鼓胀）
      const dir = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) dir.set([0.9, 0, 0.45], v * 3);
      g.setAttribute(SWAY_DIR_ATTR, new BufferAttribute(dir, 3));
      parts.push(g);
      index += 1;
    }
  }
  return mesh(mergeGeometries(parts), material, parent);
}

/**
 * 渐细的弯管：沿一串控制点弯曲，半径从 r0 均匀收到 r1。用来做弯角、尾巴、爪、骨刺。
 */
export function taperedTube(
  parent: Object3D,
  material: Material,
  points: [number, number, number][],
  r0: number,
  r1: number,
  radial = 7,
  steps = 12,
): Mesh {
  const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)));
  const frames = curve.computeFrenetFrames(steps, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const p = new Vector3();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * t;
    const n = frames.normals[i]!;
    const b = frames.binormals[i]!;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      positions.push(p.x + n.x * cx + b.x * cy, p.y + n.y * cx + b.y * cy, p.z + n.z * cx + b.z * cy);
      uvs.push(j / radial, t);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j;
      const c = a + row;
      // 逆时针绕序，法线朝外
      indices.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return mesh(geo, material, parent);
}

/**
 * 翼膜：把二维轮廓做成一张薄片（需要双面材质）。轮廓画在 xy 平面，x 向外、y 向上；
 * 贴图坐标按轮廓的包围盒归一化，v = 0 在下缘，配合破布透明贴图可以得到撕裂的翼缘。
 */
export function membrane(parent: Object3D, material: Material, points: [number, number][]): Mesh {
  const shape = new Shape();
  points.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geo = new ShapeGeometry(shape);
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX || 1;
  const h = Math.max(...ys) - minY || 1;
  const pos = geo.getAttribute('position') as BufferAttribute;
  const uv = geo.getAttribute('uv') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - minX) / w, (pos.getY(i) - minY) / h);
  return mesh(geo, material, parent);
}

// ---------------------------------------------------------------------------
// 步骤 10 新增的细节部件：甲片叠层、铆钉、手甲、靴子、毛领、挂件等。
// 都只生成一个网格（内部先合并几何体），不会明显增加绘制调用。
// ---------------------------------------------------------------------------

/** 缩放一个网格的贴图坐标（让锁子甲、织纹等贴图在小部件上保持合适的疏密） */
export function scaleUv(m: Mesh, su: number, sv = su): Mesh {
  const uv = m.geometry.getAttribute('uv') as BufferAttribute | undefined;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return m;
}

/**
 * 叠层甲片（鱼鳞般一片压一片的甲裙、臂甲、颈甲）：一个带台阶的旋转体。
 * 原点在顶边，向 −y 延伸；每一片的下沿比下一片的上沿略宽，形成层叠的檐口。
 */
export function lames(
  parent: Object3D,
  material: Material,
  opts: { rTop: number; rBottom: number; length: number; count: number; lip?: number; segments?: number },
): Mesh {
  const lip = opts.lip ?? 0.012;
  const pts: [number, number][] = [];
  for (let i = 0; i < opts.count; i++) {
    const t0 = i / opts.count;
    const t1 = (i + 1) / opts.count;
    const r = opts.rTop + (opts.rBottom - opts.rTop) * t0;
    pts.push([r, -t0 * opts.length], [r + lip, -t1 * opts.length]);
  }
  return lathe(parent, material, pts, opts.segments ?? 14);
}

/** 一组铆钉 / 小圆钉：合并成一个网格。points 为各钉的位置 */
export function rivets(parent: Object3D, material: Material, points: [number, number, number][], radius = 0.009): Mesh {
  const base = new IcosahedronGeometry(radius, 0);
  const parts = points.map(([x, y, z]) => base.clone().translate(x, y, z));
  base.dispose();
  return mesh(mergeGeometries(parts), material, parent);
}

/** 绕 y 轴排一圈铆钉（腰带、盔沿、护腕上的钉） */
export function rivetRing(
  parent: Object3D,
  material: Material,
  radius: number,
  count: number,
  y = 0,
  size = 0.009,
  depthScale = 1,
  arc: [number, number] = [0, Math.PI * 2],
): Mesh {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const a = arc[0] + ((i + 0.5) / count) * (arc[1] - arc[0]);
    pts.push([Math.sin(a) * radius, y, Math.cos(a) * radius * depthScale]);
  }
  return rivets(parent, material, pts, size);
}

/** 一组圆锥（尖刺、毛簇、羽毛根）：每项 = 位置 + 朝向 + 底半径 + 长度，合并成一个网格 */
export interface ConeSpec {
  at: [number, number, number];
  dir: [number, number, number]; // 尖端指向
  radius: number;
  length: number;
  flat?: number; // 压扁比例（1 = 圆锥，0.4 = 扁片）
}

export function cones(parent: Object3D, material: Material, list: readonly ConeSpec[], radial = 5): Mesh {
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();
  const m = new Matrix4();
  const parts = list.map((c) => {
    const g = new ConeGeometry(c.radius, c.length, radial);
    g.translate(0, c.length / 2, 0); // 底面在原点
    if (c.flat !== undefined) g.scale(1, 1, c.flat);
    q.setFromUnitVectors(up, new Vector3(...c.dir).normalize());
    g.applyMatrix4(m.makeRotationFromQuaternion(q));
    g.translate(...c.at);
    return g;
  });
  return mesh(mergeGeometries(parts), material, parent);
}

/** 确定性的小随机数（细节部件的位置抖动用，不依赖全局随机） */
export function jitter(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 毛领 / 毛边：绕 y 轴一圈向外下方炸开的毛簇。
 * @param arc 覆盖的角度范围（0 = 正前方 +z，逆时针）
 */
export function furCollar(
  parent: Object3D,
  material: Material,
  opts: {
    radius: number;
    y?: number;
    count?: number;
    length?: number;
    thickness?: number;
    depthScale?: number;
    droop?: number; // 向下垂的程度（0 = 水平炸开，1 = 贴着往下）
    rows?: number;
    seed?: number;
    arc?: [number, number];
  },
): Mesh {
  const rnd = jitter(opts.seed ?? 7);
  const count = opts.count ?? 22;
  const rows = opts.rows ?? 2;
  const len = opts.length ?? 0.09;
  const droop = opts.droop ?? 0.6;
  const [a0, a1] = opts.arc ?? [0, Math.PI * 2];
  const list: ConeSpec[] = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < count; i++) {
      const a = a0 + ((i + (r % 2) * 0.5 + (rnd() - 0.5) * 0.5) / count) * (a1 - a0);
      const rad = opts.radius * (1 - r * 0.12);
      const sx = Math.sin(a);
      const cz = Math.cos(a);
      list.push({
        at: [sx * rad, (opts.y ?? 0) + r * len * 0.35, cz * rad * (opts.depthScale ?? 1)],
        dir: [sx, -droop + (rnd() - 0.5) * 0.5 + r * 0.25, cz],
        radius: (opts.thickness ?? 0.024) * (0.8 + rnd() * 0.5),
        length: len * (0.75 + rnd() * 0.6),
        flat: 0.6,
      });
    }
  }
  return cones(parent, material, list, 4);
}

/** 宝石 / 水晶：八面体 */
export function gem(parent: Object3D, material: Material, radius: number, x = 0, y = 0, z = 0, stretch = 1.3): Mesh {
  const m = mesh(new OctahedronGeometry(radius, 0), material, parent);
  m.position.set(x, y, z);
  m.scale.y = stretch;
  return m;
}

/**
 * 手甲 / 手套：喇叭口护腕 + 手背 + 并拢的四指 + 拇指。挂在 hand 关节上（原点在腕部，手向 −y）。
 * @param cuff 护腕喇叭口的材质（不传则与手同材质）
 */
export function gauntlet(
  hand: Object3D,
  material: Material,
  opts: { cuff?: Material; knuckle?: Material; size?: number; cuffLength?: number; side?: 1 | -1 } = {},
): void {
  const s = opts.size ?? 1;
  const side = opts.side ?? 1;
  const cuffLen = opts.cuffLength ?? 0.07;
  const cuff = mesh(new CylinderGeometry(0.062 * s, 0.046 * s, cuffLen, 10, 1), opts.cuff ?? material, hand);
  cuff.position.y = cuffLen / 2 - 0.01;
  box(hand, material, 0.082 * s, 0.065 * s, 0.05 * s, 0, -0.035 * s, 0); // 手背
  const fingers = box(hand, material, 0.078 * s, 0.05 * s, 0.045 * s, 0, -0.085 * s, 0.012 * s);
  fingers.rotation.x = -0.5; // 四指微屈（握着武器）
  const thumb = box(hand, material, 0.024 * s, 0.05 * s, 0.026 * s, side * -0.045 * s, -0.05 * s, 0.022 * s);
  thumb.rotation.z = side * 0.5;
  if (opts.knuckle) box(hand, opts.knuckle, 0.086 * s, 0.016 * s, 0.054 * s, 0, -0.062 * s, 0.004 * s);
}

/**
 * 靴子：鞋跟 + 脚背 + 鞋尖 + 鞋底，可带翻边靴筒口。挂在 foot 关节上（原点在踝部，脚底在 −0.08 左右）。
 */
export function boot(
  foot: Object3D,
  material: Material,
  opts: { sole?: Material; trim?: Material; width?: number; length?: number; toeUp?: number; cuff?: number } = {},
): void {
  const w = opts.width ?? 0.1;
  const len = opts.length ?? 0.25;
  box(foot, material, w, 0.085, len * 0.5, 0, -0.035, -0.005); // 脚跟到脚背
  const instep = box(foot, material, w * 0.96, 0.07, len * 0.42, 0, -0.03, len * 0.3);
  instep.rotation.x = 0.28; // 脚背向鞋尖下倾
  const toe = ball(foot, material, w * 0.5, 0, -0.052 + (opts.toeUp ?? 0), len * 0.52, [0.96, 0.62, 1.25]);
  toe.rotation.x = -(opts.toeUp ?? 0) * 4;
  box(foot, opts.sole ?? material, w * 1.06, 0.018, len * 0.98, 0, -0.078, len * 0.2); // 鞋底
  if (opts.cuff) {
    const c = mesh(new CylinderGeometry(opts.cuff * 1.12, opts.cuff, 0.05, 10, 1), opts.trim ?? material, foot);
    c.position.y = 0.06;
  }
}

/** 腰包：皮包 + 翻盖 + 金属扣 */
export function pouch(
  parent: Object3D,
  leather: Material,
  metal: Material,
  x: number,
  y: number,
  z: number,
  size = 1,
  yaw = 0,
): Object3D {
  const body = box(parent, leather, 0.085 * size, 0.09 * size, 0.05 * size, x, y, z);
  body.rotation.y = yaw;
  box(body, leather, 0.09 * size, 0.04 * size, 0.056 * size, 0, 0.03 * size, 0.002);
  box(body, metal, 0.02 * size, 0.022 * size, 0.012 * size, 0, 0.012 * size, 0.03 * size);
  return body;
}

/** 小药瓶：玻璃瓶身（发光材质）+ 木塞 */
export function vial(parent: Object3D, glass: Material, cork: Material, x: number, y: number, z: number, size = 1): void {
  const b = mesh(new CylinderGeometry(0.018 * size, 0.022 * size, 0.06 * size, 7), glass, parent);
  b.position.set(x, y, z);
  const c = mesh(new CylinderGeometry(0.012 * size, 0.012 * size, 0.022 * size, 6), cork, parent);
  c.position.set(x, y + 0.04 * size, z);
}

/** 绕 y 轴的一段布条 / 皮带（敞口圆筒），贴图横向重复 repeat 次：纹饰带、袍边滚边用 */
export function band(
  parent: Object3D,
  material: Material,
  opts: {
    rTop: number;
    rBottom: number;
    height: number;
    y?: number;
    depthScale?: number;
    repeat?: number;
    segments?: number;
    /** 飘动权重：贴在袍摆下沿的滚边要跟着袍摆一起动。不填时，位置在腰以下 0.3 米之外的按袍边处理 */
    sway?: number;
  },
): Mesh {
  const geo = new CylinderGeometry(opts.rTop, opts.rBottom, opts.height, opts.segments ?? 24, 1, true);
  const swayWeight = opts.sway ?? ((opts.y ?? 0) < -0.3 ? SKIRT_SWAY * 0.7 : 0);
  if (swayWeight > 0) {
    geo.setAttribute(SWAY_ATTR, new BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(swayWeight), 1));
  }
  const m = mesh(geo, material, parent);
  m.position.y = opts.y ?? 0;
  m.scale.z = opts.depthScale ?? 1;
  if (opts.repeat && opts.repeat !== 1) scaleUv(m, opts.repeat, 1);
  return m;
}

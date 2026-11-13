// 拼装角色用的小部件：肢体段、方块、球、旋转体、披风、长袍下摆、兜帽等。
// 所有部件默认投射和接收阴影。

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Mesh,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
}

export function capeMesh(parent: Object3D, material: Material, opts: ClothShape): Mesh {
  return mesh(clothGeometry(opts), material, parent);
}

/** 披风/布片的几何体（见 capeMesh） */
export function clothGeometry(opts: ClothShape): BufferGeometry {
  const segX = 8;
  const segY = 12;
  const geo = new PlaneGeometry(1, opts.length, segX, segY);
  const pos = geo.getAttribute('position') as BufferAttribute;
  const wrap = opts.wrap ?? 0.1;
  const flare = opts.flare ?? 0.22;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i); // −0.5 ~ 0.5
    const t = 0.5 - pos.getY(i) / opts.length; // 0 = 顶边，1 = 下摆
    const width = opts.topWidth + (opts.bottomWidth - opts.topWidth) * t;
    const x = u * width;
    // 两侧向前弯（裹住肩背），越往下越向后飘
    const z = wrap * (4 * u * u) - flare * t * t - 0.02 * Math.sin(u * 14 + t * 5) * t;
    pos.setXYZ(i, x, -t * opts.length, z);
  }
  geo.computeVertexNormals();
  return geo;
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
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const t = -pos.getY(i) / opts.length;
    const ang = Math.atan2(z, x);
    const k = 1 + 0.07 * Math.sin(ang * folds) * t; // 褶皱越往下越深
    pos.setX(i, x * k);
    pos.setZ(i, z * k * (opts.depthScale ?? 0.85));
  }
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
      parts.push(g);
      index += 1;
    }
  }
  return mesh(mergeGeometries(parts), material, parent);
}

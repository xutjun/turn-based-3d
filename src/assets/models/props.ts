// 场景物件 builder：残破石柱、碎石、骨堆、火盆、旗帜。
// 每个 builder 都是独立函数，参数化尺寸、颜色和随机种子，方便调整和复用。

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
  Euler,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, randRange } from '../../core/rng';
import { setTick } from '../AssetRegistry';
import { boneMaterial, ironMaterial, stoneMaterial, woodMaterial } from '../materials';
import { bannerTexture, flameTexture, glowTexture } from '../textures/sprites';

function shadowed<T extends Mesh | InstancedMesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// 残破石柱
// ---------------------------------------------------------------------------
export interface PillarParams {
  drums: number; // 石鼓（柱段）数量，决定高度
  radius: number;
  drumHeight: number;
  broken: boolean; // 顶部是否断裂
  seed: number;
}

export function buildBrokenPillar(params: PillarParams): Group {
  const { drums, radius, drumHeight, broken, seed } = params;
  const rng = createRng(seed);
  const group = new Group();
  group.name = 'pillar';
  const mat = stoneMaterial();

  // 方形基座
  const base = shadowed(new Mesh(new BoxGeometry(radius * 2.7, 0.4, radius * 2.7), mat));
  base.position.y = 0.2;
  base.rotation.y = randRange(rng, -0.15, 0.15);
  group.add(base);

  let y = 0.4;
  for (let i = 0; i < drums; i++) {
    const isTop = i === drums - 1;
    const r = radius * (1 - i * 0.025);
    const geo = new CylinderGeometry(r * 0.97, r, drumHeight, 14, 3);
    if (isTop && broken) {
      // 断口：把顶部顶点按角度随机压低，形成参差的斜断面
      const pos = geo.getAttribute('position') as BufferAttribute;
      const tilt = randRange(rng, 0, Math.PI * 2);
      for (let v = 0; v < pos.count; v++) {
        if (pos.getY(v) > drumHeight * 0.1) {
          const ang = Math.atan2(pos.getZ(v), pos.getX(v));
          const drop = (0.5 + 0.5 * Math.cos(ang - tilt)) * drumHeight * 0.75;
          const jag = Math.sin(ang * 5 + seed) * drumHeight * 0.08;
          pos.setY(v, pos.getY(v) - drop - jag);
        }
      }
      geo.computeVertexNormals();
    }
    const drum = shadowed(new Mesh(geo, mat));
    // 每段略微错位、旋转，显得年久失修
    drum.position.set(randRange(rng, -0.04, 0.04), y + drumHeight / 2, randRange(rng, -0.04, 0.04));
    drum.rotation.y = randRange(rng, 0, Math.PI * 2);
    group.add(drum);
    // 段与段之间的凸环
    if (!isTop) {
      const ring = shadowed(new Mesh(new CylinderGeometry(r * 1.06, r * 1.06, 0.09, 14), mat));
      ring.position.y = y + drumHeight;
      group.add(ring);
    }
    y += drumHeight;
  }

  if (!broken) {
    // 完整的柱头
    const cap = shadowed(new Mesh(new BoxGeometry(radius * 2.5, 0.35, radius * 2.5), mat));
    cap.position.y = y + 0.17;
    group.add(cap);
  }
  return group;
}

/** 倒在地上的一截断柱 */
export function buildFallenDrum(params: { radius: number; length: number; seed: number }): Group {
  const rng = createRng(params.seed);
  const group = new Group();
  group.name = 'fallenDrum';
  const drum = shadowed(
    new Mesh(new CylinderGeometry(params.radius, params.radius * 0.96, params.length, 14, 2), stoneMaterial()),
  );
  drum.rotation.z = Math.PI / 2 + randRange(rng, -0.06, 0.06);
  drum.position.y = params.radius * 0.92;
  group.add(drum);
  return group;
}

// ---------------------------------------------------------------------------
// 碎石堆（实例化渲染，一堆只占一次绘制）
// ---------------------------------------------------------------------------
export interface RubbleParams {
  count: number;
  radius: number; // 散布半径
  minSize: number;
  maxSize: number;
  seed: number;
}

export function buildRubble(params: RubbleParams): Group {
  const rng = createRng(params.seed);
  const group = new Group();
  group.name = 'rubble';
  // 把十二面体的顶点随机挤压，得到不规则的石块
  const geo = new DodecahedronGeometry(1, 0);
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const k = 0.75 + ((Math.sin(i * 12.9898 + params.seed) * 43758.5453) % 1) * 0.25;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();

  const mesh = shadowed(new InstancedMesh(geo, stoneMaterial(), params.count));
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  for (let i = 0; i < params.count; i++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = Math.sqrt(rng.next()) * params.radius; // 中间密、边缘疏
    const size = randRange(rng, params.minSize, params.maxSize) * (1 - (dist / params.radius) * 0.4);
    s.set(size * randRange(rng, 0.8, 1.3), size * randRange(rng, 0.45, 0.8), size * randRange(rng, 0.8, 1.3));
    p.set(Math.cos(ang) * dist, s.y * 0.55, Math.sin(ang) * dist);
    q.setFromEuler(new Euler(randRange(rng, -0.4, 0.4), rng.next() * Math.PI * 2, randRange(rng, -0.4, 0.4)));
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return group;
}

// ---------------------------------------------------------------------------
// 骨堆
// ---------------------------------------------------------------------------
export interface BonePileParams {
  bones: number;
  skulls: number;
  radius: number;
  seed: number;
}

export function buildBonePile(params: BonePileParams): Group {
  const rng = createRng(params.seed);
  const group = new Group();
  group.name = 'bonePile';
  const boneGeo = new CapsuleGeometry(0.045, 0.55, 3, 6);
  const knobGeo = new SphereGeometry(0.075, 7, 5);
  const craniumGeo = new SphereGeometry(0.17, 10, 8);
  const jawGeo = new BoxGeometry(0.2, 0.1, 0.16);
  const eyeGeo = new SphereGeometry(0.045, 6, 5);

  // 把所有骨头的几何体变换后合并，一个骨堆只占一次绘制
  const boneParts: BufferGeometry[] = [];
  const eyeParts: BufferGeometry[] = [];
  const part = (geo: BufferGeometry, local: Matrix4, world: Matrix4): BufferGeometry =>
    geo.clone().applyMatrix4(new Matrix4().multiplyMatrices(world, local));
  const world = new Matrix4();
  const q = new Quaternion();
  const at = (x: number, y: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, y, z);

  for (let i = 0; i < params.bones; i++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = Math.sqrt(rng.next()) * params.radius;
    const lift = (1 - dist / params.radius) * 0.28; // 中间堆得高
    const pos = new Vector3(Math.cos(ang) * dist, 0.06 + lift * rng.next(), Math.sin(ang) * dist);
    q.setFromEuler(
      new Euler(Math.PI / 2 + randRange(rng, -0.5, 0.5), rng.next() * Math.PI * 2, randRange(rng, -0.4, 0.4)),
    );
    const scale = randRange(rng, 0.7, 1.25);
    world.compose(pos, q, new Vector3(scale, scale, scale));
    boneParts.push(part(boneGeo, at(0, 0, 0), world));
    boneParts.push(part(knobGeo, at(0, 0.3, 0), world));
    boneParts.push(part(knobGeo, at(0, -0.3, 0), world));
  }

  for (let i = 0; i < params.skulls; i++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = rng.next() * params.radius * 0.7;
    const pos = new Vector3(Math.cos(ang) * dist, 0.2 + rng.next() * 0.18, Math.sin(ang) * dist);
    q.setFromEuler(new Euler(randRange(rng, -0.5, 0.3), rng.next() * Math.PI * 2, randRange(rng, -0.4, 0.4)));
    world.compose(pos, q, new Vector3(1, 1, 1));
    boneParts.push(part(craniumGeo, new Matrix4().makeScale(1, 1.05, 1.18), world));
    boneParts.push(part(jawGeo, at(0, -0.13, 0.08), world));
    eyeParts.push(part(eyeGeo, at(0.065, 0, 0.17), world));
    eyeParts.push(part(eyeGeo, at(-0.065, 0, 0.17), world));
  }

  if (boneParts.length > 0) group.add(shadowed(new Mesh(mergeGeometries(boneParts), boneMaterial())));
  if (eyeParts.length > 0) {
    group.add(new Mesh(mergeGeometries(eyeParts), new MeshBasicMaterial({ color: 0x050505 })));
  }
  return group;
}

// ---------------------------------------------------------------------------
// 火盆：铁质三脚火盆 + 炭火 + 火焰精灵 + 飘散火星 + 闪烁的暖色点光源
// ---------------------------------------------------------------------------
export interface BrazierParams {
  lightColor: number;
  lightIntensity: number;
  lightDistance: number;
  lightDecay: number;
  lightHeight: number;
  flicker: number; // 闪烁幅度（相对强度）
  flickerSpeed: number;
  glow?: number; // 火焰与光晕精灵的亮度倍率，默认 1
  seed: number;
}

export function buildBrazier(params: BrazierParams): Group {
  const rng = createRng(params.seed);
  const group = new Group();
  group.name = 'brazier';
  const iron = ironMaterial();
  const bowlY = 1.05;
  const glow = params.glow ?? 1;

  // 火盆碗（旋转成型）
  const profile = [
    new Vector2(0.05, 0),
    new Vector2(0.36, 0.03),
    new Vector2(0.56, 0.2),
    new Vector2(0.64, 0.42),
    new Vector2(0.6, 0.46),
    new Vector2(0.5, 0.24),
    new Vector2(0.3, 0.1),
    new Vector2(0.05, 0.08),
  ];
  const bowl = shadowed(new Mesh(new LatheGeometry(profile, 16), iron));
  bowl.position.y = bowlY;
  group.add(bowl);
  const rim = shadowed(new Mesh(new TorusGeometry(0.62, 0.045, 6, 18), iron));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = bowlY + 0.44;
  group.add(rim);

  // 三条外撇的腿 + 中间的箍
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.3;
    const leg = shadowed(new Mesh(new CylinderGeometry(0.035, 0.05, 1.35, 6), iron));
    leg.position.set(Math.cos(ang) * 0.42, 0.62, Math.sin(ang) * 0.42);
    leg.rotation.z = Math.cos(ang) * 0.28;
    leg.rotation.x = -Math.sin(ang) * 0.28;
    group.add(leg);
  }
  const brace = shadowed(new Mesh(new TorusGeometry(0.4, 0.025, 5, 16), iron));
  brace.rotation.x = Math.PI / 2;
  brace.position.y = 0.55;
  group.add(brace);

  // 炭火：自发光，配合 Bloom 产生辉光
  const coalMat = new MeshStandardMaterial({
    color: 0x1a0a05,
    emissive: new Color(0xff5a14),
    emissiveIntensity: 3.2,
    roughness: 1,
  });
  const coalGeo = new IcosahedronGeometry(0.13, 0);
  for (let i = 0; i < 9; i++) {
    const coal = new Mesh(coalGeo, coalMat);
    const ang = rng.next() * Math.PI * 2;
    const dist = rng.next() * 0.36;
    coal.position.set(Math.cos(ang) * dist, bowlY + 0.3 + rng.next() * 0.1, Math.sin(ang) * dist);
    coal.rotation.set(rng.next() * 3, rng.next() * 3, rng.next() * 3);
    coal.scale.setScalar(randRange(rng, 0.7, 1.3));
    group.add(coal);
  }

  // 火焰：几片叠加混合的火舌精灵，底部对齐炭火
  const flameMap = flameTexture();
  const flames: { sprite: Sprite; baseW: number; baseH: number; phase: number; speed: number }[] = [];
  const flameColors = [0xff5a1a, 0xff8a2a, 0xffc45a];
  for (let i = 0; i < 4; i++) {
    const mat = new SpriteMaterial({
      map: flameMap,
      color: flameColors[i % flameColors.length],
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.85 * glow,
    });
    const sprite = new Sprite(mat);
    sprite.center.set(0.5, 0.04);
    const baseW = randRange(rng, 0.7, 1.0) * (1 - i * 0.12);
    const baseH = randRange(rng, 1.2, 1.7) * (1 - i * 0.14);
    sprite.position.set(randRange(rng, -0.14, 0.14), bowlY + 0.3, randRange(rng, -0.14, 0.14));
    sprite.scale.set(baseW, baseH, 1);
    flames.push({ sprite, baseW, baseH, phase: rng.next() * 10, speed: randRange(rng, 6, 11) });
    group.add(sprite);
  }

  // 柔和的大光晕
  const halo = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color: 0xff6a20,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity: 0.32 * glow,
    }),
  );
  halo.position.y = bowlY + 0.8;
  halo.scale.set(4.2, 4.2, 1);
  group.add(halo);

  // 飘散的火星
  const emberCount = 22;
  const emberPos = new Float32Array(emberCount * 3);
  const emberSeed = Array.from({ length: emberCount }, () => ({
    phase: rng.next(),
    speed: randRange(rng, 0.25, 0.6),
    ang: rng.next() * Math.PI * 2,
    drift: randRange(rng, 0.1, 0.45),
  }));
  const emberGeo = new BufferGeometry();
  emberGeo.setAttribute('position', new BufferAttribute(emberPos, 3));
  const embers = new Points(
    emberGeo,
    new PointsMaterial({
      map: glowTexture(),
      color: 0xffa040,
      size: 0.16,
      sizeAttenuation: true,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  embers.frustumCulled = false;
  group.add(embers);

  // 暖色点光源
  const light = new PointLight(params.lightColor, params.lightIntensity, params.lightDistance, params.lightDecay);
  light.position.y = params.lightHeight;
  group.add(light);

  const p1 = rng.next() * 10;
  const p2 = rng.next() * 10;
  setTick(group, (time) => {
    // 光强闪烁：几个不同频率的正弦叠加，避免规律感
    const s = params.flickerSpeed;
    const f =
      0.5 * Math.sin(time * s + p1) +
      0.3 * Math.sin(time * s * 2.31 + p2) +
      0.2 * Math.sin(time * s * 4.7 + p1 * 2);
    light.intensity = params.lightIntensity * (1 + params.flicker * f);
    light.position.x = Math.sin(time * 3.1 + p1) * 0.06;
    light.position.z = Math.cos(time * 2.7 + p2) * 0.06;
    halo.material.opacity = (0.3 + 0.06 * f) * glow;

    for (const fl of flames) {
      const w = 1 + 0.12 * Math.sin(time * fl.speed + fl.phase);
      const h = 1 + 0.2 * Math.sin(time * fl.speed * 0.77 + fl.phase * 1.7);
      fl.sprite.scale.set(fl.baseW * w, fl.baseH * h, 1);
      fl.sprite.material.rotation = 0.08 * Math.sin(time * fl.speed * 0.5 + fl.phase);
    }

    for (let i = 0; i < emberCount; i++) {
      const e = emberSeed[i]!;
      const life = (time * e.speed + e.phase) % 1; // 0 → 1 循环
      const r = 0.15 + e.drift * life;
      emberPos[i * 3] = Math.cos(e.ang + life * 3) * r;
      emberPos[i * 3 + 1] = bowlY + 0.4 + life * 2.8;
      emberPos[i * 3 + 2] = Math.sin(e.ang + life * 3) * r;
    }
    emberGeo.getAttribute('position').needsUpdate = true;
  });

  return group;
}

// ---------------------------------------------------------------------------
// 旗帜：旧木旗杆 + 横杆 + 残破的布面（轻微飘动）
// ---------------------------------------------------------------------------
export interface BannerParams {
  poleHeight: number;
  clothWidth: number;
  clothHeight: number;
  seed: number;
}

export function buildBanner(params: BannerParams): Group {
  const { poleHeight, clothWidth, clothHeight, seed } = params;
  const group = new Group();
  group.name = 'banner';
  const wood = woodMaterial();

  const pole = shadowed(new Mesh(new CylinderGeometry(0.06, 0.08, poleHeight, 8), wood));
  pole.position.y = poleHeight / 2;
  group.add(pole);
  const tip = shadowed(new Mesh(new CylinderGeometry(0, 0.09, 0.35, 6), ironMaterial()));
  tip.position.y = poleHeight + 0.17;
  group.add(tip);
  const bar = shadowed(new Mesh(new CylinderGeometry(0.04, 0.04, clothWidth + 0.3, 6), wood));
  bar.rotation.z = Math.PI / 2;
  bar.position.y = poleHeight - 0.25;
  group.add(bar);
  // 石块底座
  const base = buildRubble({ count: 7, radius: 0.5, minSize: 0.18, maxSize: 0.34, seed: seed + 5 });
  group.add(base);

  // 布面：细分平面，顶边固定在横杆上，其余顶点随时间摆动
  const segX = 6;
  const segY = 12;
  const geo = new PlaneGeometry(clothWidth, clothHeight, segX, segY);
  geo.translate(0, -clothHeight / 2, 0); // 原点移到顶边
  const cloth = new Mesh(
    geo,
    new MeshStandardMaterial({
      map: bannerTexture(seed),
      alphaTest: 0.5,
      side: DoubleSide,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  cloth.castShadow = true;
  cloth.position.set(0, poleHeight - 0.25, 0.05);
  group.add(cloth);

  const pos = geo.getAttribute('position') as BufferAttribute;
  const rest = Float32Array.from(pos.array as Float32Array);
  const phase = (seed % 7) * 0.9;
  setTick(group, (time) => {
    for (let i = 0; i < pos.count; i++) {
      const x = rest[i * 3]!;
      const y = rest[i * 3 + 1]!;
      const hang = Math.min(1, -y / clothHeight); // 0 = 顶边（固定），1 = 下摆
      const wave =
        Math.sin(time * 1.6 + y * 2.2 + x * 1.5 + phase) * 0.12 +
        Math.sin(time * 2.7 + y * 4.1 + phase * 2) * 0.04;
      pos.setZ(i, wave * hang);
      pos.setX(i, x + Math.sin(time * 1.1 + y * 1.5 + phase) * 0.03 * hang);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });
  return group;
}

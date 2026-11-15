// 法杖：整根杖都发光——杖身、金属箍和爪托有发光轮廓线，杖身上流动着符文光纹；
// 杖顶爪托里悬浮一颗带切面的小水晶，外面一层柔和的小光晕和两道符文环；颜色按施法元素可变。

import {
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  OctahedronGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { STAFF_ELEMENT_COLORS, WEAPONS, type StaffElement } from '../../../data/weapons';
import { leatherMaterial, plateMaterial } from '../../materials';
import { runeStripTexture } from '../../textures/sprites';
import { mesh, ring } from '../characters/parts';
import { ownTexture, WEAPON_RIM, type WeaponBaseParams } from './common';
import { finishWeapon, getWeaponGlow, glowMesh, WeaponGlow } from './glow';

export interface StaffParams extends WeaponBaseParams {
  /** 施法元素，决定宝珠颜色；不填则用 glow 里配置的颜色 */
  element?: StaffElement;
  length: number; // 杖身长度
  gripHeight: number; // 握持点离杖底的距离
  orbRadius: number; // 水晶核心的大小
  ringRadius: number; // 符文环半径
  shaftColor: number;
  trimColor: number; // 爪托、箍
}

export const STAFF_DEFAULTS: StaffParams = {
  scale: 1,
  rim: WEAPON_RIM,
  glow: WEAPONS.staff.glow,
  length: 1.62,
  gripHeight: 0.93,
  orbRadius: 0.05,
  ringRadius: 0.115,
  shaftColor: 0x33261d,
  trimColor: 0x8a7038,
};

export function buildStaffWithGlow(params: Partial<StaffParams> = {}): Group {
  const c = { ...STAFF_DEFAULTS, ...params };
  const element = c.element ? STAFF_ELEMENT_COLORS[c.element] : undefined;
  const def = element ? { ...c.glow, color: element.color, accentColor: element.accentColor } : c.glow;
  const root = new Group();
  const glow = new WeaponGlow(def, 41);
  // 杖身和金属件都带发光色的轮廓光：整根法杖的形状靠亮边勾出来
  const wood = glow.edge(leatherMaterial({ color: c.shaftColor, rim: c.rim }), 1, 'main', 2.0);
  const trim = glow.edge(plateMaterial({ color: c.trimColor, rim: c.rim, metalness: 0.95 }), 0.8, 'main', 2.2);
  const line = glow.emissive({ factor: 1.1 }); // 细发光线：箍边、爪托外沿

  const bottom = -c.gripHeight;
  const top = bottom + c.length;
  const radiusAt = (y: number): number => 0.017 + (0.024 - 0.017) * ((y - bottom) / c.length);

  // --- 杖身：下细上粗，几道金属箍（每道箍旁一圈细光线），杖底包铁 ---
  mesh(new CylinderGeometry(0.024, 0.017, c.length, 8), wood, root).position.y = (bottom + top) / 2;
  mesh(new CylinderGeometry(0.019, 0.012, 0.07, 8), trim, root).position.y = bottom + 0.02;
  for (const y of [bottom + 0.3, -0.14, 0.14, top - 0.2]) {
    ring(root, trim, 0.024, 0.006, y, 5, 10);
    const edgeLine = ring(root, line, radiusAt(y) + 0.004, 0.0028, y + 0.012, 4, 12);
    edgeLine.castShadow = false;
  }
  // 杖身上沿长度流动的符文光纹：握把上下各一段，符文沿杖身排列
  const runeFlow = glow.flow(ownTexture(runeStripTexture(9), 1, 1), 1, 0);
  const veinMat = glow.emissive({ factor: 0.75, map: runeFlow, additive: true });
  for (const [y0, y1] of [
    [bottom + 0.08, -0.17],
    [0.17, top - 0.04],
  ] as const) {
    const geo = new CylinderGeometry(radiusAt(y1) + 0.0018, radiusAt(y0) + 0.0018, y1 - y0, 10, 1, true);
    // 符文带贴图是横向的：把贴图坐标转 90°，u 沿杖身（约每 0.45 米一轮符文），v 绕杖身三圈
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getY(i) * (y1 - y0)) / 0.45, uv.getX(i) * 3);
    glowMesh(geo, veinMat, root).position.y = (y0 + y1) / 2;
  }

  // --- 爪托：三根向外张开再向内合拢的爪，外沿各嵌一条细光线 ---
  mesh(new CylinderGeometry(0.04, 0.026, 0.07, 10), trim, root).position.y = top;
  const orbY = top + 0.22;
  const prongProfile: [number, number][] = [
    [0.025, 0.0],
    [0.085, 0.07],
    [0.11, 0.19],
    [0.08, 0.31],
    [0.045, 0.37],
  ];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const curveAt = (offset: number): CatmullRomCurve3 =>
      new CatmullRomCurve3(prongProfile.map(([r, y]) => new Vector3(Math.cos(a) * (r + offset), top + y, Math.sin(a) * (r + offset))));
    mesh(new TubeGeometry(curveAt(0), 14, 0.01, 6), trim, root);
    glowMesh(new TubeGeometry(curveAt(0.0105), 14, 0.003, 4), line, root);
  }

  // --- 水晶核心：带切面的小晶体（实心的亮芯 + 外面一层淡淡的晶壳），悬浮、缓慢自转并上下浮动 ---
  const orb = new Group();
  orb.position.y = orbY;
  root.add(orb);
  const coreMat = glow.emissive({ slot: 'accent', factor: 0.6 });
  coreMat.flatShading = true;
  const core = glowMesh(new OctahedronGeometry(c.orbRadius * 0.62, 0), coreMat, orb);
  core.scale.y = 1.55;
  const shellMat = glow.emissive({ factor: 0.2, additive: true });
  const shell = glowMesh(new OctahedronGeometry(c.orbRadius, 0), shellMat, orb);
  shell.scale.y = 1.55;

  // --- 两道符文环：不同倾角，反向旋转 ---
  const runes = ownTexture(runeStripTexture(13), 2, 1);
  const ringMat = glow.emissive({ factor: 0.5, map: runes, additive: true, doubleSide: true });
  const ringA = new Group();
  const ringB = new Group();
  for (const [g, tilt, r] of [
    [ringA, 0.35, c.ringRadius],
    [ringB, -1.0, c.ringRadius * 0.78],
  ] as const) {
    g.position.y = orbY;
    g.rotation.z = tilt;
    root.add(g);
    glowMesh(new CylinderGeometry(r, r, 0.022, 32, 1, true), ringMat, g);
  }
  const spinA = ringA.children[0]!;
  const spinB = ringB.children[0]!;

  // --- 外层柔和光晕（小）、点光源、环绕光粒 ---
  const halo = glow.halo(root, [0, orbY, 0], 1, 'main', 1);
  const light = glow.light(root, [0, orbY, 0.05]);
  const particles = glow.particles(root, {
    count: c.glow.particleCount,
    size: 0.03,
    mode: 'orbit',
    from: [0, 0, 0],
    radius: c.ringRadius * 1.05,
    speed: 1.5,
  });

  glow.onUpdate((time, dt) => {
    const y = orbY + Math.sin(time * 1.6) * 0.014;
    orb.position.y = y;
    halo.position.y = y;
    if (light) light.position.y = y;
    if (particles) particles.position.y = y;
    orb.rotation.y += dt * 0.7;
    spinA.rotation.y += dt * 0.9;
    spinB.rotation.y -= dt * 1.3;
  });

  root.scale.setScalar(c.scale);
  return finishWeapon(root, 'staff', glow, { hand: 'right', rotation: [-0.5, 0, 0] });
}

/** 换法杖的施法元素（施法时调用） */
export function setStaffElement(staff: Group, element: StaffElement): void {
  const e = STAFF_ELEMENT_COLORS[element];
  getWeaponGlow(staff)?.setColor(e.color, e.accentColor);
}

// 法杖：杖顶的爪托上悬浮着发光宝珠，周围环绕光粒和两道符文环；颜色按施法元素可变。

import {
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { STAFF_ELEMENT_COLORS, WEAPONS, type StaffElement } from '../../../data/weapons';
import { leatherMaterial, plateMaterial } from '../../materials';
import { energyFlowTexture, runeStripTexture } from '../../textures/sprites';
import { mesh, ring } from '../characters/parts';
import { ownTexture, WEAPON_RIM, type WeaponBaseParams } from './common';
import { finishWeapon, getWeaponGlow, glowMesh, WeaponGlow } from './glow';

export interface StaffParams extends WeaponBaseParams {
  /** 施法元素，决定宝珠颜色；不填则用 glow 里配置的颜色 */
  element?: StaffElement;
  length: number; // 杖身长度
  gripHeight: number; // 握持点离杖底的距离
  orbRadius: number;
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
  orbRadius: 0.072,
  ringRadius: 0.17,
  shaftColor: 0x33261d,
  trimColor: 0x8a7038,
};

export function buildStaffWithGlow(params: Partial<StaffParams> = {}): Group {
  const c = { ...STAFF_DEFAULTS, ...params };
  const element = c.element ? STAFF_ELEMENT_COLORS[c.element] : undefined;
  const def = element ? { ...c.glow, color: element.color, accentColor: element.accentColor } : c.glow;
  const root = new Group();
  const glow = new WeaponGlow(def, 41);
  const wood = leatherMaterial({ color: c.shaftColor, rim: c.rim });
  const trim = plateMaterial({ color: c.trimColor, rim: c.rim, metalness: 0.95 });

  const bottom = -c.gripHeight;
  const top = bottom + c.length;

  // --- 杖身：下细上粗，几道金属箍，杖底包铁 ---
  mesh(new CylinderGeometry(0.024, 0.017, c.length, 8), wood, root).position.y = (bottom + top) / 2;
  mesh(new CylinderGeometry(0.019, 0.012, 0.07, 8), trim, root).position.y = bottom + 0.02;
  for (const y of [bottom + 0.3, -0.14, 0.14, top - 0.2]) ring(root, trim, 0.024, 0.006, y, 5, 10);
  // 杖身上一道细的发光纹路
  const vein = glow.flow(ownTexture(energyFlowTexture(9), 1, 3), 0, -1);
  glowMesh(new CylinderGeometry(0.0255, 0.0255, 0.3, 8, 1, true), glow.emissive({ factor: 0.3, map: vein, additive: true }), root).position.y =
    top - 0.38;

  // --- 爪托：三根向外张开再向内合拢的爪 ---
  mesh(new CylinderGeometry(0.04, 0.026, 0.07, 10), trim, root).position.y = top;
  const orbY = top + 0.24;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const pts = [
      [0.025, 0.0],
      [0.1, 0.07],
      [0.135, 0.2],
      [0.1, 0.33],
      [0.06, 0.4],
    ].map(([r, y]) => new Vector3(Math.cos(a) * r!, top + y!, Math.sin(a) * r!));
    mesh(new TubeGeometry(new CatmullRomCurve3(pts), 14, 0.011, 6), trim, root);
  }

  // --- 宝珠：多面晶体，悬浮、缓慢自转并上下浮动 ---
  const orb = glowMesh(new IcosahedronGeometry(c.orbRadius, 1), glow.emissive({ factor: 1.1 }), root);
  orb.position.y = orbY;
  const core = glowMesh(new SphereGeometry(c.orbRadius * 0.5, 10, 8), glow.emissive({ slot: 'accent', factor: 2 }), root);
  core.position.y = orbY;

  // --- 两道符文环：不同倾角，反向旋转 ---
  const runes = ownTexture(runeStripTexture(13), 2, 1);
  const ringMat = glow.emissive({ factor: 1.3, map: runes, additive: true, doubleSide: true });
  const ringA = new Group();
  const ringB = new Group();
  for (const [g, tilt, r] of [
    [ringA, 0.35, c.ringRadius],
    [ringB, -1.0, c.ringRadius * 0.8],
  ] as const) {
    g.position.y = orbY;
    g.rotation.z = tilt;
    root.add(g);
    glowMesh(new CylinderGeometry(r, r, 0.034, 40, 1, true), ringMat, g);
  }
  const spinA = ringA.children[0]!;
  const spinB = ringB.children[0]!;

  // --- 光晕、点光源、环绕光粒 ---
  const halo = glow.halo(root, [0, orbY, 0], 1, 'main', 1);
  const haloCore = glow.halo(root, [0, orbY, 0], 0.4, 'accent', 1.5);
  const light = glow.light(root, [0, orbY, 0.05]);
  const particles = glow.particles(root, {
    count: c.glow.particleCount,
    size: 0.045,
    mode: 'orbit',
    from: [0, 0, 0],
    radius: c.ringRadius * 1.05,
    speed: 1.5,
  });

  glow.onUpdate((time, dt) => {
    const y = orbY + Math.sin(time * 1.6) * 0.018;
    orb.position.y = y;
    core.position.y = y;
    halo.position.y = y;
    haloCore.position.y = y;
    if (light) light.position.y = y;
    if (particles) particles.position.y = y;
    orb.rotation.y += dt * 0.7;
    orb.rotation.x += dt * 0.25;
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

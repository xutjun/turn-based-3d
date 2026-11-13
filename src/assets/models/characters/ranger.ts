// 自由职业（物理系）· 游侠弓手：轻皮甲、尖兜帽、单肩短斗篷、背后箭袋。剪影特征：修长、双腿分明、斜披风与箭羽。

import { BoxGeometry, CylinderGeometry, type BufferGeometry, type Group } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, capeMesh, extruded, hood, lathe, mesh, ring, seg, softSeg } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface RangerParams extends CharacterBaseParams {
  leatherColor: number; // 皮甲
  darkLeatherColor: number; // 靴、手套、箭袋
  clothColor: number; // 衣裤
  cloakColor: number; // 斗篷与兜帽
  metalColor: number; // 扣件
  featherColor: number; // 箭羽
  eyeColor: number;
  eyeIntensity: number;
}

export const RANGER_DEFAULTS: RangerParams = {
  scale: 0.98,
  rim: ALLY_RIM,
  leatherColor: 0x6b4a30,
  darkLeatherColor: 0x33241a,
  clothColor: 0x39403a,
  cloakColor: 0x27433d,
  metalColor: 0x8a8672,
  featherColor: 0xb8b29a,
  eyeColor: 0x62e6cc,
  eyeIntensity: 2.6,
};

export function buildRanger(params: Partial<RangerParams> = {}): Group {
  const c = { ...RANGER_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.21, hipWidth: 0.095 });
  const rim = c.rim;
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const dark = leatherMaterial({ color: c.darkLeatherColor, rim });
  const cloth = clothMaterial({ color: c.clothColor, rim });
  const cloak = clothMaterial({ color: c.cloakColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(11, 0.2) });
  const cloakSolid = clothMaterial({ color: c.cloakColor, rim, doubleSide: true });
  const metal = plateMaterial({ color: c.metalColor, rim });
  const feather = clothMaterial({ color: c.featherColor, rim, doubleSide: true });
  const eye = glowMaterial(c.eyeColor, c.eyeIntensity);
  const shadow = clothMaterial({ color: 0x060606 });

  // --- 髋部：皮裙片、腰带、腰包 ---
  box(rig.hips, cloth, 0.27, 0.15, 0.18, 0, -0.03, 0);
  ring(rig.hips, dark, 0.165, 0.028, 0.06, 6, 18);
  box(rig.hips, metal, 0.055, 0.055, 0.025, 0, 0.06, 0.17);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const strip = box(rig.hips, leather, 0.1, 0.22, 0.02, Math.sin(a) * 0.15, -0.13, Math.cos(a) * 0.115);
    strip.rotation.order = 'YXZ';
    strip.rotation.set(-0.15, a, 0);
  }
  box(rig.hips, dark, 0.09, 0.1, 0.06, 0.17, -0.03, 0.06).rotation.y = 0.5;

  // --- 躯干：皮甲、斜挎的箭袋背带 ---
  lathe(rig.spine, leather, [
    [0.158, 0],
    [0.138, 0.14],
    [0.15, 0.29],
  ]).scale.z = 0.82;
  lathe(rig.chest, leather, [
    [0.15, 0],
    [0.176, 0.1],
    [0.165, 0.18],
    [0.085, 0.245],
  ]).scale.z = 0.8;
  const strap = box(rig.chest, dark, 0.045, 0.5, 0.012, 0, 0.03, 0.142);
  strap.rotation.z = -0.72;
  box(rig.chest, metal, 0.05, 0.05, 0.02, 0.05, 0.09, 0.15);
  lathe(rig.chest, cloakSolid, [
    [0.1, 0.2],
    [0.115, 0.26],
    [0.1, 0.3],
  ]); // 围巾

  // --- 箭袋与箭：斜背在右肩后 ---
  const quiver = mesh(new CylinderGeometry(0.055, 0.045, 0.5, 10), dark, rig.chest);
  quiver.position.set(-0.07, 0.04, -0.16);
  quiver.rotation.z = 0.5;
  ring(quiver, metal, 0.056, 0.008, 0.24, 5, 12);
  const shafts: BufferGeometry[] = [];
  const fletch: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 0.028;
    const z = Math.sin(a) * 0.028;
    const h = 0.16 + (i % 3) * 0.035;
    shafts.push(new CylinderGeometry(0.006, 0.006, h, 5).translate(x, 0.25 + h / 2, z));
    for (const r of [0, Math.PI / 2]) {
      fletch.push(new BoxGeometry(0.035, 0.08, 0.003).rotateY(r + a).translate(x, 0.25 + h - 0.03, z));
    }
  }
  mesh(mergeGeometries(shafts), dark, quiver);
  mesh(mergeGeometries(fletch), feather, quiver);

  // --- 双臂：布袖、皮护腕（持弓的左臂护腕更长）、手套；右肩皮护肩 ---
  for (const [arm, bracer] of [
    [rig.armL, 0.2],
    [rig.armR, 0.13],
  ] as const) {
    softSeg(arm.shoulder, cloth, 0.3, 0.054);
    softSeg(arm.elbow, cloth, 0.25, 0.046);
    seg(arm.elbow, leather, bracer, 0.056, 0.05).position.y = -0.24 + bracer / 2;
    ring(arm.elbow, metal, 0.055, 0.007, -0.24 + bracer, 5, 12);
    ball(arm.hand, dark, 0.042, 0, -0.03, 0, [1, 1.3, 0.9]);
  }
  const pad = ball(rig.armR.shoulder, leather, 0.085, -0.02, 0.01, 0, [1.15, 0.8, 1.2]);
  pad.rotation.z = 0.3;

  // --- 双腿：布裤、及膝长靴 ---
  for (const leg of [rig.legL, rig.legR]) {
    softSeg(leg.hip, cloth, 0.44, 0.072);
    ball(leg.knee, leather, 0.062, 0, 0, 0.02);
    seg(leg.knee, dark, 0.4, 0.068, 0.054);
    ring(leg.knee, leather, 0.07, 0.012, -0.03, 5, 14);
    box(leg.foot, dark, 0.09, 0.075, 0.24, 0, -0.042, 0.055);
  }

  // --- 头：尖兜帽、蒙面、帽侧的羽毛 ---
  ball(rig.head, shadow, 0.098, 0, 0.115, 0);
  ball(rig.head, cloakSolid, 0.1, 0, 0.07, 0.012, [1, 0.62, 1]); // 蒙面巾
  for (const sx of [1, -1]) ball(rig.head, eye, 0.011, sx * 0.036, 0.13, 0.088);
  const h = hood(rig.head, cloakSolid, { radius: 0.15, opening: 1.4, peak: 0.13 });
  h.position.y = 0.12;
  const plume = extruded(
    rig.head,
    feather,
    [
      [0, 0],
      [0.03, 0.08],
      [0.025, 0.2],
      [0, 0.27],
      [-0.012, 0.18],
      [-0.01, 0.06],
    ],
    0.004,
  );
  plume.position.set(0.13, 0.17, -0.03);
  plume.rotation.set(-0.5, Math.PI / 2, 0);

  // --- 斗篷：偏向左肩的短斗篷，下摆撕裂 ---
  const cape = capeMesh(rig.cape, cloak, { topWidth: 0.44, bottomWidth: 0.6, length: 0.78, wrap: 0.12, flare: 0.2 });
  cape.position.x = 0.06;
  cape.rotation.z = 0.1;

  return finishCharacter(rig, 'ranger', 1.86, c.scale);
}

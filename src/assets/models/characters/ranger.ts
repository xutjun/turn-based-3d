// 自由职业（物理系）· 游侠弓手：轻皮甲、尖兜帽、单肩短斗篷、背后箭袋。剪影特征：修长、双腿分明、斜披风与箭羽。
// 步骤 10 细化：棕皮甲（钉饰、缝线皮带）+ 墨绿斗篷 + 灰毛皮披肩 + 铁扣件；腰包、腿上的猎刀、
// 翻边长靴、护膝、带钉护腕，箭袋上有皮带和金属箍。

import { BoxGeometry, ConeGeometry, CylinderGeometry, type BufferGeometry, type Group } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clothMaterial, furMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import {
  ball,
  chain,
  boot,
  box,
  capeMesh,
  extruded,
  furCollar,
  gauntlet,
  hood,
  lathe,
  mesh,
  pouch,
  ring,
  rivetRing,
  rivets,
  seg,
  softSeg,
} from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface RangerParams extends CharacterBaseParams {
  leatherColor: number; // 皮甲
  darkLeatherColor: number; // 靴、手套、箭袋
  clothColor: number; // 衣裤
  cloakColor: number; // 斗篷与兜帽
  metalColor: number; // 扣件
  featherColor: number; // 箭羽
  furColor: number; // 毛皮披肩
  eyeColor: number;
  eyeIntensity: number;
}

export const RANGER_DEFAULTS: RangerParams = {
  scale: 0.98,
  rim: ALLY_RIM,
  leatherColor: 0x8a5a34,
  darkLeatherColor: 0x46301f,
  clothColor: 0x5a6350,
  cloakColor: 0x2f6a4c,
  metalColor: 0xa9a48c,
  featherColor: 0xd8d2b8,
  furColor: 0x9a8f7c,
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
  const fur = furMaterial({ color: c.furColor, rim });
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
  rivetRing(rig.hips, metal, 0.19, 10, 0.06, 0.008, 0.85);
  pouch(rig.hips, dark, metal, 0.18, -0.03, 0.07, 1.05, 0.7);
  pouch(rig.hips, leather, metal, -0.17, -0.04, -0.09, 0.9, -2.2);
  // 皮裙片上的钉
  const studs: [number, number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    studs.push([Math.sin(a) * 0.165, -0.2, Math.cos(a) * 0.128]);
  }
  rivets(rig.hips, metal, studs, 0.01);

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
  // 皮甲：胸前的加厚皮片、缝线和钉饰，腹部两道束带
  const chestPad = ball(rig.chest, dark, 0.15, 0, 0.1, 0.03, [1.05, 0.8, 0.82]);
  chestPad.position.z = 0.035;
  // 项链“狼牙挂坠”（步骤 22，装备表 eq_A0_necklace）：从毛领下垂到胸前的细皮绳 + 一颗弯狼牙（骨白色，用扣件的浅色金属）。
  // 用已有材质，并进胸部的合并网格（不新增材质种类）
  chain(rig.chest, dark, [
    [-0.075, 0.17, 0.15],
    [-0.035, 0.1, 0.168],
    [0, 0.078, 0.172],
    [0.035, 0.1, 0.168],
    [0.075, 0.17, 0.15],
  ], 0.007);
  const fang = mesh(new ConeGeometry(0.011, 0.05, 6), metal, rig.chest);
  fang.position.set(0.004, 0.05, 0.176);
  fang.rotation.set(Math.PI + 0.15, 0, 0.18); // 尖朝下、略弯
  rivets(rig.chest, metal, [
    [-0.1, 0.17, 0.118],
    [0.1, 0.17, 0.118],
    [-0.13, 0.08, 0.11],
    [0.13, 0.08, 0.11],
    [-0.09, 0.0, 0.125],
    [0.09, 0.0, 0.125],
  ]);
  for (const y of [0.07, 0.17]) {
    ring(rig.spine, dark, 0.15, 0.012, y, 4, 18).scale.set(1, 0.82, 1);
    box(rig.spine, metal, 0.03, 0.03, 0.014, 0.05, y, 0.125);
  }
  // 毛皮披肩：搭在双肩和后背
  const mantle = lathe(rig.chest, fur, [
    [0.1, 0.27],
    [0.2, 0.235],
    [0.255, 0.17],
  ]);
  mantle.scale.z = 0.9;
  furCollar(rig.chest, fur, { radius: 0.255, y: 0.165, count: 22, length: 0.1, thickness: 0.028, depthScale: 0.9, droop: 0.9, rows: 2, seed: 11 });
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
  ring(quiver, metal, 0.05, 0.007, -0.2, 5, 12);
  ring(quiver, leather, 0.056, 0.012, 0.08, 4, 12);
  ring(quiver, leather, 0.052, 0.012, -0.08, 4, 12);
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
    rivetRing(arm.elbow, metal, 0.055, 5, -0.24 + bracer / 2, 0.007);
    ring(arm.shoulder, dark, 0.057, 0.009, -0.2, 4, 12); // 臂带
    gauntlet(arm.hand, dark, { side: arm === rig.armL ? 1 : -1, size: 0.85, cuffLength: 0.045 });
  }
  const pad = ball(rig.armR.shoulder, leather, 0.085, -0.02, 0.01, 0, [1.15, 0.8, 1.2]);
  pad.rotation.z = 0.3;
  const pad2 = ball(rig.armR.shoulder, dark, 0.07, -0.05, -0.05, 0, [1.1, 0.75, 1.15]);
  pad2.rotation.z = 0.7;
  rivets(rig.armR.shoulder, metal, [
    [-0.04, 0.06, 0.07],
    [-0.04, 0.06, -0.07],
    [-0.1, 0.0, 0],
  ]);

  // --- 双腿：布裤、及膝长靴 ---
  for (const leg of [rig.legL, rig.legR]) {
    softSeg(leg.hip, cloth, 0.44, 0.072);
    ball(leg.knee, leather, 0.066, 0, 0, 0.022, [1, 1.15, 0.9]); // 皮护膝
    rivets(leg.knee, metal, [[0, 0, 0.083]], 0.011);
    seg(leg.knee, dark, 0.4, 0.068, 0.054);
    // 靴筒翻边和两道绑带
    mesh(new CylinderGeometry(0.082, 0.07, 0.07, 10, 1), leather, leg.knee).position.y = -0.085;
    ring(leg.knee, leather, 0.064, 0.008, -0.2, 4, 12);
    ring(leg.knee, leather, 0.059, 0.008, -0.3, 4, 12);
    boot(leg.foot, dark, { sole: leather, width: 0.092, length: 0.24 });
  }
  // 左腿外侧绑着的猎刀
  ring(rig.legL.hip, dark, 0.08, 0.01, -0.16, 4, 12);
  const knife = box(rig.legL.hip, dark, 0.03, 0.17, 0.02, 0.082, -0.22, 0.01);
  box(knife, metal, 0.045, 0.014, 0.03, 0, 0.09, 0);
  box(knife, leather, 0.022, 0.07, 0.022, 0, 0.13, 0);

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
  const cape = capeMesh(rig.cape, cloak, {
    topWidth: 0.44,
    bottomWidth: 0.64,
    length: 0.82,
    wrap: 0.12,
    flare: 0.2,
    folds: 4,
    foldDepth: 0.03,
  });
  cape.position.x = 0.06;
  cape.rotation.z = 0.1;

  return finishCharacter(rig, 'ranger', 1.86, c.scale);
}

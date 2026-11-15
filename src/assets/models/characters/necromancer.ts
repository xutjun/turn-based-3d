// 敌人 · 亡灵法师：破烂的黑绿长袍，兜帽下是一张骷髅脸，背后伸出一扇弯曲的骨刺，手持骷髅头骨杖。
// 剪影特征：背后的骨刺扇、烂成条的下摆、杖顶的头骨。
// 步骤 10 细化：墨绿破袍 + 灰紫内层 + 骨白 + 发黑的铁链；头戴骨冠，双肩各扣一颗头骨，胸前露出整排肋骨，
// 腰间毒瓶、头骨和锁着的亡灵书，袍边绣着毒绿纹饰；骨杖的眼窝和杖身刻痕泛着毒光。

import { CylinderGeometry, type Group } from 'three';
import { ENEMY_RIM_CONFIG } from '../../../data/renderConfig';
import { bandMaterial, boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { ornamentStripTexture, runeSpeckTexture, tatterAlphaTexture } from '../../textures/sprites';
import { boneTextures } from '../../textures/surfaces';
import { finishCharacter, type CharacterBaseParams } from './common';
import { ball, band, box, capeMesh, chain, cones, gem, hood, lathe, mesh, ring, robeSkirt, softSeg, taperedTube, vial, type ConeSpec } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface NecromancerParams extends CharacterBaseParams {
  robeColor: number;
  innerColor: number; // 内层破袍
  hoodColor: number;
  boneColor: number;
  glowColor: number; // 魂火：目光、杖顶
  glowIntensity: number;
}

export const NECROMANCER_DEFAULTS: NecromancerParams = {
  scale: 1.05,
  rim: ENEMY_RIM_CONFIG.necromancer,
  robeColor: 0x24483a,
  innerColor: 0x4a4458,
  hoodColor: 0x12201a,
  boneColor: 0xd4ccb0,
  glowColor: 0x5cff7a,
  glowIntensity: 5,
};

export function buildNecromancer(params: Partial<NecromancerParams> = {}): Group {
  const c = { ...NECROMANCER_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.19 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const ragged = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(43, 0.45) });
  const hoodMat = clothMaterial({ color: c.hoodColor, rim, doubleSide: true });
  const bone = boneSurfaceMaterial({ color: c.boneColor, rim });
  const leather = leatherMaterial({ color: 0x1a1410, rim });
  const dark = clothMaterial({ color: 0x040404 });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  const inner = clothMaterial({ color: c.innerColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(44, 0.5) });
  const edging = bandMaterial(ornamentStripTexture(c.hoodColor, 0x7ad88a, 41), { rim, doubleSide: true });
  const iron = plateMaterial({ color: 0x4a4c50, rim, metalness: 0.8 });
  const poison = glowMaterial(c.glowColor, c.glowIntensity * 0.4, { baseColor: 0x0c2a14 });
  // 刻着符文的骨头：骨杖、骨冠
  const runedBone = glowMaterial(c.glowColor, c.glowIntensity * 0.35, {
    emissiveMap: runeSpeckTexture(43, 40),
    baseColor: c.boneColor,
    surface: boneTextures(),
    rim,
  });

  // --- 烂成条的长袍下摆，外面再罩一层更短的破布 ---
  robeSkirt(rig.hips, inner, { topRadius: 0.16, bottomRadius: 0.38, length: 0.9, folds: 11 });
  robeSkirt(rig.hips, ragged, { topRadius: 0.175, bottomRadius: 0.33, length: 0.55, folds: 7 }).rotation.y = 0.6;
  for (const leg of [rig.legL, rig.legR]) box(leg.foot, leather, 0.085, 0.06, 0.19, 0, -0.04, 0.05);
  // 腰间一串小头骨
  ring(rig.hips, leather, 0.172, 0.018, 0.04, 5, 16);
  band(rig.hips, edging, { rTop: 0.19, rBottom: 0.2, height: 0.05, y: -0.02, depthScale: 0.86, repeat: 2, segments: 20 });
  // 两只毒瓶、锁着铁链的亡灵书
  vial(rig.hips, poison, leather, 0.19, -0.05, 0.03, 1.2);
  vial(rig.hips, poison, leather, 0.17, -0.05, -0.06, 1);
  const tome = box(rig.hips, leather, 0.12, 0.15, 0.05, -0.21, -0.1, -0.02);
  tome.rotation.z = -0.15;
  box(tome, bone, 0.05, 0.05, 0.012, 0, 0.01, 0.028); // 封面上的小头骨
  box(tome, iron, 0.124, 0.02, 0.054, 0, 0.05, 0);
  box(tome, iron, 0.124, 0.02, 0.054, 0, -0.05, 0);
  chain(rig.hips, iron, [
    [-0.16, 0.04, 0.05],
    [-0.21, -0.02, 0.0],
  ], 0.012);
  chain(rig.hips, iron, [
    [0.05, 0.03, 0.17],
    [0.0, -0.16, 0.2],
    [-0.08, 0.03, 0.17],
  ], 0.012);
  for (const [x, z] of [
    [0.13, 0.12],
    [-0.02, 0.175],
    [-0.15, 0.09],
  ] as const) {
    ball(rig.hips, bone, 0.042, x, -0.04, z, [0.9, 1, 1]);
  }

  // --- 干瘦的躯干 ---
  lathe(rig.spine, robe, [
    [0.16, 0],
    [0.135, 0.14],
    [0.145, 0.29],
  ]).scale.z = 0.82;
  lathe(rig.chest, robe, [
    [0.145, 0],
    [0.165, 0.1],
    [0.15, 0.19],
    [0.08, 0.25],
  ]).scale.z = 0.8;
  // 胸前露出的几根肋骨
  for (let i = 0; i < 5; i++) {
    const rib = ring(rig.chest, bone, 0.165 - i * 0.008, 0.009, 0.17 - i * 0.04, 4, 14);
    rib.scale.set(1, 0.82, 1);
  }
  box(rig.chest, bone, 0.03, 0.2, 0.02, 0, 0.09, 0.14); // 胸骨
  gem(rig.chest, glow, 0.02, 0, 0.07, 0.155, 1.4); // 胸骨下悬着的一点魂火
  // 双肩各扣一颗头骨，破烂的领巾
  for (const sx of [1, -1]) {
    ball(rig.chest, bone, 0.075, sx * 0.2, 0.22, 0, [0.95, 1, 1.05]);
    box(rig.chest, bone, 0.07, 0.035, 0.05, sx * 0.2, 0.16, 0.035); // 头骨的下颌
    ball(rig.chest, dark, 0.02, sx * 0.2 + 0.028, 0.23, 0.062);
    ball(rig.chest, dark, 0.02, sx * 0.2 - 0.028, 0.23, 0.062);
    ball(rig.chest, glow, 0.008, sx * 0.2 + 0.028, 0.23, 0.074);
    ball(rig.chest, glow, 0.008, sx * 0.2 - 0.028, 0.23, 0.074);
  }
  lathe(rig.chest, ragged, [
    [0.08, 0.28],
    [0.17, 0.24],
    [0.22, 0.14],
  ]).scale.z = 0.85;

  // --- 背后的骨刺扇：五根向上向外弯的长骨 ---
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.42; // 左右张开的角度
    const len = 0.62 - Math.abs(i - 2) * 0.1;
    taperedTube(
      rig.chest,
      bone,
      [
        [Math.sin(a) * 0.06, 0.12, -0.12],
        [Math.sin(a) * 0.22, 0.12 + len * 0.45, -0.26],
        [Math.sin(a) * 0.42, 0.12 + len * 0.85, -0.22],
        [Math.sin(a) * 0.5, 0.12 + len, -0.12],
      ],
      0.026,
      0.004,
      6,
      10,
    );
  }
  // 背后拖地的破披风
  capeMesh(rig.cape, ragged, { topWidth: 0.34, bottomWidth: 0.64, length: 1.2, wrap: 0.05, flare: 0.28, folds: 4, foldDepth: 0.035 });

  // --- 双臂：破袖里伸出骨手 ---
  for (const arm of [rig.armL, rig.armR]) {
    softSeg(arm.shoulder, robe, 0.3, 0.05);
    const sleeve = mesh(new CylinderGeometry(0.055, 0.12, 0.3, 12, 1, true), ragged, arm.elbow);
    sleeve.position.y = -0.14;
    softSeg(arm.elbow, bone, 0.27, 0.016);
    softSeg(arm.elbow, bone, 0.27, 0.011).position.x = 0.02;
    ring(arm.elbow, iron, 0.026, 0.007, -0.22, 4, 10); // 腕上的铁环
    ball(arm.hand, bone, 0.03, 0, -0.02, 0, [1, 1.3, 0.7]);
    for (const a of [-0.5, 0, 0.5]) softSeg(arm.hand, bone, 0.08, 0.007).position.set(Math.sin(a) * 0.024, -0.08, 0.005);
  }

  // --- 头：兜帽下的骷髅脸，眼窝里是魂火 ---
  ball(rig.head, bone, 0.092, 0, 0.12, 0.005, [0.92, 1, 1.02]);
  box(rig.head, bone, 0.09, 0.05, 0.075, 0, 0.035, 0.035);
  box(rig.head, dark, 0.018, 0.028, 0.02, 0, 0.09, 0.09);
  for (const sx of [1, -1]) {
    ball(rig.head, dark, 0.025, sx * 0.035, 0.127, 0.075);
    ball(rig.head, glow, 0.012, sx * 0.035, 0.127, 0.088);
  }
  const h = hood(rig.head, hoodMat, { radius: 0.155, opening: 1.5, peak: 0.2 });
  h.position.y = 0.12;
  // 骨冠：兜帽外一圈向上的骨刺，正中一根最长
  const crown: ConeSpec[] = [];
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.36;
    crown.push({
      at: [Math.sin(a) * 0.15, 0.225, Math.cos(a) * 0.145],
      dir: [Math.sin(a) * 0.35, 1, Math.cos(a) * 0.2],
      radius: 0.016,
      length: i === 0 ? 0.2 : 0.14 - Math.abs(i) * 0.02,
    });
  }
  cones(rig.head, runedBone, crown, 4);
  for (let i = -2; i <= 2; i++) box(rig.head, dark, 0.006, 0.026, 0.01, i * 0.016, 0.045, 0.074); // 牙缝

  // --- 骨杖：一根长骨，杖顶一颗头骨，嘴里含着魂火 ---
  const staff = rig.weaponMount;
  staff.rotation.x += -0.5; // 竖直握持
  taperedTube(
    staff,
    runedBone,
    [
      [0, -0.9, 0],
      [0.015, -0.3, 0],
      [-0.015, 0.3, 0],
      [0, 0.82, 0],
    ],
    0.02,
    0.026,
    6,
    10,
  );
  ball(staff, bone, 0.04, 0, -0.9, 0);
  ball(staff, bone, 0.085, 0, 0.92, 0, [0.92, 1, 1.05]);
  box(staff, bone, 0.085, 0.045, 0.07, 0, 0.84, 0.03);
  for (const sx of [1, -1]) {
    ball(staff, glow, 0.02, sx * 0.032, 0.93, 0.07);
    taperedTube(
      staff,
      bone,
      [
        [sx * 0.06, 0.96, -0.02],
        [sx * 0.12, 1.04, -0.04],
        [sx * 0.1, 1.14, 0],
      ],
      0.018,
      0.004,
      5,
      6,
    );
  }
  // 杖顶的魂火缩成一小簇，头骨下吊着两串指骨
  cones(staff, glow, [{ at: [0, 1.0, 0], dir: [0, 1, 0], radius: 0.028, length: 0.13 }], 5);
  for (const sx of [1, -1]) {
    chain(staff, iron, [
      [sx * 0.05, 0.84, 0],
      [sx * 0.06, 0.66, 0],
    ], 0.011);
    softSeg(staff, bone, 0.07, 0.008).position.set(sx * 0.06, 0.66, 0);
  }
  ring(staff, iron, 0.03, 0.007, 0.78, 4, 10);

  return finishCharacter(rig, 'necromancer', 2.05, c.scale);
}

// 敌人 · 恶魔祭司：暗红长袍、高立领、裸露的恶魔头颅和一对盘角，手持顶着火盆的祭杖。
// 剪影特征：大盘角、立领、宽肩袍、带火的长杖。

import { ConeGeometry, CylinderGeometry, type Group } from 'three';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { runeStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ENEMY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, lathe, mesh, ring, robeSkirt, softSeg, taperedTube } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface DemonPriestParams extends CharacterBaseParams {
  robeColor: number;
  mantleColor: number; // 肩披、立领
  skinColor: number;
  hornColor: number;
  trimColor: number; // 金属饰件、祭杖
  glowColor: number; // 目光、符文、杖顶的火
  glowIntensity: number;
}

export const DEMON_PRIEST_DEFAULTS: DemonPriestParams = {
  scale: 1.08,
  rim: ENEMY_RIM,
  robeColor: 0x4a1210,
  mantleColor: 0x1c0a0c,
  skinColor: 0x5a2a26,
  hornColor: 0x2a211c,
  trimColor: 0x7a5a2a,
  glowColor: 0xff6a1a,
  glowIntensity: 5,
};

export function buildDemonPriest(params: Partial<DemonPriestParams> = {}): Group {
  const c = { ...DEMON_PRIEST_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.22 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const hem = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(31, 0.18) });
  const mantle = clothMaterial({ color: c.mantleColor, rim, doubleSide: true });
  const skin = leatherMaterial({ color: c.skinColor, rim });
  const horn = leatherMaterial({ color: c.hornColor, rim });
  const trim = plateMaterial({ color: c.trimColor, rim, metalness: 0.9 });
  const bone = boneSurfaceMaterial({ color: 0xcfc6ac, rim });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  const runes = glowMaterial(c.glowColor, c.glowIntensity * 0.8, {
    emissiveMap: runeStripTexture(33),
    baseColor: c.mantleColor,
    doubleSide: true,
  });

  // --- 长袍下摆、腰带、挂着的小头骨 ---
  robeSkirt(rig.hips, hem, { topRadius: 0.18, bottomRadius: 0.42, length: 0.88, folds: 8 });
  for (const leg of [rig.legL, rig.legR]) box(leg.foot, skin, 0.09, 0.07, 0.2, 0, -0.045, 0.05);
  ring(rig.hips, trim, 0.185, 0.024, 0.05, 6, 18);
  ball(rig.hips, bone, 0.05, 0.13, -0.08, 0.15, [0.9, 1, 1]);
  const sash = mesh(new CylinderGeometry(0.19, 0.2, 0.07, 22, 1, true), runes, rig.hips);
  sash.position.y = -0.03;
  sash.scale.z = 0.85;

  // --- 躯干 ---
  lathe(rig.spine, robe, [
    [0.18, 0],
    [0.16, 0.14],
    [0.172, 0.29],
  ]).scale.z = 0.85;
  lathe(rig.chest, robe, [
    [0.172, 0],
    [0.2, 0.1],
    [0.18, 0.19],
    [0.09, 0.25],
  ]).scale.z = 0.84;

  // --- 宽肩披、肩上的角刺、高立领 ---
  lathe(rig.chest, mantle, [
    [0.08, 0.275],
    [0.2, 0.225],
    [0.31, 0.13],
    [0.34, 0.05],
  ]).scale.z = 0.8;
  for (const sx of [1, -1]) {
    const spike = mesh(new ConeGeometry(0.035, 0.2, 5), horn, rig.chest);
    spike.position.set(sx * 0.27, 0.24, 0);
    spike.rotation.z = sx * -0.7;
  }
  const collar = mesh(new CylinderGeometry(0.2, 0.12, 0.26, 16, 1, true, Math.PI * 0.5, Math.PI), mantle, rig.chest);
  collar.position.set(0, 0.36, -0.02);
  // 胸前的倒三角护符
  const amulet = mesh(new ConeGeometry(0.05, 0.08, 3), trim, rig.chest);
  amulet.position.set(0, 0.13, 0.17);
  amulet.rotation.set(Math.PI, 0, 0);
  amulet.scale.z = 0.3;
  ball(rig.chest, glow, 0.016, 0, 0.14, 0.18);

  // --- 双臂：宽袖、利爪 ---
  for (const arm of [rig.armL, rig.armR]) {
    softSeg(arm.shoulder, robe, 0.3, 0.06);
    const sleeve = mesh(new CylinderGeometry(0.064, 0.14, 0.3, 14, 1, true), robe, arm.elbow);
    sleeve.position.y = -0.14;
    ball(arm.hand, skin, 0.045, 0, -0.03, 0, [1, 1.3, 0.9]);
    for (const a of [-0.5, 0, 0.5]) {
      const claw = mesh(new ConeGeometry(0.01, 0.06, 4), horn, arm.hand);
      claw.position.set(Math.sin(a) * 0.03, -0.1, 0.01);
      claw.rotation.x = Math.PI;
    }
  }

  // --- 头：恶魔脸、下颌獠牙、一对向后盘卷的大角 ---
  ball(rig.head, skin, 0.105, 0, 0.12, 0, [0.92, 1.1, 1]);
  box(rig.head, skin, 0.1, 0.07, 0.08, 0, 0.035, 0.045); // 下颌
  box(rig.head, skin, 0.16, 0.03, 0.05, 0, 0.165, 0.085).rotation.x = 0.25; // 眉骨
  for (const sx of [1, -1]) {
    const slit = box(rig.head, glow, 0.04, 0.012, 0.02, sx * 0.04, 0.135, 0.092);
    slit.rotation.z = sx * -0.3;
    const tusk = mesh(new ConeGeometry(0.011, 0.05, 4), bone, rig.head);
    tusk.position.set(sx * 0.035, 0.065, 0.085);
    taperedTube(
      rig.head,
      horn,
      [
        [sx * 0.07, 0.2, -0.01],
        [sx * 0.17, 0.3, -0.06],
        [sx * 0.25, 0.27, -0.16],
        [sx * 0.25, 0.14, -0.19],
        [sx * 0.19, 0.07, -0.1],
      ],
      0.045,
      0.008,
      7,
      16,
    );
  }

  // --- 祭杖：铁杖顶着一个燃烧的小火盆 ---
  const staff = rig.weaponMount;
  staff.rotation.x += -0.5; // 竖直握持
  mesh(new CylinderGeometry(0.018, 0.02, 1.7, 8), trim, staff).position.y = -0.05;
  lathe(staff, trim, [
    [0.03, 0.8],
    [0.1, 0.85],
    [0.12, 0.93],
  ]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const prong = mesh(new ConeGeometry(0.014, 0.12, 4), trim, staff);
    prong.position.set(Math.cos(a) * 0.115, 0.98, Math.sin(a) * 0.115);
  }
  ball(staff, glow, 0.07, 0, 0.95, 0, [1, 1.25, 1]);
  mesh(new ConeGeometry(0.045, 0.16, 6), glow, staff).position.y = 1.08;

  return finishCharacter(rig, 'demonPriest', 2.0, c.scale);
}

// 敌人 · 骷髅兵：一副骨架，戴锈铁盔，右手锈剑，左臂圆盾。剪影特征：细、空、能看穿的肋骨。

import { CylinderGeometry, type Group } from 'three';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { tatterAlphaTexture } from '../../textures/sprites';
import { ENEMY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, capeMesh, lathe, mesh, ring, seg } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface SkeletonParams extends CharacterBaseParams {
  boneColor: number;
  ironColor: number; // 锈铁：头盔、剑、盾箍
  clothColor: number; // 腰间破布
  woodColor: number; // 盾面
  eyeColor: number;
  eyeIntensity: number;
}

export const SKELETON_DEFAULTS: SkeletonParams = {
  scale: 1,
  rim: ENEMY_RIM,
  boneColor: 0xcfc6ac,
  ironColor: 0x6a5546,
  clothColor: 0x3a1512,
  woodColor: 0x3d2c20,
  eyeColor: 0xff3a1a,
  eyeIntensity: 5,
};

export function buildSkeletonSoldier(params: Partial<SkeletonParams> = {}): Group {
  const c = { ...SKELETON_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.2 });
  const rim = c.rim;
  const bone = boneSurfaceMaterial({ color: c.boneColor, rim });
  const iron = plateMaterial({ color: c.ironColor, rim, metalness: 0.7 });
  const cloth = clothMaterial({ color: c.clothColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(21, 0.4) });
  const wood = leatherMaterial({ color: c.woodColor, rim });
  const dark = clothMaterial({ color: 0x050505 });
  const eye = glowMaterial(c.eyeColor, c.eyeIntensity);

  // --- 骨盆与腰间破布 ---
  box(rig.hips, bone, 0.25, 0.09, 0.13, 0, 0, 0);
  for (const sx of [1, -1]) ball(rig.hips, bone, 0.062, sx * 0.1, -0.01, 0, [1, 1.2, 0.8]);
  const front = capeMesh(rig.hips, cloth, { topWidth: 0.2, bottomWidth: 0.24, length: 0.42, wrap: 0, flare: -0.04 });
  front.position.set(0, 0.02, 0.075);
  const back = capeMesh(rig.hips, cloth, { topWidth: 0.22, bottomWidth: 0.3, length: 0.5, wrap: 0, flare: 0.08 });
  back.position.set(0, 0.02, -0.075);
  ring(rig.hips, wood, 0.13, 0.02, 0.045, 5, 14).scale.set(1, 0.65, 1);

  // --- 脊柱与肋骨 ---
  for (let i = 0; i < 5; i++) ball(rig.spine, bone, 0.032, 0, 0.04 + i * 0.062, -0.02, [1, 0.8, 1]);
  for (let i = 0; i < 4; i++) {
    const r = 0.11 + 0.035 * Math.sin(((i + 0.6) / 4) * Math.PI);
    const rib = ring(rig.chest, bone, r, 0.012, -0.02 + i * 0.058, 5, 16);
    rib.scale.set(1, 0.72, 1); // ring 平放后局部 y 对应前后方向
  }
  box(rig.chest, bone, 0.035, 0.2, 0.02, 0, 0.07, 0.098); // 胸骨
  box(rig.chest, bone, 0.4, 0.026, 0.03, 0, 0.2, 0.03); // 锁骨
  seg(rig.neck, bone, 0.09, 0.024, 0.028, 6).position.y = 0.06;

  // --- 双臂 ---
  for (const arm of [rig.armL, rig.armR]) {
    ball(arm.shoulder, bone, 0.036);
    seg(arm.shoulder, bone, 0.29, 0.024, 0.02, 6);
    ball(arm.elbow, bone, 0.028);
    seg(arm.elbow, bone, 0.27, 0.02, 0.016, 6);
    box(arm.hand, bone, 0.05, 0.085, 0.028, 0, -0.04, 0);
  }
  // 右肩残留的一片锈肩甲
  const pad = ball(rig.armR.shoulder, iron, 0.075, -0.02, 0.02, 0, [1.1, 0.8, 1.15]);
  pad.rotation.z = 0.4;

  // --- 双腿 ---
  for (const leg of [rig.legL, rig.legR]) {
    seg(leg.hip, bone, 0.42, 0.03, 0.024, 6);
    ball(leg.knee, bone, 0.036);
    seg(leg.knee, bone, 0.4, 0.026, 0.019, 6);
    box(leg.foot, bone, 0.065, 0.035, 0.2, 0, -0.02, 0.05);
  }

  // --- 头骨与锈铁盔 ---
  ball(rig.head, bone, 0.1, 0, 0.125, 0, [0.92, 1, 1.05]);
  box(rig.head, bone, 0.105, 0.055, 0.085, 0, 0.03, 0.035); // 下颌
  for (let i = -2; i <= 2; i++) box(rig.head, dark, 0.006, 0.03, 0.01, i * 0.018, 0.045, 0.079); // 牙缝
  for (const sx of [1, -1]) {
    ball(rig.head, dark, 0.026, sx * 0.037, 0.13, 0.079);
    ball(rig.head, eye, 0.011, sx * 0.037, 0.13, 0.092);
  }
  box(rig.head, dark, 0.02, 0.03, 0.02, 0, 0.09, 0.098); // 鼻孔
  lathe(
    rig.head,
    iron,
    [
      [0.001, 0.262],
      [0.06, 0.25],
      [0.105, 0.2],
      [0.114, 0.14],
      [0.128, 0.13],
    ],
    14,
  );
  box(rig.head, iron, 0.022, 0.1, 0.02, 0, 0.14, 0.108); // 护鼻

  // --- 右手锈剑 ---
  const sword = rig.weaponMount;
  mesh(new CylinderGeometry(0.016, 0.018, 0.16, 6), wood, sword);
  box(sword, iron, 0.03, 0.03, 0.16, 0, 0.09, 0);
  box(sword, iron, 0.012, 0.66, 0.05, 0, 0.44, 0);
  box(sword, iron, 0.01, 0.07, 0.03, 0, 0.8, 0).rotation.x = 0.5; // 缺了口的剑尖

  // --- 左臂圆盾 ---
  const shield = mesh(new CylinderGeometry(0.21, 0.21, 0.025, 18), wood, rig.armL.elbow);
  shield.rotation.z = Math.PI / 2;
  shield.position.set(0.045, -0.14, 0.02);
  const rimRing = ring(rig.armL.elbow, iron, 0.21, 0.014, 0, 5, 18);
  rimRing.rotation.set(0, Math.PI / 2, 0);
  rimRing.position.copy(shield.position);
  ball(rig.armL.elbow, iron, 0.055, 0.062, -0.14, 0.02, [0.6, 1, 1]);

  return finishCharacter(rig, 'skeletonSoldier', 1.8, c.scale);
}

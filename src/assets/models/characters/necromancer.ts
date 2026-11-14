// 敌人 · 亡灵法师：破烂的黑绿长袍，兜帽下是一张骷髅脸，背后伸出一扇弯曲的骨刺，手持骷髅头骨杖。
// 剪影特征：背后的骨刺扇、烂成条的下摆、杖顶的头骨。

import { CylinderGeometry, type Group } from 'three';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial } from '../../materials';
import { tatterAlphaTexture } from '../../textures/sprites';
import { ENEMY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, capeMesh, hood, lathe, mesh, ring, robeSkirt, softSeg, taperedTube } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface NecromancerParams extends CharacterBaseParams {
  robeColor: number;
  hoodColor: number;
  boneColor: number;
  glowColor: number; // 魂火：目光、杖顶
  glowIntensity: number;
}

export const NECROMANCER_DEFAULTS: NecromancerParams = {
  scale: 1.05,
  rim: ENEMY_RIM,
  robeColor: 0x1c2a22,
  hoodColor: 0x0e1512,
  boneColor: 0xcfc6ac,
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

  // --- 烂成条的长袍下摆，外面再罩一层更短的破布 ---
  robeSkirt(rig.hips, ragged, { topRadius: 0.16, bottomRadius: 0.38, length: 0.9, folds: 11 });
  robeSkirt(rig.hips, ragged, { topRadius: 0.175, bottomRadius: 0.33, length: 0.55, folds: 7 }).rotation.y = 0.6;
  for (const leg of [rig.legL, rig.legR]) box(leg.foot, leather, 0.085, 0.06, 0.19, 0, -0.04, 0.05);
  // 腰间一串小头骨
  ring(rig.hips, leather, 0.172, 0.018, 0.04, 5, 16);
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
  for (let i = 0; i < 3; i++) box(rig.chest, bone, 0.17 - i * 0.03, 0.014, 0.02, 0, 0.15 - i * 0.045, 0.128 - i * 0.004);

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
  capeMesh(rig.cape, ragged, { topWidth: 0.34, bottomWidth: 0.6, length: 1.2, wrap: 0.05, flare: 0.28 });

  // --- 双臂：破袖里伸出骨手 ---
  for (const arm of [rig.armL, rig.armR]) {
    softSeg(arm.shoulder, robe, 0.3, 0.05);
    const sleeve = mesh(new CylinderGeometry(0.055, 0.12, 0.3, 12, 1, true), ragged, arm.elbow);
    sleeve.position.y = -0.14;
    softSeg(arm.elbow, bone, 0.27, 0.016);
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

  // --- 骨杖：一根长骨，杖顶一颗头骨，嘴里含着魂火 ---
  const staff = rig.weaponMount;
  staff.rotation.x += -0.5; // 竖直握持
  taperedTube(
    staff,
    bone,
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
  ball(staff, glow, 0.045, 0, 1.08, 0, [0.8, 1.4, 0.8]);

  return finishCharacter(rig, 'necromancer', 2.05, c.scale);
}

// 封印系 · 缚魂祭司：暗色祭司装、高冠面具、缠身锁链与发光符文。剪影特征：瘦高，尖顶高冠，锁链垂挂。

import { ConeGeometry, CylinderGeometry, PlaneGeometry, type Group } from 'three';
import { clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { runeStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, capeMesh, chain, lathe, mesh, pauldron, ring, robeSkirt, seg, softSeg } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface SealerParams extends CharacterBaseParams {
  robeColor: number; // 祭司袍
  stoleColor: number; // 圣带底色
  chainColor: number; // 锁链与面具
  leatherColor: number;
  glowColor: number; // 符文与目光
  glowIntensity: number;
}

export const SEALER_DEFAULTS: SealerParams = {
  scale: 0.98,
  rim: ALLY_RIM,
  robeColor: 0x2a2136,
  stoleColor: 0x1b1026,
  chainColor: 0x9aa0ac,
  leatherColor: 0x2a2024,
  glowColor: 0xb44dff,
  glowIntensity: 3.4,
};

export function buildSealer(params: Partial<SealerParams> = {}): Group {
  const c = { ...SEALER_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.21 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const hem = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(7, 0.16) });
  const silver = plateMaterial({ color: c.chainColor, rim, metalness: 0.9 });
  const darkMetal = plateMaterial({ color: 0x4a4852, rim, metalness: 0.8 });
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const runes = glowMaterial(c.glowColor, c.glowIntensity, {
    emissiveMap: runeStripTexture(4),
    baseColor: c.stoleColor,
    doubleSide: true,
  });
  const glow = glowMaterial(c.glowColor, c.glowIntensity * 1.5);

  // --- 下摆：到小腿的窄袍，露出长靴 ---
  robeSkirt(rig.hips, hem, { topRadius: 0.165, bottomRadius: 0.31, length: 0.74, folds: 7 });
  for (const leg of [rig.legL, rig.legR]) {
    softSeg(leg.hip, leather, 0.42, 0.07);
    seg(leg.knee, leather, 0.4, 0.068, 0.055);
    box(leg.foot, leather, 0.095, 0.08, 0.23, 0, -0.04, 0.05);
  }

  // --- 躯干：贴身祭司袍、高立领 ---
  lathe(rig.spine, robe, [
    [0.168, 0],
    [0.148, 0.14],
    [0.155, 0.29],
  ]).scale.z = 0.85;
  lathe(rig.chest, robe, [
    [0.155, 0],
    [0.178, 0.1],
    [0.165, 0.19],
    [0.09, 0.245],
  ]).scale.z = 0.82;
  mesh(new CylinderGeometry(0.135, 0.09, 0.13, 16, 1, true), robe, rig.chest).position.y = 0.3;

  // --- 圣带：从颈部垂到膝下的符文长带 ---
  const stole = mesh(new PlaneGeometry(1.0, 0.1), runes, rig.spine);
  stole.rotation.order = 'YXZ';
  stole.rotation.set(-0.1, 0, Math.PI / 2);
  stole.position.set(0, -0.02, 0.205);

  // --- 锁链：胸前交叉、腰间垂挂符文牌、手腕镣铐 ---
  chain(rig.chest, silver, [
    [-0.185, 0.2, 0.06],
    [-0.09, 0.1, 0.16],
    [0.05, -0.04, 0.175],
    [0.17, -0.17, 0.09],
  ]);
  chain(rig.chest, silver, [
    [0.185, 0.2, 0.06],
    [0.09, 0.1, 0.165],
    [-0.05, -0.04, 0.18],
    [-0.17, -0.17, 0.09],
  ]);
  ring(rig.hips, silver, 0.176, 0.018, 0.05, 5, 20);
  for (const [x, len] of [
    [0.15, 0.3],
    [-0.13, 0.42],
  ] as const) {
    chain(rig.hips, silver, [
      [x, 0.04, 0.11],
      [x * 1.2, -len, 0.15],
    ]);
    const tablet = box(rig.hips, runes, 0.075, 0.11, 0.018, x * 1.2, -len - 0.07, 0.15);
    tablet.rotation.z = x > 0 ? 0.1 : -0.12;
  }

  // --- 双臂：窄袖、护腕、镣铐与垂链；左肩单侧带刺肩甲 ---
  for (const arm of [rig.armL, rig.armR]) {
    softSeg(arm.shoulder, robe, 0.3, 0.056);
    softSeg(arm.elbow, robe, 0.25, 0.05);
    seg(arm.elbow, darkMetal, 0.1, 0.057, 0.052).position.y = -0.2;
    ring(arm.elbow, silver, 0.058, 0.012, -0.25, 5, 14);
    chain(arm.elbow, silver, [
      [0, -0.26, 0.05],
      [0, -0.42, 0.06],
    ]);
    ball(arm.hand, leather, 0.042, 0, -0.03, 0, [1, 1.3, 0.9]);
  }
  const p = pauldron(rig.armL.shoulder, darkMetal, 0.12, [1.1, 0.9, 1.15]);
  p.position.set(0.03, 0.03, 0);
  p.rotation.z = -0.45;
  const spike = mesh(new ConeGeometry(0.03, 0.17, 6), silver, rig.armL.shoulder);
  spike.position.set(0.09, 0.15, 0);
  spike.rotation.z = -0.6;

  // --- 头：金属面具（两道发光眼缝）、尖顶高冠、后垂头纱 ---
  ball(rig.head, darkMetal, 0.105, 0, 0.11, 0.005, [0.95, 1.15, 1]);
  for (const sx of [1, -1]) {
    const slit = box(rig.head, glow, 0.045, 0.012, 0.02, sx * 0.04, 0.125, 0.097);
    slit.rotation.z = sx * -0.25;
  }
  const mitre = lathe(
    rig.head,
    robe,
    [
      [0.118, 0.17],
      [0.128, 0.24],
      [0.105, 0.38],
      [0.04, 0.47],
      [0.001, 0.49],
    ],
    16,
  );
  mitre.scale.z = 0.72;
  const band = mesh(new CylinderGeometry(0.13, 0.121, 0.05, 20, 1, true), runes, rig.head);
  band.position.y = 0.2;
  band.scale.z = 0.74;
  const veil = capeMesh(rig.head, hem, { topWidth: 0.2, bottomWidth: 0.34, length: 0.55, wrap: 0.1, flare: 0.12 });
  veil.position.set(0, 0.2, -0.08);

  return finishCharacter(rig, 'sealer', 1.98, c.scale);
}

// 敌人 · 骷髅兵：一副骨架，戴锈铁盔，右手锈剑，左臂圆盾。剪影特征：细、空、能看穿的肋骨，背后一面破旗。
// 步骤 10 细化：骨白 + 橙褐锈铁 + 灰青破布 + 朽木四种质感；六对肋骨、肩胛、髋骨翼，盔顶尖刺和裂口，
// 带铆钉的残破肩甲，腕上断链，背后的破旗，盾面有铁箍、盾钉和刻痕；眼窝和剑刃是幽冷的青白光。

import { CylinderGeometry, type Group } from 'three';
import { ENEMY_RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { runeSpeckTexture, tatterAlphaTexture } from '../../textures/sprites';
import { boneTextures } from '../../textures/surfaces';
import { finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, capeMesh, chain, cones, lathe, mesh, ring, rivetRing, rivets, seg } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface SkeletonParams extends CharacterBaseParams {
  boneColor: number;
  ironColor: number; // 锈铁：头盔、剑、盾箍
  clothColor: number; // 腰间破布、破旗
  woodColor: number; // 盾面
  eyeColor: number; // 眼窝、剑刃的幽光
  eyeIntensity: number;
}

export const SKELETON_DEFAULTS: SkeletonParams = {
  scale: 1,
  rim: ENEMY_RIM_CONFIG.skeleton,
  boneColor: 0xd8d2bc,
  ironColor: 0x9a6038,
  clothColor: 0x39484a,
  woodColor: 0x5a4028,
  eyeColor: 0x9fe8ff,
  eyeIntensity: 4,
};

export function buildSkeletonSoldier(params: Partial<SkeletonParams> = {}): Group {
  const c = { ...SKELETON_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.2 });
  const rim = c.rim;
  const bone = boneSurfaceMaterial({ color: c.boneColor, rim });
  const iron = plateMaterial({ color: c.ironColor, rim, metalness: 0.7 });
  const darkIron = plateMaterial({ color: 0x3c3a3c, rim, metalness: 0.8 });
  const cloth = clothMaterial({ color: c.clothColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(21, 0.4) });
  const flag = clothMaterial({ color: c.clothColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(22, 0.55) });
  const wood = leatherMaterial({ color: c.woodColor, rim });
  const dark = clothMaterial({ color: 0x050505 });
  const eye = glowMaterial(c.eyeColor, c.eyeIntensity);
  const edge = glowMaterial(c.eyeColor, c.eyeIntensity * 0.45); // 剑刃边缘的细光线
  // 刻着符文的骨头（额头、胸骨）
  const runedBone = glowMaterial(c.eyeColor, c.eyeIntensity * 0.35, {
    emissiveMap: runeSpeckTexture(21, 40),
    baseColor: c.boneColor,
    surface: boneTextures(),
    rim,
  });

  // --- 骨盆（带两片髋骨翼）与腰间破布、朽皮带 ---
  box(rig.hips, bone, 0.25, 0.09, 0.13, 0, 0, 0);
  for (const sx of [1, -1]) {
    ball(rig.hips, bone, 0.062, sx * 0.1, -0.01, 0, [1, 1.2, 0.8]);
    const wing = ball(rig.hips, bone, 0.08, sx * 0.13, 0.05, -0.02, [0.45, 1, 1.1]);
    wing.rotation.z = sx * -0.35;
  }
  const front = capeMesh(rig.hips, cloth, { topWidth: 0.2, bottomWidth: 0.24, length: 0.42, wrap: 0, flare: -0.04 });
  front.position.set(0, 0.02, 0.075);
  const back = capeMesh(rig.hips, cloth, { topWidth: 0.22, bottomWidth: 0.3, length: 0.5, wrap: 0, flare: 0.08 });
  back.position.set(0, 0.02, -0.075);
  ring(rig.hips, wood, 0.13, 0.02, 0.045, 5, 14).scale.set(1, 0.65, 1);
  box(rig.hips, iron, 0.05, 0.05, 0.02, 0, 0.045, 0.09); // 锈带扣
  chain(rig.hips, darkIron, [
    [0.12, 0.04, 0.05],
    [0.15, -0.2, 0.07],
  ], 0.014);

  // --- 脊柱（带棘突）与六对肋骨、胸骨、锁骨、肩胛 ---
  for (let i = 0; i < 5; i++) ball(rig.spine, bone, 0.032, 0, 0.04 + i * 0.062, -0.02, [1, 0.8, 1]);
  cones(
    rig.spine,
    bone,
    [0, 1, 2, 3, 4].map((i) => ({ at: [0, 0.04 + i * 0.062, -0.04] as [number, number, number], dir: [0, 0.3, -1] as [number, number, number], radius: 0.012, length: 0.05 })),
    4,
  );
  for (let i = 0; i < 6; i++) {
    const r = 0.1 + 0.045 * Math.sin(((i + 0.6) / 6) * Math.PI);
    const rib = ring(rig.chest, bone, r, 0.011, -0.05 + i * 0.044, 5, 16);
    rib.scale.set(1, 0.72, 1); // ring 平放后局部 y 对应前后方向
  }
  box(rig.chest, runedBone, 0.04, 0.22, 0.02, 0, 0.06, 0.1); // 胸骨
  box(rig.chest, bone, 0.4, 0.026, 0.03, 0, 0.2, 0.03); // 锁骨
  for (const sx of [1, -1]) {
    const blade = ball(rig.chest, bone, 0.075, sx * 0.1, 0.12, -0.09, [0.9, 1.1, 0.25]); // 肩胛骨
    blade.rotation.z = sx * 0.3;
  }
  seg(rig.neck, bone, 0.09, 0.024, 0.028, 6).position.y = 0.06;

  // --- 背后的破旗：歪斜的旗杆 + 撕烂的旗面（挂在披风挂点上） ---
  const pole = mesh(new CylinderGeometry(0.012, 0.014, 1.15, 6), wood, rig.chest);
  pole.position.set(-0.06, 0.42, -0.12);
  pole.rotation.set(-0.12, 0, 0.1);
  cones(rig.chest, iron, [{ at: [-0.115, 0.98, -0.19], dir: [-0.1, 1, -0.12], radius: 0.02, length: 0.1 }], 4);
  const banner = capeMesh(rig.cape, flag, { topWidth: 0.3, bottomWidth: 0.34, length: 0.62, wrap: 0, flare: 0.1, folds: 3, foldDepth: 0.03 });
  banner.position.set(-0.25, 0.66, -0.1);
  banner.rotation.set(0, 0.25, 0);
  box(rig.cape, wood, 0.32, 0.018, 0.018, -0.25, 0.66, -0.1).rotation.y = 0.25; // 横杆

  // --- 双臂：肱骨、桡骨尺骨两根、指骨 ---
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    ball(arm.shoulder, bone, 0.036);
    seg(arm.shoulder, bone, 0.29, 0.024, 0.02, 6);
    ball(arm.elbow, bone, 0.028);
    seg(arm.elbow, bone, 0.27, 0.016, 0.013, 6).position.x = sx * 0.01;
    seg(arm.elbow, bone, 0.27, 0.013, 0.011, 6).position.x = sx * -0.012;
    box(arm.hand, bone, 0.05, 0.05, 0.028, 0, -0.025, 0);
    cones(
      arm.hand,
      bone,
      [-0.018, -0.006, 0.006, 0.018].map((x) => ({ at: [x, -0.045, 0] as [number, number, number], dir: [x * 2, -1, 0.5] as [number, number, number], radius: 0.007, length: 0.06 })),
      4,
    );
  }
  // 右腕上的铁镣和断链
  ring(rig.armR.elbow, darkIron, 0.026, 0.008, -0.22, 4, 10);
  chain(rig.armR.elbow, darkIron, [
    [0, -0.23, 0.02],
    [0, -0.36, 0.03],
  ], 0.012);
  // 右肩残留的锈肩甲：两层 + 铆钉 + 一根断刺
  const pad = ball(rig.armR.shoulder, iron, 0.08, -0.02, 0.02, 0, [1.1, 0.8, 1.15]);
  pad.rotation.z = 0.4;
  const pad2 = ball(rig.armR.shoulder, darkIron, 0.062, -0.06, -0.035, 0, [1.05, 0.75, 1.1]);
  pad2.rotation.z = 0.8;
  rivets(rig.armR.shoulder, darkIron, [
    [-0.03, 0.075, 0.06],
    [-0.03, 0.075, -0.06],
    [-0.085, 0.03, 0],
  ]);
  cones(rig.armR.shoulder, iron, [{ at: [-0.05, 0.07, 0], dir: [-0.5, 1, 0], radius: 0.018, length: 0.09 }], 4);

  // --- 双腿：股骨、胫骨腓骨、足骨 ---
  for (const leg of [rig.legL, rig.legR]) {
    seg(leg.hip, bone, 0.42, 0.03, 0.024, 6);
    ball(leg.knee, bone, 0.036);
    seg(leg.knee, bone, 0.4, 0.022, 0.017, 6);
    seg(leg.knee, bone, 0.38, 0.012, 0.01, 6).position.set(0.022, -0.2, -0.01);
    box(leg.foot, bone, 0.065, 0.035, 0.12, 0, -0.02, 0.01);
    cones(
      leg.foot,
      bone,
      [-0.022, 0, 0.022].map((x) => ({ at: [x, -0.025, 0.06] as [number, number, number], dir: [x, -0.1, 1] as [number, number, number], radius: 0.012, length: 0.1 })),
      4,
    );
  }
  // 左小腿上残留的一片锈胫甲
  seg(rig.legL.knee, iron, 0.2, 0.04, 0.032, 6).position.set(0, -0.16, 0.012);

  // --- 头骨（额头刻符）与锈铁盔：盔顶尖刺、护鼻、护颊、盔沿铆钉 ---
  ball(rig.head, runedBone, 0.1, 0, 0.125, 0, [0.92, 1, 1.05]);
  box(rig.head, bone, 0.105, 0.055, 0.085, 0, 0.03, 0.035); // 下颌
  for (let i = -2; i <= 2; i++) box(rig.head, dark, 0.006, 0.03, 0.01, i * 0.018, 0.045, 0.079); // 牙缝
  for (const sx of [1, -1]) {
    ball(rig.head, dark, 0.026, sx * 0.037, 0.13, 0.079);
    ball(rig.head, eye, 0.011, sx * 0.037, 0.13, 0.092);
    box(rig.head, bone, 0.02, 0.03, 0.05, sx * 0.085, 0.09, 0.03); // 颧骨
    const cheek = box(rig.head, iron, 0.012, 0.11, 0.07, sx * 0.108, 0.1, 0.02); // 护颊
    cheek.rotation.z = sx * -0.12;
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
  ring(rig.head, darkIron, 0.122, 0.009, 0.135, 4, 16);
  rivetRing(rig.head, darkIron, 0.118, 8, 0.16, 0.008);
  cones(rig.head, iron, [{ at: [0, 0.255, 0], dir: [0, 1, -0.15], radius: 0.022, length: 0.12 }], 5);
  box(rig.head, dark, 0.012, 0.07, 0.03, 0.05, 0.22, 0.085).rotation.z = 0.5; // 盔上的裂口

  // --- 右手锈剑：缺口的剑身，刃口一条幽冷的细光线 ---
  const sword = rig.weaponMount;
  mesh(new CylinderGeometry(0.016, 0.018, 0.16, 6), wood, sword);
  ball(sword, darkIron, 0.024, 0, -0.09, 0);
  box(sword, darkIron, 0.03, 0.03, 0.18, 0, 0.09, 0);
  box(sword, iron, 0.012, 0.66, 0.05, 0, 0.44, 0);
  box(sword, iron, 0.01, 0.07, 0.03, 0, 0.8, 0).rotation.x = 0.5; // 缺了口的剑尖
  box(sword, dark, 0.014, 0.03, 0.02, 0, 0.5, 0.022).rotation.x = 0.6; // 刃上的缺口
  box(sword, edge, 0.005, 0.62, 0.006, 0, 0.44, 0.026);
  box(sword, edge, 0.005, 0.62, 0.006, 0, 0.44, -0.026);

  // --- 左臂圆盾：朽木盾面、铁箍、盾钉、十字铁条和刻痕 ---
  const shield = mesh(new CylinderGeometry(0.21, 0.21, 0.025, 18), wood, rig.armL.elbow);
  shield.rotation.z = Math.PI / 2;
  shield.position.set(0.045, -0.14, 0.02);
  const rimRing = ring(rig.armL.elbow, iron, 0.21, 0.014, 0, 5, 18);
  rimRing.rotation.set(0, Math.PI / 2, 0);
  rimRing.position.copy(shield.position);
  ball(rig.armL.elbow, iron, 0.055, 0.062, -0.14, 0.02, [0.6, 1, 1]);
  box(rig.armL.elbow, darkIron, 0.008, 0.4, 0.03, 0.06, -0.14, 0.02);
  box(rig.armL.elbow, darkIron, 0.008, 0.03, 0.4, 0.06, -0.14, 0.02);
  const studs: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    studs.push([0.062, -0.14 + Math.cos(a) * 0.17, 0.02 + Math.sin(a) * 0.17]);
  }
  rivets(rig.armL.elbow, darkIron, studs, 0.012);
  box(rig.armL.elbow, dark, 0.006, 0.16, 0.012, 0.06, -0.08, 0.1).rotation.x = 0.7; // 盾面的刀痕

  return finishCharacter(rig, 'skeletonSoldier', 1.8, c.scale);
}

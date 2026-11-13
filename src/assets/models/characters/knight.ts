// 物理系 · 重甲骑士：宽肩重甲、桶盔带盔鳍、长披风。剪影特征：宽、方、盔顶有鳍。

import { ConeGeometry, type Group } from 'three';
import { clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, capeMesh, extruded, lathe, mesh, pauldron, ring, seg, softSeg } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface KnightParams extends CharacterBaseParams {
  plateColor: number; // 主甲片
  darkPlateColor: number; // 内衬甲/锁甲
  trimColor: number; // 镶边（旧金）
  clothColor: number; // 披风、战袍
  leatherColor: number;
  eyeColor: number; // 面甲缝隙里的目光
  eyeIntensity: number;
}

export const KNIGHT_DEFAULTS: KnightParams = {
  scale: 1.02,
  rim: ALLY_RIM,
  plateColor: 0x8a8f9c,
  darkPlateColor: 0x3a3d45,
  trimColor: 0xa8843c,
  clothColor: 0x6e1612,
  leatherColor: 0x4a3222,
  eyeColor: 0xff7a2a,
  eyeIntensity: 5,
};

export function buildKnight(params: Partial<KnightParams> = {}): Group {
  const c = { ...KNIGHT_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.27, hipWidth: 0.11 });
  const rim = c.rim;
  const plate = plateMaterial({ color: c.plateColor, rim });
  const dark = plateMaterial({ color: c.darkPlateColor, rim, metalness: 0.6 });
  const trim = plateMaterial({ color: c.trimColor, rim, metalness: 0.95 });
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const cloth = clothMaterial({ color: c.clothColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(3) });
  const eye = glowMaterial(c.eyeColor, c.eyeIntensity);

  // --- 髋部：腰甲、腰带、裙甲、战袍 ---
  box(rig.hips, dark, 0.31, 0.16, 0.21, 0, -0.02, 0);
  ring(rig.hips, leather, 0.178, 0.032, 0.07, 6, 18);
  box(rig.hips, trim, 0.075, 0.075, 0.03, 0, 0.07, 0.19);
  for (const sx of [1, -1]) {
    const tasset = box(rig.hips, plate, 0.15, 0.27, 0.03, sx * 0.135, -0.18, 0.105);
    tasset.rotation.set(-0.14, 0, sx * 0.1);
    const side = box(rig.hips, plate, 0.03, 0.25, 0.17, sx * 0.19, -0.17, 0);
    side.rotation.z = sx * 0.16;
    box(rig.hips, trim, 0.152, 0.02, 0.034, sx * 0.135, -0.3, 0.125).rotation.set(-0.14, 0, sx * 0.1);
  }
  const tabard = capeMesh(rig.hips, cloth, { topWidth: 0.19, bottomWidth: 0.22, length: 0.5, wrap: 0, flare: -0.05 });
  tabard.position.set(0, 0.02, 0.135);

  // --- 腰腹与胸甲 ---
  lathe(rig.spine, dark, [
    [0.175, 0],
    [0.155, 0.14],
    [0.17, 0.29],
  ]);
  ball(rig.chest, plate, 0.2, 0, 0.09, 0.015, [1.14, 1.0, 0.9]);
  box(rig.chest, trim, 0.022, 0.21, 0.02, 0, 0.09, 0.19);
  ring(rig.chest, trim, 0.2, 0.014, -0.02, 5, 20).scale.set(1.12, 0.9, 1);
  lathe(rig.chest, plate, [
    [0.14, 0.19],
    [0.105, 0.25],
    [0.095, 0.31],
  ]);

  // --- 双臂：两层肩甲 + 尖刺、臂甲、护肘、手甲 ---
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    const p1 = pauldron(arm.shoulder, plate, 0.14, [1.15, 0.85, 1.2]);
    p1.position.set(sx * 0.035, 0.025, 0);
    p1.rotation.z = sx * -0.4;
    const p2 = pauldron(arm.shoulder, dark, 0.118, [1.1, 0.85, 1.15]);
    p2.position.set(sx * 0.085, -0.055, 0);
    p2.rotation.z = sx * -0.8;
    const spike = mesh(new ConeGeometry(0.032, 0.15, 6), trim, arm.shoulder);
    spike.position.set(sx * 0.09, 0.145, 0);
    spike.rotation.z = sx * -0.55;

    softSeg(arm.shoulder, dark, 0.29, 0.068);
    ball(arm.elbow, plate, 0.072, 0, 0, -0.01);
    seg(arm.elbow, plate, 0.25, 0.074, 0.058).position.y = -0.135;
    ring(arm.elbow, trim, 0.062, 0.01, -0.25, 5, 12);
    box(arm.hand, dark, 0.095, 0.11, 0.1, 0, -0.05, 0);
  }

  // --- 双腿：腿甲、护膝、胫甲、铁靴 ---
  for (const leg of [rig.legL, rig.legR]) {
    softSeg(leg.hip, dark, 0.42, 0.094);
    seg(leg.hip, plate, 0.3, 0.108, 0.09).position.set(0, -0.2, 0.012);
    ball(leg.knee, plate, 0.086, 0, 0, 0.025, [1, 1.1, 1]);
    seg(leg.knee, plate, 0.37, 0.084, 0.066).position.y = -0.2;
    box(leg.foot, plate, 0.13, 0.085, 0.27, 0, -0.038, 0.055);
    box(leg.foot, trim, 0.132, 0.02, 0.06, 0, -0.07, 0.165);
  }

  // --- 头：桶盔、T 形面甲缝、盔鳍 ---
  lathe(
    rig.head,
    plate,
    [
      [0.001, 0.275],
      [0.06, 0.268],
      [0.11, 0.235],
      [0.136, 0.16],
      [0.14, 0.05],
      [0.132, -0.03],
      [0.145, -0.06],
    ],
    18,
  );
  box(rig.head, eye, 0.18, 0.02, 0.02, 0, 0.125, 0.128); // 横向视缝
  box(rig.head, trim, 0.026, 0.2, 0.03, 0, 0.09, 0.136); // 竖向鼻梁
  ring(rig.head, trim, 0.142, 0.012, 0.05, 5, 20);
  const fin = extruded(
    rig.head,
    cloth,
    [
      [-0.15, 0.2],
      [-0.12, 0.34],
      [-0.02, 0.4],
      [0.09, 0.37],
      [0.15, 0.26],
      [0.08, 0.275],
      [0, 0.28],
      [-0.08, 0.255],
    ],
    0.02,
  );
  fin.rotation.y = -Math.PI / 2; // 轮廓的 x 轴转到前后方向

  // --- 披风 ---
  capeMesh(rig.cape, cloth, { topWidth: 0.5, bottomWidth: 0.78, length: 1.12, wrap: 0.07, flare: 0.3 });

  return finishCharacter(rig, 'knight', 1.9, c.scale);
}

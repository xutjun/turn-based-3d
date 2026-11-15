// 敌人 · 堕落骑士：发黑的重甲，盔上一对弯角，破烂的灰黑披风，手持一把宽刃大剑。
// 甲胄复用重甲骑士的 builder（换配色、去掉盔鳍），再加上弯角、背刺和大剑。
// 步骤 10 细化：黑铁 + 锈铜镶边 + 灰青破披风，不再是红色；更大的弯角、肩刺、背刺，
// 胸前和肩上的符文刻痕，腰间头骨、臂上断链；大剑两侧刃口是琥珀色的细光线。

import { ConeGeometry, CylinderGeometry, type Group } from 'three';
import { ENEMY_RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { runeSpeckTexture } from '../../textures/sprites';
import { plateTextures } from '../../textures/surfaces';
import { type CharacterBaseParams } from './common';
import { buildKnight } from './knight';
import { ball, box, chain, cones, mesh, taperedTube } from './parts';
import { getRig, setRigHeight } from './rig';

export interface FallenKnightParams extends CharacterBaseParams {
  plateColor: number;
  darkPlateColor: number;
  trimColor: number;
  clothColor: number;
  hornColor: number;
  eyeColor: number; // 目光、符文刻痕与剑刃的光
  eyeIntensity: number;
}

export const FALLEN_KNIGHT_DEFAULTS: FallenKnightParams = {
  scale: 1.12,
  rim: ENEMY_RIM_CONFIG.fallenKnight,
  plateColor: 0x5c6272,
  darkPlateColor: 0x1c1d22,
  trimColor: 0x8a5a34,
  clothColor: 0x2c3540,
  hornColor: 0x3a322a,
  eyeColor: 0xffa02a,
  eyeIntensity: 5,
};

export function buildFallenKnight(params: Partial<FallenKnightParams> = {}): Group {
  const c = { ...FALLEN_KNIGHT_DEFAULTS, ...params };
  const root = buildKnight({
    scale: c.scale,
    rim: c.rim,
    plateColor: c.plateColor,
    darkPlateColor: c.darkPlateColor,
    mailColor: 0x4a4a50,
    trimColor: c.trimColor,
    clothColor: c.clothColor,
    capeTatter: 0.45,
    leatherColor: 0x2a1e16,
    eyeColor: c.eyeColor,
    eyeIntensity: c.eyeIntensity,
    crest: false,
  });
  const rig = getRig(root)!;
  const rim = c.rim;
  const horn = leatherMaterial({ color: c.hornColor, rim });
  const steel = plateMaterial({ color: c.plateColor, rim, metalness: 0.9 });
  const darkSteel = plateMaterial({ color: c.darkPlateColor, rim, metalness: 0.8 });
  const trim = plateMaterial({ color: c.trimColor, rim, metalness: 0.9 });
  const grip = leatherMaterial({ color: 0x2a1e16, rim });
  const bone = boneSurfaceMaterial({ color: 0xcfc6ac, rim });
  const edge = glowMaterial(c.eyeColor, c.eyeIntensity * 0.55); // 剑刃边缘的细光线
  // 刻着符文的甲片：黑铁上零散的发光刻痕
  const runedPlate = glowMaterial(c.eyeColor, c.eyeIntensity * 0.3, {
    emissiveMap: runeSpeckTexture(27, 34),
    baseColor: c.darkPlateColor,
    surface: plateTextures(),
    metalness: 0.7,
    rim,
  });

  // --- 盔上的一对大弯角：向外、向上、再向前勾；额前一根短角 ---
  for (const sx of [1, -1]) {
    taperedTube(
      rig.head,
      horn,
      [
        [sx * 0.12, 0.17, 0],
        [sx * 0.25, 0.22, -0.03],
        [sx * 0.33, 0.37, 0.0],
        [sx * 0.29, 0.54, 0.08],
        [sx * 0.2, 0.62, 0.16],
      ],
      0.048,
      0.006,
      7,
      14,
    );
    // 角根的铜箍
    const band = mesh(new CylinderGeometry(0.05, 0.05, 0.03, 8), trim, rig.head);
    band.position.set(sx * 0.15, 0.185, -0.005);
    band.rotation.z = sx * -1.2;
  }
  cones(rig.head, darkSteel, [{ at: [0, 0.26, 0.05], dir: [0, 1, 0.5], radius: 0.022, length: 0.1 }], 5);

  // --- 肩刺（各两根）、背上的一排铁刺 ---
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    cones(
      arm.shoulder,
      darkSteel,
      [
        { at: [sx * 0.12, 0.08, 0.06], dir: [sx * 1, 0.9, 0.3], radius: 0.026, length: 0.16 },
        { at: [sx * 0.12, 0.08, -0.06], dir: [sx * 1, 0.9, -0.3], radius: 0.026, length: 0.14 },
      ],
      5,
    );
    // 肩甲上的符文刻痕片
    const plaque = ball(arm.shoulder, runedPlate, 0.1, sx * 0.045, 0.045, 0, [1.1, 0.7, 1.1]);
    plaque.rotation.z = sx * -0.4;
  }
  for (let i = 0; i < 3; i++) {
    const spike = mesh(new ConeGeometry(0.03, 0.22, 5), steel, rig.chest);
    spike.position.set(0, 0.2 - i * 0.11, -0.2);
    spike.rotation.x = -1.1;
  }
  // 腰间的头骨和断链
  ball(rig.hips, bone, 0.055, -0.14, -0.06, 0.16, [0.9, 1, 0.95]);
  box(rig.hips, bone, 0.05, 0.03, 0.04, -0.14, -0.105, 0.175);
  chain(rig.hips, darkSteel, [
    [-0.1, 0.05, 0.17],
    [-0.14, -0.01, 0.17],
  ], 0.014);
  for (const arm of [rig.armL, rig.armR]) {
    chain(arm.elbow, darkSteel, [
      [0, -0.2, 0.07],
      [0, -0.4, 0.09],
    ], 0.018);
  }

  // --- 宽刃大剑：握在右手，两侧刃口各一条细光线，剑脊上刻着符文 ---
  const sword = rig.weaponMount;
  mesh(new CylinderGeometry(0.02, 0.022, 0.3, 8), grip, sword).position.y = -0.03;
  const pommel = mesh(new ConeGeometry(0.035, 0.07, 6), trim, sword);
  pommel.position.y = -0.21;
  pommel.rotation.x = Math.PI;
  box(sword, trim, 0.04, 0.05, 0.34, 0, 0.14, 0);
  cones(
    sword,
    trim,
    [
      { at: [0, 0.14, 0.17], dir: [0, 0.6, 1], radius: 0.022, length: 0.08 },
      { at: [0, 0.14, -0.17], dir: [0, 0.6, -1], radius: 0.022, length: 0.08 },
    ],
    4,
  );
  box(sword, steel, 0.018, 1.05, 0.13, 0, 0.69, 0);
  const tip = mesh(new ConeGeometry(0.065, 0.2, 4), steel, sword);
  tip.position.y = 1.31;
  tip.scale.set(0.14, 1, 1);
  tip.rotation.y = Math.PI / 4;
  box(sword, runedPlate, 0.021, 0.9, 0.05, 0, 0.66, 0); // 剑脊
  for (const sz of [1, -1]) {
    box(sword, edge, 0.008, 1.05, 0.008, 0, 0.69, sz * 0.066);
    const tipLine = box(sword, edge, 0.008, 0.21, 0.008, 0, 1.31, sz * 0.033);
    tipLine.rotation.x = sz * -0.31;
  }

  root.name = 'fallenKnight';
  setRigHeight(rig, 2.1);
  return root;
}

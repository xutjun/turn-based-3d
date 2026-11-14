// 敌人 · 堕落骑士：发黑的重甲，盔上一对弯角，破烂的黑披风，手持一把宽刃大剑。
// 甲胄复用重甲骑士的 builder（换配色、去掉盔鳍），再加上弯角、背刺和大剑。

import { ConeGeometry, CylinderGeometry, type Group } from 'three';
import { glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { ENEMY_RIM, type CharacterBaseParams } from './common';
import { buildKnight } from './knight';
import { box, mesh, taperedTube } from './parts';
import { getRig, setRigHeight } from './rig';

export interface FallenKnightParams extends CharacterBaseParams {
  plateColor: number;
  darkPlateColor: number;
  trimColor: number;
  clothColor: number;
  hornColor: number;
  eyeColor: number; // 目光与剑上的血纹
  eyeIntensity: number;
}

export const FALLEN_KNIGHT_DEFAULTS: FallenKnightParams = {
  scale: 1.12,
  rim: ENEMY_RIM,
  plateColor: 0x3a3c44,
  darkPlateColor: 0x17181c,
  trimColor: 0x6a2a1c,
  clothColor: 0x16090b,
  hornColor: 0x2a2420,
  eyeColor: 0xff2a14,
  eyeIntensity: 6,
};

export function buildFallenKnight(params: Partial<FallenKnightParams> = {}): Group {
  const c = { ...FALLEN_KNIGHT_DEFAULTS, ...params };
  const root = buildKnight({
    scale: c.scale,
    rim: c.rim,
    plateColor: c.plateColor,
    darkPlateColor: c.darkPlateColor,
    trimColor: c.trimColor,
    clothColor: c.clothColor,
    leatherColor: 0x1c1410,
    eyeColor: c.eyeColor,
    eyeIntensity: c.eyeIntensity,
    crest: false,
  });
  const rig = getRig(root)!;
  const horn = leatherMaterial({ color: c.hornColor, rim: c.rim });
  const steel = plateMaterial({ color: c.plateColor, rim: c.rim, metalness: 0.9 });
  const trim = plateMaterial({ color: c.trimColor, rim: c.rim, metalness: 0.9 });
  const grip = leatherMaterial({ color: 0x1c1410, rim: c.rim });
  const blood = glowMaterial(c.eyeColor, c.eyeIntensity * 0.5);

  // --- 盔上的一对弯角：向外、向上、再向前勾 ---
  for (const sx of [1, -1]) {
    taperedTube(
      rig.head,
      horn,
      [
        [sx * 0.12, 0.17, 0],
        [sx * 0.22, 0.22, -0.02],
        [sx * 0.27, 0.34, 0.01],
        [sx * 0.22, 0.46, 0.08],
      ],
      0.042,
      0.006,
    );
  }
  // --- 背上的一排铁刺 ---
  for (let i = 0; i < 3; i++) {
    const spike = mesh(new ConeGeometry(0.03, 0.2, 5), steel, rig.chest);
    spike.position.set(0, 0.2 - i * 0.11, -0.2);
    spike.rotation.x = -1.1;
  }

  // --- 宽刃大剑：握在右手，剑身中间一道血纹 ---
  const sword = rig.weaponMount;
  mesh(new CylinderGeometry(0.02, 0.022, 0.3, 8), grip, sword).position.y = -0.03;
  mesh(new ConeGeometry(0.035, 0.07, 6), trim, sword).position.y = -0.21;
  sword.children[sword.children.length - 1]!.rotation.x = Math.PI;
  box(sword, trim, 0.04, 0.05, 0.34, 0, 0.14, 0);
  box(sword, steel, 0.018, 1.05, 0.13, 0, 0.69, 0);
  const tip = mesh(new ConeGeometry(0.065, 0.2, 4), steel, sword);
  tip.position.y = 1.31;
  tip.scale.set(0.14, 1, 1);
  tip.rotation.y = Math.PI / 4;
  box(sword, blood, 0.022, 0.85, 0.018, 0, 0.64, 0);

  root.name = 'fallenKnight';
  setRigHeight(rig, 2.0);
  return root;
}

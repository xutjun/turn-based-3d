// 法术系 · 法师：长袍、深兜帽、宽袖、肩披。剪影特征：高而窄，帽尖后翘，下摆宽。

import { CylinderGeometry, PlaneGeometry, type Group } from 'three';
import { clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { runeStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, hood, lathe, mesh, ring, robeSkirt, softSeg } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface MageParams extends CharacterBaseParams {
  robeColor: number; // 长袍
  mantleColor: number; // 肩披、兜帽
  trimColor: number; // 金属饰件
  leatherColor: number;
  glowColor: number; // 符文与目光
  glowIntensity: number;
}

export const MAGE_DEFAULTS: MageParams = {
  scale: 1.0,
  rim: ALLY_RIM,
  robeColor: 0x2c3566,
  mantleColor: 0x1a1f3d,
  trimColor: 0x8f7a48,
  leatherColor: 0x3a2a20,
  glowColor: 0x8f7bff,
  glowIntensity: 3.2,
};

export function buildMage(params: Partial<MageParams> = {}): Group {
  const c = { ...MAGE_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.2 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const hem = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(5, 0.1) });
  const mantle = clothMaterial({ color: c.mantleColor, rim, doubleSide: true });
  const trim = plateMaterial({ color: c.trimColor, rim, metalness: 0.9 });
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const runes = glowMaterial(c.glowColor, c.glowIntensity, {
    emissiveMap: runeStripTexture(2),
    baseColor: c.mantleColor,
    doubleSide: true,
  });
  const eye = glowMaterial(c.glowColor, c.glowIntensity * 1.6);
  const shadow = clothMaterial({ color: 0x050506 });

  // --- 下摆：拖地长袍，前面垂一条符文饰带 ---
  robeSkirt(rig.hips, hem, { topRadius: 0.17, bottomRadius: 0.4, length: 0.88, folds: 9 });
  const stole = mesh(new PlaneGeometry(0.8, 0.085), runes, rig.hips);
  stole.rotation.order = 'YXZ';
  stole.rotation.set(-0.215, 0, Math.PI / 2); // 竖直悬挂，并贴合下摆的倾斜
  stole.position.set(0, -0.42, 0.262);
  for (const leg of [rig.legL, rig.legR]) box(leg.foot, leather, 0.09, 0.07, 0.2, 0, -0.045, 0.05);

  // --- 腰带与挂件 ---
  ring(rig.hips, leather, 0.176, 0.028, 0.05, 6, 18);
  box(rig.hips, trim, 0.06, 0.06, 0.025, 0, 0.05, 0.185);
  box(rig.hips, leather, 0.1, 0.13, 0.05, -0.19, -0.06, 0.03).rotation.z = 0.12; // 法术书
  box(rig.hips, trim, 0.104, 0.02, 0.054, -0.19, -0.06, 0.03).rotation.z = 0.12;

  // --- 躯干 ---
  lathe(rig.spine, robe, [
    [0.172, 0],
    [0.15, 0.14],
    [0.158, 0.29],
  ]).scale.z = 0.85;
  lathe(rig.chest, robe, [
    [0.158, 0],
    [0.182, 0.1],
    [0.165, 0.19],
    [0.085, 0.25],
  ]).scale.z = 0.82;

  // --- 肩披与符文领 ---
  lathe(rig.chest, mantle, [
    [0.075, 0.275],
    [0.18, 0.22],
    [0.27, 0.11],
    [0.3, 0.03],
  ]).scale.z = 0.86;
  const collar = mesh(new CylinderGeometry(0.297, 0.303, 0.045, 28, 1, true), runes, rig.chest);
  collar.position.y = 0.045;
  collar.scale.z = 0.86;
  ball(rig.chest, trim, 0.032, 0, 0.2, 0.15); // 领口的扣饰

  // --- 双臂：宽袖 ---
  for (const arm of [rig.armL, rig.armR]) {
    softSeg(arm.shoulder, robe, 0.3, 0.058);
    const sleeve = mesh(new CylinderGeometry(0.062, 0.135, 0.3, 14, 1, true), robe, arm.elbow);
    sleeve.position.y = -0.14;
    const cuff = mesh(new CylinderGeometry(0.136, 0.138, 0.035, 14, 1, true), runes, arm.elbow);
    cuff.position.y = -0.275;
    ball(arm.hand, leather, 0.042, 0, -0.03, 0, [1, 1.3, 0.9]);
  }

  // --- 头：兜帽深处只见两点目光 ---
  ball(rig.head, shadow, 0.1, 0, 0.115, 0.0);
  for (const sx of [1, -1]) ball(rig.head, eye, 0.013, sx * 0.036, 0.125, 0.088);
  const h = hood(rig.head, mantle, { radius: 0.158, opening: 1.45, peak: 0.17 });
  h.position.y = 0.12;

  return finishCharacter(rig, 'mage', 1.84, c.scale);
}

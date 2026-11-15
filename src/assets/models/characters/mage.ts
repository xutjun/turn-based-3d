// 法术系 · 法师：长袍、深兜帽、宽袖、肩披。剪影特征：高而窄，帽尖后翘，下摆宽。
// 步骤 10 细化：深蓝外袍 + 灰白内袍两层下摆，靛色肩披镶金纹边，皮腰带上挂法术书、卷轴筒、药瓶，
// 胸前符文挂坠，宽袖露出浅色内衬，背后一条带褶的短披。

import { CylinderGeometry, PlaneGeometry, type Group } from 'three';
import { bandMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { ornamentStripTexture, runeStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import {
  ball,
  band,
  boot,
  box,
  capeMesh,
  capeTrim,
  chain,
  gauntlet,
  gem,
  hood,
  lathe,
  mesh,
  pouch,
  ring,
  rivetRing,
  robeSkirt,
  softSeg,
  vial,
} from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface MageParams extends CharacterBaseParams {
  robeColor: number; // 外袍
  innerColor: number; // 内袍、袖口内衬
  mantleColor: number; // 肩披、兜帽
  trimColor: number; // 金属饰件
  leatherColor: number;
  glowColor: number; // 符文与目光
  glowIntensity: number;
}

export const MAGE_DEFAULTS: MageParams = {
  scale: 1.0,
  rim: ALLY_RIM,
  robeColor: 0x2f4aa8,
  innerColor: 0xa9b0c8,
  mantleColor: 0x1d2458,
  trimColor: 0xc9a44e,
  leatherColor: 0x6a4428,
  glowColor: 0x8f7bff,
  glowIntensity: 3.2,
};

export function buildMage(params: Partial<MageParams> = {}): Group {
  const c = { ...MAGE_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.2 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const hem = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(5, 0.1) });
  const inner = clothMaterial({ color: c.innerColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(6, 0.08) });
  const mantle = clothMaterial({ color: c.mantleColor, rim, doubleSide: true });
  const edging = bandMaterial(ornamentStripTexture(c.mantleColor, c.trimColor, 5), { rim, doubleSide: true });
  const trim = plateMaterial({ color: c.trimColor, rim, metalness: 0.9 });
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const parchment = clothMaterial({ color: 0xcdbb8a, rim });
  const runes = glowMaterial(c.glowColor, c.glowIntensity, {
    emissiveMap: runeStripTexture(2),
    baseColor: c.mantleColor,
    doubleSide: true,
  });
  const eye = glowMaterial(c.glowColor, c.glowIntensity * 1.6);
  const potion = glowMaterial(0x4fe0c8, 1.6, { baseColor: 0x0c2a28 });
  const shadow = clothMaterial({ color: 0x050506 });

  // --- 下摆：灰白内袍拖地，深蓝外袍略短、下沿镶金纹边，前面垂一条符文饰带 ---
  robeSkirt(rig.hips, inner, { topRadius: 0.15, bottomRadius: 0.36, length: 0.89, folds: 11 });
  robeSkirt(rig.hips, hem, { topRadius: 0.172, bottomRadius: 0.41, length: 0.76, folds: 9 });
  band(rig.hips, edging, { rTop: 0.352, rBottom: 0.378, height: 0.07, y: -0.6, depthScale: 0.86, repeat: 3, segments: 28 });
  const stole = mesh(new PlaneGeometry(0.72, 0.085), runes, rig.hips);
  stole.rotation.order = 'YXZ';
  stole.rotation.set(-0.235, 0, Math.PI / 2); // 竖直悬挂，并贴合下摆的倾斜
  stole.position.set(0, -0.38, 0.268);
  gem(rig.hips, trim, 0.03, 0, -0.76, 0.355, 1.6); // 饰带下端的金坠
  for (const leg of [rig.legL, rig.legR]) boot(leg.foot, leather, { width: 0.09, length: 0.21, toeUp: 0.012 });

  // --- 腰带与挂件：带扣、法术书（带锁链）、卷轴筒、腰包、两只药瓶 ---
  ring(rig.hips, leather, 0.178, 0.03, 0.05, 6, 18);
  rivetRing(rig.hips, trim, 0.205, 10, 0.05, 0.008, 0.86);
  box(rig.hips, trim, 0.07, 0.07, 0.025, 0, 0.05, 0.19);
  gem(rig.hips, eye, 0.018, 0, 0.05, 0.207, 1);
  const book = box(rig.hips, leather, 0.11, 0.14, 0.05, -0.2, -0.08, 0.03); // 法术书
  book.rotation.z = 0.12;
  box(book, parchment, 0.1, 0.13, 0.036, 0.008, 0, 0); // 书页
  box(book, trim, 0.114, 0.022, 0.054, 0, 0.045, 0);
  box(book, trim, 0.114, 0.022, 0.054, 0, -0.045, 0);
  gem(book, eye, 0.016, -0.03, 0, 0.03, 1);
  chain(rig.hips, trim, [
    [-0.17, 0.04, 0.08],
    [-0.2, -0.01, 0.05],
  ], 0.012);
  const tube = mesh(new CylinderGeometry(0.028, 0.028, 0.2, 8), leather, rig.hips); // 卷轴筒
  tube.position.set(0.1, -0.03, -0.17);
  tube.rotation.z = 1.2;
  ring(tube, trim, 0.03, 0.006, 0.08, 4, 10);
  ring(tube, trim, 0.03, 0.006, -0.08, 4, 10);
  pouch(rig.hips, leather, trim, 0.19, -0.03, 0.06, 0.9, 1.0);
  vial(rig.hips, potion, leather, 0.12, -0.03, 0.165, 1);
  vial(rig.hips, eye, leather, 0.075, -0.035, 0.185, 0.85);

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
  // 前襟：灰白内袍在胸前露出一道
  box(rig.chest, inner, 0.07, 0.24, 0.01, 0, 0.08, 0.148).rotation.x = -0.08;

  // --- 肩披（两层）与符文领、挂坠 ---
  lathe(rig.chest, mantle, [
    [0.075, 0.275],
    [0.18, 0.22],
    [0.27, 0.11],
    [0.3, 0.03],
  ]).scale.z = 0.86;
  band(rig.chest, edging, { rTop: 0.288, rBottom: 0.304, height: 0.05, y: 0.048, depthScale: 0.86, repeat: 3, segments: 28 });
  lathe(rig.chest, mantle, [
    [0.08, 0.3],
    [0.15, 0.262],
    [0.2, 0.2],
  ]).scale.z = 0.88; // 上层小披领
  const collar = mesh(new CylinderGeometry(0.198, 0.204, 0.03, 24, 1, true), runes, rig.chest);
  collar.position.y = 0.2;
  collar.scale.z = 0.88;
  chain(rig.chest, trim, [
    [-0.09, 0.25, 0.12],
    [-0.04, 0.16, 0.2],
    [0, 0.12, 0.215],
    [0.04, 0.16, 0.2],
    [0.09, 0.25, 0.12],
  ], 0.012);
  gem(rig.chest, eye, 0.03, 0, 0.085, 0.222, 1.4); // 符文挂坠
  for (const sx of [1, -1]) ball(rig.chest, trim, 0.03, sx * 0.2, 0.2, 0.1, [1, 1, 0.5]); // 肩披的金扣

  // --- 双臂：宽袖（露出浅色内衬）、符文袖口、皮手套 ---
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    softSeg(arm.shoulder, robe, 0.3, 0.058);
    const sleeve = mesh(new CylinderGeometry(0.062, 0.135, 0.3, 14, 1, true), robe, arm.elbow);
    sleeve.position.y = -0.14;
    const lining = mesh(new CylinderGeometry(0.05, 0.118, 0.3, 12, 1, true), inner, arm.elbow);
    lining.position.y = -0.15;
    const cuff = mesh(new CylinderGeometry(0.136, 0.138, 0.035, 14, 1, true), runes, arm.elbow);
    cuff.position.y = -0.275;
    softSeg(arm.elbow, inner, 0.26, 0.04); // 内层窄袖
    ring(arm.elbow, trim, 0.046, 0.008, -0.2, 4, 10);
    gauntlet(arm.hand, leather, { side: sx, size: 0.82, cuffLength: 0.05 });
  }

  // --- 头：兜帽深处只见两点目光；帽沿镶边，额前金饰 ---
  ball(rig.head, shadow, 0.1, 0, 0.115, 0.0);
  for (const sx of [1, -1]) ball(rig.head, eye, 0.013, sx * 0.036, 0.125, 0.088);
  const h = hood(rig.head, mantle, { radius: 0.158, opening: 1.45, peak: 0.17 });
  h.position.y = 0.12;
  const brow = mesh(new CylinderGeometry(0.16, 0.16, 0.022, 20, 1, true, -0.75, 1.5), trim, rig.head);
  brow.position.set(0, 0.215, 0);
  gem(rig.head, eye, 0.016, 0, 0.222, 0.162, 1.3);

  // --- 背后的短披：带褶，下沿镶金纹边 ---
  const capeShape = { topWidth: 0.4, bottomWidth: 0.62, length: 0.74, wrap: 0.1, flare: 0.2, folds: 4, foldDepth: 0.03 };
  const back = capeMesh(rig.cape, mantle, capeShape);
  back.position.set(0, -0.06, -0.05);
  capeTrim(rig.cape, edging, capeShape, 0.86, 0.95, 3).position.set(0, -0.06, -0.05);

  return finishCharacter(rig, 'mage', 1.84, c.scale);
}

// 恢复系 · 守誓者：浅色长袍、披肩、胸前圣徽、脑后光环。剪影特征：柔和、宽下摆、头后有带芒的圆环。
// 步骤 10 细化：象牙白长袍 + 青绿圣带和内衬 + 金饰 + 棕皮带具；披肩两层镶金纹边，肩上小金甲片，
// 腰间挂药瓶、经卷和香炉，颈上念珠，背后一条带褶的白色短披。

import { CylinderGeometry, TorusGeometry, type Group } from 'three';
import { bandMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { ornamentStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import {
  ball,
  band,
  boot,
  box,
  capeMesh,
  capeTrim,
  chain,
  extruded,
  gauntlet,
  gem,
  hood,
  lathe,
  mesh,
  pauldron,
  pouch,
  ring,
  rivetRing,
  robeSkirt,
  softSeg,
  vial,
} from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface HealerParams extends CharacterBaseParams {
  robeColor: number; // 长袍
  capeColor: number; // 披肩与兜帽
  sashColor: number; // 圣带、内衬
  trimColor: number; // 金饰
  leatherColor: number;
  glowColor: number; // 圣徽、光环
  glowIntensity: number;
}

export const HEALER_DEFAULTS: HealerParams = {
  scale: 0.99,
  rim: ALLY_RIM,
  robeColor: 0xcfc7ae,
  capeColor: 0xe9e2cc,
  sashColor: 0x2f8a80,
  trimColor: 0xd6a83e,
  leatherColor: 0x7a5a38,
  glowColor: 0xe6e28a,
  glowIntensity: 2.6,
};

/** 八芒星轮廓（圣徽） */
function starPoints(outer: number, inner: number, rays: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < rays * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (rays * 2)) * Math.PI * 2 + Math.PI / 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

export function buildHealer(params: Partial<HealerParams> = {}): Group {
  const c = { ...HEALER_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.2 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const hem = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(9, 0.07) });
  const cape = clothMaterial({ color: c.capeColor, rim, doubleSide: true });
  const sashCloth = clothMaterial({ color: c.sashColor, rim, doubleSide: true });
  const edging = bandMaterial(ornamentStripTexture(c.sashColor, c.trimColor, 9), { rim, doubleSide: true });
  const gold = plateMaterial({ color: c.trimColor, rim, metalness: 0.95 });
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  const softGlow = glowMaterial(c.glowColor, c.glowIntensity * 0.55);
  const elixir = glowMaterial(0x7fe07a, 1.5, { baseColor: 0x10301a });
  const shadow = clothMaterial({ color: 0x0a0908 });

  // --- 下摆：青绿内衬略长，外面是宽大的象牙白长袍，下沿镶金纹边；前垂圣带 ---
  robeSkirt(rig.hips, sashCloth, { topRadius: 0.15, bottomRadius: 0.39, length: 0.89, folds: 11 });
  robeSkirt(rig.hips, hem, { topRadius: 0.174, bottomRadius: 0.44, length: 0.8, folds: 11 });
  band(rig.hips, edging, { rTop: 0.385, rBottom: 0.41, height: 0.07, y: -0.65, depthScale: 0.86, repeat: 3, segments: 28 });
  const sashShape = { topWidth: 0.13, bottomWidth: 0.15, length: 0.7, wrap: 0, flare: -0.21 };
  const sash = capeMesh(rig.hips, sashCloth, sashShape);
  sash.position.set(0, 0.02, 0.17);
  const sashEnd = capeTrim(rig.hips, edging, sashShape, 0.84, 0.96, 0.4);
  sashEnd.position.set(0, 0.02, 0.182);
  const sashStar = extruded(rig.hips, gold, starPoints(0.045, 0.02, 4), 0.012);
  sashStar.position.set(0, -0.4, 0.262);
  sashStar.rotation.x = -0.3;
  for (const leg of [rig.legL, rig.legR]) boot(leg.foot, leather, { width: 0.09, length: 0.21 });

  // --- 腰带与挂件：金腰带、药瓶、经卷、小香炉 ---
  ring(rig.hips, leather, 0.18, 0.026, 0.05, 6, 20);
  ring(rig.hips, gold, 0.192, 0.01, 0.075, 4, 20);
  ring(rig.hips, gold, 0.192, 0.01, 0.025, 4, 20);
  const buckle = extruded(rig.hips, gold, starPoints(0.05, 0.03, 6), 0.02);
  buckle.position.set(0, 0.05, 0.2);
  vial(rig.hips, elixir, leather, -0.13, -0.03, 0.165, 1.1);
  vial(rig.hips, glow, leather, -0.18, -0.03, 0.115, 0.9);
  pouch(rig.hips, leather, gold, 0.2, -0.03, 0.05, 1, 1.0);
  const scroll = mesh(new CylinderGeometry(0.024, 0.024, 0.17, 8), cape, rig.hips); // 经卷
  scroll.position.set(0.17, -0.06, -0.11);
  scroll.rotation.set(0.3, 0, 1.3);
  ring(scroll, gold, 0.026, 0.006, 0, 4, 10);
  chain(rig.hips, gold, [
    [-0.2, 0.03, -0.04],
    [-0.23, -0.2, -0.03],
  ], 0.012);
  const censer = ball(rig.hips, gold, 0.04, -0.235, -0.25, -0.03, [1, 0.9, 1]); // 香炉
  ball(censer, softGlow, 0.022, 0, 0.012, 0);

  // --- 躯干 ---
  lathe(rig.spine, robe, [
    [0.174, 0],
    [0.152, 0.14],
    [0.16, 0.29],
  ]).scale.z = 0.85;
  lathe(rig.chest, robe, [
    [0.16, 0],
    [0.184, 0.1],
    [0.165, 0.19],
    [0.085, 0.25],
  ]).scale.z = 0.82;

  // --- 披肩：浅色短披肩（两层），金纹滚边；肩上两片小金甲 ---
  lathe(rig.chest, cape, [
    [0.08, 0.275],
    [0.19, 0.225],
    [0.285, 0.1],
    [0.31, -0.02],
  ]).scale.z = 0.86;
  band(rig.chest, edging, { rTop: 0.302, rBottom: 0.314, height: 0.05, y: 0.0, depthScale: 0.86, repeat: 3, segments: 28 });
  lathe(rig.chest, sashCloth, [
    [0.085, 0.3],
    [0.15, 0.265],
    [0.205, 0.2],
  ]).scale.z = 0.88;
  const edge = mesh(new TorusGeometry(0.207, 0.009, 5, 28), gold, rig.chest);
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.2;
  edge.scale.y = 0.88; // 圆环旋转后，本地 y 对应前后方向
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    const p = pauldron(arm.shoulder, gold, 0.085, [1.1, 0.55, 1.2]);
    p.position.set(sx * 0.03, 0.06, 0);
    p.rotation.z = sx * -0.45;
  }

  // --- 念珠与胸前圣徽：八芒星 + 发光的中心 ---
  rivetRing(rig.chest, leather, 0.16, 16, 0.19, 0.014, 0.95, [-2.0, 2.0]);
  const emblem = extruded(rig.chest, gold, starPoints(0.08, 0.034, 8), 0.014);
  emblem.position.set(0, 0.1, 0.228);
  emblem.rotation.x = -0.32;
  ring(rig.chest, gold, 0.05, 0.007, 0, 4, 16).position.set(0, 0.1, 0.236);
  gem(rig.chest, glow, 0.028, 0, 0.1, 0.245, 1);

  // --- 双臂：中等宽度的袖子（露出青绿内衬）、金色袖口、皮手套 ---
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    softSeg(arm.shoulder, robe, 0.3, 0.058);
    const sleeve = mesh(new CylinderGeometry(0.062, 0.105, 0.28, 14, 1, true), robe, arm.elbow);
    sleeve.position.y = -0.13;
    const liningSleeve = mesh(new CylinderGeometry(0.05, 0.092, 0.28, 12, 1, true), sashCloth, arm.elbow);
    liningSleeve.position.y = -0.14;
    softSeg(arm.elbow, sashCloth, 0.26, 0.04);
    ring(arm.elbow, gold, 0.105, 0.01, -0.27, 5, 16);
    ring(arm.elbow, gold, 0.045, 0.008, -0.21, 4, 10);
    gauntlet(arm.hand, leather, { side: sx, size: 0.82, cuffLength: 0.045 });
  }

  // --- 头：浅色软兜帽、金额冠、柔和的目光 ---
  ball(rig.head, shadow, 0.1, 0, 0.115, 0);
  for (const sx of [1, -1]) ball(rig.head, softGlow, 0.012, sx * 0.036, 0.125, 0.088);
  const h = hood(rig.head, cape, { radius: 0.155, opening: 1.6, peak: 0.04 });
  h.position.y = 0.12;
  const circlet = mesh(new CylinderGeometry(0.158, 0.158, 0.02, 20, 1, true, -0.8, 1.6), gold, rig.head);
  circlet.position.y = 0.212;
  gem(rig.head, glow, 0.018, 0, 0.222, 0.158, 1.4);

  // --- 脑后光环：发光圆环 + 一圈短芒 ---
  const halo = mesh(new TorusGeometry(0.19, 0.011, 6, 36), glow, rig.head);
  halo.position.set(0, 0.16, -0.12);
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const long = i % 2 === 0;
    const ray = box(rig.head, softGlow, 0.012, long ? 0.09 : 0.05, 0.008);
    const r = 0.19 + (long ? 0.065 : 0.045);
    ray.position.set(Math.cos(a) * r, 0.16 + Math.sin(a) * r, -0.12);
    ray.rotation.z = a - Math.PI / 2;
  }

  // --- 背后的短披：白色带褶，下沿青绿金纹边 ---
  const capeShape = { topWidth: 0.42, bottomWidth: 0.66, length: 0.8, wrap: 0.1, flare: 0.22, folds: 4, foldDepth: 0.03 };
  const back = capeMesh(rig.cape, cape, capeShape);
  back.position.set(0, -0.06, -0.05);
  capeTrim(rig.cape, edging, capeShape, 0.86, 0.96, 3).position.set(0, -0.06, -0.05);

  return finishCharacter(rig, 'healer', 1.9, c.scale);
}

// 封印系 · 缚魂祭司：暗色祭司装、高冠面具、缠身锁链与发光符文。剪影特征：瘦高，尖顶高冠，锁链垂挂。
// 步骤 10 细化：暗紫祭袍 + 暗红内衬，骨白面具，银链与铁镣，腰间垂挂符纸和符文牌，
// 颈上一串念珠，背后两条封印长带。

import { ConeGeometry, CylinderGeometry, PlaneGeometry, type Group } from 'three';
import {
  bandMaterial,
  boneSurfaceMaterial,
  clothMaterial,
  glowMaterial,
  leatherMaterial,
  plateMaterial,
} from '../../materials';
import { ornamentStripTexture, runeSpeckTexture, runeStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import {
  ball,
  band,
  boot,
  box,
  capeMesh,
  chain,
  gauntlet,
  gem,
  lathe,
  mesh,
  pauldron,
  ring,
  rivetRing,
  rivets,
  robeSkirt,
  seg,
  softSeg,
} from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface SealerParams extends CharacterBaseParams {
  robeColor: number; // 祭司袍
  liningColor: number; // 内衬、腰封
  stoleColor: number; // 圣带底色
  chainColor: number; // 锁链
  maskColor: number; // 骨面具
  leatherColor: number;
  glowColor: number; // 符文与目光
  glowIntensity: number;
}

export const SEALER_DEFAULTS: SealerParams = {
  scale: 0.98,
  rim: ALLY_RIM,
  robeColor: 0x4a2f6e,
  liningColor: 0x7a1f2e,
  stoleColor: 0x1b1026,
  chainColor: 0xb4bac6,
  maskColor: 0xe0d6bc,
  leatherColor: 0x3a2a26,
  glowColor: 0xb44dff,
  glowIntensity: 3.4,
};

export function buildSealer(params: Partial<SealerParams> = {}): Group {
  const c = { ...SEALER_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.21 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const hem = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(7, 0.16) });
  const lining = clothMaterial({ color: c.liningColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(8, 0.1) });
  const edging = bandMaterial(ornamentStripTexture(c.stoleColor, c.chainColor, 4), { rim, doubleSide: true, metalness: 0.6 });
  const silver = plateMaterial({ color: c.chainColor, rim, metalness: 0.9 });
  const darkMetal = plateMaterial({ color: 0x5a5866, rim, metalness: 0.8 });
  const mask = boneSurfaceMaterial({ color: c.maskColor, rim });
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const runes = glowMaterial(c.glowColor, c.glowIntensity, {
    emissiveMap: runeStripTexture(4),
    baseColor: c.stoleColor,
    doubleSide: true,
  });
  // 符纸：泛黄的纸条上写着发光的符文
  const talisman = glowMaterial(c.glowColor, c.glowIntensity * 0.3, {
    emissiveMap: runeSpeckTexture(4, 40),
    baseColor: 0xcbb98a,
    doubleSide: true,
  });
  const glow = glowMaterial(c.glowColor, c.glowIntensity * 1.5);

  // --- 下摆：暗红内衬略长，外面是到小腿的暗紫窄袍，下沿银纹边；露出长靴 ---
  robeSkirt(rig.hips, lining, { topRadius: 0.15, bottomRadius: 0.275, length: 0.8, folds: 9 });
  robeSkirt(rig.hips, hem, { topRadius: 0.166, bottomRadius: 0.31, length: 0.72, folds: 7 });
  band(rig.hips, edging, { rTop: 0.262, rBottom: 0.283, height: 0.06, y: -0.55, depthScale: 0.86, repeat: 3, segments: 24 });
  for (const leg of [rig.legL, rig.legR]) {
    softSeg(leg.hip, leather, 0.42, 0.07);
    seg(leg.knee, leather, 0.4, 0.068, 0.055);
    ring(leg.knee, silver, 0.062, 0.008, -0.28, 4, 12);
    boot(leg.foot, leather, { sole: darkMetal, width: 0.095, length: 0.23 });
  }

  // --- 躯干：贴身祭司袍、暗红腰封、高立领 ---
  lathe(rig.spine, robe, [
    [0.168, 0],
    [0.148, 0.14],
    [0.155, 0.29],
  ]).scale.z = 0.85;
  band(rig.spine, lining, { rTop: 0.156, rBottom: 0.172, height: 0.13, y: 0.065, depthScale: 0.86, segments: 18 }); // 腰封
  lathe(rig.chest, robe, [
    [0.155, 0],
    [0.178, 0.1],
    [0.165, 0.19],
    [0.09, 0.245],
  ]).scale.z = 0.82;
  mesh(new CylinderGeometry(0.135, 0.09, 0.13, 16, 1, true), robe, rig.chest).position.y = 0.3;
  band(rig.chest, edging, { rTop: 0.138, rBottom: 0.132, height: 0.03, y: 0.36, repeat: 1, segments: 16 });

  // --- 圣带：从颈部垂到膝下的符文长带 ---
  const stole = mesh(new PlaneGeometry(1.0, 0.1), runes, rig.spine);
  stole.rotation.order = 'YXZ';
  stole.rotation.set(-0.1, 0, Math.PI / 2);
  stole.position.set(0, -0.02, 0.205);

  // --- 念珠：颈上一串珠子，胸前垂着发光的封印石 ---
  rivetRing(rig.chest, mask, 0.15, 18, 0.2, 0.016, 0.95, [-2.2, 2.2]);
  gem(rig.chest, glow, 0.028, 0, 0.12, 0.196, 1.5);

  // --- 锁链：胸前交叉、腰间垂挂符文牌和符纸、手腕镣铐 ---
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
  box(rig.hips, darkMetal, 0.07, 0.08, 0.03, 0, 0.05, 0.172); // 锁形带扣
  gem(rig.hips, glow, 0.014, 0, 0.045, 0.19, 1);
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
  // 腰间的一排符纸
  for (const [a, len] of [
    [0.95, 0.24],
    [1.35, 0.3],
    [-1.0, 0.27],
    [-1.4, 0.22],
    [2.6, 0.28],
    [-2.7, 0.25],
  ] as const) {
    const slip = mesh(new PlaneGeometry(0.05, len), talisman, rig.hips);
    slip.position.set(Math.sin(a) * 0.205, 0.02 - len / 2, Math.cos(a) * 0.178);
    slip.rotation.order = 'YXZ';
    slip.rotation.set(-0.12, a, 0);
  }

  // --- 双臂：窄袖、铁护腕（带钉）、镣铐与垂链、手套；左肩单侧带刺肩甲（两层） ---
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    softSeg(arm.shoulder, robe, 0.3, 0.056);
    softSeg(arm.elbow, robe, 0.25, 0.05);
    ring(arm.shoulder, silver, 0.058, 0.007, -0.16, 4, 12);
    seg(arm.elbow, darkMetal, 0.12, 0.059, 0.052).position.y = -0.19;
    rivetRing(arm.elbow, silver, 0.058, 6, -0.16, 0.007);
    ring(arm.elbow, silver, 0.058, 0.012, -0.25, 5, 14);
    chain(arm.elbow, silver, [
      [0, -0.26, 0.05],
      [0, -0.42, 0.06],
    ]);
    gauntlet(arm.hand, leather, { side: sx, size: 0.82, cuffLength: 0.04 });
  }
  const p1 = pauldron(rig.armL.shoulder, darkMetal, 0.122, [1.1, 0.9, 1.15]);
  p1.position.set(0.03, 0.03, 0);
  p1.rotation.z = -0.45;
  const p2 = pauldron(rig.armL.shoulder, silver, 0.1, [1.05, 0.8, 1.15]);
  p2.position.set(0.085, -0.045, 0);
  p2.rotation.z = -0.85;
  rivets(rig.armL.shoulder, silver, [
    [0.04, 0.1, 0.11],
    [0.11, 0.05, 0.11],
    [0.04, 0.1, -0.11],
    [0.11, 0.05, -0.11],
  ]);
  const spike = mesh(new ConeGeometry(0.03, 0.17, 6), silver, rig.armL.shoulder);
  spike.position.set(0.09, 0.15, 0);
  spike.rotation.z = -0.6;
  // --- 头：骨白面具（两道发光眼缝、额心符印）、尖顶高冠、后垂头纱 ---
  ball(rig.head, darkMetal, 0.103, 0, 0.11, -0.005, [0.95, 1.15, 1]);
  ball(rig.head, mask, 0.1, 0, 0.105, 0.022, [0.9, 1.18, 0.82]);
  for (const sx of [1, -1]) {
    const slit = box(rig.head, glow, 0.045, 0.012, 0.02, sx * 0.04, 0.125, 0.097);
    slit.rotation.z = sx * -0.25;
    box(rig.head, darkMetal, 0.008, 0.07, 0.01, sx * 0.04, 0.06, 0.098).rotation.z = sx * 0.12; // 面具上的泪痕刻线
  }
  gem(rig.head, glow, 0.014, 0, 0.165, 0.103, 1.4);
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
  const crownBand = mesh(new CylinderGeometry(0.13, 0.121, 0.05, 20, 1, true), runes, rig.head);
  crownBand.position.y = 0.2;
  crownBand.scale.z = 0.74;
  box(rig.head, silver, 0.012, 0.26, 0.012, 0, 0.36, 0.085).rotation.x = -0.28; // 高冠正面的银脊
  gem(rig.head, silver, 0.022, 0, 0.5, 0, 1.6);
  const veil = capeMesh(rig.head, hem, { topWidth: 0.2, bottomWidth: 0.34, length: 0.55, wrap: 0.1, flare: 0.12, folds: 3, foldDepth: 0.02 });
  veil.position.set(0, 0.2, -0.08);

  // --- 背后两条封印长带：从肩后垂到小腿，写满符文 ---
  for (const sx of [1, -1]) {
    const ribbon = capeMesh(rig.cape, runes, { topWidth: 0.075, bottomWidth: 0.085, length: 0.95, wrap: 0, flare: 0.22 });
    ribbon.position.set(sx * 0.1, -0.02, -0.03);
    ribbon.rotation.z = sx * 0.07;
    // 符文带贴图是横向的：把贴图坐标转 90°，让符文沿带子排列
    const uv = ribbon.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 1.5, uv.getX(i));
  }

  return finishCharacter(rig, 'sealer', 1.98, c.scale);
}

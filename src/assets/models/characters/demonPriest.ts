// 敌人 · 恶魔祭司：暗红长袍、高立领、裸露的恶魔头颅和一对盘角，手持顶着火盆的祭杖。
// 剪影特征：大盘角、立领、宽肩袍、带火的长杖。
// 步骤 10 细化：暗紫长袍 + 暗红内衬（红色只是点缀）+ 灰紫皮肤 + 发黑的铜饰；肩披镶纹饰边并立着一圈角刺，
// 胸前挂链和倒三角护符，腰间祭刀、头骨和吊着的香炉，背后垂两条破幡；祭杖的火盆缩小，杖身缠着符文。

import { ConeGeometry, CylinderGeometry, type Group } from 'three';
import { ENEMY_RIM_CONFIG } from '../../../data/renderConfig';
import { bandMaterial, boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { ornamentStripTexture, runeStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { finishCharacter, type CharacterBaseParams } from './common';
import { ball, band, box, capeMesh, chain, cones, gem, lathe, mesh, ring, rivetRing, robeSkirt, softSeg, taperedTube, type ConeSpec } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface DemonPriestParams extends CharacterBaseParams {
  robeColor: number;
  liningColor: number; // 内衬（暗红点缀）
  mantleColor: number; // 肩披、立领
  skinColor: number;
  hornColor: number;
  trimColor: number; // 金属饰件、祭杖
  glowColor: number; // 目光、符文、杖顶的火
  glowIntensity: number;
}

export const DEMON_PRIEST_DEFAULTS: DemonPriestParams = {
  scale: 1.08,
  rim: ENEMY_RIM_CONFIG.demonPriest,
  robeColor: 0x3d1c5a,
  liningColor: 0x6a161c,
  mantleColor: 0x180c24,
  skinColor: 0x6e5a72,
  hornColor: 0x3a3028,
  trimColor: 0x8a6a34,
  glowColor: 0xff3a9a,
  glowIntensity: 4.5,
};

export function buildDemonPriest(params: Partial<DemonPriestParams> = {}): Group {
  const c = { ...DEMON_PRIEST_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.22 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const hem = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(31, 0.18) });
  const mantle = clothMaterial({ color: c.mantleColor, rim, doubleSide: true });
  const lining = clothMaterial({ color: c.liningColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(32, 0.14) });
  const pennon = clothMaterial({ color: c.liningColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(34, 0.5) });
  const edging = bandMaterial(ornamentStripTexture(c.mantleColor, c.trimColor, 31), { rim, doubleSide: true, metalness: 0.5 });
  const skin = leatherMaterial({ color: c.skinColor, rim });
  const horn = leatherMaterial({ color: c.hornColor, rim });
  const trim = plateMaterial({ color: c.trimColor, rim, metalness: 0.9 });
  const bone = boneSurfaceMaterial({ color: 0xcfc6ac, rim });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  const ember = glowMaterial(c.glowColor, c.glowIntensity * 0.6); // 杖顶的暗焰
  const runes = glowMaterial(c.glowColor, c.glowIntensity * 0.8, {
    emissiveMap: runeStripTexture(33),
    baseColor: c.mantleColor,
    doubleSide: true,
  });

  // --- 长袍下摆、腰带、挂着的小头骨 ---
  robeSkirt(rig.hips, lining, { topRadius: 0.16, bottomRadius: 0.38, length: 0.89, folds: 10 });
  robeSkirt(rig.hips, hem, { topRadius: 0.18, bottomRadius: 0.42, length: 0.78, folds: 8 });
  band(rig.hips, edging, { rTop: 0.365, rBottom: 0.39, height: 0.07, y: -0.62, depthScale: 0.86, repeat: 3, segments: 26 });
  for (const leg of [rig.legL, rig.legR]) box(leg.foot, skin, 0.09, 0.07, 0.2, 0, -0.045, 0.05);
  ring(rig.hips, trim, 0.185, 0.024, 0.05, 6, 18);
  ball(rig.hips, bone, 0.05, 0.13, -0.08, 0.15, [0.9, 1, 1]);
  box(rig.hips, bone, 0.045, 0.028, 0.035, 0.13, -0.12, 0.165); // 头骨的下颌
  rivetRing(rig.hips, trim, 0.21, 10, 0.05, 0.011, 0.86);
  // 腰间的弯刃祭刀
  const dagger = box(rig.hips, skin, 0.03, 0.09, 0.025, -0.2, -0.02, 0.06);
  dagger.rotation.z = -0.3;
  cones(dagger, trim, [{ at: [0, -0.045, 0], dir: [0.25, -1, 0], radius: 0.02, length: 0.2, flat: 0.3 }], 4);
  box(dagger, trim, 0.06, 0.012, 0.03, 0, -0.045, 0);
  // 吊在腰间的香炉：冒着暗光
  chain(rig.hips, trim, [
    [-0.12, 0.03, 0.15],
    [-0.14, -0.22, 0.2],
  ], 0.014);
  const censer = ball(rig.hips, trim, 0.045, -0.14, -0.27, 0.2, [1, 0.9, 1]);
  ball(censer, glow, 0.02, 0, 0.02, 0);
  const sash = mesh(new CylinderGeometry(0.19, 0.2, 0.07, 22, 1, true), runes, rig.hips);
  sash.position.y = -0.03;
  sash.scale.z = 0.85;

  // --- 躯干 ---
  lathe(rig.spine, robe, [
    [0.18, 0],
    [0.16, 0.14],
    [0.172, 0.29],
  ]).scale.z = 0.85;
  lathe(rig.chest, robe, [
    [0.172, 0],
    [0.2, 0.1],
    [0.18, 0.19],
    [0.09, 0.25],
  ]).scale.z = 0.84;

  // --- 宽肩披、肩上的角刺、高立领 ---
  lathe(rig.chest, mantle, [
    [0.08, 0.275],
    [0.2, 0.225],
    [0.31, 0.13],
    [0.34, 0.05],
  ]).scale.z = 0.8;
  band(rig.chest, edging, { rTop: 0.33, rBottom: 0.345, height: 0.05, y: 0.06, depthScale: 0.8, repeat: 3, segments: 26 });
  // 肩披上的一圈角刺：两肩各三根，越靠外越长
  const spikes: ConeSpec[] = [];
  for (const sx of [1, -1]) {
    for (const [dx, dz, len] of [
      [0.27, 0, 0.22],
      [0.22, 0.09, 0.15],
      [0.22, -0.1, 0.17],
    ] as const) {
      spikes.push({ at: [sx * dx, 0.2 - (dx - 0.22) * 0.6, dz], dir: [sx * 0.8, 1, dz * 2], radius: 0.034, length: len });
    }
  }
  cones(rig.chest, horn, spikes, 5);
  // 胸前交叉的挂链
  chain(rig.chest, trim, [
    [-0.2, 0.2, 0.1],
    [-0.08, 0.1, 0.19],
    [0, 0.06, 0.2],
    [0.08, 0.1, 0.19],
    [0.2, 0.2, 0.1],
  ], 0.014);
  const collar = mesh(new CylinderGeometry(0.2, 0.12, 0.26, 16, 1, true, Math.PI * 0.5, Math.PI), mantle, rig.chest);
  collar.position.set(0, 0.36, -0.02);
  // 胸前的倒三角护符
  const amulet = mesh(new ConeGeometry(0.05, 0.08, 3), trim, rig.chest);
  amulet.position.set(0, 0.13, 0.17);
  amulet.rotation.set(Math.PI, 0, 0);
  amulet.scale.z = 0.3;
  gem(rig.chest, glow, 0.02, 0, 0.14, 0.185, 1.3);

  // --- 双臂：宽袖、利爪 ---
  for (const arm of [rig.armL, rig.armR]) {
    softSeg(arm.shoulder, robe, 0.3, 0.06);
    const sleeve = mesh(new CylinderGeometry(0.064, 0.14, 0.3, 14, 1, true), robe, arm.elbow);
    sleeve.position.y = -0.14;
    const liningSleeve = mesh(new CylinderGeometry(0.05, 0.122, 0.3, 12, 1, true), lining, arm.elbow);
    liningSleeve.position.y = -0.15;
    const cuff = mesh(new CylinderGeometry(0.141, 0.143, 0.035, 14, 1, true), runes, arm.elbow);
    cuff.position.y = -0.275;
    softSeg(arm.elbow, skin, 0.26, 0.036); // 干瘦的前臂
    ring(arm.elbow, trim, 0.04, 0.008, -0.2, 4, 10); // 臂环
    ball(arm.hand, skin, 0.045, 0, -0.03, 0, [1, 1.3, 0.9]);
    for (const a of [-0.5, 0, 0.5]) {
      const claw = mesh(new ConeGeometry(0.01, 0.06, 4), horn, arm.hand);
      claw.position.set(Math.sin(a) * 0.03, -0.1, 0.01);
      claw.rotation.x = Math.PI;
    }
  }

  // --- 头：恶魔脸、下颌獠牙、一对向后盘卷的大角 ---
  ball(rig.head, skin, 0.105, 0, 0.12, 0, [0.92, 1.1, 1]);
  box(rig.head, skin, 0.1, 0.07, 0.08, 0, 0.035, 0.045); // 下颌
  box(rig.head, skin, 0.16, 0.03, 0.05, 0, 0.165, 0.085).rotation.x = 0.25; // 眉骨
  // 额心的第三只眼、头顶的一排骨棘、尖耳、下巴的骨须
  gem(rig.head, glow, 0.012, 0, 0.19, 0.1, 1.6);
  cones(
    rig.head,
    horn,
    [
      ...[0.06, 0.0, -0.06].map((z, i): ConeSpec => ({ at: [0, 0.225 - i * 0.012, z], dir: [0, 1, -0.5], radius: 0.016, length: 0.07 - i * 0.01, flat: 0.5 })),
      { at: [0.095, 0.12, -0.01], dir: [1, 0.5, -0.5], radius: 0.022, length: 0.1, flat: 0.4 },
      { at: [-0.095, 0.12, -0.01], dir: [-1, 0.5, -0.5], radius: 0.022, length: 0.1, flat: 0.4 },
      { at: [0, 0.005, 0.07], dir: [0, -1, 0.25], radius: 0.014, length: 0.08 },
    ],
    4,
  );
  for (const sx of [1, -1]) {
    const slit = box(rig.head, glow, 0.04, 0.012, 0.02, sx * 0.04, 0.135, 0.092);
    slit.rotation.z = sx * -0.3;
    const tusk = mesh(new ConeGeometry(0.011, 0.05, 4), bone, rig.head);
    tusk.position.set(sx * 0.035, 0.065, 0.085);
    taperedTube(
      rig.head,
      horn,
      [
        [sx * 0.07, 0.2, -0.01],
        [sx * 0.17, 0.3, -0.06],
        [sx * 0.25, 0.27, -0.16],
        [sx * 0.25, 0.14, -0.19],
        [sx * 0.19, 0.07, -0.1],
      ],
      0.045,
      0.008,
      7,
      16,
    );
  }

  // --- 背后的两条破幡：暗红，从肩后垂到小腿 ---
  for (const sx of [1, -1]) {
    const strip = capeMesh(rig.cape, pennon, { topWidth: 0.13, bottomWidth: 0.17, length: 1.0, wrap: 0, flare: 0.3, folds: 2, foldDepth: 0.02 });
    strip.position.set(sx * 0.13, 0.0, -0.06);
    strip.rotation.z = sx * 0.08;
  }

  // --- 祭杖：铁杖顶着一个带尖爪的小火盆；火缩成盆里的一团暗焰，杖身缠着符文带，箍边有细光线 ---
  const staff = rig.weaponMount;
  staff.rotation.x += -0.5; // 竖直握持
  mesh(new CylinderGeometry(0.018, 0.02, 1.7, 8), trim, staff).position.y = -0.05;
  const wrap = mesh(new CylinderGeometry(0.0215, 0.0215, 0.55, 8, 1, true), runes, staff);
  wrap.position.y = 0.45;
  {
    // 符文带贴图是横向的：把贴图坐标转 90°，让符文沿杖身排列
    const uv = wrap.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 1.2, uv.getX(i) * 2);
  }
  for (const y of [0.16, 0.74, -0.5]) {
    ring(staff, trim, 0.024, 0.007, y, 5, 10);
    ring(staff, glow, 0.026, 0.003, y + 0.012, 4, 10);
  }
  cones(staff, trim, [{ at: [0, -0.9, 0], dir: [0, -1, 0], radius: 0.02, length: 0.1 }], 5);
  lathe(staff, trim, [
    [0.03, 0.8],
    [0.085, 0.84],
    [0.1, 0.91],
  ]);
  ring(staff, glow, 0.102, 0.004, 0.912, 4, 18); // 盆沿的一圈细光
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const prong = mesh(new ConeGeometry(0.014, 0.16, 4), horn, staff);
    prong.position.set(Math.cos(a) * 0.098, 0.98, Math.sin(a) * 0.098);
    prong.rotation.set(Math.sin(a) * -0.25, 0, Math.cos(a) * 0.25);
  }
  ball(staff, ember, 0.05, 0, 0.93, 0, [1, 1.1, 1]);
  mesh(new ConeGeometry(0.03, 0.11, 5), ember, staff).position.y = 1.02;

  return finishCharacter(rig, 'demonPriest', 2.0, c.scale);
}

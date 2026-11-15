// Boss · 深渊魔将：两倍人高的恶魔。裸露的暗红躯干上爬满熔岩裂纹，巨大的弯角和蝠翼，
// 黑铁肩甲与腿甲，拖着一条带刺的尾巴，手提一把熔岩巨刃。
// 剪影特征：巨角、高举的双翼、宽肩窄腰、比人还长的刀。
// 步骤 10 细化：巨角加长并多一对侧角，蝠翼加大、翼膜上有发光的脉络，肩后披一件破烂的披肩，
// 躯干、四肢、尾巴全身爬满发光的熔岩裂纹（叠在皮肤外的一层裂纹光），肩甲扣着头骨、挂着锁链，
// 背上一排骨棘；巨刃的刃口是一条细的熔岩光线。红色是 Boss 独有的主题色。

import { AdditiveBlending, ConeGeometry, CylinderGeometry, Group, Mesh, type MeshStandardMaterial } from 'three';
import { ENEMY_RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { crackGlowTexture, energyFlowTexture, runeSpeckTexture, tatterAlphaTexture } from '../../textures/sprites';
import { plateTextures } from '../../textures/surfaces';
import { finishCharacter, type CharacterBaseParams } from './common';
import {
  ball,
  box,
  capeMesh,
  chain,
  cones,
  lathe,
  membrane,
  mesh,
  pauldron,
  ring,
  rivetRing,
  scaleUv,
  seg,
  softSeg,
  taperedTube,
  type ConeSpec,
} from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface AbyssLordParams extends CharacterBaseParams {
  skinColor: number;
  plateColor: number; // 黑铁甲
  trimColor: number;
  hornColor: number;
  wingColor: number; // 翼膜
  clothColor: number;
  lavaColor: number; // 熔岩裂纹、目光、刀刃
  lavaIntensity: number;
}

export const ABYSS_LORD_DEFAULTS: AbyssLordParams = {
  scale: 2.0, // Boss 约为人物的 2 倍
  rim: ENEMY_RIM_CONFIG.boss,
  skinColor: 0x6a221a,
  plateColor: 0x26272e,
  trimColor: 0x8a6030,
  hornColor: 0x2a221c,
  wingColor: 0x3a1012,
  clothColor: 0x30100e,
  lavaColor: 0xff4a12,
  lavaIntensity: 6,
};

export function buildAbyssLord(params: Partial<AbyssLordParams> = {}): Group {
  const c = { ...ABYSS_LORD_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.33, hipWidth: 0.12, upperArm: 0.32, forearm: 0.3 });
  const rim = c.rim;
  const skin = leatherMaterial({ color: c.skinColor, rim });
  const plate = plateMaterial({ color: c.plateColor, rim, metalness: 0.85 });
  const trim = plateMaterial({ color: c.trimColor, rim, metalness: 0.95 });
  const horn = leatherMaterial({ color: c.hornColor, rim });
  const bone = boneSurfaceMaterial({ color: 0xcfc6ac, rim });
  const cloth = clothMaterial({ color: c.clothColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(51, 0.4) });
  const wing = clothMaterial({ color: c.wingColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(53, 0.3) });
  const lava = glowMaterial(c.lavaColor, c.lavaIntensity);
  const lavaFlow = glowMaterial(c.lavaColor, c.lavaIntensity, { emissiveMap: energyFlowTexture(7) });
  const mantle = clothMaterial({ color: c.clothColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(55, 0.5) });
  // 刻着符文的黑铁（肩甲、刀身）
  const runedPlate = glowMaterial(c.lavaColor, c.lavaIntensity * 0.3, {
    emissiveMap: runeSpeckTexture(57, 30),
    baseColor: c.plateColor,
    surface: plateTextures(),
    metalness: 0.7,
    rim,
  });
  // 全身的熔岩裂纹：叠在皮肤外面的一层只画裂纹的光（叠加混合），不影响皮肤本身的受击闪白
  const crackMat = glowMaterial(c.lavaColor, c.lavaIntensity * 0.75, { emissiveMap: crackGlowTexture(51, 11), baseColor: 0x000000 });
  crackMat.transparent = true;
  crackMat.blending = AdditiveBlending;
  crackMat.depthWrite = false;
  const veinMat = glowMaterial(c.lavaColor, c.lavaIntensity * 0.35, {
    emissiveMap: crackGlowTexture(53, 7),
    baseColor: 0x000000,
    doubleSide: true,
  });
  veinMat.transparent = true;
  veinMat.blending = AdditiveBlending;
  veinMat.depthWrite = false;
  /** 给一块皮肤网格套上一层裂纹光（同一个几何体，略微放大） */
  const cracked = (skinMesh: Mesh, repeat = 1, mat: MeshStandardMaterial = crackMat): Mesh => {
    const shell = new Mesh(repeat === 1 ? skinMesh.geometry : skinMesh.geometry.clone(), mat);
    if (repeat !== 1) scaleUv(shell, repeat);
    shell.position.copy(skinMesh.position);
    shell.rotation.copy(skinMesh.rotation);
    shell.scale.copy(skinMesh.scale).multiplyScalar(1.012);
    skinMesh.parent?.add(shell);
    return skinMesh;
  };

  // 双臂张开一些，显得更有压迫感
  rig.armL.shoulder.rotation.set(-0.1, 0, 0.32);
  rig.armL.elbow.rotation.x = -0.45;
  rig.armR.shoulder.rotation.set(-0.25, 0, -0.34);
  rig.armR.elbow.rotation.x = -0.6;
  rig.legL.hip.rotation.z = 0.1;
  rig.legR.hip.rotation.z = -0.1;

  // --- 髋部：腰甲、骷髅腰扣、裙甲和破战裙 ---
  box(rig.hips, plate, 0.36, 0.15, 0.24, 0, -0.01, 0);
  ring(rig.hips, trim, 0.2, 0.034, 0.07, 6, 18);
  ball(rig.hips, bone, 0.06, 0, 0.06, 0.2, [0.95, 1, 0.8]);
  for (const sx of [1, -1]) {
    const tasset = box(rig.hips, plate, 0.16, 0.3, 0.03, sx * 0.16, -0.2, 0.1);
    tasset.rotation.set(-0.15, 0, sx * 0.14);
    const spike = mesh(new ConeGeometry(0.03, 0.14, 5), trim, rig.hips);
    spike.position.set(sx * 0.24, 0.02, 0);
    spike.rotation.z = sx * -1.2;
  }
  const front = capeMesh(rig.hips, cloth, { topWidth: 0.2, bottomWidth: 0.26, length: 0.62, wrap: 0, flare: -0.05 });
  front.position.set(0, 0, 0.15);
  const back = capeMesh(rig.hips, cloth, { topWidth: 0.34, bottomWidth: 0.5, length: 0.7, wrap: 0.04, flare: 0.12 });
  back.position.set(0, 0, -0.13);

  // --- 尾巴：从后腰甩出，末端带骨刺 ---
  const tailMesh = taperedTube(
    rig.hips,
    skin,
    [
      [0, 0.0, -0.12],
      [0.05, -0.2, -0.42],
      [0.2, -0.52, -0.62],
      [0.42, -0.7, -0.5],
      [0.52, -0.62, -0.3],
    ],
    0.075,
    0.018,
    8,
    16,
  );
  cracked(tailMesh, 2);
  // 尾巴上的一排骨棘
  cones(
    rig.hips,
    bone,
    [
      { at: [0.03, -0.12, -0.36], dir: [0, 1, -0.6], radius: 0.022, length: 0.1 },
      { at: [0.12, -0.36, -0.58], dir: [0.2, 0.6, -1], radius: 0.02, length: 0.09 },
      { at: [0.32, -0.63, -0.62], dir: [0.3, -0.2, -1], radius: 0.018, length: 0.08 },
    ],
    4,
  );
  const sting = mesh(new ConeGeometry(0.035, 0.16, 5), bone, rig.hips);
  sting.position.set(0.55, -0.56, -0.22);
  sting.rotation.set(0.9, 0, -0.4);

  // --- 腰腹与胸：倒三角的躯干，胸口熔岩裂纹 ---
  const belly = lathe(rig.spine, skin, [
    [0.19, 0],
    [0.175, 0.12],
    [0.21, 0.29],
  ]);
  belly.scale.z = 0.82;
  cracked(belly, 2);
  cracked(ball(rig.chest, skin, 0.25, 0, 0.09, 0.01, [1.22, 0.95, 0.86]), 2);
  // 背上的一排骨棘
  cones(
    rig.chest,
    bone,
    [0.22, 0.1, -0.02].map((y, i): ConeSpec => ({ at: [0, y, -0.2], dir: [0, 0.5, -1], radius: 0.035, length: 0.22 - i * 0.04 })),
    5,
  );
  for (const sx of [1, -1]) ball(rig.chest, skin, 0.12, sx * 0.12, 0.12, 0.13, [1.1, 0.9, 0.7]); // 胸肌
  lathe(rig.chest, skin, [
    [0.13, 0.2],
    [0.1, 0.27],
    [0.09, 0.32],
  ]);
  ball(rig.chest, lava, 0.05, 0, 0.1, 0.2, [0.7, 1.3, 0.5]); // 胸口的熔岩核心
  for (const [x, y, rz, len] of [
    [0.07, 0.17, 0.9, 0.16],
    [-0.08, 0.16, -0.8, 0.15],
    [0.1, 0.02, 0.5, 0.14],
    [-0.09, 0.0, -0.4, 0.15],
    [0.02, -0.06, 0.1, 0.12],
  ] as const) {
    const crack = box(rig.chest, lavaFlow, 0.014, len, 0.014, x, y, 0.218 - Math.abs(x) * 0.25);
    crack.rotation.z = rz;
  }
  for (const [x, y, len] of [
    [0.06, 0.2, 0.1],
    [-0.05, 0.12, 0.12],
  ] as const) {
    box(rig.spine, lavaFlow, 0.012, len, 0.012, x, y, 0.158).rotation.z = x * 6;
  }
  // 斜挎的铁链
  chain(
    rig.chest,
    trim,
    [
      [-0.26, 0.24, 0.1],
      [-0.08, 0.1, 0.225],
      [0.12, -0.06, 0.2],
      [0.2, -0.16, 0.1],
    ],
    0.03,
  );

  // --- 双臂：三层带刺肩甲、粗壮的上臂、铁护腕、利爪 ---
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    const p1 = pauldron(arm.shoulder, runedPlate, 0.17, [1.15, 0.8, 1.2]);
    p1.position.set(sx * 0.03, 0.04, 0);
    p1.rotation.z = sx * -0.35;
    const p2 = pauldron(arm.shoulder, plate, 0.13, [1.1, 0.8, 1.15]);
    p2.position.set(sx * 0.1, -0.05, 0);
    p2.rotation.z = sx * -0.8;
    for (const [dx, dy, len, rz] of [
      [0.02, 0.17, 0.26, -0.25],
      [0.12, 0.13, 0.2, -0.75],
      [-0.06, 0.15, 0.16, 0.2],
    ] as const) {
      const spike = mesh(new ConeGeometry(0.035, len, 5), horn, arm.shoulder);
      spike.position.set(sx * dx, dy + len * 0.3, 0);
      spike.rotation.z = sx * rz;
    }
    cracked(softSeg(arm.shoulder, skin, 0.32, 0.085), 1.5);
    // 肩甲上扣着的头骨和垂下的锁链，肩甲边缘一圈铆钉
    ball(arm.shoulder, bone, 0.06, sx * 0.13, 0.02, 0.1, [0.9, 1, 0.9]);
    box(arm.shoulder, bone, 0.055, 0.03, 0.04, sx * 0.13, -0.03, 0.125);
    chain(arm.shoulder, trim, [
      [sx * 0.13, -0.05, 0.12],
      [sx * 0.12, -0.24, 0.1],
    ], 0.02);
    rivetRing(arm.shoulder, trim, 0.165, 7, 0.0, 0.014, 1.2, [sx > 0 ? 0.3 : -2.8, sx > 0 ? 2.8 : -0.3]);
    ball(arm.elbow, plate, 0.08);
    cones(arm.elbow, horn, [{ at: [0, 0, -0.07], dir: [0, 0.3, -1], radius: 0.028, length: 0.14 }], 5); // 肘刺
    seg(arm.elbow, skin, 0.14, 0.075, 0.065).position.y = -0.07;
    seg(arm.elbow, plate, 0.17, 0.082, 0.068).position.y = -0.215;
    ring(arm.elbow, trim, 0.083, 0.012, -0.14, 5, 12);
    ball(arm.hand, skin, 0.07, 0, -0.04, 0, [1, 1.2, 0.9]);
    for (const a of [-0.6, -0.2, 0.2, 0.6]) {
      const claw = mesh(new ConeGeometry(0.013, 0.09, 4), horn, arm.hand);
      claw.position.set(Math.sin(a) * 0.05, -0.14, 0.015);
      claw.rotation.x = Math.PI;
    }
  }

  // --- 双腿：粗腿、铁护膝和胫甲、蹄足 ---
  for (const leg of [rig.legL, rig.legR]) {
    cracked(softSeg(leg.hip, skin, 0.42, 0.105), 1.5);
    ball(leg.knee, plate, 0.095, 0, 0, 0.025);
    const kneeSpike = mesh(new ConeGeometry(0.03, 0.12, 5), trim, leg.knee);
    kneeSpike.position.set(0, 0.03, 0.12);
    kneeSpike.rotation.x = 1.2;
    seg(leg.knee, plate, 0.36, 0.09, 0.07).position.y = -0.2;
    box(leg.foot, horn, 0.15, 0.09, 0.26, 0, -0.035, 0.05); // 蹄
    box(leg.foot, trim, 0.152, 0.025, 0.07, 0, -0.065, 0.16);
  }

  // --- 头：恶魔头颅、熔岩般的双眼和嘴、一对巨角加一对小角 ---
  ball(rig.head, skin, 0.12, 0, 0.13, 0, [0.95, 1.05, 1.05]);
  box(rig.head, skin, 0.13, 0.08, 0.1, 0, 0.035, 0.055); // 下颌
  box(rig.head, plate, 0.2, 0.04, 0.06, 0, 0.185, 0.095).rotation.x = 0.3; // 铁眉骨
  box(rig.head, lava, 0.07, 0.014, 0.02, 0, 0.045, 0.108); // 嘴缝里的火光
  for (const sx of [1, -1]) {
    const slit = box(rig.head, lava, 0.05, 0.016, 0.02, sx * 0.048, 0.145, 0.107);
    slit.rotation.z = sx * -0.35;
    const tusk = mesh(new ConeGeometry(0.014, 0.075, 4), bone, rig.head);
    tusk.position.set(sx * 0.05, 0.075, 0.1);
    // 巨角：向外、向上，角尖向内勾
    taperedTube(
      rig.head,
      horn,
      [
        [sx * 0.09, 0.2, -0.02],
        [sx * 0.3, 0.26, -0.08],
        [sx * 0.47, 0.44, -0.06],
        [sx * 0.48, 0.7, 0.02],
        [sx * 0.36, 0.9, 0.1],
        [sx * 0.24, 0.98, 0.16],
      ],
      0.075,
      0.008,
      8,
      22,
    );
    // 角上的铜箍
    for (const [bx, by, rz] of [
      [0.2, 0.225, 1.25],
      [0.4, 0.34, 0.75],
    ] as const) {
      const hoop = mesh(new CylinderGeometry(0.066, 0.066, 0.035, 8), trim, rig.head);
      hoop.position.set(sx * bx, by, -0.05);
      hoop.rotation.z = sx * -rz;
    }
    // 侧角：从颧骨向外下方再向前勾
    taperedTube(
      rig.head,
      horn,
      [
        [sx * 0.1, 0.1, 0],
        [sx * 0.2, 0.06, 0.02],
        [sx * 0.24, -0.02, 0.1],
      ],
      0.035,
      0.006,
      6,
      8,
    );
    // 小角：贴着头顶向后
    taperedTube(
      rig.head,
      horn,
      [
        [sx * 0.05, 0.23, 0],
        [sx * 0.07, 0.32, -0.08],
        [sx * 0.06, 0.36, -0.18],
      ],
      0.03,
      0.005,
      6,
      8,
    );
  }

  // --- 蝠翼：臂骨 + 三根指骨 + 破翼膜，向上向后高举；右翼是左翼的镜像 ---
  for (const sx of [1, -1]) {
    const w = new Group();
    w.name = `joint:wing${sx > 0 ? 'L' : 'R'}`;
    w.position.set(sx * 0.12, 0.16, -0.14);
    w.scale.x = sx;
    w.rotation.set(0, sx * 0.5, sx * 0.1); // 向后收
    rig.chest.add(w);
    const shoulder: [number, number] = [0, 0];
    const wrist: [number, number] = [0.48, 0.74];
    const tips: [number, number][] = [
      [1.24, 1.06],
      [1.22, 0.26],
      [0.8, -0.38],
    ];
    const bar = (a: [number, number], b: [number, number], r: number): void => {
      taperedTube(
        w,
        horn,
        [
          [a[0], a[1], 0],
          [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.03, 0],
          [b[0], b[1], 0],
        ],
        r,
        r * 0.4,
        6,
        6,
      );
    };
    bar(shoulder, wrist, 0.04);
    for (const tip of tips) bar(wrist, tip, 0.026);
    const thumb = mesh(new ConeGeometry(0.022, 0.14, 5), bone, w); // 翼腕上的爪
    thumb.position.set(wrist[0] - 0.02, wrist[1] + 0.07, 0);
    const outline: [number, number][] = [shoulder, wrist, tips[0]!, [1.12, 0.6], tips[1]!, [0.94, -0.04], tips[2]!, [0.36, -0.42], [0.04, -0.34]];
    membrane(w, wing, outline).position.z = -0.006;
    membrane(w, veinMat, outline).position.z = -0.012; // 翼膜上发光的脉络
    // 各翼指末端的爪
    cones(
      w,
      bone,
      tips.map((tip): ConeSpec => ({ at: [tip[0], tip[1], 0], dir: [tip[0] - wrist[0], tip[1] - wrist[1] - 0.2, 0], radius: 0.018, length: 0.12 })),
      4,
    );
  }

  // --- 披肩：搭在双肩后面的一件破烂短披，压在双翼之间 ---
  const shawl = capeMesh(rig.cape, mantle, { topWidth: 0.62, bottomWidth: 0.9, length: 0.85, wrap: 0.16, flare: 0.3, folds: 5, foldDepth: 0.04 });
  shawl.position.set(0, 0.06, -0.06);

  // --- 熔岩巨刃：宽厚的单刃大刀，刃口一条细的熔岩光线，刀身刻着符文和裂纹 ---
  const blade = rig.weaponMount;
  blade.rotation.x += 0.35; // 刀尖压低，斜指前方地面
  mesh(new CylinderGeometry(0.03, 0.034, 0.5, 8), horn, blade).position.y = -0.08;
  ball(blade, bone, 0.055, 0, -0.36, 0, [0.9, 1, 1]);
  box(blade, trim, 0.07, 0.06, 0.3, 0, 0.2, 0.02);
  box(blade, runedPlate, 0.028, 1.25, 0.24, 0, 0.86, 0.04);
  // 刀背的锯齿
  cones(
    blade,
    plate,
    [0.5, 0.75, 1.0, 1.25].map((y): ConeSpec => ({ at: [0, y, -0.08], dir: [0, 0.6, -1], radius: 0.03, length: 0.1, flat: 0.3 })),
    4,
  );
  const point = box(blade, plate, 0.028, 0.34, 0.24, 0, 1.52, -0.02);
  point.rotation.x = -0.62; // 斜切的刀头
  box(blade, lavaFlow, 0.03, 1.3, 0.012, 0, 0.9, 0.164); // 刃口：一条细光线
  const pointEdge = box(blade, lavaFlow, 0.03, 0.36, 0.012, 0, 1.6, 0.07);
  pointEdge.rotation.x = -0.62;
  for (const [y, len, rx] of [
    [0.55, 0.2, 0.9],
    [0.85, 0.24, -0.8],
    [1.15, 0.18, 0.7],
  ] as const) {
    box(blade, lava, 0.032, len, 0.014, 0, y, 0.04).rotation.x = rx;
  }

  return finishCharacter(rig, 'abyssLord', 2.45, c.scale);
}

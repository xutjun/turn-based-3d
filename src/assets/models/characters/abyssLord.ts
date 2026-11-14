// Boss · 深渊魔将：两倍人高的恶魔。裸露的暗红躯干上爬满熔岩裂纹，巨大的弯角和蝠翼，
// 黑铁肩甲与腿甲，拖着一条带刺的尾巴，手提一把熔岩巨刃。
// 剪影特征：巨角、高举的双翼、宽肩窄腰、比人还长的刀。

import { ConeGeometry, CylinderGeometry, Group } from 'three';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { energyFlowTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ENEMY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, capeMesh, chain, lathe, membrane, mesh, pauldron, ring, seg, softSeg, taperedTube } from './parts';
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
  rim: { ...ENEMY_RIM, strength: 0.75 },
  skinColor: 0x5c1f1a,
  plateColor: 0x1e1f24,
  trimColor: 0x6e4a22,
  hornColor: 0x1c1714,
  wingColor: 0x2a0d0e,
  clothColor: 0x240a0a,
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
  taperedTube(
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
  const sting = mesh(new ConeGeometry(0.035, 0.16, 5), bone, rig.hips);
  sting.position.set(0.55, -0.56, -0.22);
  sting.rotation.set(0.9, 0, -0.4);

  // --- 腰腹与胸：倒三角的躯干，胸口熔岩裂纹 ---
  lathe(rig.spine, skin, [
    [0.19, 0],
    [0.175, 0.12],
    [0.21, 0.29],
  ]).scale.z = 0.82;
  ball(rig.chest, skin, 0.25, 0, 0.09, 0.01, [1.22, 0.95, 0.86]);
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
    const p1 = pauldron(arm.shoulder, plate, 0.17, [1.15, 0.8, 1.2]);
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
    softSeg(arm.shoulder, skin, 0.32, 0.085);
    ball(arm.elbow, plate, 0.08);
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
    softSeg(leg.hip, skin, 0.42, 0.105);
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
        [sx * 0.26, 0.26, -0.06],
        [sx * 0.38, 0.42, -0.04],
        [sx * 0.36, 0.62, 0.02],
        [sx * 0.26, 0.74, 0.06],
      ],
      0.065,
      0.008,
      8,
      18,
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
    const wrist: [number, number] = [0.42, 0.62];
    const tips: [number, number][] = [
      [1.02, 0.86],
      [1.0, 0.22],
      [0.66, -0.3],
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
    membrane(w, wing, [shoulder, wrist, tips[0]!, [0.94, 0.5], tips[1]!, [0.78, -0.02], tips[2]!, [0.3, -0.34], [0.04, -0.3]]).position.z = -0.006;
  }

  // --- 熔岩巨刃：宽厚的单刃大刀，刃口和刀身裂纹发光 ---
  const blade = rig.weaponMount;
  blade.rotation.x += 0.35; // 刀尖压低，斜指前方地面
  mesh(new CylinderGeometry(0.03, 0.034, 0.5, 8), horn, blade).position.y = -0.08;
  ball(blade, bone, 0.055, 0, -0.36, 0, [0.9, 1, 1]);
  box(blade, trim, 0.07, 0.06, 0.3, 0, 0.2, 0.02);
  box(blade, plate, 0.028, 1.25, 0.24, 0, 0.86, 0.04);
  const point = box(blade, plate, 0.028, 0.34, 0.24, 0, 1.52, -0.02);
  point.rotation.x = -0.62; // 斜切的刀头
  box(blade, lavaFlow, 0.034, 1.3, 0.03, 0, 0.9, 0.165); // 刃口
  for (const [y, len, rx] of [
    [0.55, 0.2, 0.9],
    [0.85, 0.24, -0.8],
    [1.15, 0.18, 0.7],
  ] as const) {
    box(blade, lava, 0.032, len, 0.014, 0, y, 0.04).rotation.x = rx;
  }

  return finishCharacter(rig, 'abyssLord', 2.25, c.scale);
}

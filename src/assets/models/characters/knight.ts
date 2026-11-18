// 物理系 · 重甲骑士：宽肩重甲、桶盔带盔鳍、长披风。剪影特征：宽、方、盔顶有鳍。
// 步骤 10 细化：亮钢甲片 + 暗色锁子甲 + 旧金镶边 + 棕皮带具 + 暗红披风，五种质感分层；
// 肩甲三层叠片带铆钉，胸甲有中脊和金徽，护肘带翼片，护膝、分节铁靴、喇叭口手甲。

import { ConeGeometry, type Group } from 'three';
import { bandMaterial, clothMaterial, glowMaterial, leatherMaterial, mailMaterial, plateMaterial } from '../../materials';
import { ornamentStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import {
  ball,
  chain,
  gem,
  box,
  capeMesh,
  capeTrim,
  extruded,
  gauntlet,
  lames,
  lathe,
  mesh,
  pauldron,
  pouch,
  ring,
  rivetRing,
  rivets,
  scaleUv,
  seg,
  softSeg,
} from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface KnightParams extends CharacterBaseParams {
  plateColor: number; // 主甲片
  darkPlateColor: number; // 内衬甲
  mailColor: number; // 锁子甲
  capeTatter: number; // 披风下摆撕裂的深度（0~1）
  trimColor: number; // 镶边（旧金）
  clothColor: number; // 披风、战袍
  leatherColor: number;
  eyeColor: number; // 面甲缝隙里的目光
  eyeIntensity: number;
  crest: boolean; // 是否带盔顶的鳍
}

export const KNIGHT_DEFAULTS: KnightParams = {
  scale: 1.02,
  rim: ALLY_RIM,
  plateColor: 0xa9b1bf,
  darkPlateColor: 0x4b505c,
  mailColor: 0x8d93a0,
  capeTatter: 0.22,
  trimColor: 0xd0a242,
  clothColor: 0x9a1f18,
  leatherColor: 0x7a4f2c,
  eyeColor: 0xff7a2a,
  eyeIntensity: 5,
  crest: true,
};

export function buildKnight(params: Partial<KnightParams> = {}): Group {
  const c = { ...KNIGHT_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.27, hipWidth: 0.11 });
  const rim = c.rim;
  const plate = plateMaterial({ color: c.plateColor, rim });
  const dark = plateMaterial({ color: c.darkPlateColor, rim, metalness: 0.6 });
  const mail = mailMaterial({ color: c.mailColor, rim });
  const trim = plateMaterial({ color: c.trimColor, rim, metalness: 0.95 });
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const cloth = clothMaterial({ color: c.clothColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(3, c.capeTatter) });
  const hemBand = bandMaterial(ornamentStripTexture(c.clothColor, c.trimColor, 3), { rim, doubleSide: true });
  const eye = glowMaterial(c.eyeColor, c.eyeIntensity);

  // --- 髋部：锁子甲裙、腰带（带扣、腰包、匕首鞘）、两片叠层裙甲、战袍 ---
  box(rig.hips, dark, 0.31, 0.16, 0.21, 0, -0.02, 0);
  const skirt = lathe(rig.hips, mail, [
    [0.185, 0.04],
    [0.215, -0.14],
    [0.235, -0.27],
  ]);
  skirt.scale.z = 0.78;
  scaleUv(skirt, 4, 1.2);
  ring(rig.hips, leather, 0.19, 0.03, 0.07, 6, 20).scale.set(1, 0.8, 1);
  rivetRing(rig.hips, trim, 0.215, 12, 0.07, 0.009, 0.8);
  box(rig.hips, trim, 0.085, 0.085, 0.03, 0, 0.07, 0.178); // 带扣
  box(rig.hips, dark, 0.045, 0.045, 0.034, 0, 0.07, 0.18);
  pouch(rig.hips, leather, trim, 0.2, 0.0, 0.07, 1, 0.9);
  const sheath = box(rig.hips, leather, 0.035, 0.2, 0.03, -0.215, -0.06, 0.03); // 匕首鞘
  sheath.rotation.z = -0.25;
  box(sheath, trim, 0.05, 0.016, 0.04, 0, 0.11, 0);
  box(sheath, dark, 0.022, 0.07, 0.022, 0, 0.15, 0);
  for (const sx of [1, -1]) {
    for (const [dy, dz, w] of [
      [-0.1, 0.118, 0.16],
      [-0.215, 0.135, 0.15],
    ] as const) {
      const tasset = box(rig.hips, plate, w, 0.15, 0.028, sx * 0.14, dy, dz);
      tasset.rotation.set(-0.16, 0, sx * 0.1);
      box(tasset, trim, w + 0.004, 0.018, 0.032, 0, -0.068, 0);
    }
    const side = box(rig.hips, plate, 0.03, 0.25, 0.17, sx * 0.2, -0.16, 0);
    side.rotation.z = sx * 0.16;
    rivets(rig.hips, trim, [
      [sx * 0.085, -0.06, 0.14],
      [sx * 0.2, -0.06, 0.135],
      [sx * 0.215, -0.08, 0.06],
      [sx * 0.215, -0.08, -0.06],
    ]);
  }
  const tabard = capeMesh(rig.hips, cloth, { topWidth: 0.17, bottomWidth: 0.2, length: 0.52, wrap: 0, flare: -0.05 });
  tabard.position.set(0, 0.02, 0.15);
  const tabardEdge = box(rig.hips, hemBand, 0.19, 0.045, 0.006, 0, -0.33, 0.166);
  tabardEdge.rotation.x = 0.1;
  const sigil = extruded(
    rig.hips,
    trim,
    [
      [0, 0.06],
      [0.02, 0.02],
      [0.055, 0],
      [0.02, -0.02],
      [0, -0.075],
      [-0.02, -0.02],
      [-0.055, 0],
      [-0.02, 0.02],
    ],
    0.008,
  );
  sigil.position.set(0, -0.17, 0.162);
  sigil.rotation.x = 0.06;

  // --- 腰腹：锁子甲 + 腹甲叠片；胸甲带中脊、金徽、斜挎皮带 ---
  const waist = lathe(rig.spine, mail, [
    [0.178, 0],
    [0.158, 0.14],
    [0.172, 0.29],
  ]);
  scaleUv(waist, 4, 1.2);
  const fauld = lames(rig.spine, plate, { rTop: 0.166, rBottom: 0.19, length: 0.17, count: 3, lip: 0.01, segments: 16 });
  fauld.position.y = 0.19;
  fauld.scale.z = 0.92;
  ball(rig.chest, plate, 0.2, 0, 0.09, 0.015, [1.14, 1.0, 0.9]);
  const ridge = box(rig.chest, plate, 0.03, 0.3, 0.05, 0, 0.08, 0.172); // 胸甲中脊
  ridge.rotation.x = -0.1;
  ring(rig.chest, trim, 0.2, 0.014, -0.02, 5, 20).scale.set(1.12, 0.9, 1);
  const crestStar = extruded(
    rig.chest,
    trim,
    [
      [0, 0.07],
      [0.018, 0.018],
      [0.07, 0],
      [0.018, -0.018],
      [0, -0.07],
      [-0.018, -0.018],
      [-0.07, 0],
      [-0.018, 0.018],
    ],
    0.012,
  );
  crestStar.position.set(0, 0.13, 0.2);
  crestStar.rotation.x = -0.2;
  // 项链“烬火链坠”（步骤 22，装备表 eq_A1_necklace）：从颈甲两侧绕过金徽垂下的短金链 + 烬火色坠石。
  // 用已有的金饰和目光材质，并进胸部的合并网格（不新增材质种类）
  chain(rig.chest, trim, [
    [-0.085, 0.19, 0.15],
    [-0.08, 0.1, 0.198],
    [0, 0.05, 0.212],
    [0.08, 0.1, 0.198],
    [0.085, 0.19, 0.15],
  ], 0.009);
  gem(rig.chest, eye, 0.016, 0, 0.032, 0.214, 1.5);
  // 颈甲：两层叠片
  const gorget = lames(rig.chest, plate, { rTop: 0.1, rBottom: 0.15, length: 0.11, count: 2, lip: 0.012, segments: 16 });
  gorget.position.y = 0.3;
  ring(rig.chest, trim, 0.152, 0.01, 0.195, 5, 18);
  // 披风扣：两肩前的金扣和连着的链
  for (const sx of [1, -1]) ball(rig.chest, trim, 0.032, sx * 0.13, 0.215, 0.13, [1, 1, 0.5]);
  box(rig.chest, trim, 0.25, 0.012, 0.012, 0, 0.207, 0.145);

  // --- 双臂：三层叠片肩甲 + 尖刺 + 铆钉、上臂甲、带翼片的护肘、臂甲、喇叭口手甲 ---
  for (const [arm, sx] of [
    [rig.armL, 1],
    [rig.armR, -1],
  ] as const) {
    const layers: [number, number, number, number, typeof plate][] = [
      [0.142, 0.03, 0.03, -0.38, plate],
      [0.126, 0.08, -0.04, -0.7, dark],
      [0.108, 0.105, -0.105, -0.95, plate],
    ];
    for (const [r, x, y, rz, mat] of layers) {
      const p = pauldron(arm.shoulder, mat, r, [1.15, 0.8, 1.22]);
      p.position.set(sx * x, y, 0);
      p.rotation.z = sx * rz;
    }
    // 肩甲上的铆钉
    rivets(arm.shoulder, trim, [
      [sx * 0.05, 0.1, 0.12],
      [sx * 0.12, 0.05, 0.13],
      [sx * 0.05, 0.1, -0.12],
      [sx * 0.12, 0.05, -0.13],
      [sx * 0.15, -0.04, 0.11],
      [sx * 0.15, -0.04, -0.11],
    ]);
    const spike = mesh(new ConeGeometry(0.032, 0.15, 6), trim, arm.shoulder);
    spike.position.set(sx * 0.09, 0.145, 0);
    spike.rotation.z = sx * -0.55;

    scaleUv(softSeg(arm.shoulder, mail, 0.29, 0.066), 3, 2);
    seg(arm.shoulder, plate, 0.13, 0.076, 0.07).position.set(sx * 0.008, -0.2, 0); // 上臂甲
    ball(arm.elbow, plate, 0.074, 0, 0, -0.012);
    const wing = ball(arm.elbow, plate, 0.062, sx * 0.05, 0, -0.01, [0.35, 1.05, 1.1]); // 护肘翼片
    wing.rotation.z = sx * 0.2;
    rivets(arm.elbow, trim, [[sx * 0.074, 0, -0.01]], 0.012);
    seg(arm.elbow, plate, 0.24, 0.076, 0.058).position.y = -0.135;
    ring(arm.elbow, trim, 0.074, 0.009, -0.035, 5, 12);
    ring(arm.elbow, trim, 0.061, 0.009, -0.245, 5, 12);
    box(arm.elbow, plate, 0.02, 0.2, 0.02, sx * 0.058, -0.14, 0); // 臂甲外侧的棱
    gauntlet(arm.hand, dark, { cuff: plate, knuckle: trim, side: sx, size: 1.12 });
  }

  // --- 双腿：锁甲裤、腿甲、带翼片的护膝、胫甲（中脊）、分节铁靴 ---
  for (const [leg, sx] of [
    [rig.legL, 1],
    [rig.legR, -1],
  ] as const) {
    scaleUv(softSeg(leg.hip, mail, 0.42, 0.092), 3, 2.5);
    seg(leg.hip, plate, 0.3, 0.108, 0.09).position.set(0, -0.2, 0.012);
    ring(leg.hip, trim, 0.092, 0.008, -0.345, 5, 14).position.z = 0.012;
    ball(leg.knee, plate, 0.088, 0, 0, 0.028, [1, 1.1, 1]);
    const fan = ball(leg.knee, plate, 0.07, sx * 0.06, 0, 0.01, [0.3, 1.1, 1.1]); // 护膝翼片
    fan.rotation.z = sx * 0.15;
    rivets(leg.knee, trim, [[0, 0, 0.118]], 0.014);
    seg(leg.knee, plate, 0.36, 0.086, 0.066).position.y = -0.2;
    const shinRidge = box(leg.knee, plate, 0.022, 0.3, 0.03, 0, -0.2, 0.072);
    shinRidge.rotation.x = 0.03;
    ring(leg.knee, trim, 0.07, 0.008, -0.365, 5, 12);
    box(leg.knee, leather, 0.02, 0.05, 0.17, sx * 0.075, -0.12, 0); // 绑带
    // 铁靴：三节甲片 + 鞋尖 + 鞋跟马刺
    box(leg.foot, dark, 0.125, 0.085, 0.15, 0, -0.038, 0);
    for (let i = 0; i < 3; i++) {
      const lame = box(leg.foot, plate, 0.132 - i * 0.008, 0.05 - i * 0.006, 0.075, 0, -0.045 - i * 0.008, 0.07 + i * 0.058);
      lame.rotation.x = 0.22;
    }
    ball(leg.foot, plate, 0.058, 0, -0.062, 0.215, [0.95, 0.5, 1.3]);
    box(leg.foot, trim, 0.134, 0.016, 0.05, 0, -0.072, 0.06);
    box(leg.foot, trim, 0.012, 0.012, 0.045, 0, -0.045, -0.085); // 马刺
  }

  // --- 头：桶盔、T 形面甲缝、通气孔、盔沿铆钉、盔鳍、锁甲护颈 ---
  const aventail = lathe(rig.head, mail, [
    [0.138, 0.0],
    [0.165, -0.07],
    [0.19, -0.11],
  ]);
  scaleUv(aventail, 4, 0.8);
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
  box(rig.head, trim, 0.026, 0.22, 0.03, 0, 0.09, 0.136); // 竖向鼻梁
  box(rig.head, trim, 0.2, 0.022, 0.03, 0, 0.152, 0.126); // 眉梁
  ring(rig.head, trim, 0.142, 0.012, 0.05, 5, 20);
  ring(rig.head, trim, 0.147, 0.012, -0.058, 5, 20);
  rivetRing(rig.head, trim, 0.142, 10, 0.205, 0.008, 1, [0.6, Math.PI * 2 - 0.6]);
  // 面甲两侧的通气孔
  for (const sx of [1, -1]) {
    const holes: [number, number, number][] = [];
    for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) holes.push([sx * (0.05 + i * 0.024), 0.04 - k * 0.03, 0.134 - i * 0.012]);
    rivets(rig.head, dark, holes, 0.008);
  }
  if (c.crest) {
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
      0.024,
    );
    fin.rotation.y = -Math.PI / 2; // 轮廓的 x 轴转到前后方向
    box(rig.head, trim, 0.034, 0.024, 0.27, 0, 0.268, -0.005).rotation.x = 0.1; // 盔鳍的金属底座
  }

  // --- 披风：带褶皱，下沿一道金色纹饰边 ---
  const capeShape = { topWidth: 0.5, bottomWidth: 0.82, length: 1.12, wrap: 0.07, flare: 0.3, folds: 5, foldDepth: 0.035 };
  capeMesh(rig.cape, cloth, capeShape);
  capeTrim(rig.cape, hemBand, capeShape, 0.66, 0.73, 3);

  return finishCharacter(rig, 'knight', c.crest ? 1.9 : 1.78, c.scale);
}

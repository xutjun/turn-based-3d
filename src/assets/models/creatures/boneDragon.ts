// 宝宝 · 骨龙幼崽：两足站立的小骨龙，脊椎弯成 S 形，肋骨笼里有一团发光的魂火，背后一对破翼。
// 剪影特征：长颈、大头、张开的破翼、长尾。
//
// 步骤 10 返工：按“战场相机的实际距离”设计。
//   - 骨架整体加粗（脊椎、肋骨、腿骨、翼骨都是原来的 1.6~2 倍），骨节更大，远看是连续的形体而不是点线；
//   - 骨色提亮成象牙白；翼膜提亮成紫灰，上面有发光的脉络，翼骨轮廓更粗更清楚；
//   - 头放大，角更长更粗，牙少而大，眼窝发光；脊椎上每隔一节嵌一颗发光的符文珠，远景里是一串光点；
//   - 整体略增大，头、胸腔、翼、尾在剪影里各占一块。

import { AdditiveBlending, CatmullRomCurve3, Group, TorusGeometry, Vector3 } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { crackGlowTexture, runeSpeckTexture, tatterAlphaTexture } from '../../textures/sprites';
import { boneTextures } from '../../textures/surfaces';
import { ball, box, cones, gem, membrane, mesh, ring, seg, taperedTube, type ConeSpec } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface BoneDragonParams extends CreatureBaseParams {
  boneColor: number;
  membraneColor: number; // 翼膜
  glowColor: number; // 魂火、目光、符文
  glowIntensity: number;
  harnessColor: number; // 皮鞍带
  ringColor: number; // 鞍环、颈环
}

export const BONE_DRAGON_DEFAULTS: BoneDragonParams = {
  scale: 1.12,
  rim: RIM_CONFIG.pet,
  boneColor: 0xe6e2d0,
  membraneColor: 0x8a6ab8,
  glowColor: 0x8f7bff,
  glowIntensity: 5,
  harnessColor: 0x6a4428,
  ringColor: 0xc9a44e,
};

export function buildBoneDragon(params: Partial<BoneDragonParams> = {}): Group {
  const c = { ...BONE_DRAGON_DEFAULTS, ...params };
  const root = new Group();
  const bone = boneSurfaceMaterial({ color: c.boneColor, rim: c.rim });
  const wing = clothMaterial({
    color: c.membraneColor,
    rim: c.rim,
    doubleSide: true,
    alphaMap: tatterAlphaTexture(9, 0.3),
  });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  // 刻着符文的骨头：骨质表面上零散的发光刻痕（骨盆、头骨）
  const runedBone = glowMaterial(c.glowColor, c.glowIntensity * 0.5, {
    emissiveMap: runeSpeckTexture(9, 46),
    baseColor: c.boneColor,
    surface: boneTextures(),
    rim: c.rim,
  });
  // 翼膜上的发光脉络：叠在翼膜外的一层（叠加混合）
  const veins = glowMaterial(c.glowColor, c.glowIntensity * 0.3, {
    emissiveMap: crackGlowTexture(19, 8),
    baseColor: 0x000000,
    doubleSide: true,
  });
  veins.transparent = true;
  veins.blending = AdditiveBlending;
  veins.depthWrite = false;
  const harness = leatherMaterial({ color: c.harnessColor, rim: c.rim });
  const gold = plateMaterial({ color: c.ringColor, rim: c.rim, metalness: 0.9 });

  // --- 脊椎：从尾尖经骨盆、胸、脖子到头的一条曲线，上面排粗大的椎骨和背刺 ---
  const body = joint('body', root);
  const spine = new CatmullRomCurve3(
    [
      [0.12, -0.86],
      [0.15, -0.62],
      [0.3, -0.38],
      [0.47, -0.18],
      [0.62, 0.04],
      [0.8, 0.16],
      [0.96, 0.17],
      [1.04, 0.26],
    ].map(([y, z]) => new Vector3(0, y!, z!)),
  );
  // 先铺一根连续的“脊索”，保证远看是连成一条的形体
  taperedTube(
    body,
    bone,
    spine.getPoints(14).map((q) => [q.x, q.y, q.z] as [number, number, number]),
    0.022,
    0.036,
    6,
    20,
  );
  const count = 14;
  const p = new Vector3();
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    spine.getPointAt(t, p);
    // 尾巴细，胸腔处最粗，脖子再变细
    const r = 0.038 + 0.05 * Math.sin(Math.min(1, t * 1.25) * Math.PI);
    ball(body, bone, r, 0, p.y, p.z, [1.25, 0.8, 1]);
    // 每隔一节嵌一颗发光的符文珠（两侧各一颗），远景里是一串光点
    if (i % 2 === 1 && t > 0.1 && t < 0.92) {
      for (const sx of [1, -1]) ball(body, glow, r * 0.3, sx * r * 1.05, p.y, p.z);
    }
    if (i % 2 === 0 && t > 0.08 && t < 0.88) {
      const tan = spine.getTangentAt(t);
      // 背刺垂直于脊椎，朝上/朝后
      cones(
        body,
        bone,
        [{ at: [0, p.y + tan.z * r * 0.6, p.z - tan.y * r * 0.6], dir: [0, tan.z, -tan.y], radius: r * 0.55, length: r * 2.6, flat: 0.5 }],
        4,
      );
    }
  }

  // --- 肋骨笼与魂火 ---
  const chest = joint('chest', body, 0, 0.56, -0.04);
  chest.rotation.x = 0.85; // 肋骨平面垂直于脊椎
  for (let i = 0; i < 4; i++) {
    const r = 0.125 + 0.04 * Math.sin(((i + 0.5) / 4) * Math.PI);
    const rib = mesh(new TorusGeometry(r, 0.022, 5, 12, Math.PI * 1.55), bone, chest);
    rib.position.set(0, -0.15 + i * 0.095, -r * 0.55);
    rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.725 + Math.PI / 2);
    rib.scale.set(1, 1.25, 1);
  }
  ball(chest, glow, 0.07, 0, 0, -0.12);
  box(chest, bone, 0.05, 0.38, 0.035, 0, 0, -0.27); // 胸骨
  ball(body, runedBone, 0.11, 0, 0.45, -0.2, [1.5, 0.9, 1]); // 骨盆
  // 鞍带与颈环：皮带绕过胸腔，背上一个金环，颈根一道金箍
  const girth = ring(chest, harness, 0.17, 0.02, 0.02, 4, 16);
  girth.position.z = -0.1;
  girth.scale.set(1, 1.2, 1);
  const saddleRing = ring(chest, gold, 0.045, 0.012, 0, 4, 12);
  saddleRing.position.set(0, 0.02, 0.1);
  saddleRing.rotation.set(0, 0, 0);
  const neckRing = ring(body, gold, 0.07, 0.016, 0, 5, 12);
  neckRing.position.set(0, 0.82, 0.17);
  neckRing.rotation.x = Math.PI / 2 - 0.9;
  // 尾端的骨刃
  cones(
    body,
    bone,
    [
      { at: [0, 0.12, -0.84], dir: [0, -0.3, -1], radius: 0.075, length: 0.26, flat: 0.25 },
      { at: [0, 0.13, -0.82], dir: [0, 1, -0.5], radius: 0.035, length: 0.14, flat: 0.4 },
      { at: [0, 0.11, -0.82], dir: [0, -1, -0.2], radius: 0.035, length: 0.11, flat: 0.4 },
    ],
    5,
  );
  // 小前肢：蜷在胸前的两只骨爪
  for (const sx of [1, -1]) {
    const arm = joint(`arm${sx > 0 ? 'L' : 'R'}`, body, sx * 0.11, 0.64, 0.07);
    arm.rotation.set(-0.9, 0, sx * 0.25);
    seg(arm, bone, 0.14, 0.026, 0.02, 5);
    const fore = joint(`fore${sx > 0 ? 'L' : 'R'}`, arm, 0, -0.14, 0);
    fore.rotation.x = -1.3;
    ball(fore, bone, 0.026);
    seg(fore, bone, 0.12, 0.02, 0.015, 5);
    cones(
      fore,
      bone,
      [-0.5, 0.5].map((a): ConeSpec => ({ at: [Math.sin(a) * 0.014, -0.12, 0], dir: [Math.sin(a), -1, 0.3], radius: 0.012, length: 0.07 })),
      4,
    );
  }

  // --- 后腿：两足站立，粗壮的腿骨和大骨节，三趾爪 ---
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    const hip = joint(`leg${tag}`, body, sx * 0.14, 0.45, -0.2);
    hip.rotation.set(-0.65, 0, sx * 0.12);
    ball(hip, bone, 0.06);
    seg(hip, bone, 0.26, 0.052, 0.04, 6);
    const knee = joint(`knee${tag}`, hip, 0, -0.26, 0);
    knee.rotation.x = 1.1;
    ball(knee, bone, 0.055);
    seg(knee, bone, 0.25, 0.042, 0.032, 6);
    const foot = joint(`foot${tag}`, knee, 0, -0.25, 0);
    foot.rotation.set(-0.45, 0, sx * -0.12);
    ball(foot, bone, 0.042);
    cones(
      foot,
      bone,
      [
        ...[-0.5, 0, 0.5].map((a): ConeSpec => ({ at: [Math.sin(a) * 0.03, 0.01, 0.02], dir: [Math.sin(a), -0.08, Math.cos(a)], radius: 0.026, length: 0.17 })),
        { at: [0, 0.02, -0.01], dir: [0, 0.2, -1], radius: 0.02, length: 0.08 }, // 后跟的距爪
      ],
      4,
    );
  }

  // --- 翅膀：粗臂骨 + 三根指骨 + 提亮的破翼膜和发光脉络，右翼是左翼的镜像 ---
  for (const sx of [1, -1]) {
    const w = joint(`wing${sx > 0 ? 'L' : 'R'}`, body, sx * 0.08, 0.64, -0.06);
    w.scale.x = sx;
    w.rotation.y = sx * 0.7; // 向后收
    w.rotation.z = sx * 0.12;
    const root2: [number, number] = [0, 0];
    const elbow: [number, number] = [0.27, 0.24];
    const tips: [number, number][] = [
      [0.76, 0.32],
      [0.68, -0.06],
      [0.4, -0.3],
    ];
    const bar = (a: [number, number], b: [number, number], r: number): void => {
      taperedTube(
        w,
        bone,
        [
          [a[0], a[1], 0],
          [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.015, 0],
          [b[0], b[1], 0],
        ],
        r,
        r * 0.5,
        5,
        4,
      );
    };
    bar(root2, elbow, 0.036);
    for (const tip of tips) bar(elbow, tip, 0.026);
    ball(w, bone, 0.045, elbow[0], elbow[1], 0);
    // 翼肘的钩爪和各翼指末端的爪
    cones(
      w,
      bone,
      [
        { at: [elbow[0], elbow[1], 0], dir: [-0.3, 1, 0], radius: 0.024, length: 0.13 },
        ...tips.map((tip): ConeSpec => ({ at: [tip[0], tip[1], 0], dir: [tip[0] - elbow[0], tip[1] - elbow[1] - 0.15, 0], radius: 0.016, length: 0.08 })),
      ],
      4,
    );
    const outline: [number, number][] = [root2, elbow, tips[0]!, [0.7, 0.1], tips[1]!, [0.52, -0.14], tips[2]!, [0.12, -0.24]];
    membrane(w, wing, outline).position.z = -0.004;
    membrane(w, veins, outline).position.z = -0.01;
  }

  // --- 头骨：放大的头，长吻、后掠的大角、发光的眼窝、几颗大牙 ---
  const head = joint('head', body, 0, 1.06, 0.27);
  head.rotation.x = 0.25;
  head.scale.setScalar(1.55);
  ball(head, runedBone, 0.078, 0, 0, 0, [0.98, 0.84, 1.1]);
  box(head, bone, 0.08, 0.055, 0.17, 0, -0.012, 0.12).rotation.x = 0.08;
  const jaw = joint('jaw', head, 0, -0.045, 0.02);
  jaw.rotation.x = 0.3;
  box(jaw, bone, 0.066, 0.024, 0.16, 0, 0, 0.085);
  cones(
    jaw,
    bone,
    [1, -1].flatMap((sx) => [0.08, 0.14].map((z): ConeSpec => ({ at: [sx * 0.026, 0.01, z], dir: [0, 1, 0], radius: 0.009, length: 0.03 }))),
    4,
  );
  for (const sx of [1, -1]) {
    ball(head, glow, 0.02, sx * 0.042, 0.014, 0.055);
    box(head, bone, 0.034, 0.016, 0.055, sx * 0.042, 0.04, 0.055).rotation.z = sx * -0.3; // 眉骨
    // 后掠的大角
    taperedTube(
      head,
      bone,
      [
        [sx * 0.04, 0.045, -0.03],
        [sx * 0.075, 0.1, -0.11],
        [sx * 0.085, 0.16, -0.19],
        [sx * 0.075, 0.2, -0.24],
      ],
      0.03,
      0.005,
      5,
      8,
    );
    cones(
      head,
      bone,
      [
        { at: [sx * 0.03, -0.035, 0.18], dir: [0, -1, 0.1], radius: 0.011, length: 0.045 }, // 上颌的獠牙
        { at: [sx * 0.03, -0.035, 0.1], dir: [0, -1, 0], radius: 0.009, length: 0.03 },
        { at: [sx * 0.06, -0.01, -0.02], dir: [sx * 1, -0.2, -0.8], radius: 0.02, length: 0.1 }, // 颊刺
      ],
      4,
    );
  }
  // 头顶的中刺
  cones(
    head,
    bone,
    [0.02, -0.04].map((z, i): ConeSpec => ({ at: [0, 0.055, z], dir: [0, 1, -0.7], radius: 0.016, length: 0.08 - i * 0.015, flat: 0.5 })),
    4,
  );
  gem(head, glow, 0.012, 0, 0.062, 0.06, 1.4); // 额心的印记

  return finishCreature(root, 'boneDragon', 1.34, c.scale);
}

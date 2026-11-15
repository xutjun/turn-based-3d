// 宝宝 · 骨龙幼崽：两足站立的小骨龙，脊椎弯成 S 形，肋骨笼里有一团发光的魂火，背后一对破翼。
// 剪影特征：长颈、张开的破翼、长尾。
// 步骤 10 细化：骨白骨架 + 暗紫翼膜 + 旧金鞍环（友方宝宝的标记）；更大的后掠角和颊刺、成排的牙、
// 翼指末端的爪、尾端骨刃、小前肢，脊椎上刻着发光的符文。

import { CatmullRomCurve3, ConeGeometry, Group, TorusGeometry, Vector3 } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { runeSpeckTexture, tatterAlphaTexture } from '../../textures/sprites';
import { boneTextures } from '../../textures/surfaces';
import { ball, box, cones, gem, membrane, mesh, ring, seg, taperedTube, type ConeSpec } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface BoneDragonParams extends CreatureBaseParams {
  boneColor: number;
  membraneColor: number; // 翼膜
  glowColor: number; // 魂火与目光
  glowIntensity: number;
  harnessColor: number; // 皮鞍带
  ringColor: number; // 鞍环、颈环
}

export const BONE_DRAGON_DEFAULTS: BoneDragonParams = {
  scale: 1,
  rim: RIM_CONFIG.pet,
  boneColor: 0xb9bcae,
  membraneColor: 0x4a3470,
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
    alphaMap: tatterAlphaTexture(9, 0.4),
  });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  // 刻着符文的骨头：骨质表面上零散的发光刻痕
  const runedBone = glowMaterial(c.glowColor, c.glowIntensity * 0.5, {
    emissiveMap: runeSpeckTexture(9, 46),
    baseColor: c.boneColor,
    surface: boneTextures(),
    rim: c.rim,
  });
  const harness = leatherMaterial({ color: c.harnessColor, rim: c.rim });
  const gold = plateMaterial({ color: c.ringColor, rim: c.rim, metalness: 0.9 });

  // --- 脊椎：从尾尖经骨盆、胸、脖子到头的一条曲线，上面排椎骨和背刺 ---
  const body = joint('body', root);
  const spine = new CatmullRomCurve3(
    [
      [0.1, -0.82],
      [0.14, -0.6],
      [0.3, -0.38],
      [0.47, -0.18],
      [0.62, 0.04],
      [0.78, 0.16],
      [0.94, 0.17],
      [1.02, 0.26],
    ].map(([y, z]) => new Vector3(0, y!, z!)),
  );
  const count = 20;
  const p = new Vector3();
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    spine.getPointAt(t, p);
    // 尾巴细，胸腔处最粗，脖子再变细
    const r = 0.022 + 0.034 * Math.sin(Math.min(1, t * 1.25) * Math.PI);
    ball(body, i % 3 === 1 ? runedBone : bone, r, 0, p.y, p.z, [1.2, 0.8, 1]);
    // 椎骨两侧的横突
    if (t > 0.2 && t < 0.9 && i % 2 === 1) box(body, bone, r * 3.4, r * 0.5, r * 0.7, 0, p.y, p.z);
    if (i % 2 === 0 && t > 0.08 && t < 0.86) {
      const spike = mesh(new ConeGeometry(r * 0.5, r * 2.6, 4), bone, body);
      const tan = spine.getTangentAt(t);
      // 背刺垂直于脊椎，朝上/朝后
      spike.position.set(0, p.y + tan.z * r * 1.6, p.z - tan.y * r * 1.6);
      spike.rotation.x = Math.atan2(-tan.y, tan.z);
    }
  }

  // --- 肋骨笼与魂火 ---
  const chest = joint('chest', body, 0, 0.56, -0.04);
  chest.rotation.x = 0.85; // 肋骨平面垂直于脊椎
  for (let i = 0; i < 4; i++) {
    const r = 0.1 + 0.03 * Math.sin(((i + 0.5) / 4) * Math.PI);
    const rib = mesh(new TorusGeometry(r, 0.011, 5, 14, Math.PI * 1.55), bone, chest);
    rib.position.set(0, -0.14 + i * 0.085, -r * 0.55);
    rib.rotation.set(Math.PI / 2, 0, Math.PI * 0.725 + Math.PI / 2);
    rib.scale.set(1, 1.25, 1);
  }
  ball(chest, glow, 0.055, 0, 0, -0.1);
  box(chest, bone, 0.03, 0.34, 0.02, 0, 0, -0.215); // 胸骨
  ball(body, runedBone, 0.075, 0, 0.45, -0.2, [1.5, 0.9, 1]); // 骨盆
  // 鞍带与颈环：皮带绕过胸腔，背上一个金环，颈根一道金箍
  const girth = ring(chest, harness, 0.135, 0.016, 0.02, 4, 18);
  girth.position.z = -0.08;
  girth.scale.set(1, 1.2, 1);
  const saddleRing = ring(chest, gold, 0.035, 0.009, 0, 4, 12);
  saddleRing.position.set(0, 0.02, 0.085);
  saddleRing.rotation.set(0, 0, 0);
  const neckRing = ring(body, gold, 0.05, 0.012, 0, 5, 14);
  neckRing.position.set(0, 0.8, 0.165);
  neckRing.rotation.x = Math.PI / 2 - 0.9;
  gem(body, glow, 0.018, 0, 0.775, 0.215, 1.4);
  // 尾端的骨刃
  const blade: ConeSpec[] = [
    { at: [0, 0.1, -0.82], dir: [0, -0.35, -1], radius: 0.05, length: 0.2, flat: 0.25 },
    { at: [0, 0.11, -0.8], dir: [0, 1, -0.5], radius: 0.022, length: 0.1, flat: 0.4 },
    { at: [0, 0.09, -0.8], dir: [0, -1, -0.2], radius: 0.022, length: 0.08, flat: 0.4 },
  ];
  cones(body, bone, blade, 5);
  // 小前肢：蜷在胸前的两只骨爪
  for (const sx of [1, -1]) {
    const arm = joint(`arm${sx > 0 ? 'L' : 'R'}`, body, sx * 0.09, 0.62, 0.06);
    arm.rotation.set(-0.9, 0, sx * 0.25);
    seg(arm, bone, 0.13, 0.016, 0.012, 5);
    const fore = joint(`fore${sx > 0 ? 'L' : 'R'}`, arm, 0, -0.13, 0);
    fore.rotation.x = -1.3;
    seg(fore, bone, 0.11, 0.012, 0.009, 5);
    cones(
      fore,
      bone,
      [-0.5, 0, 0.5].map((a): ConeSpec => ({ at: [Math.sin(a) * 0.012, -0.11, 0], dir: [Math.sin(a), -1, 0.3], radius: 0.007, length: 0.05 })),
      4,
    );
  }

  // --- 后腿：两足站立，三趾爪 ---
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    const hip = joint(`leg${tag}`, body, sx * 0.105, 0.45, -0.2);
    hip.rotation.set(-0.65, 0, sx * 0.12);
    seg(hip, bone, 0.26, 0.03, 0.022, 6);
    const knee = joint(`knee${tag}`, hip, 0, -0.26, 0);
    knee.rotation.x = 1.1;
    ball(knee, bone, 0.03);
    seg(knee, bone, 0.25, 0.024, 0.018, 6);
    const foot = joint(`foot${tag}`, knee, 0, -0.25, 0);
    foot.rotation.set(-0.45, 0, sx * -0.12);
    for (const a of [-0.45, 0, 0.45]) {
      const toe = mesh(new ConeGeometry(0.014, 0.12, 4), bone, foot);
      toe.rotation.set(Math.PI / 2, 0, -a);
      toe.position.set(Math.sin(a) * 0.05, 0.012, 0.04 + Math.cos(a) * 0.04);
    }
    // 后跟的距爪
    cones(foot, bone, [{ at: [0, 0.02, -0.01], dir: [0, 0.2, -1], radius: 0.012, length: 0.06 }], 4);
  }

  // --- 翅膀：臂骨 + 三根指骨 + 破翼膜，右翼是左翼的镜像 ---
  for (const sx of [1, -1]) {
    const w = joint(`wing${sx > 0 ? 'L' : 'R'}`, body, sx * 0.06, 0.62, -0.04);
    w.scale.x = sx;
    w.rotation.y = sx * 0.7; // 向后收
    w.rotation.z = sx * 0.12;
    const root2: [number, number] = [0, 0];
    const elbow: [number, number] = [0.24, 0.2];
    const tips: [number, number][] = [
      [0.66, 0.26],
      [0.58, -0.06],
      [0.34, -0.26],
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
        r * 0.45,
        5,
        4,
      );
    };
    bar(root2, elbow, 0.02);
    for (const tip of tips) bar(elbow, tip, 0.014);
    ball(w, bone, 0.024, elbow[0], elbow[1], 0);
    // 翼肘的钩爪和各翼指末端的爪
    cones(
      w,
      bone,
      [
        { at: [elbow[0], elbow[1], 0], dir: [-0.3, 1, 0], radius: 0.014, length: 0.09 },
        ...tips.map((tip): ConeSpec => ({ at: [tip[0], tip[1], 0], dir: [tip[0] - elbow[0], tip[1] - elbow[1] - 0.15, 0], radius: 0.009, length: 0.06 })),
      ],
      4,
    );
    membrane(w, wing, [root2, elbow, tips[0]!, [0.6, 0.08], tips[1]!, [0.44, -0.12], tips[2]!, [0.1, -0.2]]).position.z = -0.004;
  }

  // --- 头骨：长吻、后掠的角、发光的眼窝 ---
  const head = joint('head', body, 0, 1.03, 0.27);
  head.rotation.x = 0.25;
  ball(head, bone, 0.075, 0, 0, 0, [0.95, 0.82, 1.1]);
  box(head, bone, 0.075, 0.05, 0.16, 0, -0.012, 0.12).rotation.x = 0.08;
  const jaw = joint('jaw', head, 0, -0.045, 0.02);
  jaw.rotation.x = 0.3;
  box(jaw, bone, 0.06, 0.02, 0.15, 0, 0, 0.08);
  for (const sx of [1, -1]) {
    ball(head, glow, 0.016, sx * 0.04, 0.012, 0.055);
    taperedTube(
      head,
      bone,
      [
        [sx * 0.04, 0.045, -0.03],
        [sx * 0.065, 0.1, -0.11],
        [sx * 0.07, 0.17, -0.2],
      ],
      0.02,
      0.004,
      5,
      6,
    );
    const fang = mesh(new ConeGeometry(0.008, 0.035, 4), bone, head);
    fang.position.set(sx * 0.026, -0.05, 0.18);
    fang.rotation.x = Math.PI;
    // 上颌的一排牙、颊刺、眉骨
    cones(
      head,
      bone,
      [
        ...[0.08, 0.11, 0.14].map((z): ConeSpec => ({ at: [sx * 0.032, -0.036, z], dir: [0, -1, 0], radius: 0.006, length: 0.022 })),
        { at: [sx * 0.06, -0.01, -0.02], dir: [sx * 1, -0.2, -0.8], radius: 0.014, length: 0.09 },
        { at: [sx * 0.055, 0.0, -0.05], dir: [sx * 0.8, -0.6, -1], radius: 0.011, length: 0.07 },
      ],
      4,
    );
    box(head, bone, 0.03, 0.014, 0.05, sx * 0.04, 0.036, 0.055).rotation.z = sx * -0.3;
  }
  // 下颌的牙和头顶的中刺
  cones(
    jaw,
    bone,
    [1, -1].flatMap((sx) => [0.06, 0.1, 0.14].map((z): ConeSpec => ({ at: [sx * 0.024, 0.008, z], dir: [0, 1, 0], radius: 0.005, length: 0.02 }))),
    4,
  );
  cones(
    head,
    bone,
    [0.02, -0.03, -0.07].map((z, i): ConeSpec => ({ at: [0, 0.055, z], dir: [0, 1, -0.7], radius: 0.012, length: 0.07 - i * 0.012, flat: 0.5 })),
    4,
  );

  return finishCreature(root, 'boneDragon', 1.2, c.scale);
}

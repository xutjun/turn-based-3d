// 宝宝 · 骨龙幼崽：两足站立的小骨龙，脊椎弯成 S 形，肋骨笼里有一团发光的魂火，背后一对破翼。
// 剪影特征：长颈、张开的破翼、长尾。

import { CatmullRomCurve3, ConeGeometry, Group, TorusGeometry, Vector3 } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, clothMaterial, glowMaterial } from '../../materials';
import { tatterAlphaTexture } from '../../textures/sprites';
import { ball, box, membrane, mesh, seg, taperedTube } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface BoneDragonParams extends CreatureBaseParams {
  boneColor: number;
  membraneColor: number; // 翼膜
  glowColor: number; // 魂火与目光
  glowIntensity: number;
}

export const BONE_DRAGON_DEFAULTS: BoneDragonParams = {
  scale: 1,
  rim: RIM_CONFIG.ally,
  boneColor: 0xd9d0b6,
  membraneColor: 0x2a2440,
  glowColor: 0x8f7bff,
  glowIntensity: 5,
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
    ball(body, bone, r, 0, p.y, p.z, [1.2, 0.8, 1]);
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
  ball(body, bone, 0.07, 0, 0.45, -0.2, [1.5, 0.9, 1]); // 骨盆

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
  }

  return finishCreature(root, 'boneDragon', 1.2, c.scale);
}

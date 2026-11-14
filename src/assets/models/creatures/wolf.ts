// 宝宝 · 暗影狼：低伏的四足兽，背上一排竖起的鬃刺，眼睛发光。剪影特征：长、低、尖耳、背刺。
// 通过参数换毛色，灰狼和赤狼共用这一个 builder。

import { CapsuleGeometry, ConeGeometry, CylinderGeometry, Group } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, glowMaterial, leatherMaterial } from '../../materials';
import { ball, box, mesh, seg, taperedTube } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface WolfParams extends CreatureBaseParams {
  furColor: number; // 皮毛
  maneColor: number; // 鬃刺、尾尖
  eyeColor: number;
  eyeIntensity: number;
  fangColor: number;
}

export const WOLF_DEFAULTS: WolfParams = {
  scale: 1,
  rim: RIM_CONFIG.ally,
  furColor: 0x2c2f3a,
  maneColor: 0x15161c,
  eyeColor: 0x7fd4ff,
  eyeIntensity: 5,
  fangColor: 0xd8d0b8,
};

export function buildShadowWolf(params: Partial<WolfParams> = {}): Group {
  const c = { ...WOLF_DEFAULTS, ...params };
  const root = new Group();
  const fur = leatherMaterial({ color: c.furColor, rim: c.rim });
  const mane = leatherMaterial({ color: c.maneColor, rim: c.rim });
  const fang = boneSurfaceMaterial({ color: c.fangColor, rim: c.rim });
  const eye = glowMaterial(c.eyeColor, c.eyeIntensity);

  // --- 躯干：胸厚腰细、肩高臀低 ---
  const body = joint('body', root, 0, 0.6, 0);
  ball(body, fur, 0.2, 0, 0.03, 0.17, [0.85, 1.12, 1.2]); // 胸
  const belly = mesh(new CapsuleGeometry(0.125, 0.22, 4, 10), fur, body);
  belly.rotation.x = Math.PI / 2 - 0.08;
  belly.position.set(0, 0, -0.08);
  ball(body, fur, 0.15, 0, -0.01, -0.3, [0.92, 1, 1.15]); // 臀
  ball(body, mane, 0.17, 0, 0.11, 0.14, [0.8, 0.8, 1.3]); // 肩背上的深色鬃毛

  // --- 脖子与头：头向前探、略低于肩 ---
  const neck = joint('neck', body, 0, 0.08, 0.3);
  const neckMesh = mesh(new CapsuleGeometry(0.125, 0.14, 4, 10), fur, neck);
  neckMesh.rotation.x = 1.25;
  neckMesh.position.set(0, 0.03, 0.09);
  const head = joint('head', neck, 0, 0.07, 0.25);
  head.rotation.x = 0.18;
  ball(head, fur, 0.125, 0, 0, 0, [1, 0.88, 1.05]);
  const snout = mesh(new CylinderGeometry(0.038, 0.072, 0.22, 8), fur, head); // 锥形吻部
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.025, 0.19);
  snout.scale.z = 0.8;
  ball(head, mane, 0.026, 0, -0.012, 0.3); // 鼻头
  const jaw = joint('jaw', head, 0, -0.065, 0.05);
  jaw.rotation.x = 0.2;
  box(jaw, mane, 0.07, 0.025, 0.2, 0, -0.01, 0.1);
  for (const sx of [1, -1]) {
    const ear = mesh(new ConeGeometry(0.045, 0.16, 5), fur, head);
    ear.position.set(sx * 0.078, 0.14, -0.05);
    ear.rotation.set(-0.3, 0, sx * -0.3);
    const eyeMesh = ball(head, eye, 0.02, sx * 0.066, 0.035, 0.092, [1.3, 0.6, 1]);
    eyeMesh.rotation.z = sx * 0.35; // 斜吊的眼
    for (const z of [0.25, 0.19]) {
      const tooth = mesh(new ConeGeometry(0.01, 0.045, 4), fang, head);
      tooth.position.set(sx * 0.028, -0.075, z);
      tooth.rotation.x = Math.PI;
    }
  }

  // --- 背上的鬃刺：从后脑一路到腰，越往后越短 ---
  const spikes: [number, number, number][] = [
    [0.25, 0.4, 0.14],
    [0.26, 0.29, 0.2],
    [0.25, 0.17, 0.22],
    [0.21, 0.04, 0.18],
    [0.16, -0.09, 0.14],
    [0.13, -0.21, 0.11],
    [0.12, -0.32, 0.08],
  ];
  for (const [y, z, len] of spikes) {
    const s = mesh(new ConeGeometry(0.04, len, 5), mane, body);
    s.rotation.x = -0.6; // 向后倒伏
    s.position.set(0, y + len * 0.3, z - len * 0.2);
    s.scale.x = 0.5;
  }

  // --- 四条腿：前腿直，后腿折；大腿粗、小腿细 ---
  const leg = (name: string, x: number, z: number, upperRot: number, lowerRot: number, lowerLen: number, thigh: number): void => {
    const hip = joint(name, body, x, -0.05, z);
    hip.rotation.x = upperRot;
    seg(hip, fur, 0.3, thigh, 0.048, 8);
    const knee = joint(`${name}Knee`, hip, 0, -0.3, 0);
    knee.rotation.x = lowerRot;
    seg(knee, fur, lowerLen, 0.045, 0.03, 8);
    const paw = joint(`${name}Paw`, knee, 0, -lowerLen, 0);
    paw.rotation.x = -(upperRot + lowerRot); // 爪子放平
    box(paw, mane, 0.09, 0.05, 0.14, 0, 0.015, 0.035);
  };
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    leg(`foreLeg${tag}`, sx * 0.12, 0.2, -0.2, 0.3, 0.26, 0.075);
    leg(`hindLeg${tag}`, sx * 0.115, -0.3, -0.55, 0.95, 0.32, 0.09);
  }

  // --- 尾巴：向后下方垂，尾尖深色 ---
  const tail = joint('tail', body, 0, 0.06, -0.42);
  taperedTube(
    tail,
    mane,
    [
      [0, 0, 0],
      [0, 0.0, -0.16],
      [0, -0.12, -0.32],
      [0, -0.3, -0.4],
    ],
    0.07,
    0.015,
  );

  return finishCreature(root, 'shadowWolf', 1.05, c.scale);
}

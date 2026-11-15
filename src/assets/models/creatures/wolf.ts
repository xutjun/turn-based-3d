// 宝宝 · 暗影狼：低伏的四足兽，背上一排竖起的鬃刺，眼睛发光。剪影特征：长、低、尖耳、背刺。
// 通过参数换毛色，灰狼和赤狼共用这一个 builder。
// 步骤 10 细化：毛皮贴图 + 颈、胸、颊、臀、尾上的毛簇，骨白的爪和牙，带钉的皮项圈（友方宝宝的标记），
// 额前一点发光的印记。

import { CapsuleGeometry, ConeGeometry, CylinderGeometry, Group } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, furMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { ball, box, cones, furCollar, gem, jitter, mesh, ring, seg, taperedTube, type ConeSpec } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface WolfParams extends CreatureBaseParams {
  furColor: number; // 皮毛
  maneColor: number; // 鬃刺、尾尖
  eyeColor: number;
  eyeIntensity: number;
  fangColor: number;
  collarColor: number; // 皮项圈
  studColor: number; // 项圈上的钉
}

export const WOLF_DEFAULTS: WolfParams = {
  scale: 1,
  rim: RIM_CONFIG.pet,
  furColor: 0x4a5064,
  maneColor: 0x1c1e28,
  eyeColor: 0x7fd4ff,
  eyeIntensity: 5,
  fangColor: 0xe0d8c0,
  collarColor: 0x7a4a2a,
  studColor: 0xc9a44e,
};

export function buildShadowWolf(params: Partial<WolfParams> = {}): Group {
  const c = { ...WOLF_DEFAULTS, ...params };
  const root = new Group();
  const fur = furMaterial({ color: c.furColor, rim: c.rim });
  const mane = furMaterial({ color: c.maneColor, rim: c.rim });
  const collar = leatherMaterial({ color: c.collarColor, rim: c.rim });
  const stud = plateMaterial({ color: c.studColor, rim: c.rim, metalness: 0.9 });
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
  // 胸前和臀后的长毛、腹下的垂毛
  const rnd = jitter(31);
  const tufts: ConeSpec[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    tufts.push({
      at: [Math.sin(a) * 0.13, 0.03 + Math.cos(a) * 0.17, 0.28],
      dir: [Math.sin(a) * 0.35, Math.cos(a) * 0.3 - 0.4, -1],
      radius: 0.055,
      length: 0.09 + rnd() * 0.03,
      flat: 0.45,
    });
  }
  for (let i = 0; i < 7; i++) {
    tufts.push({
      at: [(rnd() - 0.5) * 0.14, -0.12, 0.2 - i * 0.07],
      dir: [(rnd() - 0.5) * 0.3, -1, -0.5],
      radius: 0.035,
      length: 0.08 + rnd() * 0.04,
      flat: 0.5,
    });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    tufts.push({
      at: [Math.sin(a) * 0.11, -0.01 + Math.cos(a) * 0.12, -0.4],
      dir: [Math.sin(a) * 0.3, Math.cos(a) * 0.25 - 0.3, -1],
      radius: 0.045,
      length: 0.07 + rnd() * 0.03,
      flat: 0.5,
    });
  }
  cones(body, fur, tufts, 4);

  // --- 脖子与头：头向前探、略低于肩 ---
  const neck = joint('neck', body, 0, 0.08, 0.3);
  const neckMesh = mesh(new CapsuleGeometry(0.125, 0.14, 4, 10), fur, neck);
  neckMesh.rotation.x = 1.25;
  neckMesh.position.set(0, 0.03, 0.09);
  // 颈毛一圈 + 带钉皮项圈
  const ruff = furCollar(neck, mane, { radius: 0.125, count: 10, length: 0.1, thickness: 0.05, droop: 1.6, rows: 2, seed: 5 });
  ruff.rotation.x = 1.15;
  ruff.position.set(0, 0.0, 0.05);
  const band = ring(neck, collar, 0.128, 0.022, 0, 5, 16);
  band.rotation.x = Math.PI / 2 + 1.25;
  band.position.set(0, 0.055, 0.17);
  const studs: ConeSpec[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    studs.push({ at: [Math.sin(a) * 0.14, Math.cos(a) * 0.14, 0], dir: [Math.sin(a), Math.cos(a), 0], radius: 0.012, length: 0.035 });
  }
  const studMesh = cones(neck, stud, studs, 5);
  studMesh.rotation.x = band.rotation.x; // 与项圈同一个平面
  studMesh.position.copy(band.position);
  const head = joint('head', neck, 0, 0.07, 0.25);
  head.rotation.x = 0.18;
  ball(head, fur, 0.125, 0, 0, 0, [1, 0.88, 1.05]);
  const snout = mesh(new CylinderGeometry(0.038, 0.072, 0.22, 8), fur, head); // 锥形吻部
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.025, 0.19);
  snout.scale.z = 0.8;
  ball(head, mane, 0.026, 0, -0.012, 0.3); // 鼻头
  box(head, mane, 0.05, 0.02, 0.2, 0, 0.03, 0.17).rotation.x = 0.2; // 鼻梁上的深色毛
  gem(head, eye, 0.014, 0, 0.1, 0.07, 1.6); // 额前的印记
  // 两颊的毛簇
  cones(
    head,
    fur,
    [1, -1].flatMap((sx) =>
      [0, 1, 2].map((i): ConeSpec => ({
        at: [sx * 0.1, -0.02 - i * 0.03, 0.02 - i * 0.02],
        dir: [sx * 1, -0.5 - i * 0.2, -0.5],
        radius: 0.03,
        length: 0.1 - i * 0.015,
        flat: 0.5,
      })),
    ),
    4,
  );
  const jaw = joint('jaw', head, 0, -0.065, 0.05);
  jaw.rotation.x = 0.2;
  box(jaw, mane, 0.07, 0.025, 0.2, 0, -0.01, 0.1);
  for (const sx of [1, -1]) {
    const ear = mesh(new ConeGeometry(0.045, 0.16, 5), fur, head);
    ear.position.set(sx * 0.078, 0.14, -0.05);
    ear.rotation.set(-0.3, 0, sx * -0.3);
    const innerEar = mesh(new ConeGeometry(0.026, 0.11, 4), mane, head);
    innerEar.position.set(sx * 0.078, 0.135, -0.036);
    innerEar.rotation.set(-0.3, 0, sx * -0.3);
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
    seg(hip, fur, 0.3, thigh, 0.064, 8);
    const knee = joint(`${name}Knee`, hip, 0, -0.3, 0);
    knee.rotation.x = lowerRot;
    seg(knee, fur, lowerLen, 0.06, 0.042, 8);
    ball(knee, fur, 0.066, 0, 0, 0); // 关节处的毛团
    // 腿上一圈圈的毛簇：把圆柱形的腿包成毛茸茸的轮廓，不再像光滑的木棍
    const legFur = (len: number, r0: number, r1: number, rows: number): ConeSpec[] => {
      const list: ConeSpec[] = [];
      for (let i = 0; i < rows; i++) {
        const t = (i + 0.3) / rows;
        const r = r0 + (r1 - r0) * t;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + i * 0.7;
          list.push({
            at: [Math.sin(a) * r * 0.7, -t * len, Math.cos(a) * r * 0.7],
            dir: [Math.sin(a) * 0.45, -1, Math.cos(a) * 0.45 - 0.15],
            radius: r * 0.62,
            length: len / rows + 0.05,
            flat: 0.55,
          });
        }
      }
      return list;
    };
    cones(hip, fur, legFur(0.3, thigh, 0.064, 3), 4);
    cones(knee, fur, legFur(lowerLen, 0.06, 0.045, 3), 4);
    const paw = joint(`${name}Paw`, knee, 0, -lowerLen, 0);
    paw.rotation.x = -(upperRot + lowerRot); // 爪子放平
    box(paw, fur, 0.1, 0.055, 0.15, 0, 0.015, 0.035);
    // 三根骨白的爪
    cones(
      paw,
      fang,
      [-0.03, 0, 0.03].map((cx): ConeSpec => ({ at: [cx, 0.012, 0.1], dir: [cx * 2, -0.25, 1], radius: 0.012, length: 0.05 })),
      4,
    );
    // 肘后的一撮毛
    cones(knee, fur, [{ at: [0, 0.02, -0.03], dir: [0, -0.6, -1], radius: 0.03, length: 0.09, flat: 0.5 }], 4);
  };
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    leg(`foreLeg${tag}`, sx * 0.12, 0.2, -0.2, 0.3, 0.26, 0.095);
    leg(`hindLeg${tag}`, sx * 0.115, -0.3, -0.55, 0.95, 0.32, 0.11);
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
  // 蓬松的尾毛
  const tailFur: ConeSpec[] = [];
  const tailPts: [number, number][] = [
    [0, -0.1],
    [-0.04, -0.2],
    [-0.12, -0.3],
    [-0.22, -0.37],
  ];
  tailPts.forEach(([y, z], i) => {
    for (const a of [0, 2.1, 4.2]) {
      tailFur.push({
        at: [Math.sin(a + i) * 0.04, y + Math.cos(a + i) * 0.04, z],
        dir: [Math.sin(a + i) * 0.6, Math.cos(a + i) * 0.6 - 0.4, -1],
        radius: 0.035 - i * 0.004,
        length: 0.12,
        flat: 0.6,
      });
    }
  });
  cones(tail, mane, tailFur, 4);

  return finishCreature(root, 'shadowWolf', 1.05, c.scale);
}

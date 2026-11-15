// 宝宝 · 暗影狼：四足兽，眼睛发光。通过参数换毛色，灰狼和赤狼共用这一个 builder。
//
// 步骤 10 返工：按“战场相机的实际距离”设计——在战场里一只狼只有几十个像素高，
// 所以轮廓优先：胸、腰、臀、头、四肢、尾巴都是清楚的大体块，头略放大、耳朵直立、尾巴向后上方甩出一道弧；
// 毛发只留少量大块毛簇（颈部一圈、背脊一排、尾尖），毛皮质感靠贴图和“背深腹浅”的两色明暗来表现，
// 不再用大量细碎的尖刺（小尺寸下会变成噪点和闪烁）。
// 两种体型：lean = 写实偏瘦削的暗黑狼；burly = 更壮硕、鬃毛更厚的狼。

import { CapsuleGeometry, ConeGeometry, CylinderGeometry, Group } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, furMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { ball, cones, gem, mesh, ring, seg, taperedTube, type ConeSpec } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export type WolfBuild = 'lean' | 'burly';

export interface WolfParams extends CreatureBaseParams {
  build: WolfBuild; // 体型
  furColor: number; // 主毛色（体侧、四肢、头）
  bellyColor: number; // 浅色部分（胸腹、吻部、爪、尾下）
  maneColor: number; // 深色部分（背脊、鬃毛、耳尖、尾尖）
  eyeColor: number;
  eyeIntensity: number;
  fangColor: number;
  collarColor: number; // 皮项圈
  studColor: number; // 项圈上的钉
}

export const WOLF_DEFAULTS: WolfParams = {
  scale: 1,
  rim: RIM_CONFIG.pet,
  build: 'lean',
  furColor: 0x959ba8,
  bellyColor: 0xc4c8d0,
  maneColor: 0x3c404c,
  eyeColor: 0x7fd4ff,
  eyeIntensity: 5,
  fangColor: 0xe8e0c8,
  collarColor: 0x7a4a2a,
  studColor: 0xc9a44e,
};

/** 两种体型的尺寸 */
const BUILDS: Record<WolfBuild, {
  bodyY: number; // 躯干离地高度
  chest: number; // 胸的半径
  waist: number;
  rump: number;
  neck: number;
  head: number; // 头部放大倍率
  snout: number; // 吻部长度
  leg: number; // 四肢粗细倍率
  tail: number; // 尾巴粗细
  hump: number; // 肩峰隆起
  ruff: number; // 颈毛大小
  height: number;
}> = {
  lean: { bodyY: 0.62, chest: 0.19, waist: 0.105, rump: 0.14, neck: 0.105, head: 1.18, snout: 0.25, leg: 1, tail: 0.06, hump: 0.02, ruff: 0.85, height: 1.08 },
  burly: { bodyY: 0.6, chest: 0.235, waist: 0.15, rump: 0.175, neck: 0.145, head: 1.34, snout: 0.21, leg: 1.4, tail: 0.085, hump: 0.07, ruff: 1.25, height: 1.14 },
};

export function buildShadowWolf(params: Partial<WolfParams> = {}): Group {
  const c = { ...WOLF_DEFAULTS, ...params };
  const d = BUILDS[c.build];
  const root = new Group();
  const fur = furMaterial({ color: c.furColor, rim: c.rim });
  const pale = furMaterial({ color: c.bellyColor, rim: c.rim });
  const mane = furMaterial({ color: c.maneColor, rim: c.rim });
  const fang = boneSurfaceMaterial({ color: c.fangColor, rim: c.rim });
  const collar = leatherMaterial({ color: c.collarColor, rim: c.rim });
  const stud = plateMaterial({ color: c.studColor, rim: c.rim, metalness: 0.9 });
  const eye = glowMaterial(c.eyeColor, c.eyeIntensity);

  // --- 躯干：胸厚、腰细、臀圆，背深腹浅 ---
  const body = joint('body', root, 0, d.bodyY, 0);
  ball(body, fur, d.chest, 0, 0.03, 0.17, [0.86, 1.1, 1.2]); // 胸
  ball(body, pale, d.chest * 0.8, 0, -0.04, 0.2, [0.8, 0.9, 1.1]); // 浅色的前胸
  const belly = mesh(new CapsuleGeometry(d.waist, 0.24, 4, 10), fur, body);
  belly.rotation.x = Math.PI / 2 - 0.1;
  belly.position.set(0, 0.01, -0.08);
  ball(body, fur, d.rump, 0, 0.0, -0.3, [0.95, 1, 1.15]); // 臀
  // 背脊：一条从肩到臀的深色“鞍”，远看是清楚的一道深色背线
  ball(body, mane, d.chest * 0.82, 0, 0.1 + d.hump, 0.13, [0.72, 0.75, 1.35]);
  ball(body, mane, d.rump * 0.8, 0, 0.07, -0.22, [0.7, 0.7, 1.5]);
  // 背脊上的一排大毛簇：只有 4 片，宽而钝
  cones(
    body,
    mane,
    [0.22, 0.08, -0.08, -0.24].map((z, i): ConeSpec => ({
      at: [0, 0.13 + d.hump * (1 - i / 3) + d.chest * 0.25 * (1 - i / 3), z],
      dir: [0, 1, -0.9],
      radius: 0.085 * d.ruff,
      length: (0.11 - i * 0.015) * d.ruff,
      flat: 0.5,
    })),
    6,
  );

  // --- 脖子与头：头向前探、略放大 ---
  const neck = joint('neck', body, 0, 0.09 + d.hump * 0.5, 0.3);
  const neckMesh = mesh(new CapsuleGeometry(d.neck, 0.14, 4, 10), fur, neck);
  neckMesh.rotation.x = 1.15;
  neckMesh.position.set(0, 0.035, 0.08);
  // 颈毛：一圈 6 片大毛簇，向后披在肩上
  const ruff: ConeSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const r = d.neck * 1.05;
    ruff.push({
      at: [Math.sin(a) * r, 0.02 + Math.cos(a) * r, 0.05],
      dir: [Math.sin(a) * 0.55, Math.cos(a) * 0.55, -1],
      radius: 0.09 * d.ruff,
      length: 0.13 * d.ruff,
      flat: 0.45,
    });
  }
  cones(neck, d.ruff > 1 ? mane : fur, ruff, 6);
  // 带钉皮项圈（友方宝宝的标记）
  const band = ring(neck, collar, d.neck * 1.08, 0.024, 0, 5, 16);
  band.rotation.x = Math.PI / 2 + 1.15;
  band.position.set(0, 0.07, 0.17);
  const studs: ConeSpec[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = d.neck * 1.08 + 0.015;
    studs.push({ at: [Math.sin(a) * r, Math.cos(a) * r, 0], dir: [Math.sin(a), Math.cos(a), 0], radius: 0.014, length: 0.04 });
  }
  const studMesh = cones(neck, stud, studs, 5);
  studMesh.rotation.x = band.rotation.x; // 与项圈同一个平面
  studMesh.position.copy(band.position);

  const head = joint('head', neck, 0, 0.09, 0.25);
  head.rotation.x = 0.16;
  head.scale.setScalar(d.head);
  ball(head, fur, 0.125, 0, 0, 0, [1, 0.9, 1.05]);
  const snout = mesh(new CylinderGeometry(0.04, 0.075, d.snout, 8), pale, head); // 浅色的锥形吻部
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.025, 0.08 + d.snout / 2);
  snout.scale.z = 0.8;
  ball(head, mane, 0.026, 0, -0.012, 0.085 + d.snout); // 鼻头
  ball(head, mane, 0.03, 0, 0.022, 0.1 + d.snout * 0.35, [0.8, 0.45, d.snout * 5]).rotation.x = 0.2; // 鼻梁上的深色毛
  gem(head, eye, 0.014, 0, 0.1, 0.07, 1.6); // 额前的印记
  const jaw = joint('jaw', head, 0, -0.065, 0.05);
  jaw.rotation.x = 0.2;
  ball(jaw, pale, 0.04, 0, -0.005, 0.04 + d.snout * 0.4, [0.85, 0.4, d.snout * 5.2]); // 下颌
  // 两颊各一片大毛簇
  cones(
    head,
    fur,
    [1, -1].map((sx): ConeSpec => ({ at: [sx * 0.09, -0.03, 0], dir: [sx * 1, -0.6, -0.6], radius: 0.06, length: 0.09, flat: 0.45 })),
    6,
  );
  for (const sx of [1, -1]) {
    // 直立的大耳朵，耳内深色
    const ear = mesh(new ConeGeometry(0.052, 0.19, 5), fur, head);
    ear.position.set(sx * 0.08, 0.16, -0.04);
    ear.rotation.set(-0.12, 0, sx * -0.18);
    const innerEar = mesh(new ConeGeometry(0.03, 0.13, 4), mane, head);
    innerEar.position.set(sx * 0.08, 0.15, -0.024);
    innerEar.rotation.set(-0.12, 0, sx * -0.18);
    const eyeMesh = ball(head, eye, 0.022, sx * 0.066, 0.035, 0.092, [1.3, 0.6, 1]);
    eyeMesh.rotation.z = sx * 0.35; // 斜吊的眼
    for (const z of [0.07 + d.snout * 0.8, 0.07 + d.snout * 0.5]) {
      const tooth = mesh(new ConeGeometry(0.011, 0.05, 4), fang, head);
      tooth.position.set(sx * 0.03, -0.075, z);
      tooth.rotation.x = Math.PI;
    }
  }

  // --- 四条腿：前腿直，后腿折；大腿粗、小腿细，肘后一片毛，浅色的爪子 ---
  const leg = (name: string, x: number, z: number, upperRot: number, lowerRot: number, lowerLen: number, thigh: number): void => {
    const hip = joint(name, body, x, -0.04, z);
    hip.rotation.x = upperRot;
    ball(hip, fur, thigh * d.leg * 1.15, 0, -0.03, 0, [0.9, 1.3, 1.1]); // 肩/髋的肌肉块
    seg(hip, fur, 0.3, thigh * d.leg, 0.06 * d.leg, 8);
    const knee = joint(`${name}Knee`, hip, 0, -0.3, 0);
    knee.rotation.x = lowerRot;
    ball(knee, fur, 0.06 * d.leg);
    seg(knee, fur, lowerLen, 0.056 * d.leg, 0.042 * d.leg, 8);
    cones(knee, fur, [{ at: [0, -0.02, -0.03 * d.leg], dir: [0, -0.9, -1], radius: 0.05 * d.leg, length: 0.08, flat: 0.5 }], 6);
    const paw = joint(`${name}Paw`, knee, 0, -lowerLen, 0);
    paw.rotation.x = -(upperRot + lowerRot); // 爪子放平
    ball(paw, pale, 0.058 * d.leg, 0, 0.022, 0.035, [1, 0.62, 1.4]); // 圆厚的爪垫
    // 三根骨白的爪
    cones(
      paw,
      fang,
      [-0.03, 0, 0.03].map((cx): ConeSpec => ({ at: [cx * d.leg, 0.012, 0.1], dir: [cx * 2, -0.25, 1], radius: 0.013, length: 0.055 })),
      4,
    );
  };
  const legScale = (d.bodyY - 0.05) / 0.55; // 腿长跟着躯干高度走，保证爪子落地
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    leg(`foreLeg${tag}`, sx * (d.chest * 0.62), 0.2, -0.2, 0.3, 0.26 * legScale, 0.085);
    leg(`hindLeg${tag}`, sx * (d.rump * 0.72), -0.3, -0.55, 0.95, 0.32 * legScale, 0.1);
  }

  // --- 尾巴：从臀后向后上方甩出一道弧，尾尖深色蓬起 ---
  const tail = joint('tail', body, 0, 0.06, -0.42);
  taperedTube(
    tail,
    fur,
    [
      [0, 0, 0],
      [0, 0.06, -0.16],
      [0, 0.2, -0.3],
      [0, 0.36, -0.36],
    ],
    d.tail,
    d.tail * 0.75,
    7,
    10,
  );
  ball(tail, mane, d.tail * 1.25, 0, 0.4, -0.365, [0.9, 1.5, 0.9]).rotation.x = -0.25; // 尾尖
  cones(tail, mane, [{ at: [0, 0.44, -0.37], dir: [0, 1, -0.1], radius: d.tail * 1.1, length: 0.1, flat: 0.7 }], 6);
  // 尾下的一片长毛
  cones(tail, pale, [{ at: [0, 0.06, -0.2], dir: [0, -0.6, -1], radius: d.tail * 0.9, length: 0.14, flat: 0.45 }], 4);

  return finishCreature(root, 'shadowWolf', d.height, c.scale);
}

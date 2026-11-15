// 宝宝 · 暗影狼：四足兽，眼睛发光。通过参数换毛色，灰狼和赤狼共用这一个 builder。
//
// 步骤 10 返工：按“战场相机的实际距离”设计——在战场里一只狼只有几十个像素高，
// 所以轮廓优先：胸、腰、臀、头、四肢、尾巴都是清楚的大体块，头略放大、耳朵直立、尾巴向后上方甩出一道弧；
// 毛发只留少量大块毛簇（颈部一圈、背脊一排、尾尖），毛皮质感靠贴图和“背深腹浅”的两色明暗来表现，
// 不再用大量细碎的尖刺（小尺寸下会变成噪点和闪烁）。
// 两种体型：burly = 壮硕、鬃毛厚的狼（定稿，默认）；lean = 写实偏瘦削的狼（备选，只留参数，不启用）。
//
// 定稿时的几条做法：
//   - 体块用低面数、带切面的多面体（平直着色），不用光滑椭球，避免“气球感”；
//   - 前腿前伸、后腿后蹬，站姿拉开；远侧（右侧）两条腿用更暗的毛色，近侧更亮，剪影里四条腿数得清；
//   - 腹部收高并压一道暗色，腿根和各关节有暗色的环（模拟环境光遮蔽），腿和躯干分得开；
//   - 毛簇“少而大而钝”：颈部一圈深色厚毛、背脊一排。

import { ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, IcosahedronGeometry, type Material, type Mesh } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, furMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { ball, cones, gem, mesh, ring, taperedTube, type ConeSpec } from '../characters/parts';
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
  build: 'burly',
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
  lean: { bodyY: 0.64, chest: 0.19, waist: 0.1, rump: 0.14, neck: 0.105, head: 1.18, snout: 0.25, leg: 1, tail: 0.06, hump: 0.02, ruff: 0.85, height: 1.1 },
  burly: { bodyY: 0.64, chest: 0.235, waist: 0.12, rump: 0.17, neck: 0.145, head: 1.34, snout: 0.21, leg: 1.3, tail: 0.085, hump: 0.07, ruff: 1.25, height: 1.18 },
};

/** 把颜色按比例调暗 / 调亮 */
function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (g << 8) | b;
}

export function buildShadowWolf(params: Partial<WolfParams> = {}): Group {
  const c = { ...WOLF_DEFAULTS, ...params };
  const d = BUILDS[c.build];
  const root = new Group();
  /** 毛皮材质：平直着色，配合低面数的体块显出切面 */
  const furOf = (color: number): Material => {
    const m = furMaterial({ color, rim: c.rim });
    m.flatShading = true;
    return m;
  };
  const fur = furOf(c.furColor);
  const furNear = furOf(shade(c.furColor, 1.12)); // 近侧（左）的腿：略亮
  const furFar = furOf(shade(c.furColor, 0.52)); // 远侧（右）的腿：明显更暗
  const pale = furOf(c.bellyColor);
  const paleFar = furOf(shade(c.bellyColor, 0.55));
  const mane = furOf(c.maneColor);
  const dark = furOf(shade(c.maneColor, 0.45)); // 腹下暗缝、关节的暗环
  const fang = boneSurfaceMaterial({ color: c.fangColor, rim: c.rim });
  const collar = leatherMaterial({ color: c.collarColor, rim: c.rim });
  const stud = plateMaterial({ color: c.studColor, rim: c.rim, metalness: 0.9 });
  const eye = glowMaterial(c.eyeColor, c.eyeIntensity);

  /** 一块带切面的体块（二十面体细分一次，80 个面） */
  const chunk = (
    parent: Group,
    mat: Material,
    r: number,
    x: number,
    y: number,
    z: number,
    s: [number, number, number],
    rot: [number, number, number] = [0, 0, 0],
  ): Mesh => {
    const m = mesh(new IcosahedronGeometry(r, 1), mat, parent);
    m.position.set(x, y, z);
    m.scale.set(...s);
    m.rotation.set(...rot);
    return m;
  };
  /** 更硬朗的十二面体块（肩、髋、头骨） */
  const block = (parent: Group, mat: Material, r: number, x: number, y: number, z: number, s: [number, number, number], rotY = 0): Mesh => {
    const m = mesh(new DodecahedronGeometry(r, 0), mat, parent);
    m.position.set(x, y, z);
    m.scale.set(...s);
    m.rotation.y = rotY;
    return m;
  };
  /** 六棱的肢体段：从关节原点沿 −y 延伸 */
  const limb = (parent: Group, mat: Material, len: number, rTop: number, rBottom: number): Mesh => {
    const m = mesh(new CylinderGeometry(rTop, rBottom, len, 6, 1), mat, parent);
    m.position.y = -len / 2;
    return m;
  };

  // --- 躯干：胸深、腹部明显上收、臀圆；背深腹浅，腹下压一道暗色 ---
  const body = joint('body', root, 0, d.bodyY, 0);
  chunk(body, fur, d.chest, 0, 0.02, 0.19, [0.84, 1.08, 1.12]); // 胸
  chunk(body, pale, d.chest * 0.74, 0, -0.06, 0.25, [0.74, 0.86, 0.95]); // 浅色的前胸
  const waist = mesh(new CylinderGeometry(d.rump * 0.78, d.chest * 0.72, 0.42, 7, 1), fur, body); // 腰：前粗后细
  waist.rotation.x = Math.PI / 2 - 0.12;
  waist.position.set(0, 0.07, -0.1);
  waist.scale.x = 0.82;
  chunk(body, fur, d.rump, 0, 0.03, -0.36, [0.9, 0.98, 1.1]); // 臀
  // 腹下的暗缝：一条压在腰腹底部的暗色，把四条腿和躯干隔开
  chunk(body, dark, d.waist * 1.05, 0, -0.07, -0.08, [0.72, 0.6, 2.3]);
  // 背脊：一条从肩到臀的深色“鞍”，远看是清楚的一道深色背线
  chunk(body, mane, d.chest * 0.8, 0, 0.11 + d.hump, 0.14, [0.7, 0.72, 1.3]);
  chunk(body, mane, d.rump * 0.78, 0, 0.1, -0.26, [0.66, 0.66, 1.5]);
  // 背脊上的一排大毛簇：只有 4 片，宽而钝
  cones(
    body,
    mane,
    [0.24, 0.09, -0.08, -0.26].map((z, i): ConeSpec => ({
      at: [0, 0.14 + d.hump * (1 - i / 3) + d.chest * 0.25 * (1 - i / 3), z],
      dir: [0, 1, -0.9],
      radius: 0.085 * d.ruff,
      length: (0.11 - i * 0.015) * d.ruff,
      flat: 0.5,
    })),
    5,
  );

  // --- 脖子与头：头向前探、略放大，楔形的头骨 ---
  const neck = joint('neck', body, 0, 0.1 + d.hump * 0.5, 0.33);
  const neckMesh = mesh(new CylinderGeometry(d.neck * 0.86, d.neck * 1.12, 0.3, 7, 1), fur, neck);
  neckMesh.rotation.x = 1.15;
  neckMesh.position.set(0, 0.035, 0.08);
  // 颈毛：一圈 6 片深色的大毛簇，向后披在肩上
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
  cones(neck, d.ruff > 1 ? mane : fur, ruff, 5);
  // 带钉皮项圈（友方宝宝的标记）
  const band = ring(neck, collar, d.neck * 1.08, 0.024, 0, 5, 12);
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
  block(head, fur, 0.13, 0, 0.0, -0.005, [1, 0.86, 1.02], 0.3); // 头骨
  block(head, mane, 0.075, 0, 0.075, -0.03, [1.3, 0.5, 1.1], 0.6); // 头顶的深色毛
  for (const sx of [1, -1]) block(head, fur, 0.06, sx * 0.075, -0.02, 0.03, [0.8, 0.9, 1.1], sx); // 颧骨
  const snout = mesh(new CylinderGeometry(0.042, 0.076, d.snout, 6), pale, head); // 浅色的六棱吻部
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, -0.025, 0.08 + d.snout / 2);
  snout.scale.z = 0.8;
  block(head, dark, 0.028, 0, -0.012, 0.085 + d.snout, [1, 0.8, 0.9]); // 鼻头
  const bridge = mesh(new CylinderGeometry(0.018, 0.03, d.snout * 0.9, 4), mane, head); // 鼻梁上的深色毛
  bridge.rotation.x = Math.PI / 2 + 0.16;
  bridge.position.set(0, 0.022, 0.1 + d.snout * 0.4);
  gem(head, eye, 0.014, 0, 0.1, 0.07, 1.6); // 额前的印记
  const jaw = joint('jaw', head, 0, -0.065, 0.05);
  jaw.rotation.x = 0.2;
  const jawMesh = mesh(new CylinderGeometry(0.026, 0.05, d.snout * 0.85, 5), pale, jaw); // 下颌
  jawMesh.rotation.x = Math.PI / 2;
  jawMesh.position.set(0, -0.005, 0.03 + d.snout * 0.42);
  jawMesh.scale.z = 0.5;
  // 两颊各一片大毛簇
  cones(
    head,
    fur,
    [1, -1].map((sx): ConeSpec => ({ at: [sx * 0.09, -0.03, 0], dir: [sx * 1, -0.6, -0.6], radius: 0.06, length: 0.09, flat: 0.45 })),
    5,
  );
  for (const sx of [1, -1]) {
    // 直立的大耳朵（四棱），耳内深色
    const ear = mesh(new ConeGeometry(0.056, 0.2, 4), fur, head);
    ear.position.set(sx * 0.085, 0.165, -0.04);
    ear.rotation.set(-0.12, sx * 0.5, sx * -0.18);
    const innerEar = mesh(new ConeGeometry(0.032, 0.13, 3), dark, head);
    innerEar.position.set(sx * 0.085, 0.15, -0.02);
    innerEar.rotation.set(-0.12, sx * 0.5, sx * -0.18);
    const eyeMesh = ball(head, eye, 0.022, sx * 0.07, 0.035, 0.092, [1.3, 0.6, 1]);
    eyeMesh.rotation.z = sx * 0.35; // 斜吊的眼
    block(head, dark, 0.03, sx * 0.07, 0.03, 0.08, [1.3, 0.8, 0.5]); // 眼窝的暗色
    for (const z of [0.07 + d.snout * 0.8, 0.07 + d.snout * 0.5]) {
      const tooth = mesh(new ConeGeometry(0.011, 0.05, 4), fang, head);
      tooth.position.set(sx * 0.03, -0.075, z);
      tooth.rotation.x = Math.PI;
    }
  }

  // --- 四条腿：前腿前伸、后腿后蹬；近侧亮、远侧暗；腿根和关节有暗环 ---
  const leg = (
    name: string,
    x: number,
    z: number,
    upperRot: number,
    lowerRot: number,
    upperLen: number,
    lowerLen: number,
    thigh: number,
    mat: Material,
    pawMat: Material,
  ): void => {
    const hip = joint(name, body, x, 0.0, z);
    hip.rotation.x = upperRot;
    block(hip, mat, thigh * d.leg * 1.5, 0, -0.04, 0, [0.72, 1.25, 1.05], x > 0 ? 0.4 : -0.4); // 肩 / 髋的肌肉块
    limb(hip, mat, upperLen, thigh * d.leg, 0.058 * d.leg);
    const knee = joint(`${name}Knee`, hip, 0, -upperLen, 0);
    knee.rotation.x = lowerRot;
    // 关节的暗环
    const joinRing = mesh(new CylinderGeometry(0.064 * d.leg, 0.064 * d.leg, 0.035, 6), dark, knee);
    joinRing.position.y = 0;
    limb(knee, mat, lowerLen, 0.054 * d.leg, 0.04 * d.leg);
    cones(knee, mat, [{ at: [0, -0.03, -0.03 * d.leg], dir: [0, -0.9, -1], radius: 0.05 * d.leg, length: 0.08, flat: 0.5 }], 5);
    const paw = joint(`${name}Paw`, knee, 0, -lowerLen, 0);
    paw.rotation.x = -(upperRot + lowerRot); // 爪子放平
    const ankle = mesh(new CylinderGeometry(0.046 * d.leg, 0.046 * d.leg, 0.025, 6), dark, paw); // 踝部的暗环
    ankle.position.y = 0.05;
    block(paw, pawMat, 0.06 * d.leg, 0, 0.024, 0.035, [1, 0.6, 1.4]); // 厚实的爪
    cones(
      paw,
      fang,
      [-0.03, 0, 0.03].map((cx): ConeSpec => ({ at: [cx * d.leg, 0.012, 0.1], dir: [cx * 2, -0.25, 1], radius: 0.013, length: 0.055 })),
      4,
    );
  };
  // 腿长按躯干高度配平：髋在 bodyY 处，上下两段加起来（按各自的倾角折算成竖直高度）正好落地
  const drop = d.bodyY - 0.03; // 爪垫厚度
  const foreUpper = -0.34;
  const foreLower = 0.3;
  const hindUpper = 0.42;
  const hindLower = -0.62;
  const foreK = drop / (0.3 * Math.cos(foreUpper) + 0.26 * Math.cos(foreUpper + foreLower));
  const hindK = drop / (0.3 * Math.cos(hindUpper) + 0.3 * Math.cos(hindUpper + hindLower));
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    const mat = sx > 0 ? furNear : furFar;
    const pawMat = sx > 0 ? pale : paleFar;
    // 前腿：肩在胸前，整条腿略向前伸
    leg(`foreLeg${tag}`, sx * (d.chest * 0.66), 0.27, foreUpper, foreLower, 0.3 * foreK, 0.26 * foreK, 0.078, mat, pawMat);
    // 后腿：髋在臀后，大腿向后、小腿折回，整条腿落在更靠后的位置
    leg(`hindLeg${tag}`, sx * (d.rump * 0.76), -0.38, hindUpper, hindLower, 0.3 * hindK, 0.3 * hindK, 0.092, mat, pawMat);
  }

  // --- 尾巴：从臀后向后上方甩出一道弧，尾尖深色蓬起 ---
  const tail = joint('tail', body, 0, 0.09, -0.5);
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
    6,
    8,
  );
  chunk(tail, mane, d.tail * 1.25, 0, 0.4, -0.365, [0.9, 1.5, 0.9], [-0.25, 0, 0]); // 尾尖
  cones(tail, mane, [{ at: [0, 0.44, -0.37], dir: [0, 1, -0.1], radius: d.tail * 1.1, length: 0.1, flat: 0.7 }], 5);
  // 尾下的一片长毛
  cones(tail, pale, [{ at: [0, 0.06, -0.2], dir: [0, -0.6, -1], radius: d.tail * 0.9, length: 0.14, flat: 0.45 }], 4);

  return finishCreature(root, 'shadowWolf', d.height, c.scale);
}

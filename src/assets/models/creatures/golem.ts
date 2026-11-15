// 宝宝 · 魔偶：石块拼成的矮壮人偶，胸口嵌着发光的核心，双臂粗长垂到膝下。
// 剪影特征：宽、方、头小、拳头大。
//
// 步骤 10 返工：按“战场相机的实际距离”设计。
//   - 岩石主体统一成深灰蓝一个色系，靠明暗拉层次：朝上的面和棱边亮、侧面和底面暗（材质的 topShade）；
//   - 头、躯干、双臂、双腿用明度分开：头和拳头最亮，双臂次之，躯干居中，双腿和各关节最暗；
//   - 铜箍只留肩、腰、腕、踝几处，而且很细；苔藓只有两小块点缀；
//   - 发光只集中在眼缝和胸口核心，外加两道很短的暗裂纹，不再用大面积亮线盖住岩石。

import { DodecahedronGeometry, Group, type Material, type Mesh } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { glowMaterial, plateMaterial, stoneSurfaceMaterial } from '../../materials';
import { ball, box, mesh, ring } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface GolemParams extends CreatureBaseParams {
  stoneColor: number; // 躯干的石色（其余部位按明度比例由它派生）
  bandColor: number; // 铜箍
  mossColor: number; // 青苔
  glowColor: number; // 眼缝与核心
  glowIntensity: number;
  topShade: number; // 顶面提亮 / 底面压暗的幅度
}

export const GOLEM_DEFAULTS: GolemParams = {
  scale: 1,
  rim: RIM_CONFIG.pet,
  stoneColor: 0x8490aa,
  bandColor: 0xb07a3a,
  mossColor: 0x5a7a3a,
  glowColor: 0xd8e86a,
  glowIntensity: 2.2,
  topShade: 0.45,
};

/** 把颜色按比例调暗 / 调亮 */
function shade(color: number, k: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * k));
  const b = Math.min(255, Math.round((color & 255) * k));
  return (r << 16) | (g << 8) | b;
}

export function buildGolem(params: Partial<GolemParams> = {}): Group {
  const c = { ...GOLEM_DEFAULTS, ...params };
  const root = new Group();
  const rim = { ...c.rim, topShade: c.topShade };
  const stoneOf = (k: number): Material => stoneSurfaceMaterial({ color: shade(c.stoneColor, k), rim });
  const torsoStone = stoneOf(1); // 躯干：居中
  const headStone = stoneOf(1.45); // 头、拳头：最亮
  const armStone = stoneOf(1.28); // 双臂
  const legStone = stoneOf(0.66); // 双腿
  const jointStone = stoneOf(0.42); // 关节、骨盆：最暗，把各体块隔开
  const band = plateMaterial({ color: c.bandColor, rim: c.rim, metalness: 0.85 });
  const moss = stoneSurfaceMaterial({ color: c.mossColor, rim });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  const dimGlow = glowMaterial(c.glowColor, c.glowIntensity * 0.35);

  /** 一块有棱角的石头 */
  const rock = (parent: Group, mat: Material, r: number, x: number, y: number, z: number, s: [number, number, number], rotY = 0): Mesh => {
    const m = mesh(new DodecahedronGeometry(r, 0), mat, parent);
    m.position.set(x, y, z);
    m.scale.set(...s);
    m.rotation.y = rotY;
    return m;
  };

  // --- 骨盆与双腿：腿分开站，脚是一整块宽石；踝部一道细铜箍 ---
  const hips = joint('hips', root, 0, 0.4, 0);
  box(hips, jointStone, 0.38, 0.12, 0.22, 0, 0, 0);
  for (const sx of [1, -1]) {
    const leg = joint(`leg${sx > 0 ? 'L' : 'R'}`, hips, sx * 0.2, -0.04, 0);
    leg.rotation.z = sx * 0.12; // 两腿叉开站
    rock(leg, legStone, 0.115, 0, -0.13, 0, [1, 1.3, 1.05], sx * 0.4);
    rock(leg, legStone, 0.13, 0, -0.3, 0.035, [1, 0.5, 1.3], sx * 0.9); // 脚
    ring(leg, band, 0.1, 0.01, -0.235, 4, 10);
  }

  // --- 躯干：一大块岩石，上宽下窄；腰间一道细铜箍，胸口嵌核心 ---
  const torso = joint('torso', hips, 0, 0.08, 0);
  rock(torso, jointStone, 0.2, 0, 0.05, 0, [1, 0.6, 0.85], 0.2); // 腰（暗）
  rock(torso, torsoStone, 0.3, 0, 0.3, 0, [1.2, 0.95, 0.88], 0.3); // 胸
  ring(torso, band, 0.205, 0.012, 0.09, 4, 14).scale.set(1, 0.86, 1);
  // 胸口核心：一圈细铜环 + 发光的核心；两道很短的暗裂纹从核心向外
  const socket = ring(torso, band, 0.085, 0.014, 0, 5, 14);
  socket.position.set(0, 0.32, 0.225);
  socket.rotation.set(0, 0, 0); // 立在胸前
  ball(torso, glow, 0.062, 0, 0.32, 0.215, [1, 1, 0.55]);
  for (const [x, y, rz, len] of [
    [0.13, 0.42, 0.75, 0.09],
    [-0.12, 0.22, -0.6, 0.08],
  ] as const) {
    box(torso, dimGlow, 0.01, len, 0.01, x, y, 0.245).rotation.z = rz;
  }
  // 两小块青苔点缀（左肩后、右胯）
  rock(torso, moss, 0.06, -0.2, 0.5, -0.1, [1.3, 0.35, 1.1], 0.5);
  rock(hips, moss, 0.045, 0.16, 0.06, 0.08, [1.1, 0.4, 1], 1.1);

  // --- 头：比以前大，方正的浅色石块，一道清晰的发光眼缝，头顶压一块暗色的“眉石” ---
  const neck = rock(torso, jointStone, 0.09, 0, 0.6, 0.02, [1.0, 0.7, 1], 0); // 脖子（暗）
  neck.castShadow = true;
  const head = joint('head', torso, 0, 0.66, 0.04);
  rock(head, headStone, 0.155, 0, 0.1, 0, [1.05, 0.95, 0.95], 0.6);
  box(head, jointStone, 0.2, 0.05, 0.05, 0, 0.115, 0.135); // 眼缝所在的暗槽
  box(head, glow, 0.15, 0.024, 0.02, 0, 0.115, 0.158); // 眼缝
  rock(head, torsoStone, 0.1, 0, 0.215, -0.01, [1.3, 0.4, 1.1], 0.2); // 眉石

  // --- 双臂：肩石、上臂、粗大的前臂和拳头；肩和腕各一道细铜箍 ---
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    const shoulder = joint(`shoulder${tag}`, torso, sx * 0.46, 0.46, 0);
    shoulder.rotation.z = sx * 0.42; // 双臂明显外张，和躯干之间留出空隙
    rock(shoulder, armStone, 0.16, 0, 0.02, 0, [1, 0.88, 1], sx * 0.8);
    ring(shoulder, band, 0.115, 0.01, -0.085, 4, 10);
    box(shoulder, jointStone, 0.1, 0.16, 0.1, 0, -0.17, 0); // 上臂（暗）
    const elbow = joint(`elbow${tag}`, shoulder, 0, -0.27, 0);
    elbow.rotation.x = -0.25;
    rock(elbow, armStone, 0.125, 0, -0.13, 0, [0.95, 1.45, 1], sx * 0.3);
    ring(elbow, band, 0.098, 0.011, -0.265, 4, 10);
    const fist = joint(`fist${tag}`, elbow, 0, -0.35, 0);
    rock(fist, headStone, 0.135, 0, 0, 0.01, [1, 0.95, 1.1], sx * 1.1);
    box(fist, jointStone, 0.19, 0.02, 0.03, 0, -0.02, 0.125); // 指缝
  }

  return finishCreature(root, 'golem', 1.34, c.scale);
}

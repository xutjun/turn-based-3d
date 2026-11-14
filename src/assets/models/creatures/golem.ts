// 宝宝 · 魔偶：石块拼成的矮壮人偶，胸口嵌着发光的符文核心，双臂粗长垂到膝下。
// 剪影特征：宽、方、头小、拳头大。

import { CylinderGeometry, DodecahedronGeometry, Group } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { glowMaterial, plateMaterial, stoneSurfaceMaterial } from '../../materials';
import { runeStripTexture } from '../../textures/sprites';
import { ball, box, mesh, ring } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface GolemParams extends CreatureBaseParams {
  stoneColor: number;
  darkStoneColor: number; // 关节、头
  bandColor: number; // 铁箍
  glowColor: number; // 核心与符文
  glowIntensity: number;
}

export const GOLEM_DEFAULTS: GolemParams = {
  scale: 1,
  rim: RIM_CONFIG.ally,
  stoneColor: 0x8a8578,
  darkStoneColor: 0x4a4842,
  bandColor: 0x6b5a34,
  glowColor: 0xd8e86a,
  glowIntensity: 2.8,
};

export function buildGolem(params: Partial<GolemParams> = {}): Group {
  const c = { ...GOLEM_DEFAULTS, ...params };
  const root = new Group();
  const stone = stoneSurfaceMaterial({ color: c.stoneColor, rim: c.rim });
  const dark = stoneSurfaceMaterial({ color: c.darkStoneColor, rim: c.rim });
  const band = plateMaterial({ color: c.bandColor, rim: c.rim, metalness: 0.85 });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  const runes = glowMaterial(c.glowColor, c.glowIntensity, {
    emissiveMap: runeStripTexture(17),
    baseColor: c.darkStoneColor,
    doubleSide: true,
  });
  /** 一块有棱角的石头 */
  const rock = (parent: Group, mat: typeof stone, r: number, x: number, y: number, z: number, s: [number, number, number], rotY = 0) => {
    const m = mesh(new DodecahedronGeometry(r, 0), mat, parent);
    m.position.set(x, y, z);
    m.scale.set(...s);
    m.rotation.y = rotY;
    return m;
  };

  // --- 腿与骨盆 ---
  const hips = joint('hips', root, 0, 0.38, 0);
  box(hips, dark, 0.36, 0.13, 0.24, 0, 0, 0);
  for (const sx of [1, -1]) {
    const leg = joint(`leg${sx > 0 ? 'L' : 'R'}`, hips, sx * 0.14, -0.04, 0);
    rock(leg, stone, 0.11, 0, -0.13, 0, [1, 1.25, 1.05], sx * 0.4);
    box(leg, dark, 0.2, 0.1, 0.27, 0, -0.29, 0.03);
    ring(leg, band, 0.095, 0.014, -0.22, 5, 12);
  }

  // --- 躯干：一大块岩石，腰间一圈符文带，胸口嵌核心 ---
  const torso = joint('torso', hips, 0, 0.08, 0);
  rock(torso, stone, 0.3, 0, 0.26, 0, [1.18, 0.98, 0.88], 0.3);
  const belt = mesh(new CylinderGeometry(0.262, 0.25, 0.06, 24, 1, true), runes, torso);
  belt.position.y = 0.05;
  belt.scale.z = 0.86;
  const socket = ring(torso, band, 0.1, 0.022, 0, 6, 16);
  socket.position.set(0, 0.3, 0.215);
  socket.rotation.set(0, 0, 0); // 核心外圈立在胸前
  ball(torso, glow, 0.075, 0, 0.3, 0.2, [1, 1, 0.6]);
  // 几道发光的裂纹
  for (const [x, y, rz, len] of [
    [0.16, 0.42, 0.7, 0.14],
    [-0.17, 0.2, -0.5, 0.12],
    [-0.12, 0.44, -1.0, 0.1],
    [0.18, 0.16, 0.3, 0.09],
  ] as const) {
    const crack = box(torso, glow, 0.012, len, 0.012, x, y, 0.235);
    crack.rotation.z = rz;
  }

  // --- 头：陷在双肩之间的小石块，一道发光的眼缝 ---
  const head = joint('head', torso, 0, 0.54, 0.03);
  rock(head, dark, 0.1, 0, 0.06, 0, [1.05, 0.95, 1], 0.6);
  box(head, glow, 0.11, 0.018, 0.02, 0, 0.065, 0.083);

  // --- 双臂：肩石、上臂、粗大的前臂和拳头 ---
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    const shoulder = joint(`shoulder${tag}`, torso, sx * 0.37, 0.42, 0);
    shoulder.rotation.z = sx * 0.16;
    rock(shoulder, stone, 0.155, 0, 0.02, 0, [1, 0.9, 1], sx * 0.8);
    box(shoulder, dark, 0.1, 0.2, 0.1, 0, -0.17, 0);
    const elbow = joint(`elbow${tag}`, shoulder, 0, -0.27, 0);
    elbow.rotation.x = -0.25;
    rock(elbow, stone, 0.12, 0, -0.13, 0, [0.95, 1.5, 1], sx * 0.3);
    ring(elbow, band, 0.105, 0.016, -0.03, 5, 12);
    const fist = joint(`fist${tag}`, elbow, 0, -0.33, 0);
    rock(fist, dark, 0.125, 0, 0, 0.01, [1, 0.95, 1.1], sx * 1.1);
  }

  return finishCreature(root, 'golem', 1.14, c.scale);
}

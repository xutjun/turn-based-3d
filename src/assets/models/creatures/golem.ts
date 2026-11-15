// 宝宝 · 魔偶：石块拼成的矮壮人偶，胸口嵌着发光的符文核心，双臂粗长垂到膝下。
// 剪影特征：宽、方、头小、拳头大。
// 步骤 10 细化：灰石 + 深色玄石 + 旧铜箍（带铆钉）+ 青苔；肩背上长着发光水晶，躯干和前臂刻着符文，
// 拳头套着铜指虎，腰间垂着锁链。

import { CylinderGeometry, DodecahedronGeometry, Group } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { glowMaterial, plateMaterial, stoneSurfaceMaterial } from '../../materials';
import { runeSpeckTexture, runeStripTexture } from '../../textures/sprites';
import { stoneTextures } from '../../textures/surfaces';
import { ball, box, chain, cones, mesh, ring, rivetRing, type ConeSpec } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface GolemParams extends CreatureBaseParams {
  stoneColor: number;
  darkStoneColor: number; // 关节、头
  bandColor: number; // 铜箍
  mossColor: number; // 青苔
  glowColor: number; // 核心与符文
  glowIntensity: number;
}

export const GOLEM_DEFAULTS: GolemParams = {
  scale: 1,
  rim: RIM_CONFIG.ally,
  stoneColor: 0xa39c8a,
  darkStoneColor: 0x4f4c48,
  bandColor: 0xb07a3a,
  mossColor: 0x5a7a3a,
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
  const moss = stoneSurfaceMaterial({ color: c.mossColor, rim: c.rim });
  // 刻着符文的石头：石质表面上零散的发光刻痕
  const crystal = glowMaterial(c.glowColor, c.glowIntensity * 0.3, { baseColor: 0x4a5a22 });
  const runedStone = glowMaterial(c.glowColor, c.glowIntensity * 0.2, {
    emissiveMap: runeSpeckTexture(17, 30),
    baseColor: c.stoneColor,
    surface: stoneTextures(),
    rim: c.rim,
  });
  /** 一簇发光水晶 */
  const crystals = (parent: Group, x: number, y: number, z: number, lean: number, size = 1): void => {
    const list: ConeSpec[] = [
      { at: [x, y, z], dir: [lean, 1, -0.2], radius: 0.03 * size, length: 0.14 * size },
      { at: [x + 0.04 * size, y, z + 0.02], dir: [lean + 0.5, 1, 0.2], radius: 0.022 * size, length: 0.09 * size },
      { at: [x - 0.03 * size, y, z - 0.03], dir: [lean - 0.4, 1, -0.5], radius: 0.02 * size, length: 0.08 * size },
    ];
    cones(parent, crystal, list, 5);
  };
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
    box(leg, band, 0.21, 0.025, 0.06, 0, -0.325, 0.15); // 脚尖的铜包头
    ring(leg, band, 0.095, 0.014, -0.22, 5, 12);
    rivetRing(leg, band, 0.108, 6, -0.22, 0.011);
    rock(leg, moss, 0.05, sx * 0.07, -0.05, 0.05, [1, 0.5, 1], sx);
  }

  // --- 躯干：一大块岩石，腰间一圈符文带，胸口嵌核心 ---
  const torso = joint('torso', hips, 0, 0.08, 0);
  rock(torso, runedStone, 0.3, 0, 0.26, 0, [1.18, 0.98, 0.88], 0.3);
  // 背上压着的两块叠石、青苔和水晶
  rock(torso, stone, 0.17, -0.1, 0.44, -0.14, [1.1, 0.8, 1], 0.9);
  rock(torso, dark, 0.13, 0.14, 0.42, -0.16, [1, 0.8, 1], 0.2);
  rock(torso, moss, 0.09, -0.16, 0.52, -0.05, [1.2, 0.4, 1.1], 0.5);
  rock(torso, moss, 0.07, 0.2, 0.36, 0.1, [1, 0.5, 1], 1.1);
  crystals(torso, 0.1, 0.5, -0.14, 0.3, 1.1);
  crystals(torso, -0.2, 0.5, -0.12, -0.5, 0.8);
  // 斜挎的铜箍和腰间垂下的锁链
  const sash = ring(torso, band, 0.31, 0.016, 0, 4, 22);
  sash.position.y = 0.26;
  sash.rotation.set(Math.PI / 2, 0.55, 0);
  sash.scale.set(1.12, 0.84, 1);
  chain(torso, band, [
    [0.2, 0.05, 0.16],
    [0.24, -0.16, 0.18],
  ], 0.02);
  chain(torso, band, [
    [-0.16, 0.05, 0.19],
    [-0.19, -0.1, 0.2],
  ], 0.02);
  const belt = mesh(new CylinderGeometry(0.262, 0.25, 0.06, 24, 1, true), runes, torso);
  belt.position.y = 0.05;
  belt.scale.z = 0.86;
  const socket = ring(torso, band, 0.1, 0.022, 0, 6, 16);
  socket.position.set(0, 0.3, 0.215);
  socket.rotation.set(0, 0, 0); // 核心外圈立在胸前
  const socketRivets = rivetRing(torso, band, 0.1, 8, 0, 0.012);
  socketRivets.rotation.x = Math.PI / 2;
  socketRivets.position.set(0, 0.3, 0.24);
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
  box(head, band, 0.2, 0.03, 0.18, 0, 0.115, 0); // 头顶的铜箍
  rock(head, moss, 0.045, -0.04, 0.15, -0.02, [1.3, 0.4, 1.2], 0.3);

  // --- 双臂：肩石、上臂、粗大的前臂和拳头 ---
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    const shoulder = joint(`shoulder${tag}`, torso, sx * 0.37, 0.42, 0);
    shoulder.rotation.z = sx * 0.16;
    rock(shoulder, stone, 0.155, 0, 0.02, 0, [1, 0.9, 1], sx * 0.8);
    if (sx > 0) crystals(shoulder, 0.03, 0.12, -0.02, 0.5, 0.75);
    else rock(shoulder, moss, 0.07, -0.02, 0.13, 0.02, [1.3, 0.4, 1.2], 0.7);
    box(shoulder, dark, 0.1, 0.2, 0.1, 0, -0.17, 0);
    const elbow = joint(`elbow${tag}`, shoulder, 0, -0.27, 0);
    elbow.rotation.x = -0.25;
    rock(elbow, runedStone, 0.12, 0, -0.13, 0, [0.95, 1.5, 1], sx * 0.3);
    ring(elbow, band, 0.105, 0.016, -0.03, 5, 12);
    rivetRing(elbow, band, 0.12, 6, -0.03, 0.011);
    ring(elbow, band, 0.1, 0.014, -0.25, 5, 12);
    const fist = joint(`fist${tag}`, elbow, 0, -0.33, 0);
    rock(fist, dark, 0.125, 0, 0, 0.01, [1, 0.95, 1.1], sx * 1.1);
    // 铜指虎：拳面上一条带钉的铜箍
    box(fist, band, 0.2, 0.05, 0.05, 0, -0.06, 0.1);
    cones(
      fist,
      band,
      [-0.06, 0, 0.06].map((cx): ConeSpec => ({ at: [cx, -0.06, 0.12], dir: [0, -0.2, 1], radius: 0.018, length: 0.045 })),
      5,
    );
  }

  return finishCreature(root, 'golem', 1.14, c.scale);
}

// 恢复系 · 守誓者：浅色长袍、披肩、胸前圣徽、脑后光环。剪影特征：柔和、宽下摆、头后有带芒的圆环。

import { CylinderGeometry, TorusGeometry, type Group } from 'three';
import { clothMaterial, glowMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { tatterAlphaTexture } from '../../textures/sprites';
import { ALLY_RIM, finishCharacter, type CharacterBaseParams } from './common';
import { ball, box, capeMesh, extruded, hood, lathe, mesh, ring, robeSkirt, softSeg } from './parts';
import { createRig, DEFAULT_DIMS } from './rig';

export interface HealerParams extends CharacterBaseParams {
  robeColor: number; // 长袍
  capeColor: number; // 披肩与兜帽
  trimColor: number; // 金饰
  leatherColor: number;
  glowColor: number; // 圣徽、光环
  glowIntensity: number;
}

export const HEALER_DEFAULTS: HealerParams = {
  scale: 0.99,
  rim: ALLY_RIM,
  robeColor: 0xb9b19a,
  capeColor: 0xd6cfba,
  trimColor: 0xc19a45,
  leatherColor: 0x6a5238,
  glowColor: 0xe6e28a,
  glowIntensity: 2.6,
};

/** 八芒星轮廓（圣徽） */
function starPoints(outer: number, inner: number, rays: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < rays * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (rays * 2)) * Math.PI * 2 + Math.PI / 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

export function buildHealer(params: Partial<HealerParams> = {}): Group {
  const c = { ...HEALER_DEFAULTS, ...params };
  const rig = createRig({ ...DEFAULT_DIMS, shoulderWidth: 0.2 });
  const rim = c.rim;
  const robe = clothMaterial({ color: c.robeColor, rim, doubleSide: true });
  const hem = clothMaterial({ color: c.robeColor, rim, doubleSide: true, alphaMap: tatterAlphaTexture(9, 0.07) });
  const cape = clothMaterial({ color: c.capeColor, rim, doubleSide: true });
  const gold = plateMaterial({ color: c.trimColor, rim, metalness: 0.95 });
  const leather = leatherMaterial({ color: c.leatherColor, rim });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);
  const softGlow = glowMaterial(c.glowColor, c.glowIntensity * 0.55);
  const shadow = clothMaterial({ color: 0x0a0908 });

  // --- 下摆：宽大的拖地长袍，前垂金边饰带 ---
  robeSkirt(rig.hips, hem, { topRadius: 0.172, bottomRadius: 0.43, length: 0.88, folds: 11 });
  const sash = capeMesh(rig.hips, cape, { topWidth: 0.13, bottomWidth: 0.15, length: 0.7, wrap: 0, flare: -0.19 });
  sash.position.set(0, 0.02, 0.165);
  const sashStar = extruded(rig.hips, gold, starPoints(0.045, 0.02, 4), 0.012);
  sashStar.position.set(0, -0.5, 0.31);
  sashStar.rotation.x = -0.25;
  for (const leg of [rig.legL, rig.legR]) box(leg.foot, leather, 0.09, 0.07, 0.2, 0, -0.045, 0.05);

  // --- 腰带 ---
  ring(rig.hips, gold, 0.178, 0.022, 0.05, 6, 20);
  ring(rig.hips, gold, 0.172, 0.012, 0.0, 5, 20);

  // --- 躯干 ---
  lathe(rig.spine, robe, [
    [0.174, 0],
    [0.152, 0.14],
    [0.16, 0.29],
  ]).scale.z = 0.85;
  lathe(rig.chest, robe, [
    [0.16, 0],
    [0.184, 0.1],
    [0.165, 0.19],
    [0.085, 0.25],
  ]).scale.z = 0.82;

  // --- 披肩：浅色短披肩，金色滚边 ---
  lathe(rig.chest, cape, [
    [0.08, 0.275],
    [0.19, 0.225],
    [0.285, 0.1],
    [0.31, -0.02],
  ]).scale.z = 0.86;
  const edge = mesh(new TorusGeometry(0.31, 0.012, 5, 28), gold, rig.chest);
  edge.rotation.x = Math.PI / 2;
  edge.position.y = -0.02;
  edge.scale.y = 0.86; // 圆环旋转后，本地 y 对应前后方向

  // --- 胸前圣徽：八芒星 + 发光的中心 ---
  const emblem = extruded(rig.chest, gold, starPoints(0.075, 0.032, 8), 0.014);
  emblem.position.set(0, 0.1, 0.228);
  emblem.rotation.x = -0.32;
  ball(rig.chest, glow, 0.026, 0, 0.1, 0.24);

  // --- 双臂：中等宽度的袖子，金色袖口 ---
  for (const arm of [rig.armL, rig.armR]) {
    softSeg(arm.shoulder, robe, 0.3, 0.058);
    const sleeve = mesh(new CylinderGeometry(0.062, 0.105, 0.28, 14, 1, true), robe, arm.elbow);
    sleeve.position.y = -0.13;
    ring(arm.elbow, gold, 0.105, 0.01, -0.27, 5, 16);
    ball(arm.hand, leather, 0.042, 0, -0.03, 0, [1, 1.3, 0.9]);
  }

  // --- 头：浅色软兜帽、额前金饰、柔和的目光 ---
  ball(rig.head, shadow, 0.1, 0, 0.115, 0);
  for (const sx of [1, -1]) ball(rig.head, softGlow, 0.012, sx * 0.036, 0.125, 0.088);
  const h = hood(rig.head, cape, { radius: 0.155, opening: 1.6, peak: 0.04 });
  h.position.y = 0.12;
  box(rig.head, gold, 0.03, 0.03, 0.02, 0, 0.235, 0.115).rotation.z = Math.PI / 4;

  // --- 脑后光环：发光圆环 + 一圈短芒 ---
  const halo = mesh(new TorusGeometry(0.19, 0.011, 6, 36), glow, rig.head);
  halo.position.set(0, 0.16, -0.12);
  const rays = 12;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const long = i % 2 === 0;
    const ray = box(rig.head, softGlow, 0.012, long ? 0.09 : 0.05, 0.008);
    const r = 0.19 + (long ? 0.065 : 0.045);
    ray.position.set(Math.cos(a) * r, 0.16 + Math.sin(a) * r, -0.12);
    ray.rotation.z = a - Math.PI / 2;
  }

  return finishCharacter(rig, 'healer', 1.9, c.scale);
}

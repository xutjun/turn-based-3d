// 宝宝 · 幽灵：悬浮的破烂裹尸布，兜帽深处两点目光，双手垂着断掉的镣铐。
// 剪影特征：没有腿、下摆撕成长条、离地漂浮。

import { AdditiveBlending, CylinderGeometry, Group, Sprite, SpriteMaterial } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, plateMaterial } from '../../materials';
import { glowTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ball, capeMesh, chain, hood, lathe, mesh, ring, robeSkirt, softSeg } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface GhostParams extends CreatureBaseParams {
  shroudColor: number; // 裹尸布
  innerColor: number; // 兜帽内的暗影
  boneColor: number; // 手
  chainColor: number;
  glowColor: number; // 目光与体内幽光
  glowIntensity: number;
  hover: number; // 下摆离地高度
}

export const GHOST_DEFAULTS: GhostParams = {
  scale: 1,
  rim: RIM_CONFIG.ally,
  shroudColor: 0x7c8296,
  innerColor: 0x07070a,
  boneColor: 0xcfc8b4,
  chainColor: 0x7d8490,
  glowColor: 0xb46bff,
  glowIntensity: 5,
  hover: 0.16,
};

export function buildGhost(params: Partial<GhostParams> = {}): Group {
  const c = { ...GHOST_DEFAULTS, ...params };
  const root = new Group();
  const shroud = clothMaterial({ color: c.shroudColor, rim: c.rim, doubleSide: true });
  const ragged = clothMaterial({
    color: c.shroudColor,
    rim: c.rim,
    doubleSide: true,
    alphaMap: tatterAlphaTexture(13, 0.55),
  });
  // 布料带一点自发的幽光，在暗处像是半透明
  for (const m of [shroud, ragged]) {
    m.emissive.set(c.glowColor);
    m.emissiveIntensity = 0.12;
  }
  const inner = clothMaterial({ color: c.innerColor });
  const bone = boneSurfaceMaterial({ color: c.boneColor, rim: c.rim });
  const iron = plateMaterial({ color: c.chainColor, rim: c.rim, metalness: 0.9 });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);

  // --- 身体：整体悬浮，下摆撕成长条 ---
  const body = joint('body', root, 0, c.hover + 0.56, 0);
  robeSkirt(body, ragged, { topRadius: 0.13, bottomRadius: 0.3, length: 0.56, folds: 7, depthScale: 0.8 });
  lathe(body, shroud, [
    [0.13, 0],
    [0.15, 0.12],
    [0.13, 0.22],
    [0.07, 0.28],
  ]).scale.z = 0.8;
  // 体内的幽光：下摆里的一团光
  const wisp = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color: c.glowColor,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  wisp.position.y = -0.42;
  wisp.scale.setScalar(0.55);
  body.add(wisp);

  // --- 背后拖着的一片破布 ---
  const tail = capeMesh(body, ragged, { topWidth: 0.26, bottomWidth: 0.46, length: 0.72, wrap: 0.08, flare: 0.3 });
  tail.position.set(0, 0.22, -0.1);

  // --- 双臂：向前伸的破袖，露出骨手，手腕上是断掉的镣铐 ---
  for (const sx of [1, -1]) {
    const tag = sx > 0 ? 'L' : 'R';
    const shoulder = joint(`shoulder${tag}`, body, sx * 0.14, 0.2, 0);
    shoulder.rotation.set(-0.75, 0, sx * 0.22);
    softSeg(shoulder, shroud, 0.2, 0.045);
    const elbow = joint(`elbow${tag}`, shoulder, 0, -0.2, 0);
    elbow.rotation.x = -0.7;
    const sleeve = mesh(new CylinderGeometry(0.045, 0.085, 0.2, 12, 1, true), ragged, elbow);
    sleeve.position.y = -0.09;
    const hand = joint(`hand${tag}`, elbow, 0, -0.2, 0);
    ball(hand, bone, 0.028, 0, -0.01, 0, [1, 1.3, 0.7]);
    for (const a of [-0.5, 0, 0.5]) {
      softSeg(hand, bone, 0.07, 0.007).position.set(Math.sin(a) * 0.022, -0.065, 0.004);
    }
    ring(elbow, iron, 0.036, 0.009, -0.17, 5, 12);
    chain(elbow, iron, [
      [0, -0.18, 0.03],
      [0, -0.3, 0.05],
    ], 0.014);
  }

  // --- 头：兜帽，暗影里两点目光 ---
  const head = joint('head', body, 0, 0.3, 0.01);
  ball(head, inner, 0.085, 0, 0.09, 0);
  for (const sx of [1, -1]) ball(head, glow, 0.013, sx * 0.032, 0.1, 0.075);
  const h = hood(head, shroud, { radius: 0.135, opening: 1.4, peak: 0.16 });
  h.position.y = 0.095;

  return finishCreature(root, 'ghost', c.hover + 1.1, c.scale);
}

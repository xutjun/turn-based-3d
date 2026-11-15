// 宝宝 · 幽灵：悬浮的破烂裹尸布，兜帽深处两点目光，双手垂着断掉的镣铐。
// 剪影特征：没有腿、下摆撕成长条、离地漂浮。
// 步骤 10 细化：灰白裹尸布 + 暗紫内衬两层破摆，兜帽里一张骨面，腰间铁链和断锁，
// 左手提一盏魂灯，胸前挂着符牌，身后拖着几缕布条。

import { AdditiveBlending, CylinderGeometry, Group, Sprite, SpriteMaterial } from 'three';
import { RIM_CONFIG } from '../../../data/renderConfig';
import { boneSurfaceMaterial, clothMaterial, glowMaterial, plateMaterial } from '../../materials';
import { glowTexture, runeStripTexture, tatterAlphaTexture } from '../../textures/sprites';
import { ball, box, capeMesh, chain, gem, hood, lathe, mesh, ring, rivetRing, robeSkirt, softSeg } from '../characters/parts';
import { finishCreature, joint, type CreatureBaseParams } from './common';

export interface GhostParams extends CreatureBaseParams {
  shroudColor: number; // 裹尸布
  innerColor: number; // 兜帽内的暗影
  liningColor: number; // 内层破摆
  boneColor: number; // 手
  chainColor: number;
  glowColor: number; // 目光与体内幽光
  glowIntensity: number;
  hover: number; // 下摆离地高度
}

export const GHOST_DEFAULTS: GhostParams = {
  scale: 1,
  rim: RIM_CONFIG.ally,
  shroudColor: 0x9aa2b8,
  innerColor: 0x07070a,
  liningColor: 0x3a2a5a,
  boneColor: 0xd8d0ba,
  chainColor: 0x8d94a0,
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
  const lining = clothMaterial({
    color: c.liningColor,
    rim: c.rim,
    doubleSide: true,
    alphaMap: tatterAlphaTexture(14, 0.6),
  });
  const runes = glowMaterial(c.glowColor, c.glowIntensity * 0.6, {
    emissiveMap: runeStripTexture(13),
    baseColor: 0x1a1226,
    doubleSide: true,
  });
  const bone = boneSurfaceMaterial({ color: c.boneColor, rim: c.rim });
  const iron = plateMaterial({ color: c.chainColor, rim: c.rim, metalness: 0.9 });
  const glow = glowMaterial(c.glowColor, c.glowIntensity);

  // --- 身体：整体悬浮，下摆撕成长条 ---
  const body = joint('body', root, 0, c.hover + 0.56, 0);
  robeSkirt(body, lining, { topRadius: 0.11, bottomRadius: 0.24, length: 0.66, folds: 9, depthScale: 0.8 });
  robeSkirt(body, ragged, { topRadius: 0.13, bottomRadius: 0.3, length: 0.56, folds: 7, depthScale: 0.8 });
  // 腰间的铁链、断锁和胸前的符牌
  ring(body, iron, 0.14, 0.014, 0.02, 4, 16).scale.set(1, 0.82, 1);
  chain(body, iron, [
    [0.1, 0.02, 0.08],
    [0.14, -0.2, 0.12],
  ], 0.016);
  box(body, iron, 0.06, 0.07, 0.025, 0.14, -0.25, 0.12).rotation.z = 0.2; // 断锁
  chain(body, iron, [
    [-0.07, 0.24, 0.07],
    [0, 0.13, 0.125],
    [0.07, 0.24, 0.07],
  ], 0.012);
  const plaque = box(body, runes, 0.07, 0.09, 0.012, 0, 0.09, 0.128);
  plaque.rotation.x = -0.1;
  // 肩上搭着的一圈破布披肩
  lathe(body, ragged, [
    [0.06, 0.3],
    [0.16, 0.25],
    [0.2, 0.13],
  ]).scale.z = 0.85;
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
  // 两侧各拖一缕细布条
  for (const sx of [1, -1]) {
    const strip = capeMesh(body, lining, { topWidth: 0.07, bottomWidth: 0.1, length: 0.8, wrap: 0, flare: 0.42 });
    strip.position.set(sx * 0.12, 0.1, -0.08);
    strip.rotation.z = sx * 0.2;
  }

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
    if (sx > 0) {
      // 左手提着的魂灯：铁笼 + 灯芯
      chain(hand, iron, [
        [0, -0.06, 0.01],
        [0, -0.15, 0.01],
      ], 0.011);
      const lamp = mesh(new CylinderGeometry(0.035, 0.03, 0.08, 6, 1, true), iron, hand);
      lamp.position.set(0, -0.2, 0.01);
      const cap = mesh(new CylinderGeometry(0.008, 0.042, 0.03, 6), iron, hand);
      cap.position.set(0, -0.15, 0.01);
      mesh(new CylinderGeometry(0.038, 0.038, 0.012, 6), iron, hand).position.set(0, -0.245, 0.01);
      gem(hand, glow, 0.02, 0, -0.2, 0.01, 1.5);
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
  // 骨面：眼窝发光的半张头骨
  ball(head, bone, 0.07, 0, 0.085, 0.03, [0.9, 1.1, 0.8]);
  box(head, inner, 0.05, 0.03, 0.02, 0, 0.035, 0.078); // 下颌的黑洞
  rivetRing(head, bone, 0.03, 5, 0.052, 0.006, 1, [-0.9, 0.9]).position.z = 0.055; // 一排牙
  for (const sx of [1, -1]) {
    ball(head, inner, 0.02, sx * 0.03, 0.1, 0.08, [1.1, 1, 0.5]);
    ball(head, glow, 0.012, sx * 0.03, 0.1, 0.088);
  }
  const h = hood(head, shroud, { radius: 0.135, opening: 1.4, peak: 0.16 });
  h.position.y = 0.095;

  return finishCreature(root, 'ghost', c.hover + 1.1, c.scale);
}

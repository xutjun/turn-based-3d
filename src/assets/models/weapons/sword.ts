// 剑：直刃双面剑，十字护手嵌宝石，血槽里是冷蓝/银白的符文光带，呼吸闪烁。

import { BoxGeometry, CylinderGeometry, Group, OctahedronGeometry, PlaneGeometry, SphereGeometry } from 'three';
import { WEAPONS } from '../../../data/weapons';
import { leatherMaterial, plateMaterial } from '../../materials';
import { runeStripTexture } from '../../textures/sprites';
import { mesh, ring } from '../characters/parts';
import { bladeGeometry, ownTexture, WEAPON_RIM, type WeaponBaseParams } from './common';
import { finishWeapon, glowMesh, WeaponGlow } from './glow';

export interface SwordParams extends WeaponBaseParams {
  length: number; // 剑身长度
  width: number; // 剑身宽度
  steelColor: number;
  trimColor: number; // 护手、剑首
  gripColor: number;
}

export const SWORD_DEFAULTS: SwordParams = {
  scale: 1,
  rim: WEAPON_RIM,
  glow: WEAPONS.sword.glow,
  length: 1.02,
  width: 0.074,
  steelColor: 0x8d95a3,
  trimColor: 0x55585f,
  gripColor: 0x1d1a22,
};

export function buildSwordWithGlow(params: Partial<SwordParams> = {}): Group {
  const c = { ...SWORD_DEFAULTS, ...params };
  const root = new Group();
  const glow = new WeaponGlow(c.glow, 23);
  const steel = plateMaterial({ color: c.steelColor, rim: c.rim, metalness: 0.95 });
  const trim = plateMaterial({ color: c.trimColor, rim: c.rim, metalness: 0.9 });
  const grip = leatherMaterial({ color: c.gripColor, rim: c.rim });

  // --- 剑柄、剑首 ---
  mesh(new CylinderGeometry(0.018, 0.021, 0.22, 8), grip, root).position.y = -0.01;
  for (let i = 0; i < 3; i++) ring(root, trim, 0.021, 0.0035, -0.08 + i * 0.07, 4, 10);
  mesh(new SphereGeometry(0.03, 10, 8), trim, root).position.y = -0.145;
  glowMesh(new OctahedronGeometry(0.014), glow.emissive({ slot: 'accent', factor: 0.6 }), root).position.set(0, -0.145, 0.024);

  // --- 十字护手：中间厚、两端下垂的尖角，正中嵌宝石 ---
  const guardY = 0.115;
  mesh(new BoxGeometry(0.05, 0.05, 0.1), trim, root).position.y = guardY;
  for (const s of [1, -1]) {
    const arm = mesh(new CylinderGeometry(0.008, 0.019, 0.15, 6), trim, root);
    arm.position.set(0, guardY - 0.012, s * 0.115);
    arm.rotation.x = s * (Math.PI / 2 + 0.22);
  }
  for (const s of [1, -1]) {
    const gem = glowMesh(new OctahedronGeometry(0.02), glow.emissive({ factor: 1.2 }), root);
    gem.position.set(s * 0.026, guardY, 0);
    gem.scale.set(0.5, 1, 1);
  }

  // --- 剑身：两侧开刃，前端收尖 ---
  const L = c.length;
  const hw = c.width / 2;
  const blade = new Group();
  blade.position.y = guardY + 0.025;
  root.add(blade);
  mesh(
    bladeGeometry(
      [
        [-hw, 0],
        [-hw * 0.82, L * 0.82],
        [0, L],
        [hw * 0.82, L * 0.82],
        [hw, 0],
      ],
      0.018,
      0.007,
    ),
    steel,
    blade,
  );

  // --- 血槽：暗的底光 + 一排符文，剑身两面各一条 ---
  const fullerLen = L * 0.72;
  const fullerY = 0.04 + fullerLen / 2;
  glowMesh(new BoxGeometry(0.0195, fullerLen, 0.014), glow.emissive({ factor: 0.4 }), blade).position.y = fullerY;
  const runes = ownTexture(runeStripTexture(7), 1, 1);
  const runeMat = glow.emissive({ slot: 'accent', factor: 0.55, map: runes, additive: true, doubleSide: true });
  for (const s of [1, -1]) {
    // 平面的长边沿 x（贴图横向），转到沿剑身方向并贴到剑面外侧
    const strip = glowMesh(new PlaneGeometry(fullerLen, 0.03), runeMat, blade);
    strip.rotation.set(0, (s * Math.PI) / 2, Math.PI / 2, 'YZX');
    strip.position.set(s * 0.0105, fullerY, 0);
  }

  // --- 辉光、点光源、冷色光点 ---
  const top = blade.position.y;
  glow.halo(root, [0, guardY, 0], 0.55, 'main', 0.9);
  glow.halo(root, [0, top + L * 0.4, 0], 1, 'main', 0.7);
  glow.halo(root, [0, top + L * 0.78, 0], 0.7, 'main', 0.5);
  glow.light(root, [0, top + L * 0.45, 0.05]);
  glow.particles(root, {
    count: c.glow.particleCount,
    size: 0.04,
    mode: 'rise',
    from: [0, top + 0.05, 0],
    to: [0, top + L * 0.9, 0],
    speed: 0.14,
    spread: 0.04,
    life: 1.8,
  });

  root.scale.setScalar(c.scale);
  return finishWeapon(root, 'sword', glow, { hand: 'right', rotation: [0.1, 0, 0] });
}

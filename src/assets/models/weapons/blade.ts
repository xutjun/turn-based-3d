// 刀：弧形单刃刀身，刃口是流动的熔岩红橙光线，刀身周围有热浪辉光和飘起的火星。

import { CylinderGeometry, Group, SphereGeometry } from 'three';
import { WEAPONS } from '../../../data/weapons';
import { leatherMaterial, plateMaterial } from '../../materials';
import { energyFlowTexture } from '../../textures/sprites';
import { mesh, ring } from '../characters/parts';
import { bladeGeometry, ownTexture, WEAPON_RIM, type WeaponBaseParams } from './common';
import { finishWeapon, glowMesh, WeaponGlow } from './glow';

export interface BladeParams extends WeaponBaseParams {
  length: number; // 刀身长度
  width: number; // 刀身根部宽度
  curve: number; // 弧度：刀尖向刀背方向偏移的距离
  steelColor: number;
  trimColor: number; // 护手、刀环
  gripColor: number; // 缠柄皮革
}

export const BLADE_DEFAULTS: BladeParams = {
  scale: 1,
  rim: WEAPON_RIM,
  glow: WEAPONS.blade.glow,
  length: 0.98,
  width: 0.085,
  curve: 0.15,
  steelColor: 0x6d7078,
  trimColor: 0xa8843c,
  gripColor: 0x3a2418,
};

export function buildBladeWithGlow(params: Partial<BladeParams> = {}): Group {
  const c = { ...BLADE_DEFAULTS, ...params };
  const root = new Group();
  const glow = new WeaponGlow(c.glow, 11);
  const steel = glow.edge(plateMaterial({ color: c.steelColor, rim: c.rim, metalness: 0.95 }), 1, 'main', 2.6);
  const trim = plateMaterial({ color: c.trimColor, rim: c.rim, metalness: 0.95 });
  const grip = leatherMaterial({ color: c.gripColor, rim: c.rim });

  // --- 刀柄、护手、刀环 ---
  mesh(new CylinderGeometry(0.02, 0.023, 0.26, 8), grip, root).position.y = -0.02;
  for (let i = 0; i < 4; i++) ring(root, trim, 0.0235, 0.004, -0.12 + i * 0.065, 4, 10);
  const guard = mesh(new CylinderGeometry(0.06, 0.06, 0.018, 12), trim, root);
  guard.position.y = 0.12;
  guard.scale.set(0.55, 1, 1); // 椭圆护手
  const pommel = ring(root, trim, 0.03, 0.008, -0.185, 5, 14);
  pommel.rotation.set(0, Math.PI / 2, 0); // 刀环竖着立在柄尾

  // --- 刀身：刀背一侧向后弯，靠近刀尖处变宽后收成尖 ---
  const L = c.length;
  const steps = 26;
  const spine: [number, number][] = [];
  const edge: [number, number][] = [];
  const widthAt = (t: number): number => {
    const belly = c.width * (0.85 + 0.5 * Math.min(t, 0.76));
    return t < 0.76 ? belly : belly * (1 - Math.pow((t - 0.76) / 0.24, 2));
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = -c.curve * t * t - c.width / 2;
    spine.push([sx, L * t]);
    edge.push([sx + widthAt(t), L * t]);
  }
  const outline: [number, number][] = [...edge.slice(0, -1), ...[...spine].reverse()];
  const blade = new Group();
  blade.position.y = 0.13;
  root.add(blade);
  mesh(bladeGeometry(outline, 0.016, 0.005), steel, blade);

  // --- 刃口光带：贴着刃口的一条窄带，自发光贴图沿刃口流动 ---
  const band = 0.02;
  const inner: [number, number][] = edge.map(([x, y], i) => [x - Math.min(band, widthAt(i / steps) * 0.8), y]);
  const edgeOutline: [number, number][] = [...edge.slice(0, -1), ...inner.reverse()];
  const flow = glow.flow(ownTexture(energyFlowTexture(3), 1, 2.5), 0, -1);
  glowMesh(bladeGeometry(edgeOutline, 0.019), glow.emissive({ map: flow }), blade);
  // 刀背上一道细的暗红血槽
  const groove: [number, number][] = [];
  for (let i = 2; i <= steps - 7; i++) groove.push([spine[i]![0] + 0.016, spine[i]![1]]);
  const grooveOutline: [number, number][] = [...groove, ...groove.map(([x, y]) => [x + 0.007, y] as [number, number]).reverse()];
  glowMesh(bladeGeometry(grooveOutline, 0.0175), glow.emissive({ factor: 0.3, map: flow }), blade);

  // --- 热浪辉光、点光源、火星 ---
  const at = (t: number): [number, number, number] => [0, 0.13 + L * t, -c.curve * t * t + widthAt(t) / 2];
  glow.halo(root, at(0.3), 0.8);
  glow.halo(root, at(0.62), 1);
  glow.halo(root, at(0.9), 0.7, 'accent', 0.8);
  glow.light(root, at(0.55));
  glow.particles(root, {
    count: c.glow.particleCount,
    size: 0.05,
    mode: 'rise',
    from: at(0.1),
    to: at(0.95),
    speed: 0.32,
    spread: 0.07,
    life: 1.2,
  });

  // 柄尾的小铁珠
  mesh(new SphereGeometry(0.012, 8, 6), trim, root).position.y = -0.155;

  root.scale.setScalar(c.scale);
  return finishWeapon(root, 'blade', glow, { hand: 'right', rotation: [0.1, 0, 0] });
}

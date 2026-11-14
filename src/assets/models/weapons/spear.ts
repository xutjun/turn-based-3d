// 枪：长杆，菱形尖刃枪头，枪尖有集中的金色光点，枪身缠着流动的光纹。

import { ConeGeometry, Curve, CylinderGeometry, Group, OctahedronGeometry, SphereGeometry, TubeGeometry, Vector3 } from 'three';
import { WEAPONS } from '../../../data/weapons';
import { clothMaterial, leatherMaterial, plateMaterial } from '../../materials';
import { energyFlowTexture, tatterAlphaTexture } from '../../textures/sprites';
import { mesh, ring } from '../characters/parts';
import { ownTexture, WEAPON_RIM, type WeaponBaseParams } from './common';
import { finishWeapon, glowMesh, WeaponGlow } from './glow';

export interface SpearParams extends WeaponBaseParams {
  length: number; // 枪杆长度（不含枪头）
  gripHeight: number; // 握持点离枪尾的距离
  headLength: number; // 枪头长度
  shaftColor: number;
  steelColor: number;
  trimColor: number;
  tasselColor: number; // 枪缨
}

export const SPEAR_DEFAULTS: SpearParams = {
  scale: 1,
  rim: WEAPON_RIM,
  glow: WEAPONS.spear.glow,
  length: 1.85,
  gripHeight: 0.9,
  headLength: 0.34,
  shaftColor: 0x4a3526,
  steelColor: 0x9aa0aa,
  trimColor: 0xb08d42,
  tasselColor: 0xb8b0a0,
};

/** 绕 y 轴上升的螺旋线 */
class Helix extends Curve<Vector3> {
  constructor(
    private readonly radius: number,
    private readonly y0: number,
    private readonly y1: number,
    private readonly turns: number,
  ) {
    super();
  }

  override getPoint(t: number, target = new Vector3()): Vector3 {
    const a = t * this.turns * Math.PI * 2;
    return target.set(Math.cos(a) * this.radius, this.y0 + (this.y1 - this.y0) * t, Math.sin(a) * this.radius);
  }
}

export function buildSpearWithGlow(params: Partial<SpearParams> = {}): Group {
  const c = { ...SPEAR_DEFAULTS, ...params };
  const root = new Group();
  const glow = new WeaponGlow(c.glow, 37);
  const shaft = leatherMaterial({ color: c.shaftColor, rim: c.rim });
  const steel = plateMaterial({ color: c.steelColor, rim: c.rim, metalness: 0.95 });
  const trim = plateMaterial({ color: c.trimColor, rim: c.rim, metalness: 0.95 });
  const tassel = clothMaterial({ color: c.tasselColor, rim: c.rim, doubleSide: true, alphaMap: tatterAlphaTexture(5, 0.5) });

  const bottom = -c.gripHeight;
  const top = bottom + c.length;

  // --- 枪杆、枪尾 ---
  mesh(new CylinderGeometry(0.016, 0.019, c.length, 8), shaft, root).position.y = (bottom + top) / 2;
  const butt = mesh(new ConeGeometry(0.022, 0.09, 8), trim, root);
  butt.position.y = bottom - 0.035;
  butt.rotation.x = Math.PI;
  ring(root, trim, 0.021, 0.006, bottom + 0.02, 5, 10);
  // 握持处的缠带
  mesh(new CylinderGeometry(0.021, 0.021, 0.24, 8), leatherMaterial({ color: 0x241710, rim: c.rim }), root).position.y = 0;

  // --- 枪头：套筒 + 菱形尖刃 + 中脊 ---
  mesh(new CylinderGeometry(0.014, 0.026, 0.12, 8), trim, root).position.y = top + 0.04;
  ring(root, trim, 0.027, 0.007, top - 0.015, 5, 12);
  const headY = top + 0.1 + c.headLength / 2;
  const head = mesh(new OctahedronGeometry(1), steel, root);
  head.position.y = headY;
  head.scale.set(0.013, c.headLength / 2, 0.062);
  const ridge = glowMesh(new OctahedronGeometry(1), glow.emissive({ factor: 0.9 }), root);
  ridge.position.y = headY;
  ridge.scale.set(0.0165, c.headLength / 2 - 0.035, 0.012);
  // 枪尖的光核
  const tipY = headY + c.headLength / 2;
  glowMesh(new SphereGeometry(0.014, 8, 6), glow.emissive({ slot: 'accent', factor: 1.8 }), root).position.y = tipY - 0.012;

  // --- 枪缨：套筒下的一圈破布 ---
  const fringe = mesh(new ConeGeometry(0.075, 0.2, 12, 1, true), tassel, root);
  fringe.position.y = top - 0.12;

  // --- 缠绕枪身的光纹：两条方向相反的螺旋，贴图沿螺旋流动 ---
  const y0 = 0.2;
  const y1 = top - 0.26;
  const flowA = glow.flow(ownTexture(energyFlowTexture(5), 3, 1), -1, 0);
  glowMesh(new TubeGeometry(new Helix(0.0215, y0, y1, 4.5), 110, 0.0042, 5), glow.emissive({ map: flowA }), root);
  const flowB = glow.flow(ownTexture(energyFlowTexture(6), 3, 1), 1, 0);
  glowMesh(new TubeGeometry(new Helix(0.0215, y0, y1, -4.5), 110, 0.003, 5), glow.emissive({ slot: 'accent', factor: 0.45, map: flowB }), root);

  // --- 枪尖光点、点光源、环绕的光粒 ---
  glow.halo(root, [0, tipY - 0.02, 0], 1, 'main', 1.2);
  glow.halo(root, [0, tipY - 0.02, 0], 0.4, 'accent', 1.6);
  glow.halo(root, [0, headY - 0.1, 0], 0.75, 'main', 0.5);
  glow.halo(root, [0, (y0 + y1) / 2, 0], 0.6, 'main', 0.35);
  glow.light(root, [0, headY, 0.05]);
  glow.particles(root, {
    count: c.glow.particleCount,
    size: 0.04,
    mode: 'orbit',
    from: [0, headY, 0],
    radius: 0.13,
    speed: 2.2,
  });

  root.scale.setScalar(c.scale);
  return finishWeapon(root, 'spear', glow, { hand: 'right', rotation: [-0.5, 0, 0] });
}

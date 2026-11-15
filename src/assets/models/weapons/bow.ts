// 弓：修长的弓身，弓弦是发光的能量线；搭箭时出现发光箭矢。

import { CatmullRomCurve3, ConeGeometry, CylinderGeometry, Group, OctahedronGeometry, PlaneGeometry, TubeGeometry, Vector3, type Object3D } from 'three';
import { WEAPONS } from '../../../data/weapons';
import { leatherMaterial, plateMaterial } from '../../materials';
import { energyFlowTexture } from '../../textures/sprites';
import { mesh } from '../characters/parts';
import { ownTexture, WEAPON_RIM, type WeaponBaseParams } from './common';
import { finishWeapon, glowMesh, WeaponGlow } from './glow';

export interface BowParams extends WeaponBaseParams {
  length: number; // 弓的总长
  depth: number; // 弓背到弓弦的距离
  arrowNocked: boolean; // 是否显示搭在弦上的发光箭矢
  limbColor: number;
  trimColor: number;
  gripColor: number;
}

export const BOW_DEFAULTS: BowParams = {
  scale: 1,
  rim: WEAPON_RIM,
  glow: WEAPONS.bow.glow,
  length: 1.36,
  depth: 0.2,
  arrowNocked: false,
  limbColor: 0x2e2a26,
  trimColor: 0x9a7c3a,
  gripColor: 0x4a3222,
};

const ARROW_KEY = 'bowArrow';

/**
 * 约定：弓身沿 y，握把在原点，弓背朝 +z（朝向目标），弓弦在 −z 一侧；箭沿 +z。
 */
export function buildBowWithGlow(params: Partial<BowParams> = {}): Group {
  const c = { ...BOW_DEFAULTS, ...params };
  const root = new Group();
  const glow = new WeaponGlow(c.glow, 53);
  const limb = leatherMaterial({ color: c.limbColor, rim: c.rim });
  const trim = plateMaterial({ color: c.trimColor, rim: c.rim, metalness: 0.95 });
  const grip = leatherMaterial({ color: c.gripColor, rim: c.rim });

  const half = c.length / 2;
  const d = c.depth;

  // --- 弓臂：从握把向两端后弯，末端略微反翘 ---
  const curve = new CatmullRomCurve3(
    [
      [-half, -d + 0.03],
      [-half * 0.93, -d],
      [-half * 0.6, -d * 0.42],
      [-half * 0.22, -d * 0.04],
      [0, 0],
      [half * 0.22, -d * 0.04],
      [half * 0.6, -d * 0.42],
      [half * 0.93, -d],
      [half, -d + 0.03],
    ].map(([y, z]) => new Vector3(0, y!, z!)),
  );
  const limbs = mesh(new TubeGeometry(curve, 48, 0.013, 6), limb, root);
  limbs.scale.x = 1.7; // 弓臂压成扁片
  // 握把缠皮、上下金属护片、弓梢
  mesh(new CylinderGeometry(0.021, 0.021, 0.2, 8), grip, root).scale.x = 1.25;
  for (const s of [1, -1]) {
    const plate = mesh(new CylinderGeometry(0.019, 0.024, 0.07, 8), trim, root);
    plate.position.set(0, s * 0.135, -0.004);
    plate.scale.x = 1.3;
    const tip = mesh(new ConeGeometry(0.016, 0.07, 6), trim, root);
    tip.position.set(0, s * (half + 0.012), -d + 0.045);
    tip.rotation.x = s * 0.9 + (s < 0 ? Math.PI : 0);
    // 弓梢的小光点（弓弦的系点）
    glowMesh(new OctahedronGeometry(0.013), glow.emissive({ slot: 'accent', factor: 1.2 }), root).position.set(0, s * half * 0.93, -d);
  }
  // 弓臂内侧的发光纹路
  const inlayCurve = new CatmullRomCurve3(curve.getPoints(40).map((p) => new Vector3(0, p.y, p.z + 0.012)));
  const inlayFlow = glow.flow(ownTexture(energyFlowTexture(4), 3, 1), -1, 0);
  glowMesh(new TubeGeometry(inlayCurve, 48, 0.0035, 4), glow.emissive({ factor: 0.4, map: inlayFlow }), root);

  // --- 弓弦：发光的能量线，贴图沿弦流动 ---
  const stringLen = half * 0.93 * 2;
  const stringFlow = glow.flow(ownTexture(energyFlowTexture(8), 1, 2), 0, -1);
  glowMesh(new CylinderGeometry(0.0045, 0.0045, stringLen, 6), glow.emissive({ factor: 1.2, map: stringFlow }), root).position.z = -d;

  // --- 发光箭矢：箭杆、箭镞、尾羽，整体可显示/隐藏 ---
  const arrow = new Group();
  arrow.name = 'arrow';
  const arrowLen = 0.78;
  const shaft = glowMesh(new CylinderGeometry(0.0055, 0.0055, arrowLen, 6), glow.emissive({ factor: 0.6 }), arrow);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -d + arrowLen / 2;
  const head = glowMesh(new ConeGeometry(0.02, 0.085, 4), glow.emissive({ slot: 'accent', factor: 1.8 }), arrow);
  head.rotation.x = Math.PI / 2;
  head.position.z = -d + arrowLen + 0.035;
  const featherMat = glow.emissive({ factor: 0.7, doubleSide: true });
  for (let i = 0; i < 3; i++) {
    const feather = glowMesh(new PlaneGeometry(0.03, 0.1), featherMat, arrow);
    const pivot = new Group();
    pivot.rotation.z = (i / 3) * Math.PI * 2 + Math.PI / 2;
    pivot.position.z = -d + 0.085;
    feather.rotation.x = Math.PI / 2;
    feather.position.x = 0.018;
    pivot.add(feather);
    arrow.add(pivot);
  }
  glow.halo(arrow, [0, 0, -d + arrowLen + 0.03], 0.7, 'accent', 0.6);
  glow.halo(arrow, [0, 0, -d + arrowLen * 0.45], 0.6, 'main', 0.5);
  arrow.visible = c.arrowNocked;
  root.add(arrow);
  root.userData[ARROW_KEY] = arrow;

  // --- 弓弦辉光、点光源、沿弦飘散的光点 ---
  glow.halo(root, [0, 0, -d], 1, 'main', 0.5);
  glow.halo(root, [0, half * 0.6, -d], 0.7, 'main', 0.3);
  glow.halo(root, [0, -half * 0.6, -d], 0.7, 'main', 0.3);
  glow.light(root, [0, 0, -d * 0.5]);
  glow.particles(root, {
    count: c.glow.particleCount,
    size: 0.04,
    mode: 'rise',
    from: [0, -half * 0.85, -d],
    to: [0, half * 0.85, -d],
    speed: 0.12,
    spread: 0.05,
    life: 1.6,
  });

  root.scale.setScalar(c.scale);
  return finishWeapon(root, 'bow', glow, { hand: 'left', rotation: [-1.05, 0, -0.28] });
}

/** 显示或隐藏搭在弦上的发光箭矢（拉弓动画调用） */
export function setBowArrowVisible(bow: Object3D, visible: boolean): void {
  const arrow = bow.userData[ARROW_KEY] as Object3D | undefined;
  if (arrow) arrow.visible = visible;
}

// 弓：修长的弓身，弓背弓腹各有一条发光边线，弓弦是发光的能量线；搭箭时出现发光箭矢。
// 步骤 11b：弓弦分成上下两段，拉弓时中点跟着拉弦手移动、两段分别连到两个弓梢（拉成 V 形）；
// 弓臂整体按拉弓程度向后弯（setBowDraw）；搭着的箭随弦的中点一起后移。

import { CatmullRomCurve3, ConeGeometry, CylinderGeometry, Group, OctahedronGeometry, PlaneGeometry, Quaternion, TubeGeometry, Vector3, type Object3D } from 'three';
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
const RIG_KEY = 'bowRig';

/** 拉弓用到的节点：弓臂组（整体弯曲）、上下两段弓弦、箭 */
interface BowRig {
  limbs: Object3D;
  top: Object3D;
  bottom: Object3D;
  arrow: Object3D;
  half: number; // 弓梢到握把的距离（弓弦系点，未弯曲时）
  depth: number; // 弓弦到握把的距离（未拉时）
}

/** 拉满时弓臂弯曲的程度：弓梢向后多走 depth 的这么多倍、向中间收这么多比例 */
const BEND = { back: 0.9, inward: 0.06 };

/**
 * 约定：弓身沿 y，握把在原点，弓背朝 +z（朝向目标），弓弦在 −z 一侧；箭沿 +z。
 */
export function buildBowWithGlow(params: Partial<BowParams> = {}): Group {
  const c = { ...BOW_DEFAULTS, ...params };
  const root = new Group();
  const glow = new WeaponGlow(c.glow, 53);
  const limb = glow.edge(leatherMaterial({ color: c.limbColor, rim: c.rim }), 1, 'main', 3.0);
  const trim = glow.edge(plateMaterial({ color: c.trimColor, rim: c.rim, metalness: 0.95 }), 0.7, 'main', 2.2);
  const grip = leatherMaterial({ color: c.gripColor, rim: c.rim });

  const half = c.length / 2;
  const d = c.depth;
  // 弓臂和弓梢上的部件都放进 limbs 组：拉弓时整组沿前后方向拉伸，看起来就是弓臂向后弯
  const limbsGroup = new Group();
  limbsGroup.name = 'bowLimbs';
  root.add(limbsGroup);

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
  const limbs = mesh(new TubeGeometry(curve, 48, 0.013, 6), limb, limbsGroup);
  limbs.scale.x = 1.7; // 弓臂压成扁片
  // 握把缠皮、上下金属护片、弓梢
  mesh(new CylinderGeometry(0.021, 0.021, 0.2, 8), grip, root).scale.x = 1.25;
  for (const s of [1, -1]) {
    const plate = mesh(new CylinderGeometry(0.019, 0.024, 0.07, 8), trim, root);
    plate.position.set(0, s * 0.135, -0.004);
    plate.scale.x = 1.3;
    const tip = mesh(new ConeGeometry(0.016, 0.07, 6), trim, limbsGroup);
    tip.position.set(0, s * (half + 0.012), -d + 0.045);
    tip.rotation.x = s * 0.9 + (s < 0 ? Math.PI : 0);
    // 弓梢的小光点（弓弦的系点）
    glowMesh(new OctahedronGeometry(0.013), glow.emissive({ slot: 'accent', factor: 1.2 }), limbsGroup).position.set(0, s * half * 0.93, -d);
  }
  // 弓臂边缘的发光线：弓背、弓腹各一条，沿弓身流动
  const inlayFlow = glow.flow(ownTexture(energyFlowTexture(4), 3, 1), -1, 0);
  const inlayMat = glow.emissive({ factor: 0.85, map: inlayFlow });
  for (const dz of [0.013, -0.013]) {
    const inlayCurve = new CatmullRomCurve3(curve.getPoints(40).map((p) => new Vector3(0, p.y, p.z + dz)));
    glowMesh(new TubeGeometry(inlayCurve, 48, 0.0032, 4), inlayMat, limbsGroup);
  }

  // --- 弓弦：发光的能量线，贴图沿弦流动。上下两段各从弓梢连到弦的中点（未拉时两段连成一条直线）---
  const stringFlow = glow.flow(ownTexture(energyFlowTexture(8), 1, 1), 0, -1);
  const stringMat = glow.emissive({ factor: 1.2, map: stringFlow });
  const segment = new CylinderGeometry(0.0045, 0.0045, 1, 6).translate(0, 0.5, 0); // 从原点沿 +y 长 1 米，按长度缩放
  const top = new Group();
  top.name = 'bowStringTop';
  const bottom = new Group();
  bottom.name = 'bowStringBottom';
  for (const g of [top, bottom]) {
    glowMesh(segment, stringMat, g);
    root.add(g);
  }

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
  const rig: BowRig = { limbs: limbsGroup, top, bottom, arrow, half: half * 0.93, depth: d };
  root.userData[RIG_KEY] = rig;
  layString(rig, new Vector3(0, 0, -d), 0);

  // --- 弓弦辉光、点光源、沿弦飘散的光点 ---
  // 只在两个弓梢留一点小光晕，握把附近不放光晕，不遮住弓身和手
  glow.halo(limbsGroup, [0, half * 0.93, -d], 1, 'main', 1);
  glow.halo(limbsGroup, [0, -half * 0.93, -d], 1, 'main', 1);
  glow.light(root, [0, half * 0.5, 0.3]); // 放在弓背前上方，离手和身体远一点，不把握弓的手照得过曝
  glow.particles(root, {
    count: c.glow.particleCount,
    size: 0.025,
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

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** 按弦的中点 nock（弓的局部坐标）和弯曲程度 bend（0~1）摆好弓臂、两段弓弦和箭 */
function layString(rig: BowRig, nock: Vector3, bend: number): void {
  const k = Math.max(0, Math.min(1, bend));
  // 弓臂：前后方向拉伸（弓梢向后），上下方向略收
  rig.limbs.scale.set(1, 1 - BEND.inward * k, 1 + BEND.back * k);
  const tipY = rig.half * (1 - BEND.inward * k);
  const tipZ = -rig.depth * (1 + BEND.back * k);
  for (const [seg, sign] of [[rig.top, 1], [rig.bottom, -1]] as const) {
    const tip = tmpA.set(0, sign * tipY, tipZ);
    const dir = tmpB.subVectors(nock, tip);
    const len = Math.max(1e-4, dir.length());
    seg.position.copy(tip);
    seg.quaternion.copy(tmpQ.setFromUnitVectors(UP, dir.multiplyScalar(1 / len)));
    seg.scale.set(1, len, 1);
  }
  // 箭尾搭在弦的中点上
  rig.arrow.position.set(nock.x, nock.y, nock.z + rig.depth);
}

/**
 * 拉弓（步骤 11b）：nock 是弦的中点在弓的局部坐标里的位置（null = 松弦，回到未拉的直线），
 * 弓臂按拉开的距离向后弯。每帧由 UnitView 根据拉弦手的位置调用。返回实际用到的弦中点（已限制在合理范围内）。
 */
export function setBowDraw(bow: Object3D, nock: Vector3 | null, maxPull: number): Vector3 | null {
  const rig = bow.userData[RIG_KEY] as BowRig | undefined;
  if (!rig) return null;
  const rest = tmpA.set(0, 0, -rig.depth);
  const at = nock ? nock.clone() : rest.clone();
  // 只允许沿箭的方向前后移动，左右上下贴近中线；最远拉开 maxPull，最多向前弹出一点（松弦回弹）
  at.x = Math.max(-0.04, Math.min(0.04, at.x));
  at.y = Math.max(-0.06, Math.min(0.06, at.y));
  at.z = Math.max(-rig.depth - maxPull, Math.min(-rig.depth + 0.08, at.z));
  const pulled = Math.max(0, -rig.depth - at.z);
  layString(rig, at, pulled / Math.max(1e-4, maxPull));
  return at;
}

/** 可以拉弦的弓：返回未拉时弓弦到握把的距离（弓的局部坐标）；不是弓返回 undefined */
export function bowStringDepth(weapon: Object3D): number | undefined {
  return (weapon.userData[RIG_KEY] as BowRig | undefined)?.depth;
}

/** 显示或隐藏搭在弦上的发光箭矢（拉弓动画调用） */
export function setBowArrowVisible(bow: Object3D, visible: boolean): void {
  const arrow = bow.userData[ARROW_KEY] as Object3D | undefined;
  if (arrow) arrow.visible = visible;
}

// 单位占位体：步骤 4 做出正式角色模型之前，用简单几何体标出站位、朝向、敌我和职业。
// 模型默认面朝 +z，由调用方按阵营旋转。

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Sprite,
  SpriteMaterial,
} from 'three';
import type { Side, UnitKind } from '../../core/types';
import { stoneTextures } from '../textures/surfaces';
import { placeholderBarTexture } from '../textures/sprites';

export interface PlaceholderParams {
  side: Side;
  kind: UnitKind;
  height: number; // 占位体总高度（已包含宝宝 / Boss 的缩放）
  bodyColor: number; // 职业颜色
  sideColor: number; // 敌我颜色（底座和朝向标记）
  hpBarGap: number; // 血条离头顶的距离
}

/** 占位体上预留的挂点名称，步骤 5 用它定位头顶血条 */
export const HP_ANCHOR_NAME = 'hpAnchor';

/** 占位血条精灵（友方多一条魔法条）。步骤 5 接入战斗后换成可变长度的正式血条 */
export function createPlaceholderBar(side: Side): Sprite {
  const bar = new Sprite(
    new SpriteMaterial({
      map: placeholderBarTexture(side === 'ally'),
      depthWrite: false,
      transparent: true,
      fog: false,
    }),
  );
  bar.scale.set(1.25, 0.31, 1);
  return bar;
}

export function buildPlaceholderUnit(params: PlaceholderParams): Group {
  const { side, kind, height, bodyColor, sideColor, hpBarGap } = params;
  const group = new Group();
  group.name = 'placeholderUnit';
  const k = height / 1.8; // 相对人物的比例
  const tex = stoneTextures();

  // 底座：发光的敌我色圆盘
  const baseMat = new MeshStandardMaterial({
    color: 0x101010,
    emissive: new Color(sideColor),
    emissiveIntensity: 0.9,
    roughness: 0.6,
  });
  const base = new Mesh(new CylinderGeometry(0.62 * k, 0.7 * k, 0.07, 24), baseMat);
  base.position.y = 0.035;
  base.receiveShadow = true;
  group.add(base);

  // 身体：职业颜色。友方人物 = 方柱，宝宝 = 矮方块，敌方 = 四棱台（一眼能分出敌我）
  const bodyMat = new MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.75,
    metalness: 0.15,
    normalMap: tex.normalMap,
  });
  const bodyH = height * 0.78;
  const body =
    side === 'enemy'
      ? new Mesh(new CylinderGeometry(0.3 * k, 0.56 * k, bodyH, 4), bodyMat)
      : new Mesh(new BoxGeometry(0.78 * k, bodyH, (kind === 'pet' ? 0.95 : 0.5) * k), bodyMat);
  if (side === 'enemy') body.rotation.y = Math.PI / 4;
  body.position.y = 0.07 + bodyH / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 头：深色小方块
  const headSize = height * 0.2;
  const head = new Mesh(
    new BoxGeometry(headSize, headSize, headSize),
    new MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.6, metalness: 0.3 }),
  );
  head.position.y = 0.07 + bodyH + headSize / 2;
  head.castShadow = true;
  group.add(head);

  // 朝向标记：胸前指向 +z 的发光锥体
  const nose = new Mesh(
    new ConeGeometry(0.13 * k, 0.42 * k, 4),
    new MeshStandardMaterial({ color: 0x101010, emissive: new Color(sideColor), emissiveIntensity: 1.4 }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.07 + bodyH * 0.7, 0.42 * k);
  group.add(nose);

  // 头顶血条挂点 + 占位血条（友方多一条魔法条）
  const anchor = new Object3D();
  anchor.name = HP_ANCHOR_NAME;
  anchor.position.y = height + hpBarGap;
  const bar = createPlaceholderBar(side);
  anchor.add(bar);
  group.add(anchor);

  return group;
}

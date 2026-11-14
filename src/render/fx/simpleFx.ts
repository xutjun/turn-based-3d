// 步骤 5 的基础光效：飞行的箭矢 / 光弹、命中闪光、落下或升起的光柱。
// 只用精灵和简单几何体，全部通过 Scheduler 播放；华丽的技能特效在步骤 7 再做。

import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Object3D,
} from 'three';
import { glowTexture } from '../../assets/textures/sprites';
import { EASE, type Scheduler } from '../director/Scheduler';
import type { BurstKind, Point3, ProjectileKind } from '../director/types';

const UP = new Vector3(0, 1, 0);

function glowSprite(color: number, size: number): Sprite {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}

/** 释放一个特效节点占用的材质和几何体（共享的光晕贴图不释放） */
function disposeFx(node: Object3D): void {
  node.removeFromParent();
  node.traverse((o) => {
    const m = o as Mesh | Sprite;
    if ('geometry' in m && m.type === 'Mesh') m.geometry.dispose();
    const mat = (m as Mesh).material;
    if (mat && !Array.isArray(mat)) mat.dispose();
  });
}

export class SimpleFx {
  readonly group = new Group();

  constructor(private readonly scheduler: Scheduler) {
    this.group.name = 'fx';
  }

  /** 箭矢或光弹从 from 飞到 to，带一点抛物线 */
  async projectile(kind: ProjectileKind, from: Point3, to: Point3, color: number, duration: number): Promise<void> {
    const node = new Group();
    const a = new Vector3(from.x, from.y, from.z);
    const b = new Vector3(to.x, to.y, to.z);
    const dir = b.clone().sub(a);
    const arc = kind === 'arrow' ? Math.min(0.6, dir.length() * 0.05) : 0.25;
    if (kind === 'arrow') {
      // 细长的发光箭杆，沿飞行方向摆放
      const shaft = new Mesh(
        new CylinderGeometry(0.018, 0.018, 0.8, 5),
        new MeshBasicMaterial({ color, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      );
      shaft.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
      node.add(shaft, glowSprite(color, 0.55));
    } else {
      node.add(glowSprite(color, 0.9), glowSprite(0xffffff, 0.35));
    }
    this.group.add(node);
    await this.scheduler.tween(duration, (t) => {
      node.position.lerpVectors(a, b, t);
      node.position.y += Math.sin(Math.PI * t) * arc;
    });
    disposeFx(node);
  }

  /** 命中闪光 / 落下的光柱 / 升起的光柱 */
  async burst(kind: BurstKind, at: Point3, color: number, duration: number): Promise<void> {
    const node = new Group();
    node.position.set(at.x, at.y, at.z);
    this.group.add(node);
    if (kind === 'impact') {
      const flash = glowSprite(color, 0.4);
      node.add(flash);
      await this.scheduler.tween(duration, (t) => {
        flash.scale.setScalar(0.4 + 1.3 * EASE.out(t));
        flash.material.opacity = 1 - t;
      });
    } else {
      const height = 3.2;
      const pillar = new Mesh(
        new CylinderGeometry(0.34, 0.42, height, 14, 1, true),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false }),
      );
      const glow = glowSprite(color, 1.8);
      glow.position.y = 0.4;
      node.add(pillar, glow);
      const down = kind === 'pillarDown';
      await this.scheduler.tween(duration, (t) => {
        // 落下：从高处压到地面；升起：从地面长高
        const grow = EASE.out(t);
        pillar.scale.set(1 - 0.5 * t, Math.max(0.02, down ? 1 : grow), 1 - 0.5 * t);
        pillar.position.y = down ? height * (1.5 - grow) : (height * grow) / 2;
        pillar.material.opacity = 0.55 * (1 - t * t);
        glow.material.opacity = down ? grow * (1 - t * t) + 0.2 : 1 - t;
        glow.scale.setScalar(1.2 + 1.2 * t);
      });
    }
    disposeFx(node);
  }
}

// 战场：暗色石板地面 + 周围的石柱、碎石、骨堆、火盆、旗帜。
// 所有物件都通过资源注册表创建；位置在 data/battlefieldLayout.ts（步骤 15 抽出，探索模式的碰撞 / 寻路读同一份）。

import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector2 } from 'three';
import { createRng, randRange } from '../../core/rng';
import type { AssetRegistry } from '../../assets/AssetRegistry';
import type {
  BannerParams,
  BonePileParams,
  BrazierParams,
  PillarParams,
  RubbleParams,
} from '../../assets/models/props';
import { ASSET_KEYS } from '../../assets/registerDefaults';
import { groundTextures } from '../../assets/textures/surfaces';
import { BATTLEFIELD_LAYOUT, DRUM_RADIUS, PILLAR_RADIUS } from '../../data/battlefieldLayout';
import { FORMATION } from '../../data/formation';
import { BATTLEFIELD_CONFIG, LIGHT_CONFIG, RENDER_OPTIMIZE } from '../../data/renderConfig';
import { mergeStaticMeshes } from '../../assets/optimize';

function createGround(): Mesh {
  const tex = groundTextures();
  const repeat = BATTLEFIELD_CONFIG.groundTextureRepeat;
  for (const t of [tex.map, tex.normalMap, tex.roughnessMap]) t.repeat.set(repeat, repeat);
  const mat = new MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    roughnessMap: tex.roughnessMap,
    normalScale: new Vector2(1.6, 1.6),
    roughness: 1,
    metalness: 0,
  });
  const size = BATTLEFIELD_CONFIG.groundSize;
  const ground = new Mesh(new PlaneGeometry(size, size), mat);
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

/** 该位置是否会挡住站位或中间的冲锋通道 */
function blocksBattleArea(x: number, z: number): boolean {
  const a = FORMATION.allyFrontCenter;
  const e = FORMATION.enemyFrontCenter;
  const nearAlly = Math.hypot(x - a.x - 0.7, z - a.z - 0.7) < 7;
  const nearEnemy = Math.hypot(x - e.x + 0.7, z - e.z + 0.7) < 7;
  return nearAlly || nearEnemy || Math.hypot(x, z) < 5;
}

export function createBattlefield(registry: AssetRegistry): Group {
  const group = new Group();
  group.name = 'battlefield';
  group.add(createGround());

  const rng = createRng(BATTLEFIELD_CONFIG.seed);
  const place = (obj: Group['children'][number], x: number, z: number, rotY = 0, scale = 1): void => {
    obj.position.set(x, 0, z);
    obj.rotation.y = rotY;
    obj.scale.setScalar(scale);
    group.add(obj);
  };

  // --- 残破石柱：主要立在战场后方和两侧，不遮挡站位 ---
  const pillars = BATTLEFIELD_LAYOUT.pillars;
  pillars.forEach((p, i) => {
    const params: PillarParams = {
      drums: p.drums,
      radius: p.radius ?? PILLAR_RADIUS,
      drumHeight: 1.15,
      broken: p.broken,
      seed: 100 + i,
    };
    place(registry.create(ASSET_KEYS.pillar, params), p.x, p.z, rng.next() * Math.PI);
  });

  // --- 倒地的断柱 ---
  const drums = BATTLEFIELD_LAYOUT.drums;
  drums.forEach((d, i) => {
    place(registry.create(ASSET_KEYS.fallenDrum, { radius: DRUM_RADIUS, length: d.len, seed: 200 + i }), d.x, d.z, d.rot);
  });

  // --- 火盆（自带闪烁的暖色点光源） ---
  BATTLEFIELD_LAYOUT.braziers.forEach((b, i) => {
    const c = LIGHT_CONFIG.brazier;
    const params: BrazierParams = {
      lightColor: c.color,
      lightIntensity: c.intensity,
      lightDistance: c.distance,
      lightDecay: c.decay,
      lightHeight: c.height,
      flicker: c.flicker,
      glow: c.glow,
      flickerSpeed: c.flickerSpeed,
      seed: 300 + i,
    };
    place(registry.create(ASSET_KEYS.brazier, params), b.x, b.z, rng.next() * Math.PI);
  });

  // --- 旗帜 ---
  const banners = BATTLEFIELD_LAYOUT.banners;
  banners.forEach((b, i) => {
    const params: BannerParams = { poleHeight: 5.2, clothWidth: 1.35, clothHeight: 2.9, seed: 400 + i };
    place(registry.create(ASSET_KEYS.banner, params), b.x, b.z, b.rot);
  });

  // --- 骨堆 ---
  const bonePiles = BATTLEFIELD_LAYOUT.bonePiles;
  bonePiles.forEach((b, i) => {
    const params: BonePileParams = { bones: 16, skulls: 3, radius: 1.1, seed: 500 + i };
    place(registry.create(ASSET_KEYS.bonePile, params), b.x, b.z, rng.next() * Math.PI);
  });

  // --- 碎石：石柱脚下各一堆，外加随机散布（避开站位和中间通道） ---
  pillars.forEach((p, i) => {
    const params: RubbleParams = { count: 14, radius: 1.9, minSize: 0.12, maxSize: 0.42, seed: 600 + i };
    place(registry.create(ASSET_KEYS.rubble, params), p.x + 0.6, p.z + 0.5);
  });
  let placed = 0;
  for (let attempt = 0; attempt < 200 && placed < 22; attempt++) {
    const ang = rng.next() * Math.PI * 2;
    const dist = randRange(rng, 6, 21);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    if (blocksBattleArea(x, z)) continue;
    const params: RubbleParams = {
      count: 6 + Math.floor(rng.next() * 9),
      radius: randRange(rng, 0.7, 1.8),
      minSize: 0.08,
      maxSize: randRange(rng, 0.2, 0.5),
      seed: 700 + attempt,
    };
    place(registry.create(ASSET_KEYS.rubble, params), x, z);
    placed += 1;
  }

  // 场景物件都是静止的：按材质合并成少数几个网格（火焰、旗面等会动的部分由优化器自动保留）
  if (RENDER_OPTIMIZE.mergeStaticMeshes) mergeStaticMeshes(group, { isStatic: () => true, shadowLayer: RENDER_OPTIMIZE.shadowLayer });
  return group;
}

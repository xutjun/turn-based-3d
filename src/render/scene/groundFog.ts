// 贴地流动的雾片：用若干大号半透明烟雾精灵缓慢漂移，模拟轻微的体积雾。

import { Group, Sprite, SpriteMaterial } from 'three';
import { setTick } from '../../assets/AssetRegistry';
import { smokeTexture } from '../../assets/textures/sprites';
import { createRng, randRange } from '../../core/rng';
import { FOG_CONFIG } from '../../data/renderConfig';

export function createGroundFog(config = FOG_CONFIG.ground): Group {
  const group = new Group();
  group.name = 'groundFog';
  const rng = createRng(77);
  const map = smokeTexture();
  const puffs: { sprite: Sprite; baseX: number; speed: number; phase: number; opacity: number }[] = [];

  for (let i = 0; i < config.count; i++) {
    const mat = new SpriteMaterial({
      map,
      color: config.color,
      transparent: true,
      opacity: config.opacity,
      depthWrite: false,
      rotation: rng.next() * Math.PI * 2,
    });
    const sprite = new Sprite(mat);
    const size = config.size * randRange(rng, 0.7, 1.4);
    sprite.scale.set(size, size * 0.55, 1);
    const baseX = randRange(rng, -config.radius, config.radius);
    sprite.position.set(baseX, randRange(rng, 0.5, 1.6), randRange(rng, -config.radius, config.radius * 0.6));
    puffs.push({
      sprite,
      baseX,
      speed: config.speed * randRange(rng, 0.5, 1.4),
      phase: rng.next() * 10,
      opacity: config.opacity * randRange(rng, 0.6, 1.3),
    });
    group.add(sprite);
  }

  const span = config.radius * 2;
  setTick(group, (time) => {
    for (const p of puffs) {
      // 沿 x 方向缓慢漂移，漂出范围后从另一侧回来；两端淡出避免突然出现
      const x = ((p.baseX + config.radius + time * p.speed) % span) - config.radius;
      p.sprite.position.x = x;
      const edge = Math.min(1, (config.radius - Math.abs(x)) / 5);
      p.sprite.material.opacity = p.opacity * edge * (0.8 + 0.2 * Math.sin(time * 0.4 + p.phase));
    }
  });
  return group;
}

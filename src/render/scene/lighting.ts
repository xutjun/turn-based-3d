// 光照：低饱和冷色环境光 + 冷色月光主光（带阴影）。火盆的暖色点光源由火盆模型自带。

import { DirectionalLight, Group, HemisphereLight } from 'three';
import { LIGHT_CONFIG, RENDER_OPTIMIZE } from '../../data/renderConfig';

export function createLighting(config = LIGHT_CONFIG): Group {
  const group = new Group();
  group.name = 'lighting';

  const hemi = new HemisphereLight(config.hemisphere.sky, config.hemisphere.ground, config.hemisphere.intensity);
  group.add(hemi);

  const moon = new DirectionalLight(config.moon.color, config.moon.intensity);
  moon.position.set(config.moon.position.x, config.moon.position.y, config.moon.position.z);
  moon.castShadow = true;
  moon.shadow.mapSize.set(config.moon.shadowMapSize, config.moon.shadowMapSize);
  const a = config.moon.shadowArea;
  moon.shadow.camera.left = -a;
  moon.shadow.camera.right = a;
  moon.shadow.camera.top = a;
  moon.shadow.camera.bottom = -a;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 80;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.04;
  // 阴影只画阴影图层上的物体（见 assets/optimize.ts 的阴影代理）
  moon.shadow.camera.layers.set(RENDER_OPTIMIZE.shadowLayer);
  group.add(moon, moon.target);
  return group;
}

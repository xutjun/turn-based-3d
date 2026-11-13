// 程序化环境贴图：金属材质需要“能反射到的东西”才不会一片死黑。
// 这里用代码搭一个很暗的小场景（冷色天光、暖色火光、深色地面），烘焙成环境贴图，
// 让铁甲、金饰上出现冷暖两色的反光。不使用任何外部 HDR 图片。

import {
  BackSide,
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { ENVIRONMENT_CONFIG } from '../data/renderConfig';

export function createEnvironmentMap(renderer: WebGLRenderer, config = ENVIRONMENT_CONFIG): Texture {
  const scene = new Scene();
  const panel = (color: number, intensity: number, w: number, h: number, x: number, y: number, z: number): void => {
    const m = new Mesh(
      new BoxGeometry(w, h, 0.1),
      new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  // 四周和地面：近黑
  scene.add(
    new Mesh(new SphereGeometry(30, 16, 12), new MeshBasicMaterial({ color: config.ambient, side: BackSide })),
  );
  // 头顶的冷色天光、侧面的暖色火光、背后的冷色轮廓光
  panel(config.sky.color, config.sky.intensity, 26, 26, -4, 20, 4);
  panel(config.fire.color, config.fire.intensity, 7, 9, 16, 3, 8);
  panel(config.fire.color, config.fire.intensity * 0.6, 5, 6, -15, 2, 10);
  panel(config.back.color, config.back.intensity, 12, 10, -6, 6, -18);

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  });
  return target.texture;
}

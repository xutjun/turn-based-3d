// 2.5D 战斗相机：固定角度斜俯视，小 FOV 透视或正交，参数全部来自配置。

import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_CONFIG } from '../../data/renderConfig';

export type BattleCameraConfig = typeof CAMERA_CONFIG;

export interface BattleCamera {
  camera: PerspectiveCamera | OrthographicCamera;
  /** 窗口尺寸变化时调用：更新宽高比；窗口太窄时自动放大可见范围，保证双方阵型都在画面内 */
  resize(width: number, height: number): void;
}

const DEG = Math.PI / 180;

export function createBattleCamera(config: BattleCameraConfig = CAMERA_CONFIG): BattleCamera {
  const target = new Vector3(config.target.x, config.target.y, config.target.z);
  const el = config.elevationDeg * DEG;
  const az = config.azimuthDeg * DEG;
  // 从注视点指向相机的单位方向：方位角 0 时相机在 +z 一侧
  const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));

  const camera =
    config.type === 'orthographic'
      ? new OrthographicCamera(-1, 1, 1, -1, config.near, config.far)
      : new PerspectiveCamera(config.fov, 1, config.near, config.far);

  const place = (distance: number): void => {
    camera.position.copy(target).addScaledVector(dir, distance);
    camera.lookAt(target);
  };
  place(config.distance);

  return {
    camera,
    resize(width: number, height: number): void {
      const aspect = width / Math.max(1, height);
      // 窗口比 fitAspect 更窄时，按比例放大可见范围
      const widen = Math.max(1, config.fitAspect / aspect);
      if (camera instanceof PerspectiveCamera) {
        camera.aspect = aspect;
        // 不拉远相机（否则雾会变浓、画面变暗），而是等比放大视角
        camera.fov = (2 * Math.atan(Math.tan((config.fov * DEG) / 2) * widen)) / DEG;
      } else {
        const h = config.orthoHeight * widen;
        camera.top = h / 2;
        camera.bottom = -h / 2;
        camera.left = (-h * aspect) / 2;
        camera.right = (h * aspect) / 2;
        place(config.distance);
      }
      camera.updateProjectionMatrix();
    },
  };
}

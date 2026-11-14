// 2.5D 战斗相机：固定角度斜俯视，小 FOV 透视或正交，参数全部来自配置。

import { OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_CONFIG } from '../../data/renderConfig';

export type BattleCameraConfig = typeof CAMERA_CONFIG;

export interface BattleCamera {
  camera: PerspectiveCamera | OrthographicCamera;
  /** 窗口尺寸变化时调用：更新宽高比；窗口太窄时自动放大可见范围，保证双方阵型都在画面内 */
  resize(width: number, height: number): void;
  /**
   * 演出用的镜头偏移（步骤 7）：在固定机位的基础上平移、推近、抖动，全部为 0 / 1 时就是原始机位。
   * @param panX 注视点在地面上的平移（世界坐标 x）
   * @param panZ 注视点在地面上的平移（世界坐标 z）
   * @param zoom 推近倍率（1 = 不推近）
   * @param shakeX 沿画面水平方向的抖动（米）
   * @param shakeY 沿画面垂直方向的抖动（米）
   */
  setView(panX: number, panZ: number, zoom: number, shakeX: number, shakeY: number): void;
  /** 注视点（未偏移时）在地面上的位置 */
  readonly target: { x: number; z: number };
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

  // 演出偏移：平移、推近、抖动
  const view = { panX: 0, panZ: 0, zoom: 1, shakeX: 0, shakeY: 0 };
  const look = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const place = (distance: number): void => {
    look.set(target.x + view.panX, target.y, target.z + view.panZ);
    // 透视相机靠拉近距离来推近；正交相机用 zoom
    const d = camera instanceof PerspectiveCamera ? distance / view.zoom : distance;
    camera.position.copy(look).addScaledVector(dir, d);
    camera.lookAt(look);
    if (view.shakeX !== 0 || view.shakeY !== 0) {
      // 抖动是整体平移（不改变朝向），沿画面的水平、垂直方向
      camera.updateMatrix();
      right.setFromMatrixColumn(camera.matrix, 0);
      up.setFromMatrixColumn(camera.matrix, 1);
      camera.position.addScaledVector(right, view.shakeX).addScaledVector(up, view.shakeY);
    }
    if (camera instanceof OrthographicCamera && camera.zoom !== view.zoom) {
      camera.zoom = view.zoom;
      camera.updateProjectionMatrix();
    }
  };
  place(config.distance);

  return {
    camera,
    target: { x: target.x, z: target.z },
    setView(panX: number, panZ: number, zoom: number, shakeX: number, shakeY: number): void {
      view.panX = panX;
      view.panZ = panZ;
      view.zoom = Math.max(0.2, zoom);
      view.shakeX = shakeX;
      view.shakeY = shakeY;
      place(config.distance);
    },
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

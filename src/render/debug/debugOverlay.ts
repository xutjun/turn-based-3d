// 调试开关：显示网格坐标（G 键）、显示 FPS（F 键）。
// 也可以用地址参数控制初始状态：?grid=1 打开网格，?fps=0 关闭 FPS。

import {
  AxesHelper,
  BufferGeometry,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineLoop,
  Sprite,
  SpriteMaterial,
} from 'three';
import { labelTexture } from '../../assets/textures/sprites';
import type { UnitTemplate } from '../../core/types';
import { FORMATION, facingYawOf, slotPosition } from '../../data/formation';
import { DEBUG_CONFIG, PLACEHOLDER_CONFIG } from '../../data/renderConfig';

/** 网格坐标：世界网格 + 坐标轴 + 每个格子的方框和文字（单位 id、行列、世界坐标） */
function createGridGroup(templates: readonly UnitTemplate[]): Group {
  const group = new Group();
  group.name = 'debugGrid';

  const grid = new GridHelper(40, 40, 0x6a5a3a, 0x2c2c30);
  grid.position.y = 0.02;
  group.add(grid);
  const axes = new AxesHelper(3); // 红 = +x，绿 = +y，蓝 = +z
  axes.position.y = 0.03;
  group.add(axes);

  const half = Math.min(FORMATION.colSpacing, FORMATION.rowSpacing) * 0.45;
  const square = new BufferGeometry();
  square.setAttribute(
    'position',
    new Float32BufferAttribute([-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half], 3),
  );

  for (const t of templates) {
    const pos = slotPosition(t.side, t.slot);
    const color = PLACEHOLDER_CONFIG.sideColor[t.side];
    const box = new LineLoop(square, new LineBasicMaterial({ color }));
    box.position.set(pos.x, 0.04, pos.z);
    box.rotation.y = facingYawOf(t.side);
    group.add(box);

    const label = new Sprite(
      new SpriteMaterial({
        map: labelTexture([
          `${t.id} 排${t.slot.row} 列${t.slot.col}`,
          `(${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})`,
        ]),
        depthTest: false,
        transparent: true,
        fog: false,
      }),
    );
    label.scale.set(2.3, 0.76, 1);
    label.position.set(pos.x, 0.25, pos.z + 0.75); // 放在单位脚下靠近相机的一侧
    label.renderOrder = 10;
    group.add(label);
  }
  return group;
}

export interface DebugOverlay {
  grid: Group;
  /** 每帧调用，统计 FPS */
  frame(nowMs: number): void;
  /** 最近一次统计的 FPS */
  getFps(): number;
  dispose(): void;
}

export function createDebugOverlay(container: HTMLElement, templates: readonly UnitTemplate[]): DebugOverlay {
  const query = new URLSearchParams(location.search);
  const flag = (name: string, fallback: boolean): boolean => {
    const v = query.get(name);
    return v === null ? fallback : v !== '0' && v !== 'false';
  };
  let showGrid = flag('grid', DEBUG_CONFIG.showGrid);
  let showFps = flag('fps', DEBUG_CONFIG.showFps);

  const grid = createGridGroup(templates);
  grid.visible = showGrid;

  // FPS 文字（调试用的简单 DOM 元素，不属于正式界面）
  const hud = document.createElement('div');
  hud.style.cssText =
    'position:absolute;left:10px;top:8px;padding:4px 10px;pointer-events:none;' +
    'font:14px/1.5 "Times New Roman","Songti SC",serif;color:#d8c690;' +
    'background:rgba(8,8,10,0.6);border:1px solid rgba(150,120,70,0.6);white-space:pre;';
  container.appendChild(hud);

  let fps = 0;
  let frames = 0;
  let last = performance.now();
  const refresh = (): void => {
    hud.style.display = showFps ? 'block' : 'none';
    hud.textContent = `FPS ${fps.toFixed(0)}\nG 网格坐标：${showGrid ? '开' : '关'}　F 帧率：开`;
  };
  refresh();

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'g' || e.key === 'G') {
      showGrid = !showGrid;
      grid.visible = showGrid;
    } else if (e.key === 'f' || e.key === 'F') {
      showFps = !showFps;
    } else {
      return;
    }
    refresh();
  };
  addEventListener('keydown', onKey);

  return {
    grid,
    frame(nowMs: number): void {
      frames += 1;
      const elapsed = nowMs - last;
      if (elapsed >= 500) {
        fps = (frames * 1000) / elapsed;
        frames = 0;
        last = nowMs;
        refresh();
      }
    },
    getFps: () => fps,
    dispose(): void {
      removeEventListener('keydown', onKey);
      hud.remove();
    },
  };
}

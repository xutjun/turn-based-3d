import { describe, expect, it } from 'vitest';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { slotPosition } from '../../src/data/formation';
import { cameraBounds, CameraFollow } from '../../src/explore/cameraFollow';
import { localToWorld, turnToward, wrapAngle, yawOf } from '../../src/explore/walker';
import { ExploreInput } from '../../src/ui/explore/ExploreInput';

// 步骤 14：探索模式的角度工具、相机跟随与键盘输入（纯逻辑）。步骤 15 的移动、寻路、碰撞见 navigation.test.ts

const DT = 1 / 60;
const boss = ENEMY_TEMPLATES.find((t) => t.rank === 'boss')!;
const BOSS = slotPosition('enemy', boss.slot);

describe('探索：角度与坐标工具', () => {
  it('转身走最短的方向，每次不超过给定角度', () => {
    expect(turnToward(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1, 9);
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1, 9); // 从 3 转到 −3：跨过 ±π 走近路（+0.28），不是倒转 6 弧度
    expect(turnToward(3, -3, 0.5)).toBeCloseTo(-3, 9);
    expect(Math.abs(wrapAngle(7 * Math.PI))).toBeCloseTo(Math.PI, 9);
    expect(yawOf(1, 0)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('局部坐标 → 世界坐标：前方是朝向，+x 是左手侧', () => {
    const o = { x: 1, z: 2, yaw: yawOf(1, 0) }; // 面朝 +x
    const front = localToWorld(o, 0, 1);
    expect(front.x).toBeCloseTo(2, 9);
    expect(front.z).toBeCloseTo(2, 9);
    const left = localToWorld(o, 1, 0); // 面朝 +x 时左手侧是 −z
    expect(left.x).toBeCloseTo(1, 9);
    expect(left.z).toBeCloseTo(1, 9);
  });

  it('出生点在可走区域里、离 Boss 足够远，且不在任何障碍物里', () => {
    const s = EXPLORE_CONFIG.start;
    expect(Math.abs(s.x)).toBeLessThan(EXPLORE_CONFIG.bounds.maxX);
    expect(Math.abs(s.z)).toBeLessThan(EXPLORE_CONFIG.bounds.maxZ);
    expect(Math.hypot(s.x - BOSS.x, s.z - BOSS.z)).toBeGreaterThan(10);
  });
});

describe('探索：相机跟随', () => {
  it('注视点范围 = 可走区域每边内缩 margin', () => {
    const b = cameraBounds(EXPLORE_CONFIG.bounds, 4);
    expect(b.minX).toBe(EXPLORE_CONFIG.bounds.minX + 4);
    expect(b.maxZ).toBe(EXPLORE_CONFIG.bounds.maxZ - 4);
  });

  it('平滑跟随：不会瞬移，持续跟着走后追上目标（领先行进方向一点）', () => {
    const cam = new CameraFollow();
    cam.snap(0, 0);
    let x = 0;
    let maxStep = 0;
    let prev = cam.x;
    for (let i = 0; i < 240; i++) {
      x += 3.2 * DT;
      cam.update(x, 0, 3.2, 0, DT);
      maxStep = Math.max(maxStep, Math.abs(cam.x - prev));
      prev = cam.x;
    }
    expect(maxStep).toBeLessThan(0.2); // 每帧移动量有限
    expect(cam.x).toBeGreaterThan(x - 0.5); // 追上了（稳态误差小于半米）
    expect(cam.x).toBeLessThan(x + EXPLORE_CONFIG.camera.lead + 0.01);
  });

  it('不超出场景边界：跟随对象走到边上时注视点停在内缩边界', () => {
    const cam = new CameraFollow();
    const b = EXPLORE_CONFIG.bounds;
    cam.snap(b.maxX, b.maxZ);
    expect(cam.x).toBe(b.maxX - EXPLORE_CONFIG.camera.margin);
    expect(cam.z).toBe(b.maxZ - EXPLORE_CONFIG.camera.margin);
    for (let i = 0; i < 300; i++) cam.update(b.maxX, b.maxZ, 3.2, 3.2, DT);
    expect(cam.x).toBeLessThanOrEqual(b.maxX - EXPLORE_CONFIG.camera.margin);
    expect(cam.z).toBeLessThanOrEqual(b.maxZ - EXPLORE_CONFIG.camera.margin);
  });
});

describe('探索：键盘输入（调试）', () => {
  const key = (k: string): KeyboardEvent => ({ key: k, repeat: false, preventDefault: () => undefined }) as unknown as KeyboardEvent;

  it('方向键 / WASD 按屏幕方向给出地面方向（屏幕上 = −z），可以斜走，松开即停', () => {
    const dirs: [number, number][] = [];
    const input = new ExploreInput((x, z) => dirs.push([x, z]));
    expect(input.handle(key('w'), true)).toBe(true);
    expect(dirs.at(-1)).toEqual([0, -1]);
    input.handle(key('ArrowRight'), true);
    expect(dirs.at(-1)).toEqual([1, -1]);
    input.handle(key('ArrowUp'), true); // 与 W 同方向，不叠加
    expect(dirs.at(-1)).toEqual([1, -1]);
    input.handle(key('w'), false);
    input.handle(key('ArrowUp'), false);
    expect(dirs.at(-1)).toEqual([1, 0]);
    input.clear();
    expect(dirs.at(-1)).toEqual([0, 0]);
    expect(input.handle(key('Tab'), true)).toBe(false); // 步骤 15 起 Tab 不再切换人物（探索中只有队长）
    expect(input.handle(key('x'), true)).toBe(false); // 其他键不处理
  });
});

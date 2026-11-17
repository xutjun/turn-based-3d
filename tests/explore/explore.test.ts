import { describe, expect, it } from 'vitest';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { slotPosition } from '../../src/data/formation';
import { cameraBounds, CameraFollow } from '../../src/explore/cameraFollow';
import { Squad, startLineup } from '../../src/explore/squad';
import { createWalker, localToWorld, speedOf, stepWalker, turnToward, wrapAngle, yawOf } from '../../src/explore/walker';
import { ExploreInput } from '../../src/ui/explore/ExploreInput';

// 步骤 14：探索模式的移动、列队、相机跟随与键盘输入（纯逻辑）

const DT = 1 / 60;
const boss = ENEMY_TEMPLATES.find((t) => t.rank === 'boss')!;
const BOSS = slotPosition('enemy', boss.slot);

describe('探索：角色移动', () => {
  it('从静止加速到走速后匀速前进，松手后减速停下', () => {
    const w = createWalker(0, 0, 0);
    stepWalker(w, { x: 1, z: 0 }, DT);
    expect(speedOf(w)).toBeCloseTo(EXPLORE_CONFIG.move.accel * DT, 6); // 第一帧只加速了一点
    for (let i = 0; i < 60; i++) stepWalker(w, { x: 1, z: 0 }, DT);
    expect(speedOf(w)).toBeCloseTo(EXPLORE_CONFIG.move.walkSpeed, 6);
    const x0 = w.x;
    stepWalker(w, { x: 1, z: 0 }, 1);
    expect(w.x - x0).toBeCloseTo(EXPLORE_CONFIG.move.walkSpeed, 6);
    for (let i = 0; i < 60; i++) stepWalker(w, { x: 0, z: 0 }, DT);
    expect(speedOf(w)).toBe(0);
  });

  it('斜走（两个方向键）速度不变快：方向会被归一化', () => {
    const w = createWalker(0, 0, 0);
    for (let i = 0; i < 120; i++) stepWalker(w, { x: 1, z: -1 }, DT);
    expect(speedOf(w)).toBeCloseTo(EXPLORE_CONFIG.move.walkSpeed, 6);
  });

  it('平滑转身：朝行进方向转，每帧不超过转身角速度，走最短的方向', () => {
    const w = createWalker(0, 0, 0); // 面朝 +z
    stepWalker(w, { x: 0, z: -1 }, DT); // 想往 −z 走：要转 180°
    expect(Math.abs(w.yaw)).toBeCloseTo(EXPLORE_CONFIG.move.turnRate * DT, 6);
    for (let i = 0; i < 120; i++) stepWalker(w, { x: 0, z: -1 }, DT);
    expect(Math.abs(wrapAngle(w.yaw - Math.PI))).toBeLessThan(1e-9);
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(3.1, 9); // 从 3 转到 −3：跨过 ±π 走近路（+0.28），不是倒转 6 弧度
    expect(turnToward(3, -3, 0.5)).toBeCloseTo(-3, 9);
  });

  it('不会走出可走区域；撞到边界时那个方向的速度清零', () => {
    const b = EXPLORE_CONFIG.bounds;
    const w = createWalker(b.maxX - 0.1, 0, 0);
    for (let i = 0; i < 120; i++) stepWalker(w, { x: 1, z: 0.2 }, DT);
    expect(w.x).toBe(b.maxX);
    expect(w.vx).toBe(0);
    expect(w.z).toBeGreaterThan(0); // 贴着边界还能沿边走
  });

  it('队长局部坐标 → 世界坐标：前方是朝向，+x 是左手侧', () => {
    const o = { x: 1, z: 2, yaw: yawOf(1, 0) }; // 面朝 +x
    const front = localToWorld(o, 0, 1);
    expect(front.x).toBeCloseTo(2, 9);
    expect(front.z).toBeCloseTo(2, 9);
    const left = localToWorld(o, 1, 0); // 面朝 +x 时左手侧是 −z
    expect(left.x).toBeCloseTo(1, 9);
    expect(left.z).toBeCloseTo(1, 9);
  });
});

describe('探索：小队', () => {
  it('出生点列队：队长在出生点、面向 Boss；4 名队员在队长身后两排，彼此不重叠', () => {
    const spots = startLineup(BOSS);
    expect(spots).toHaveLength(5);
    expect(spots[0]!.id).toBe(EXPLORE_CONFIG.leaderId);
    expect(spots[0]!.x).toBe(EXPLORE_CONFIG.start.x);
    expect(spots[0]!.z).toBe(EXPLORE_CONFIG.start.z);
    const toBoss = { x: BOSS.x - spots[0]!.x, z: BOSS.z - spots[0]!.z };
    expect(spots[0]!.yaw).toBeCloseTo(Math.atan2(toBoss.x, toBoss.z), 9);
    const facing = { x: Math.sin(spots[0]!.yaw), z: Math.cos(spots[0]!.yaw) };
    for (const s of spots.slice(1)) {
      // 在队长身后
      const back = (s.x - spots[0]!.x) * facing.x + (s.z - spots[0]!.z) * facing.z;
      expect(back).toBeLessThan(-1);
      expect(s.yaw).toBe(spots[0]!.yaw);
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThan(1.2);
      }
    }
    // 5 个人都是友方人物、各不相同；都在可走区域里，且在我方战斗区域附近（右下方）
    expect(new Set(spots.map((s) => s.id)).size).toBe(5);
    for (const s of spots) {
      expect(s.x + s.z).toBeGreaterThan(8);
      expect(Math.abs(s.x)).toBeLessThan(EXPLORE_CONFIG.bounds.maxX);
      expect(Math.abs(s.z)).toBeLessThan(EXPLORE_CONFIG.bounds.maxZ);
    }
  });

  it('只有被控制的人走（默认队长），其余原地不动；Tab 依次切换，回到起点后复位', () => {
    const squad = new Squad(BOSS);
    squad.input.x = 1;
    for (let i = 0; i < 60; i++) squad.update(DT);
    const start = new Map(startLineup(BOSS).map((s) => [s.id, s]));
    for (const [id, w] of squad.walkers) {
      const s = start.get(id)!;
      if (id === EXPLORE_CONFIG.leaderId) expect(w.x).toBeGreaterThan(s.x + 1);
      else expect(w.x).toBe(s.x);
    }
    const order = [squad.controlled];
    for (let i = 0; i < 5; i++) order.push(squad.cycleControlled());
    expect(order[5]).toBe(order[0]); // 转一圈回到队长
    expect(new Set(order.slice(0, 5)).size).toBe(5);
    squad.reset();
    expect(squad.leader.x).toBe(EXPLORE_CONFIG.start.x);
    expect(squad.input.x).toBe(0);
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
  const key = (k: string, repeat = false): KeyboardEvent => ({ key: k, repeat, preventDefault: () => undefined }) as unknown as KeyboardEvent;

  it('方向键 / WASD 按屏幕方向给出地面方向（屏幕上 = −z），可以斜走，松开即停', () => {
    const dirs: [number, number][] = [];
    let cycles = 0;
    const input = new ExploreInput(
      (x, z) => dirs.push([x, z]),
      () => (cycles += 1),
    );
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
    expect(input.handle(key('Tab'), true)).toBe(true);
    input.handle(key('Tab', true), true); // 按住不放的重复不算
    expect(cycles).toBe(1);
    expect(input.handle(key('x'), true)).toBe(false); // 其他键不处理
  });
});

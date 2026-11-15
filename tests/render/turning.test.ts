import { describe, expect, it } from 'vitest';
import { chargeYaw, shortestAngle, turnToward } from '../../src/render/units/turning';

const turn = { lead: 0.4, settle: 0.35 };

describe('冲锋转身', () => {
  it('最短夹角：跨过 ±π 时走近路', () => {
    expect(shortestAngle(0, 1)).toBeCloseTo(1);
    expect(shortestAngle(3, -3)).toBeCloseTo(Math.PI * 2 - 6);
    expect(shortestAngle(-3, 3)).toBeCloseTo(6 - Math.PI * 2);
    expect(Math.abs(shortestAngle(0.2, 0.2 + Math.PI * 4))).toBeCloseTo(0);
  });

  it('出发时保持原朝向，途中转向跑动方向，到位时正对目标', () => {
    const from = -2.356; // 友方原始朝向
    const travel = -1.8;
    const face = -2.2;
    expect(chargeYaw(0, from, travel, face, turn)).toBeCloseTo(from);
    expect(chargeYaw(0.5, from, travel, face, turn)).toBeCloseTo(travel);
    expect(chargeYaw(1, from, travel, face, turn)).toBeCloseTo(face);
  });

  it('转向是平滑的：相邻两帧的朝向变化很小，没有瞬间扭转', () => {
    const from = 0.785;
    const travel = 0.785 + 2.6; // 旋风斩横向突进：要转很大的角度
    const face = 0.785;
    let prev = chargeYaw(0, from, travel, face, turn);
    let maxStep = 0;
    for (let i = 1; i <= 100; i++) {
      const yaw = chargeYaw(i / 100, from, travel, face, turn);
      maxStep = Math.max(maxStep, Math.abs(shortestAngle(prev, yaw)));
      prev = yaw;
    }
    expect(maxStep).toBeLessThan(0.15); // 每 1% 进度最多转约 8°
  });

  it('返回原位：从当前朝向平滑转回原朝向，起止没有突变', () => {
    expect(turnToward(1, 2, 0)).toBeCloseTo(1);
    expect(turnToward(1, 2, 1)).toBeCloseTo(2);
    expect(turnToward(1, 2, 0.01) - 1).toBeLessThan(0.001);
    expect(2 - turnToward(1, 2, 0.99)).toBeLessThan(0.001);
    // 进度超出范围时不越界
    expect(turnToward(1, 2, 5)).toBeCloseTo(2);
  });
});

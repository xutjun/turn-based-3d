import { describe, expect, it } from 'vitest';
import type { Object3D } from 'three';
import { MOTION_PROFILES } from '../../src/data/attackAnimConfig';
import { approachPoint } from '../../src/render/director/Choreographer';
import { Scheduler } from '../../src/render/director/Scheduler';
import type { CameraRig } from '../../src/render/camera/CameraRig';
import type { FxSystem } from '../../src/render/fx/FxSystem';
import { createDefaultRegistry } from '../../src/assets/registerDefaults';
import { createFormationView } from '../../src/render/scene/formationView';
import { BattleStage } from '../../src/render/units/BattleStage';
import { detourBump, pathDetour } from '../../src/render/units/detour';
import { ALL_TEMPLATES, installFakeCanvas } from './realStage';

// 新阵型（步骤 17）：人物在后排、宝宝在主人正前方。人物近战冲锋时不能从前排宝宝身上穿过，
// 而是从两只宝宝之间穿过去（地面上隔开，不算从头顶跳过）；宝宝在前排，冲锋路上没有己方单位。

describe('冲锋绕开己方单位：纯计算', () => {
  const flat = Array.from({ length: 41 }, (_, i) => ({ s: i / 40, hop: 0 }));

  it('路上没人：不绕（与原来的直线一样）', () => {
    expect(pathDetour({ x: 0, z: 0 }, { x: 10, z: 0 }, [], 0.5, flat)).toBeNull();
    expect(pathDetour({ x: 0, z: 0 }, { x: 10, z: 0 }, [{ x: 5, z: 3, radius: 0.45, height: 1.8 }], 0.5, flat)).toBeNull();
  });

  it('有人挡路：向远离他的一侧绕开，两端仍在起点和终点', () => {
    const o = { x: 2.3, z: 0.2, radius: 0.45, height: 1.8 };
    const d = pathDetour({ x: 0, z: 0 }, { x: 10, z: 0 }, [o], 0.5, flat)!;
    expect(d).not.toBeNull();
    expect(d.offset).toBeLessThan(0); // 他在左侧（+z），往右绕
    expect(d.lift).toBe(1);
    expect(d.at).toBeCloseTo(0.23, 2);
    expect(detourBump(0, d.at)).toBe(0);
    expect(detourBump(1, d.at)).toBe(0);
    expect(detourBump(d.at, d.at)).toBe(1);
  });

  it('一排人挡在斜线上、侧偏绕不开时：把这一跳加高，从头顶越过', () => {
    const line = [0, 1, 2, 3, 4].map((i) => ({ x: 2 + i * 1.5, z: 4 - i * 2, radius: 0.45, height: 1.8 }));
    const arc = Array.from({ length: 41 }, (_, i) => ({ s: i / 40, hop: 0.6 * 4 * (i / 40) * (1 - i / 40) }));
    const d = pathDetour({ x: 0, z: 0 }, { x: 12, z: 0 }, line, 0.5, arc);
    expect(d).not.toBeNull();
    expect(d!.lift).toBeGreaterThanOrEqual(1);
  });

  it('跳得比他高：从头顶越过，不绕', () => {
    const high = Array.from({ length: 41 }, (_, i) => ({ s: i / 40, hop: 2.5 }));
    expect(pathDetour({ x: 0, z: 0 }, { x: 10, z: 0 }, [{ x: 3, z: 0, radius: 0.45, height: 1.8 }], 0.5, high)).toBeNull();
  });
});

describe('冲锋绕开己方单位：真实模型', () => {
  const NO_FX = { burst: () => Promise.resolve(), startTrail: () => ({ stop: () => undefined }) } as unknown as FxSystem;
  const NO_CAMERA = { shake: () => undefined } as unknown as CameraRig;

  function stage(): { scheduler: Scheduler; stage: BattleStage } {
    installFakeCanvas();
    const scheduler = new Scheduler();
    const models: ReadonlyMap<string, Object3D> = createFormationView(createDefaultRegistry(), ALL_TEMPLATES).units;
    return { scheduler, stage: new BattleStage(ALL_TEMPLATES, models, scheduler, NO_FX, NO_CAMERA) };
  }

  /** 跑一段位移，返回全程离己方单位的最小余量（米，负数 = 穿过） */
  async function watch(s: ReturnType<typeof stage>, id: string, run: () => Promise<void>): Promise<number> {
    const me = s.stage.unit(id);
    const others = [...s.stage.views.values()].filter((v) => v !== me && v.side === me.side);
    let worst = Infinity;
    let done = false;
    void run().then(() => (done = true));
    for (let i = 0; i < 2000 && !done; i++) {
      s.scheduler.update(1 / 60);
      s.stage.update(0);
      const g = me.groundPosition;
      const hop = me.airHeight;
      for (const o of others) {
        // 身体模型与 detour.ts 相同：人物身高以下是身体（半径 radius），肩部以上只有头（0.4 倍）；冲锋者身体按 0.8 倍半径
        // 人物：必须在地面上绕开（从两只宝宝之间穿过），跳多高都不算
        const hero = me.kind === 'hero';
        if (!hero && hop >= o.bodyHeight) continue;
        const r = !hero && hop >= o.bodyHeight * 0.78 ? o.radius * 0.4 : o.radius;
        worst = Math.min(worst, Math.hypot(g.x - o.home.x, g.z - o.home.z) - (r + me.radius * 0.8));
      }
      await new Promise((r) => setImmediate(r));
    }
    if (!done) throw new Error('位移没有结束');
    return worst;
  }

  it.each(['A1', 'A3', 'A4', 'A5', 'A6', 'A9'])('%s 冲向每一个敌人再跳回：不穿过任何己方单位', async (id) => {
    const s = stage();
    const me = s.stage.unit(id);
    const profile = MOTION_PROFILES[me.motion];
    for (const enemy of [...s.stage.views.values()].filter((v) => v.side === 'enemy')) {
      const point = approachPoint(me, enemy);
      const go = await watch(s, id, () => me.moveTo(point, profile.approach.duration, enemy.home, { gait: profile.approach.gait }));
      const back = await watch(s, id, () => me.returnHome(profile.retreat.duration));
      expect(go, `${id} → ${enemy.id}`).toBeGreaterThanOrEqual(0);
      expect(back, `${id} ← ${enemy.id}`).toBeGreaterThanOrEqual(0);
      const g = me.groundPosition;
      expect(Math.hypot(g.x - me.home.x, g.z - me.home.z)).toBe(0);
    }
  }, 120_000);
});

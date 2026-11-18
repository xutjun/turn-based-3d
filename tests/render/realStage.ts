// 用真实模型（程序化建模 + 真实关节）和真实 UnitView 跑演出的测试工具（步骤 11b）。
// 不渲染，只检查关节和根节点的变换：Node 里没有 canvas，这里放一个最小的假 2D 画布，让程序化贴图能生成。

import type { Object3D } from 'three';
import { createDefaultRegistry } from '../../src/assets/registerDefaults';
import { getRig } from '../../src/assets/models/characters/rig';
import { getEquippedWeapon } from '../../src/assets/models/weapons';
import type { UnitTemplate } from '../../src/core/types';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import type { Scheduler } from '../../src/render/director/Scheduler';
import type { FxSystem } from '../../src/render/fx/FxSystem';
import { createFormationView } from '../../src/render/scene/formationView';
import { allAnimatedJoints } from '../../src/render/units/animatedJoints';
import { UnitView } from '../../src/render/units/UnitView';

/** 安装一个什么都不画的假 canvas（只为了让程序化贴图的生成代码能跑通） */
export function installFakeCanvas(): void {
  const g = globalThis as { document?: unknown };
  if (g.document) return;
  const gradient = { addColorStop: () => undefined };
  const context = new Proxy(
    {},
    {
      get(target: Record<string | symbol, unknown>, key) {
        if (key in target) return target[key];
        if (key === 'createImageData') return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        if (key === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        if (key === 'createRadialGradient' || key === 'createLinearGradient' || key === 'createPattern') return () => gradient;
        if (key === 'measureText') return () => ({ width: 10 });
        return () => undefined;
      },
      set(target: Record<string | symbol, unknown>, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  g.document = {
    createElement: () => ({ width: 1, height: 1, getContext: () => context, style: {} }),
  };
}

/** 一个什么都不做的特效系统（UnitView 只用到尘土和拖尾） */
const NO_FX = {
  burst: () => Promise.resolve(),
  startTrail: () => ({ stop: () => undefined }),
} as unknown as FxSystem;

export const ALL_TEMPLATES: readonly UnitTemplate[] = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES];

/** 为一组单位造出真实模型和 UnitView（每次都是新模型，互不影响） */
export function createRealViews(scheduler: Scheduler, templates: readonly UnitTemplate[] = ALL_TEMPLATES): Map<string, UnitView> {
  installFakeCanvas();
  const models = createFormationView(createDefaultRegistry(), templates).units;
  const views = new Map<string, UnitView>();
  for (const t of templates) views.set(t.id, new UnitView(t, models.get(t.id)!, scheduler, NO_FX));
  return views;
}

/**
 * 一个单位此刻的“姿态指纹”：根节点的位置、转角、缩放，所有会动的关节（人形骨架 + 宝宝的额外关节）的转角，
 * 以及武器相对手的姿态（四元数，含“拧向目标”）。
 */
export function poseSnapshot(view: UnitView): Record<string, number> {
  const out: Record<string, number> = {};
  const m = view.model;
  const put = (name: string, o: Object3D): void => {
    out[`${name}.rx`] = o.rotation.x;
    out[`${name}.ry`] = o.rotation.y;
    out[`${name}.rz`] = o.rotation.z;
  };
  put('root', m);
  out['root.px'] = m.position.x;
  out['root.py'] = m.position.y;
  out['root.pz'] = m.position.z;
  out['root.sx'] = m.scale.x;
  out['root.sy'] = m.scale.y;
  out['root.sz'] = m.scale.z;
  for (const [name, joint] of Object.entries(allAnimatedJoints(m, getRig(m)))) put(name, joint);
  const w = getEquippedWeapon(m);
  if (w) {
    out['weapon.qx'] = w.quaternion.x;
    out['weapon.qy'] = w.quaternion.y;
    out['weapon.qz'] = w.quaternion.z;
    out['weapon.qw'] = w.quaternion.w;
  }
  return out;
}

/** 两个姿态指纹之间超出容差的差异（空 = 一致） */
export function poseDiff(before: Record<string, number>, after: Record<string, number>, eps = 1e-6): string[] {
  const out: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (a === undefined || b === undefined || Math.abs(a - b) > eps) out.push(`${key}: ${a?.toFixed(4)} → ${b?.toFixed(4)}`);
  }
  return out;
}

/**
 * 在真实的 UnitView 上演一遍入场过场（步骤 17）：队长从 at 开打（探索布置：只显示队长和 Boss），按帧推进到演完。
 * 特效、镜头、音效用空实现。
 */
export async function playIntroReal(
  scheduler: Scheduler,
  views: Map<string, UnitView>,
  at: { x: number; z: number },
  frame: () => void,
): Promise<void> {
  const { IntroCutscene } = await import('../../src/render/cutscene/introCutscene');
  const { IntroFx } = await import('../../src/render/cutscene/introFx');
  const { ExploreWorld } = await import('../../src/explore/exploreWorld');
  const { nearestStandable } = await import('../../src/explore/introPlan');
  const { EXPLORE_CONFIG } = await import('../../src/data/exploreConfig');
  const boss = [...views.values()].find((v) => v.radius > 1)!;
  const leaderId = EXPLORE_CONFIG.leaderId;
  const world = new ExploreWorld(boss.home);
  const stage = {
    views,
    unit: (id: string) => views.get(id)!,
    reset: () => {
      scheduler.flush();
      for (const v of views.values()) v.reset();
    },
  };
  const intro = new IntroCutscene({
    stage: stage as never,
    scheduler,
    camera: { setFrame: () => undefined } as never,
    rig: { shake: () => undefined } as never,
    fx: { burst: () => Promise.resolve(), rubble: () => undefined, flashLight: () => undefined } as never,
    sound: { play: () => undefined },
    introFx: new IntroFx(),
    world,
    leaderId,
    bossId: boss.id,
  });
  const p = nearestStandable(world, at.x, at.z);
  const yaw = Math.atan2(boss.home.x - p.x, boss.home.z - p.z);
  for (const v of views.values()) v.model.visible = v.id === leaderId || v === boss;
  views.get(leaderId)!.placeAt(p.x, p.z, yaw);
  let done = false;
  void intro.play({ leader: { x: p.x, z: p.z, yaw }, camera: { x: p.x, y: 1.2, z: p.z, distance: 17 } }).then(() => (done = true));
  for (let i = 0; i < 20000 && !done; i++) {
    scheduler.update(1 / 60);
    frame();
    await new Promise((r) => setImmediate(r));
  }
  if (!done) throw new Error('入场过场没有结束');
}

/**
 * 用真实模型跑完整场战斗（步骤 11b 的“姿态复位”回归）：逻辑层自动出指令，演出由真实的 UnitView 表演，
 * 每推进一帧演出都更新一次所有单位的姿态（和游戏里的渲染循环一样）。
 * 待机时间固定为 0，所以待机偏移恒定：任何一次出手结束后，每个站着的单位的根节点和全部关节
 * 都必须和开战前的姿态指纹完全一致（正在防御的单位除外，防御到回合结束才解除）。
 */
export async function runBattleReal(
  seed: number,
  options: { skip?: boolean; timeScale?: number; tweak?: (scheduler: Scheduler) => void; intro?: { x: number; z: number } } = {},
) {
  const { BattleEngine } = await import('../../src/core/battle');
  const { createDefaultSetup } = await import('../../src/data/defaultSetup');
  const { BattleDirector } = await import('../../src/render/director/BattleDirector');
  const { Scheduler } = await import('../../src/render/director/Scheduler');
  const { createFakes, pump } = await import('./directorFakes');

  const scheduler = new Scheduler();
  scheduler.setSkip(options.skip ?? false);
  if (options.timeScale) scheduler.setTimeScale(options.timeScale);
  const fakes = createFakes(scheduler);
  const views = createRealViews(scheduler);
  fakes.stage.unit = (id) => views.get(id)!;
  let maxAway = 0;
  const frame = (): void => {
    for (const v of views.values()) v.update(scheduler.time, 0);
    maxAway = Math.max(maxAway, [...views.values()].filter((v) => v.away).length);
  };
  frame();
  const baseline = new Map([...views].map(([id, v]) => [id, poseSnapshot(v)]));

  const engine = new BattleEngine(createDefaultSetup(seed));
  const director = new BattleDirector(engine.events, fakes.stage, fakes.hud, scheduler, {
    skillName: (id) => id,
    isBasicSkill: () => true,
  });
  const idle = (): Promise<void> =>
    pump(scheduler, director.idle(), (s) => {
      options.tweak?.(s);
      frame();
    });
  const problems: string[] = [];
  let lastActor = '';
  engine.events.onAny((e) => {
    if (e.type === 'UnitActStart') lastActor = `${e.actorId}（${e.command.kind}）`;
  });
  const check = (when: string): void => {
    frame();
    const state = engine.getState();
    for (const [id, view] of views) {
      if (view.away) problems.push(`${when}：${id} 没有回到站位`);
      if (!state.units[id]!.alive) continue;
      if (view.fallen > 0) problems.push(`${when}：${id} 没有阵亡却处于倒地姿态（fall=${view.fallen.toFixed(2)}）`);
      if (view.guarding) continue;
      const diff = poseDiff(baseline.get(id)!, poseSnapshot(view), 1e-5);
      if (diff.length > 0) problems.push(`${when}：${id} 姿态没有复位 ${diff.slice(0, 4).join('; ')}（出手者 ${lastActor}）`);
    }
  };

  if (options.intro) {
    // 步骤 17：先从探索的位置演一遍入场过场，演完后所有单位必须与直接开战的开场姿态完全一致
    await playIntroReal(scheduler, views, options.intro, frame);
    check('入场过场结束后');
  }

  engine.start();
  await idle();
  let action = 0;
  while (engine.getState().phase !== 'ended') {
    for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, engine.suggestCommand(id));
    engine.beginExecution();
    await idle();
    while (engine.getState().phase === 'execution') {
      const waiting = engine.getState().awaitingCommandFor;
      if (waiting !== null) engine.submitCommand(waiting, engine.suggestCommand(waiting));
      engine.stepAction();
      await idle();
      action += 1;
      check(`第 ${engine.getState().turn} 回合第 ${action} 次出手后`);
    }
  }
  await idle();
  return { engine, director, fakes, views, problems, maxAway };
}

// 近战衔接的测量（步骤 11c）：用真实模型逐帧演一个技能演示，记录出手者的
//   - 起跳到命中：离地（下蹲结束）到第一次命中（顿住开始）的时间；
//   - 每次命中的“落地到命中”：着地之后过了多久才命中（换目标的那一击才有，同一目标的后续几击记为 −1）；
//   - 每次命中前的“站定时间”：起跳之后、站在地上（不在下蹲、顿住、收招、回程）且身体各取样点
//     （人形：根、胸、头、双手；宝宝：根、头、四肢末端）的速度都低于 0.3 米/秒的累计时长。
// scripts/measureMeleeFlow.ts 打印这些数字；tests/render/realMotion.test.ts 用它断言“没有站定的空档”。

import { Vector3, type Object3D } from 'three';
import { getRig } from '../../src/assets/models/characters/rig';
import { EventBus, type BattleEvent, type BattleEventInput } from '../../src/core/events';
import { BattleDirector } from '../../src/render/director/BattleDirector';
import { Scheduler } from '../../src/render/director/Scheduler';
import { snapshotOf } from '../../src/ui/showcase/showcaseScript';
import { buildSkillDemos } from '../../src/ui/showcase/skillDemoScripts';
import { createFakes } from './directorFakes';
import { ALL_TEMPLATES, createRealViews } from './realStage';

export const FLOW_DT = 1 / 60;
const STILL = 0.3; // 米 / 秒

export interface MeleeFlow {
  takeoffToHit: number; // 秒；没有起跳时为 −1
  hits: { land: number; still: number }[];
  total: number; // 整段演出的时长（秒）
}

export async function measureMeleeFlow(demoId: string, actorId: string, scale = 1): Promise<MeleeFlow> {
  const units = ALL_TEMPLATES.map(snapshotOf);
  const demo = buildSkillDemos(units).find((d) => d.id === demoId)!;
  const scheduler = new Scheduler();
  scheduler.setTimeScale(scale);
  const fakes = createFakes(scheduler);
  const views = createRealViews(scheduler);
  fakes.stage.unit = (uid) => views.get(uid)!;
  const bus = new EventBus();
  const director = new BattleDirector(bus, fakes.stage, fakes.hud, scheduler, { skillName: (s) => s, isBasicSkill: () => true });
  let seq = 0;
  const emit = (e: BattleEventInput): void => bus.emit({ ...e, seq: (seq += 1), turn: 1 } as BattleEvent);
  const tick = async (): Promise<void> => {
    scheduler.update(FLOW_DT);
    for (const v of views.values()) v.update(scheduler.time, scheduler.time);
    await new Promise((r) => setImmediate(r));
  };
  const run = async (): Promise<void> => {
    let done = false;
    void director.idle().then(() => (done = true));
    for (let i = 0; i < 20000 && !done; i++) await tick();
  };
  emit({ type: 'BattleStart', units });
  for (const e of demo.setup) emit(e);
  await run();

  const actor = views.get(actorId)!;
  const rig = getRig(actor.model);
  const points: { o: Object3D; at: Vector3 }[] = rig
    ? [actor.model, rig.chest, rig.head, rig.armL.hand, rig.armR.hand].map((o) => ({ o, at: new Vector3() }))
    : [{ o: actor.model, at: new Vector3() }];
  if (!rig) {
    actor.model.traverse((o) => {
      if (o.name === 'joint:head') points.push({ o, at: new Vector3() });
      if (/^joint:(shoulder[LR]|foreLeg[LR])$/.test(o.name)) points.push({ o, at: new Vector3(0, -0.4, 0) });
    });
  }
  const pos = (p: { o: Object3D; at: Vector3 }): Vector3 => p.o.localToWorld(p.at.clone());
  actor.model.updateMatrixWorld(true);
  const prev = points.map(pos);

  let done = false;
  for (const e of demo.events) emit(e);
  void director.idle().then(() => (done = true));
  let t = 0;
  let takeoff = -1;
  let lastPhase = actor.phase;
  let still = 0;
  let wasAir = false;
  let touchdown = -1;
  const hits: MeleeFlow['hits'] = [];
  const hitTimes: number[] = [];
  for (let i = 0; i < 20000 && !done; i++) {
    await tick();
    t += FLOW_DT;
    actor.model.updateMatrixWorld(true);
    let speed = 0;
    points.forEach((pt, k) => {
      const p = pos(pt);
      speed = Math.max(speed, p.distanceTo(prev[k]!) / (scheduler.delta || FLOW_DT));
      prev[k]!.copy(p);
    });
    const phase = actor.phase;
    if (lastPhase === 'crouch' && phase !== 'crouch' && takeoff < 0) takeoff = t;
    const air = actor.airHeight;
    if (wasAir && air === 0) touchdown = t;
    wasAir = air > 0;
    if (phase !== lastPhase && phase === 'hold') {
      hitTimes.push(t);
      hits.push({ land: touchdown >= 0 ? t - touchdown : -1, still });
      still = 0;
      touchdown = -1;
    }
    const grounded = takeoff >= 0 && air === 0 && phase !== 'crouch' && phase !== 'hold';
    if (grounded && speed < STILL && scheduler.delta > 0) still += FLOW_DT;
    if (phase === 'return' || phase === 'recover') still = 0; // 收招、回程不算
    lastPhase = phase;
  }
  // 时间都换算成演出时间（倍速下真实时间更短）
  const first = hitTimes[0];
  return {
    takeoffToHit: first !== undefined && takeoff >= 0 ? (first - takeoff) * scale : -1,
    hits: hits.map((h) => ({ land: h.land < 0 ? -1 : h.land * scale, still: h.still * scale })),
    total: t * scale,
  };
}

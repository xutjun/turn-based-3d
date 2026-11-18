// 战后流程测试工具（步骤 19）：真实模型、真实 UnitView、真实调度器，把探索、入场过场、战斗演出、战后过场串起来。
// 与游戏页面（PlayerBattleApp）的衔接顺序相同：探索 → 点 Boss → 交谈点 → 对话“我准备好了” → 入场过场 → 战斗 →
// 战后过场 → 回到探索；“重新开始”= 拆场后回到探索起点。特效、镜头、音效用空实现。

import { BattleEngine } from '../../src/core/battle';
import type { Side } from '../../src/core/types';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { obstacleDistance } from '../../src/explore/collision';
import type { BattleCamera } from '../../src/render/camera/battleCamera';
import type { CameraRig } from '../../src/render/camera/CameraRig';
import { IntroCutscene, type CameraFrame } from '../../src/render/cutscene/introCutscene';
import { IntroFx } from '../../src/render/cutscene/introFx';
import { OutroCutscene, type OutroReport, type OutroResult } from '../../src/render/cutscene/outroCutscene';
import { SummonFx } from '../../src/render/cutscene/summonFx';
import { BattleDirector } from '../../src/render/director/BattleDirector';
import { Scheduler } from '../../src/render/director/Scheduler';
import { ExploreStage } from '../../src/render/explore/ExploreStage';
import type { BattleStage } from '../../src/render/units/BattleStage';
import type { UnitView } from '../../src/render/units/UnitView';
import { drainMatch } from '../../src/ui/matchLifecycle';
import { createFakes } from './directorFakes';
import { ALL_TEMPLATES, createRealViews, cutsceneFx, poseDiff, poseSnapshot } from './realStage';

export const LEADER = EXPLORE_CONFIG.leaderId;
const DT = 1 / 60;
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** 按种子用自动指令（逻辑层，不演出）打完一场，返回胜方 */
export function winnerOf(seed: number): Side | null {
  const engine = new BattleEngine(createDefaultSetup(seed));
  engine.start();
  while (engine.getState().phase !== 'ended') {
    for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, engine.suggestCommand(id));
    engine.beginExecution();
    while (engine.getState().phase === 'execution') {
      const waiting = engine.getState().awaitingCommandFor;
      if (waiting !== null) engine.submitCommand(waiting, engine.suggestCommand(waiting));
      engine.stepAction();
    }
  }
  return engine.getState().winner;
}

/** 找一个我方胜 / 负的种子 */
export function seedFor(winner: Side, from = 1): number {
  for (let s = from; s < from + 500; s++) if (winnerOf(s) === winner) return s;
  throw new Error(`找不到 ${winner} 获胜的种子`);
}

export function createFlow() {
  const scheduler = new Scheduler();
  const views = createRealViews(scheduler);
  const boss = [...views.values()].find((v) => v.side === 'enemy' && v.radius > 1)!;
  const frames: (CameraFrame | null)[] = [];
  const camera = { setFrame: (f: CameraFrame | null) => frames.push(f ? { ...f } : null), target: { x: 0, z: 0 } } as unknown as BattleCamera;
  const rig = { shake: () => undefined } as unknown as CameraRig;
  const fx = cutsceneFx(scheduler);
  const sounds: string[] = [];
  const sound = { play: (n: string) => void sounds.push(n) };
  const stage = {
    views,
    unit: (id: string) => views.get(id)!,
    reset: () => {
      scheduler.flush();
      for (const v of views.values()) v.reset();
    },
    unitsAway: () => [...views.values()].filter((v) => v.away).map((v) => v.id),
  } as unknown as BattleStage;
  const explore = new ExploreStage(stage, camera, ALL_TEMPLATES);
  const introFx = new IntroFx();
  const summonFx = new SummonFx();
  const intro = new IntroCutscene({ stage, scheduler, camera, rig, fx, sound, introFx, summonFx, world: explore.world, leaderId: LEADER, bossId: boss.id });
  const fades: number[] = [];
  const outro = new OutroCutscene({
    stage,
    scheduler,
    camera,
    fx,
    sound,
    summonFx,
    world: explore.world,
    leaderId: LEADER,
    bossId: boss.id,
    shadeOf: (v) => intro.shadeOf(v),
    petEntries: () => intro.planPets(),
    exploreFrame: (x, z) => explore.frameAt(x, z),
    setFade: (a) => fades.push(a),
  });

  /** 一帧：和游戏的渲染循环一样，先推进探索的移动，再推进演出，再摆姿态（待机时间固定为 0） */
  let onFrame: ((frame: number) => void) | null = null;
  let frameNo = 0;
  const frame = (): void => {
    explore.update(DT);
    scheduler.update(DT);
    for (const v of views.values()) v.update(scheduler.time, 0);
    onFrame?.(frameNo++);
  };
  /** 推进到 promise 完成（最多 limit 帧） */
  const until = async <T>(promise: Promise<T>, limit = 20000): Promise<T> => {
    let done = false;
    let value: T | undefined;
    void promise.then((v) => {
      done = true;
      value = v;
    });
    for (let i = 0; i < limit && !done; i++) {
      frame();
      await tick();
    }
    if (!done) throw new Error('没有结束（卡死）');
    return value as T;
  };
  const steps = async (n: number): Promise<void> => {
    for (let i = 0; i < n; i++) {
      frame();
      await tick();
    }
  };

  // 基准：直接开战时的开场姿态
  for (const v of views.values()) v.update(0, 0);
  const baseline = new Map([...views].map(([id, v]) => [id, poseSnapshot(v)]));

  /** 探索中点 Boss，跑到交谈点，等到弹出对话（onTalk），然后选“我准备好了”；返回入场过场的起点 */
  const talkAndStart = async () => {
    let talked = false;
    explore.onTalk = () => void (talked = true);
    const r = explore.clickBoss();
    if (!r) throw new Error('点 Boss 无效');
    for (let i = 0; i < 3000 && !talked; i++) {
      frame();
      await tick();
    }
    if (!talked) throw new Error('没有到达交谈点');
    if (explore.endDialog('startBattle') !== 'battle') throw new Error('对话没有进入战斗');
    return explore.beginIntro();
  };

  /** 播入场过场 */
  const playIntro = async (start: ReturnType<ExploreStage['beginIntro']>) => until(intro.play(start));

  /** 用真实导演把一场战斗演完（或演 abortAfter 次出手后中途放弃）；返回胜方，放弃时返回 null */
  const fight = async (seed: number, abortAfter?: number): Promise<Side | null> => {
    const fakes = createFakes(scheduler);
    fakes.stage.unit = (id) => views.get(id)!;
    const engine = new BattleEngine(createDefaultSetup(seed));
    const director = new BattleDirector(engine.events, fakes.stage, fakes.hud, scheduler, { skillName: (id) => id, isBasicSkill: () => true });
    const idle = () => until(director.idle(), 200000);
    engine.start();
    await idle();
    let actions = 0;
    while (engine.getState().phase !== 'ended') {
      for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, engine.suggestCommand(id));
      engine.beginExecution();
      await idle();
      while (engine.getState().phase === 'execution') {
        const waiting = engine.getState().awaitingCommandFor;
        if (waiting !== null) engine.submitCommand(waiting, engine.suggestCommand(waiting));
        engine.stepAction();
        actions += 1;
        if (abortAfter !== undefined && actions >= abortAfter) {
          // 中途放弃（设置里“重新开始”）：停流程、让正在演的那段立即走完，然后拆场回到探索起点
          await until(drainMatch({ controller: { stop: () => undefined }, director }, scheduler));
          stage.reset();
          explore.enter();
          return null;
        }
        await idle();
      }
    }
    await idle();
    return engine.getState().winner;
  };

  /** 播战后过场，然后与页面相同地回到探索 */
  const playOutro = async (result: OutroResult): Promise<OutroReport> => {
    const report = await until(outro.play(result));
    explore.resume(report.leader);
    return report;
  };

  /** 场上残留：探索布置之外显示的单位、特技层、倒地、离位、说话动作、副本材质、地面特效 */
  const residue = (): string[] => {
    const out: string[] = [];
    const want = new Set([LEADER, boss.id]);
    for (const v of views.values()) {
      if (v.model.visible !== want.has(v.id)) out.push(`${v.id} 显示=${v.model.visible}`);
      if (v.stuntActive) out.push(`${v.id} 特技层没清`);
      if (v.fallen > 0) out.push(`${v.id} 倒地 ${v.fallen}`);
      if (v.away) out.push(`${v.id} 离开站位`);
      if (v.gestureLevel > 0) out.push(`${v.id} 说话动作`);
    }
    for (const id of [...intro.shadedUnits(), ...outro.shadedUnits()]) out.push(`${id} 副本材质没换回`);
    if (introFx.activeCount + summonFx.activeCount > 0) out.push(`地面特效 ${introFx.activeCount + summonFx.activeCount}`);
    if (fades.length > 0 && fades.at(-1) !== 0) out.push(`黑场 ${fades.at(-1)}`);
    return out;
  };

  /** 入场过场结束后：所有单位与直接开战的开场姿态完全一致（上一场的东西一点都没带进来） */
  const startDiff = (): string[] => {
    const out: string[] = [];
    for (const [id, v] of views) {
      const d = poseDiff(baseline.get(id)!, poseSnapshot(v), 1e-5);
      if (d.length > 0) out.push(`${id}: ${d.slice(0, 3).join('; ')}`);
      if (!v.model.visible) out.push(`${id} 没有显示`);
    }
    return out;
  };

  /** 队长离障碍物表面的最小余量 */
  const leaderClearance = (): number => {
    const g = views.get(LEADER)!.groundPosition;
    return Math.min(...explore.world.obstacles.map((o) => obstacleDistance(o, g.x, g.z)));
  };

  return {
    scheduler,
    views,
    boss,
    explore,
    intro,
    outro,
    introFx,
    summonFx,
    frames,
    fades,
    sounds,
    frame,
    until,
    steps,
    talkAndStart,
    playIntro,
    fight,
    playOutro,
    residue,
    startDiff,
    leaderClearance,
    setOnFrame: (fn: ((frame: number) => void) | null) => void (onFrame = fn),
  };
}

export type Flow = ReturnType<typeof createFlow>;

/** 不演战斗，直接摆出一场打完的样子：敌方全部倒下消失（胜利）或我方全部倒地（失败），部分队员带着封印 / 防御 */
export async function fakeEnd(f: Flow, result: OutroResult, fallenAllies: string[] = ['A0', 'A3']): Promise<void> {
  const s = f.scheduler;
  const was = s.skip;
  s.setSkip(true);
  const dying: Promise<void>[] = [];
  for (const v of f.views.values()) {
    if (v.side === 'enemy' && result === 'victory') dying.push(v.die(true, 0.4, 0.3));
    if (v.side === 'ally' && (result === 'defeat' || fallenAllies.includes(v.id))) dying.push(v.die(v.kind === 'pet', 0.4, 0.3));
  }
  const alive = [...f.views.values()].filter((v) => v.side === 'ally' && !fallenAllies.includes(v.id));
  alive[0]?.setSealed(true);
  alive[1]?.setDefending(true);
  await f.until(Promise.all(dying));
  s.setSkip(was);
}

export type { UnitView };

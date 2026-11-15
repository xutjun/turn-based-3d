// 导演测试共用：记录调用的假舞台 / 假界面，以及“用自动指令把整场战斗连同演出跑完”的辅助函数。

import { BattleEngine } from '../../src/core/battle';
import type { UnitSnapshot } from '../../src/core/events';
import type { UnitId } from '../../src/core/types';
import { createDefaultSetup } from '../../src/data/defaultSetup';
import { facingOf, slotPosition } from '../../src/data/formation';
import { BattleDirector } from '../../src/render/director/BattleDirector';
import { Scheduler } from '../../src/render/director/Scheduler';
import type { DirectorHud, GroundPoint, Stage, StageUnit } from '../../src/render/director/types';

/** 记录调用的假舞台和假界面：不依赖 three 和 DOM */
export function createFakes(scheduler: Scheduler) {
  const log: string[] = [];
  const hp = new Map<UnitId, number>();
  const mp = new Map<UnitId, number>();
  const dead = new Set<UnitId>();
  const away = new Set<UnitId>();
  const units = new Map<UnitId, StageUnit>();
  let active: UnitId | null = null;
  let maxAway = 0;
  const violations: string[] = [];

  const makeUnit = (u: UnitSnapshot): StageUnit => {
    const home = slotPosition(u.side, u.slot);
    const act = (name: string, duration: number): Promise<void> => {
      log.push(`${name}:${u.id}`);
      return scheduler.wait(duration);
    };
    return {
      id: u.id,
      side: u.side,
      kind: u.kind,
      radius: 0.5,
      fxColor: 0xffffff,
      home,
      facing: facingOf(u.side),
      anchor: () => ({ x: home.x, y: 1, z: home.z }),
      moveTo: (_p: GroundPoint, d: number) => {
        if (active !== u.id) violations.push(`${u.id} 不是出手者却离开了站位`);
        away.add(u.id);
        maxAway = Math.max(maxAway, away.size);
        return act('moveTo', d);
      },
      returnHome: async (d: number) => {
        await act('returnHome', d);
        away.delete(u.id);
      },
      windup: (style, d) => act(`windup-${style}`, d),
      release: (style, d, variant = 0) => {
        log.push(`variant:${u.id}:${variant}`);
        return act(`release-${style}`, d);
      },
      recover: (d) => act('recover', d),
      hit: (d) => act('hit', d),
      dodge: (d) => act('dodge', d),
      die: (_v, d1, d2) => act('die', d1 + d2),
      revive: (d) => act('revive', d),
      setDefending: (on) => void log.push(`defend:${u.id}:${on}`),
      setWeaponGlow: (scale) => void log.push(`glow:${u.id}:${scale}`),
      setWeaponColor: (color) => void log.push(`color:${u.id}:${color === null ? 'reset' : 'set'}`),
      setTrail: (on) => void log.push(`trail:${u.id}:${on}`),
      setSealed: (on) => void log.push(`sealed:${u.id}:${on}`),
    };
  };

  const stage: Stage = {
    unit: (id) => units.get(id)!,
    projectile: (kind, _a, _b, _c, d) => {
      log.push(`projectile-${kind}`);
      return scheduler.wait(d);
    },
    burst: (kind, _a, _c, d, scale = 1) => {
      log.push(scale === 1 ? `burst-${kind}` : `burst-${kind}@${scale}`);
      return scheduler.wait(d);
    },
    slash: (_a, variant, _c, d) => {
      log.push(`slash:${variant}`);
      return scheduler.wait(d);
    },
    beam: (_a, _b, _c, travel, linger) => {
      log.push('beam');
      return scheduler.wait(travel + linger);
    },
    aura: (kind, _a, _c, d) => {
      log.push(`aura-${kind}`);
      return scheduler.wait(d);
    },
    camera: {
      focus: (_p, _zoom, _pan, d) => {
        log.push('cam-focus');
        return scheduler.wait(d);
      },
      reset: (d) => {
        log.push('cam-reset');
        return scheduler.wait(d);
      },
      shake: (amount) => void log.push(`cam-shake:${amount}`),
    },
  };
  // 记录顿帧 / 慢镜头
  const warp = scheduler.warp.bind(scheduler);
  scheduler.warp = (factor, duration) => {
    log.push(`warp:${factor}:${duration}`);
    warp(factor, duration);
  };
  const hud: DirectorHud = {
    init: (list) => {
      for (const u of list) {
        units.set(u.id, makeUnit(u));
        hp.set(u.id, u.hp);
        mp.set(u.id, u.mp);
      }
    },
    setHp: (id, v) => void hp.set(id, v),
    setMp: (id, v) => void mp.set(id, v),
    setDead: (id, d) => void (d ? dead.add(id) : dead.delete(id)),
    setStatus: (id, s, t) => void log.push(`status:${id}:${s}:${t}`),
    floater: (id, text) => void log.push(`floater:${id}:${text}`),
    setTurn: (turn) => void log.push(`turn:${turn}`),
    setActive: (id) => {
      if (id !== null && active !== null) violations.push(`${id} 开始出手时 ${active} 还没结束`);
      active = id;
    },
    setActed: () => undefined,
    queueLate: (id) => void log.push(`late:${id}`),
    banner: (text) => void log.push(`banner:${text}`),
  };
  return { log, hp, mp, dead, away, stage, hud, violations, maxAway: () => maxAway };
}

/** 不跳过动画时，一边推进调度器一边等 Promise 完成 */
export async function pump(
  scheduler: Scheduler,
  promise: Promise<void>,
  tweak?: (scheduler: Scheduler) => void,
): Promise<void> {
  let done = false;
  void promise.then(() => (done = true));
  for (let i = 0; i < 100000 && !done; i++) {
    tweak?.(scheduler); // 演出进行中插入的操作（开关跳过动画、切换倍速）
    scheduler.update(0.05);
    await new Promise((r) => setImmediate(r));
  }
  if (!done) throw new Error('演出没有结束（卡死）');
}

/**
 * 用自动指令跑完整场战斗，每次出手都等演出结束。
 * @param tweak 每推进一帧演出之前调用，用来模拟玩家在演出中途的操作
 */
export async function runBattle(seed: number, skip: boolean, tweak?: (scheduler: Scheduler) => void) {
  const scheduler = new Scheduler();
  scheduler.setSkip(skip);
  const fakes = createFakes(scheduler);
  const engine = new BattleEngine(createDefaultSetup(seed));
  const director = new BattleDirector(engine.events, fakes.stage, fakes.hud, scheduler, {
    skillName: (id) => id,
    isBasicSkill: () => true,
  });
  const idle = (): Promise<void> => (skip && !tweak ? director.idle() : pump(scheduler, director.idle(), tweak));
  const mismatches: string[] = [];
  let eventCount = 0;
  engine.events.onAny(() => (eventCount += 1));

  engine.start();
  await idle();
  while (engine.getState().phase !== 'ended') {
    for (const id of engine.getPendingCommandUnits()) engine.submitCommand(id, engine.suggestCommand(id));
    engine.beginExecution();
    await idle();
    while (engine.getState().phase === 'execution') {
      const waiting = engine.getState().awaitingCommandFor;
      if (waiting !== null) engine.submitCommand(waiting, engine.suggestCommand(waiting));
      engine.stepAction();
      await idle();
      // 演出追上逻辑后，界面数值必须和逻辑层一致，且没有人留在站位之外
      const state = engine.getState();
      for (const id of state.unitIds) {
        const u = state.units[id]!;
        if (fakes.hp.get(id) !== u.hp) mismatches.push(`${id} hp ${fakes.hp.get(id)} != ${u.hp}`);
        if (fakes.mp.get(id) !== u.mp) mismatches.push(`${id} mp ${fakes.mp.get(id)} != ${u.mp}`);
        if (fakes.dead.has(id) === u.alive) mismatches.push(`${id} 倒地状态不一致`);
      }
      if (fakes.away.size > 0) mismatches.push(`出手结束后仍有单位离开站位：${[...fakes.away].join(',')}`);
    }
  }
  await idle();
  return { engine, director, fakes, mismatches, eventCount };
}


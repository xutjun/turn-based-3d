import { describe, expect, it } from 'vitest';
import { EventBus, type BattleEvent, type BattleEventInput, type UnitSnapshot } from '../../src/core/events';
import type { Side, UnitId } from '../../src/core/types';
import {
  ATTACK_ANIM,
  CAST,
  GAITS,
  MELEE,
  MOTION_OF_TEMPLATE,
  MOTION_PROFILES,
  SECONDARY_MOTION,
  moveOf,
  type GaitId,
  type MotionId,
  type MoveDef,
} from '../../src/data/attackAnimConfig';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { BattleDirector } from '../../src/render/director/BattleDirector';
import { EASE, Scheduler } from '../../src/render/director/Scheduler';
import type { StageUnit } from '../../src/render/director/types';
import { EXTRA_JOINT_NAMES } from '../../src/render/units/animatedJoints';
import { dashProgress, dashSpeed, UnitMotion, wrapAngle, type Footfall, type MotionPhase } from '../../src/render/units/UnitMotion';
import { createFakes, pump } from './directorFakes';

// 步骤 11 / 11b：进攻动画。这里测三件事——
//   1. 配置本身自洽（每个动作都有完整的节奏、用到的关节都登记过）；
//   2. UnitMotion（纯计算）：位移曲线、姿态补间、跳过动画后的最终状态、倍速缩放、次级运动；
//   3. 编排（Choreographer）：各阶段的先后顺序和时长与配置一致。

const HOME = { x: 3, z: 4 };
const YAW = 2.4;
const TARGET = { x: -2, z: -1 };

/** 推进调度器直到 Promise 完成，返回用了多少“真实时间”（秒） */
async function runFor(scheduler: Scheduler, promise: Promise<unknown>, dt = 1 / 120): Promise<number> {
  let done = false;
  void promise.then(() => (done = true));
  let real = 0;
  for (let i = 0; i < 200000 && !done; i++) {
    scheduler.update(dt);
    real += dt;
    await new Promise((r) => setImmediate(r));
  }
  if (!done) throw new Error('动作没有结束（卡死）');
  return real;
}

/** 一次完整的近战普攻：（下蹲 → 大跳跃 → 落地缓冲）→ 预备 → 发力 → 顿住 → 余势 → 停一拍 → 收招 →（下蹲 → 跳回 → 落地缓冲） */
async function fullAttack(m: UnitMotion, scheduler: Scheduler, motion: MotionId, variant = 0): Promise<void> {
  const profile = MOTION_PROFILES[motion];
  const t = moveOf(motion, 'melee', variant).timing;
  await m.moveTo(TARGET, profile.approach.duration, { x: -3, z: -2 });
  await m.windup('melee', t.anticipation, variant);
  await m.release('melee', t.strike, variant);
  await m.hold(t.hold);
  await m.follow(t.follow);
  await scheduler.wait(t.beat);
  await m.recover(t.recover);
  await m.returnHome(profile.retreat.duration);
}

const ALL_MOTIONS = Object.keys(MOTION_PROFILES) as MotionId[];
const allMoves = (): { motion: MotionId; style: string; move: MoveDef }[] =>
  ALL_MOTIONS.flatMap((motion) =>
    (['melee', 'bow', 'bowUp', 'cast'] as const).flatMap((style) => MOTION_PROFILES[motion][style].map((move) => ({ motion, style, move }))),
  );

describe('进攻动画配置', () => {
  it('每个动作都有完整的节奏：预备、发力、命中顿住、余势、收招的时长都大于 0', () => {
    for (const { motion, style, move } of allMoves()) {
      const t = move.timing;
      for (const key of ['anticipation', 'strike', 'hold', 'follow', 'beat', 'recover'] as const) {
        expect(t[key], `${motion}/${style}/${move.label}.${key}`).toBeGreaterThan(0);
      }
      expect(move.ready.length, move.label).toBeGreaterThan(0);
      expect(move.strike.length, move.label).toBeGreaterThan(0);
      expect(move.follow.length, move.label).toBeGreaterThan(0);
      // 发力比预备快（蓄得慢、打得快）
      expect(t.strike, move.label).toBeLessThan(t.anticipation + 0.2);
    }
  });

  it('命中顿住 2~4 帧（按 60 帧每秒）', () => {
    for (const { move } of allMoves()) {
      expect(move.timing.hold, move.label).toBeGreaterThanOrEqual(2 / 60);
      expect(move.timing.hold, move.label).toBeLessThanOrEqual(4.5 / 60);
    }
  });

  it('刀、剑、枪的普攻是三套不同的动作；连斩 3 击互不相同', () => {
    const basic = (m: MotionId): MoveDef => moveOf(m, 'melee', MELEE.basic);
    expect(new Set([basic('blade'), basic('sword'), basic('spear')]).size).toBe(3);
    expect(basic('blade').label).toContain('刀');
    expect(basic('sword').label).toContain('剑');
    expect(basic('spear').label).toContain('枪');
    // 枪是突刺：发力时把武器对准正前方
    expect(basic('spear').strike.at(-1)!.pose['weapon.aim']).toBe(1);
    // 刀劈完有收刀
    expect(basic('blade').recover?.length).toBeGreaterThan(0);
    for (const m of ['blade', 'sword', 'spear'] as const) {
      const combo = [MELEE.basic, MELEE.second, MELEE.heavy].map((v) => moveOf(m, 'melee', v));
      expect(new Set(combo).size, m).toBe(3);
    }
    // 旋风斩最后一击比途中的每一击更慢、更重，并且带冲击波
    const spin = moveOf('blade', 'melee', MELEE.spin);
    const finish = moveOf('blade', 'melee', MELEE.spinFinish);
    expect(finish.timing.strike).toBeGreaterThan(spin.timing.strike * 3);
    expect(finish.fx?.shockwave).toBeGreaterThan(0);
    // 最后一击转了不止一整圈
    expect(Math.abs(finish.strike.at(-1)!.pose['root.turn']!)).toBeGreaterThan(Math.PI * 2);
  });

  it('近战物理攻击全部是大跳跃：原地下蹲蓄力 → 高抛物线 → 落地有尘土和震屏 → 落地缓冲；来回都是', () => {
    for (const m of ['blade', 'sword', 'spear', 'wolf', 'golem'] as const) {
      for (const leg of ['approach', 'retreat'] as const) {
        const g = GAITS[MOTION_PROFILES[m][leg].gait];
        expect(g.crouch, `${m}.${leg} 下蹲`).toBeDefined();
        expect(g.land, `${m}.${leg} 落地缓冲`).toBeDefined();
        expect(g.hop, `${m}.${leg} 腾空`).toBeGreaterThanOrEqual(0.45);
        expect(g.stride, `${m}.${leg} 没有小碎步`).toBeGreaterThan(20);
        expect(g.bob, m).toBe(0);
        expect(g.dust.end, `${m}.${leg} 落地尘土`).toBeGreaterThan(0);
        expect(g.shake, `${m}.${leg} 落地震屏`).toBeGreaterThan(0);
        // 下蹲 + 落地缓冲之外还留有足够的腾空时间
        expect(MOTION_PROFILES[m][leg].duration - g.crouch!.duration - g.land!.duration, m).toBeGreaterThan(0.35);
      }
    }
    // 人形跳得高，腾空时身体略前倾
    expect(GAITS.jump.hop).toBeGreaterThan(1.0);
    expect(GAITS.jump.lean).toBeGreaterThan(0);
    // 魔偶更沉重：跳得最低、落地震动最大、下蹲最久；狼更轻快：腾空时间最短
    const air = (m: MotionId): number => {
      const leg = MOTION_PROFILES[m].approach;
      const g = GAITS[leg.gait];
      return leg.duration - g.crouch!.duration - g.land!.duration;
    };
    const golem = GAITS[MOTION_PROFILES.golem.approach.gait];
    const wolf = GAITS[MOTION_PROFILES.wolf.approach.gait];
    expect(golem.hop).toBeLessThan(wolf.hop);
    expect(golem.hop).toBeLessThan(GAITS.jump.hop);
    expect(golem.shake).toBeGreaterThan(GAITS.jump.shake * 2);
    expect(golem.shake).toBeGreaterThan(wolf.shake * 2);
    expect(golem.crouch!.duration).toBeGreaterThan(GAITS.jump.crouch!.duration);
    expect(air('wolf')).toBeLessThan(air('blade'));
    expect(air('wolf')).toBeLessThan(air('golem'));
    // 狼：下伏蓄力、腾空时身体拉长；魔偶：下蹲时双臂举过头顶
    expect(wolf.crouch!.pose['foreLegL.x']).toBeLessThan(-0.3);
    expect(wolf.poses?.some((k) => (k.pose['root.stretch'] ?? 0) > 0.1)).toBe(true);
    expect(golem.crouch!.pose['shoulderL.x']).toBeLessThan(-2.5);
    // 连击的第二击换一个动作；魔偶的每一击都是重击并带地面震动
    for (const m of ['wolf', 'golem'] as const) expect(moveOf(m, 'melee', MELEE.second), m).not.toBe(moveOf(m, 'melee', MELEE.basic));
    const slam = moveOf('golem', 'melee', MELEE.basic);
    expect(slam.fx?.heavy).toBe(true);
    expect(slam.fx?.shockwave).toBeGreaterThan(0);
  });

  it('弓：拉弦（弦的中点跟着右手）→ 拉满 → 松弦回弹；三连射每一箭都重新拉弦；箭雨举弓朝天、后仰', () => {
    for (const [style, variant] of [['bow', 0], ['bow', 1], ['bowUp', 0]] as const) {
      const move = moveOf('bow', style, variant);
      const full = move.ready.at(-1)!.pose;
      expect(full['bow.draw'], move.label).toBe(1); // 拉满：弦搭在右手上
      expect(full['bow.aim'], move.label).toBe(1); // 弓摆正
      // 先搭弦（右手离弓近），再拉到脸侧
      expect(move.ready.length, move.label).toBeGreaterThanOrEqual(2);
      expect(move.strike.at(-1)!.pose['bow.draw'], move.label).toBeLessThan(0); // 松弦：弦向前弹出
      expect(move.follow.at(-1)!.pose['bow.draw'], move.label).toBe(0); // 回弹后停住
      expect(move.follow.at(-1)!.ease, move.label).toBe('outElastic');
    }
    const shot = moveOf('bow', 'bow', 0);
    expect(shot.ready[0]!.pose['root.turn']).toBeLessThan(-0.6); // 侧身站定
    expect(ATTACK_ANIM.bowFullDrawPause).toBeGreaterThanOrEqual(0.15); // 瞄准停顿一拍
    const sky = moveOf('bow', 'bowUp', 0).ready.at(-1)!.pose;
    expect(sky['weapon.aimPitch']).toBeGreaterThan(0.7); // 举弓朝天
    expect(sky['root.pitch']).toBeLessThan(-0.3); // 蓄满时身体后仰
  });

  it('法杖施法：双手握杖、挥杖画弧 / 画圈、杖顶拖光轨；群体法术幅度最大，封印和单体较简短；不同法术轨迹不同', () => {
    const cast = (v: number): MoveDef => moveOf('staff', 'cast', v);
    const staffMoves = [CAST.point, CAST.seal, CAST.fire, CAST.thunder, CAST.groupFire, CAST.groupThunder].map(cast);
    expect(new Set(staffMoves).size).toBe(staffMoves.length);
    for (const move of staffMoves) {
      expect(move.fx?.trail, move.label).toBe(true);
      expect(move.ready.some((k) => k.pose['grip.left'] === 1), `${move.label} 双手握杖`).toBe(true);
      expect(move.recover?.at(-1)!.pose['grip.left'], `${move.label} 收招松手`).toBe(0);
    }
    const span = (move: MoveDef): number => {
      const xs = move.ready.map((k) => k.pose['shoulderR.x'] ?? 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    // 群体法术：蓄力最久、举杖过头
    for (const g of [cast(CAST.groupFire), cast(CAST.groupThunder)]) {
      for (const small of [cast(CAST.seal), cast(CAST.fire), cast(CAST.thunder)]) {
        expect(g.timing.anticipation, g.label).toBeGreaterThan(small.timing.anticipation);
      }
      expect(Math.min(...g.ready.map((k) => k.pose['shoulderR.x'] ?? 0)), g.label).toBeLessThan(-2.6);
      expect(span(g), g.label).toBeGreaterThan(span(cast(CAST.seal)));
    }
    // 火系劈下（释放时杖尖指向目标、略向下），雷系高举（释放时手臂举过头顶）
    expect(cast(CAST.fire).strike.at(-1)!.pose['weapon.aim']).toBe(1);
    expect(cast(CAST.fire).strike.at(-1)!.pose['weapon.aimPitch']).toBeLessThan(0);
    expect(cast(CAST.thunder).strike.at(-1)!.pose['shoulderR.x']).toBeLessThan(-2.6);
    // 封印画圈：预备里转过一整圈（右肩的前后摆动先增后减再回来）
    const sealXs = cast(CAST.seal).ready.map((k) => k.pose['shoulderR.x'] ?? 0);
    expect(Math.max(...sealXs) - Math.min(...sealXs)).toBeGreaterThan(0.6);
    // 敌方的祭司、亡灵法师也用法杖动作
    expect(MOTION_OF_TEMPLATE['enemy_demon_priest']).toBe('staff');
    expect(MOTION_OF_TEMPLATE['enemy_necromancer']).toBe('staff');
  });

  it('法术型宝宝（骨龙、幽灵）有自己的施法动作和汇聚的光团', () => {
    for (const m of ['dragon', 'ghost'] as const) {
      expect(MOTION_PROFILES[m].gather, m).toBeGreaterThan(0);
      expect(MOTION_PROFILES[m].muzzle, m).toBeDefined();
      expect(moveOf(m, 'cast', 0).ready.length, m).toBeGreaterThanOrEqual(2);
    }
    const breath = moveOf('dragon', 'cast', 0).ready.at(-1)!.pose;
    expect(breath['root.pitch']).toBeLessThan(0); // 后仰
    expect(breath['jaw.x']).toBeGreaterThan(0.5); // 张口
    expect(breath['wingL.y']! * breath['wingR.y']!).toBeLessThan(0); // 双翼对称张开
    const soul = moveOf('ghost', 'cast', 0).ready.at(-1)!.pose;
    expect(soul['root.lift']).toBeGreaterThan(0.2); // 上浮
    expect(soul['shoulderL.z']! * soul['shoulderR.z']!).toBeLessThan(0); // 双臂展开
  });

  it('动作姿态里用到的通道都是认识的：根节点、武器，或登记过的关节', () => {
    const joints = new Set<string>(['shoulderR', 'elbowR', 'shoulderL', 'elbowL', 'spine', 'chest', 'head', ...EXTRA_JOINT_NAMES]);
    const root = new Set(['forward', 'side', 'lift', 'pitch', 'roll', 'turn', 'stretch', 'squash']);
    const weapon = new Set(['x', 'y', 'z', 'aim', 'aimPitch', 'aimYaw']);
    const extra: Record<string, Set<string>> = { bow: new Set(['aim', 'draw', 'cant']), grip: new Set(['left']) };
    const check = (pose: Record<string, number>, where: string): void => {
      for (const [channel, value] of Object.entries(pose)) {
        const [node, axis] = channel.split('.') as [string, string];
        const ok =
          node === 'root' ? root.has(axis) : node === 'weapon' ? weapon.has(axis) : extra[node] ? extra[node]!.has(axis) : joints.has(node) && ['x', 'y', 'z'].includes(axis);
        expect(ok, `${where}: ${channel}`).toBe(true);
        expect(Number.isFinite(value), `${where}: ${channel}`).toBe(true);
      }
    };
    for (const { move } of allMoves()) {
      for (const key of [...move.ready, ...move.strike, ...move.follow, ...(move.recover ?? [])]) check(key.pose, move.label);
    }
    for (const [id, gait] of Object.entries(GAITS)) {
      for (const key of gait.poses ?? []) check(key.pose, id);
      if (gait.crouch) check(gait.crouch.pose, `${id}.crouch`);
      if (gait.land) check(gait.land.pose, `${id}.land`);
      if (gait.legs) for (const j of gait.legs.joints) expect(joints.has(j), `${id}: ${j}`).toBe(true);
    }
    for (const [id, profile] of Object.entries(MOTION_PROFILES)) if (profile.brace) check(profile.brace.pose, id);
  });

  it('场上每个单位都能找到动作档案：人物按武器，宝宝按模板', () => {
    for (const t of [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES]) {
      const motion = t.weaponId ?? MOTION_OF_TEMPLATE[t.templateId];
      if (t.kind === 'hero' || t.kind === 'pet') expect(motion && MOTION_PROFILES[motion], t.id).toBeDefined();
    }
    expect(MOTION_OF_TEMPLATE['pet_wolf_grey']).toBe('wolf');
    expect(MOTION_OF_TEMPLATE['pet_golem']).toBe('golem');
  });

  it('缓动曲线两端分别是 0 和 1', () => {
    for (const [name, ease] of Object.entries(EASE)) {
      if (name === 'arc') continue; // 去了又回来的曲线
      expect(ease(0), name).toBeCloseTo(0, 6);
      expect(ease(1), name).toBeCloseTo(1, 6);
    }
    // 回弹：中途冲过头
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => EASE.outBack(i / 49)))).toBeGreaterThan(1.02);
  });
});

describe('位移曲线', () => {
  it('起点 0、终点 1、单调不减；贴地 / 短跳的步态到位前减速，大跳跃的水平速度基本不变（抛物线）', () => {
    for (const id of Object.keys(GAITS) as GaitId[]) {
      const g = GAITS[id];
      expect(dashProgress(0, g.accel, g.brake)).toBe(0);
      expect(dashProgress(1, g.accel, g.brake)).toBe(1);
      let prev = 0;
      for (let i = 1; i <= 200; i++) {
        const s = dashProgress(i / 200, g.accel, g.brake);
        expect(s, id).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = s;
      }
      expect(dashSpeed(0.999, g.accel, g.brake), id).toBeLessThan(0.05);
      expect(dashSpeed(0.5, g.accel, g.brake), id).toBe(1);
      if (g.land) {
        // 大跳跃：水平方向接近匀速
        for (const t of [0.25, 0.5, 0.75]) expect(Math.abs(dashProgress(t, g.accel, g.brake) - t), id).toBeLessThan(0.03);
      } else {
        // 最后 5% 的时间走的路程，比中段 5% 的时间少得多：到位前在减速
        const tail = 1 - dashProgress(0.95, g.accel, g.brake);
        const mid = dashProgress(0.55, g.accel, g.brake) - dashProgress(0.5, g.accel, g.brake);
        expect(tail, id).toBeLessThan(mid * 0.5);
      }
    }
  });

  it('角度折回 (−π, π]', () => {
    expect(wrapAngle(Math.PI * 4 + 0.3)).toBeCloseTo(0.3, 9);
    expect(wrapAngle(-Math.PI * 2 - 0.5)).toBeCloseTo(-0.5, 9);
    expect(wrapAngle(3)).toBeCloseTo(3, 9);
  });
});

describe('UnitMotion：一次出手的动作状态', () => {
  it('人形大跳跃：原地下蹲蓄力 → 高抛物线腾空、身体略前倾 → 落地（尘土、震屏）→ 落地缓冲；总时长不变，到位时正对目标且步态归零', async () => {
    const scheduler = new Scheduler();
    const falls: Footfall[] = [];
    const m = new UnitMotion(scheduler, HOME, YAW, 'blade', (f) => falls.push(f));
    const g = GAITS.jump;
    const duration = MOTION_PROFILES.blade.approach.duration;
    let maxPitch = 0;
    let maxHop = 0;
    let maxSquash = 0;
    let airborne = 0;
    let movedDuringCrouch = false;
    const phases: MotionPhase[] = [];
    const done = m.moveTo(TARGET, duration, { x: -3, z: -2 }, { onAirborne: () => (airborne += 1) });
    let finished = false;
    void done.then(() => (finished = true));
    const real = await (async () => {
      let t = 0;
      for (let i = 0; i < 2000 && !finished; i++) {
        scheduler.update(1 / 240);
        t += 1 / 240;
        if (phases.at(-1) !== m.phase) phases.push(m.phase);
        if (m.phase === 'crouch') {
          maxSquash = Math.max(maxSquash, m.pose['root.squash'] ?? 0);
          if (m.ground.x !== HOME.x || m.ground.z !== HOME.z) movedDuringCrouch = true;
        }
        maxPitch = Math.max(maxPitch, m.gait.pitch);
        maxHop = Math.max(maxHop, m.gait.hop);
        await new Promise((r) => setImmediate(r));
      }
      return t;
    })();
    expect(real).toBeCloseTo(duration, 1);
    expect(phases).toEqual(['crouch', 'approach', 'land']);
    expect(movedDuringCrouch).toBe(false); // 原地下蹲
    expect(maxSquash).toBeGreaterThan(0.1);
    expect(airborne).toBe(1); // 离地的一瞬间通知一次
    expect(maxHop).toBeGreaterThan(g.hop * 0.95); // 高抛物线
    expect(maxPitch).toBeGreaterThan(0.1); // 腾空时前倾
    expect(falls.map((f) => f.kind)).toEqual(['start', 'end']); // 蹬地、落地，没有小碎步
    expect(falls[1]!.shake).toBeGreaterThan(0); // 落地轻微震屏
    expect(falls[1]!.dust).toBeGreaterThan(0);
    expect(m.ground).toEqual(TARGET);
    expect(wrapAngle(m.yaw - Math.atan2(-1, -1))).toBeCloseTo(0, 6); // 正对 face
    expect(m.gait).toEqual({ pitch: 0, roll: 0, hop: 0, spin: 0 });
    expect(m.atRest).toBe(true); // 落地缓冲后回到站姿
    expect(m.away).toBe(true);
  });

  it('跳回原位：面朝对手向后跳，落地缓冲后精确回到原位、原朝向、站姿', async () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'golem');
    await runFor(scheduler, m.moveTo(TARGET, MOTION_PROFILES.golem.approach.duration, { x: -3, z: -2 }));
    const phases: MotionPhase[] = [];
    let maxHop = 0;
    let finished = false;
    void m.returnHome(MOTION_PROFILES.golem.retreat.duration).then(() => (finished = true));
    for (let i = 0; i < 2000 && !finished; i++) {
      scheduler.update(1 / 240);
      if (phases.at(-1) !== m.phase) phases.push(m.phase);
      maxHop = Math.max(maxHop, m.gait.hop);
      await new Promise((r) => setImmediate(r));
    }
    if (phases.at(-1) !== m.phase) phases.push(m.phase);
    expect(phases).toEqual(['crouch', 'return', 'land', 'idle']);
    expect(maxHop).toBeGreaterThan(GAITS.slamJumpBack.hop * 0.95);
    expect(m.ground).toEqual(HOME);
    expect(m.yaw).toBe(YAW);
    expect(m.away).toBe(false);
    expect(m.atRest).toBe(true);
    expect(Object.keys(m.pose)).toEqual([]);
  });

  it('旋风斩的短跳跃：短促下蹲、沿弧线（中途偏离直线）腾空、途中旋身一整圈，落地时旋身归零', async () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'blade');
    let maxOff = 0;
    let maxSpin = 0;
    let maxHop = 0;
    const done = m.moveTo(TARGET, ATTACK_ANIM.whirlwind.leap.duration, undefined, { gait: 'whirlHop', side: 1 });
    let finished = false;
    void done.then(() => (finished = true));
    const len = Math.hypot(TARGET.x - HOME.x, TARGET.z - HOME.z);
    for (let i = 0; i < 1000 && !finished; i++) {
      scheduler.update(1 / 480);
      // 到起点-终点连线的距离
      const off = Math.abs((TARGET.x - HOME.x) * (HOME.z - m.ground.z) - (HOME.x - m.ground.x) * (TARGET.z - HOME.z)) / len;
      maxOff = Math.max(maxOff, off);
      maxSpin = Math.max(maxSpin, m.gait.spin);
      maxHop = Math.max(maxHop, m.gait.hop);
      await new Promise((r) => setImmediate(r));
    }
    expect(maxOff).toBeGreaterThan(len * GAITS.whirlHop.arc * 0.9);
    expect(maxSpin).toBeGreaterThan(Math.PI * 1.8);
    expect(maxHop).toBeGreaterThan(GAITS.whirlHop.hop * 0.9);
    expect(GAITS.whirlHop.hop).toBeLessThan(GAITS.jump.hop); // 比大跳跃低
    expect(GAITS.whirlHop.crouch!.duration).toBeLessThan(GAITS.jump.crouch!.duration); // 下蹲更短促
    expect(m.gait.spin).toBe(0);
    expect(m.ground).toEqual(TARGET);
  });

  it('各阶段依次进行，时长与配置一致；发力结束时正好摆到命中姿态，顿住期间姿态不变', async () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'spear');
    const move = moveOf('spear', 'melee', 0);
    const t = move.timing;
    expect(m.phase).toBe('idle');
    const a = m.windup('melee', t.anticipation, 0);
    expect(m.phase).toBe('anticipation');
    expect(await runFor(scheduler, a)).toBeCloseTo(t.anticipation, 1);
    // 蓄满：等于预备阶段最后一个关键姿态
    for (const [c, v] of Object.entries(move.ready.at(-1)!.pose)) expect(m.pose[c], c).toBeCloseTo(v, 6);
    const s = m.release('melee', t.strike, 0);
    expect(m.phase).toBe('strike');
    expect(await runFor(scheduler, s)).toBeCloseTo(t.strike, 1);
    const hitPose = { ...m.pose };
    for (const [c, v] of Object.entries(move.strike.at(-1)!.pose)) expect(hitPose[c], c).toBeCloseTo(v, 6);
    expect(hitPose['root.forward']).toBeGreaterThan(0.4); // 重心前压
    const h = m.hold(t.hold);
    expect(m.phase).toBe('hold');
    scheduler.update(t.hold / 2);
    expect(m.pose).toEqual(hitPose); // 顿住
    expect(m.shudder).toBeGreaterThan(0);
    await runFor(scheduler, h);
    expect(m.shudder).toBe(0);
    const f = m.follow(t.follow);
    expect(m.phase).toBe('follow');
    await runFor(scheduler, f);
    const r = m.recover(t.recover);
    expect(m.phase).toBe('recover');
    expect(await runFor(scheduler, r)).toBeCloseTo(t.recover, 1);
    expect(m.phase).toBe('idle');
    expect(m.atRest).toBe(true);
    expect(Object.keys(m.pose)).toEqual([]);
  });

  it('余势是平滑转回的：收招途中姿态连续变化，没有一帧之内的突然归零', async () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'blade');
    const t = moveOf('blade', 'melee', 0).timing;
    await runFor(scheduler, m.windup('melee', t.anticipation, 0));
    await runFor(scheduler, m.release('melee', t.strike, 0));
    await runFor(scheduler, m.follow(t.follow));
    let prev = { ...m.pose };
    let finished = false;
    void m.recover(t.recover).then(() => (finished = true));
    for (let i = 0; i < 1000 && !finished; i++) {
      scheduler.update(1 / 120);
      for (const c of Object.keys(prev)) expect(Math.abs((m.pose[c] ?? 0) - prev[c]!), c).toBeLessThan(0.2);
      prev = { ...prev, ...m.pose };
      for (const c of Object.keys(prev)) if (!(c in m.pose)) prev[c] = 0;
      await new Promise((r) => setImmediate(r));
    }
    expect(m.atRest).toBe(true);
  });

  it.each(ALL_MOTIONS)('%s：整套近战出手演完后回到原位、原朝向、站姿', async (motion) => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, motion);
    for (const variant of [MELEE.basic, MELEE.second, MELEE.heavy, MELEE.spin, MELEE.spinFinish]) {
      await runFor(scheduler, fullAttack(m, scheduler, motion, variant));
      expect(m.ground).toEqual(HOME);
      expect(m.yaw).toBe(YAW);
      expect(m.away).toBe(false);
      expect(m.phase).toBe('idle');
      expect(m.atRest, `${motion}#${variant}`).toBe(true);
      expect(Object.keys(m.gaitJoints)).toEqual([]);
    }
  });

  it.each(ALL_MOTIONS)('%s：跳过动画时立即完成，最终状态与正常播放完全相同，且没有落脚事件', async (motion) => {
    const scheduler = new Scheduler();
    scheduler.setSkip(true);
    const falls: Footfall[] = [];
    const m = new UnitMotion(scheduler, HOME, YAW, motion, (f) => falls.push(f));
    await fullAttack(m, scheduler, motion); // 不推进调度器也能完成
    expect(scheduler.pending).toBe(0);
    expect(m.ground).toEqual(HOME);
    expect(m.yaw).toBe(YAW);
    expect(m.away).toBe(false);
    expect(m.phase).toBe('idle');
    expect(m.atRest).toBe(true);
    expect(falls).toEqual([]);
    // 施法、射箭同理
    for (const style of ['cast', 'bow', 'bowUp'] as const) {
      await m.windup(style, 0.5);
      await m.release(style, 0.1);
      await m.hold(0.05);
      await m.follow(0.2);
      await m.recover(0.3);
      expect(m.atRest, style).toBe(true);
      expect(m.phase).toBe('idle');
    }
  });

  it('演到一半打开跳过动画：进行中的动作立即落到终点，后续阶段照常完成并回到站姿', async () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'wolf');
    const attack = fullAttack(m, scheduler, 'wolf');
    for (let i = 0; i < 60; i++) {
      scheduler.update(1 / 120);
      await new Promise((r) => setImmediate(r));
    }
    expect(m.away).toBe(true); // 正在扑跃途中
    scheduler.setSkip(true);
    await attack;
    expect(m.ground).toEqual(HOME);
    expect(m.yaw).toBe(YAW);
    expect(m.atRest).toBe(true);
    expect(m.phase).toBe('idle');
  });

  it('倍速缩放：2 倍速下整套动作用时减半，最终状态相同', async () => {
    const time = async (scale: number): Promise<number> => {
      const scheduler = new Scheduler();
      scheduler.setTimeScale(scale);
      const m = new UnitMotion(scheduler, HOME, YAW, 'golem');
      const real = await runFor(scheduler, fullAttack(m, scheduler, 'golem'));
      expect(m.atRest).toBe(true);
      expect(m.ground).toEqual(HOME);
      return real;
    };
    const normal = await time(1);
    const fast = await time(2);
    const profile = MOTION_PROFILES.golem;
    const t = moveOf('golem', 'melee', 0).timing;
    const expected = profile.approach.duration + t.anticipation + t.strike + t.hold + t.follow + t.beat + t.recover + profile.retreat.duration;
    expect(normal).toBeGreaterThan(expected - 0.05);
    expect(normal).toBeLessThan(expected + 0.1); // 下蹲、落地缓冲都算在来回的时长里
    expect(fast / normal).toBeGreaterThan(0.46);
    expect(fast / normal).toBeLessThan(0.54);
  });

  it('旋转过整圈之后不会倒转回来：下一个阶段从折回后的角度出发', async () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'blade');
    const t = moveOf('blade', 'melee', MELEE.spinFinish).timing;
    await runFor(scheduler, m.windup('melee', t.anticipation, MELEE.spinFinish));
    await runFor(scheduler, m.release('melee', t.strike, MELEE.spinFinish));
    expect(m.pose['root.turn']).toBeGreaterThan(Math.PI * 3.9);
    let maxTurn = 0;
    let finished = false;
    void m.follow(t.follow).then(() => (finished = true));
    for (let i = 0; i < 500 && !finished; i++) {
      scheduler.update(1 / 120);
      maxTurn = Math.max(maxTurn, Math.abs(m.pose['root.turn'] ?? 0));
      await new Promise((r) => setImmediate(r));
    }
    expect(maxTurn).toBeLessThan(1); // 余势里只剩一点点转身，没有把那两圈倒着转回去
  });
});

describe('次级运动：披风、袍摆、链条的惯性', () => {
  const step = (m: UnitMotion, scheduler: Scheduler, x: number, enabled = true, active = true): void => {
    scheduler.update(1 / 60);
    m.updateSecondary(scheduler.delta, x, 1, 0, enabled, active);
  };

  it('身体向前冲时偏移量指向后方；停下后先向前甩出再回落到 0；偏移量不超过上限', () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'blade');
    step(m, scheduler, 0);
    let x = 0;
    let minPush = 0;
    for (let i = 0; i < 20; i++) {
      x += 0.2; // 12 米 / 秒
      step(m, scheduler, x);
      minPush = Math.min(minPush, m.push.x);
      expect(Math.hypot(m.push.x, m.push.y, m.push.z)).toBeLessThanOrEqual(SECONDARY_MOTION.maxOffset + 1e-9);
    }
    expect(minPush).toBeLessThan(-0.2); // 被甩在身后
    expect(m.flutter).toBeGreaterThan(0);
    let maxPush = -1;
    for (let i = 0; i < 12; i++) {
      step(m, scheduler, x); // 刚停下的一小段（演出还没结束）
      maxPush = Math.max(maxPush, m.push.x);
    }
    expect(maxPush).toBeGreaterThan(0.03); // 停下后惯性向前甩出
    // 演出结束（身体不再动）后，甩动在 settle 秒内平滑归零，不留余摆
    let prev = Math.abs(m.push.x);
    const frames = Math.ceil(SECONDARY_MOTION.settle * 60) + 1;
    for (let i = 0; i < frames; i++) {
      step(m, scheduler, x, true, false);
      if (i < frames - 2) expect(Math.abs(Math.abs(m.push.x) - prev)).toBeLessThan(0.12); // 平滑，没有一帧跳变
      prev = Math.abs(m.push.x);
    }
    expect(m.push).toEqual({ x: 0, y: 0, z: 0 });
    expect(m.flutter).toBe(0);
    expect(SECONDARY_MOTION.settle).toBeLessThan(0.32); // 比镜头复位快，出手演完时已经静止
  });

  it('跳过动画或关闭次级运动（低画质）时没有任何残留', () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'blade');
    step(m, scheduler, 0);
    step(m, scheduler, 0.3);
    expect(m.push.x).not.toBe(0);
    scheduler.setSkip(true);
    step(m, scheduler, 5); // 跳过动画时单位瞬间换了位置
    expect(m.push).toEqual({ x: 0, y: 0, z: 0 });
    expect(m.flutter).toBe(0);
    scheduler.setSkip(false);
    step(m, scheduler, 5);
    expect(m.push.x).toBeCloseTo(0, 6); // 没有被那次瞬移甩一下
    step(m, scheduler, 5.3);
    step(m, scheduler, 5.6, false);
    expect(m.push).toEqual({ x: 0, y: 0, z: 0 });
    expect(ATTACK_ANIM.lowQuality.secondary).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 编排：各阶段的先后与时长
// ---------------------------------------------------------------------------

function snapshot(id: UnitId, side: Side, col: 0 | 1 | 2): UnitSnapshot {
  return {
    id,
    templateId: 'test',
    name: id,
    side,
    kind: side === 'ally' ? 'hero' : 'enemy',
    classId: 'physical',
    slot: { row: 0, col },
    attackMode: 'melee',
    stats: { maxHp: 100, maxMp: 50, physAtk: 10, magAtk: 10, defense: 0, speed: 10 },
    hp: 100,
    mp: 50,
  };
}

interface Mark {
  name: string;
  at: number; // 开始时的演出时间
  duration: number;
}

/** 演一段事件脚本，记录出手者每个动作阶段开始的时间和时长 */
async function playTimed(script: BattleEventInput[], opts: { motion?: MotionId; skip?: boolean; scale?: number } = {}) {
  const scheduler = new Scheduler();
  scheduler.setSkip(opts.skip ?? false);
  scheduler.setTimeScale(opts.scale ?? 1);
  const fakes = createFakes(scheduler);
  const marks: Mark[] = [];
  const bus = new EventBus();
  const director = new BattleDirector(bus, fakes.stage, fakes.hud, scheduler, { skillName: (id) => id, isBasicSkill: () => true });
  let seq = 0;
  const emit = (e: BattleEventInput): void => bus.emit({ ...e, seq: (seq += 1), turn: 1 } as BattleEvent);
  emit({ type: 'BattleStart', units: [snapshot('A0', 'ally', 0), ...(['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'] as const).map((id, i) => snapshot(id, 'enemy', i as 0))] });
  await director.idle();
  // 给出手者换上指定的动作档案，并给每个阶段打时间戳
  const actor = fakes.stage.unit('A0') as { -readonly [K in keyof StageUnit]: StageUnit[K] };
  if (opts.motion) actor.motion = opts.motion;
  for (const name of ['brace', 'moveTo', 'windup', 'release', 'hold', 'follow', 'recover', 'returnHome'] as const) {
    const original = actor[name] as (...args: unknown[]) => Promise<void>;
    (actor as Record<string, unknown>)[name] = (...args: unknown[]) => {
      const duration = (name === 'windup' || name === 'release' || name === 'moveTo' ? args[1] : args[0]) as number;
      marks.push({ name, at: scheduler.time, duration });
      return original(...args);
    };
  }
  const start = scheduler.time;
  for (const e of script) emit(e);
  let frames = 0;
  await pump(scheduler, director.idle(), () => (frames += 1));
  return { fakes, marks, seconds: scheduler.time - start, frames };
}

const cast = (o: Partial<Extract<BattleEventInput, { type: 'SkillCast' }>> = {}): BattleEventInput => ({
  type: 'SkillCast', actorId: 'A0', skillId: 'skill', delivery: 'melee', animation: 'meleeStrike', meleeCharge: true, element: 'none',
  targets: ['E0'], mpCost: 0, mpBefore: 50, mpAfter: 50, ...o,
});
const hit = (targetId: UnitId, stepIndex: number, o: Partial<Extract<BattleEventInput, { type: 'HitResolved' }>> = {}): BattleEventInput => ({
  type: 'HitResolved', actorId: 'A0', targetId, skillId: 'skill', stepIndex, stepCount: 7, hitIndex: 0, hitCount: 1, damageType: 'physical',
  isMiss: false, isCrit: false, defended: false, damage: 10, hpBefore: 100, hpAfter: 90, killed: false, ...o,
});
const act = (body: BattleEventInput[]): BattleEventInput[] => [
  { type: 'UnitActStart', actorId: 'A0', command: { kind: 'attack', targetId: 'E0' } },
  ...body,
  { type: 'UnitActEnd', actorId: 'A0' },
];
const names = (marks: Mark[]): string[] => marks.map((m) => m.name);
const ENEMIES = ['E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6'] as const;

describe('编排：进攻的节奏', () => {
  it('近战普攻：冲刺 → 预备 → 发力 → 命中顿住 → 余势 → 停一拍 → 收招 → 回位，各阶段时长取自动作档案', async () => {
    for (const motion of ['blade', 'sword', 'spear'] as const) {
      const { marks, fakes } = await playTimed(act([cast(), hit('E0', 0)]), { motion });
      const t = moveOf(motion, 'melee', 0).timing;
      expect(names(marks), motion).toEqual(['moveTo', 'windup', 'release', 'hold', 'follow', 'recover', 'returnHome']);
      const by = Object.fromEntries(marks.map((m) => [m.name, m]));
      expect(by['moveTo']!.duration).toBe(MOTION_PROFILES[motion].approach.duration);
      expect(by['windup']!.duration).toBe(t.anticipation);
      expect(by['release']!.duration).toBe(t.strike);
      expect(by['hold']!.duration).toBe(t.hold);
      expect(by['follow']!.duration).toBe(t.follow);
      expect(by['recover']!.duration).toBe(t.recover);
      expect(by['returnHome']!.duration).toBe(MOTION_PROFILES[motion].retreat.duration);
      // 每个阶段在上一个阶段结束之后才开始（调度器每帧 0.05 秒，留一帧的余量）
      for (let i = 1; i < marks.length; i++) {
        expect(marks[i]!.at, `${motion}: ${marks[i]!.name}`).toBeGreaterThanOrEqual(marks[i - 1]!.at + marks[i - 1]!.duration - 1e-6);
      }
      // 余势之后停一拍才收招
      expect(by['recover']!.at - by['follow']!.at).toBeGreaterThanOrEqual(t.follow + t.beat - 1e-6);
      // 受击、飘字发生在发力结束（命中）的那一刻，不早于它
      expect(fakes.log.indexOf('floater:E0:-10')).toBeGreaterThan(fakes.log.indexOf('release-melee:A0'));
      expect(fakes.log.indexOf('floater:E0:-10')).toBeLessThan(fakes.log.indexOf('hold:A0'));
      // 普攻也拖出武器光轨，结束后收掉
      expect(fakes.log).toContain('trail:A0:true');
      expect(fakes.log.lastIndexOf('trail:A0:false')).toBeGreaterThan(fakes.log.lastIndexOf('trail:A0:true'));
    }
  });

  it('狼 / 魔偶：起跳的下蹲蓄力包含在跳跃里；魔偶的砸拳带冲击波、重击反馈，来回都更慢', async () => {
    const wolf = await playTimed(act([cast(), hit('E0', 0)]), { motion: 'wolf' });
    expect(names(wolf.marks).slice(0, 2)).toEqual(['moveTo', 'windup']);
    expect(wolf.marks[0]!.duration).toBe(MOTION_PROFILES.wolf.approach.duration);
    expect(wolf.fakes.log.some((l) => l.startsWith('burst-shockwave'))).toBe(false);

    const golem = await playTimed(act([cast(), hit('E0', 0)]), { motion: 'golem' });
    expect(names(golem.marks).slice(0, 2)).toEqual(['moveTo', 'windup']);
    const slam = moveOf('golem', 'melee', 0);
    expect(golem.fakes.log).toContain(`burst-shockwave@${slam.fx!.shockwave}`);
    expect(golem.fakes.log).toContain('burst-heavyImpact'); // 目标受击反馈更重
    expect(golem.fakes.log).toContain(`cam-shake:${slam.fx!.shake}`);
    expect(golem.seconds).toBeGreaterThan(wolf.seconds + 0.5);
  });

  it('连击：第二击不重新冲锋，换第二式；狼是撕咬接爪击', async () => {
    const { marks, fakes } = await playTimed(
      act([
        cast(),
        hit('E0', 0, { stepCount: 2, hitCount: 2 }),
        { type: 'PassiveTriggered', unitId: 'A0', passiveId: 'double_strike', name: '连击', targetId: 'E0' },
        hit('E0', 1, { stepCount: 2, hitIndex: 1, hitCount: 2, hpBefore: 90, hpAfter: 80 }),
      ]),
      { motion: 'wolf' },
    );
    expect(names(marks)).toEqual(['moveTo', 'windup', 'release', 'hold', 'follow', 'windup', 'release', 'hold', 'follow', 'recover', 'returnHome']);
    expect(fakes.log.filter((l) => l.startsWith('variant:A0:'))).toEqual([`variant:A0:${MELEE.basic}`, `variant:A0:${MELEE.second}`]);
    expect(moveOf('wolf', 'melee', MELEE.basic).label).toContain('撕咬');
    expect(moveOf('wolf', 'melee', MELEE.second).label).toContain('爪击');
  });

  it('连斩：3 击各自有预备 → 发力 → 顿住 → 余势，前一击的余势直接接下一击，最后才收招', async () => {
    const { marks } = await playTimed(
      act([
        cast({ animation: 'comboSlash' }),
        hit('E0', 0, { hitIndex: 0, hitCount: 3 }),
        hit('E0', 1, { hitIndex: 1, hitCount: 3, hpBefore: 90, hpAfter: 80 }),
        hit('E0', 2, { hitIndex: 2, hitCount: 3, hpBefore: 80, hpAfter: 70 }),
      ]),
    );
    const beat = ['windup', 'release', 'hold', 'follow'];
    expect(names(marks)).toEqual(['moveTo', ...beat, ...beat, ...beat, 'recover', 'returnHome']);
    const windups = marks.filter((m) => m.name === 'windup').map((m) => m.duration);
    // 第 3 击（跃起重劈）蓄力最久
    expect(windups[2]).toBeGreaterThan(windups[0]!);
    expect(windups[2]).toBeGreaterThan(windups[1]!);
  });

  it('旋风斩：7 次攻击节奏有变化——前几下快，越往后越沉，最后一击最慢；目标之间是连续的短跳跃，整体按 pace 放慢', async () => {
    const { marks, fakes } = await playTimed(act([cast({ animation: 'whirlwind', targets: [...ENEMIES] }), ...ENEMIES.map((id, i) => hit(id, i))]));
    const strikes = marks.filter((m) => m.name === 'release');
    expect(strikes).toHaveLength(7);
    // 相邻两次命中之间的间隔
    const gaps = strikes.slice(1).map((s, i) => s.at - strikes[i]!.at);
    expect(Math.min(...gaps.slice(0, 3))).toBeLessThan(gaps[4]!); // 前几下更快
    expect(gaps[5]!).toBeGreaterThan(Math.max(...gaps.slice(0, 5))); // 最后一击之前间隔最长
    expect(strikes[6]!.duration).toBeGreaterThan(strikes[0]!.duration * 3); // 最后一击自己也更慢
    // 第 2~7 个目标是跃过去的（6 次），时长按节奏表缩放
    const leaps = marks.filter((m) => m.name === 'moveTo').slice(1);
    expect(leaps).toHaveLength(6);
    const W = ATTACK_ANIM.whirlwind;
    expect(leaps[0]!.duration).toBeCloseTo(W.leap.duration * W.tempo[1]! * W.pace, 9);
    expect(W.pace).toBeGreaterThan(1); // 比 v0.4 慢
    // 每一击之后都停一下再跳（最后一击之前的 6 次）：相邻两次命中的间隔不小于 跳跃 + 停顿
    for (let i = 1; i < 6; i++) {
      const gap = strikes[i]!.at - strikes[i - 1]!.at;
      expect(gap, `第 ${i} 个间隔`).toBeGreaterThanOrEqual(leaps[i - 1]!.duration + W.hitPause * W.pace - 1e-6);
    }
    expect(leaps[4]!.duration).toBeGreaterThan(leaps[0]!.duration);
    // 最后一击：冲击波 + 重击；打完才收招、回位
    expect(fakes.log.filter((l) => l.startsWith('burst-shockwave'))).toHaveLength(1);
    expect(names(marks).slice(-2)).toEqual(['recover', 'returnHome']);
    expect(fakes.away.size).toBe(0);
  });

  it('旋风斩：目标死亡或不足时自动跳过，不出现空挥', async () => {
    // 7 个目标里只有 3 个有结算（其余在出手前已死亡，逻辑层不发事件）
    const { marks, fakes } = await playTimed(
      act([cast({ animation: 'whirlwind', targets: [...ENEMIES] }), hit('E0', 0), hit('E3', 3), hit('E6', 6)]),
    );
    expect(marks.filter((m) => m.name === 'release')).toHaveLength(3);
    expect(marks.filter((m) => m.name === 'moveTo')).toHaveLength(3);
    expect(fakes.log.filter((l) => l.startsWith('slash:'))).toHaveLength(3);
    for (const id of ['E1', 'E2', 'E4', 'E5']) expect(fakes.log.some((l) => l.endsWith(`:${id}`)), id).toBe(false);
  });

  it('弓箭与施法：原地完成，也有预备 → 发力 → 顿住 → 余势 → 收招', async () => {
    const bow = await playTimed(act([cast({ delivery: 'ranged', animation: 'bowShot', meleeCharge: false }), hit('E0', 0)]), { motion: 'bow' });
    expect(names(bow.marks)).toEqual(['windup', 'release', 'hold', 'follow', 'recover']);
    const rain = await playTimed(
      act([cast({ delivery: 'ranged', animation: 'arrowRain', meleeCharge: false, targets: [...ENEMIES] }), ...ENEMIES.map((id, i) => hit(id, i))]),
      { motion: 'bow' },
    );
    expect(names(rain.marks)).toEqual(['windup', 'release', 'hold', 'follow', 'recover']);
    expect(rain.marks[0]!.duration).toBe(moveOf('bow', 'bowUp', 0).timing.anticipation);
    expect(rain.marks[0]!.duration).toBeGreaterThan(bow.marks[0]!.duration); // 箭雨拉弓更久

    const spell = await playTimed(
      act([cast({ delivery: 'cast', animation: 'groupSpellSmall', meleeCharge: false, element: 'fire', targets: ['E0', 'E1', 'E2'] }), ...['E0', 'E1', 'E2'].map((id) => hit(id, 0, { damageType: 'magic' }))]),
      { motion: 'dragon' },
    );
    expect(names(spell.marks)).toEqual(['windup', 'release', 'hold', 'follow', 'recover']);
    expect(spell.fakes.log).toContain('aura-gather'); // 张口蓄火：光团在施法点汇聚
    const staff = await playTimed(act([cast({ delivery: 'cast', animation: 'castBolt', meleeCharge: false, element: 'fire' }), hit('E0', 0, { damageType: 'magic' })]), { motion: 'staff' });
    expect(staff.fakes.log).not.toContain('aura-gather'); // 有法杖的靠法杖发光
    expect(names(staff.marks)).toEqual(['windup', 'release', 'hold', 'follow', 'recover']);
  });

  it('倍速：2 倍速下同一次出手的演出时间不变、真实帧数减半', async () => {
    const script = act([cast({ animation: 'whirlwind', targets: [...ENEMIES] }), ...ENEMIES.map((id, i) => hit(id, i))]);
    const normal = await playTimed(script, { scale: 1 });
    const fast = await playTimed(script, { scale: 2 });
    expect(fast.frames / normal.frames).toBeGreaterThan(0.42);
    expect(fast.frames / normal.frames).toBeLessThan(0.58);
    expect(names(fast.marks)).toEqual(names(normal.marks));
  });

  it('跳过动画：所有阶段照常依次调用，不占用任何演出时间，结尾状态复原', async () => {
    for (const motion of ['blade', 'wolf', 'golem'] as const) {
      const { marks, fakes, seconds } = await playTimed(
        act([cast({ animation: 'whirlwind', targets: [...ENEMIES] }), ...ENEMIES.map((id, i) => hit(id, i))]),
        { motion, skip: true },
      );
      expect(seconds).toBeLessThanOrEqual(0.05); // 最多只过了测试泵的一帧
      expect(marks.filter((m) => m.name === 'release')).toHaveLength(7);
      expect(names(marks).at(-1)).toBe('returnHome');
      expect(fakes.away.size).toBe(0);
      expect(fakes.log.lastIndexOf('trail:A0:false')).toBeGreaterThan(fakes.log.lastIndexOf('trail:A0:true'));
      expect(fakes.log.filter((l) => l.startsWith('glow:A0:')).pop()).toBe('glow:A0:1');
      expect(fakes.log.filter((l) => l.startsWith('cam-')).pop()).toBe('cam-reset');
      for (const id of ENEMIES) expect(fakes.hp.get(id)).toBe(90);
    }
  });
});

// 阶段名在联系表里要用到：保证类型里的每个阶段都有
const PHASES: MotionPhase[] = ['idle', 'crouch', 'approach', 'land', 'anticipation', 'strike', 'hold', 'follow', 'recover', 'crouch', 'return', 'land'];
describe('阶段', () => {
  it('一次近战出手依次经过全部阶段', async () => {
    const scheduler = new Scheduler();
    const m = new UnitMotion(scheduler, HOME, YAW, 'wolf');
    const seen: MotionPhase[] = [m.phase];
    let finished = false;
    void fullAttack(m, scheduler, 'wolf').then(() => (finished = true));
    for (let i = 0; i < 5000 && !finished; i++) {
      scheduler.update(1 / 120);
      if (seen.at(-1) !== m.phase) seen.push(m.phase);
      await new Promise((r) => setImmediate(r));
    }
    if (seen.at(-1) !== m.phase) seen.push(m.phase);
    expect(seen).toEqual(PHASES.concat('idle'));
  });
});

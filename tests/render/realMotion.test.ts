import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getRig } from '../../src/assets/models/characters/rig';
import { getEquippedWeapon } from '../../src/assets/models/weapons';
import { EventBus, type BattleEvent, type BattleEventInput } from '../../src/core/events';
import { ATTACK_ANIM, CAST, LEFT_GRIP, MOUNTED_STAFF, moveOf } from '../../src/data/attackAnimConfig';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { BattleDirector } from '../../src/render/director/BattleDirector';
import { Scheduler } from '../../src/render/director/Scheduler';
import type { UnitView } from '../../src/render/units/UnitView';
import { snapshotOf } from '../../src/ui/showcase/showcaseScript';
import { buildSkillDemos } from '../../src/ui/showcase/skillDemoScripts';
import { createFakes, pump } from './directorFakes';
import { ALL_TEMPLATES, createRealViews, poseDiff, poseSnapshot } from './realStage';

// 步骤 11b：用真实模型（真实关节）检查进攻动画的结果——
//   1. 每个技能演示（含连击、跳过动画、2 倍速）演完后，所有单位的根节点和全部关节回到演出前的基准姿态；
//   2. 拉弓：弓弦被拉成 V 形，弦的中点跟着拉弦手；松弦后弦回到直线；
//   3. 双手握杖：左手握在杖身上（英雄的法杖和敌方祭司长在模型上的杖都一样）。

const UNITS = ALL_TEMPLATES.map(snapshotOf);
const DEMOS = buildSkillDemos(UNITS);

/** 按技能演示页的做法演一个演示：开场 → 铺垫事件 → 记下基准 → 正式事件 → 比对 */
async function playDemo(id: string, mode: { skip?: boolean; scale?: number }): Promise<string[]> {
  const demo = DEMOS.find((d) => d.id === id)!;
  const scheduler = new Scheduler();
  if (mode.scale) scheduler.setTimeScale(mode.scale);
  const fakes = createFakes(scheduler);
  const views = createRealViews(scheduler);
  fakes.stage.unit = (uid) => views.get(uid)!;
  const bus = new EventBus();
  const director = new BattleDirector(bus, fakes.stage, fakes.hud, scheduler, { skillName: (s) => s, isBasicSkill: () => true });
  let seq = 0;
  const emit = (e: BattleEventInput): void => bus.emit({ ...e, seq: (seq += 1), turn: 1 } as BattleEvent);
  const frame = (): void => {
    for (const v of views.values()) v.update(scheduler.time, 0);
  };
  const run = (): Promise<void> => pump(scheduler, director.idle(), frame);
  emit({ type: 'BattleStart', units: UNITS });
  for (const e of demo.setup) emit(e);
  await run();
  frame();
  const standing = (v: UnitView): boolean => !fakes.dead.has(v.id) && !v.guarding;
  const before = new Map([...views].filter(([, v]) => standing(v)).map(([uid, v]) => [uid, poseSnapshot(v)]));
  scheduler.setSkip(mode.skip ?? false);
  for (const e of demo.events) emit(e);
  await run();
  frame();
  const problems: string[] = [];
  for (const [uid, v] of views) {
    if (v.away) problems.push(`${uid} 没有回到站位`);
    if (!fakes.dead.has(uid) && v.fallen > 0) problems.push(`${uid} 没有阵亡却倒在地上`);
    const base = before.get(uid);
    if (!base || !standing(v)) continue;
    const diff = poseDiff(base, poseSnapshot(v), 1e-5);
    if (diff.length > 0) problems.push(`${uid}：${diff.slice(0, 3).join('; ')}`);
  }
  return problems;
}

const MELEE_DEMOS = ['basic_blade', 'basic_sword', 'basic_spear', 'combo', 'whirlwind', 'double_strike', 'wolf_basic', 'golem_basic', 'golem_double'];
const RANGED_CAST_DEMOS = ['basic_bow', 'triple_shot', 'arrow_rain', 'basic_magic', 'single_spell', 'group_spell', 'seal', 'triple_spell', 'ghost_spell', 'group_heal', 'revive'];

describe('真实模型：演出结束后所有单位回到基准姿态', () => {
  it.each([...MELEE_DEMOS, ...RANGED_CAST_DEMOS])('%s：1 倍速 / 2 倍速 / 跳过动画', async (id) => {
    expect(await playDemo(id, {}), '1 倍速').toEqual([]);
    expect(await playDemo(id, { scale: 2 }), '2 倍速').toEqual([]);
    expect(await playDemo(id, { skip: true }), '跳过动画').toEqual([]);
  }, 60_000);

  it('演示清单里有要求的全部进攻', () => {
    const ids = new Set(DEMOS.map((d) => d.id));
    for (const id of [...MELEE_DEMOS, ...RANGED_CAST_DEMOS]) expect(ids.has(id), id).toBe(true);
  });
});

/** 造一个单位，摆好某个动作姿态（不经过补间），画一帧 */
function posed(templateId: (t: (typeof ALL_TEMPLATES)[number]) => boolean, pose: Record<string, number>): UnitView {
  const t = ALL_TEMPLATES.find(templateId)!;
  const view = createRealViews(new Scheduler(), [t]).get(t.id)!;
  const internal = view as unknown as { act: { pose: Record<string, number> }; idleWeight: number };
  Object.assign(internal.act.pose, pose);
  internal.idleWeight = 0;
  view.update(0, 0);
  view.model.updateMatrixWorld(true);
  return view;
}

const world = (o: { getWorldPosition(v: Vector3): Vector3 }): Vector3 => o.getWorldPosition(new Vector3());

describe('真实模型：拉弓', () => {
  const isArcher = (t: (typeof ALL_TEMPLATES)[number]): boolean => t.weaponId === 'bow';

  it.each([
    ['平射', 'bow', 0],
    ['速射', 'bow', 1],
    ['仰射（箭雨）', 'bowUp', 0],
  ] as const)('%s拉满：弓弦两段从弓梢连到右手，拉成 V 形，弓臂弯曲', (_name, style, variant) => {
    const view = posed(isArcher, moveOf('bow', style, variant).ready.at(-1)!.pose);
    const bow = getEquippedWeapon(view.model)!;
    const top = bow.getObjectByName('bowStringTop')!;
    const bottom = bow.getObjectByName('bowStringBottom')!;
    const limbs = bow.getObjectByName('bowLimbs')!;
    // 两段弦的终点（各自局部 +y 1 米处）汇在同一点：弦的中点
    const end = (seg: typeof top): Vector3 => seg.localToWorld(new Vector3(0, 1, 0));
    const nock = end(top);
    expect(nock.distanceTo(end(bottom))).toBeLessThan(1e-4);
    // 中点贴在拉弦手上
    const hand = world(getRig(view.model)!.armR.hand);
    expect(nock.distanceTo(hand)).toBeLessThan(0.08);
    // V 形：中点离两个弓梢连线（未拉时的弦）很远
    const tipA = world(top);
    const tipB = world(bottom);
    const line = tipB.clone().sub(tipA).normalize();
    const off = nock.clone().sub(tipA);
    const away = off.sub(line.multiplyScalar(off.dot(line))).length();
    expect(away).toBeGreaterThan(0.25);
    // 弓臂向后弯
    expect(limbs.scale.z).toBeGreaterThan(1.5);
    // 箭跟着弦的中点
    const arrow = bow.getObjectByName('arrow')!;
    expect(arrow.position.z).toBeLessThan(-0.3);
  });

  it('松弦后弦回到直线、弓臂复原', () => {
    const view = posed(isArcher, { ...moveOf('bow', 'bow', 0).ready.at(-1)!.pose });
    const internal = view as unknown as { act: { pose: Record<string, number> } };
    internal.act.pose['bow.draw'] = 0;
    view.update(0, 0);
    const bow = getEquippedWeapon(view.model)!;
    expect(bow.getObjectByName('bowLimbs')!.scale.z).toBe(1);
    const top = bow.getObjectByName('bowStringTop')!;
    const bottom = bow.getObjectByName('bowStringBottom')!;
    // 两段弦方向相反（连成一条直线）
    const dir = (seg: typeof top): Vector3 => new Vector3(0, 1, 0).applyQuaternion(seg.quaternion);
    expect(dir(top).dot(dir(bottom))).toBeCloseTo(-1, 6);
  });
});

describe('真实模型：双手握杖', () => {
  it.each([
    ['法师（英雄法杖）', (t: (typeof ALL_TEMPLATES)[number]) => t.weaponId === 'staff'],
    ['恶魔祭司（杖长在模型上）', (t: (typeof ALL_TEMPLATES)[number]) => t.templateId === 'enemy_demon_priest'],
    ['亡灵法师（杖长在模型上）', (t: (typeof ALL_TEMPLATES)[number]) => t.templateId === 'enemy_necromancer'],
  ] as const)('%s：挥杖的每个关键姿态里，左手都握在杖身上', (_name, which) => {
    const t = ALL_TEMPLATES.find(which)!;
    for (const variant of [CAST.point, CAST.seal, CAST.fire, CAST.thunder, CAST.groupFire, CAST.groupThunder]) {
      const move = moveOf('staff', 'cast', variant);
      for (const key of [...move.ready, ...move.strike]) {
        if ((key.pose['grip.left'] ?? 0) < 1) continue;
        const view = posed(which, key.pose);
        const rig = getRig(view.model)!;
        const weapon = getEquippedWeapon(view.model);
        const holder = weapon ?? rig.weaponMount;
        const grip = weapon ? LEFT_GRIP.weapon[t.weaponId!]! : LEFT_GRIP.mount;
        // 左手到杖身（默认握点上下可以滑动的那一段）的距离
        const [lo, hi] = ATTACK_ANIM.gripSlide;
        const a = holder.localToWorld(new Vector3(0, grip + lo, 0));
        const b = holder.localToWorld(new Vector3(0, grip + hi, 0));
        const hand = world(rig.armL.hand);
        const ab = b.clone().sub(a);
        const k = Math.max(0, Math.min(1, hand.clone().sub(a).dot(ab) / ab.lengthSq()));
        // 量的是手腕关节；手掌本身有几厘米厚，5 厘米以内画面上就是握在杖上
        expect(hand.distanceTo(a.addScaledVector(ab, k)), `${move.label}`).toBeLessThan(0.05);
      }
    }
    if (!t.weaponId) expect(MOUNTED_STAFF[t.templateId]).toBeDefined();
  }, 60_000);
});

// 场上的弓手、法杖施法者都在
it('默认阵容里有弓手、持法杖的英雄和敌方法杖施法者', () => {
  expect(ALLY_TEMPLATES.some((t) => t.weaponId === 'bow')).toBe(true);
  expect(ALLY_TEMPLATES.some((t) => t.weaponId === 'staff')).toBe(true);
  expect(ENEMY_TEMPLATES.some((t) => MOUNTED_STAFF[t.templateId])).toBe(true);
});

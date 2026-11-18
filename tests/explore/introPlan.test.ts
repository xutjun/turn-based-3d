import { describe, expect, it } from 'vitest';
import { INTRO_CONFIG } from '../../src/data/cutsceneConfig';
import { EXPLORE_CONFIG } from '../../src/data/exploreConfig';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { ENEMY_TEMPLATES } from '../../src/data/enemies';
import { facingOf, ROW_DIRECTION, slotPosition } from '../../src/data/formation';
import { clearance, type Obstacle } from '../../src/explore/collision';
import { ExploreWorld } from '../../src/explore/exploreWorld';
import {
  flightAt,
  flightObstacleMargin,
  flightSeparation,
  nearestStandable,
  planFlights,
  petEntryAt,
  petEntryMargin,
  planPetEntries,
  requiredSeparation,
  revealSpots,
  type FlightPlan,
  type Ground,
} from '../../src/explore/introPlan';
import { yawOf } from '../../src/explore/walker';

// 入场过场的走位规划（步骤 17）：显形站位、震飞路线、宝宝入场路线。纯计算。

const BOSS_T = ENEMY_TEMPLATES.find((t) => t.rank === 'boss')!;
const BOSS = slotPosition('enemy', BOSS_T.slot);
const world = new ExploreWorld(BOSS);
const LEADER = EXPLORE_CONFIG.leaderId;
const HEROES = ALLY_TEMPLATES.filter((t) => t.kind === 'hero');
const PETS = ALLY_TEMPLATES.filter((t) => t.kind === 'pet');
const TARGETS: Record<string, Ground> = Object.fromEntries(HEROES.map((t) => [t.id, slotPosition('ally', t.slot)]));
const MEMBERS = HEROES.filter((t) => t.id !== LEADER).map((t) => ({ id: t.id, slot: TARGETS[t.id]! }));

/** 两条线段（地面投影）是否相交 */
function segmentsCross(a: Ground, b: Ground, c: Ground, d: Ground): boolean {
  const cross = (o: Ground, p: Ground, q: Ground): number => (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Boss 自己的左手侧 / 右手侧（Boss 面朝友方），以及其余验收位置 */
const bossYaw = yawOf(facingOf('enemy').x, facingOf('enemy').z);
const bossLeft = { x: Math.cos(bossYaw), z: -Math.sin(bossYaw) };
const POSITIONS: Record<string, Ground> = {
  近: { x: BOSS.x + facingOf('enemy').x * EXPLORE_CONFIG.talkDistance, z: BOSS.z + facingOf('enemy').z * EXPLORE_CONFIG.talkDistance }, // 交谈点
  中: { x: BOSS.x + facingOf('enemy').x * 9, z: BOSS.z + facingOf('enemy').z * 9 },
  远: EXPLORE_CONFIG.start, // 出生点
  Boss左侧: { x: BOSS.x + bossLeft.x * 5.5, z: BOSS.z + bossLeft.z * 5.5 },
  Boss右侧: { x: BOSS.x - bossLeft.x * 5.5, z: BOSS.z - bossLeft.z * 5.5 },
  Boss身后: { x: BOSS.x - facingOf('enemy').x * 5, z: BOSS.z - facingOf('enemy').z * 5 },
};

function planFrom(p: Ground): { leader: { x: number; z: number; yaw: number }; flights: FlightPlan[]; reveal: ReturnType<typeof revealSpots> } {
  const at = nearestStandable(world, p.x, p.z);
  const leader = { x: at.x, z: at.z, yaw: yawOf(BOSS.x - at.x, BOSS.z - at.z) };
  const reveal = revealSpots(leader, MEMBERS, BOSS, world);
  const starts = [{ id: LEADER, x: leader.x, z: leader.z }, ...reveal];
  return { leader, reveal, flights: planFlights(starts, TARGETS, BOSS, world.obstacles) };
}

describe('入场过场走位：队员显形站位', () => {
  it('交谈点：4 人分在队长左右两侧各两人，都面向 Boss，彼此与队长隔开', () => {
    const { leader, reveal } = planFrom(POSITIONS['近']!);
    expect(reveal).toHaveLength(4);
    expect(new Set(reveal.map((r) => r.id))).toEqual(new Set(MEMBERS.map((m) => m.id)));
    // 左右各两人（相对队长朝向）
    const left = { x: Math.cos(leader.yaw), z: -Math.sin(leader.yaw) };
    const sides = reveal.map((r) => Math.sign((r.x - leader.x) * left.x + (r.z - leader.z) * left.z));
    expect(sides.filter((s) => s > 0)).toHaveLength(2);
    expect(sides.filter((s) => s < 0)).toHaveLength(2);
    const pts = [leader, ...reveal];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)).toBeGreaterThanOrEqual(INTRO_CONFIG.reveal.minGap - 1e-6);
      }
    }
    for (const r of reveal) {
      const want = yawOf(BOSS.x - r.x, BOSS.z - r.z);
      expect(Math.abs(r.yaw - want)).toBeLessThan(1e-9);
    }
  });

  it('谁站哪个站位取“到各自格子的总路程最短”：从任何方向开打，5 人的路线（地面投影的直线）两两不交叉', () => {
    for (const [name, p] of Object.entries(POSITIONS)) {
      const { leader, reveal } = planFrom(p);
      const starts = [{ id: LEADER, x: leader.x, z: leader.z }, ...reveal];
      for (let i = 0; i < starts.length; i++) {
        for (let j = i + 1; j < starts.length; j++) {
          const a = starts[i]!;
          const b = starts[j]!;
          expect(segmentsCross(a, TARGETS[a.id]!, b, TARGETS[b.id]!), `${name} ${a.id}-${b.id}`).toBe(false);
        }
      }
    }
    // 交谈点（正面）开打时，左右顺序与列号一致：左边两人是夜隼、雷咒，右边两人是缚魂、守誓
    const { reveal } = planFrom(POSITIONS['近']!);
    const along = (q: Ground): number => q.x * ROW_DIRECTION.x + q.z * ROW_DIRECTION.z;
    expect([...reveal].sort((a, b) => along(a) - along(b)).map((r) => r.id)).toEqual(['A0', 'A2', 'A3', 'A4']);
  });

  it('每个起点的显形站位都能站人：不在障碍物里、不出界', () => {
    for (const [name, p] of Object.entries(POSITIONS)) {
      const { reveal } = planFrom(p);
      for (const r of reveal) {
        expect(clearance(world.obstacles, r.x, r.z), `${name} ${r.id}`).toBeGreaterThanOrEqual(EXPLORE_CONFIG.collision.unitRadius);
        expect(Math.abs(r.x)).toBeLessThanOrEqual(17);
        expect(Math.abs(r.z)).toBeLessThanOrEqual(17);
      }
    }
  });

  it('队长贴着火盆时，落在障碍里的站位取最近的可走点', () => {
    const brazier = world.obstacles.find((o) => o.tag === 'brazier' && o.kind === 'circle')!;
    if (brazier.kind !== 'circle') throw new Error();
    const at = nearestStandable(world, brazier.x + 1.3, brazier.z);
    const leader = { x: at.x, z: at.z, yaw: yawOf(BOSS.x - at.x, BOSS.z - at.z) };
    for (const r of revealSpots(leader, MEMBERS, BOSS, world)) {
      expect(clearance(world.obstacles, r.x, r.z), r.id).toBeGreaterThanOrEqual(EXPLORE_CONFIG.collision.unitRadius);
    }
  });
});

describe('入场过场走位：震飞路线', () => {
  it('抛物线：两端在地面上、落点就是格子，最高点在中间', () => {
    const plan: FlightPlan = { id: 'A1', from: { x: 0, z: 0 }, to: { x: 4, z: 3 }, launch: 0, duration: 1, apex: 3, bend: 1, tumble: 'lean' };
    expect(flightAt(plan, 0)).toEqual({ x: 0, y: 0, z: 0 });
    const end = flightAt(plan, 1);
    expect(end.x).toBeCloseTo(4, 12);
    expect(end.z).toBeCloseTo(3, 12);
    expect(end.y).toBe(0);
    expect(flightAt(plan, 0.5).y).toBeCloseTo(3, 12);
  });

  it('直线穿过石柱时判为穿模；规划时会绕开或加高', () => {
    const pillar: Obstacle = { kind: 'circle', tag: 'pillar', x: 2, z: 0, r: 0.9 };
    const straight: FlightPlan = { id: 'X', from: { x: 0, z: 0 }, to: { x: 4, z: 0 }, launch: 0, duration: 1, apex: 3, bend: 0, tumble: 'lean' };
    expect(flightObstacleMargin(straight, [pillar]).margin).toBeLessThan(0);
    const brazier: Obstacle = { kind: 'circle', tag: 'brazier', x: 2, z: 0, r: 0.7 };
    // 火盆不高：够高的抛物线从上方越过；太低则判为穿模
    expect(flightObstacleMargin({ ...straight, apex: 4 }, [brazier]).margin).toBeGreaterThan(0);
    expect(flightObstacleMargin({ ...straight, apex: 1.2 }, [brazier]).margin).toBeLessThan(0);
    const [plan] = planFlights([{ id: 'A1', x: 0, z: 0 }], { A1: { x: 4, z: 0 } }, { x: -5, z: 0 }, [pillar]);
    expect(plan!.bend).not.toBe(0);
    expect(flightObstacleMargin(plan!, [pillar]).margin).toBeGreaterThanOrEqual(0);
  });

  it.each(Object.keys(POSITIONS))('从%s开打：5 人都落在自己的战斗格子上，路线不穿过火盆、石柱、Boss，空中不相撞', (name) => {
    const { flights } = planFrom(POSITIONS[name]!);
    expect(flights.map((f) => f.id).sort()).toEqual(HEROES.map((h) => h.id).sort());
    const f = INTRO_CONFIG.flight;
    for (const plan of flights) {
      const end = flightAt(plan, 1);
      // 落点误差为 0
      expect(end.x).toBe(TARGETS[plan.id]!.x);
      expect(end.z).toBe(TARGETS[plan.id]!.z);
      expect(Math.hypot(end.x - TARGETS[plan.id]!.x, end.z - TARGETS[plan.id]!.z)).toBeLessThan(1e-9);
      expect(end.y).toBe(0);
      const m = flightObstacleMargin(plan, world.obstacles);
      expect(m.margin, `${name} ${plan.id} 碰到 ${m.tag}`).toBeGreaterThanOrEqual(0);
      expect(plan.apex).toBeGreaterThanOrEqual(f.apex.min - 0.3);
      expect(plan.apex).toBeLessThanOrEqual(f.maxApex);
      expect(plan.duration).toBeGreaterThanOrEqual(f.duration.min);
      expect(plan.duration).toBeLessThanOrEqual(f.duration.max);
      // 冲击波到达的时刻 = 距离 / 速度
      const d = Math.hypot(plan.from.x - BOSS.x, plan.from.z - BOSS.z);
      expect(plan.launch).toBeCloseTo(d / INTRO_CONFIG.stomp.waveSpeed + f.launchDelay, 9);
    }
    for (let i = 0; i < flights.length; i++) {
      for (let j = i + 1; j < flights.length; j++) {
        const need = requiredSeparation(flights[i]!, flights[j]!);
        expect(need).toBeGreaterThan(0.95); // 起跳 / 落地时两人至少隔着显形站位的间距
        expect(flightSeparation(flights[i]!, flights[j]!), `${name} ${flights[i]!.id}-${flights[j]!.id}`).toBeGreaterThanOrEqual(need - 1e-6);
      }
    }
    // 不同的人最高点不同（不整齐划一）
    expect(new Set(flights.map((p) => p.apex.toFixed(2))).size).toBeGreaterThan(1);
  });
});

describe('入场过场走位：宝宝入场（从主人身后越过主人落到前排）', () => {
  const HERO_H = 2.0;
  const blocker = (t: (typeof ALLY_TEMPLATES)[number]) => ({ ...slotPosition('ally', t.slot), radius: t.kind === 'hero' ? 0.45 : 0.5, height: t.kind === 'hero' ? HERO_H : 1.0 });
  const ownerOf = (pet: (typeof PETS)[number]) => HEROES.find((h) => h.id === pet.ownerId)!;
  const entries = planPetEntries(
    PETS.map((t) => ({ id: t.id, templateId: t.templateId, col: t.slot.col, slot: slotPosition('ally', t.slot), owner: blocker(ownerOf(t)) })),
    ALLY_TEMPLATES.map(blocker),
  );

  it('每只宝宝落到主人正前方的前排格子，按列号依次出发，入场方式按种类', () => {
    expect(entries).toHaveLength(5);
    for (const e of entries) {
      const t = PETS.find((p) => p.id === e.id)!;
      expect(t.slot.row).toBe(0);
      expect(ownerOf(t).slot).toEqual({ row: 1, col: t.slot.col });
      const end = petEntryAt(e, 1);
      expect(end).toEqual({ x: slotPosition('ally', t.slot).x, y: 0, z: slotPosition('ally', t.slot).z });
    }
    const style = Object.fromEntries(entries.map((e) => [PETS.find((p) => p.id === e.id)!.templateId, e.style]));
    expect(style).toEqual({ pet_wolf_grey: 'leap', pet_wolf_red: 'leap', pet_bone_dragon: 'fly', pet_ghost: 'float', pet_golem: 'slam' });
    const starts = [...entries].sort((a, b) => a.start - b.start).map((e) => PETS.find((p) => p.id === e.id)!.slot.col);
    expect(starts).toEqual([0, 1, 2, 3, 4]);
  });

  it('从主人身后起跳（离敌方更远的一侧）', () => {
    const f = facingOf('ally');
    for (const e of entries) {
      const owner = blocker(ownerOf(PETS.find((p) => p.id === e.id)!));
      const back = -((e.from.x - owner.x) * f.x + (e.from.z - owner.z) * f.z);
      expect(back, e.id).toBeGreaterThan(1);
    }
  });

  it('全程不穿过主人和其他单位：狼、骨龙、幽灵从主人头顶越过；魔偶跳得低，从主人身侧绕过', () => {
    for (const e of entries) {
      const pet = PETS.find((p) => p.id === e.id)!;
      const owner = blocker(ownerOf(pet));
      const others = ALLY_TEMPLATES.filter((t) => t.id !== pet.id).map(blocker);
      expect(petEntryMargin(e, others), e.id).toBeGreaterThanOrEqual(0);
      // 经过主人上方 / 身旁的那一刻
      let closest = Infinity;
      let yThere = 0;
      for (let i = 1; i < 100; i++) {
        const q = petEntryAt(e, i / 100);
        const d = Math.hypot(q.x - owner.x, q.z - owner.z);
        if (d < closest) {
          closest = d;
          yThere = q.y;
        }
      }
      if (e.style === 'slam') {
        expect(e.apex, e.id).toBeLessThan(HERO_H); // 不越顶
        expect(closest, e.id).toBeGreaterThan(owner.radius + INTRO_CONFIG.pets.bodyRadius); // 从身侧绕过
      } else {
        expect(yThere, e.id).toBeGreaterThanOrEqual(HERO_H + INTRO_CONFIG.pets.overClear - 0.05); // 从头顶越过
      }
    }
  });
});

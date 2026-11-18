// 探索模式的场景布置（步骤 14、15，DESIGN §11.2）：复用战场和同一批单位（BattleStage 的 UnitView），按模式切换。
//   - 进入探索：只显示队长（烬刃）和 Boss（原战斗位置，待机）；4 名队员、宝宝和其余 9 个敌人隐藏（步骤 15，§9.12 H1）；
//   - 每帧：队长的移动（src/explore/agent.ts：寻路、跑步、碰撞）写到 UnitView，单位按跑过的距离迈步；相机平滑跟随；
//   - 点击地面：寻路跑过去，地面显示点击标记；悬停 Boss：轮边光高亮；
//   - 点击 Boss（步骤 16）：跑到交谈点、面向 Boss 后通知界面层弹出对话框（onTalk）；对话中禁止移动，
//     镜头注视点移到队长与 Boss 之间并略微拉近；说话人做小动作（setGesture）；
//   - 离开探索：所有单位回到战斗站位、全部显示，相机回到战斗的固定机位。
//   - 战后（步骤 19）：战后过场播完后从队长此刻的位置接着探索（resume）；胜利后 Boss 不在场（不显示、不挡路、点不到），
//     “再挑战一次”时 Boss 先挡路（beginBossReturn），出现演出播完后才能点击对话（finishBossReturn）。
// 战斗代码看到的永远是同一批 UnitView，探索不改战斗规则和演出。

import type { Object3D } from 'three';
import type { UnitId, UnitTemplate } from '../../core/types';
import type { DialogueAction, EmotePose } from '../../data/dialogues';
import { EXPLORE_CONFIG } from '../../data/exploreConfig';
import { facingOf } from '../../data/formation';
import { LeaderAgent } from '../../explore/agent';
import { CameraFollow } from '../../explore/cameraFollow';
import { ExploreSession, type TalkPhase } from '../../explore/exploreSession';
import { ExploreWorld } from '../../explore/exploreWorld';
import type { PathResult, Pt } from '../../explore/pathfinder';
import { nearestStandable, type GroundPose } from '../../explore/introPlan';
import { yawOf } from '../../explore/walker';
import type { BattleCamera } from '../camera/battleCamera';
import type { BattleStage } from '../units/BattleStage';
import { ClickMarker } from './ClickMarker';

/** 调试：探索模式的状态（window.__app.explore()） */
export interface ExploreSnapshot {
  active: boolean;
  leader: UnitId;
  visible: UnitId[];
  units: Record<UnitId, { x: number; z: number; yaw: number; speed: number; walk: number }>;
  /** 正在去的终点（没有为 null）与剩下的路点 */
  destination: Pt | null;
  path: Pt[];
  /** 鼠标是否指着 Boss、Boss 的高亮程度 */
  bossHover: boolean;
  bossHighlight: number;
  marker: boolean;
  camera: { x: number; z: number; distance: number };
  /** 交谈子状态（步骤 16）：none / approach（跑向交谈点）/ face（转身面向 Boss）/ dialog（对话中，禁止移动） */
  talk: TalkPhase;
  /** 交谈点（Boss 正前方 talkDistance 米） */
  talkPoint: Pt;
  /** 说话动作的权重：队长、Boss */
  gesture: { leader: number; boss: number };
}

export class ExploreStage {
  readonly agent: LeaderAgent;
  readonly session: ExploreSession;
  readonly world: ExploreWorld;
  readonly follow: CameraFollow;
  readonly bossId: UnitId;
  readonly leaderId: UnitId;
  readonly marker = new ClickMarker();
  private activeFlag = false;
  private hoverBoss = false;
  /** 到达交谈点、面向 Boss 后调用（界面层弹出对话框） */
  onTalk: () => void = () => undefined;

  constructor(
    private readonly stage: BattleStage,
    private readonly camera: BattleCamera,
    templates: readonly UnitTemplate[],
    parent?: Object3D,
  ) {
    const boss = templates.find((t) => t.rank === 'boss');
    if (!boss) throw new Error('阵容里没有 Boss');
    this.bossId = boss.id;
    this.leaderId = EXPLORE_CONFIG.leaderId;
    const leader = templates.find((t) => t.id === this.leaderId);
    if (!leader || leader.side !== 'ally' || leader.kind !== 'hero') throw new Error(`探索配置里的队长 ${this.leaderId} 不是友方人物`);
    this.world = new ExploreWorld(stage.unit(boss.id).home);
    this.agent = new LeaderAgent(this.world);
    this.session = new ExploreSession(this.agent, stage.unit(boss.id).home, facingOf('enemy'));
    this.follow = new CameraFollow();
    parent?.add(this.marker.group);
  }

  get active(): boolean {
    return this.activeFlag;
  }

  /** 进入探索：所有单位先回到开场状态，再按探索布置显示（队长，Boss 在场时加 Boss），相机对准队长 */
  enter(bossPresent = true): void {
    this.stage.reset();
    this.setBossPresent(bossPresent);
    this.showLayout();
    this.activeFlag = true;
    this.returnToStart();
  }

  /** 探索布置的显隐：只有队长和（在场时的）Boss */
  private showLayout(): void {
    const boss = this.world.bossPresent;
    for (const [id, view] of this.stage.views) view.model.visible = id === this.leaderId || (boss && id === this.bossId);
  }

  /** Boss 是否在场（胜利后不在场，“再挑战一次”后回来） */
  get bossPresent(): boolean {
    return this.world.bossPresent;
  }

  /**
   * Boss 在场 / 不在场：导航网格与碰撞、点 Boss 是否有效随之切换（不改显隐，显隐由布置 / 演出负责）。
   * 不在场时正在去找 Boss 说话的交谈被取消。
   */
  private setBossPresent(on: boolean): void {
    this.world.setBossPresent(on);
    this.session.setBossPresent(on);
    if (!on) this.setBossHover(false);
  }

  /**
   * 战后过场播完（步骤 19）：从队长此刻的位置接着探索。单位的复位和显隐已由战后过场做完，
   * 这里同步移动逻辑、Boss 是否在场、相机（与过场最后的取景相同）。
   */
  resume(leader: GroundPose, bossPresent: boolean): void {
    this.setBossPresent(bossPresent);
    this.showLayout();
    this.session.reset();
    this.clearGestures();
    this.marker.hide();
    this.agent.place(leader.x, leader.z, leader.yaw);
    this.stage.unit(this.leaderId).placeAt(leader.x, leader.z, leader.yaw);
    this.follow.setDistance();
    this.follow.snap(leader.x, leader.z);
    this.applyCamera();
    this.activeFlag = true;
  }

  /** 队长站在 (x, z) 时探索相机的取景（战后过场的相机终点） */
  frameAt(x: number, z: number): { x: number; y: number; z: number; distance: number } {
    const f = new CameraFollow();
    f.snap(x, z);
    return { x: f.x, y: EXPLORE_CONFIG.camera.height, z: f.z, distance: f.distance };
  }

  /**
   * “再挑战一次”开始（步骤 19）：Boss 回到原位挡路（碰撞、寻路立即生效），但出现演出播完之前还不能点它对话。
   * 队长正好站在 Boss 的位置附近时，先跑到旁边最近的可站点；正在跑的路线按新的障碍重算。
   */
  beginBossReturn(): void {
    this.world.setBossPresent(true);
    const a = this.agent;
    const p = nearestStandable(this.world, a.x, a.z);
    const dest = a.destination;
    if (p.x !== a.x || p.z !== a.z) a.moveTo(p.x, p.z);
    else if (dest) a.moveTo(dest.x, dest.z);
  }

  /** “再挑战一次”的出现演出播完：Boss 可以点击对话了 */
  finishBossReturn(): void {
    this.setBossPresent(true);
  }

  /** 离开探索：单位回到战斗站位、全部显示，相机回到战斗机位 */
  leave(): void {
    this.activeFlag = false;
    this.session.reset();
    this.clearGestures();
    this.agent.place(this.agent.x, this.agent.z, this.agent.yaw);
    this.setBossHover(false);
    this.marker.hide();
    this.stage.reset();
    this.camera.setFrame(null);
  }

  /**
   * 交给入场过场（步骤 17）：停止探索的移动、跟随和高亮，但不复位单位——过场从队长此刻的位置、朝向和镜头接着演。
   * 返回队长的位置朝向与当前取景（对话视角）。之后由过场把所有人送回战斗格子。
   */
  beginIntro(): { leader: { x: number; z: number; yaw: number }; camera: { x: number; y: number; z: number; distance: number } } {
    const a = this.agent;
    const leader = { x: a.x, z: a.z, yaw: a.yaw };
    const camera = { x: this.follow.x, y: EXPLORE_CONFIG.camera.height, z: this.follow.z, distance: this.follow.distance };
    this.activeFlag = false;
    this.session.reset();
    this.clearGestures();
    this.setBossHover(false);
    this.marker.hide();
    a.place(a.x, a.z, a.yaw);
    return { leader, camera };
  }

  /**
   * 调试 / 验收（步骤 17）：把队长放到任意位置、面向 Boss，直接触发对话结束后的“进入战斗”。
   * 正常流程里对话总是在交谈点发生；这个入口用来检查从近、中、远、Boss 左右两侧开打时的落位。
   */
  placeLeader(x: number, z: number): void {
    const boss = this.stage.unit(this.bossId).home;
    const yaw = yawOf(boss.x - x, boss.z - z);
    this.session.reset();
    this.agent.place(x, z, yaw);
    this.stage.unit(this.leaderId).placeAt(x, z, yaw);
    const c = EXPLORE_CONFIG.dialog.camera;
    this.follow.setDistance(c.distance);
    this.follow.snap(x + (boss.x - x) * c.bossBias, z + (boss.z - z) * c.bossBias);
    this.applyCamera();
  }

  /** 回到起点：队长站回出生点、面向 Boss，停下，相机立即对准 */
  returnToStart(): void {
    const s = EXPLORE_CONFIG.start;
    const boss = this.stage.unit(this.bossId).home;
    const yaw = yawOf(boss.x - s.x, boss.z - s.z);
    this.session.reset();
    this.clearGestures();
    this.agent.place(s.x, s.z, yaw);
    this.stage.unit(this.leaderId).placeAt(s.x, s.z, yaw);
    this.marker.hide();
    this.follow.setDistance();
    this.follow.snap(s.x, s.z);
    this.applyCamera();
  }

  /**
   * 点击地面（世界坐标）：队长寻路跑过去，终点（点到不可达处时是最近的可达点）显示点击标记。
   * 返回寻路结果；没有可去的地方返回 null。
   */
  clickGround(x: number, z: number): PathResult | null {
    if (!this.activeFlag) return null;
    const r = this.session.clickGround(x, z);
    if (r) this.marker.show(r.goal.x, r.goal.z);
    return r;
  }

  /** 点击 Boss（步骤 16）：跑向交谈点，到了面向 Boss 后触发 onTalk。对话中、Boss 不在场时返回 null */
  clickBoss(): PathResult | null {
    if (!this.activeFlag || !this.stage.unit(this.bossId).model.visible) return null;
    const r = this.session.clickBoss();
    if (r) this.marker.show(r.goal.x, r.goal.z);
    return r;
  }

  /** 是否在对话中（移动被锁定） */
  get inDialog(): boolean {
    return this.session.locked;
  }

  /**
   * 对话结束（步骤 16）：说话动作淡出、镜头回到跟随队长。返回接下来去哪里：
   * 'explore' = 再等等，回到自由移动；'battle' = 我准备好了，由界面层进入战斗。
   */
  endDialog(action: DialogueAction): 'explore' | 'battle' {
    this.clearGestures();
    this.follow.setDistance();
    return this.session.endDialog(action);
  }

  /** 让队长 / Boss 做说话动作（null = 淡出） */
  setGesture(who: 'leader' | 'boss', pose: EmotePose | null): void {
    this.stage.unit(who === 'leader' ? this.leaderId : this.bossId).setGesture(pose);
  }

  private clearGestures(): void {
    this.setGesture('leader', null);
    this.setGesture('boss', null);
  }

  /** 方向键 / WASD（调试，地面向量；0 = 松开）：与点击移动同一速度、同一碰撞，按下时取消点击目标 */
  setInput(x: number, z: number): void {
    if (this.session.locked) return; // 对话中禁止移动
    this.session.setManual(x, z);
    if (x !== 0 || z !== 0) this.marker.hide();
  }

  /** 鼠标是否指着 Boss（光标由界面层改，这里只管轮边光高亮） */
  setBossHover(on: boolean): void {
    this.hoverBoss = on;
    this.stage.unit(this.bossId).setHighlight(on);
  }

  /** Boss 脚下的地面位置（点到 Boss 身上时按这里处理） */
  get bossGround(): Pt {
    const h = this.stage.unit(this.bossId).home;
    return { x: h.x, z: h.z };
  }

  /** 每帧（摆姿态之前）：推进移动，写到队长身上，相机跟随，点击标记淡出 */
  update(dt: number): void {
    if (!this.activeFlag || dt <= 0) return;
    const a = this.agent;
    const event = this.session.update(dt);
    this.stage.unit(this.leaderId).locomote(a.x, a.z, a.yaw);
    if (this.session.locked) {
      // 对话中：注视点移到队长与 Boss 之间，略微拉近
      const c = EXPLORE_CONFIG.dialog.camera;
      const b = this.session.boss;
      this.follow.setDistance(c.distance);
      this.follow.update(a.x + (b.x - a.x) * c.bossBias, a.z + (b.z - a.z) * c.bossBias, 0, 0, dt, c.smoothTime);
    } else {
      this.follow.update(a.x, a.z, a.vx, a.vz, dt);
    }
    this.applyCamera();
    this.marker.update(dt);
    if (event === 'talk') {
      this.marker.hide();
      this.setBossHover(false);
      this.onTalk();
    }
  }

  private applyCamera(): void {
    const c = EXPLORE_CONFIG.camera;
    this.camera.setFrame({ x: this.follow.x, y: c.height, z: this.follow.z, distance: this.follow.distance });
  }

  snapshot(): ExploreSnapshot {
    const a = this.agent;
    const v = this.stage.unit(this.leaderId);
    return {
      active: this.activeFlag,
      leader: this.leaderId,
      visible: [...this.stage.views].filter(([, u]) => u.model.visible).map(([id]) => id),
      units: { [this.leaderId]: { x: a.x, z: a.z, yaw: a.yaw, speed: a.actualSpeed, walk: v.walkWeight } },
      destination: a.destination,
      path: a.remainingPath,
      bossHover: this.hoverBoss,
      bossHighlight: this.stage.unit(this.bossId).highlight,
      marker: this.marker.active,
      camera: { x: this.follow.x, z: this.follow.z, distance: this.follow.distance },
      talk: this.session.phase,
      talkPoint: this.session.talkPoint,
      gesture: { leader: this.stage.unit(this.leaderId).gestureLevel, boss: this.stage.unit(this.bossId).gestureLevel },
    };
  }

  dispose(): void {
    this.marker.dispose();
  }
}

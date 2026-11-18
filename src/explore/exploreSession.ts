// 探索的纯状态（步骤 16，DESIGN §11.1 / §11.2）：队长的点击移动、去找 Boss 说话（子状态 approach）、对话中锁定移动。
// 纯计算，不依赖 three.js 和 DOM。ExploreStage 每帧调用 update，并把位置写到 UnitView。
//
// 交谈流程：点 Boss → 队长寻路跑向交谈点（Boss 正前方 talkDistance 米）→ 停下后转身面向 Boss → update 返回 'talk'
// （同时进入 dialog 子状态：点地面、方向键都无效）→ 界面层弹出对话框 → endDialog(动作)：
//   'close'（再等等）解锁，回到自由移动；'startBattle'（我准备好了）保持锁定，交给战斗流程。
// 跑过去的途中点地面 = 取消交谈，改为普通移动；被挡住停在离交谈点太远的地方也取消。

import type { DialogueAction } from '../data/dialogues';
import { EXPLORE_CONFIG, type GroundXZ } from '../data/exploreConfig';
import type { LeaderAgent } from './agent';
import type { PathResult, Pt } from './pathfinder';
import { yawOf } from './walker';

/** 交谈的子状态：none = 普通探索；approach = 跑向交谈点；face = 到了，转身面向 Boss；dialog = 对话中（锁定） */
export type TalkPhase = 'none' | 'approach' | 'face' | 'dialog';

export type DialogConfig = typeof EXPLORE_CONFIG.dialog;

export class ExploreSession {
  private phaseNow: TalkPhase = 'none';
  /** 实际要去的交谈点（寻路后的终点） */
  private talkGoal: Pt | null = null;
  private bossOn = true;

  constructor(
    readonly agent: LeaderAgent,
    /** Boss 站的位置与朝向（单位向量） */
    readonly boss: GroundXZ,
    readonly bossFacing: GroundXZ,
    private readonly talkDistance: number = EXPLORE_CONFIG.talkDistance,
    private readonly cfg: DialogConfig = EXPLORE_CONFIG.dialog,
  ) {}

  get phase(): TalkPhase {
    return this.phaseNow;
  }

  /** 对话中：禁止点击移动和方向键 */
  get locked(): boolean {
    return this.phaseNow === 'dialog';
  }

  /** Boss 是否在场（不在场时点 Boss 无效；步骤 19 胜利后用） */
  setBossPresent(on: boolean): void {
    this.bossOn = on;
    if (!on && this.phaseNow !== 'dialog') this.cancelTalk();
  }

  /** 交谈点：Boss 正前方 talkDistance 米（寻路时落在障碍里会换成最近的可达点） */
  get talkPoint(): Pt {
    return { x: this.boss.x + this.bossFacing.x * this.talkDistance, z: this.boss.z + this.bossFacing.z * this.talkDistance };
  }

  /** 从某点面向 Boss 的朝向 */
  yawToBoss(x = this.agent.x, z = this.agent.z): number {
    return yawOf(this.boss.x - x, this.boss.z - z);
  }

  /** 点地面：对话中无效（返回 null）；否则跑过去，并取消正在进行的交谈 */
  clickGround(x: number, z: number): PathResult | null {
    if (this.locked) return null;
    this.cancelTalk();
    return this.agent.moveTo(x, z);
  }

  /** 点 Boss：对话中 / Boss 不在场时无效；否则跑向交谈点 */
  clickBoss(): PathResult | null {
    if (this.locked || !this.bossOn) return null;
    const t = this.talkPoint;
    const r = this.agent.moveTo(t.x, t.z);
    if (!r) {
      this.cancelTalk();
      return null;
    }
    this.phaseNow = 'approach';
    this.talkGoal = { ...r.goal };
    return r;
  }

  /** 方向键（调试）：对话中无效；按下任何方向取消交谈 */
  setManual(x: number, z: number): void {
    if (this.locked) return;
    if (x !== 0 || z !== 0) this.cancelTalk();
    this.agent.setManual(x, z);
  }

  /** 推进一帧；到达交谈点并面向 Boss 的那一帧返回 'talk'（只返回一次） */
  update(dt: number): 'talk' | null {
    if (dt <= 0) return null;
    // 对话中：不接受任何输入，队长原地站着（只把余下的转身做完）
    this.agent.update(dt);
    if (this.phaseNow === 'approach' && !this.agent.hasPath) {
      const g = this.talkGoal!;
      const near = Math.hypot(this.agent.x - g.x, this.agent.z - g.z) <= this.cfg.arriveTolerance;
      if (!near) {
        this.cancelTalk(); // 被挡住、放弃了：不弹对话
        return null;
      }
      this.phaseNow = 'face';
      this.agent.faceTo(this.yawToBoss());
    }
    if (this.phaseNow === 'face' && this.agent.actualSpeed < 0.05 && this.agent.faceRemaining <= this.cfg.faceTolerance) {
      this.beginDialog(); // 同时进入对话（锁定），所以 'talk' 只返回一次
      return 'talk';
    }
    return null;
  }

  /** 对话框弹出：锁定移动 */
  beginDialog(): void {
    this.agent.stop();
    this.agent.setManual(0, 0);
    this.agent.faceTo(this.yawToBoss());
    this.phaseNow = 'dialog';
  }

  /**
   * 对话结束：返回接下来去哪里。'close'（再等等）→ 'explore'，解锁；'startBattle'（我准备好了）→ 'battle'，
   * 保持锁定（离开探索时由 reset 清掉）。
   */
  endDialog(action: DialogueAction): 'explore' | 'battle' {
    if (action === 'startBattle') return 'battle';
    this.phaseNow = 'none';
    this.talkGoal = null;
    return 'explore';
  }

  /** 回到起点 / 离开探索：清掉交谈与锁定 */
  reset(): void {
    this.phaseNow = 'none';
    this.talkGoal = null;
  }

  private cancelTalk(): void {
    if (this.phaseNow === 'dialog') return;
    this.phaseNow = 'none';
    this.talkGoal = null;
  }
}

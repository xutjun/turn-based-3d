// 队长的运动学（步骤 15，DESIGN §9.12 H4~H6 / §11.3）：沿寻路结果跑过去，或按方向键（调试）直线跑。
// 纯计算，不依赖 three.js 和 DOM。
//
// - 速度是一个标量 speed 加一个跑动方向 heading：起跑按 accel 加速，到达前按“剩余路程”减速
//   （v = √(2·arriveDecel·剩余距离)），松开方向键 / 急转弯按 decel 减速；
// - 跑动方向的转向角速度受侧向加速度限制（跑得越快转得越慢，拐角是连续的弧线），低速时可以原地掉头；
// - 身体朝向（yaw）跟着实际移动方向，按 turnRate 平滑转身；起步时身体还背着目标，先转身再加速；
// - 每帧的位移交给 collision.moveWithCollision：撞到障碍物就贴着表面滑，绝不穿过去；
// - 跑动中能直接看到下一个拐点就跳过当前拐点（视线检查），卡住时从当前位置重算路径。

import { EXPLORE_CONFIG } from '../data/exploreConfig';
import { moveWithCollision } from './collision';
import type { NavWorld } from './exploreWorld';
import { findPath, pathLength, type PathResult, type Pt } from './pathfinder';
import { turnToward, wrapAngle, yawOf } from './walker';

export type MoveConfig = typeof EXPLORE_CONFIG.move;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
/** 身体朝向与跑动方向差多少时还能全速起跑：差 30° 以内满速，100° 以上原地转身不前进 */
const FACE_FULL = Math.cos((30 * Math.PI) / 180);
const FACE_NONE = Math.cos((100 * Math.PI) / 180);
/** 被挡住时“想跑的速度”向实际速度靠拢的速率（1/秒） */
const BLOCKED_RELAX = 3;

export class LeaderAgent {
  x = 0;
  z = 0;
  /** 身体朝向（面朝方向 = (sin yaw, cos yaw)） */
  yaw = 0;
  /** 实际速度（这一帧的实际位移 / dt，世界坐标，米/秒）：步态、相机都用它 */
  vx = 0;
  vz = 0;
  /** 想跑的速度（标量）与跑动方向 */
  speed = 0;
  heading = 0;
  /** 当前路径（第一个点是出发点）与正在去的路点下标；null = 没有点击目标 */
  private path: Pt[] | null = null;
  private idx = 0;
  private goalPt: Pt | null = null;
  /** 方向键（调试）：地面向量，长度 0 = 没按 */
  private readonly manual = { x: 0, z: 0 };
  private stuckTime = 0;
  private stuckCount = 0;
  /** 站定后要转向的朝向（步骤 16：到达交谈点后面向 Boss）；null = 不转。移动、放置时清除 */
  private faceGoal: number | null = null;

  constructor(
    private readonly world: NavWorld,
    private readonly cfg: MoveConfig = EXPLORE_CONFIG.move,
  ) {}

  /** 立即放到某点（回到起点）：停下、清空路径 */
  place(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = this.heading = yaw;
    this.vx = this.vz = this.speed = 0;
    this.path = null;
    this.goalPt = null;
    this.manual.x = this.manual.z = 0;
    this.stuckTime = this.stuckCount = 0;
    this.faceGoal = null;
  }

  /** 站定后平滑转向 yaw（按 turnRate；有点击目标或方向键时不生效，开始移动即取消） */
  faceTo(yaw: number): void {
    this.faceGoal = wrapAngle(yaw);
  }

  /** 还要转多少才面向 faceTo 的朝向（弧度，绝对值）；没有转向目标为 0 */
  get faceRemaining(): number {
    return this.faceGoal === null ? 0 : Math.abs(wrapAngle(this.faceGoal - this.yaw));
  }

  /** 是否正在去某个点击目标 */
  get hasPath(): boolean {
    return this.path !== null;
  }

  /** 点击目标（实际要去的终点）；没有返回 null */
  get destination(): Pt | null {
    return this.goalPt ? { ...this.goalPt } : null;
  }

  /** 当前路径剩下的路点（调试用，含当前位置） */
  get remainingPath(): Pt[] {
    if (!this.path) return [];
    return [{ x: this.x, z: this.z }, ...this.path.slice(this.idx).map((p) => ({ ...p }))];
  }

  /** 实际速度的大小 */
  get actualSpeed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * 跑到某点（点击地面）：寻路，点到不可达处时换成最近的可达点。返回寻路结果（终点、是否精确）；
   * 整张图没有可走的地方时返回 null，原地不动。跑动中再次调用 = 改变目的地，速度不中断。
   */
  moveTo(x: number, z: number): PathResult | null {
    const r = findPath(this.world.grid, { x: this.x, z: this.z }, { x, z }, this.world.unitRadius);
    this.manual.x = this.manual.z = 0;
    this.stuckTime = 0;
    this.faceGoal = null;
    if (!r) {
      this.path = null;
      this.goalPt = null;
      return null;
    }
    this.path = r.points;
    this.idx = Math.min(1, r.points.length - 1);
    this.goalPt = { ...r.goal };
    return r;
  }

  /** 停下（取消点击目标；按减速度停住） */
  stop(): void {
    this.path = null;
    this.goalPt = null;
    this.stuckCount = 0;
  }

  /** 方向键（调试）：按下任何方向都会取消点击目标；(0, 0) = 松开 */
  setManual(x: number, z: number): void {
    this.manual.x = x;
    this.manual.z = z;
    if (x !== 0 || z !== 0) {
      this.stop();
      this.faceGoal = null;
    }
  }

  /** 推进一帧 */
  update(dt: number): void {
    if (dt <= 0) return;
    const c = this.cfg;
    let desired: Pt | null = null;
    let target = 0;
    const ml = Math.hypot(this.manual.x, this.manual.z);
    if (ml > 1e-6) {
      desired = { x: this.manual.x / ml, z: this.manual.z / ml };
      target = c.runSpeed;
    } else if (this.path) {
      const follow = this.followPath();
      if (follow) {
        desired = follow.dir;
        target = Math.min(c.runSpeed, Math.sqrt(2 * c.arriveDecel * Math.max(0, follow.remaining - c.arriveRadius)));
      }
    }

    // 转向：跑动方向朝想去的方向转；低速时直接掉头，跑得越快转得越慢（侧向加速度上限）
    let face = 1;
    if (desired) {
      const want = yawOf(desired.x, desired.z);
      if (this.speed < 0.3) this.heading = want;
      else {
        const rate = Math.min(c.maxHeadingRate, c.lateralAccel / this.speed);
        this.heading = turnToward(this.heading, want, rate * dt);
      }
      // 还没转过来的角度越大，目标速度越低（掉头时先减速，转弯更紧）
      const off = Math.cos(wrapAngle(want - this.heading));
      target *= c.cornerSlow + (1 - c.cornerSlow) * Math.max(0, off);
      // 起步时身体还背着跑动方向：先转身，转过来才加速
      face = clamp01((Math.cos(wrapAngle(this.yaw - this.heading)) - FACE_NONE) / (FACE_FULL - FACE_NONE));
      target *= face;
    }

    // 速度：加速 / 减速都有上限
    if (target > this.speed) this.speed = Math.min(target, this.speed + c.accel * dt);
    else this.speed = Math.max(target, this.speed - c.decel * dt);

    // 位移 + 碰撞（贴边滑动）
    const ox = this.x;
    const oz = this.z;
    const p = { x: ox, z: oz };
    let hit = false;
    if (this.speed > 0) {
      hit = moveWithCollision(p, Math.sin(this.heading) * this.speed * dt, Math.cos(this.heading) * this.speed * dt, this.world.unitRadius, this.world.obstacles, this.world.bounds);
    }
    this.x = p.x;
    this.z = p.z;
    this.vx = (p.x - ox) / dt;
    this.vz = (p.z - oz) / dt;
    const actual = this.actualSpeed;
    // 顶着障碍物：想跑的速度慢慢向实际跑出来的速度靠拢（正面顶住时不会一直保持满速，
    // 障碍物一让开就猛地窜出去；斜着贴边滑时也不会被压成 0——那样会越滑越慢、停在表面上）
    if (hit && actual < this.speed) this.speed -= (this.speed - actual) * (1 - Math.exp(-BLOCKED_RELAX * dt));

    // 身体朝向：跟着实际移动方向（贴边滑动时面朝滑动方向，不会横着跑）；慢下来后朝跑动方向
    if (actual > 0.8) this.yaw = turnToward(this.yaw, yawOf(this.vx, this.vz), c.turnRate * dt);
    else if (desired) this.yaw = turnToward(this.yaw, this.heading, c.turnRate * dt);
    else if (this.faceGoal !== null && actual < 0.05) this.yaw = turnToward(this.yaw, this.faceGoal, c.turnRate * dt);

    this.checkStuck(dt, face, actual);
  }

  /**
   * 沿路径：先跳过已经经过或能直接看到下一个的拐点，返回去当前拐点的方向和剩余路程；到达终点时返回 null 并清空路径。
   */
  private followPath(): { dir: Pt; remaining: number } | null {
    const path = this.path!;
    const last = path.length - 1;
    const grid = this.world.grid;
    while (this.idx < last) {
      const p = path[this.idx]!;
      const n = path[this.idx + 1]!;
      if (Math.hypot(p.x - this.x, p.z - this.z) < this.cfg.waypointRadius || grid.lineOfSight(this.x, this.z, n.x, n.z)) this.idx += 1;
      else break;
    }
    const t = path[this.idx]!;
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const d = Math.hypot(dx, dz);
    if (this.idx === last && d <= this.cfg.arriveRadius) {
      // 到了：最后这不到 1 厘米直接补上（终点是可以站人的位置），停下
      this.x = t.x;
      this.z = t.z;
      this.speed = 0;
      this.stop();
      return null;
    }
    return { dir: { x: dx / d, z: dz / d }, remaining: d + pathLength(path, this.idx) };
  }

  /** 卡住：想跑（已经起步、身体朝着跑动方向）却几乎没动，持续一段时间 → 从当前位置重算；连续几次仍卡住就停下 */
  private checkStuck(dt: number, face: number, actual: number): void {
    const c = this.cfg;
    if (!this.path || !this.goalPt) {
      this.stuckTime = 0;
      return;
    }
    if (face > 0.9 && actual < c.stuckSpeed) {
      this.stuckTime += dt;
      if (this.stuckTime >= c.stuckTime) {
        this.stuckTime = 0;
        this.stuckCount += 1;
        if (this.stuckCount > c.stuckRetries) {
          this.stop();
          return;
        }
        const goal = this.goalPt;
        const keep = this.stuckCount;
        this.moveTo(goal.x, goal.z);
        this.stuckCount = keep;
      }
    } else {
      this.stuckTime = 0;
      if (actual > c.runSpeed * 0.5) this.stuckCount = 0;
    }
  }
}

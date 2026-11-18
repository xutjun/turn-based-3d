// 探索模式的键盘输入（步骤 14 起，调试用；正式操作是鼠标点击移动，见 ExplorePointer）：
//   方向键 / WASD = 队长沿屏幕方向直线跑（可斜走），与点击移动同一速度、同一碰撞（步骤 15 起穿不过障碍物）。
//   步骤 14 的 Tab 切换人物在步骤 15 删除（探索中只有队长）。
// 相机方位角为 0（在 +z 一侧），所以屏幕“上” = 世界 −z，屏幕“右” = 世界 +x。

const DIRS: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

export class ExploreInput {
  private readonly held = new Set<string>();

  constructor(private readonly onDirection: (x: number, z: number) => void) {}

  /** 处理一次按键（按下 / 松开）；返回这个键是不是探索模式的键（是则调用方不再往下传） */
  handle(e: KeyboardEvent, down: boolean): boolean {
    const key = e.key.toLowerCase();
    if (!(key in DIRS)) return false;
    if (down) this.held.add(key);
    else this.held.delete(key);
    e.preventDefault();
    this.emit();
    return true;
  }

  /** 松开所有键（窗口失焦、打开菜单、离开探索时） */
  clear(): void {
    if (this.held.size === 0) return;
    this.held.clear();
    this.emit();
  }

  /** 当前的方向（地面向量，未归一化） */
  get direction(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    for (const key of this.held) {
      const d = DIRS[key]!;
      x += d[0];
      z += d[1];
    }
    // 同一方向的两个键（W 和 ↑）只算一次
    return { x: Math.sign(x), z: Math.sign(z) };
  }

  private emit(): void {
    const d = this.direction;
    this.onDirection(d.x, d.z);
  }
}

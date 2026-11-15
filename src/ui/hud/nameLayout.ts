// 头顶名字的显示与错开：纯计算，不依赖 DOM。
//
// 平时只显示血条；名字只在需要时出现（Boss、正在出手、被选中 / 会被命中、鼠标指着）。
// 同时出现的名字如果会压到别的血条或别的名字，就整体往上抬，直到不重叠。

export interface HeadBox {
  id: string;
  /** 头顶挂点的屏幕坐标：条的底边中点 */
  x: number;
  y: number;
  barWidth: number;
  barHeight: number; // 血条（和魔法条、状态图标）的总高度
  nameWidth: number;
  showName: boolean;
  /** 越大越优先留在原位（Boss、主目标） */
  priority: number;
}

export interface NameLayoutConfig {
  lineHeight: number; // 名字一行的高度（像素）
  step: number; // 每次上抬的距离
  maxSteps: number; // 最多上抬几次
  gap: number; // 名字与其他元素之间至少留的空隙
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const overlaps = (a: Rect, b: Rect, gap: number): boolean =>
  a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;

const barRect = (h: HeadBox): Rect => ({
  left: h.x - h.barWidth / 2,
  right: h.x + h.barWidth / 2,
  top: h.y - h.barHeight,
  bottom: h.y,
});

/** 名字在上抬 lift 像素后的范围（名字紧贴在条的上方） */
export function nameRect(h: HeadBox, lift: number, lineHeight: number): Rect {
  const bottom = h.y - h.barHeight - lift;
  return { left: h.x - h.nameWidth / 2, right: h.x + h.nameWidth / 2, top: bottom - lineHeight, bottom };
}

/**
 * 计算每个要显示的名字需要上抬多少像素。
 * 优先级高的先占位；后放的名字避开所有血条和已经放好的名字。
 */
export function layoutNames(heads: readonly HeadBox[], config: NameLayoutConfig): Map<string, number> {
  const lifts = new Map<string, number>();
  const bars = heads.map((h) => ({ id: h.id, rect: barRect(h) }));
  const placed: Rect[] = [];
  const named = heads.filter((h) => h.showName).sort((a, b) => b.priority - a.priority || b.y - a.y || (a.id < b.id ? -1 : 1));
  for (const h of named) {
    let lift = 0;
    let rect = nameRect(h, lift, config.lineHeight);
    for (let i = 0; i < config.maxSteps; i++) {
      const blocked =
        bars.some((b) => b.id !== h.id && overlaps(rect, b.rect, config.gap)) ||
        placed.some((r) => overlaps(rect, r, config.gap));
      if (!blocked) break;
      lift += config.step;
      rect = nameRect(h, lift, config.lineHeight);
    }
    lifts.set(h.id, lift);
    placed.push(rect);
  }
  return lifts;
}

export interface HoverConfig {
  halfWidth: number; // 鼠标离头顶挂点的水平距离上限
  above: number; // 挂点以上多少像素算指着（头顶条）
  below: number; // 挂点以下多少像素算指着（身体）
}

/** 鼠标指着哪个单位（按头顶挂点估算身体范围）；都不在范围内返回 null */
export function pointedHead(
  heads: readonly { id: string; x: number; y: number; scale: number }[],
  px: number,
  py: number,
  config: HoverConfig,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const h of heads) {
    const dx = Math.abs(px - h.x);
    if (dx > config.halfWidth * h.scale) continue;
    if (py < h.y - config.above || py > h.y + config.below * h.scale) continue;
    if (dx < bestDist) {
      bestDist = dx;
      best = h.id;
    }
  }
  return best;
}

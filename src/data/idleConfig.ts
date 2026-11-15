// 待机动画配置（步骤 10 · C 组）。纯数据：每种“待机风格”的幅度和频率，全部可调。
// 哪个单位用哪种风格在 data/unitModels.ts 的 idle 字段里指定。
//
// 约定：角度单位是弧度，长度单位是米（未乘模型缩放），频率单位是 Hz。
// 所有幅度都是“最大偏移”，实际动作在 ±幅度 之间缓慢来回；数值故意取得很小，待机只是“活着”，不抢戏。

export type IdleStyleId =
  | 'stiff' // 僵硬：重甲骑士、堕落骑士——呼吸浅、几乎不晃，偶尔转头、紧一紧握武器的手
  | 'rattle' // 骨架：骷髅兵——僵硬 + 细微的颤动，眼火闪烁
  | 'flowing' // 飘逸：法师、祭司、守誓者、恶魔祭司、亡灵法师——身体缓慢摇曳，布料飘动明显
  | 'nimble' // 轻捷：游侠——重心左右换，张望频繁
  | 'beast' // 野兽：狼——摆尾、探头张望、偶尔张嘴
  | 'winged' // 骨龙：翅膀轻扇、点头、前爪微动
  | 'spectral' // 幽灵：上下漂浮、双臂缓慢起伏
  | 'construct' // 魔偶：很慢很沉，偶尔转头、双臂微晃
  | 'overlord'; // Boss：缓慢深沉的呼吸，双翼缓缓开合，压迫感

export interface IdleStyle {
  breath: number; // 呼吸：胸部前后俯仰
  breathHz: number;
  bob: number; // 呼吸带起的整体起伏（米）
  sway: number; // 重心转移：整体左右侧倾
  swayHz: number;
  shift: number; // 重心转移带起的左右位移（米，很小，不算离开站位）
  twist: number; // 腰部缓慢的左右扭转
  look: number; // 转头张望的最大角度
  lookEvery: [number, number]; // 两次张望之间的间隔范围（秒）
  fidget: number; // 整理武器 / 手臂小动作的幅度
  fidgetEvery: [number, number];
  arms: number; // 双臂随呼吸的轻微摆动
  tremble: number; // 高频颤动（骷髅）
  float: number; // 上下漂浮（米）
  floatHz: number;
  tail: number; // 尾巴摆动
  tailHz: number;
  wing: number; // 翅膀开合
  wingHz: number;
  jaw: number; // 偶尔张嘴
  cloth: number; // 布料、锁链飘动的幅度（米）
  clothHz: number;
  glow: number; // 眼睛、符文发光的呼吸深度（0.2 = ±20%）
  glowHz: number;
  flicker: number; // 发光的不规则闪烁（叠加在呼吸上）
}

const BASE: IdleStyle = {
  breath: 0.014,
  breathHz: 0.27,
  bob: 0.008,
  sway: 0.012,
  swayHz: 0.11,
  shift: 0.008,
  twist: 0.02,
  look: 0.3,
  lookEvery: [5, 10],
  fidget: 0.08,
  fidgetEvery: [7, 13],
  arms: 0.02,
  tremble: 0,
  float: 0,
  floatHz: 0,
  tail: 0,
  tailHz: 0,
  wing: 0,
  wingHz: 0,
  jaw: 0,
  cloth: 0.03,
  clothHz: 0.5,
  glow: 0.16,
  glowHz: 0.3,
  flicker: 0,
};

export const IDLE_STYLES: Record<IdleStyleId, IdleStyle> = {
  stiff: { ...BASE, breath: 0.009, bob: 0.005, sway: 0.006, shift: 0.003, twist: 0.008, look: 0.22, lookEvery: [7, 13], fidget: 0.06, arms: 0.008, cloth: 0.022 },
  rattle: { ...BASE, breath: 0.004, bob: 0.002, sway: 0.008, shift: 0.004, twist: 0.012, look: 0.34, lookEvery: [4, 9], fidget: 0.09, arms: 0.012, tremble: 0.012, cloth: 0.03, glow: 0.2, flicker: 0.3 },
  flowing: { ...BASE, breath: 0.016, sway: 0.02, swayHz: 0.09, shift: 0.012, twist: 0.035, look: 0.22, lookEvery: [6, 12], fidget: 0.07, arms: 0.035, cloth: 0.05, clothHz: 0.42, glow: 0.22 },
  nimble: { ...BASE, breath: 0.016, sway: 0.022, swayHz: 0.16, shift: 0.014, twist: 0.03, look: 0.4, lookEvery: [3, 7], fidget: 0.1, fidgetEvery: [5, 9], arms: 0.03, cloth: 0.04 },
  beast: { ...BASE, breath: 0.022, breathHz: 0.42, bob: 0.012, sway: 0.016, swayHz: 0.17, shift: 0.008, twist: 0, look: 0.42, lookEvery: [2.5, 6], fidget: 0, arms: 0, tail: 0.32, tailHz: 0.55, jaw: 0.28, cloth: 0, glow: 0.2 },
  winged: { ...BASE, breath: 0.012, breathHz: 0.36, bob: 0.014, sway: 0.014, swayHz: 0.15, shift: 0.006, twist: 0, look: 0.36, lookEvery: [3, 7], fidget: 0.2, fidgetEvery: [4, 8], arms: 0, wing: 0.2, wingHz: 0.32, jaw: 0.2, cloth: 0, glow: 0.24, flicker: 0.12 },
  spectral: { ...BASE, breath: 0.01, bob: 0, sway: 0.03, swayHz: 0.1, shift: 0.02, twist: 0.05, look: 0.25, lookEvery: [5, 10], fidget: 0, arms: 0.09, float: 0.05, floatHz: 0.22, cloth: 0.055, clothHz: 0.38, glow: 0.3, flicker: 0.15 },
  construct: { ...BASE, breath: 0.006, breathHz: 0.14, bob: 0.004, sway: 0.008, swayHz: 0.06, shift: 0.004, twist: 0.03, look: 0.3, lookEvery: [8, 15], fidget: 0, arms: 0.03, cloth: 0, glow: 0.3, glowHz: 0.18 },
  overlord: { ...BASE, breath: 0.022, breathHz: 0.15, bob: 0.012, sway: 0.01, swayHz: 0.05, shift: 0.006, twist: 0.02, look: 0.2, lookEvery: [9, 16], fidget: 0.05, fidgetEvery: [10, 18], arms: 0.02, wing: 0.11, wingHz: 0.13, cloth: 0.04, clothHz: 0.3, glow: 0.25, glowHz: 0.15, flicker: 0.1 },
};

/** 待机动画的全局设置 */
export const IDLE_CONFIG = {
  /** 每个单位的周期在 1 ± 这个比例内随机（配合随机相位，保证各单位不同步） */
  periodJitter: 0.18,
  /** 待机 ↔ 出手 / 受击之间的过渡速度：权重每秒向目标靠近的比例（越大切换越快） */
  blendRate: 3.2,
  /** 倒地后保留的幅度比例（只剩极轻微的起伏） */
  fallenScale: 0.07,
  /** 防御姿态下保留的幅度比例 */
  guardScale: 0.5,
  /** 低画质下关闭的“次要动画”：布料飘动、张望、小动作、颤动；呼吸、翅膀、漂浮、发光呼吸保留 */
  lowQuality: { cloth: false, events: false, tremble: false },
};

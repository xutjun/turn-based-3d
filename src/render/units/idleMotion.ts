// 待机动作的计算（纯函数，不依赖 three.js 和 DOM，方便单元测试）。
//
// 输入：风格参数 + 这个单位自己的随机种子 + 时间；输出：一组“偏移量”（关节多转多少、整体多挪多少）。
// 所有偏移都是连续的时间函数：没有随机游走，也不保存状态，所以任意时刻跳到任意时间都不会突变。
//   - 周期性动作（呼吸、重心转移、摆尾、扇翅）：几个不成整数比的正弦叠加，每个单位的相位和周期各不相同；
//   - 偶发动作（转头张望、整理武器、张嘴）：把时间切成一段一段，每段按种子决定“这次做不做、朝哪边”，
//     动作本身是段内的一个平滑起落（两端为 0），所以首尾相接没有跳变。

import type { IdleStyle } from '../../data/idleConfig';

const TAU = Math.PI * 2;

/** 把整数散列成 [0, 1) */
export function hash01(a: number, b = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 字符串（单位 id）→ 种子 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** 一个单位的待机“个性”：由种子决定的相位和周期倍率，创建后不变 */
export interface IdleTraits {
  seed: number;
  phase: number[]; // 各个动作的初相位
  rate: number; // 周期倍率（1 ± periodJitter）
  lookSlot: number; // 张望的时间段长度（秒）
  fidgetSlot: number;
}

export function createIdleTraits(seed: number, style: IdleStyle, periodJitter: number): IdleTraits {
  const phase = Array.from({ length: 8 }, (_, i) => hash01(seed, i + 1) * TAU);
  const pick = ([min, max]: [number, number], salt: number): number => min + (max - min) * hash01(seed, salt);
  return {
    seed,
    phase,
    rate: 1 + (hash01(seed, 91) * 2 - 1) * periodJitter,
    lookSlot: pick(style.lookEvery, 92),
    fidgetSlot: pick(style.fidgetEvery, 93),
  };
}

/** 待机偏移量：全部为 0 就是静止的站姿 */
export interface IdleOffsets {
  breath: number; // −1 ~ 1 的呼吸相位（给胸部、翅膀等共用）
  chestPitch: number; // 胸部俯仰
  bob: number; // 整体起伏（米）
  roll: number; // 整体侧倾
  shift: number; // 整体左右位移（米）
  twist: number; // 腰部扭转
  headYaw: number;
  headPitch: number;
  armR: number; // 右臂（持武器）的小动作
  armL: number;
  elbowR: number;
  tremble: number; // 颤动（加在头和脊柱上）
  float: number; // 漂浮高度（米）
  tailYaw: number;
  tailPitch: number;
  wing: number; // 翅膀开合：骨龙 正 = 张开；Boss 正 = 向背后收拢（步骤 16 实测，两者关节转向相反，见 IdleAnimator）
  jaw: number; // 张嘴
  claw: number; // 前爪 / 手指微动
  glow: number; // 发光倍率（1 = 基础强度）
}

export function zeroOffsets(): IdleOffsets {
  return {
    breath: 0,
    chestPitch: 0,
    bob: 0,
    roll: 0,
    shift: 0,
    twist: 0,
    headYaw: 0,
    headPitch: 0,
    armR: 0,
    armL: 0,
    elbowR: 0,
    tremble: 0,
    float: 0,
    tailYaw: 0,
    tailPitch: 0,
    wing: 0,
    jaw: 0,
    claw: 0,
    glow: 1,
  };
}

/** 段内的平滑起落：u ∈ [0,1]，在 [from, to] 之间从 0 升到 1 再回到 0，其余为 0 */
function bump(u: number, from: number, to: number): number {
  if (u <= from || u >= to) return 0;
  const s = Math.sin(Math.PI * ((u - from) / (to - from)));
  return s * s;
}

/**
 * 偶发动作：返回 −1 ~ 1。把时间切成长度为 slot 的段，每段有 chance 的概率做一次动作，方向随机。
 */
export function eventAt(time: number, slot: number, seed: number, salt: number, chance: number): number {
  if (slot <= 0 || time < 0) return 0;
  const k = Math.floor(time / slot);
  const u = time / slot - k;
  const r = hash01(seed + salt, k);
  if (r > chance) return 0;
  const dir = hash01(seed + salt + 7, k) < 0.5 ? -1 : 1;
  const size = 0.55 + 0.45 * hash01(seed + salt + 13, k);
  // 动作占这一段的中间一部分：抬起、停一下、放下
  const start = 0.12 + 0.2 * hash01(seed + salt + 17, k);
  return dir * size * bump(u, start, start + 0.5);
}

export interface IdleSwitches {
  events: boolean; // 张望、小动作、张嘴
  tremble: boolean;
}

const ALL_ON: IdleSwitches = { events: true, tremble: true };

/**
 * 计算某一时刻的待机偏移。
 * @param out 结果写到这里（避免每帧分配）
 */
export function sampleIdle(
  style: IdleStyle,
  traits: IdleTraits,
  time: number,
  out: IdleOffsets = zeroOffsets(),
  switches: IdleSwitches = ALL_ON,
): IdleOffsets {
  const t = time * traits.rate;
  const p = traits.phase;
  const wave = (hz: number, i: number): number => Math.sin(t * hz * TAU + p[i]!);

  const breath = wave(style.breathHz, 0);
  // 重心转移：两个慢正弦叠加，不是单调的来回
  const sway = 0.7 * wave(style.swayHz, 1) + 0.3 * wave(style.swayHz * 2.3, 2);
  out.breath = breath;
  out.chestPitch = style.breath * breath;
  out.bob = style.bob * breath;
  out.roll = style.sway * sway;
  out.shift = style.shift * sway;
  out.twist = style.twist * wave(style.swayHz * 0.7, 3);
  out.armL = style.arms * wave(style.breathHz, 4);
  out.armR = style.arms * 0.6 * wave(style.breathHz * 0.83, 5);
  out.elbowR = 0;
  out.headPitch = style.breath * 0.6 * wave(style.breathHz, 6);
  out.headYaw = style.look * 0.08 * wave(style.swayHz * 1.6, 7);

  if (switches.events) {
    const look = eventAt(time, traits.lookSlot, traits.seed, 101, 0.75);
    out.headYaw += style.look * look;
    out.headPitch += style.look * 0.2 * Math.abs(look);
    const fidget = eventAt(time, traits.fidgetSlot, traits.seed, 211, 0.7);
    out.armR += -style.fidget * Math.abs(fidget);
    out.elbowR = -style.fidget * 1.3 * Math.abs(fidget);
    out.claw = style.fidget * fidget;
    out.jaw = style.jaw * Math.abs(eventAt(time, traits.lookSlot * 0.77 + 1.3, traits.seed, 307, 0.5));
  } else {
    out.claw = 0;
    out.jaw = 0;
  }

  out.tremble =
    switches.tremble && style.tremble > 0
      ? style.tremble * (0.6 * Math.sin(t * 11.3 * TAU + p[2]!) + 0.4 * Math.sin(t * 17.9 * TAU + p[5]!)) * (0.5 + 0.5 * wave(0.21, 3))
      : 0;
  out.float = style.float * (0.8 * wave(style.floatHz, 1) + 0.2 * wave(style.floatHz * 2.1, 4));
  out.tailYaw = style.tail * (0.75 * wave(style.tailHz, 2) + 0.25 * wave(style.tailHz * 2.7, 5));
  out.tailPitch = style.tail * 0.25 * wave(style.tailHz * 0.6, 6);
  out.wing = style.wing * (0.8 * wave(style.wingHz, 3) + 0.2 * wave(style.wingHz * 2.2, 1));
  // 发光：呼吸 + 不规则闪烁
  const flick = style.flicker * (0.5 * Math.sin(t * 5.3 * TAU + p[4]!) * Math.sin(t * 1.7 * TAU + p[6]!) + 0.5 * Math.sin(t * 9.1 * TAU + p[1]!) * wave(0.37, 7));
  out.glow = Math.max(0.2, 1 + style.glow * wave(style.glowHz, 5) + flick * 0.5);
  return out;
}

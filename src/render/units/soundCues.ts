// 演出动作 → 音效：哪个动作发出哪种声音。纯数据映射，不依赖 three 和 Web Audio。
// 音效在动作开始的那一刻由舞台触发，所以和画面同步；倍速和跳过动画由音效引擎统一处理。

import type { SoundName } from '../../data/audioConfig';
import type { AttackStyle, AuraKind, BurstKind, ProjectileKind } from '../director/types';

/** 出手动作挥出 / 放出的那一下 */
export function releaseSound(style: AttackStyle): SoundName | null {
  return style === 'melee' ? 'swing' : null; // 弓箭和法术的声音跟着飞行物走
}

/** 蓄力 */
export function windupSound(style: AttackStyle): SoundName | null {
  return style === 'cast' ? 'cast' : null;
}

export const PROJECTILE_SOUND: Record<ProjectileKind, SoundName | null> = {
  arrow: 'arrow',
  skyArrow: 'arrow',
  rainArrow: 'arrow',
  bolt: 'bolt',
  fireball: 'bolt',
};

export const BURST_SOUND: Record<BurstKind, SoundName | null> = {
  impact: null, // 命中火花：受击音已经由被打的单位发出
  heavyImpact: null,
  thunder: 'blast',
  pillarDown: 'blast',
  explosion: 'blast',
  pillarUp: 'heal',
  reviveLight: null, // 复活音由站起来的单位发出
  landing: null,
  shatter: 'dodge', // 封印被抵抗：锁链崩碎
  dust: null, // 脚下的尘土：无声
  shockwave: 'blast', // 地面冲击波（魔偶砸拳、旋风斩收尾）
};

export const AURA_SOUND: Record<AuraKind, SoundName | null> = {
  runeCircle: null,
  charge: null,
  bind: null,
  gather: null,
};

/** 封印锁链光束 */
export const BEAM_SOUND: SoundName = 'seal';

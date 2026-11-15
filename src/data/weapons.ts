// 武器配置（对应 DESIGN.md §4.4）。
// 逻辑字段：出手方式和普攻类型。
// 外观字段 glow：发光颜色、强度、呼吸频率等，全部在这里调；模型 builder 只读取，不写死数值。

import type { AttackMode, SkillId, WeaponId } from '../core/types';

/** 武器发光参数。颜色用 0xRRGGBB */
export interface WeaponGlowDef {
  color: number; // 主发光色（刃口、符文、宝珠、弓弦）
  accentColor: number; // 辅色（内芯、光点、粒子）
  intensity: number; // 自发光基础强度（emissiveIntensity）
  edgeIntensity: number; // 边缘轮廓光强度：武器实体（刃、杆、金属件）轮廓上的一圈发光，0 = 关闭
  breathHz: number; // 呼吸频率（每秒往返次数）
  breathDepth: number; // 呼吸幅度：0 = 恒定，0.5 = 在 50%~150% 之间起伏
  flowSpeed: number; // 自发光贴图的流动速度（每秒滚动的贴图圈数）
  lightIntensity: number; // 点光源强度，0 = 不创建点光源
  lightDistance: number; // 点光源照射距离
  haloSize: number; // 光晕精灵的直径（米）
  haloStrength: number; // 光晕精灵的亮度
  particleCount: number; // 飘散粒子数量，0 = 不要粒子
  flareBoost: number; // 出手瞬间的强度倍率（挥击闪光、施法暴涨）
  flareDecay: number; // 出手闪光衰减到约 37% 所需的秒数
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  attackMode: AttackMode; // 近战冲锋 / 原地射击 / 原地施法
  basicAttackSkillId: SkillId; // 持该武器时的普攻
  glow: WeaponGlowDef;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // 步骤 10：发光改为“边缘发光”——细的发光线 + 轮廓光为主，光晕精灵只留一点柔光，武器本身的形状要看得清。
  // 刀：刃口熔岩红橙流光
  blade: {
    id: 'blade',
    name: '刀',
    attackMode: 'melee',
    basicAttackSkillId: 'basic_physical',
    glow: {
      color: 0xff4a12,
      accentColor: 0xffb347,
      intensity: 7,
      edgeIntensity: 0.7,
      breathHz: 0.9,
      breathDepth: 0.25,
      flowSpeed: 0.55,
      lightIntensity: 7,
      lightDistance: 4.5,
      haloSize: 0.6,
      haloStrength: 0.5,
      particleCount: 14,
      flareBoost: 2.6,
      flareDecay: 0.28,
    },
  },
  // 剑：血槽冷蓝/银白符文光带，呼吸闪烁
  sword: {
    id: 'sword',
    name: '剑',
    attackMode: 'melee',
    basicAttackSkillId: 'basic_physical',
    glow: {
      color: 0x58b4ff,
      accentColor: 0xdff2ff,
      intensity: 3.2,
      edgeIntensity: 1.0,
      breathHz: 0.55,
      breathDepth: 0.5,
      flowSpeed: 0,
      lightIntensity: 5,
      lightDistance: 4.5,
      haloSize: 0.3,
      haloStrength: 0.16,
      particleCount: 8,
      flareBoost: 2.4,
      flareDecay: 0.3,
    },
  },
  // 枪：枪尖金色光点，枪身缠光纹
  spear: {
    id: 'spear',
    name: '枪',
    attackMode: 'melee',
    basicAttackSkillId: 'basic_physical',
    glow: {
      color: 0xffc23a,
      accentColor: 0xfff1b8,
      intensity: 3,
      edgeIntensity: 1.2,
      breathHz: 0.7,
      breathDepth: 0.3,
      flowSpeed: 0.45,
      lightIntensity: 5.5,
      lightDistance: 5,
      haloSize: 0.3,
      haloStrength: 0.28,
      particleCount: 8,
      flareBoost: 2.8,
      flareDecay: 0.25,
    },
  },
  // 法杖：整根杖身的符文光纹和轮廓光 + 杖顶的小水晶核心；颜色默认取 STAFF_ELEMENT_COLORS 里的元素色
  staff: {
    id: 'staff',
    name: '法杖',
    attackMode: 'cast',
    basicAttackSkillId: 'basic_magic',
    glow: {
      color: 0x8a6bff,
      accentColor: 0xcfd6ff,
      intensity: 2.8,
      edgeIntensity: 1.4,
      breathHz: 0.6,
      breathDepth: 0.35,
      flowSpeed: 0.12,
      lightIntensity: 6,
      lightDistance: 5.5,
      haloSize: 0.3,
      haloStrength: 0.2,
      particleCount: 16,
      flareBoost: 3,
      flareDecay: 0.45,
    },
  },
  // 弓：发光弓弦与发光箭矢
  bow: {
    id: 'bow',
    name: '弓',
    attackMode: 'ranged',
    basicAttackSkillId: 'basic_physical',
    glow: {
      color: 0x3dffc8,
      accentColor: 0xd8fff2,
      intensity: 2.8,
      edgeIntensity: 0.9,
      breathHz: 0.8,
      breathDepth: 0.3,
      flowSpeed: 0.8,
      lightIntensity: 2.5,
      lightDistance: 4.5,
      haloSize: 0.26,
      haloStrength: 0.2,
      particleCount: 8,
      flareBoost: 2.6,
      flareDecay: 0.3,
    },
  },
};

/** 法杖宝珠的元素配色（SPEC §3.2）：火=橙红、雷=紫蓝、封印=幽紫、治疗=柔和金绿 */
export type StaffElement = 'fire' | 'thunder' | 'seal' | 'heal';

export const STAFF_ELEMENT_COLORS: Record<StaffElement, { color: number; accentColor: number; name: string }> = {
  fire: { color: 0xff5a1a, accentColor: 0xffc070, name: '火' },
  thunder: { color: 0x8a6bff, accentColor: 0xcfd6ff, name: '雷' },
  seal: { color: 0xb03cff, accentColor: 0xe6b8ff, name: '封印' },
  heal: { color: 0xd8e86a, accentColor: 0xf6ffd0, name: '治疗' },
};

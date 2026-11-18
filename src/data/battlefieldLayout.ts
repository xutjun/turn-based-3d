// 战场物件的布局（步骤 15 从 render/scene/battlefield.ts 抽出，DESIGN §11.3）。纯数据，不依赖 three.js。
// 场景搭建（render/scene/battlefield.ts）和探索模式的碰撞 / 寻路（src/explore）读同一份数据：
// 物件挪动后，画面、碰撞、寻路一起跟着变。
//
// 坐标系与 formation.ts 相同：+x 向右，+z 朝向相机（屏幕下方），地面 y = 0，单位米。
// 每类物件的“占地半径”（碰撞用）在 exploreConfig.collision 里，按物件的真实尺寸取值。

/** 残破石柱：radius 是柱身半径（省略时取 PILLAR_RADIUS） */
export interface PillarSpot {
  x: number;
  z: number;
  drums: number;
  broken: boolean;
  radius?: number;
}

/** 倒在地上的断柱：沿模型的 x 轴横躺，rot 为绕 y 轴的转角，len 为长度 */
export interface DrumSpot {
  x: number;
  z: number;
  rot: number;
  len: number;
}

export interface GroundSpot {
  x: number;
  z: number;
}

export interface BannerSpot extends GroundSpot {
  rot: number;
}

/** 石柱的默认柱身半径 */
export const PILLAR_RADIUS = 0.58;
/** 倒地断柱的半径 */
export const DRUM_RADIUS = 0.55;

export const BATTLEFIELD_LAYOUT = {
  /** 残破石柱：主要立在战场后方和两侧，不遮挡站位 */
  pillars: [
    { x: -14.5, z: -8.5, drums: 4, broken: true },
    { x: -9.5, z: -13.8, drums: 5, broken: false },
    { x: -3.2, z: -16.0, drums: 3, broken: true },
    { x: 3.8, z: -14.2, drums: 5, broken: true },
    { x: 10.8, z: -11.2, drums: 2, broken: true },
    { x: 15.0, z: -5.8, drums: 4, broken: false },
    { x: -17.0, z: -1.6, drums: 3, broken: true },
    { x: 17.2, z: 1.8, drums: 2, broken: true },
    { x: -13.4, z: 7.4, drums: 1, broken: true },
    { x: -20.5, z: -11.0, drums: 6, broken: false, radius: 0.75 },
    { x: 8.0, z: -19.5, drums: 6, broken: true, radius: 0.75 },
  ] as PillarSpot[],
  /** 倒地的断柱 */
  drums: [
    { x: -11.2, z: 2.6, rot: 0.7, len: 2.2 },
    { x: 8.6, z: -10.4, rot: -0.4, len: 1.8 },
    { x: -1.2, z: 13.2, rot: 1.9, len: 2.0 },
    { x: -15.6, z: -5.0, rot: 2.4, len: 1.6 },
  ] as DrumSpot[],
  /** 火盆（自带闪烁的暖色点光源；原 renderConfig.BATTLEFIELD_CONFIG.braziers） */
  braziers: [
    { x: -6.6, z: 6.4 },
    { x: 6.4, z: -6.6 },
    { x: -12.2, z: -5.2 },
    { x: -1.5, z: -12.6 },
    { x: 12.4, z: 3.4 },
  ] as GroundSpot[],
  /** 旗帜 */
  banners: [
    { x: -12.6, z: -11.8, rot: 0.75 },
    { x: -5.6, z: -15.2, rot: 0.3 },
    { x: 14.2, z: -1.6, rot: -0.9 },
    { x: 13.6, z: 9.4, rot: -2.2 },
  ] as BannerSpot[],
  /** 骨堆 */
  bonePiles: [
    { x: -9.6, z: 5.0 },
    { x: 3.6, z: -10.2 },
    { x: -3.4, z: 10.4 },
    { x: 11.0, z: -4.2 },
    { x: -13.0, z: -2.4 },
  ] as GroundSpot[],
};

export type BattlefieldLayout = typeof BATTLEFIELD_LAYOUT;

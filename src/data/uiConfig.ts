// 交互界面配置：目标光圈、日志、提示。纯数据，调界面手感只改这里。颜色用 0xRRGGBB。

export const SELECTION_CONFIG = {
  /** 地面光圈半径（米） */
  ringRadius: { hero: 0.72, pet: 0.62, enemy: 0.72, boss: 1.7 },
  ringWidth: 0.09, // 光圈线宽占半径的比例
  ringHeight: 0.06, // 离地高度，避免和地面重叠闪烁
  colors: {
    commander: 0xf2c85a, // 当前待下令单位：旧金
    hostile: 0xff4a2e, // 敌对目标：暗红
    friendly: 0x8fe26a, // 友方目标（治疗 / 复活）：柔绿
  },
  /** 各状态的亮度与呼吸幅度 */
  opacity: {
    commander: { base: 0.75, pulse: 0.2 },
    candidate: { base: 0.22, pulse: 0 }, // 可选但没有被指到
    target: { base: 0.8, pulse: 0.15 }, // 会被这次出手命中
    primary: { base: 1, pulse: 0 }, // 鼠标指着的主目标
  },
  pulseSpeed: 4.5,
};

export const UI_CONFIG = {
  logMaxLines: 300, // 日志面板最多保留的行数
  toastSeconds: 2.2, // 非法操作提示停留时间
  /** 鼠标拾取：单位在屏幕上的可点范围 */
  pick: {
    minHalfWidth: 24, // 最小半宽（像素）
    widthRatio: 0.34, // 半宽 = 屏幕身高 × 该比例
    headPadding: 34, // 头顶条也算在可点范围内
    footPadding: 12,
  },
  /**
   * 头顶名字：平时只显示血条，名字只在 Boss、正在出手、被选中 / 会被命中、鼠标指着时出现；
   * 同时出现的名字互相重叠或压到别的血条时自动往上抬。
   */
  headName: {
    alwaysShowBoss: true, // Boss 的名字始终显示
    lineHeight: 14, // 名字一行的高度（像素）
    step: 14, // 每次上抬的距离
    maxSteps: 8, // 最多上抬几次
    gap: 1, // 名字与其他元素之间至少留的空隙
    hover: { halfWidth: 30, above: 36, below: 84 }, // 鼠标指着的判定范围（像素；Boss 按 2 倍）
  },
};

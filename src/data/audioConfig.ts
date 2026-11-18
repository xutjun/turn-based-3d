// 音效配置：音量、各音效的相对响度、环境音。纯数据，调音量手感只改这里。
// 所有声音都由 assets/audio/SoundEngine.ts 用 Web Audio 实时合成，没有任何音频文件。

/** 音效名称（什么时候播放见 render/units、render/fx 里的调用处） */
export type SoundName =
  | 'swing' // 近战挥击
  | 'arrow' // 弓箭离弦
  | 'cast' // 施法蓄力
  | 'bolt' // 法术光弹 / 火球飞出
  | 'hit' // 受击
  | 'heavyHit' // 重击（连斩第 3 击、旋风斩收尾、暴击）
  | 'dodge' // 闪避 / 未命中
  | 'blast' // 落雷、火柱、爆炸
  | 'heal' // 治疗
  | 'seal' // 封印锁链
  | 'fall' // 倒地
  | 'revive' // 复活
  | 'click' // 界面点击
  | 'roar' // Boss 怒吼（步骤 17 入场过场）：低沉的咆哮
  | 'quake' // Boss 跺地（步骤 17）：极低频的震地轰鸣
  | 'shadow'; // 暗影显形（步骤 17）：低沉的嘶声

export const AUDIO_CONFIG = {
  storageKey: 'dk-battle-audio', // 旧版（步骤 8）记住音量和静音用的本地存储键；步骤 12 起统一存到 SETTINGS_CONFIG.storageKey，只用于迁移
  volume: 0.6, // 默认总音量（0~1）
  muted: false,
  /** 各音效的相对响度（再乘总音量） */
  gain: {
    swing: 0.5,
    arrow: 0.45,
    cast: 0.35,
    bolt: 0.4,
    hit: 0.7,
    heavyHit: 0.95,
    dodge: 0.3,
    blast: 0.8,
    heal: 0.4,
    seal: 0.5,
    fall: 0.7,
    revive: 0.5,
    click: 0.25,
    roar: 0.9,
    quake: 1,
    shadow: 0.45,
  } satisfies Record<SoundName, number>,
  /** 同一种音效两次播放之间的最短间隔（秒）：群体法术 6 个目标同帧受击时只响一声，不会叠成爆音 */
  minInterval: 0.045,
  /** 设置里拖动音量滑块时提示音的最短间隔（秒），拖动时不会连成一片 */
  previewInterval: 0.12,
  /** 同时发声的音效上限，超过的直接丢弃 */
  maxVoices: 14,
  /** 环境低频嗡鸣 */
  ambient: {
    gain: 0.11, // 相对响度
    baseHz: 55, // 两个低频正弦的基准频率，第二个略微失谐形成缓慢的拍频
    detuneHz: 1.3,
    noiseGain: 0.5, // 低通噪声（风声）相对正弦的比例
    noiseCutoffHz: 170,
    swellSeconds: 9, // 音量起伏的周期
    fadeSeconds: 1.5, // 淡入 / 淡出时间
  },
};

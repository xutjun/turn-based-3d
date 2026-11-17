// 音效引擎：全部声音用 Web Audio API 实时合成（振荡器 + 噪声 + 滤波 + 包络），不使用任何音频文件。
//
// - 浏览器不允许页面在用户操作之前出声：第一次点击 / 按键时才创建并启动 AudioContext（unlock）。
//   在那之前 play() 什么都不做，也不会排队，所以不会在解锁的瞬间把攒下的声音一起放出来。
// - 战斗倍速：音效的长度按倍速缩短（2 倍速时每个声音只有一半长），触发时机由演出决定，所以音画同步。
// - 跳过动画：不播放任何战斗音效（界面点击音和环境音不受影响）。
// - 标签页切到后台时暂停发声，回来后恢复。
// - 同一种音效在很短的时间内重复触发只响一次，并限制同时发声的数量。
// - 步骤 12：分三路音量——主音量（master）下面挂“音效”（战斗音效 + 界面音）和“环境音”两条总线；
//   战斗音效先经过一个“暂停闸门”，打开设置菜单暂停时闸门关上（正在响的战斗音效立即淡出，新的不再排），
//   界面音和环境音不受暂停影响（设置里拖动滑块要能听到提示音）。
//   音量设置的保存由界面层的 SettingsStore 负责，引擎只管发声。

import { AUDIO_CONFIG, type SoundName } from '../../data/audioConfig';

/** 演出给出的播放条件 */
export interface SoundClock {
  /** 当前战斗倍速（1 / 2） */
  rate(): number;
  /** 是否正在跳过动画 */
  skip(): boolean;
}

export interface SoundSettings {
  volume: number; // 主音量 0~1
  muted: boolean;
  sfx?: number; // 音效音量 0~1（默认 1）
  ambient?: number; // 环境音音量 0~1（默认 1）
}

/** 试听提示音走哪条总线 */
export type SoundChannel = 'master' | 'sfx' | 'ambient';

/** 给演出层用的最小接口：方便测试时换成记录调用的假对象 */
export interface SoundPlayer {
  play(name: SoundName, intensity?: number): void;
}

type ContextFactory = () => AudioContext;

const UI_SOUNDS: ReadonlySet<SoundName> = new Set<SoundName>(['click']);

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

export class SoundEngine implements SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** 音效总线（战斗音效 + 界面音） */
  private sfxBus: GainNode | null = null;
  /** 战斗音效的暂停闸门（接在音效总线前面） */
  private gate: GainNode | null = null;
  /** 环境音总线 */
  private ambientBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambient: { gain: GainNode; stop(): void } | null = null;
  private readonly settings: Required<SoundSettings>;
  private readonly lastPlayed = new Map<SoundName, number>();
  private lastPreview = -Infinity;
  private voices = 0;
  private disposed = false;
  private pausedFlag = false;

  /**
   * @param clock 战斗倍速与跳过动画的状态
   * @param createContext 创建 AudioContext 的函数（测试时注入假的）；默认用浏览器的
   * @param settings 初始音量设置（默认见 AUDIO_CONFIG）
   */
  constructor(
    private readonly clock: SoundClock,
    private readonly createContext: ContextFactory | null = defaultContextFactory(),
    settings: SoundSettings = { volume: AUDIO_CONFIG.volume, muted: AUDIO_CONFIG.muted },
  ) {
    this.settings = {
      volume: clamp01(settings.volume),
      muted: settings.muted,
      sfx: clamp01(settings.sfx ?? 1),
      ambient: clamp01(settings.ambient ?? 1),
    };
    if (typeof window !== 'undefined') {
      // 第一次用户操作时解锁；之后每次操作顺便确认没有被浏览器挂起
      window.addEventListener('pointerdown', this.onGesture, true);
      window.addEventListener('keydown', this.onGesture, true);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  // ------------------------------------------------------------------
  // 设置
  // ------------------------------------------------------------------

  /** 主音量 */
  get volume(): number {
    return this.settings.volume;
  }

  get sfxVolume(): number {
    return this.settings.sfx;
  }

  get ambientVolume(): number {
    return this.settings.ambient;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  /** 浏览器是否支持合成音效 */
  get supported(): boolean {
    return this.createContext !== null;
  }

  /** 是否已经可以出声（用户已经操作过页面） */
  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setVolume(volume: number): void {
    this.settings.volume = clamp01(volume);
    this.applyVolume();
  }

  setSfxVolume(volume: number): void {
    this.settings.sfx = clamp01(volume);
    this.applyVolume();
  }

  setAmbientVolume(volume: number): void {
    this.settings.ambient = clamp01(volume);
    this.applyVolume();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    this.applyVolume();
  }

  /** 暂停战斗音效（打开设置菜单时）：正在响的战斗音效淡出，暂停期间不再播放新的战斗音效 */
  setPaused(on: boolean): void {
    this.pausedFlag = on;
    if (this.ctx && this.gate) this.gate.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  private applyVolume(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const target = this.settings.muted ? 0 : this.settings.volume;
    // 短暂过渡，避免音量突变产生“咔”声
    this.master.gain.setTargetAtTime(target, ctx.currentTime, 0.03);
    this.sfxBus?.gain.setTargetAtTime(this.settings.sfx, ctx.currentTime, 0.03);
    this.ambientBus?.gain.setTargetAtTime(this.settings.ambient, ctx.currentTime, 0.03);
  }

  // ------------------------------------------------------------------
  // 解锁、后台、释放
  // ------------------------------------------------------------------

  private readonly onGesture = (): void => this.unlock();

  /** 在用户操作里调用：创建 / 恢复 AudioContext 并开始环境音。重复调用没有副作用。 */
  unlock(): void {
    if (this.disposed || !this.createContext) return;
    if (!this.ctx) {
      try {
        this.ctx = this.createContext();
      } catch {
        return; // 浏览器拒绝创建：保持无声，不影响战斗
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.settings.muted ? 0 : this.settings.volume;
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.settings.sfx;
      this.sfxBus.connect(this.master);
      this.gate = ctx.createGain();
      this.gate.gain.value = this.pausedFlag ? 0 : 1;
      this.gate.connect(this.sfxBus);
      this.ambientBus = ctx.createGain();
      this.ambientBus.gain.value = this.settings.ambient;
      this.ambientBus.connect(this.master);
      this.startAmbient();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume().catch(() => undefined);
  }

  private readonly onVisibility = (): void => {
    if (!this.ctx) return;
    // 切到后台时演出也停了，声音跟着暂停；回来后恢复
    if (document.hidden) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  };

  dispose(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.onGesture, true);
      window.removeEventListener('keydown', this.onGesture, true);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.ambient?.stop();
    this.ambient = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.gate = null;
    this.ambientBus = null;
  }

  // ------------------------------------------------------------------
  // 播放
  // ------------------------------------------------------------------

  /**
   * 播放一个音效。
   * @param intensity 力度（默认 1）：大于 1 更响、略低沉，用于暴击和重击
   */
  play(name: SoundName, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.gate || ctx.state !== 'running' || this.settings.muted) return;
    const ui = UI_SOUNDS.has(name);
    if (!ui && (this.clock.skip() || this.pausedFlag)) return; // 跳过动画、暂停时不放战斗音效
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(name);
    if (last !== undefined && now - last < AUDIO_CONFIG.minInterval) return;
    if (this.voices >= AUDIO_CONFIG.maxVoices) return;
    this.lastPlayed.set(name, now);

    // 倍速越高声音越短；界面音不随倍速变化，也不经过暂停闸门
    const rate = ui ? 1 : Math.max(0.25, this.clock.rate());
    this.voice(name, intensity, ui ? this.sfxBus : this.gate, now, 1 / rate);
  }

  /**
   * 试听提示音（设置里拖动音量滑块时）：拖“环境音”时提示音走环境音总线，其余走音效总线，
   * 所以听到的响度就是调整后的结果。限制频率，拖动时不会连成一片。
   */
  preview(channel: SoundChannel): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.ambientBus || ctx.state !== 'running' || this.settings.muted) return;
    const now = ctx.currentTime;
    if (now - this.lastPreview < AUDIO_CONFIG.previewInterval) return;
    if (this.voices >= AUDIO_CONFIG.maxVoices) return;
    this.lastPreview = now;
    this.voice('click', 1.4, channel === 'ambient' ? this.ambientBus : this.sfxBus, now, 1);
  }

  private voice(name: SoundName, intensity: number, destination: AudioNode, now: number, stretch: number): void {
    const ctx = this.ctx!;
    const voice = new Voice(ctx, destination, this.noise(ctx), now, stretch, AUDIO_CONFIG.gain[name] * Math.min(1.6, intensity));
    SOUNDS[name](voice, intensity);
    this.voices += 1;
    voice.onEnded(() => (this.voices -= 1));
  }

  /** 一段白噪声，所有噪声类音效共用 */
  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 1.5);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  /** 环境低频嗡鸣：两个略微失谐的低频正弦 + 低通噪声，音量缓慢起伏 */
  private startAmbient(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.ambient) return;
    const a = AUDIO_CONFIG.ambient;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(a.gain, ctx.currentTime, a.fadeSeconds / 3);
    gain.connect(this.ambientBus ?? this.master);

    const sources: (OscillatorNode | AudioBufferSourceNode)[] = [];
    for (const hz of [a.baseHz, a.baseHz + a.detuneHz, a.baseHz * 1.5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.value = hz === a.baseHz * 1.5 ? 0.25 : 0.6;
      osc.connect(g).connect(gain);
      osc.start();
      sources.push(osc);
    }
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise(ctx);
    wind.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = a.noiseCutoffHz;
    const windGain = ctx.createGain();
    windGain.gain.value = a.noiseGain;
    wind.connect(lowpass).connect(windGain).connect(gain);
    wind.start();
    sources.push(wind);

    // 缓慢起伏：用一个极低频振荡器调制音量
    const swell = ctx.createOscillator();
    swell.frequency.value = 1 / a.swellSeconds;
    const depth = ctx.createGain();
    depth.gain.value = a.gain * 0.35;
    swell.connect(depth).connect(gain.gain);
    swell.start();
    sources.push(swell);

    this.ambient = {
      gain,
      stop: () => {
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            // 已经停了
          }
        }
        gain.disconnect();
      },
    };
  }
}

function defaultContextFactory(): ContextFactory | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Ctor ? () => new Ctor() : null;
}

// ----------------------------------------------------------------------
// 合成
// ----------------------------------------------------------------------

/** 一次音效：若干个振荡器 / 噪声片段，共用一个输出增益。时间参数都是“1 倍速下的秒数”，由 stretch 换算 */
class Voice {
  private readonly out: GainNode;
  private end = 0;
  private last: AudioScheduledSourceNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly noiseBuffer: AudioBuffer,
    private readonly start: number,
    private readonly stretch: number,
    gain: number,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = gain;
    this.out.connect(destination);
  }

  /** 包络：快速起音，然后指数衰减到无声 */
  private envelope(peak: number, at: number, duration: number, attack: number): GainNode {
    const g = this.ctx.createGain();
    const t0 = this.start + at * this.stretch;
    const t1 = t0 + Math.max(0.012, duration * this.stretch);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.min(attack, (t1 - t0) * 0.5));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    g.connect(this.out);
    return g;
  }

  private track(node: AudioScheduledSourceNode, at: number, duration: number): void {
    const t0 = this.start + at * this.stretch;
    const t1 = t0 + Math.max(0.012, duration * this.stretch) + 0.02;
    node.start(t0);
    node.stop(t1);
    if (t1 > this.end) {
      this.end = t1;
      this.last = node;
    }
  }

  /** 一个音：频率从 from 滑到 to */
  tone(type: OscillatorType, from: number, to: number, duration: number, peak = 1, at = 0, attack = 0.006): this {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    const t0 = this.start + at * this.stretch;
    osc.frequency.setValueAtTime(from, t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + duration * this.stretch);
    osc.connect(this.envelope(peak, at, duration, attack));
    this.track(osc, at, duration);
    return this;
  }

  /** 一段过滤后的噪声：滤波频率从 from 扫到 to */
  noise(
    filter: BiquadFilterType,
    from: number,
    to: number,
    duration: number,
    peak = 1,
    at = 0,
    q = 1,
    attack = 0.004,
  ): this {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    const t0 = this.start + at * this.stretch;
    f.frequency.setValueAtTime(from, t0);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + duration * this.stretch);
    src.connect(f).connect(this.envelope(peak, at, duration, attack));
    this.track(src, at, duration);
    return this;
  }

  /** 最后一个声源结束时回调，并断开输出 */
  onEnded(fn: () => void): void {
    const done = (): void => {
      this.out.disconnect();
      fn();
    };
    if (this.last) this.last.onended = done;
    else done();
  }
}

/** 每种音效怎么合成。intensity > 1 时更低沉、更长 */
const SOUNDS: Record<SoundName, (v: Voice, intensity: number) => void> = {
  // 挥击：一道由低到高扫过的风声
  swing: (v) => v.noise('bandpass', 500, 2600, 0.2, 1, 0, 1.4, 0.05),
  // 弓箭离弦：弓弦的一声“嘣” + 箭矢破空
  arrow: (v) => v.tone('triangle', 240, 110, 0.09, 0.8).noise('highpass', 1800, 5200, 0.16, 0.7, 0.01, 0.7, 0.02),
  // 施法蓄力：缓缓升高的两个音 + 细碎的高频闪烁
  cast: (v) =>
    v
      .tone('sine', 220, 520, 0.5, 0.7, 0, 0.2)
      .tone('triangle', 331, 780, 0.5, 0.35, 0.04, 0.22)
      .noise('bandpass', 3000, 6500, 0.45, 0.18, 0.05, 6, 0.2),
  // 法术飞出：短促下滑的音 + 气流
  bolt: (v) => v.tone('sawtooth', 620, 240, 0.18, 0.35).noise('bandpass', 2400, 900, 0.22, 0.6, 0, 1.2, 0.02),
  // 受击：低频的一记闷响 + 短促的噪声
  hit: (v) => v.tone('sine', 170, 62, 0.14, 1).noise('lowpass', 2400, 500, 0.1, 0.7),
  // 重击：更低、更长，加一层金属碰撞的高频
  heavyHit: (v) =>
    v
      .tone('sine', 150, 42, 0.3, 1)
      .tone('square', 92, 46, 0.2, 0.3)
      .noise('lowpass', 3200, 300, 0.24, 0.9)
      .noise('bandpass', 4200, 2600, 0.08, 0.35, 0, 5),
  // 闪避：很轻的一道风声
  dodge: (v) => v.noise('bandpass', 1600, 3600, 0.14, 1, 0, 2, 0.04),
  // 落雷 / 火柱 / 爆炸：一声炸裂 + 滚动的低频
  blast: (v) =>
    v
      .noise('highpass', 2500, 800, 0.07, 0.8)
      .noise('lowpass', 1400, 90, 0.7, 1, 0.01, 0.8, 0.01)
      .tone('sine', 110, 34, 0.6, 0.9, 0.01),
  // 治疗：三个依次响起的柔和高音
  heal: (v) =>
    v
      .tone('sine', 523, 523, 0.5, 0.6, 0, 0.03)
      .tone('sine', 659, 659, 0.5, 0.5, 0.09, 0.03)
      .tone('sine', 784, 784, 0.6, 0.5, 0.18, 0.03)
      .tone('triangle', 1568, 1568, 0.35, 0.12, 0.2, 0.05),
  // 封印：下沉的失谐低音 + 锁链的金属颤音
  seal: (v) =>
    v
      .tone('sawtooth', 196, 82, 0.55, 0.45, 0, 0.02)
      .tone('sawtooth', 201, 86, 0.55, 0.4, 0, 0.02)
      .tone('square', 1320, 990, 0.12, 0.16, 0.05)
      .tone('square', 1480, 1110, 0.12, 0.14, 0.16)
      .noise('bandpass', 5200, 3400, 0.3, 0.3, 0.04, 8),
  // 倒地：身体落地的一声闷响
  fall: (v) => v.tone('sine', 96, 36, 0.34, 1, 0.02).noise('lowpass', 700, 120, 0.3, 0.8, 0.02),
  // 复活：缓缓上扬的和弦 + 高处的光点
  revive: (v) =>
    v
      .tone('sine', 262, 523, 0.9, 0.5, 0, 0.3)
      .tone('sine', 330, 659, 0.9, 0.42, 0.06, 0.3)
      .tone('sine', 392, 784, 0.9, 0.42, 0.12, 0.3)
      .tone('triangle', 1047, 2093, 0.5, 0.12, 0.45, 0.1)
      .noise('bandpass', 4000, 7000, 0.6, 0.1, 0.3, 5, 0.25),
  // 界面点击：很短的一声
  click: (v) => v.tone('triangle', 760, 520, 0.05, 1).noise('highpass', 3000, 3000, 0.02, 0.3),
};

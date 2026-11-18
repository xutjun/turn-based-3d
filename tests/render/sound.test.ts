import { describe, expect, it } from 'vitest';
import { SoundEngine } from '../../src/assets/audio/SoundEngine';
import { AUDIO_CONFIG, type SoundName } from '../../src/data/audioConfig';
import { AURA_SOUND, BURST_SOUND, PROJECTILE_SOUND, releaseSound, windupSound } from '../../src/render/units/soundCues';

// 测试环境没有 Web Audio：用一个只记录调用的假 AudioContext，检查“什么时候发声、发多长、多响”。

interface Scheduled {
  kind: 'osc' | 'noise';
  start: number;
  stop: number;
}

function fakeContext() {
  const log: Scheduled[] = [];
  const sources: { onended: (() => void) | null }[] = [];
  const gains: { value: number }[] = [];
  const param = (value = 0) => ({
    value,
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime(v: number) {
      this.value = v;
    },
  });
  const node = () => ({ connect: (n: unknown) => n, disconnect() {} });
  const source = (kind: Scheduled['kind']) => {
    const entry: Scheduled = { kind, start: -1, stop: -1 };
    const src = {
      ...node(),
      type: 'sine',
      loop: false,
      buffer: null as unknown,
      frequency: param(),
      onended: null as (() => void) | null,
      start(t = 0) {
        entry.start = t;
        log.push(entry);
      },
      stop(t = 0) {
        entry.stop = t;
      },
    };
    sources.push(src);
    return src;
  };
  const ctx = {
    state: 'running' as 'running' | 'suspended' | 'closed',
    currentTime: 0,
    sampleRate: 8000,
    destination: node(),
    createGain() {
      const g = { ...node(), gain: param(1) };
      gains.push(g.gain);
      return g;
    },
    createOscillator: () => source('osc'),
    createBufferSource: () => source('noise'),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createBuffer: (_c: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    resume: async () => {
      ctx.state = 'running';
    },
    suspend: async () => {
      ctx.state = 'suspended';
    },
    close: async () => {
      ctx.state = 'closed';
    },
  };
  /** 模拟所有已排的声源都播完了（触发结束回调，释放同时发声的名额） */
  const finishAll = (): void => {
    for (const s of sources.splice(0)) s.onended?.();
  };
  return { ctx, log, gains, finishAll };
}

function setup(clock = { rate: 1, skip: false }, settings = { volume: 0.5, muted: false }) {
  const fake = fakeContext();
  let created = 0;
  const engine = new SoundEngine(
    { rate: () => clock.rate, skip: () => clock.skip },
    () => {
      created += 1;
      return fake.ctx as unknown as AudioContext;
    },
    settings,
  );
  /** 环境音之后新排进来的声源 */
  const sfx = (): Scheduled[] => fake.log.filter((e) => e.stop >= 0);
  return { engine, clock, fake, sfx, created: () => created };
}

const length = (list: Scheduled[]): number => Math.max(...list.map((e) => e.stop)) - Math.min(...list.map((e) => e.start));

describe('音效引擎', () => {
  it('用户操作之前不创建 AudioContext、不出声，也不会把声音攒到解锁时一起放', () => {
    const { engine, sfx, created } = setup();
    engine.play('hit');
    engine.play('cast');
    expect(created()).toBe(0);
    expect(engine.unlocked).toBe(false);
    engine.unlock();
    expect(created()).toBe(1);
    expect(engine.unlocked).toBe(true);
    expect(sfx()).toHaveLength(0); // 解锁前的两次播放没有被补放
    engine.unlock(); // 重复解锁不会再建一个
    expect(created()).toBe(1);
  });

  it('解锁后开始环境低频嗡鸣，并能播放每一种音效', () => {
    const { engine, fake, sfx } = setup();
    engine.unlock();
    const ambient = fake.log.length;
    expect(ambient).toBeGreaterThanOrEqual(3); // 低频正弦 + 噪声 + 起伏
    for (const name of Object.keys(AUDIO_CONFIG.gain) as SoundName[]) {
      const before = sfx().length;
      fake.ctx.currentTime += 1;
      engine.play(name);
      expect(sfx().length, name).toBeGreaterThan(before);
      fake.finishAll(); // 这一声播完（音效种类多于同时发声上限时不会被丢弃）
    }
  });

  it('战斗倍速 2 倍时音效长度减半；界面点击音不受倍速影响', () => {
    const normal = setup({ rate: 1, skip: false });
    normal.engine.unlock();
    normal.engine.play('revive');
    const fast = setup({ rate: 2, skip: false });
    fast.engine.unlock();
    fast.engine.play('revive');
    expect(length(fast.sfx())).toBeLessThan(length(normal.sfx()) * 0.6);
    expect(length(fast.sfx())).toBeGreaterThan(length(normal.sfx()) * 0.4);

    const click1 = setup({ rate: 1, skip: false });
    click1.engine.unlock();
    click1.engine.play('click');
    const click2 = setup({ rate: 2, skip: false });
    click2.engine.unlock();
    click2.engine.play('click');
    expect(length(click2.sfx())).toBeCloseTo(length(click1.sfx()), 5);
  });

  it('跳过动画时不放战斗音效，界面点击音照常', () => {
    const { engine, clock, fake, sfx } = setup();
    engine.unlock();
    clock.skip = true;
    engine.play('hit');
    engine.play('blast');
    expect(sfx()).toHaveLength(0);
    engine.play('click');
    expect(sfx().length).toBeGreaterThan(0);
    clock.skip = false;
    fake.ctx.currentTime += 1;
    const before = sfx().length;
    engine.play('hit');
    expect(sfx().length).toBeGreaterThan(before);
  });

  it('同一帧里重复触发的同一种音效只响一次（群体法术 6 个目标同时受击）', () => {
    const { engine, fake, sfx } = setup();
    engine.unlock();
    engine.play('hit');
    const once = sfx().length;
    for (let i = 0; i < 5; i++) engine.play('hit');
    expect(sfx()).toHaveLength(once);
    engine.play('blast'); // 不同的音效不受影响
    expect(sfx().length).toBeGreaterThan(once);
    fake.ctx.currentTime += AUDIO_CONFIG.minInterval + 0.01;
    const before = sfx().length;
    engine.play('hit');
    expect(sfx().length).toBeGreaterThan(before);
  });

  it('同时发声的数量有上限', () => {
    const { engine, fake, sfx } = setup();
    engine.unlock();
    const names = Object.keys(AUDIO_CONFIG.gain) as SoundName[];
    let played = 0;
    for (let i = 0; i < 40; i++) {
      const before = sfx().length;
      fake.ctx.currentTime += AUDIO_CONFIG.minInterval + 0.001;
      engine.play(names[i % names.length]!);
      if (sfx().length > before) played += 1;
    }
    expect(played).toBe(AUDIO_CONFIG.maxVoices);
  });

  it('静音和音量：静音时不排任何声音，总音量随设置变化', () => {
    const { engine, fake, sfx } = setup({ rate: 1, skip: false }, { volume: 0.5, muted: true });
    engine.unlock();
    const master = fake.gains[0]!;
    expect(master.value).toBe(0);
    engine.play('hit');
    expect(sfx()).toHaveLength(0);
    engine.setMuted(false);
    expect(master.value).toBeCloseTo(0.5);
    engine.setVolume(0.2);
    expect(master.value).toBeCloseTo(0.2);
    expect(engine.volume).toBeCloseTo(0.2);
    engine.setVolume(7); // 超出范围的值被截断
    expect(engine.volume).toBe(1);
    engine.play('hit');
    expect(sfx().length).toBeGreaterThan(0);
  });

  it('AudioContext 被挂起（标签页在后台）时不排声音；浏览器不支持时静默', () => {
    const { engine, fake, sfx } = setup();
    engine.unlock();
    fake.ctx.state = 'suspended';
    engine.play('hit');
    expect(sfx()).toHaveLength(0);

    const none = new SoundEngine({ rate: () => 1, skip: () => false }, null, { volume: 1, muted: false });
    expect(none.supported).toBe(false);
    none.unlock();
    none.play('hit'); // 不抛错
    expect(none.unlocked).toBe(false);
  });

  it('dispose 之后不再出声', () => {
    const { engine, fake } = setup();
    engine.unlock();
    engine.dispose();
    expect(fake.ctx.state).toBe('closed');
    const scheduled = fake.log.length; // 环境音的声源在 dispose 时被停掉，不算新的声音
    engine.play('hit');
    engine.unlock();
    expect(fake.log).toHaveLength(scheduled);
  });
});

describe('动作 → 音效', () => {
  it('SPEC 要求的声音都有对应的动作', () => {
    expect(releaseSound('melee')).toBe('swing'); // 挥击
    expect(windupSound('cast')).toBe('cast'); // 施法
    expect(BURST_SOUND.pillarUp).toBe('heal'); // 治疗
    expect(PROJECTILE_SOUND.arrow).toBe('arrow');
    expect(PROJECTILE_SOUND.fireball).toBe('bolt');
    expect(BURST_SOUND.thunder).toBe('blast');
  });

  it('一个动作只在一个地方发声：命中火花、复活光芒不重复发声', () => {
    expect(BURST_SOUND.impact).toBeNull();
    expect(BURST_SOUND.reviveLight).toBeNull();
    expect(releaseSound('bow')).toBeNull(); // 箭声跟着箭矢
    expect(windupSound('melee')).toBeNull();
    expect(Object.values(AURA_SOUND).every((s) => s === null)).toBe(true);
  });

  it('每个音效都配了响度', () => {
    for (const map of [PROJECTILE_SOUND, BURST_SOUND]) {
      for (const name of Object.values(map)) if (name) expect(AUDIO_CONFIG.gain[name]).toBeGreaterThan(0);
    }
  });
});

describe('音效引擎：步骤 12 的分路音量、暂停、试听', () => {
  it('解锁后建立 主音量 → 音效总线 / 环境音总线 两路，初始值来自设置', () => {
    const fake = fakeContext();
    const engine = new SoundEngine({ rate: () => 1, skip: () => false }, () => fake.ctx as unknown as AudioContext, {
      volume: 0.5,
      muted: false,
      sfx: 0.3,
      ambient: 0.8,
    });
    engine.unlock();
    // 创建顺序：主音量、音效总线、暂停闸门、环境音总线
    const [master, sfx, gate, ambient] = fake.gains;
    expect(master!.value).toBeCloseTo(0.5);
    expect(sfx!.value).toBeCloseTo(0.3);
    expect(gate!.value).toBe(1);
    expect(ambient!.value).toBeCloseTo(0.8);
    engine.setSfxVolume(0.9);
    engine.setAmbientVolume(2); // 越界截断
    expect(sfx!.value).toBeCloseTo(0.9);
    expect(ambient!.value).toBe(1);
    expect(engine.sfxVolume).toBeCloseTo(0.9);
    expect(engine.ambientVolume).toBe(1);
  });

  it('暂停时战斗音效不再播放、正在响的淡出；界面音照常；恢复后继续', () => {
    const { engine, fake, sfx } = setup();
    engine.unlock();
    const gate = fake.gains[2]!;
    engine.setPaused(true);
    expect(engine.paused).toBe(true);
    expect(gate.value).toBe(0);
    engine.play('hit');
    expect(sfx()).toHaveLength(0);
    engine.play('click');
    expect(sfx().length).toBeGreaterThan(0);
    const before = sfx().length;
    engine.setPaused(false);
    expect(gate.value).toBe(1);
    fake.ctx.currentTime = 1;
    engine.play('hit');
    expect(sfx().length).toBeGreaterThan(before);
  });

  it('解锁之前就暂停：解锁时闸门直接是关着的', () => {
    const { engine, fake } = setup();
    engine.setPaused(true);
    engine.unlock();
    expect(fake.gains[2]!.value).toBe(0);
  });

  it('试听提示音：拖动时有声音，频率受限；静音时不响', () => {
    const { engine, fake, sfx } = setup();
    engine.unlock();
    engine.preview('sfx');
    const once = sfx().length;
    expect(once).toBeGreaterThan(0);
    engine.preview('ambient'); // 同一时刻再拖：被限频
    expect(sfx()).toHaveLength(once);
    fake.ctx.currentTime = AUDIO_CONFIG.previewInterval + 0.01;
    engine.preview('ambient');
    expect(sfx().length).toBeGreaterThan(once);
    engine.setMuted(true);
    fake.ctx.currentTime = 5;
    const n = sfx().length;
    engine.preview('master');
    expect(sfx()).toHaveLength(n);
  });
});

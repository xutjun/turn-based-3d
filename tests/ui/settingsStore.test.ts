import { describe, expect, it } from 'vitest';
import { AUDIO_CONFIG } from '../../src/data/audioConfig';
import { QUALITY_CONFIG } from '../../src/data/renderConfig';
import { SETTINGS_CONFIG } from '../../src/data/uiConfig';
import {
  DEFAULT_GAME_SETTINGS,
  SettingsStore,
  applyUrlOverrides,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  type GameSettings,
  type StorageLike,
} from '../../src/ui/settings/settingsStore';

/** 内存里的假本地存储 */
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike & { data: Map<string, string>; writes: number } = {
    data,
    writes: 0,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      storage.writes += 1;
      data.set(k, v);
    },
  };
  return storage;
}

/** 读写都抛错的存储（无痕模式、被禁用） */
const brokenStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

const KEY = SETTINGS_CONFIG.storageKey;
const CUSTOM: GameSettings = {
  resolution: '1680x1050',
  lowQuality: true,
  master: 0.3,
  sfx: 0.75,
  ambient: 0.1,
  muted: true,
};

describe('设置：保存与读取', () => {
  it('没有保存过 / 没有存储 / 存储抛错 / 内容损坏时都用默认值', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadSettings(brokenStorage)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadSettings(memoryStorage({ [KEY]: '{坏掉的 JSON' }))).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadSettings(memoryStorage({ [KEY]: 'null' }))).toEqual(DEFAULT_GAME_SETTINGS);
    expect(DEFAULT_GAME_SETTINGS.resolution).toBe('fit');
  });

  it('保存后再读取得到同样的设置（模拟刷新页面）', () => {
    const storage = memoryStorage();
    expect(saveSettings(storage, CUSTOM)).toBe(true);
    expect(loadSettings(storage)).toEqual(CUSTOM);
  });

  it('写不进存储时返回 false，不抛错', () => {
    expect(saveSettings(brokenStorage, CUSTOM)).toBe(false);
    expect(saveSettings(null, CUSTOM)).toBe(false);
  });

  it('非法的项逐项回退默认值，音量截到 0~1', () => {
    const s = sanitizeSettings({ resolution: '9999x1', lowQuality: 'yes', master: 7, sfx: -1, ambient: 'loud', muted: 1 });
    expect(s).toEqual({ ...DEFAULT_GAME_SETTINGS, master: 1, sfx: 0 });
    // 部分缺失：其余项保留
    expect(sanitizeSettings({ master: 0.2 })).toEqual({ ...DEFAULT_GAME_SETTINGS, master: 0.2 });
  });

  it('兼容旧版本：新键不存在时从旧的画质键和音量键迁移', () => {
    const storage = memoryStorage({
      [QUALITY_CONFIG.storageKey]: 'low',
      [AUDIO_CONFIG.storageKey]: JSON.stringify({ volume: 0.25, muted: true }),
    });
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_GAME_SETTINGS, lowQuality: true, master: 0.25, muted: true });
    // 新键存在时以新键为准
    saveSettings(storage, CUSTOM);
    expect(loadSettings(storage)).toEqual(CUSTOM);
  });
});

describe('设置：地址参数优先', () => {
  it('?quality=low / high、?res=、?mute= 覆盖保存的设置', () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(applyUrlOverrides(CUSTOM, q('quality=high')).lowQuality).toBe(false);
    expect(applyUrlOverrides(DEFAULT_GAME_SETTINGS, q('quality=low')).lowQuality).toBe(true);
    expect(applyUrlOverrides(CUSTOM, q('res=fit')).resolution).toBe('fit');
    expect(applyUrlOverrides(CUSTOM, q('res=123x45')).resolution).toBe(CUSTOM.resolution); // 非法值忽略
    expect(applyUrlOverrides(CUSTOM, q('mute=0')).muted).toBe(false);
    expect(applyUrlOverrides(CUSTOM, q('')).lowQuality).toBe(true);
  });

  it('地址参数只在本次生效：玩家改别的项时，被覆盖的项不会被写回存储', () => {
    const storage = memoryStorage();
    saveSettings(storage, { ...DEFAULT_GAME_SETTINGS, lowQuality: false });
    const store = new SettingsStore(storage, new URLSearchParams('quality=low'), KEY);
    expect(store.value.lowQuality).toBe(true); // 地址参数生效
    store.set('master', 0.4);
    const saved = loadSettings(storage);
    expect(saved.master).toBe(0.4);
    expect(saved.lowQuality).toBe(false); // 没有被地址参数污染
    // 玩家在设置里亲自改了画质：这一项才保存
    store.set('lowQuality', true);
    expect(loadSettings(storage).lowQuality).toBe(true);
  });
});

describe('设置：SettingsStore', () => {
  it('每次修改立即保存并通知订阅者；取消订阅后不再通知', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage, new URLSearchParams(), KEY);
    const seen: string[] = [];
    const off = store.onChange((s, key) => seen.push(`${key}=${String(s[key])}`));
    store.set('resolution', '1920x1200');
    store.set('muted', true);
    store.set('sfx', 0.5);
    expect(seen).toEqual(['resolution=1920x1200', 'muted=true', 'sfx=0.5']);
    expect(loadSettings(storage)).toEqual({ ...DEFAULT_GAME_SETTINGS, resolution: '1920x1200', muted: true, sfx: 0.5 });
    off();
    store.set('sfx', 0.6);
    expect(seen).toHaveLength(3);
  });

  it('值没变时不重复写存储；非法值被整理', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage, new URLSearchParams(), KEY);
    store.set('master', 0.5);
    const writes = storage.writes;
    store.set('master', 0.5);
    expect(storage.writes).toBe(writes);
    store.set('ambient', 3);
    expect(store.value.ambient).toBe(1);
  });

  it('存储不可用时设置照样在本次生效', () => {
    const store = new SettingsStore(brokenStorage, new URLSearchParams(), KEY);
    store.set('lowQuality', true);
    expect(store.value.lowQuality).toBe(true);
  });
});

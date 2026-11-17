// 设置的保存与读取：分辨率、画质、主音量 / 音效 / 环境音、静音，统一存成一个 JSON 放在本地存储里。
// - 读写都包在 try/catch 里：无痕模式、存储被禁用、内容损坏时一律用默认值，不影响游戏。
// - 地址参数（?quality=low 等）优先于保存的设置，但只在本次生效，不会被写回存储。
// - 兼容步骤 8 / 9 的旧存储键（画质、音量各存一个键）：新键不存在时从旧键读一次。
// 纯逻辑：存储对象由外部传入（测试时用假的），不直接访问 window。

import { AUDIO_CONFIG } from '../../data/audioConfig';
import { QUALITY_CONFIG } from '../../data/renderConfig';
import { SETTINGS_CONFIG } from '../../data/uiConfig';
import { isResolutionId, type ResolutionId } from '../layout/viewportMath';

export interface GameSettings {
  resolution: ResolutionId;
  lowQuality: boolean;
  /** 主音量 0~1 */
  master: number;
  /** 音效（战斗音效和界面音）0~1 */
  sfx: number;
  /** 环境音 0~1 */
  ambient: number;
  muted: boolean;
}

/** 本地存储的最小接口（浏览器的 localStorage 满足它） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = {
  resolution: 'fit',
  lowQuality: false,
  master: AUDIO_CONFIG.volume,
  sfx: 1,
  ambient: 1,
  muted: AUDIO_CONFIG.muted,
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const unit = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : fallback);

/** 把任意内容整理成合法的设置：缺的、类型不对的、越界的项用默认值（数值截到 0~1） */
export function sanitizeSettings(raw: unknown, fallback: Readonly<GameSettings> = DEFAULT_GAME_SETTINGS): GameSettings {
  const r = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    resolution: isResolutionId(r['resolution']) ? r['resolution'] : fallback.resolution,
    lowQuality: typeof r['lowQuality'] === 'boolean' ? r['lowQuality'] : fallback.lowQuality,
    master: unit(r['master'], fallback.master),
    sfx: unit(r['sfx'], fallback.sfx),
    ambient: unit(r['ambient'], fallback.ambient),
    muted: typeof r['muted'] === 'boolean' ? r['muted'] : fallback.muted,
  };
}

/** 从旧版本的存储键读出画质和音量（没有就用默认值） */
function legacySettings(storage: StorageLike): GameSettings {
  const s = { ...DEFAULT_GAME_SETTINGS };
  try {
    s.lowQuality = storage.getItem(QUALITY_CONFIG.storageKey) === 'low';
  } catch {
    // 忽略
  }
  try {
    const raw = storage.getItem(AUDIO_CONFIG.storageKey);
    if (raw) {
      const audio = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
      s.master = unit(audio.volume, s.master);
      if (typeof audio.muted === 'boolean') s.muted = audio.muted;
    }
  } catch {
    // 忽略
  }
  return s;
}

/** 读取保存的设置；读不到或内容损坏时返回默认值 */
export function loadSettings(storage: StorageLike | null, key = SETTINGS_CONFIG.storageKey): GameSettings {
  if (!storage) return { ...DEFAULT_GAME_SETTINGS };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return legacySettings(storage);
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

/** 保存设置；返回是否写成功（写不了时只在本次生效） */
export function saveSettings(storage: StorageLike | null, settings: GameSettings, key = SETTINGS_CONFIG.storageKey): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(sanitizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

/**
 * 地址参数覆盖（只影响本次，不写回存储）：
 *   quality=low / high      画质
 *   res=1920x1200 / fit     分辨率
 *   mute=1 / 0              静音
 */
export function applyUrlOverrides(settings: GameSettings, query: URLSearchParams): GameSettings {
  const out = { ...settings };
  const quality = query.get('quality');
  if (quality === 'low') out.lowQuality = true;
  else if (quality === 'high') out.lowQuality = false;
  const res = query.get('res');
  if (isResolutionId(res)) out.resolution = res;
  const mute = query.get('mute');
  if (mute === '1') out.muted = true;
  else if (mute === '0') out.muted = false;
  return out;
}

/** 浏览器的本地存储；拿不到（无痕模式、被禁用、非浏览器环境）时返回 null */
export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 设置的持有者：区分“保存的设置”和“本次生效的设置”。
 * 玩家改某一项时两边都改这一项，再把保存的那份写回存储——地址参数临时覆盖的项不会被顺带写进去。
 */
export class SettingsStore {
  private saved: GameSettings;
  private current: GameSettings;
  private readonly listeners = new Set<(s: Readonly<GameSettings>, key: keyof GameSettings) => void>();

  constructor(
    private readonly storage: StorageLike | null,
    query: URLSearchParams = new URLSearchParams(),
    private readonly key = SETTINGS_CONFIG.storageKey,
  ) {
    this.saved = loadSettings(storage, key);
    this.current = applyUrlOverrides(this.saved, query);
  }

  /** 本次生效的设置 */
  get value(): Readonly<GameSettings> {
    return this.current;
  }

  /** 保存在存储里的设置（不含地址参数的覆盖） */
  get persisted(): Readonly<GameSettings> {
    return this.saved;
  }

  set<K extends keyof GameSettings>(key: K, value: GameSettings[K]): void {
    const next = sanitizeSettings({ ...this.current, [key]: value }, this.current);
    if (next[key] === this.current[key] && this.saved[key] === next[key]) return;
    this.current = next;
    this.saved = { ...this.saved, [key]: next[key] };
    saveSettings(this.storage, this.saved, this.key);
    for (const fn of this.listeners) fn(this.current, key);
  }

  /** 订阅变化；返回取消订阅的函数 */
  onChange(fn: (s: Readonly<GameSettings>, key: keyof GameSettings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

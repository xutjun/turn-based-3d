// 把保存的设置接到场景上：场景初始参数，以及演示页右上角画质 / 音量按钮的“改了就保存”适配器。
// 玩家战斗页由设置菜单管理这些项（见 PlayerBattleApp），演示页（?auto=1、?demo=…）沿用右上角的按钮。

import type { BattleScene, SceneOptions } from '../../render/BattleScene';
import type { HudDeps } from '../hud/BattleHud';
import { browserStorage, SettingsStore, type GameSettings } from './settingsStore';

export function sceneOptionsOf(s: Readonly<GameSettings>): SceneOptions {
  return {
    lowQuality: s.lowQuality,
    audio: { volume: s.master, sfx: s.sfx, ambient: s.ambient, muted: s.muted },
  };
}

/** 演示页用：读取设置（含地址参数覆盖） */
export function loadPageSettings(): SettingsStore {
  return new SettingsStore(browserStorage(), new URLSearchParams(location.search));
}

/** 演示页用：右上角画质按钮和音量滑块，改动后写进设置存储 */
export function hudSettingsAdapters(scene: BattleScene, store: SettingsStore): Pick<HudDeps, 'quality' | 'sound'> {
  const { sound } = scene;
  return {
    quality: {
      isLow: () => scene.quality.isLow(),
      setLow: (on) => {
        scene.quality.setLow(on);
        store.set('lowQuality', on);
      },
    },
    sound: {
      get volume() {
        return sound.volume;
      },
      get muted() {
        return sound.muted;
      },
      supported: sound.supported,
      setVolume: (v) => {
        sound.setVolume(v);
        store.set('master', v);
      },
      setMuted: (m) => {
        sound.setMuted(m);
        store.set('muted', m);
      },
      play: (name) => sound.play(name),
    },
  };
}

// 演出样例页（地址带 ?demo=1）：不经过战斗引擎，直接把一段手工编排的事件喂给 BattleDirector，
// 用真实的场景、模型和界面检查多段 / 多目标 / 封印 / 治疗 / 复活这些演出路径。
// 这些路径在正常的战斗里也会出现，本页用来集中做演出回归检查。
//
// 地址参数：speed=2 初始两倍速；skip=1 一开始就跳过动画。

import { EventBus, type BattleEvent } from '../../core/events';
import { ENEMY_TEMPLATES } from '../../data/enemies';
import { ALLY_TEMPLATES } from '../../data/heroes';
import { STAGING } from '../../data/presentationConfig';
import { BattleScene } from '../../render/BattleScene';
import { BattleDirector } from '../../render/director/BattleDirector';
import { BattleHud } from '../hud/BattleHud';
import { buildShowcaseScript, SHOWCASE_SKILL_NAMES, snapshotOf, type ShowcaseEvent } from './showcaseScript';

/** 样例的自检结果（window.__showcase） */
export interface ShowcaseCheck {
  finished: boolean;
  actions: number;
  concurrentActions: number; // 同时行动的次数（应为 0）
  displaced: string[]; // 出手结束后仍不在站位上的单位（应为空）
  hpMismatches: string[]; // 头顶条数值与脚本不一致的记录（应为空）
}

declare global {
  interface Window {
    __showcase?: ShowcaseCheck;
  }
}

export class ShowcaseApp {
  private readonly scene: BattleScene;
  private readonly hud: BattleHud;
  private readonly director: BattleDirector;
  private readonly bus = new EventBus();
  private readonly check: ShowcaseCheck = { finished: false, actions: 0, concurrentActions: 0, displaced: [], hpMismatches: [] };
  private stopped = false;

  constructor(container: HTMLElement) {
    const query = new URLSearchParams(location.search);
    this.scene = new BattleScene(container);
    const { scheduler, stage } = this.scene;
    const speed = Number(query.get('speed'));
    if (STAGING.speeds.includes(speed)) scheduler.setTimeScale(speed);
    if (query.get('skip') === '1') scheduler.setSkip(true);

    this.hud = new BattleHud({
      container,
      scheduler,
      project: (world) => this.scene.worldToScreen(world),
      headPosition: (id, out) => stage.unit(id).headPosition(out),
      quality: this.scene.quality,
      sound: this.scene.sound,
    });
    this.scene.onFrame(() => this.hud.update());

    const basicSkills = new Set(['basic_physical', 'basic_magic']);
    this.director = new BattleDirector(this.bus, stage, this.hud, scheduler, {
      skillName: (id) => SHOWCASE_SKILL_NAMES[id] ?? id,
      isBasicSkill: (id) => basicSkills.has(id),
    });
    window.__showcase = this.check;
  }

  start(): void {
    this.scene.start();
    this.run().catch((err: unknown) => {
      console.error('演出样例中断：', err);
    });
  }

  dispose(): void {
    this.stopped = true;
    this.director.dispose();
    this.hud.dispose();
    this.scene.dispose();
  }

  private async run(): Promise<void> {
    const { scheduler, stage } = this.scene;
    const units = [...ALLY_TEMPLATES, ...ENEMY_TEMPLATES].map(snapshotOf);
    const script = buildShowcaseScript(units);
    let seq = 0;
    const emit = (e: ShowcaseEvent): void => this.bus.emit({ ...e, seq: (seq += 1) } as BattleEvent);

    emit({ type: 'BattleStart', units, turn: 0 });
    await this.director.idle();

    // 和引擎一样：一次出手的事件（UnitActStart … UnitActEnd）同步发完，演完再发下一批
    let inAction = false;
    const expectedHp = new Map(units.map((u) => [u.id, u.hp]));
    for (const e of script) {
      if (this.stopped) return;
      emit(e);
      if (e.type === 'HitResolved' || e.type === 'HealResolved') expectedHp.set(e.targetId, e.hpAfter);
      else if (e.type === 'UnitRevived') expectedHp.set(e.unitId, e.hpAfter);
      if (e.type === 'UnitActStart') inAction = true;
      else if (e.type === 'UnitActEnd') inAction = false;
      if (inAction) continue;
      await this.director.idle();
      this.check.actions = this.director.stats.actions;
      this.check.concurrentActions = this.director.stats.concurrentActions;
      const away = stage.unitsAway();
      if (away.length > 0) this.check.displaced.push(`#${seq} ${away.join(',')}`);
      for (const [id, hp] of expectedHp) {
        const shown = this.hud.targetHp(id);
        if (shown !== hp) this.check.hpMismatches.push(`#${seq} ${id} 界面 ${shown} / 脚本 ${hp}`);
      }
      await scheduler.nextFrame();
    }
    this.hud.banner('演出样例结束', true);
    this.check.finished = true;
  }
}

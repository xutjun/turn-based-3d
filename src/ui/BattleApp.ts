// 自动战斗演示页（地址带 ?auto=1）：把逻辑引擎、三维场景、演出导演、界面层和自动战斗控制器装配在一起。
// 玩家亲自下指令的战斗见 PlayerBattleApp。
//
// 地址参数：
//   seed=数字   随机种子（相同种子战斗过程完全相同）；不填则用当前时间
//   speed=2     初始战斗速度
//   skip=1      一开始就跳过动画

import { BattleEngine } from '../core/battle';
import { createDefaultSetup } from '../data/defaultSetup';
import { STAGING } from '../data/presentationConfig';
import { SKILLS } from '../data/skills';
import { BattleScene } from '../render/BattleScene';
import { BattleDirector } from '../render/director/BattleDirector';
import { AutoBattleController, type BattleCheck } from './AutoBattleController';
import { BattleHud } from './hud/BattleHud';

declare global {
  interface Window {
    /** 自检数据：演出与逻辑是否一致（验收和调试用） */
    __battle?: BattleCheck & { seed: number };
  }
}

export class BattleApp {
  private readonly scene: BattleScene;
  private readonly hud: BattleHud;
  private readonly director: BattleDirector;
  private readonly controller: AutoBattleController;

  constructor(container: HTMLElement) {
    const query = new URLSearchParams(location.search);
    const seedParam = Number(query.get('seed'));
    const seed = query.has('seed') && Number.isFinite(seedParam) ? seedParam >>> 0 : Date.now() >>> 0;

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

    const engine = new BattleEngine(createDefaultSetup(seed));
    const basicSkills = new Set(['basic_physical', 'basic_magic']);
    this.director = new BattleDirector(engine.events, stage, this.hud, scheduler, {
      skillName: (id) => SKILLS[id]?.name ?? id,
      isBasicSkill: (id) => basicSkills.has(id),
    });
    this.controller = new AutoBattleController({
      engine,
      director: this.director,
      scheduler,
      shownHp: (id) => this.hud.targetHp(id),
      shownMp: (id) => this.hud.targetMp(id),
      unitsAway: () => stage.unitsAway(),
    });
    window.__battle = Object.assign(this.controller.check, { seed });
  }

  start(): void {
    this.scene.start();
    this.controller.run().catch((err: unknown) => {
      console.error('自动战斗中断：', err);
    });
  }

  dispose(): void {
    this.controller.stop();
    this.director.dispose();
    this.hud.dispose();
    this.scene.dispose();
  }
}

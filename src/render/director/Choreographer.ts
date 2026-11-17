// 技能演出编排：把“一次出手”的结算结果排成带镜头、特效、顿帧的演出。
//
// 由 BattleDirector 调用；一次只编排一个单位的出手，期间其他单位不行动。
// 只有近战冲锋会让出手者离开站位，弓箭、法术、封印、治疗、复活全部在原地完成。
// 数字、命中数量、死亡全部来自逻辑层的事件：这里只决定“怎么演”，不决定“结果是什么”；
// 逻辑层没有发出结算事件的段数 / 目标（例如连斩中途目标死亡），这里也不会演。
//
//
// 步骤 11：每次进攻都按“预备（蓄力）→ 发力 → 命中顿住 → 余势 → 停一拍 → 收招 → 回位”的节奏编排；
// 每个阶段多长、摆什么姿态由出手者的动作档案决定（data/attackAnimConfig.ts），这里只负责按顺序调用。
//
// 本文件只依赖 ./types 里的接口，不依赖 three 和 DOM。

import type {
  BattleEvent,
  HealResolvedEvent,
  HitResolvedEvent,
  PassiveTriggeredEvent,
  SkillCastEvent,
  StatusAppliedEvent,
  StatusRemovedEvent,
  StatusResistedEvent,
  UnitDiedEvent,
  UnitRevivedEvent,
} from '../../core/events';
import type { UnitId } from '../../core/types';
import { ATTACK_ANIM, BOW, CAST, MELEE, MOTION_PROFILES, moveOf, type MoveDef, type MoveTiming } from '../../data/attackAnimConfig';
import { CAMERA_FX, ELEMENT_COLORS, FX_COLORS, FX_CONFIG, GLOW_FX, SMALL_SPELL, STAGING, TIMING } from '../../data/presentationConfig';
import type { Scheduler } from './Scheduler';
import type { DirectorHud, GroundPoint, Point3, Stage, StageUnit } from './types';

/** 一步结算：同一步里的内容同帧表现 */
export interface Step {
  hits: HitResolvedEvent[];
  heals: HealResolvedEvent[];
  effects: (StatusAppliedEvent | StatusResistedEvent | UnitRevivedEvent)[];
  followups: (UnitDiedEvent | StatusRemovedEvent)[];
  /** 这一步是被动技能追加出来的（连击的第二击）：演出前先飘出被动技能的名字 */
  passive: PassiveTriggeredEvent | null;
}

/** 这一击的分量：heavy = 连斩第 3 击、旋风斩最后一击、魔偶的砸拳、爆炸这类重击 */
type Weight = 'normal' | 'heavy';

/** 按节奏倍率缩放一个动作各阶段的时长（倍率越小越快） */
function scaleTiming(t: MoveTiming, k: number): MoveTiming {
  if (k === 1) return t;
  return {
    anticipation: t.anticipation * k,
    strike: t.strike * k,
    hold: t.hold, // 顿住的帧数不随节奏变
    follow: t.follow * k,
    beat: t.beat,
    recover: t.recover,
  };
}

export class Choreographer {
  constructor(
    private readonly stage: Stage,
    private readonly hud: DirectorHud,
    private readonly scheduler: Scheduler,
    /** 有单位在演出中倒地时通知导演（解除它的防御姿态记录） */
    private readonly onDeath: (id: UnitId) => void,
  ) {}

  /** 还没播完的倒地 / 消失动画：不阻塞后续的连击和突进，出手结束前统一等它们播完 */
  private readonly falling: Promise<void>[] = [];
  /** 还没播完的受击表现（旋风斩不停下来等每个目标的后仰播完），出手结束前统一等 */
  private readonly impacts: Promise<void>[] = [];

  /** 演出一次技能出手；结束时镜头、武器光芒、拖尾全部复原 */
  async play(actor: StageUnit, cast: SkillCastEvent, steps: Step[]): Promise<void> {
    const { stage, scheduler } = this;
    const focus = this.focusPoint(actor, cast);
    // 出手时镜头轻微推近（不等它完成，和起手动作同时进行）
    void stage.camera.focus(focus, CAMERA_FX.focusZoom, CAMERA_FX.focusPan, TIMING.cameraIn);
    try {
      if (cast.delivery === 'melee' && cast.meleeCharge) await this.playMelee(actor, cast, steps);
      else if (cast.delivery === 'ranged') {
        if (cast.animation === 'arrowRain') await this.playArrowRain(actor, cast, steps);
        else await this.playRanged(actor, cast, steps);
      } else await this.playCast(actor, cast, steps);
      if (steps.length === 0) await scheduler.wait(TIMING.notice);
      await Promise.all([...this.impacts, ...this.falling]);
    } finally {
      this.falling.length = 0;
      this.impacts.length = 0;
      actor.setTrail(false);
      actor.setWeaponGlow(1, 0.25);
      actor.setWeaponColor(null);
    }
    await stage.camera.reset(TIMING.cameraOut);
  }

  // ------------------------------------------------------------------
  // 近战：普攻 / 连斩 / 旋风斩
  // ------------------------------------------------------------------

  /**
   * 近战：（原地蓄势 →）冲到目标面前 → 预备 → 发力 → 命中顿住 → 余势 → （下一段 / 下一个目标 …）→ 停一拍 → 收招 → 回到原位。
   * - 普攻：各武器自己的招式（刀斜劈收刀、剑横斩、枪蓄力突刺），发力时拖出武器光轨。
   * - 连斩：对同一目标 3 击，方向和身体姿态各不相同，前一击的余势直接接下一击的预备；武器越来越亮，第 3 击是跃起重劈。
   * - 旋风斩：沿弧线跃向每个目标，途中旋身、落地横扫，镜头跟随；节奏先快后慢，最后一击大幅度旋转砸地，带冲击波和慢镜头。
   * - 连击（被动）：第一击后不返回，换一个动作再打一次。
   * 逻辑层没有发出结算事件的段数 / 目标不会演，所以目标死亡或不足时不会出现空挥。
   */
  private async playMelee(actor: StageUnit, cast: SkillCastEvent, steps: Step[]): Promise<void> {
    const { scheduler, stage } = this;
    const profile = MOTION_PROFILES[actor.motion];
    const combo = cast.animation === 'comboSlash';
    const whirl = cast.animation === 'whirlwind';
    const W = ATTACK_ANIM.whirlwind;
    let away = false;
    let lastTarget: UnitId | null = null;
    let lastImpact: Promise<void> = Promise.resolve();
    let lastMove: MoveDef | null = null;
    let leaps = 0;
    if (whirl) actor.setWeaponGlow(GLOW_FX.whirlwind, 0.2);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const targetId = stepTargets(step)[0];
      if (targetId === undefined) {
        await this.applyStep(cast, step, 'normal');
        continue;
      }
      const target = stage.unit(targetId);
      const lastStep = i === steps.length - 1;
      const hit = step.hits[0];

      // 这一击用哪个动作、多快、多重
      let variant: number = MELEE.basic;
      let tempo = 1;
      let finisher = false;
      const chained = this.announcePassive(step);
      if (chained) {
        // 连击的第二击：不返回、不重新冲锋，换一个动作紧接着再打一次，出手更快、光芒更亮
        variant = MELEE.second;
        tempo = ATTACK_ANIM.chainTempo;
      } else if (combo && hit) {
        variant = hit.hitIndex % 3;
        finisher = hit.hitCount > 1 && hit.hitIndex === hit.hitCount - 1;
      } else if (whirl) {
        finisher = lastStep && steps.length > 1;
        variant = finisher ? MELEE.spinFinish : MELEE.spin;
        tempo = finisher ? 1 : (W.tempo[Math.min(i, W.tempo.length - 1)] ?? 1);
      }
      const move = moveOf(actor.motion, 'melee', variant);
      const t = scaleTiming(move.timing, tempo);
      const weight: Weight = finisher || move.fx?.heavy ? 'heavy' : 'normal';
      // 旋风斩途中：预备动作在跃进的空中就摆好，落地即出手
      const airborneWindup = whirl && away && !finisher && targetId !== lastTarget;

      // 同一个目标上一击的受击表现先播完（连斩、连击）；换目标时不用等
      if (targetId === lastTarget) await lastImpact;

      if (targetId !== lastTarget) {
        const point = approachPoint(actor, target);
        if (!away) {
          // 出发前的蓄势（狼压低身体、魔偶举臂）
          if (profile.brace) await actor.brace(profile.brace.duration);
          if (whirl) {
            actor.setTrail(true);
            void stage.camera.focus(point, CAMERA_FX.followZoom, CAMERA_FX.followPan, profile.approach.duration);
          }
          await actor.moveTo(point, profile.approach.duration, target.home);
        } else if (whirl) {
          // 蹬地跃向下一个目标：沿弧线切入，途中旋身，拖着光轨，镜头快速平移跟上
          const leap = W.leap.duration * tempo;
          actor.setTrail(true);
          void stage.camera.focus(point, CAMERA_FX.followZoom, CAMERA_FX.followPan, Math.max(leap, TIMING.cameraFollow));
          if (airborneWindup) void actor.windup('melee', leap * 0.7, variant);
          await actor.moveTo(point, leap, target.home, { gait: W.leap.gait, side: leaps % 2 === 0 ? 1 : -1 });
          leaps += 1;
          await scheduler.wait(W.landPause * tempo);
        } else {
          await actor.moveTo(point, profile.next.duration, target.home, { gait: profile.next.gait });
        }
        away = true;
        lastTarget = targetId;
      }

      if (chained) actor.setWeaponGlow(GLOW_FX.chain, t.anticipation);
      else if (combo && hit) {
        // 武器发光逐击递增
        actor.setWeaponGlow(GLOW_FX.combo[Math.min(hit.hitIndex, GLOW_FX.combo.length - 1)]!, t.anticipation);
      }

      // 预备（蓄力）
      if (!airborneWindup) await actor.windup('melee', t.anticipation, variant);
      if (whirl && finisher) {
        // 最后一击：蓄势停一下，短暂慢镜头
        await scheduler.wait(W.finisherPause);
        scheduler.warp(CAMERA_FX.slowMo.factor, CAMERA_FX.slowMo.duration);
      }

      // 发力：武器拖出光轨，斩击光弧在挥下的同时划过目标
      if (move.fx?.trail !== false) actor.setTrail(true);
      const landed = hit !== undefined && !hit.isMiss;
      const slash = move.fx?.slash ?? variant % 3;
      if (slash >= 0) {
        const scale = (weight === 'heavy' ? 1.35 : 1) * (move.fx?.slashScale ?? 1) * (landed ? 1 : 0.7);
        const when = Math.max(0, t.strike - TIMING.slash * 0.45); // 光弧在发力的后半段出现，命中时最亮
        void scheduler.wait(when).then(() => stage.slash(target.anchor('chest'), slash, actor.fxColor, TIMING.slash, scale));
      }
      await actor.release('melee', t.strike, variant);

      // 命中：出手者顿住 2~4 帧，受击、飘字、顿帧同时发生
      if (move.fx?.shockwave) {
        const feet = target.anchor('ground');
        void stage.burst('shockwave', feet, actor.fxColor, whirl ? W.shockwaveTime : ATTACK_ANIM.shockwaveTime, move.fx.shockwave);
      }
      if (move.fx?.shake) stage.camera.shake(move.fx.shake);
      lastImpact = this.applyStep(cast, step, weight);
      this.impacts.push(lastImpact);
      await actor.hold(t.hold);

      // 余势：顺着力道过冲、回弹
      await actor.follow(t.follow);
      if (!whirl) actor.setTrail(false);
      lastMove = move;
    }

    // 收尾：停一拍，再平滑收招，然后回到原位
    actor.setTrail(false);
    actor.setWeaponGlow(1, 0.3);
    if (lastMove) {
      await scheduler.wait(lastMove.timing.beat);
      await Promise.all([lastImpact, actor.recover(lastMove.timing.recover)]);
    }
    if (away) {
      if (whirl) void stage.camera.focus(actor.home, CAMERA_FX.focusZoom, CAMERA_FX.focusPan, profile.retreat.duration);
      await actor.returnHome(profile.retreat.duration);
    }
  }

  // ------------------------------------------------------------------
  // 远程：普通射击 / 三连射 / 箭雨
  // ------------------------------------------------------------------

  /**
   * 远程：原地调整站姿、拉弓（上身后仰）→ 拉满停一下 → 松弦，弓身回弹、身体后坐 → 箭矢飞行 → 受击。
   * 不离开站位。三连射的后两箭只做很短的再拉弓。
   */
  private async playRanged(actor: StageUnit, cast: SkillCastEvent, steps: Step[]): Promise<void> {
    const { scheduler, stage } = this;
    let settle: Promise<void> = Promise.resolve();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const targets = stepTargets(step);
      const last = i === steps.length - 1;
      this.announcePassive(step);
      const variant = i === 0 ? BOW.shot : BOW.quick;
      const t = moveOf(actor.motion, 'bow', variant).timing;
      await settle;
      await actor.windup('bow', t.anticipation, variant);
      if (i === 0) await scheduler.wait(ATTACK_ANIM.bowFullDrawPause);
      await actor.release('bow', t.strike, variant);
      const from = actor.anchor('weapon');
      const flights = targets.map((id) =>
        stage.projectile('arrow', from, stage.unit(id).anchor('chest'), FX_COLORS.arrow, TIMING.arrowFlight),
      );
      // 箭在飞的同时：弓身回弹、身体后坐；最后一箭之后停一拍再收弓
      settle = (async () => {
        await actor.hold(t.hold);
        await actor.follow(t.follow);
        if (!last) return;
        await scheduler.wait(t.beat);
        await actor.recover(t.recover);
      })();
      await Promise.all(flights);
      await this.applyStep(cast, step, 'normal');
    }
    await settle;
  }

  /**
   * 箭雨：调整站姿 → 举弓向天拉满（弓弦和箭矢光芒大盛），蓄满时身体深深后仰 → 一道光箭射向天空，弓身回弹
   * → 光箭依次从天而降，每支箭的落点炸开光圈和火花，各自结算、各自飘字。
   */
  private async playArrowRain(actor: StageUnit, cast: SkillCastEvent, steps: Step[]): Promise<void> {
    const { scheduler, stage } = this;
    const color = FX_COLORS.arrow;
    const t = moveOf(actor.motion, 'bowUp', 0).timing;
    actor.setWeaponGlow(GLOW_FX.bowFull, t.anticipation);
    await actor.windup('bowUp', t.anticipation);
    await scheduler.wait(ATTACK_ANIM.bowFullDrawPause);
    await actor.release('bowUp', t.strike);
    const from = actor.anchor('weapon');
    const sky: Point3 = { x: from.x + actor.facing.x * 1.5, y: FX_CONFIG.skyHeight, z: from.z + actor.facing.z * 1.5 };
    const recover = (async () => {
      await actor.hold(t.hold);
      await actor.follow(t.follow);
      await scheduler.wait(t.beat);
      await actor.recover(t.recover);
    })();
    actor.setWeaponGlow(1, 0.4);
    await stage.projectile('skyArrow', from, sky, color, TIMING.skyShot);

    // 镜头看向落点
    const center = centroid(steps.flatMap(stepTargets).map((id) => stage.unit(id).home));
    if (center) void stage.camera.focus(center, CAMERA_FX.groupZoom, CAMERA_FX.groupPan, TIMING.rainPause + TIMING.cameraIn);
    await scheduler.wait(TIMING.rainPause);

    // 每一步晚一小段时间落下：依次命中，但不必等前一支箭的受击动作播完
    await Promise.all(
      steps.map(async (step, i) => {
        await scheduler.wait(i * TIMING.rainInterval);
        const drops = stepTargets(step).map((id) => {
          const to = stage.unit(id).anchor('ground');
          // 略微倾斜着落下
          const top: Point3 = { x: to.x - actor.facing.x * 1.2, y: FX_CONFIG.skyHeight, z: to.z - actor.facing.z * 1.2 };
          return stage.projectile('rainArrow', top, to, color, TIMING.rainFall).then(() => {
            void stage.burst('landing', to, color, TIMING.landing);
          });
        });
        await Promise.all(drops);
        await this.applyStep(cast, step, 'normal');
      }),
    );
    await recover;
  }

  // ------------------------------------------------------------------
  // 施法：法术普攻 / 单体法术 / 群体法术 / 封印 / 群体治疗 / 复活
  // ------------------------------------------------------------------

  /** 施法：原地蓄力 → 出手 → 光效落在目标身上 → 结算。不离开站位。 */
  private async playCast(actor: StageUnit, cast: SkillCastEvent, steps: Step[]): Promise<void> {
    const { scheduler, stage } = this;
    const color = ELEMENT_COLORS[cast.element];
    const first = steps[0];
    const kind = first ? castKind(cast, first) : 'bolt';
    const feet = actor.anchor('ground');
    // 法术型宝宝的三目标法术：群体法术的缩小版
    const small = cast.animation === 'groupSpellSmall';
    const size = small ? SMALL_SPELL.scale : 1;
    // 法杖按施法元素变色
    actor.setWeaponColor(color);
    // 施法动作：群体法术 = 高举召唤，治疗 / 复活 = 祝祷，其余 = 指向目标
    const variant = kind === 'group' ? CAST.invoke : kind === 'heal' || kind === 'revive' ? CAST.bless : CAST.point;
    const timing = moveOf(actor.motion, 'cast', variant).timing;
    // 没有法杖的施法者（骨龙、幽灵）：蓄力时光点向“施法点”汇聚成一团
    const gather = (charge: number): void => {
      const g = MOTION_PROFILES[actor.motion].gather;
      if (g > 0) void stage.aura('gather', actor.anchor('muzzle'), color, charge + TIMING.castRelease + 0.1, g * (kind === 'group' ? 1 : 0.7));
    };

    // 蓄力
    if (kind === 'group') {
      // 群体法术：宝珠光芒暴涨，敌阵脚下展开巨大的符文阵
      const grounds = stepTargets(first!).map((id) => stage.unit(id).home);
      const center = centroid(grounds)!;
      const radius = (Math.max(1.6, ...grounds.map((g) => Math.hypot(g.x - center.x, g.z - center.z))) + 1.1) * size;
      const charge = TIMING.spellCharge * (small ? SMALL_SPELL.charge : 1);
      actor.setWeaponGlow(GLOW_FX.spellCharge * (small ? SMALL_SPELL.glow : 1), charge);
      void stage.aura('charge', feet, color, charge + TIMING.castRelease, 1.3 * size);
      void stage.aura('runeCircle', { x: center.x, y: 0, z: center.z }, color, charge + TIMING.strike + 0.35, radius);
      void stage.camera.focus(center, CAMERA_FX.groupZoom, CAMERA_FX.groupPan, charge);
      gather(charge);
      await actor.windup('cast', charge, variant);
    } else if (kind === 'fireball') {
      actor.setWeaponGlow(GLOW_FX.singleCharge, TIMING.singleCharge);
      void stage.aura('charge', feet, color, TIMING.singleCharge + TIMING.castRelease, 1.1);
      gather(TIMING.singleCharge);
      await actor.windup('cast', TIMING.singleCharge, variant);
    } else {
      actor.setWeaponGlow(GLOW_FX.cast, TIMING.castWindup);
      gather(TIMING.castWindup);
      await actor.windup('cast', TIMING.castWindup, variant);
    }
    await actor.release('cast', TIMING.castRelease, variant);
    // 出手之后：顿一下 → 余势 → 停一拍 → 收招（和法术光效同时进行）
    const recover = (async () => {
      await actor.hold(timing.hold);
      await actor.follow(timing.follow);
      await scheduler.wait(timing.beat);
      await actor.recover(timing.recover);
    })();
    actor.setWeaponGlow(1, 0.45);

    for (const step of steps) {
      const targets = stepTargets(step);
      const stepKind = castKind(cast, step);
      this.announcePassive(step);
      const lingering: Promise<void>[] = [];
      switch (stepKind) {
        case 'bolt':
          // 法术普攻：光弹从施法者飞向目标
          await Promise.all(
            targets.map((id) => stage.projectile('bolt', actor.anchor('muzzle'), stage.unit(id).anchor('chest'), color, TIMING.boltFlight)),
          );
          await this.applyStep(cast, step, 'normal');
          break;

        case 'fireball': {
          // 单体法术：火球飞向目标并爆炸
          const target = stage.unit(targets[0]!);
          const at = target.anchor('chest');
          await stage.projectile('fireball', actor.anchor('muzzle'), at, color, TIMING.fireball);
          lingering.push(stage.burst('explosion', at, color, TIMING.explosion));
          stage.camera.shake(CAMERA_FX.shake.spell);
          await this.applyStep(cast, step, 'heavy');
          break;
        }

        case 'group':
          // 群体法术：所有目标同一帧遭受落雷 / 火柱，同一帧结算、同时飘字
          for (const id of targets) {
            lingering.push(stage.burst(cast.element === 'thunder' ? 'thunder' : 'pillarDown', stage.unit(id).anchor('ground'), color, TIMING.strike, size));
          }
          await scheduler.wait(TIMING.strikeDelay);
          stage.camera.shake(CAMERA_FX.shake.spell * (small ? SMALL_SPELL.shake : 1));
          await this.applyStep(cast, step, 'normal');
          break;

        case 'seal': {
          // 封印：暗紫锁链从法杖射向目标；命中则缠绕收紧，被抵抗则崩碎
          const target = stage.unit(targets[0]!);
          const at = target.anchor('chest');
          lingering.push(stage.beam(actor.anchor('muzzle'), at, color, TIMING.chainTravel, TIMING.chainLinger));
          await scheduler.wait(TIMING.chainTravel);
          if (step.effects.some((x) => x.type === 'StatusApplied')) {
            lingering.push(stage.aura('bind', target.anchor('ground'), color, TIMING.bind, target.radius));
          } else {
            lingering.push(stage.burst('shatter', at, color, TIMING.hit));
          }
          await this.applyStep(cast, step, 'normal');
          break;
        }

        case 'heal':
          // 群体治疗：目标脚下同时升起光柱，光点上升，血条回升
          for (const id of targets) lingering.push(stage.burst('pillarUp', stage.unit(id).anchor('ground'), color, TIMING.healPillar));
          await scheduler.wait(TIMING.healDelay);
          await this.applyStep(cast, step, 'normal');
          break;

        case 'revive':
          // 复活：光芒从高处降到倒地的单位身上，单位缓缓站起
          for (const id of targets) lingering.push(stage.burst('reviveLight', stage.unit(id).anchor('ground'), FX_COLORS.revive, TIMING.reviveLight));
          await scheduler.wait(TIMING.reviveDelay);
          await this.applyStep(cast, step, 'normal');
          break;
      }
      await Promise.all(lingering);
    }
    await recover;
  }

  // ------------------------------------------------------------------
  // 结算表现
  // ------------------------------------------------------------------

  /**
   * 表现一步结算：这一步里的受击、飘字、血条、死亡、状态同时发生。
   * 受击带轻微镜头抖动；暴击和击杀有短暂顿帧；重击的抖动和顿帧更大。
   */
  private async applyStep(cast: SkillCastEvent, step: Step, weight: Weight): Promise<void> {
    const { hud, scheduler, stage } = this;
    const waits: Promise<void>[] = [];
    const impactColor = cast.delivery === 'cast' ? ELEMENT_COLORS[cast.element] : FX_COLORS.physicalImpact;
    let shake = 0;
    let stop = 0;

    for (const h of step.hits) {
      const target = stage.unit(h.targetId);
      if (h.isMiss) {
        hud.floater(h.targetId, '未命中', 'miss');
        waits.push(target.dodge(TIMING.dodge));
        continue;
      }
      const heavy = weight === 'heavy' || h.isCrit;
      hud.setHp(h.targetId, h.hpAfter);
      const text = `${h.isCrit ? '暴击 ' : ''}-${h.damage}`;
      hud.floater(h.targetId, text, h.isCrit ? 'crit' : h.damageType === 'magic' ? 'magicDamage' : 'damage');
      waits.push(stage.burst(heavy ? 'heavyImpact' : 'impact', target.anchor('chest'), impactColor, TIMING.hit));
      // 被这一击打死的单位直接倒地，不再播放后仰
      if (!h.killed) waits.push(target.hit(TIMING.hit, heavy));
      shake = Math.max(shake, weight === 'heavy' ? CAMERA_FX.shake.heavy : h.isCrit ? CAMERA_FX.shake.crit : CAMERA_FX.shake.hit);
      if (weight === 'heavy') stop = Math.max(stop, CAMERA_FX.hitStop.heavy);
      if (h.killed) stop = Math.max(stop, CAMERA_FX.hitStop.kill);
      if (h.isCrit) stop = Math.max(stop, CAMERA_FX.hitStop.crit);
    }
    if (shake > 0) stage.camera.shake(shake);
    // 顿帧：画面几乎停住一瞬间，再继续
    if (stop > 0) scheduler.warp(CAMERA_FX.hitStopFactor, stop);

    for (const h of step.heals) {
      hud.setHp(h.targetId, h.hpAfter);
      hud.floater(h.targetId, `${h.isCrit ? '暴击 ' : ''}+${h.amount}`, 'heal');
    }

    for (const x of step.effects) {
      if (x.type === 'StatusApplied') {
        hud.setStatus(x.unitId, x.status, x.remainingTurns);
        hud.floater(x.unitId, '封印', 'seal');
        if (x.status === 'seal') stage.unit(x.unitId).setSealed(true);
        waits.push(stage.unit(x.unitId).hit(TIMING.hit, false));
      } else if (x.type === 'StatusResisted') {
        hud.floater(x.unitId, '抵抗', 'resist');
      } else {
        hud.setDead(x.unitId, false, false);
        hud.setHp(x.unitId, x.hpAfter);
        hud.floater(x.unitId, '复活', 'revive');
        if (x.queuedAtEnd) hud.queueLate(x.unitId);
        waits.push(stage.unit(x.unitId).revive(TIMING.revive));
      }
    }

    for (const x of step.followups) {
      if (x.type === 'UnitDied') {
        hud.setHp(x.unitId, 0);
        hud.setDead(x.unitId, true, x.vanish);
        this.onDeath(x.unitId);
        // 倒地动画在后台播：旋风斩、箭雨不必停下来等它
        this.falling.push(stage.unit(x.unitId).die(x.vanish, TIMING.die, TIMING.vanish));
      } else {
        hud.setStatus(x.unitId, x.status, null);
        if (x.status === 'seal') stage.unit(x.unitId).setSealed(false);
      }
    }

    waits.push(scheduler.wait(TIMING.afterImpact));
    await Promise.all(waits);
  }

  /** 这一步如果是被动技能追加出来的（连击），在出手者头顶飘出被动技能的名字；返回是否是追加的一步 */
  private announcePassive(step: Step): boolean {
    if (!step.passive) return false;
    this.hud.floater(step.passive.unitId, step.passive.name, 'passive');
    return true;
  }

  /** 镜头推近时看向哪里：出手者和主目标之间、偏向出手者 */
  private focusPoint(actor: StageUnit, cast: SkillCastEvent): GroundPoint {
    const first = cast.targets[0];
    if (first === undefined) return actor.home;
    const target = this.stage.unit(first).home;
    return { x: actor.home.x * 0.65 + target.x * 0.35, z: actor.home.z * 0.65 + target.z * 0.35 };
  }
}

/** 施法类一步的演出种类：按这一步的结算内容判断，技能的动画类型只用来区分火球和普通光弹 */
type CastKind = 'bolt' | 'fireball' | 'group' | 'seal' | 'heal' | 'revive';
function castKind(cast: SkillCastEvent, step: Step): CastKind {
  if (step.effects.some((x) => x.type === 'UnitRevived')) return 'revive';
  if (step.heals.length > 0) return 'heal';
  if (step.effects.length > 0) return 'seal';
  if (stepTargets(step).length > 1 || cast.animation === 'groupSpell' || cast.animation === 'groupSpellSmall') return 'group';
  return cast.animation === 'singleSpell' ? 'fireball' : 'bolt';
}

/** 把一次出手里 SkillCast 之后的事件按“步”分组 */
export function groupSteps(events: readonly BattleEvent[]): Step[] {
  const steps: Step[] = [];
  let currentIndex = -1; // 当前这一步的 stepIndex；-1 表示下一条结算要另起一步
  let pendingPassive: PassiveTriggeredEvent | null = null; // 刚触发的被动，记在它追加出来的那一步上
  const open = (): Step => {
    const step: Step = { hits: [], heals: [], effects: [], followups: [], passive: pendingPassive };
    pendingPassive = null;
    steps.push(step);
    return step;
  };
  const last = (): Step | undefined => steps[steps.length - 1];
  for (const e of events) {
    switch (e.type) {
      case 'HitResolved':
      case 'HealResolved': {
        const prev = last();
        const step = prev && e.stepIndex === currentIndex ? prev : open();
        currentIndex = e.stepIndex;
        if (e.type === 'HitResolved') step.hits.push(e);
        else step.heals.push(e);
        break;
      }
      case 'StatusApplied':
      case 'StatusResisted':
      case 'UnitRevived':
        // 封印 / 复活的结果各自成一步
        open().effects.push(e);
        currentIndex = -1;
        break;
      case 'UnitDied':
      case 'StatusRemoved':
        (last() ?? open()).followups.push(e);
        break;
      case 'PassiveTriggered':
        // 追加的攻击另起一步
        pendingPassive = e;
        currentIndex = -1;
        break;
      default:
        break;
    }
  }
  return steps;
}

/** 一步里涉及的目标（去重，保持事件顺序） */
export function stepTargets(step: Step): UnitId[] {
  const ids: UnitId[] = [];
  const add = (id: UnitId): void => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const h of step.hits) add(h.targetId);
  for (const h of step.heals) add(h.targetId);
  for (const x of step.effects) add(x.unitId);
  return ids;
}

/** 几个地面点的中心；没有点时返回 null */
function centroid(points: readonly GroundPoint[]): GroundPoint | null {
  if (points.length === 0) return null;
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  return { x: x / points.length, z: z / points.length };
}

/** 近战停步位置：目标正前方，留出双方身体半径和一点空隙 */
export function approachPoint(actor: StageUnit, target: StageUnit): GroundPoint {
  const d = actor.radius + target.radius + STAGING.meleeGap;
  // 打对方时站在对方面前；打己方单位（正常不会出现）时站在其身侧
  const dir = actor.side === target.side ? { x: -target.facing.z, z: target.facing.x } : target.facing;
  return { x: target.home.x + dir.x * d, z: target.home.z + dir.z * d };
}

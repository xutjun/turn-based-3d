// 目标选择的鼠标输入与高亮：悬停高亮、点击确认、右键返回；
// 把指令会话的状态同步成地面光圈和头顶条标记（待下令单位、可选目标、会命中的全部目标）。

import { Vector3 } from 'three';
import type { BattleState, UnitId } from '../../core/types';
import { SELECTION_CONFIG } from '../../data/uiConfig';
import type { RingMark } from '../../render/scene/selectionRings';
import type { CommandSession } from '../command/CommandSession';
import type { HeadMark } from '../hud/BattleHud';
import { clientToLocal } from '../layout/viewportMath';
import { eventOnPanel, pickUnitAt, screenBoxOf, type ScreenBox } from './picking';

export interface TargetingDeps {
  container: HTMLElement;
  session: CommandSession;
  getState(): Readonly<BattleState>;
  project(world: Vector3): { x: number; y: number; visible: boolean };
  /** 单位站位（脚底）与头顶的世界坐标 */
  footPosition(id: UnitId, out: Vector3): Vector3;
  headPosition(id: UnitId, out: Vector3): Vector3;
  setRings(marks: ReadonlyMap<UnitId, RingMark>): void;
  setHeadMarks(marks: ReadonlyMap<UnitId, HeadMark>): void;
}

export class TargetingInput {
  private readonly tmp = new Vector3();
  /** 鼠标当前指着的单位（不论是否合法目标），用来决定光标样式 */
  private pointed: UnitId | null = null;

  constructor(private readonly deps: TargetingDeps) {
    const c = deps.container;
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('click', this.onClick);
    c.addEventListener('contextmenu', this.onContextMenu);
  }

  dispose(): void {
    const c = this.deps.container;
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('click', this.onClick);
    c.removeEventListener('contextmenu', this.onContextMenu);
    c.style.cursor = '';
    this.deps.setRings(new Map());
    this.deps.setHeadMarks(new Map());
  }

  /** 会话状态变化后调用：重新计算高亮 */
  sync(): void {
    const { session } = this.deps;
    const rings = new Map<UnitId, RingMark>();
    const heads = new Map<UnitId, HeadMark>();
    const colors = SELECTION_CONFIG.colors;
    const unit = session.unit;

    if (session.mode !== 'idle' && unit) {
      rings.set(unit.id, { state: 'commander', color: colors.commander });
      heads.set(unit.id, { kind: 'commander' });

      const skill = session.targetingSkill;
      if (skill) {
        const friendly = skill.targetSide === 'ally';
        const color = friendly ? colors.friendly : colors.hostile;
        const kind = friendly ? 'friendly' : 'hostile';
        for (const id of session.candidates) rings.set(id, { state: 'candidate', color });
        // 这次出手会命中的全部目标；鼠标指着的主目标更醒目
        for (const id of session.preview) {
          const primary = id === session.hoverId;
          rings.set(id, { state: primary ? 'primary' : 'target', color });
          heads.set(id, { kind, primary });
        }
      }
    }
    this.deps.setRings(rings);
    this.deps.setHeadMarks(heads);
    this.updateCursor();
  }

  // ------------------------------------------------------------------
  // 鼠标
  // ------------------------------------------------------------------

  /** 事件是否落在界面面板上（面板上的点击不算选目标） */
  private onPanel(e: Event): boolean {
    // 用派发路径判断：被点的按钮可能已经随面板重画而脱离文档
    return eventOnPanel(e.composedPath());
  }

  private locate(e: MouseEvent): UnitId | null {
    // 游戏区域可能被整体缩放（固定 16:10 画面）：鼠标坐标先换算回排版坐标，再和投影出来的单位范围比较
    const c = this.deps.container;
    const p = clientToLocal(e.clientX, e.clientY, c.getBoundingClientRect(), c.clientWidth, c.clientHeight);
    return pickUnitAt(p.x, p.y, this.boxes());
  }

  /** 场上能被指到的单位：存活单位 + 倒地的友方（敌方被击败后已消失） */
  private boxes(): ScreenBox[] {
    const { getState, project, footPosition, headPosition } = this.deps;
    const state = getState();
    const out: ScreenBox[] = [];
    for (const id of state.unitIds) {
      const u = state.units[id]!;
      if (!u.alive && u.side === 'enemy') continue;
      const foot = project(footPosition(id, this.tmp));
      if (!foot.visible) continue;
      const footXY = { x: foot.x, y: foot.y };
      const head = project(headPosition(id, this.tmp));
      out.push(screenBoxOf(id, footXY, { x: head.x, y: head.y }));
    }
    return out;
  }

  private readonly onMove = (e: PointerEvent): void => {
    const { session } = this.deps;
    if (session.mode !== 'target' || this.onPanel(e)) {
      this.point(null);
      return;
    }
    this.point(this.locate(e));
  };

  private readonly onLeave = (): void => this.point(null);

  private point(id: UnitId | null): void {
    this.pointed = id;
    this.deps.session.hover(id);
    this.updateCursor();
  }

  private readonly onClick = (e: MouseEvent): void => {
    const { session } = this.deps;
    if (session.mode !== 'target' || this.onPanel(e)) return;
    const id = this.locate(e);
    // 点在空地上不做任何事；点到单位则交给会话校验（不合法会提示原因）
    if (id !== null) session.confirmTarget(id);
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    const { session } = this.deps;
    // 只在选目标 / 技能列表里把右键当作“返回”；菜单里的右键不会意外退回上一个单位
    if (session.mode !== 'target' && session.mode !== 'skills') return;
    e.preventDefault();
    session.back();
  };

  private updateCursor(): void {
    const { session, container } = this.deps;
    if (session.mode !== 'target') {
      this.pointed = null;
      container.style.cursor = '';
    } else if (this.pointed === null) container.style.cursor = 'crosshair';
    else container.style.cursor = session.hoverId === this.pointed ? 'pointer' : 'not-allowed';
  }
}

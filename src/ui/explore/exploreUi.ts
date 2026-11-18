// 进入探索 / 标题时清空战斗界面（步骤 17 修正的 bug：退出战斗后头顶血条悬空残留）。
// 探索和对话中不能留下任何战斗界面元素：头顶条（血条、名字、封印图标）、飘字、横幅、出手顺序条、选中光圈，
// 以及战斗日志、结算面板。所有进入探索 / 标题的路径（开始游戏、退出游戏、战斗中“重新开始”、过场中退出）都调用这里。

/** 战斗界面的几个部分（只要用到的方法，便于测试） */
export interface BattleUiParts {
  hud: { reset(): void; setControlsVisible(on: boolean): void; setMarks(marks: ReadonlyMap<string, never>): void; visibleBattleElements(): number };
  rings: { clear(): void; readonly visibleCount: number };
  log?: { clear(): void };
  result?: { hide(): void; readonly visible: boolean };
}

/** 清空战斗界面：之后战斗界面层里没有任何可见元素 */
export function clearBattleUi(ui: BattleUiParts): void {
  ui.hud.setMarks(new Map<string, never>());
  ui.hud.reset();
  ui.hud.setControlsVisible(false);
  ui.rings.clear();
  ui.log?.clear();
  ui.result?.hide();
}

/** 战斗界面层里还看得见的元素个数（头顶条、飘字、顺序条、横幅、选中光圈、结算面板） */
export function battleUiResidue(ui: BattleUiParts): number {
  return ui.hud.visibleBattleElements() + ui.rings.visibleCount + (ui.result?.visible ? 1 : 0);
}

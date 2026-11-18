// 操作说明（步骤 21 验收修正 v0.7-hud3）：设置菜单里“操作说明”面板的内容。正常游玩时画面上不显示任何操作提示。
// 改快捷键时同步改这里（快捷键本身写在各输入模块里：ExploreInput、CommandPanel、BattleHud、PlayerBattleApp）。

export interface ControlEntry {
  /** 按键或鼠标操作 */
  keys: string;
  /** 做什么 */
  action: string;
}

export interface ControlSection {
  title: string;
  /** 小标题下的若干组（组名为空 = 不显示组名） */
  groups: readonly { name: string; entries: readonly ControlEntry[] }[];
}

export const CONTROL_HELP: readonly ControlSection[] = [
  {
    title: '探索',
    groups: [
      {
        name: '移动',
        entries: [
          { keys: '鼠标左键点地面', action: '队长跑过去，自动绕开障碍；跑动中再点可改道' },
          { keys: '左键点 Boss', action: '跑到 Boss 面前并开始对话（途中点地面取消）' },
          { keys: '方向键 / WASD', action: '直线移动（调试）' },
        ],
      },
      {
        name: '界面',
        entries: [
          { keys: '左下角按钮栏', action: '角色 / 道具 / 技能（敬请期待）/ 宝宝 / 队友 / 设置' },
          { keys: '再点按钮 / Esc / ×', action: '关闭面板（同一时间只开一个）' },
          { keys: '角色面板里按住左键拖动', action: '旋转人物模型' },
          { keys: 'Esc', action: '打开设置（有面板时先关闭面板）' },
          { keys: 'M', action: '静音 / 取消静音' },
        ],
      },
      {
        name: '对话',
        entries: [
          { keys: '左键 / 空格 / 回车', action: '先显示整句，再下一句' },
          { keys: '1 / 2', action: '选择选项（我准备好了 / 再等等）' },
          { keys: 'Esc', action: '再等等（结束对话）' },
          { keys: '右上角齿轮', action: '打开设置' },
        ],
      },
    ],
  },
  {
    title: '战斗',
    groups: [
      {
        name: '指令',
        entries: [
          { keys: 'A / W / D', action: '攻击 / 技能 / 防御' },
          { keys: '鼠标悬停 + 左键', action: '预览会命中的目标，点击确认' },
          { keys: '右键 / Esc', action: '技能列表、选目标时返回上一步' },
          { keys: '退格', action: '退回上一个单位' },
        ],
      },
      {
        name: '演出',
        entries: [
          { keys: '1 / 2', action: '1 倍速 / 2 倍速（过场中同样有效）' },
          { keys: 'S', action: '跳过动画 开 / 关' },
          { keys: '点击日志标题', action: '折叠 / 展开战斗日志' },
        ],
      },
      {
        name: '其他',
        entries: [
          { keys: '回车 / 空格', action: '结算画面：重新开始 / 再来一次' },
          { keys: 'Esc / 右上角齿轮', action: '打开设置（战斗暂停）' },
          { keys: 'M', action: '静音 / 取消静音' },
        ],
      },
    ],
  },
];

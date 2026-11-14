// 入口：地址带 ?preview=1 时进入模型预览页，带 ?demo=skills 时进入技能演示模式（可单独触发每个技能的演出），
// 带 ?demo=1 时进入演出样例页（一段固定的事件脚本），
// 带 ?auto=1 时进入双方 AI 的自动战斗演示，否则进入由玩家下指令的战斗。

import { PreviewPage } from './preview/PreviewPage';
import { BattleApp } from './ui/BattleApp';
import { PlayerBattleApp } from './ui/PlayerBattleApp';
import { ShowcaseApp } from './ui/showcase/ShowcaseApp';
import { SkillDemoApp } from './ui/showcase/SkillDemoApp';

const container = document.getElementById('app');
if (!container) throw new Error('找不到 #app 容器');

const query = new URLSearchParams(location.search);
const wants = (key: string): boolean => query.has(key) && query.get(key) !== '0';
const page = wants('preview')
  ? new PreviewPage(container)
  : query.get('demo') === 'skills'
    ? new SkillDemoApp(container)
    : wants('demo')
      ? new ShowcaseApp(container)
    : wants('auto')
      ? new BattleApp(container)
      : new PlayerBattleApp(container);
page.start();

// 开发时改动代码后，先释放旧页面再重新加载，避免残留多个渲染循环
if (import.meta.hot) {
  import.meta.hot.dispose(() => page.dispose());
}

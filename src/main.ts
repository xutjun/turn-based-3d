// 入口：地址带 ?preview=1 时进入模型预览页，带 ?demo=1 时进入演出样例页，
// 否则进入战斗（目前是双方 AI 的自动战斗演示）。
// 玩家指令界面在步骤 6 接入。

import { PreviewPage } from './preview/PreviewPage';
import { BattleApp } from './ui/BattleApp';
import { ShowcaseApp } from './ui/showcase/ShowcaseApp';

const container = document.getElementById('app');
if (!container) throw new Error('找不到 #app 容器');

const query = new URLSearchParams(location.search);
const wants = (key: string): boolean => query.has(key) && query.get(key) !== '0';
const page = wants('preview')
  ? new PreviewPage(container)
  : wants('demo')
    ? new ShowcaseApp(container)
    : new BattleApp(container);
page.start();

// 开发时改动代码后，先释放旧页面再重新加载，避免残留多个渲染循环
if (import.meta.hot) {
  import.meta.hot.dispose(() => page.dispose());
}

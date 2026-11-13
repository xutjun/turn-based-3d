// 入口：创建战斗场景并开始渲染。
// 步骤 3：只显示战场和占位体；战斗逻辑（步骤 5）、界面（步骤 6）、模型预览页（步骤 4）之后接入。

import { BattleScene } from './render/BattleScene';

const container = document.getElementById('app');
if (!container) throw new Error('找不到 #app 容器');

const battleScene = new BattleScene(container);
battleScene.start();

// 开发时改动代码后，先释放旧场景再重新加载，避免残留多个渲染循环
if (import.meta.hot) {
  import.meta.hot.dispose(() => battleScene.dispose());
}

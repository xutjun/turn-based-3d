// 统一的资源注册表：所有模型都通过“资源键 → 工厂函数”创建。
// 现在工厂是程序化 builder；以后要换成真实 glb 模型时，只需把同一个键注册成
// “克隆已加载的 glb 场景”的工厂，使用方代码不用改。

import type { Object3D } from 'three';

/** 每帧更新函数：time 为累计秒数，dt 为本帧间隔秒数 */
export type TickFn = (time: number, dt: number) => void;

/** 资源工厂：根据参数创建一个新的模型实例 */
export type AssetFactory<P = unknown> = (params: P) => Object3D;

export class AssetRegistry {
  private readonly factories = new Map<string, AssetFactory<never>>();

  /** 注册（或覆盖）一个资源 */
  register<P>(key: string, factory: AssetFactory<P>): void {
    this.factories.set(key, factory as AssetFactory<never>);
  }

  has(key: string): boolean {
    return this.factories.has(key);
  }

  keys(): string[] {
    return [...this.factories.keys()];
  }

  /** 创建一个资源实例；键不存在时报错 */
  create<P>(key: string, params: P): Object3D {
    const factory = this.factories.get(key) as AssetFactory<P> | undefined;
    if (!factory) throw new Error(`资源未注册：${key}`);
    return factory(params);
  }
}

/**
 * 给模型挂一个每帧更新函数（火焰闪烁、旗帜飘动等）。
 * 场景在加入模型后会收集这些函数并在渲染循环里调用。
 */
export function setTick(object: Object3D, tick: TickFn): void {
  object.userData['tick'] = tick;
}

/** 收集一棵模型树上所有的每帧更新函数 */
export function collectTicks(root: Object3D): TickFn[] {
  const ticks: TickFn[] = [];
  root.traverse((o) => {
    const t = o.userData['tick'] as TickFn | undefined;
    if (typeof t === 'function') ticks.push(t);
  });
  return ticks;
}

import { describe, expect, it } from 'vitest';
import { Color, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { installFakeCanvas } from './realStage';
import { GLOW_BASE_KEY, SWAY_UNIFORMS_KEY } from '../../src/assets/materials';
import { ALLY_TEMPLATES } from '../../src/data/heroes';
import { PREVIEW_CONFIG } from '../../src/data/uiConfig';
import { UNIT_MODELS } from '../../src/data/unitModels';
import { PanelPreview, type PreviewRenderer } from '../../src/render/preview/PanelPreview';
import { createFormationView, createStandaloneUnitModel } from '../../src/render/scene/formationView';

// 步骤 21：面板里的 3D 预览（DESIGN §12.4）。用真实模型（程序化建模），渲染器换成记录调用的假对象。

installFakeCanvas();

async function setup() {
  const { createDefaultRegistry } = await import('../../src/assets/registerDefaults');
  const registry = createDefaultRegistry();
  let builds = 0;
  const preview = new PanelPreview({
    build: (id) => {
      builds += 1;
      return createStandaloneUnitModel(registry, ALLY_TEMPLATES.find((t) => t.id === id)!);
    },
    idleStyle: (id) => UNIT_MODELS[ALLY_TEMPLATES.find((t) => t.id === id)!.templateId]?.idle,
  });
  const calls: string[] = [];
  const state = { scissor: false, autoClear: true, clear: new Color(0x123456), alpha: 1 };
  const renderer: PreviewRenderer = {
    get autoClear() {
      return state.autoClear;
    },
    set autoClear(v: boolean) {
      state.autoClear = v;
    },
    domElement: { width: 2880, height: 1800, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }) },
    setRenderTarget: () => void calls.push('target'),
    setScissorTest: (on) => {
      state.scissor = on;
      calls.push(`scissorTest:${on}`);
    },
    setScissor: (x, y, w, h) => void calls.push(`scissor:${x},${y},${w},${h}`),
    setViewport: (x, y, w, h) => void calls.push(`viewport:${x},${y},${w},${h}`),
    getClearColor: (c) => c.copy(state.clear),
    getClearAlpha: () => state.alpha,
    setClearColor: (c, a) => {
      state.clear = new Color(c as number);
      state.alpha = a ?? 1;
      calls.push('clearColor');
    },
    clear: () => void calls.push('clear'),
    render: () => void calls.push('render'),
  };
  const element = { getBoundingClientRect: () => ({ left: 30, top: 300, width: 260, height: 340 }) };
  return { registry, preview, renderer, calls, state, element, builds: () => builds };
}

/** 模型上所有带基础发光强度的材质 */
function glowMaterials(root: Object3D): MeshStandardMaterial[] {
  const out = new Set<MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]) {
      if (m.userData[GLOW_BASE_KEY] !== undefined) out.add(m as MeshStandardMaterial);
    }
  });
  return [...out];
}

function allMaterials(root: Object3D): Set<Material> {
  const out = new Set<Material>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Material[]) out.add(m);
  });
  return out;
}

describe('面板里的 3D 预览', () => {
  it('打开时画到视口的剪裁区域（含像素比换算），画完恢复主画面的设置', async () => {
    const s = await setup();
    const view = s.preview.open('A1', s.element);
    s.preview.update(1 / 60);
    s.preview.render(s.renderer);
    expect(s.preview.lastRendered).toBe(1);
    // 像素比 2：260 × 340 的窗口 → 520 × 680 像素，原点在左下：y = 1800 − 600 − 680
    expect(s.calls).toContain('scissor:60,520,520,680');
    expect(s.calls).toContain('viewport:60,520,520,680');
    expect(s.calls.filter((c) => c === 'render')).toHaveLength(1);
    expect(s.calls.at(-1)).toBe('clearColor'); // 最后恢复原来的清屏色
    expect(s.calls).toContain('viewport:0,0,2880,1800');
    expect(s.state.scissor).toBe(false);
    expect(s.state.autoClear).toBe(true);
    expect(s.state.clear.getHex()).toBe(0x123456);
    view.close();
  });

  it('面板关闭后不再产生任何渲染调用；再次打开不重建模型', async () => {
    const s = await setup();
    const view = s.preview.open('A2', s.element);
    s.preview.render(s.renderer);
    view.close();
    expect(s.preview.activeCount).toBe(0);
    s.calls.length = 0;
    for (let i = 0; i < 5; i++) {
      s.preview.update(1 / 60);
      s.preview.render(s.renderer);
    }
    expect(s.calls).toEqual([]);
    expect(s.preview.lastRendered).toBe(0);
    const model = s.preview.modelOf('A2');
    s.preview.open('A2', s.element).close();
    s.preview.open('A2', s.element);
    expect(s.builds()).toBe(1);
    expect(s.preview.cachedCount).toBe(1);
    expect(s.preview.modelOf('A2')).toBe(model);
  });

  it('只显示这个视口的模型；拖拽的朝向写到转台上', async () => {
    const s = await setup();
    s.preview.open('A0', s.element).close();
    const view = s.preview.open('A3', s.element);
    view.yaw = 2.5;
    s.preview.render(s.renderer);
    const a0 = s.preview.modelOf('A0')!.parent!;
    const a3 = s.preview.modelOf('A3')!.parent!;
    expect(a0.visible).toBe(false);
    expect(a3.visible).toBe(true);
    expect(a3.rotation.y).toBeCloseTo(2.5);
  });

  it('预览实例的发光乘 glowBoost；战场上的同一个单位材质不受影响（两者不共用材质）', async () => {
    const s = await setup();
    const field = createFormationView(s.registry, ALLY_TEMPLATES).units.get('A2')!;
    const fieldGlows = glowMaterials(field);
    const before = fieldGlows.map((m) => m.emissiveIntensity);
    s.preview.open('A2', s.element);
    const previewModel = s.preview.modelOf('A2')!;
    const glows = glowMaterials(previewModel);
    expect(glows.length).toBeGreaterThan(0);
    for (const m of glows) expect(m.emissiveIntensity).toBeCloseTo((m.userData[GLOW_BASE_KEY] as number) * PREVIEW_CONFIG.glowBoost, 6);
    for (let i = 0; i < 30; i++) s.preview.update(1 / 60);
    expect(fieldGlows.map((m) => m.emissiveIntensity)).toEqual(before);
    // 两者唯一共用的是阴影代理的材质（optimize.ts，只画进阴影图、不发光、不飘动）；发光和飘动材质都是各自的
    const shared = [...allMaterials(previewModel)].filter((m) => allMaterials(field).has(m));
    for (const m of shared) {
      expect(m.userData[GLOW_BASE_KEY]).toBeUndefined();
      expect(m.userData[SWAY_UNIFORMS_KEY]).toBeUndefined();
      expect(m.type).toBe('MeshBasicMaterial');
    }
  });

  it('待机动画在预览里推进（关节随时间变化）', async () => {
    const s = await setup();
    s.preview.open('A4', s.element);
    const model = s.preview.modelOf('A4')!;
    const sample = (): string => {
      const parts: number[] = [model.position.y];
      model.traverse((o) => {
        if (o.name.startsWith('joint')) parts.push(o.rotation.x, o.rotation.z);
      });
      return parts.map((v) => v.toFixed(5)).join(',');
    };
    s.preview.update(0.1);
    const a = sample();
    for (let i = 0; i < 60; i++) s.preview.update(1 / 60);
    expect(sample()).not.toBe(a);
  });
});

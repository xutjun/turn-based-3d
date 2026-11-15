// 后处理：Bloom（辉光）→ 调色（降饱和、冷色偏移、暗角、颗粒）→ 色调映射与输出。

import { ACESFilmicToneMapping, Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { POSTFX_CONFIG } from '../../data/renderConfig';

/** 调色着色器：降饱和 + 色偏 + 暗角 + 胶片颗粒 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0 },
    uDesaturate: { value: 0 },
    uTint: { value: [1, 1, 1] },
    uVignette: { value: [1, 1, 1] }, // offset, softness, darkness
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uDesaturate;
    uniform vec3 uTint;
    uniform vec3 uVignette;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // 降饱和与色偏
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(color.rgb, vec3(luma), uDesaturate) * uTint;
      // 暗角：离画面中心越远越暗（四角距离为 1）
      float dist = length(vUv - 0.5) * 1.41421356;
      float vig = smoothstep(uVignette.x, uVignette.x - uVignette.y, dist);
      color.rgb *= mix(1.0 - uVignette.z, 1.0, vig);
      // 颗粒：随时间变化的噪点，暗部更明显
      float n = rand(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5;
      color.rgb += n * uGrain * (0.35 + luma);
      gl_FragColor = color;
    }
  `,
};

export interface PostFx {
  render(time: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** 开关辉光（低画质模式关闭） */
  setBloom(on: boolean): void;
}

export function createPostFx(renderer: WebGLRenderer, scene: Scene, camera: Camera, config = POSTFX_CONFIG): PostFx {
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.exposure;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new Vector2(1, 1), config.bloom.strength, config.bloom.radius, config.bloom.threshold);
  composer.addPass(bloom);

  const grade = new ShaderPass(GradeShader);
  grade.uniforms['uGrain']!.value = config.grain;
  grade.uniforms['uDesaturate']!.value = config.desaturate;
  grade.uniforms['uTint']!.value = [config.tint.r, config.tint.g, config.tint.b];
  grade.uniforms['uVignette']!.value = [config.vignette.offset, config.vignette.softness, config.vignette.darkness];
  composer.addPass(grade);

  // 色调映射和色彩空间转换放在最后
  composer.addPass(new OutputPass());

  return {
    render(time: number): void {
      grade.uniforms['uTime']!.value = time;
      composer.render();
    },
    setSize(width: number, height: number, pixelRatio: number): void {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    setBloom(on: boolean): void {
      bloom.enabled = on;
    },
  };
}

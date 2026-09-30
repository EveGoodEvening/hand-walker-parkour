// src/render/boards.ts —— 黑板（DESIGN.md §5.9 chalkboard(text)、§8.7 board cue，WP3）。
// 一块黑板 = 1 个 Mesh：底图是擦过的黑板，字是另一张透明的粉笔字纹理，着色器按 uReveal（写）和 uWipe（擦）从左到右显隐。
// 写：一笔一笔出现；擦：「我用掌心一个字一个字擦掉」，擦过的地方留下一层粉笔雾。
// 字的纹理在读章时按关卡里全部 board cue 预先生成；游戏过程中只切换纹理、推进 uniform。
import * as THREE from 'three';
import type { LampFieldUniforms } from '../core/contracts';
import { clamp } from '../core/math';

export interface BoardUniforms { uText: { value: THREE.Texture | null }; uReveal: { value: number }; uWipe: { value: number } }

/** Lambert 黑板材质：LampField 补丁 + 字层混合。 */
export function boardMaterial(base: THREE.Texture, lamp: LampFieldUniforms & { uLampY0?: { value: number } }, bu: BoardUniforms): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ map: base, flatShading: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lamp, bu);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHwWorld;\nvarying vec2 vBoardUv;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vHwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vBoardUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vHwWorld; varying vec2 vBoardUv; uniform sampler2D uLampField, uText;
        uniform float uLampBase, uLampScale, uLampGain, uReveal, uWipe, uLampY0; uniform vec3 uLampColor;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 hwT = texture2D(uText, vBoardUv);
        float hwReveal = 1.0 - smoothstep(uReveal - 0.04, uReveal, vBoardUv.x);
        float hwWiped = 1.0 - smoothstep(uWipe - 0.03, uWipe, vBoardUv.x);
        float hwA = hwT.a * hwReveal * (1.0 - hwWiped);
        diffuseColor.rgb = mix(diffuseColor.rgb, hwT.rgb, hwA);
        diffuseColor.rgb += vec3(0.035) * hwWiped * step(0.001, uWipe) * (0.6 + 0.4 * hwT.a);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float hwL = texture2D(uLampField, vec2((-vHwWorld.z - uLampBase) * uLampScale, 0.5)).r * 2.0;
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uLampColor * hwL * uLampGain * 0.8;`);
  };
  m.customProgramCacheKey = () => 'hwBoard';
  return m;
}

/** 一块黑板的状态机。时间一律用模拟时钟秒。 */
export class Board {
  readonly uniforms: BoardUniforms = { uText: { value: null }, uReveal: { value: 0 }, uWipe: { value: 0 } };
  private mode: 'idle' | 'write' | 'wipe' = 'idle';
  private t0 = 0;
  private dur = 1;
  /** 擦的进度来源：返回 0..1 时优先用它（静场按住的进度），null 时按时间。 */
  wipeProgress: (() => number | null) | null = null;

  constructor(readonly mesh: THREE.Mesh, readonly blank: THREE.Texture) { this.uniforms.uText.value = blank; }

  /** 立即显示整段字（重来时恢复状态用）。 */
  show(tex: THREE.Texture): void { this.uniforms.uText.value = tex; this.uniforms.uReveal.value = 1.08; this.uniforms.uWipe.value = 0; this.mode = 'idle'; }
  clear(): void { this.uniforms.uText.value = this.blank; this.uniforms.uReveal.value = 0; this.uniforms.uWipe.value = 0; this.mode = 'idle'; }

  write(tex: THREE.Texture, now: number, chars: number): void {
    this.uniforms.uText.value = tex; this.uniforms.uReveal.value = 0; this.uniforms.uWipe.value = 0;
    this.mode = 'write'; this.t0 = now; this.dur = clamp(0.28 * Math.max(1, chars), 0.6, 4);
  }

  wipe(now: number, seconds = 1.2): void { this.mode = 'wipe'; this.t0 = now; this.dur = Math.max(0.2, seconds); }

  update(now: number): void {
    if (this.mode === 'write') {
      const k = clamp((now - this.t0) / this.dur, 0, 1);
      this.uniforms.uReveal.value = 0.04 + k * 1.04;
      if (k >= 1) this.mode = 'idle';
    } else if (this.mode === 'wipe') {
      const ext = this.wipeProgress?.() ?? null;
      const k = ext !== null ? clamp(ext, 0, 1) : clamp((now - this.t0) / this.dur, 0, 1);
      this.uniforms.uWipe.value = Math.max(this.uniforms.uWipe.value, k * 1.05);
      if (k >= 1 && ext === null) this.mode = 'idle';
    }
  }
}

/** 黑板注册表：surface id → Board（静场 set 与跑段 board 表面都注册在这里）。 */
export const BOARDS = new Map<string, Board>();

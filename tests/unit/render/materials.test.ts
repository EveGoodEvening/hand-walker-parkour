// tests/unit/render/materials.test.ts —— 材质补丁（§5.3）：对照 three 0.186 的着色器源码，锚点都能找到、替换恰好一次。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boardMaterial, Board } from '../../../src/render/boards';
import { Decals } from '../../../src/render/decals';
import { LampField } from '../../../src/render/lampField';
import { HwMaterials } from '../../../src/render/materials';

type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };
function compileWith(mat: THREE.Material, lib: 'lambert' | 'basic'): Shader {
  const src = THREE.ShaderLib[lib];
  const sh: Shader = { uniforms: THREE.UniformsUtils.clone(src.uniforms), vertexShader: src.vertexShader, fragmentShader: src.fragmentShader };
  mat.onBeforeCompile(sh as never, null as never);
  // 展开 #include，确认替换后的着色器里既有我们的代码，也保留了原来的 include
  return sh;
}

describe('材质（§5 总则、§5.3）', () => {
  const lamps = new LampField();
  const mats = new HwMaterials(lamps);

  it('lambert：LampField 补丁插在 lights_fragment_end 之后；实例化与蒙皮都取世界坐标；共享同一组 uniform', () => {
    const m = mats.lambert({ vertexColors: true });
    expect(m).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(m.flatShading).toBe(true);
    const sh = compileWith(m, 'lambert');
    expect(sh.vertexShader).toContain('vHwWorld = (modelMatrix * hwWp).xyz;');
    expect(sh.vertexShader).toContain('hwWp = instanceMatrix * hwWp;');
    expect(sh.vertexShader).toContain('attribute float aChalk;');
    expect(sh.fragmentShader).toContain('#include <lights_fragment_end>\n');
    expect(sh.fragmentShader).toMatch(/reflectedLight\.indirectDiffuse \+= diffuseColor\.rgb \* uLampColor \* hwL \* hwH \* uLampGain;/);
    expect(sh.fragmentShader).toContain('reflectedLight.indirectDiffuse += uChalkColor * vChalk * uChalk;');
    expect(sh.uniforms.uLampField).toBe(lamps.uniforms.uLampField);
    expect(m.customProgramCacheKey()).toBe('hwLampField');
    // 每个锚点只出现一次（替换恰好一次）
    for (const a of ['#include <common>', '#include <project_vertex>']) expect(THREE.ShaderLib.lambert.vertexShader.split(a).length).toBe(2);
    for (const a of ['#include <common>', '#include <lights_fragment_end>']) expect(THREE.ShaderLib.lambert.fragmentShader.split(a).length).toBe(2);
  });

  it('basic：透明 / 加法不写深度；lampLit 按 G 通道（灯自身亮度）明灭，aSteady = 1 的部分不跟灯走', () => {
    const t = mats.basic({ color: 0x1a2a33, transparent: true, opacity: 0.25 });
    expect(t.depthWrite).toBe(false); expect(t.opacity).toBe(0.25);
    const a = mats.basic({ additive: true });
    expect(a.blending).toBe(THREE.AdditiveBlending);
    const lit = mats.basic({ lampLit: true });
    const sh = compileWith(lit, 'basic');
    expect(sh.fragmentShader).toContain('.g;');
    expect(sh.fragmentShader).toContain('mix(0.07 + 0.93 * hwOwn, 1.0, vSteady)');
    expect(sh.vertexShader).toContain('vSteady = aSteady;');
    expect(THREE.ShaderLib.basic.fragmentShader.split('#include <color_fragment>').length).toBe(2);
    const plain = mats.basic({ color: 0xffffff });
    expect(plain.onBeforeCompile.toString()).not.toContain('uLampField');
  });

  it('ensureChalkAttr 给没有 aChalk 的几何体补全 0 属性，已有的不动', () => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    mats.ensureChalkAttr(g);
    const attr = g.getAttribute('aChalk') as THREE.BufferAttribute;
    expect(attr.count).toBe(g.getAttribute('position').count);
    expect(Array.from(attr.array as Float32Array).every((v) => v === 0)).toBe(true);
    mats.ensureChalkAttr(g);
    expect(g.getAttribute('aChalk')).toBe(attr);
  });

  it('黑板材质：字层按 uReveal / uWipe 显隐', () => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const board = new Board(new THREE.Mesh(new THREE.PlaneGeometry(1, 1)), tex);
    const m = boardMaterial(tex, lamps.uniforms, board.uniforms);
    const sh = compileWith(m, 'lambert');
    expect(sh.fragmentShader).toContain('hwReveal');
    expect(sh.uniforms.uReveal).toBe(board.uniforms.uReveal);
    board.write(tex, 0, 10);
    board.update(1.4);
    const mid = board.uniforms.uReveal.value;
    expect(mid).toBeGreaterThan(0.3); expect(mid).toBeLessThan(0.8);
    board.update(10);
    expect(board.uniforms.uReveal.value).toBeGreaterThan(1);
    board.wipe(10, 1.2);
    board.update(10.6);
    expect(board.uniforms.uWipe.value).toBeGreaterThan(0.4);
    let held = 0.3;
    board.wipeProgress = () => held;
    board.wipe(20, 1.2);
    board.update(20.1);
    held = 0.9; board.update(20.2);
    expect(board.uniforms.uWipe.value).toBeGreaterThan(0.9);
  });

  it('地面贴花：1 个 InstancedMesh（1 次 draw call），容量满了不再加', () => {
    const d = new Decals(lamps.uniforms, 8, 16);
    d.begin();
    for (let i = 0; i < 12; i++) d.add('streak', 0, 0, i, 0.3, 1, 0xffffff, 0.5, i);
    d.end();
    expect(d.count).toBe(8);
    expect(d.mesh.count).toBe(8);
    expect(d.material.depthWrite).toBe(false);
    expect(d.mesh.renderOrder).toBe(-15);
    d.begin(); d.end();
    expect(d.mesh.visible).toBe(false);
  });
});

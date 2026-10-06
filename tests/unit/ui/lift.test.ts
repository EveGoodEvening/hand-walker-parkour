// @vitest-environment happy-dom
// tests/unit/ui/lift.test.ts —— 修复轮 B3：4-4 掌心（palmEye）里节拍点不压在掌心那只眼睛上。
// 镜头在他眼睛里，举起的右手占满画面下半部；节拍点原来在栈底，正好落在掌心的眼睛下面（集成截图 hq-4-4-palm-2.4s：点在 (640, 669)，
// 眼睛约在 (605, 650)）。现在 palmEye 静场里 HUD 根挂 hw-lift，整个底部栈挪到指尖上方（节拍点中心 44% 高度，字幕在它上面）；别的段不挪。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { STILL_ORIGIN } from '../../../src/core/constants';
import { QUALITY } from '../../../src/core/quality';
import { BONE_INDEX } from '../../../src/core/rig';
import { crawlPose, PoseBuilder } from '../../../src/render/actors/handCycle';
import { buildRigGeometry, Rig, rigDetail } from '../../../src/render/actors/rigBuild';
import { vFromH } from '../../../src/render/camera/CameraRig';
import { FOLLOW } from '../../../src/render/camera/shots';
import { crawlInput } from '../actors/helpers';
import { getSet } from '../../../src/core/registry';
import { DEFAULT_SETTINGS } from '../../../src/core/settings';
import { WP5 } from '../../../src/render/actors/shared';
import { CameraRig } from '../../../src/render/camera/CameraRig';
import '../../../src/render/sets/outside/palmEye';
import { METRO_LIFT_SETS, METRO_LIFT_Y } from '../../../src/ui/hud/Hud';
import { viewContext } from '../outside/helpers';
import { mountUI, snap } from './helpers';

beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });

const still = (set: string, t = 2.4) => snap({ t: 100 + t, chapter: 'ch4', segment: '4-4', segKind: 'still',
  still: { set: set as never, variant: 'default', t, duration: 10, prompt: null, held: 0 } });

describe('4-4 palmEye: the bottom stack (subtitles, hint, beat dots) moves above the raised hand (B3)', () => {
  it('the HUD root gets hw-lift only in the palmEye still', async () => {
    const { ui } = await mountUI();
    ui.show('play');
    const hud = document.querySelector('.hw-hud') as HTMLElement;
    ui.frame(still('palmEye'), 0);
    expect(hud.classList.contains('hw-lift')).toBe(true);
    ui.frame(still('water'), 0);
    expect(hud.classList.contains('hw-lift')).toBe(false);
    ui.frame(still('palmEye'), 0);
    ui.frame(snap({ t: 120, chapter: 'ch4', segment: '4-5', segKind: 'run' }), 0);
    expect(hud.classList.contains('hw-lift')).toBe(false);
    expect([...METRO_LIFT_SETS]).toEqual(['palmEye']);
  });

  // 第三轮：以前只挪节拍器（点到了字幕上面，§7.2 的顺序反了；低语字幕还压在掌心的眼睛上方）。现在挪整个底部栈
  it('styles.css moves the whole bottom stack (subtitles → hint → dots, order unchanged) so the dots sit at METRO_LIFT_Y; the landscape hint stays put', async () => {
    const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');
    const m = /\.hw-hud\.hw-lift \.hw-bottom \{ transform: translateY\(calc\(var\(--gut\) \+ var\(--sab\) \+ 26px - (\d+(?:\.\d+)?)vh\)\); \}/.exec(css);
    expect(m, 'rule .hw-hud.hw-lift .hw-bottom').not.toBeNull();
    expect(Number(m![1]) / 100).toBeCloseTo(1 - METRO_LIFT_Y, 9);
    expect(/\.hw-hud\.hw-lift \.hw-(metro|subs|dots)\b/.test(css)).toBe(false);          // 栈里的东西不再各自挪
    // 横屏：提示不在栈里（右下的空地），抵消同一个平移
    const land = css.slice(css.indexOf('@media (min-aspect-ratio: 1/1) {'));
    const h = /\.hw-hud\.hw-lift \.hw-hint \{ transform: translateY\(calc\((\d+(?:\.\d+)?)vh - var\(--gut\) - var\(--sab\) - 26px\)\); \}/.exec(land.slice(0, land.indexOf('\n}')));
    expect(h, 'landscape rule .hw-hud.hw-lift .hw-hint').not.toBeNull();
    expect(Number(h![1])).toBe(Number(m![1]));
    // 栈底的节拍器：高 52 px，点的中心在 26 px（translateY 里的 26px 就是它），而且它是栈里最后一个
    expect(css).toContain('.hw-metro { position: relative; width: 168px; height: 52px;');
    expect(css).toContain('.hw-dots { position: absolute; left: 50%; top: 26px;');
    await mountUI();
    const bottom = document.querySelector('.hw-bottom') as HTMLElement;
    const order = [...bottom.children].map((e) => e.className.split(' ')[0]);
    expect(order).toEqual(['hw-noteopen', 'hw-subs', 'hw-hint', 'hw-balance', 'hw-metro']);
  });

  // 按 WP4 的 palmEye set 的手和 WP5 的 palmEye 机位投影：横屏、竖屏里指尖的最高点都在点的下面，留出 ≥ 5% 屏高（点半径 4.5 px 之外）
  for (const [W, H] of [[1280, 720], [640, 360], [1920, 1080], [360, 640], [390, 844], [768, 1024]] as const) {
    it(`${W}×${H}: the fingertips are below the lifted dots, the dots were on the palm before`, () => {
      const root = getSet('palmEye')!.build(viewContext('low'), 'default');
      const hand = root.getObjectByName('hand') as THREE.Mesh, palm = root.getObjectByName('palm') as THREE.Mesh;
      expect(hand).toBeTruthy(); expect(palm).toBeTruthy();
      // 游戏里的镜头：静场锚点 = STILL_ORIGIN × playerAnchor
      WP5.stillAnchor.makeTranslation(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z).multiply(getSet('palmEye')!.playerAnchor('default'));
      const rig = new CameraRig();
      const n = still('palmEye');
      const o = rig.compute(n, n, 1, 1 / 60, W / H, { ...DEFAULT_SETTINGS });
      const cam = new THREE.PerspectiveCamera(o.fov, W / H, 0.01, 100);
      cam.position.copy(o.pos); cam.lookAt(o.look); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
      const O = new THREE.Vector3(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z);
      const px = (p: THREE.Vector3) => { const q = p.clone().add(O).project(cam); return [(q.x + 1) / 2 * W, (1 - q.y) / 2 * H] as const; };
      let top = Infinity;
      const pos = hand.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) top = Math.min(top, px(new THREE.Vector3().fromBufferAttribute(pos, i))[1]);
      const dotY = METRO_LIFT_Y * H;
      expect(top - (dotY + 4.5), `fingertip top ${top.toFixed(0)} px`).toBeGreaterThan(0.05 * H);
      // 以前：栈底的点（gut = max(14 px, 3.5vh)，点的中心在栈底以上 26 px）落在掌心里
      const gut = Math.max(14, 0.035 * H), oldY = H - gut - 26;
      const pb = new THREE.Box3().setFromBufferAttribute(palm.geometry.getAttribute('position') as THREE.BufferAttribute);
      const [x0, y0] = px(new THREE.Vector3(pb.min.x, pb.max.y, pb.max.z)), [x1] = px(new THREE.Vector3(pb.max.x, pb.max.y, pb.max.z));
      expect(oldY).toBeGreaterThan(y0);
      expect(W / 2).toBeGreaterThan(x0); expect(W / 2).toBeLessThan(x1);
    });
  }
});

// 最终 QA：横屏追尾机位下，字幕压在主角的头和胸口上（640×360 时一行字幕约在 66–74% 高度，主角的头和胸在 54–74%）。
// 主角下面是拖在身后的腿，一直到画面下沿，没有空地；往上挪又会压到 5–10 m 外正要读的障碍（约 49–56% 高度）。
// 所以横屏字幕直接落到节拍器上面（去掉以前给提示留的 28 px）：头、胸口和头顶的餐盘露出来，字幕只压在骨盆以下的腿上。
describe('landscape chase camera: subtitles stay below the protagonist\'s head and chest', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/ui/styles.css'), 'utf8');
  const land = css.slice(css.indexOf('@media (min-aspect-ratio: 1/1) {'));
  const landBlock = land.slice(0, land.indexOf('\n}'));
  const subsMargin = Number(/\.hw-subs \{[^}]*margin-bottom: (\d+)px/.exec(landBlock)?.[1] ?? 0);
  const geo = buildRigGeometry(rigDetail(QUALITY.low));
  const rig = new Rig(geo, new THREE.MeshBasicMaterial(), 'player');
  const pos = geo.getAttribute('position') as THREE.BufferAttribute, skin = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
  const TOP = new Set((['chest', 'neck', 'head', 'propHead'] as const).map((n) => BONE_INDEX[n]));   // 头顶的餐盘（2-4）也算
  /** 头、胸口（含头顶的道具）在屏幕上的最低点（px，从上往下）。 */
  function chestBottom(W: number, H: number, lane: number): number {
    const L = FOLLOW.landscape, x = lane * 1.1;
    const cam = new THREE.PerspectiveCamera(Math.min(L.vMax, Math.max(L.vMin, vFromH(L.hfov, W / H))), W / H, 0.05, 200);
    cam.position.set(L.k * x, L.h, L.back); cam.lookAt(L.lookK * x, L.ly, L.lz); cam.updateMatrixWorld(true);
    const b = new PoseBuilder(), v = new THREE.Vector3();
    let low = -Infinity;
    for (const beat of [6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75]) {
      rig.apply(crawlPose(crawlInput({ s: 0, x, laneTarget: lane, beat }), b));
      rig.root.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i++) {
        if (!TOP.has(skin.getX(i))) continue;
        v.fromBufferAttribute(pos, i); rig.mesh.applyBoneTransform(i, v); v.applyMatrix4(rig.mesh.matrixWorld).project(cam);
        low = Math.max(low, (1 - v.y) / 2 * H);
      }
    }
    return low;
  }
  /** n 行字幕的上沿（px）：栈底 = gut，往上是节拍器（52 px）、字幕下边距、n 行（18 px × 1.5，行间 4 px）。 */
  const subsTop = (H: number, n: number) => H - Math.max(14, 0.035 * H) - 52 - subsMargin - n * 18 * 1.5 - (n - 1) * 4;
  it('the stack numbers this test assumes are the ones in styles.css', () => {
    expect(css).toContain('--gut: max(14px, 3.5vh);');
    expect(css).toContain('.hw-metro { position: relative; width: 168px; height: 52px;');
    expect(css).toMatch(/\.hw-subs \{[^}]*gap: 4px;/);
    expect(css).toMatch(/\.hw-line \{[^}]*font-size: 18px; line-height: 1\.5;/);
    expect(subsMargin).toBe(0);
  });
  for (const [W, H, lines] of [[640, 360, 1], [960, 540, 2], [1280, 720, 2], [1920, 1080, 2]] as const) {
    it(`${W}×${H}: ${lines === 1 ? 'one line' : 'one or two lines'} of subtitles start below the head and chest in every lane`, () => {
      for (const lane of [-1, 0, 1]) {
        const low = chestBottom(W, H, lane);
        expect(low / H).toBeGreaterThan(0.6);                                   // 主角确实在画面下部
        for (let n = 1; n <= lines; n++) expect(subsTop(H, n), `lane ${lane}, ${n} line(s): chest at ${low.toFixed(0)} px`).toBeGreaterThan(low);
      }
    });
  }
});

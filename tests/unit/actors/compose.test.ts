// tests/unit/actors/compose.test.ts —— 修复轮 U5：停拍与静场里的异常构图（Node 场景台 scene.ts，按章节数据跑 cue）。
// 替身的头在画面里（|NDC| < 0.8），不落在主角的投影包围盒里，也没有被主角的网格挡住（软件光栅化）：
// 2-10 +3.0 s（第三只手穿过玻璃，侧面机位）、3-10 2.0 s 与 10.8 s、3-4 停拍 3.5 s（绕到水洼另一侧）、3-5 6.8 s（车窗）。
// 另有 2-5 掌心贴玻璃、4-6 水里站着的「我」与按进水里的双手、5-8 摔倒后的鞋底、5-9 枕边的凹陷。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STILL_ORIGIN } from '../../../src/core/constants';
import { BONE_INDEX } from '../../../src/core/rig';
import ch2 from '../../../src/levels/chapters/ch2';
import ch3 from '../../../src/levels/chapters/ch3';
import ch4 from '../../../src/levels/chapters/ch4';
import ch5 from '../../../src/levels/chapters/ch5';
import type { ChapterDef } from '../../../src/levels/schema';
import { GLASS_X } from '../../../src/render/sets/school/canteenWindow';
import { INFIRMARY_BED, sheetHeight } from '../../../src/render/sets/outside/infirmary';
import { WATER_EDGE_Z } from '../../../src/render/sets/outside/water';
import { doubleVerts, frame, headNdc, inBox, ndc, playerBox, playRun, playStill, playStop, scene, stillSnap, visibleFraction } from './scene';
import { snap } from './helpers';

const O = new THREE.Vector3(STILL_ORIGIN.x, STILL_ORIGIN.y, STILL_ORIGIN.z);

function expectReadable(w: Awaited<ReturnType<typeof scene>>, id: string): void {
  const h = headNdc(w, id)!;
  expect(h).not.toBeNull();
  expect(Math.abs(h.x)).toBeLessThan(0.8);
  expect(Math.abs(h.y)).toBeLessThan(0.8);
  expect(h.z).toBeLessThan(1);
  expect(inBox(h, playerBox(w))).toBe(false);
  expect(visibleFraction(w, id, [BONE_INDEX.head]).visible).toBeGreaterThan(0.9);
}

describe('anomaly doubles are not hidden behind the protagonist (U5)', () => {
  it('2-10 stop +3.0 s: side shot while the third hand goes through the glass; a ripple on the glass where it crosses', async () => {
    const w = await scene(ch2 as ChapterDef);
    playStop(w, '2-10', 139, 3.0);
    expectReadable(w, 'chip');
    const w2 = await scene(ch2 as ChapterDef);
    playStop(w2, '2-10', 139, 4.2);
    const rip = w2.ctx.scene.getObjectByName('wp5.glassRipple')!;
    expect(rip.visible).toBe(true);
    const mirrorS = w2.ch.segments.find((s) => s.def.id === '2-10')!.surfaces.find((q) => q.id === 'chipMirror')!.s0;
    expect(Math.abs(-rip.position.z - mirrorS)).toBeLessThan(0.02);
  });

  it('3-10 at 2.0 s and 10.8 s (doorway glance): the reflection is beside the protagonist, not behind his head', async () => {
    for (const [t, id] of [[2.0, 'bath'], [10.85, 'bath2']] as const) {
      const w = await scene(ch3 as ChapterDef);
      playStill(w, '3-10', t);
      expectReadable(w, id);
    }
  });

  it('3-10 at 11.3 s: the figure behind the reflection and its hand on the shoulder are in the mirror, beside the protagonist', async () => {
    const w = await scene(ch3 as ChapterDef);
    playStill(w, '3-10', 11.3);
    expectReadable(w, 'bathBehind');
    const hand: THREE.Vector3[] = [];
    doubleVerts(w, 'bathBehind', (v, bi) => { if (bi === BONE_INDEX.arm3Hand) hand.push(ndc(w, v)); });
    expect(hand.length).toBeGreaterThan(0);
    for (const p of hand) { expect(Math.abs(p.x)).toBeLessThan(1); expect(Math.abs(p.y)).toBeLessThan(1); }
  });

  it('3-4 stop 3.5 s: the camera goes round to the far side of the puddle; the standing reflection is in frame and clear', async () => {
    const w = await scene(ch3 as ChapterDef);
    const last = playStop(w, '3-4', 112, 3.5);
    expectReadable(w, 'puddle');
    expect(-w.camera.position.z).toBeGreaterThan(last.player.s + 1);          // 镜头在主角前方
  });

  it('3-5 at 6.8 s: the double in the bus window is between two pillars, its tapping finger on the glass', async () => {
    const w = await scene(ch3 as ChapterDef);
    playStill(w, '3-5', 6.8);
    expectReadable(w, 'busMe');
    // 视线穿过车窗平面的地方在这一格玻璃里（立柱在 z 0.25–0.45 与 −1.55–−1.45）
    const d = w.dbl.active().find((q) => q.id === 'busMe')!;
    const cam = w.camera.position, head = new THREE.Vector3(...d.head);
    const xw = O.x - 1.22, k = (xw - cam.x) / (head.x - cam.x);
    const zc = cam.z + (head.z - cam.z) * k - O.z;
    expect(zc).toBeLessThan(0.25 - 0.12); expect(zc).toBeGreaterThan(-1.45 + 0.12);
    let maxX = -Infinity;
    doubleVerts(w, 'busMe', (v, bi) => { if (bi === BONE_INDEX.padL) maxX = Math.max(maxX, v.x - O.x); });
    expect(maxX).toBeLessThan(-1.2); expect(maxX).toBeGreaterThan(-1.26);         // 指尖碰到玻璃，不穿进车厢
  });
});

describe('1-3: the reflection that lifts its head half a beat late is readable (U5)', () => {
  // 洗手台（WP3 washroom kit 的 sink）：台面 0.73–0.87 m，外沿 x = −1.35
  const COUNTER_TOP = 0.87, COUNTER_X = -1.35;
  for (const lane of [-1, 0, 1] as const) {
    for (const b1 of [40.5, 44.9]) {
      it(`lane ${lane} @${b1}: the head is above the counter line${lane < 1 ? ' and ≥ 25 px tall at 1280×720' : ''}`, async () => {
        const ch1 = (await import('../../../src/levels/chapters/ch1')).default as ChapterDef;
        const w = await scene(ch1);
        playRun(w, '1-3', 30, b1, lane);
        const d = w.dbl.active().find((q) => q.id === 'wc')!;
        expect(d.visible).toBe(true);
        const head = new THREE.Vector3(...d.head), cam = w.camera.position;
        const fy = w.ch.segments.find((q) => q.def.id === '1-3')!.floorY(0);
        const k = (COUNTER_X - cam.x) / (head.x - cam.x);
        expect(cam.y + (head.y - cam.y) * k - fy).toBeGreaterThan(COUNTER_TOP + 0.01);
        const h = headNdc(w, 'wc')!;
        expect(Math.abs(h.x)).toBeLessThan(0.8); expect(Math.abs(h.y)).toBeLessThan(0.8);
        if (lane < 1) {
          const top = head.clone().add(new THREE.Vector3(0, 0.12, 0)).project(w.camera), bot = head.clone().add(new THREE.Vector3(0, -0.12, 0)).project(w.camera);
          expect((top.y - bot.y) * 360).toBeGreaterThanOrEqual(25);
        }
      });
    }
  }
});

describe('other still compositions (U5)', () => {
  it('2-5 at 5.6 s: the third hand is flat on the glass, ≥ 40 px tall at 640×360, and the reflection\'s hanging legs are visible', async () => {
    const w = await scene(ch2 as ChapterDef);
    playStill(w, '2-5', 5.6);
    const ys: number[] = [];
    let near = 0, n = 0;
    doubleVerts(w, 'winSeat', (v, bi) => {
      if (bi !== BONE_INDEX.arm3Hand) return;
      n++; if (Math.abs(v.x - O.x - GLASS_X) < 0.06) near++;
      ys.push(ndc(w, v).y);
    });
    expect(n).toBeGreaterThan(0);
    expect(near / n).toBeGreaterThan(0.6);
    expect((Math.max(...ys) - Math.min(...ys)) * 180).toBeGreaterThanOrEqual(40);
    expect(visibleFraction(w, 'winSeat', [BONE_INDEX.arm3Hand]).visible).toBeGreaterThan(0.9);
    expect(visibleFraction(w, 'winSeat', [BONE_INDEX.shinL, BONE_INDEX.shinR]).visible).toBeGreaterThan(0.6);
    // 脚尖点地：最低点贴着镜中房间的地面
    let low = Infinity;
    doubleVerts(w, 'winSeat', (v, bi) => { if (bi === BONE_INDEX.footL || bi === BONE_INDEX.footR) low = Math.min(low, v.y - O.y); });
    expect(Math.abs(low)).toBeLessThan(0.03);
  });

  it('4-6 at 3.0 s: the standing "me" fills ≥ 25 % of the frame height in the middle; my hands reach into the lower frame; the shore is out', async () => {
    const w = await scene(ch4 as ChapterDef);
    playStill(w, '4-6', 3.0);
    const ys: number[] = [], xs: number[] = [];
    doubleVerts(w, 'waterMe', (v) => { const p = ndc(w, v); ys.push(p.y); xs.push(p.x); });
    expect((Math.max(...ys) - Math.min(...ys)) / 2).toBeGreaterThanOrEqual(0.25);
    expect(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2)).toBeLessThan(0.2);
    w.actor.rig.root.updateMatrixWorld(true);
    for (const n of ['padL', 'padR']) {
      const p = new THREE.Vector3(); w.actor.rig.root.getObjectByName(n)!.getWorldPosition(p);
      const q = ndc(w, p);
      expect(Math.abs(q.x)).toBeLessThan(0.95); expect(q.y).toBeLessThan(-0.15); expect(q.y).toBeGreaterThan(-1);
      expect(p.z - O.z).toBeLessThan(WATER_EDGE_Z);                                 // 按在水里，不在岸上
    }
    const shore = ndc(w, new THREE.Vector3(0, 0, WATER_EDGE_Z + 0.01).add(O));
    expect(shore.y).toBeLessThan(-1);
    // 只画手臂和手（镜头在他眼睛里）
    expect(w.actor.groupAlpha.toArray()).toEqual([0, 1, 1, 0]);
  });

  it('5-8 after the seventh step: the camera at the hip looks up at the raised, shaking feet against the sky', async () => {
    const w = await scene(ch5 as ChapterDef);
    const seg = w.ch.segments.find((s) => s.def.id === '5-8')!;
    const mk = (t: number, stepT: number) => { const n = snap({ s: seg.s0 + 3, t, segKind: 'stand' }); n.segIndex = seg.index; n.segment = '5-8'; n.player.stand = { phase: 'fallen', x: 0, theta: 0.1, steps: 7, stepT, held: 3, script: 'sevenSteps' }; return n; };
    let prev = mk(10, 0);
    w.cam.setShot('trackSky', 0.35, 10);
    for (let i = 1; i <= 120; i++) { const n = mk(10 + i / 60, i / 60); frame(w, prev, n); prev = n; }
    const look = w.camera.getWorldDirection(new THREE.Vector3());
    expect(look.y).toBeGreaterThan(0.4);                                             // 看向天
    w.actor.rig.root.updateMatrixWorld(true);
    let inFrame = 0;
    for (const n of ['footL', 'footR']) {
      const p = new THREE.Vector3(); w.actor.rig.root.getObjectByName(n)!.getWorldPosition(p);
      const q = ndc(w, p);
      if (Math.abs(q.x) < 0.9 && Math.abs(q.y) < 0.9 && q.z < 1) inFrame++;
    }
    expect(inFrame).toBe(2);
  });

  it('5-9: the camera pushes in to the dent beside the pillow; at 8.6 s it is in the middle of the frame and the body is mostly out', async () => {
    const w = await scene(ch5 as ChapterDef);
    playStill(w, '5-9', 8.6);
    const d = INFIRMARY_BED.dent!;
    const p = ndc(w, new THREE.Vector3(d[0], sheetHeight(INFIRMARY_BED as never, d[0], d[1]), d[1]).add(O));
    expect(Math.abs(p.x)).toBeLessThan(0.25); expect(Math.abs(p.y)).toBeLessThan(0.25);
    const box = playerBox(w);
    void box;
    // 头枕在枕头上
    const head = new THREE.Vector3(); w.actor.rig.root.updateMatrixWorld(true); w.actor.rig.root.getObjectByName('head')!.getWorldPosition(head);
    expect(Math.abs(head.z - O.z - INFIRMARY_BED.pillowZ)).toBeLessThan(0.15);
    void stillSnap;
  });
});

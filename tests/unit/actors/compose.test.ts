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
import { BENCH_X, BOARD_Z, labBoardSet } from '../../../src/render/sets/school/labBoard';
import { INFIRMARY_BED, sheetHeight } from '../../../src/render/sets/outside/infirmary';
import { RIPPLE_GAIN, WATER_DOUBLE_Z, WATER_EDGE_Z, WATER_HAND_X, WATER_HAND_Z } from '../../../src/render/sets/outside/water';
import { getSet } from '../../../src/core/registry';
import { snapshot as kitSnap, viewContext } from '../outside/helpers';
import { boneGroup, upperFadeWanted } from '../../../src/render/actors/readability';
import { WP5 } from '../../../src/render/actors/shared';
import { doubleEyes, doubleVerts, frame, headNdc, inBox, ndc, occluderDepth, playerBox, playRun, playStill, playStop, pointsVisible, scene, stillSnap, visibleAgainst, visibleFraction } from './scene';
import { snap } from './helpers';
import { scaleEyeVertex, STILL_EYE_GLOW, STILL_EYE_SCALE } from '../../../src/render/actors/Doubles';
import { RIG_COLORS, rigColor } from '../../../src/render/actors/rigBuild';
import { presetOf, screenColor, screenColorBasic } from '../../../src/render/kits/outside/lib/tone';
import '../../../src/render/atmosphere';

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

  // 「它的指尖碰到我的额头」（第 2 章）：第三只手 2.6 s 开始「慢慢」伸（DESIGN 2-10：2 s，像穿过一层水）——+3.6 s 时指尖还离你的头
  // > 0.15 m，+4.4 s 起 < 0.1 m；这时你的头和镜中它的头都在侧面机位的画面里（±0.9）。你的右手掌心贴在玻璃上
  // （「我抬起右手，贴在镜面上」），cue 的 4 s（4.3 s）过了、第三只手还在时也贴着，直到 5.2 s 它不见
  function headVerts(w: Awaited<ReturnType<typeof scene>>): THREE.Vector3[] {
    const head: THREE.Vector3[] = [];
    w.actor.rig.root.updateMatrixWorld(true);
    w.actor.rig.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, sk = m.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (sk.getX(i) !== BONE_INDEX.head) continue;
        const v = new THREE.Vector3().fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); head.push(v);
      }
    });
    return head;
  }
  const mirrorOf = (w: Awaited<ReturnType<typeof scene>>) => w.ch.segments.find((s) => s.def.id === '2-10')!.surfaces.find((q) => q.id === 'chipMirror')!.s0;
  for (const lane of [-1, 0, 1] as const) {
    it(`2-10 lane ${lane}: palm on the glass, the fingertip slowly reaches your forehead, both heads in the side shot`, async () => {
      let touched = 0;
      for (const tA of [3.6, 4.4, 4.8, 5.1]) {
        const w = await scene(ch2 as ChapterDef);
        playStop(w, '2-10', 139, tA, lane);
        const mirrorS = mirrorOf(w);
        w.actor.rig.root.updateMatrixWorld(true);
        const palm = new THREE.Vector3(); w.actor.rig.root.getObjectByName('palmR')!.getWorldPosition(palm);
        expect(Math.abs(-palm.z - mirrorS)).toBeLessThan(0.06);
        expect(Math.abs(palm.x)).toBeLessThan(0.9);                                    // 在镜子的开口里（半宽 0.95）
        expect(WP5.chaseCam).toBe(false);                                               // 侧面机位
        const box = w.ctx.scene.getObjectByName(`double${w.dbl.slotIndexOf('chip')}`)!; box.updateMatrixWorld(true);
        const up = new THREE.Vector3(); box.getObjectByName('arm3Upper')!.getWorldPosition(up);
        let tip: THREE.Vector3 | null = null, far = -1;
        doubleVerts(w, 'chip', (v, bi) => { if (bi === BONE_INDEX.arm3Hand && v.distanceTo(up) > far) { far = v.distanceTo(up); tip = v.clone(); } });
        let near = Infinity;
        const head = headVerts(w);
        for (const v of head) if (tip) near = Math.min(near, v.distanceTo(tip));
        const hc = head.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / head.length);
        const hn = ndc(w, hc), dn = headNdc(w, 'chip')!;
        if (tA < 4) { expect(near).toBeGreaterThan(0.15); continue; }               // 慢：伸了 1 s，还在半路
        expect(near).toBeLessThan(0.1); expect(near).toBeGreaterThan(0.005);           // 碰到，不戳进头里
        if (Math.abs(hn.x) < 0.9 && Math.abs(hn.y) < 0.9 && Math.abs(dn.x) < 0.9 && Math.abs(dn.y) < 0.9) touched++;
      }
      expect(touched).toBeGreaterThanOrEqual(2);
    });
  }

  // 「我闭上眼。再睁开时，镜子里只有我自己。额头干干净净」「我只是继续往前爬」（修复轮 U5 第三轮）：5.2 s 第三只手不见的那一帧，
  // 镜头从侧面机位切回追尾，他同一帧放下手、回到停拍的爬姿（不是跪直的「站在镜子前」），镜子里是普通的倒影——真正的镜像、
  // 没有第三只手，在画面里、没被他挡住
  for (const lane of [-1, 0, 1] as const) {
    it(`2-10 lane ${lane}: after the hand is gone he is crawling again, under the chase camera, and the mirror shows only him`, async () => {
      for (const tA of [5.22, 6.0, 7.5]) {
        const w = await scene(ch2 as ChapterDef);
        const last = playStop(w, '2-10', 139, tA, lane);
        const fy = last.player.floorY, mirrorS = mirrorOf(w);
        w.actor.rig.root.updateMatrixWorld(true);
        const at = (n: string) => { const p = new THREE.Vector3(); w.actor.rig.root.getObjectByName(n)!.getWorldPosition(p); return p; };
        const pel = at('pelvis'), hd = at('head'), palm = at('palmR');
        expect(pel.y - fy).toBeLessThan(0.45);                                          // 跪直时 0.62
        expect(hd.y - fy).toBeLessThan(0.6);                                            // 跪直时 1.19
        expect(palm.y - fy).toBeLessThan(0.1);                                          // 手撑在地上，不贴在镜子上
        expect(mirrorS - -palm.z).toBeGreaterThan(0.1);
        expect(WP5.chaseCam).toBe(true);
        expect(w.camera.position.z).toBeGreaterThan(pel.z + 2);                        // 在他身后
        const d = w.dbl.active().find((q) => q.id === 'chip')!;
        expect(d.visible).toBe(true); expect(d.plain).toBe(true); expect(d.third).toBeNull(); expect(d.alpha).toBe(1);
        // 真正的镜像：倒影的骨盆在镜后的深度 = 他的骨盆在镜前的距离
        const box = w.ctx.scene.getObjectByName(`double${d.slot}`)!; box.updateMatrixWorld(true);
        const dp = new THREE.Vector3(); box.getObjectByName('pelvis')!.getWorldPosition(dp);
        expect(Math.abs((-dp.z - mirrorS) - (mirrorS - -pel.z))).toBeLessThan(0.05);
        expect(Math.abs(dp.x - pel.x)).toBeLessThan(0.05);
        const h = headNdc(w, 'chip')!;
        expect(Math.abs(h.x)).toBeLessThan(0.9); expect(Math.abs(h.y)).toBeLessThan(0.9);
        expect(visibleFraction(w, 'chip', [BONE_INDEX.head], 640, 360).visible).toBeGreaterThan(0.9);
        // 第三只手的骨骼缩成 0（不画）
        expect(box.getObjectByName('arm3Upper')!.scale.x).toBeLessThan(0.01);
      }
    });
  }

  it('2-10: the drop from the glass is a cut, not a slide — the camera jumps from the side shot to the chase view in the same frame', async () => {
    const w = await scene(ch2 as ChapterDef);
    playStop(w, '2-10', 139, 5.19, 0);
    const before = w.camera.position.clone();
    w.actor.rig.root.updateMatrixWorld(true);
    const p0 = new THREE.Vector3(); w.actor.rig.root.getObjectByName('pelvis')!.getWorldPosition(p0);
    const w2 = await scene(ch2 as ChapterDef);
    const last = playStop(w2, '2-10', 139, 5.21, 0);
    w2.actor.rig.root.updateMatrixWorld(true);
    const p1 = new THREE.Vector3(); w2.actor.rig.root.getObjectByName('pelvis')!.getWorldPosition(p1);
    expect(p0.y - last.player.floorY).toBeGreaterThan(0.55);                           // 5.19 s 还跪着、掌心贴着玻璃
    expect(p1.y - last.player.floorY).toBeLessThan(0.45);                              // 下一帧已经趴下
    expect(w2.camera.position.distanceTo(before)).toBeGreaterThan(1);                  // 同一帧切镜头
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
    // 搭在肩上的手看得见（修复轮 U5 第二轮）：不被宿主（镜中的你）、身后那人自己的身体或你挡住，≥ 50 %；而且真的搭在肩上
    const A = BONE_INDEX;
    const depth = occluderDepth(w, { player: true, doubles: [{ id: 'bath2' }, { id: 'bathBehind', skip: [A.arm3Upper, A.arm3Fore, A.arm3Hand] }] }, 640, 360);
    expect(visibleAgainst(w, 'bathBehind', [A.arm3Hand], depth, 640, 360).visible).toBeGreaterThanOrEqual(0.5);
    const sc = w.ctx.scene, host = sc.getObjectByName(`double${w.dbl.slotIndexOf('bath2')}`)!, behind = sc.getObjectByName(`double${w.dbl.slotIndexOf('bathBehind')}`)!;
    host.updateMatrixWorld(true); behind.updateMatrixWorld(true);
    const wrist = new THREE.Vector3(); behind.getObjectByName('arm3Hand')!.getWorldPosition(wrist);
    const sh = ['upperArmL', 'upperArmR'].map((n) => { const v = new THREE.Vector3(); host.getObjectByName(n)!.getWorldPosition(v); return v.distanceTo(wrist); });
    expect(Math.min(...sh)).toBeLessThan(0.16);
  });

  it('3-10 at 11.0–11.5 s: the hand is already on the shoulder while the last glance lasts (extends in 0.3 s, before the 11.6 s blackout)', async () => {
    for (const t of [11.15, 11.5]) {
      const w = await scene(ch3 as ChapterDef);
      playStill(w, '3-10', t);
      const A = BONE_INDEX;
      const depth = occluderDepth(w, { player: true, doubles: [{ id: 'bath2' }, { id: 'bathBehind', skip: [A.arm3Upper, A.arm3Fore, A.arm3Hand] }] }, 640, 360);
      expect(visibleAgainst(w, 'bathBehind', [A.arm3Hand], depth, 640, 360).visible).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('3-4 stop 3.5 s: the camera goes round to the far side of the puddle; the standing reflection is in frame and clear', async () => {
    const w = await scene(ch3 as ChapterDef);
    const last = playStop(w, '3-4', 112, 3.5);
    expectReadable(w, 'puddle');
    expect(-w.camera.position.z).toBeGreaterThan(last.player.s + 1);          // 镜头在主角前方
    // 本车道前方 7 拍有自行车架（bar），但镜头不在他身后：上半身不淡（修复轮 U5 第二轮：以前他在水洼镜头里是半透明的）
    const seg = w.ch.segments.find((s) => s.def.id === '3-4')!;
    expect(upperFadeWanted(seg.obstacles, last.player.s, 0, 0, 4.5)).toBe(true);
    expect(WP5.chaseCam).toBe(false);
    expect(w.actor.upperAlpha).toBe(1);
  });

  it('the upper-body fade only runs under the chase camera: 3-4 crawling towards the bike rack fades, the stop gaze does not', async () => {
    const w = await scene(ch3 as ChapterDef);
    playRun(w, '3-4', 108, 114, 0);
    expect(WP5.chaseCam).toBe(true);
    expect(w.actor.upperAlpha).toBeLessThan(0.45);
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
  // 25 px 只要求 −1、0 两条车道。右道离左墙的镜子最远：倒影在镜中的深度是 0.3 + 0.75 × 玩家到墙的距离，右道的倒影比中道深约 0.8 m，
  // 镜头也离墙远 0.77 m，头只有 19–20 px（验收员 verify-U5-r1/probe-1-3）。把倒影往镜面拉近会被台盆挡住（台面 0.87 m），
  // 所以右道只要求头在台面投影线以上、在画面里（|NDC| < 0.8）。截图（WP5.json u5-1-3-*）和自动驾驶走中道。
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
  it('2-9: the whole board is clear of the benches and of him, and the steel leg of his bench is right beside him', async () => {
    for (const t of [6.6, 10.0]) {
      const w = await scene(ch2 as ChapterDef);
      playStill(w, '2-9', t);
      const root = labBoardSet.build(w.ctx, 'default');
      root.position.copy(O); root.updateMatrixWorld(true);
      const occ: THREE.Object3D[] = [];
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !o.name.startsWith('board:') && o.name !== 'floor') occ.push(o); });
      w.actor.rig.root.updateMatrixWorld(true);
      const me: THREE.Object3D[] = [];
      w.actor.rig.root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) me.push(o); });
      const rc = new THREE.Raycaster(), cam = w.camera.position.clone();
      let n = 0, hidden = 0;
      // 整块黑板（x ±1.75、y 1.0–2.05；最下面一行是粉笔槽，不算）
      for (let x = -1.75; x <= 1.75 + 1e-9; x += 0.25) for (let y = 1.0; y <= 2.05 + 1e-9; y += 0.15) {
        const p = new THREE.Vector3(x, y, BOARD_Z + 0.012).add(O);
        const q = p.clone().project(w.camera);
        n++;
        if (Math.abs(q.x) > 0.98 || Math.abs(q.y) > 0.98) { hidden++; continue; }
        const d = p.clone().sub(cam), L = d.length();
        rc.set(cam, d.normalize()); rc.far = L - 0.02;
        if (rc.intersectObjects(occ, false).length || rc.intersectObjects(me, false).length) hidden++;
      }
      expect(hidden).toBe(0);
      expect(n).toBeGreaterThan(100);
      // 「我坐起来，背靠着实验桌的桌腿」：右手边那张实验台的钢架腿（x = BENCH_X − 0.4）离他的根不到 0.7 m
      const r = WP5.playerRoot.clone().sub(O);
      expect(Math.abs(BENCH_X - 0.4 - r.x)).toBeLessThan(0.7);
    }
  });

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
    expect(Math.min(...ys)).toBeGreaterThan(-0.9); expect(Math.max(...ys)).toBeLessThan(0.95);    // 整个人在画面里
    // 修复轮 U5 第二轮：斜着看（−35° 到 −45°），不是从正上方看鞋底
    const pitch = Math.asin(w.camera.getWorldDirection(new THREE.Vector3()).y) / (Math.PI / 180);
    expect(pitch).toBeLessThan(-33); expect(pitch).toBeGreaterThan(-46);
    // 头和眼睛在画面里，没有被它自己的身体（肩膀、胸口）或我按进水里的手臂挡住；头在字幕带（约 y −0.33…−0.47）以上
    const h = headNdc(w, 'waterMe')!;
    expect(Math.abs(h.x)).toBeLessThan(0.3); expect(h.y).toBeGreaterThan(-0.3); expect(h.y).toBeLessThan(0.5);
    const A = BONE_INDEX;
    const self = occluderDepth(w, { player: true, doubles: [{ id: 'waterMe', skip: [A.head] }] }, 640, 360);
    expect(visibleAgainst(w, 'waterMe', [A.head], self, 640, 360).visible).toBeGreaterThan(0.6);
    const eyes = doubleEyes(w, 'waterMe');
    expect(eyes.length).toBeGreaterThan(0);
    const all = occluderDepth(w, { player: true, doubles: [{ id: 'waterMe' }] }, 640, 360);
    expect(pointsVisible(w, eyes, all, 640, 360)).toBeGreaterThan(0.4);               // 眼睛方块朝前的面看得见
    for (const e of eyes) { const q = ndc(w, e); expect(Math.abs(q.x)).toBeLessThan(0.5); expect(Math.abs(q.y)).toBeLessThan(0.6); }
    // 「他看着我」：脸朝着镜头（头心 → 两眼中点的方向与眼睛 → 镜头的方向夹角 < 20°；不低头时约 36°），不是从下巴那一侧看过去的一块肤色圆
    const hc = new THREE.Vector3(); let hn = 0;
    doubleVerts(w, 'waterMe', (v, bi) => { if (bi === A.head) { hc.add(v); hn++; } });
    hc.multiplyScalar(1 / hn);
    const ec = eyes.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / eyes.length);
    const face = ec.clone().sub(hc).normalize(), toCam = w.camera.position.clone().sub(ec).normalize();
    expect(Math.acos(face.dot(toCam)) / (Math.PI / 180)).toBeLessThan(20);
    // 围着它爬的人群（离它 1.5–3.5 m 的一圈）大部分在画面里
    let inF = 0, n = 0;
    for (let a = 0; a < 24; a++) for (const r of [1.5, 2.5, 3.5]) {
      const ang = (a / 24) * Math.PI * 2, z = WATER_DOUBLE_Z + Math.sin(ang) * r * 0.8;
      if (z > WATER_EDGE_Z - 0.4) continue;
      n++;
      const q = ndc(w, new THREE.Vector3(Math.cos(ang) * r, -0.25, z).add(O));
      if (Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && q.z < 1) inF++;
    }
    expect(inF / n).toBeGreaterThan(0.6);
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

  // 「他的眼睛里有一种…很亮的…东西」（修复轮 U5 第三轮）：以前自发光 0.35 在画面上是 #979797，比 #a89f93 的脸还暗，2–3 px 的眼睛
  // 被抹掉了，整张脸是一块空白的米色圆盘（验收员 verify-U5-r2 的取色）。现在眼睛在画面上比脸亮 ≥ 0.15（HSL 亮度），每只 ≥ 4 px
  it('4-6 at 3.0 s: its eyes are clearly brighter than its face and ≥ 4 px each at 1280×720', async () => {
    const w = await scene(ch4 as ChapterDef);
    playStill(w, '4-6', 3.0);
    const box = w.ctx.scene.getObjectByName(`double${w.dbl.slotIndexOf('waterMe')}`)!;
    box.updateMatrixWorld(true);
    let mesh: THREE.SkinnedMesh | null = null;
    box.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
    const m = mesh as unknown as THREE.SkinnedMesh;
    // 着色器补丁真的进了 three r186 的 lambert（顶点里放大眼睛、片元里替换成自发光），uniform 是这个 set 的值
    const sh = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
    (m.material as THREE.MeshLambertMaterial).onBeforeCompile(sh as never, null as never);
    expect(sh.vertexShader).toContain('transformed = wp5C + (transformed - wp5C) * uWp5EyeScale;');
    expect(sh.fragmentShader).toContain('outgoingLight = mix(outgoingLight, vec3(uWp5EyeGlow)');
    expect(sh.uniforms.uWp5EyeGlow!.value).toBe(STILL_EYE_GLOW.water);
    expect(sh.uniforms.uWp5EyeScale!.value).toBe(STILL_EYE_SCALE.water);
    // 眼睛的大小：静止姿势里按着色器同一个公式放大，再蒙皮、投影到 1280×720
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, col = m.geometry.getAttribute('color') as THREE.BufferAttribute;
    const eye = new THREE.Color().setHex(RIG_COLORS.eye);
    const bb: Record<string, number[]> = { L: [1e9, 1e9, -1e9, -1e9], R: [1e9, 1e9, -1e9, -1e9] };
    const c = new THREE.Vector3();
    let n = 0;
    for (let v = 0; v < pos.count; v++) {
      if (Math.abs(col.getX(v) - eye.r) > 0.004 || Math.abs(col.getY(v) - eye.g) > 0.004 || Math.abs(col.getZ(v) - eye.b) > 0.004) continue;
      const p = new THREE.Vector3().fromBufferAttribute(pos, v);
      const b = bb[p.x < 0 ? 'L' : 'R']!;
      scaleEyeVertex(p, STILL_EYE_SCALE.water!);
      m.applyBoneTransform(v, p); p.applyMatrix4(m.matrixWorld);
      c.add(p); n++;
      const q = p.clone().project(w.camera), x = (q.x + 1) / 2 * 1280, y = (1 - q.y) / 2 * 720;
      b[0] = Math.min(b[0]!, x); b[1] = Math.min(b[1]!, y); b[2] = Math.max(b[2]!, x); b[3] = Math.max(b[3]!, y);
    }
    for (const b of Object.values(bb)) { expect(b[2]! - b[0]!).toBeGreaterThanOrEqual(4); expect(b[3]! - b[1]!).toBeGreaterThanOrEqual(4); }
    // 画面上的颜色（Lambert ÷ π、Neutral、sRGB；替身材质的去饱和 0.15 与色调 ×1.34–1.4），脸朝镜头
    c.multiplyScalar(1 / n);
    const nrm = w.camera.position.clone().sub(c).normalize();
    const sk = new THREE.Color().setHex(rigColor('skin'));
    const lum = 0.299 * sk.r + 0.587 * sk.g + 0.114 * sk.b, tint = [1.34, 1.36, 1.4];
    const alb = [sk.r, sk.g, sk.b].map((x, j) => (x + (lum - x) * 0.15) * tint[j]!) as [number, number, number];
    const L = (q: readonly number[]) => (Math.max(...q) + Math.min(...q)) / 2;
    const face = L(screenColor(alb, presetOf('dreamGray'), [nrm.x, nrm.y, nrm.z]));
    const g = STILL_EYE_GLOW.water!;
    expect(L(screenColorBasic([g, g, g])) - face).toBeGreaterThanOrEqual(0.15);
    expect(L(screenColorBasic([0.35, 0.35, 0.35])) - face).toBeLessThan(0);              // 以前：比脸还暗
    expect(Math.abs(face - 0.62)).toBeLessThan(0.04);                                    // 与截图上取的脸色（#a89f93）一致
  });

  // 中、高画质的人群更密（26 个）：以前有一个爬着的人正好落在镜头和它的脸之间，挡住半张脸和一只眼睛（修复轮 U5 第三轮的截图）
  for (const tier of ['low', 'medium'] as const) {
    it(`4-6 at 3.0 s (${tier}): no one in the crawling crowd stands between the camera and its face`, async () => {
      const w = await scene(ch4 as ChapterDef);
      playStill(w, '4-6', 3.0);
      const ctx = viewContext(tier, true);
      const root = getSet('water')!.build(ctx, 'default');
      root.position.copy(O); root.updateMatrixWorld(true);
      let crowd: THREE.Mesh | null = null;
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.includes('waterCrowd') && !crowd) crowd = o as THREE.Mesh; });
      expect(crowd).toBeTruthy();
      const cm = crowd as unknown as THREE.Mesh;
      (cm.material as THREE.Material).side = THREE.DoubleSide;                         // 人群是镜像几何体（绕向翻转）
      const pts = doubleEyes(w, 'waterMe');
      doubleVerts(w, 'waterMe', (v, bi) => { if (bi === BONE_INDEX.head) pts.push(v); });
      const rc = new THREE.Raycaster(), cam = w.camera.position.clone();
      let hidden = 0;
      for (const p of pts) {
        const d = p.clone().sub(cam), L = d.length();
        rc.set(cam, d.normalize()); rc.far = L - 0.02;
        if (rc.intersectObject(cm, false).length) hidden++;
      }
      expect(pts.length).toBeGreaterThan(50);
      expect(hidden).toBe(0);
    });
  }

  it('4-6 at 3–6 s: small ripples keep spreading around both hands pressed into the water, bright enough to show on the pale water', () => {
    const ctx = viewContext('low', true);
    const root = getSet('water')!.build(ctx, 'default');
    ctx.scene.add(root);
    const fx = root.getObjectByName('splash') as THREE.Mesh ?? (() => { let m: THREE.Mesh | null = null; root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name.includes('splash')) m = o as THREE.Mesh; }); return m!; })();
    expect(fx).toBeTruthy();
    for (const t of [3.0, 4.5, 6.0]) {
      getSet('water')!.update!(t, kitSnap({ t: 100 + t, segment: '4-6', segKind: 'still', still: { set: 'water', variant: 'default', t, duration: 8, prompt: null, held: 0 } }));
      const pos = fx.geometry.getAttribute('position') as THREE.BufferAttribute, col = fx.geometry.getAttribute('color') as THREE.BufferAttribute;
      const near = [0, 0];
      for (let i = 0; i < pos.count; i++) {
        if (col.getX(i) < 0.05) continue;
        for (const [k, hx] of [[0, -WATER_HAND_X], [1, WATER_HAND_X]] as const) {
          if (Math.hypot(pos.getX(i) - hx, pos.getZ(i) - WATER_HAND_Z) < 0.45) near[k]!++;
        }
      }
      expect(near[0]).toBeGreaterThan(20); expect(near[1]).toBeGreaterThan(20);
    }
    expect(RIPPLE_GAIN.hand).toBeGreaterThanOrEqual(0.12);
    ctx.scene.remove(root);
  });

  it('5-8 after the seventh step: he rolls onto his back and the camera at the hip looks up at the raised, shaking feet against the sky', async () => {
    const w = await scene(ch5 as ChapterDef);
    const seg = w.ch.segments.find((s) => s.def.id === '5-8')!;
    const mk = (t: number, stepT: number) => { const n = snap({ s: seg.s0 + 3, t, segKind: 'stand' }); n.segIndex = seg.index; n.segment = '5-8'; n.player.stand = { phase: 'fallen', x: 0, theta: 0.1, steps: 7, stepT, held: 3, script: 'sevenSteps' }; return n; };
    let prev = mk(10, 0);
    w.cam.setShot('trackSky', 0.35, 10);
    // Stand 在 fallen 之后不再推进 stepT（一直是 0）：摔倒的动作由 Actor 自己按模拟时间计时
    for (let i = 1; i <= 120; i++) { const n = mk(10 + i / 60, 0); frame(w, prev, n); prev = n; }
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
    // 脚悬在空中（仰躺，不是停在跪姿）
    const fy = w.ch.segments.find((q) => q.def.id === '5-8')!.floorY(seg.s0 + 3);
    const fL = new THREE.Vector3(); w.actor.rig.root.getObjectByName('footL')!.getWorldPosition(fL);
    expect(fL.y - fy).toBeGreaterThan(0.3);
  });

  it('5-9: the camera pushes in to the dent beside the pillow; at 8.6 s it is in the middle of the frame and the body is mostly out', async () => {
    const w = await scene(ch5 as ChapterDef);
    playStill(w, '5-9', 8.6);
    const d = INFIRMARY_BED.dent!;
    const p = ndc(w, new THREE.Vector3(d[0], sheetHeight(INFIRMARY_BED as never, d[0], d[1]), d[1]).add(O));
    expect(Math.abs(p.x)).toBeLessThan(0.25); expect(Math.abs(p.y)).toBeLessThan(0.25);
    // 主角的肢体退出画面（修复轮 U5 第二轮）：腿、手、手臂在画面里的顶点 ≤ 10 %，头和躯干 ≤ 15 %
    const cnt = [0, 0, 0, 0], inF = [0, 0, 0, 0];
    w.actor.rig.root.updateMatrixWorld(true);
    w.actor.rig.root.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute, sk = m.geometry.getAttribute('skinIndex') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const bi = sk.getX(i);
        if (bi >= BONE_INDEX.arm3Upper) continue;                                       // 第三只手、道具
        const v = new THREE.Vector3().fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld);
        const q = ndc(w, v), g = boneGroup(bi);
        cnt[g]!++; if (Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && q.z < 1) inF[g]!++;
      }
    });
    const frac = inF.map((k, g) => k / Math.max(1, cnt[g]!));
    expect(frac[0]).toBeLessThanOrEqual(0.1); expect(frac[1]).toBeLessThanOrEqual(0.1); expect(frac[2]).toBeLessThanOrEqual(0.1);
    expect(frac[3]).toBeLessThanOrEqual(0.15);
    // 头枕在枕头上
    const head = new THREE.Vector3(); w.actor.rig.root.updateMatrixWorld(true); w.actor.rig.root.getObjectByName('head')!.getWorldPosition(head);
    expect(Math.abs(head.z - O.z - INFIRMARY_BED.pillowZ)).toBeLessThan(0.15);
    void stillSnap;
  });
});

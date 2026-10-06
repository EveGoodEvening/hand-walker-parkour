// tests/unit/actors/handCycle.test.ts —— §8.10 WP5 验收 2：掌根触地的画面帧与 contact 事件相差 ≤ 1 帧；
// 步幅 0.6–1.5 m 的任意设置下，支撑期手在世界坐标里的漂移 < 1 cm。
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BONE_INDEX } from '../../../src/core/rig';
import { GaitClock } from '../../../src/sim/Gait';
import { crawlPose, handState, PoseBuilder, stancePhase, type HandState } from '../../../src/render/actors/handCycle';
import { PALM_DROP } from '../../../src/render/actors/rigBuild';
import { crawlInput } from './helpers';

const TICK = 1 / 120;
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _p = new THREE.Vector3();

/** 掌根最低点（世界 y）：腕关节 + 掌的朝向 × (0, −PALM_DROP, 0)。 */
function heelY(b: PoseBuilder, side: 'L' | 'R'): number {
  b.jointWorld(`palm${side}`, _p);
  _q.multiplyQuaternions(b.rootQ, b.wq[BONE_INDEX[`palm${side}`]] as THREE.Quaternion);
  _v.set(0, -PALM_DROP, 0).applyQuaternion(_q);
  return _p.y + _v.y;
}

describe('hand cycle (§5.6)', () => {
  for (const stride of [0.6, 0.8, 1.0, 1.1, 1.3, 1.5]) {
    it(`planted hand drifts < 1 cm in world space (stride ${stride})`, () => {
      const cadence = stride > 1.2 ? 6.2 : 5.0;
      const speed = cadence * stride;
      const b = new PoseBuilder();
      const st = stancePhase(stride);
      let s = 3, maxDrift = 0, stances = 0;
      const anchor: Record<'L' | 'R', THREE.Vector3 | null> = { L: null, R: null };
      const hs: HandState = { phase: 'stance', wx: 0, wy: 0, ws: 0, palm: 0, knuckle: 0, pad: 0, phi: 0, stance: 0 };
      for (let tick = 0; tick < 120 * 4; tick++) {
        s += speed * TICK;
        const inp = crawlInput({ s, beat: s / stride, stride, cadence, speed });
        crawlPose(inp, b);
        for (const side of ['L', 'R'] as const) {
          handState(inp, side === 'L' ? 0 : 1, 0, hs);
          const w = b.jointWorld(`palm${side}`, new THREE.Vector3());
          // 支撑期（去掉掌根 → 指节的前 26 ms：那时掌面绕掌根转，腕高度按 cos 变化 < 3 mm）
          if (hs.phase === 'stance' && hs.phi > 0.02 && hs.phi < st - 0.005) {
            const a = anchor[side];
            if (!a) { anchor[side] = w.clone(); stances++; }
            else maxDrift = Math.max(maxDrift, a.distanceTo(w));
          } else anchor[side] = null;
        }
      }
      expect(stances).toBeGreaterThan(4);
      expect(maxDrift).toBeLessThan(0.01);
    });
  }

  it('the heel touches the ground within 1 frame of the contact event', () => {
    for (const stride of [0.6, 1.0, 1.5]) {
      const cadence = stride > 1.2 ? 6.4 : 4.8;
      const speed = cadence * stride;
      const b = new PoseBuilder();
      const gait = new GaitClock();
      let s = 0, prevBeat = 0, t = 0;
      const contactTick: Record<'L' | 'R', number[]> = { L: [], R: [] };
      const touchTick: Record<'L' | 'R', number[]> = { L: [], R: [] };
      const down: Record<'L' | 'R', boolean> = { L: true, R: true };
      for (let tick = 1; tick < 120 * 3; tick++) {
        s += speed * TICK; t += TICK;
        const beat = s / stride;
        gait.cross(prevBeat, beat, t - TICK, t, cadence, (bi) => { contactTick[bi % 2 === 0 ? 'L' : 'R'].push(tick); });
        gait.due(t, []);
        prevBeat = beat;
        crawlPose(crawlInput({ s, beat, stride, cadence, speed }), b);
        for (const side of ['L', 'R'] as const) {
          const touching = heelY(b, side) <= 0.002;
          if (touching && !down[side]) touchTick[side].push(tick);
          down[side] = touching;
        }
      }
      for (const side of ['L', 'R'] as const) {
        expect(contactTick[side].length).toBeGreaterThan(3);
        for (const c of contactTick[side]) {
          const nearest = touchTick[side].reduce((m, x) => (Math.abs(x - c) < Math.abs(m - c) ? x : m), -1e9);
          expect(Math.abs(nearest - c)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('crawl pose produces finite, normalized quaternions in every mode', () => {
    const b = new PoseBuilder();
    const modes = [
      { mode: 'crawl' as const }, { mode: 'air' as const, air: true, airT: 0.2, y: 0.4 }, { mode: 'duck' as const, duck: 1 },
      { mode: 'stumble' as const, modeT: 0.1 }, { mode: 'crash' as const, modeT: 0.1 }, { mode: 'fall' as const, modeT: 0.5 },
      { twitch: 1 }, { drift: 1 }, { lookBack: 1 },
    ];
    for (const m of modes) {
      const p = crawlPose(crawlInput({ s: 7, beat: 7.3, ...m }), b);
      for (let i = 0; i < p.q.length; i += 4) {
        const n = Math.hypot(p.q[i]!, p.q[i + 1]!, p.q[i + 2]!, p.q[i + 3]!);
        expect(Number.isFinite(n)).toBe(true);
        expect(Math.abs(n - 1)).toBeLessThan(1e-3);
      }
    }
  });

  it('keeps the base crawl posture of §5.6 (shoulders above hips, head up, hands ahead of shoulders at strike)', () => {
    const b = new PoseBuilder();
    crawlPose(crawlInput({ s: 10, beat: 10 }), b);
    const hip = b.wp[BONE_INDEX.pelvis]!.y;
    const sh = (b.wp[BONE_INDEX.upperArmL]!.y + b.wp[BONE_INDEX.upperArmR]!.y) / 2;
    const head = b.wp[BONE_INDEX.head]!.y;
    expect(sh).toBeGreaterThan(hip);
    expect(head).toBeGreaterThan(sh);
    expect(sh).toBeGreaterThan(0.38); expect(sh).toBeLessThan(0.52);
    // 偶数拍：左手刚落在肩前约 0.3 m
    const palmL = b.wp[BONE_INDEX.palmL]!, shL = b.wp[BONE_INDEX.upperArmL]!;
    expect(shL.z - palmL.z).toBeGreaterThan(0.2);
    // 鞋底朝后上方（对着追尾镜头）：鞋底法线（脚的 −y）在角色空间里 z > 0、y > 0
    const n = new THREE.Vector3(0, -1, 0).applyQuaternion(b.wq[BONE_INDEX.footL]!);
    expect(n.z).toBeGreaterThan(0.1);
    expect(n.y).toBeGreaterThan(0.3);
  });
});

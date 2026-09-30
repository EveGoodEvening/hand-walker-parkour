// src/render/npc/index.ts —— NPC 与障碍的占位实现（DESIGN.md §2.5 剪影语言、§5.7、§8.9-10）。CORE 写初版，之后归 WP6。
// 按类别着色的盒子障碍（实例化，每类 1 个 InstancedMesh）：
//   low   扁宽，顶边一道粉笔白；foot（伸进过道的脚）单独一种：一截小腿 + 鞋，鞋底朝外；
//   bar   横杆（杆底一条细白线）+ 两条细腿，下面是一道深缝；block 竖直的高剪影；stallDoor 绕门轴摆动的隔间门；
//   soft  贴地的半透明反光片；pickup 米白色的小纸片。
// 人群（npcs 组）：两侧只建到腰带的腿（§5.7「视线里只有膝盖和腰带」），实例化，1 次 draw call。
// 行为（swing / walk / yield / stretch / shift）与模拟共用 sim/Track.ts 的纯函数，画面与碰撞一致。
import * as THREE from 'three';
import type { ViewContext, ViewSystem } from '../../core/contracts';
import { LANE_WIDTH, RENDER_ORDER } from '../../core/constants';
import type { GameEvent } from '../../core/events';
import { GeoBuilder } from '../../core/geo';
import { lerp } from '../../core/math';
import { registerViewSystem } from '../../core/registry';
import { createRng } from '../../core/rng';
import type { SimSnapshot } from '../../core/types';
import { VISUAL_SCALE } from '../../levels/obstacles';
import type { CompiledChapter, CompiledObstacle, CompiledSegment } from '../../levels/schema';
import { obstacleState, swingOpen, type ObstacleState } from '../../sim/Track';

type PoolId = 'low' | 'foot' | 'barTop' | 'barLeg' | 'block' | 'legs' | 'seated' | 'door' | 'soft' | 'pickup';

function unitBox(side: number, top: number, bottom: number): THREE.BufferGeometry {
  const g = new GeoBuilder();
  g.box([0, 0.5, 0], [1, 1, 1], side, { colors: { '+y': top, '-y': bottom } });
  return g.build();
}
function lowGeo(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  g.box([0, 0.45, 0], [1, 0.9, 1], 0x7e8f99);
  g.chalkValue = 1;
  g.box([0, 0.95, 0], [1.02, 0.1, 1.02], 0xe4e8e4);     // 顶边一道粉笔白
  return g.build();
}
function footGeo(): THREE.BufferGeometry {
  // 沿 +x 伸出：小腿从 x = 0.5 处的桌下斜伸出来，鞋平放在地上，鞋尖朝 −x（朝过道中央）
  const g = new GeoBuilder();
  g.segment([0.62, 0.42, 0], [0.18, 0.1, 0], 0.1, 0.1, 0x2a3a52);
  g.box([0.02, 0.05, 0], [0.28, 0.09, 0.11], 0x2b3034, { colors: { '-x': 0xcfd4d6, '+y': 0x3a3f43 } });
  g.chalkValue = 1;
  g.box([0.02, 0.1, 0], [0.26, 0.01, 0.1], 0xc7d0d3, { faces: '+y' });
  return g.build();
}
function barLegGeo(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  for (const x of [-0.46, 0.46]) g.box([x, 0.5, 0], [0.05, 1, 0.08], 0x5b6468);
  return g.build();
}
function legsGeo(): THREE.BufferGeometry {
  // 真实尺寸（米），面朝 +z（朝玩家）：两条腿 + 腰带 + 鞋
  const g = new GeoBuilder();
  for (const x of [-0.1, 0.1]) {
    g.box([x, 0.53, 0], [0.12, 0.92, 0.13], 0x2a3a52);
    g.box([x, 0.04, 0.05], [0.11, 0.08, 0.27], 0x2b3034, { colors: { '-z': 0xcfd4d6 } });
  }
  g.box([0, 1.0, 0], [0.36, 0.1, 0.18], 0x1e2226);
  return g.build();
}
function seatedGeo(): THREE.BufferGeometry {
  // 坐着的人（真实尺寸，面朝 −z）：小腿竖直、大腿水平向后，鞋尖朝前；低机位里只看得见膝盖以下
  const g = new GeoBuilder();
  for (const x of [-0.1, 0.1]) {
    g.box([x, 0.24, -0.12], [0.11, 0.44, 0.11], 0x2a3a52);
    g.box([x, 0.47, 0.1], [0.12, 0.12, 0.46], 0x2a3a52);
    g.box([x, 0.04, -0.2], [0.1, 0.08, 0.26], 0x2b3034, { colors: { '+z': 0xcfd4d6 } });
  }
  return g.build();
}
function blockGeo(): THREE.BufferGeometry {
  // 竖直的高剪影：深色，顶沿略亮，四条竖棱一道粉笔描边（aChalk = 1）
  const g = new GeoBuilder();
  g.box([0, 0.5, 0], [1, 1, 1], 0x3a464d, { colors: { '+y': 0x5b6970, '-y': 0x2a3136, '+z': 0x33404a } });
  g.chalkValue = 1;
  for (const x of [-0.5, 0.5]) g.box([x, 0.5, 0.5], [0.03, 1, 0.03], 0x8a979e);
  g.box([0, 0.985, 0.5], [1, 0.03, 0.03], 0xc7d0d3);
  return g.build();
}
function doorGeo(): THREE.BufferGeometry {
  // 门轴在原点，门板沿 −z 伸出 0.9 m（关着时贴着隔间墙）
  const g = new GeoBuilder();
  g.box([0, 0.95, -0.45], [0.04, 1.7, 0.9], 0x9aa3a4, { colors: { '+x': 0xb7bdbb, '-x': 0xb7bdbb } });
  g.chalkValue = 1;
  g.box([0, 0.95, -0.9], [0.05, 1.7, 0.02], 0xc7d0d3);
  return g.build();
}
function quadGeo(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  g.quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5], 0xffffff);
  return g.build();
}

interface Deco { s: number; x: number; rotY: number; sy: number; seg: number; seated: boolean }

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

class ObstacleView implements ViewSystem {
  readonly id = 'npc';
  readonly owner = 'WP6' as const;
  readonly order = 20;
  private ctx!: ViewContext;
  private pools = new Map<PoolId, { mesh: THREE.InstancedMesh; n: number }>();
  private all: Array<{ o: CompiledObstacle; seg: CompiledSegment }> = [];
  private decos: Deco[] = [];
  private knocked = new Set<number>();
  private takenNotes = new Set<string>();
  private segStartT = 0;
  private segIndex = 0;
  private st: ObstacleState = { active: true, ds: 0, x0: 0, x1: 0, amount: 1 };
  private chapter: CompiledChapter | null = null;

  init(ctx: ViewContext): void {
    this.ctx = ctx;
    const lam = () => ctx.mat.lambert({ vertexColors: true, flat: true });
    const add = (id: PoolId, geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, order = 0) => {
      ctx.mat.ensureChalkAttr(geo);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = order; mesh.name = `pool:${id}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      ctx.scene.add(mesh);
      this.pools.set(id, { mesh, n: 0 });
    };
    add('low', lowGeo(), lam(), 48);
    add('foot', footGeo(), lam(), 24);
    add('barTop', unitBox(0xa8a294, 0xb9b4a8, 0xe4e8e4), lam(), 32);
    add('barLeg', barLegGeo(), lam(), 32);
    add('block', blockGeo(), lam(), 48);
    add('legs', legsGeo(), lam(), 128);
    add('seated', seatedGeo(), lam(), 96);
    add('door', doorGeo(), lam(), 8);
    const soft = ctx.mat.basic({ color: 0x9fc3d6, transparent: true, opacity: 0.32 });
    soft.depthWrite = false;
    add('soft', quadGeo(), soft, 32, RENDER_ORDER.floorDecal);
    add('pickup', quadGeo(), ctx.mat.basic({ color: 0xe6e1d6 }), 8);
  }

  async loadChapter(ch: CompiledChapter): Promise<void> {
    this.chapter = ch;
    this.all = ch.segments.flatMap((seg) => seg.obstacles.map((o) => ({ o, seg }))).sort((a, b) => a.o.s0 - b.o.s0);
    this.decos = [];
    for (const seg of ch.segments) {
      if (seg.kind !== 'run') continue;
      for (const grp of seg.npcGroups) {
        const rng = createRng(ch.seed, `npc:${seg.def.id}:${grp.id ?? grp.kind}`);
        const seated = grp.kind === 'seatedRow' || grp.kind === 'classmates';
        const step = seated ? 1.3 : 0.9;
        const sides = grp.side === 'both' ? [-1, 1] : grp.side === 'L' ? [-1] : [1];
        for (const side of sides) {
          for (let b = grp.from; b <= grp.to; b += step / seg.stride) {
            if (rng.next() > grp.density) continue;
            const s = seg.s0 + b * seg.stride + rng.range(-0.2, 0.2);
            const x = side * (seated ? 1.55 : rng.range(1.42, 1.66));
            const rotY = seated ? rng.range(-0.25, 0.25) + (rng.next() < 0.3 ? -side * 0.6 : 0)
              : (side < 0 ? Math.PI / 2 : -Math.PI / 2) + rng.range(-0.3, 0.3);
            this.decos.push({ s, x, rotY, sy: seated ? 1 : rng.range(0.95, 1.05), seg: seg.index, seated });
          }
        }
      }
    }
    this.decos.sort((a, b) => a.s - b.s);
    this.knocked.clear();
    this.takenNotes.clear();
  }

  onSegment(seg: CompiledSegment): void { this.segIndex = seg.index; }

  onEvent(e: GameEvent, snap: SimSnapshot): void {
    if (e.type === 'segment') this.segStartT = snap.t;
    if (e.type === 'hit') {
      const it = this.all.find((a) => a.o.id === e.data.obstacleId);
      if (it && it.o.cls === 'low') this.knocked.add(it.o.id);
    }
    if (e.type === 'note') this.takenNotes.add(e.data.id);
    if (e.type === 'retry') this.knocked.clear();
  }

  onReset(snap: SimSnapshot): void {
    this.knocked.clear();
    const seg = this.chapter?.segments[snap.segIndex];
    this.segIndex = snap.segIndex;
    // 读章或跳到检查点时模拟把 tSeg 设为 seg.timeAt(beat)
    this.segStartT = seg && seg.kind === 'run' ? snap.t - seg.timeAt(snap.segBeat) : snap.t;
  }

  private put(id: PoolId, pos: THREE.Vector3, rot: THREE.Quaternion, scale: THREE.Vector3): void {
    const p = this.pools.get(id);
    if (!p || p.n >= p.mesh.instanceMatrix.count) return;
    _m.compose(pos, rot, scale);
    p.mesh.setMatrixAt(p.n++, _m);
  }

  frame(prev: SimSnapshot, next: SimSnapshot, alpha: number): void {
    for (const p of this.pools.values()) p.n = 0;
    const visible = next.segKind === 'run';
    if (visible) {
      const same = prev.segIndex === next.segIndex;
      const a = same ? alpha : 1;
      const s = lerp(prev.player.s, next.player.s, a);
      const beatNow = same ? lerp(prev.segBeat, next.segBeat, a) : next.segBeat;
      const tNow = lerp(prev.t, next.t, a);
      const tSeg = tNow - this.segStartT;
      const ahead = this.ctx.quality.chunksAhead * 12 + 6;
      for (const { o, seg } of this.all) {
        if (o.s0 > s + ahead + 30) break;
        if (o.s1 + 30 < s - 4) continue;
        if (o.cls === 'pickup' && this.takenNotes.has(String(o.params.note ?? ''))) continue;
        const cur = seg.index === this.segIndex;
        const st = obstacleState(o, cur ? tSeg : 0, cur ? beatNow : -1, this.st);
        const s0 = o.s0 + st.ds, s1 = o.s1 + st.ds;
        if (s0 > s + ahead || s1 < s - 4) continue;
        this.place(o, seg, st, s0, s1, cur ? tSeg : 0, cur ? beatNow : -1);
      }
      // 两侧人群的腿
      for (const d of this.decos) {
        if (d.s > s + ahead) break;
        if (d.s < s - 4) continue;
        _p.set(d.x, 0, -d.s); _q.setFromEuler(_e.set(0, d.rotY, 0)); _s.set(1, d.sy, 1);
        this.put(d.seated ? 'seated' : 'legs', _p, _q, _s);
      }
    }
    for (const p of this.pools.values()) {
      p.mesh.count = p.n;
      p.mesh.visible = p.n > 0;
      if (p.n) p.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private place(o: CompiledObstacle, seg: CompiledSegment, st: ObstacleState, s0: number, s1: number, tSeg: number, beat: number): void {
    const fy = seg.floorY(s0);
    const cx = (st.x0 + st.x1) / 2;
    const widthC = st.x1 - st.x0;
    const width = widthC + 2 * o.halfW * (VISUAL_SCALE - 1);
    const depthC = s1 - s0;
    const depth = depthC * VISUAL_SCALE;
    const zc = -(s0 + depthC / 2);
    _q.identity();
    switch (o.cls) {
      case 'low': {
        if (o.kind === 'footOut') {
          const side = o.lanes[0] === 1 ? -1 : 1;   // 从离得近的那一侧伸出来
          _p.set(cx + side * 0.05, fy, zc);
          _q.setFromEuler(_e.set(0, side > 0 ? 0 : Math.PI, 0));
          const out = st.active ? 1 : 0.35;
          _s.set(out * (width / 0.6), 1, 1);
          if (this.knocked.has(o.id)) _q.multiply(new THREE.Quaternion().setFromEuler(_e.set(0.4, 0, 0)));
          this.put('foot', _p, _q, _s);
          return;
        }
        _p.set(cx, fy, zc); _s.set(width, o.y1, depth);
        if (this.knocked.has(o.id)) { _q.setFromEuler(_e.set(-1.2, 0, 0.2)); _p.y += 0.05; }
        this.put('low', _p, _q, _s);
        return;
      }
      case 'bar': {
        _p.set(cx, fy + o.y0, zc); _s.set(width, o.y1 - o.y0, depth);
        this.put('barTop', _p, _q, _s);
        _p.set(cx, fy, zc); _s.set(width, o.y0, Math.min(depth, 1.2));
        this.put('barLeg', _p, _q, _s);
        return;
      }
      case 'block': {
        if (o.kind === 'stallDoor') {
          const b = o.behavior;
          const open = b.type === 'swing' ? swingOpen(b.period, b.phase, tSeg) : 1;
          // 门轴在车道外沿（x = lane × 1.1 + 0.55），关着时贴墙，开到 90° 横在车道里
          const hingeX = (o.lanes[0] ?? 1) * LANE_WIDTH + (o.lanes[0] === -1 ? -0.55 : 0.55);
          _p.set(hingeX, fy, -o.s0);
          const ang = open * Math.PI / 2 * (o.lanes[0] === -1 ? -1 : 1);
          _q.setFromEuler(_e.set(0, ang, 0));
          _s.set(1, 1, 1);
          this.put('door', _p, _q, _s);
          return;
        }
        if (o.npc) {
          // 人腿 / 陈默：陈默蹲着（低），到点起身让到一边
          let x = cx, sy = o.kind === 'chenMo' ? 0.62 : 1;
          if (o.behavior.type === 'yield' && !st.active) { x = 1.55; sy = 1; }
          _p.set(x, fy, zc); _q.setFromEuler(_e.set(0, Math.PI, 0)); _s.set(1, sy, 1);
          this.put('legs', _p, _q, _s);
          void beat;
          return;
        }
        _p.set(cx, fy, zc); _s.set(width, o.y1, depth);
        this.put('block', _p, _q, _s);
        return;
      }
      case 'soft': {
        _p.set(cx, fy + 0.004, zc); _s.set(width, 1, depth);
        this.put('soft', _p, _q, _s);
        return;
      }
      case 'pickup': {
        _p.set(cx, fy + 0.006, zc); _q.setFromEuler(_e.set(0, 0.35, 0)); _s.set(0.2, 1, 0.14);
        this.put('pickup', _p, _q, _s);
        return;
      }
    }
  }
}

registerViewSystem(new ObstacleView());

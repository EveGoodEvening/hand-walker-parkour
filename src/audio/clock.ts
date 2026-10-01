// src/audio/clock.ts —— 模拟时间 → ctx.currentTime 的换算与前瞻调度（DESIGN.md §6.1「调度」）。WP7。纯逻辑，Node 可测。
// 所有触地声都按模拟时间戳换算到音频时钟，提前约 50 ms 调度。偏移一旦确定就保持不变，所以同一组三段声、
// 自己和追随者之间的相对时间是精确的（误差只来自浮点）。只有在事件来得太晚（会排到过去）或太早（模拟跑到了音频前面）、
// 或者音频时钟与模拟时钟漂移超过阈值时才重新对齐。
export class SimClock {
  /** 前瞻（秒）。 */
  lookahead = 0.05;
  /** 排程时间至少领先当前音频时间多少（秒）；更晚就重新对齐。 */
  minLead = 0.006;
  /** 排程时间最多领先多少（秒）；更早就重新对齐。离线测试设为 Infinity。 */
  maxLead = 0.3;
  /** 帧检查时，理想偏移与当前偏移相差超过它就重新对齐（秒）。 */
  maxDrift = 0.12;
  private off: number | null = null;
  reanchors = 0;

  get offset(): number | null { return this.off; }

  /** 模拟时刻 simT 对应的音频时刻。 */
  toAudio(simT: number, now: number): number {
    let at = this.off === null ? Number.NaN : simT + this.off;
    if (this.off === null || !(at >= now + this.minLead) || at > now + this.maxLead) {
      this.off = now + this.lookahead - simT;
      at = now + this.lookahead;
      this.reanchors++;
    }
    return at;
  }

  /** 不改变偏移地换算（没有偏移时按「现在 + 前瞻」）。 */
  peek(simT: number, now: number): number {
    return this.off === null ? now + this.lookahead : Math.max(now, simT + this.off);
  }

  /** 每帧：snapT 是最新的模拟时刻，now 是音频时刻；漂移过大时重新对齐。 */
  track(snapT: number, now: number): void {
    if (this.off === null) return;
    const ideal = now + this.lookahead - snapT;
    if (Math.abs(ideal - this.off) > this.maxDrift) { this.off = ideal; this.reanchors++; }
  }

  /** 离线模式下「现在」：由最新模拟时刻反推（事件总是排在它之后约一个前瞻）。 */
  virtualNow(snapT: number): number {
    return this.off === null ? 0 : Math.max(0, snapT + this.off - this.lookahead);
  }

  reset(): void { this.off = null; }
}

// src/sim/index.ts —— 模拟包入口（DESIGN.md §8.2）。CORE 编写，之后归 WP1。
// 注册 CORE 的 Sim 与 Solver；WP1 可以直接改这里换成完整实现。
import { registerSim, registerSolver } from '../core/registry';
import { Sim } from './Sim';
import { solver } from './Solver';

registerSolver(solver);
registerSim((s) => new Sim(s));

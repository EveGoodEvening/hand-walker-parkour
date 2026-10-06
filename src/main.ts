// src/main.ts —— 入口（DESIGN.md §8.2）。CORE 冻结：按固定顺序 import 各包的 index.ts，之后任何人都不改它。
// 各包在自己的 index.ts 里调用 register*()；某个包还没注册时回落到 CORE 的占位实现。
import './render/kits/placeholder';
import './render/sets/placeholder';
import './sim/index';
import './render/index';
import './render/kits/school/index';
import './render/sets/school/index';
import './render/kits/outside/index';
import './render/sets/outside/index';
import './render/weather/index';
import './render/actors/index';
import './render/camera/index';
import './render/npc/index';
import './audio/index';
import './input/index';
import './ui/index';
import { Game } from './core/Game';
import { installDebugHook } from './core/debugHook';

const game = new Game();
installDebugHook(game);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const app = document.getElementById('app') as HTMLElement;
game.boot(canvas, ui, app).catch((err: unknown) => {
  console.error('[boot] failed', err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:absolute;inset:0;margin:0;padding:16px;color:#dfe6ea;background:#0d1216;font:12px monospace;white-space:pre-wrap';
  pre.textContent = String(err instanceof Error ? err.stack ?? err.message : err);
  document.body.appendChild(pre);
});

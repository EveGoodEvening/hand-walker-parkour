// src/input/index.ts —— 输入包入口（DESIGN.md §8.2）。CORE 写初版，之后归 WP8。
import { registerInput } from '../core/registry';
import { Input } from './Input';

registerInput(() => new Input());

// src/render/camera/index.ts —— 镜头包入口（DESIGN.md §5.4、§8.7）。CORE 写初版，之后归 WP5。
// 注册 CameraRig（order 60）与 `camera` cue 处理器（WP5）。
import { registerCueHandler, registerViewSystem } from '../../core/registry';
import { CameraRig } from './CameraRig';

const rig = new CameraRig();
registerViewSystem(rig);
registerCueHandler('camera', 'WP5', (b, c) => rig.setShot(b.shot, b.seconds, c.snap.t));

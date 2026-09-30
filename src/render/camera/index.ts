// src/render/camera/index.ts —— 镜头包入口（DESIGN.md §5.4、§8.7）。WP5。
// 注册 CameraRig（order 60）与 `camera` cue 处理器。
import { registerCueHandler, registerViewSystem } from '../../core/registry';
import { CameraRig } from './CameraRig';

export const cameraRig = new CameraRig();
registerViewSystem(cameraRig);
registerCueHandler('camera', 'WP5', (b, c) => cameraRig.setShot(b.shot, b.seconds, c.snap.t));

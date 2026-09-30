// src/audio/index.ts —— 声音包入口（DESIGN.md §6、§8.7）。CORE 写初版（静音占位），之后归 WP7。
// 注册 NullAudio，以及 WP7 负责的 cue：bell、sfx、ambience、silence（占位只记录 cue 名）。
import { registerAudio, registerCueHandler } from '../core/registry';
import { NullAudio, nullAudioRef } from './NullAudio';

registerAudio(() => {
  const a = new NullAudio();
  nullAudioRef.current = a;
  return a;
});
registerCueHandler('bell', 'WP7', (b) => nullAudioRef.current?.record(`bell:${b.kind}`));
registerCueHandler('sfx', 'WP7', (b) => nullAudioRef.current?.record(`sfx:${b.sfx}`));
registerCueHandler('ambience', 'WP7', (b) => nullAudioRef.current?.record(`ambience:${b.amb}`));
registerCueHandler('silence', 'WP7', (b) => nullAudioRef.current?.record(`silence:${b.seconds}`));

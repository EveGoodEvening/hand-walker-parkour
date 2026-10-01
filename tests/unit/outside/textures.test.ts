// tests/unit/outside/textures.test.ts —— WP4 户外纹理（DESIGN.md §5.9 表、附录 A-9）。生成器是纯函数，Node 里直接测像素。
import { describe, expect, it } from 'vitest';
import { hsv, isWarm } from '../../../src/render/kits/outside/lib/colors';
import { FlatTextureBank } from '../../../src/core/fallbacks';
import { OUTDOOR_TEXTURES, genCeilingCrack, genPalmEye, genSkyGradient, registerOutdoorTextures, type Img } from '../../../src/render/textures/outdoor';

const px = (im: Img, x: number, y: number) => { const i = (y * im.w + x) * 4; return [im.data[i]!, im.data[i + 1]!, im.data[i + 2]!, im.data[i + 3]!] as const; };
const hex = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

describe('10 个户外纹理（§5.9）', () => {
  it('全部登记，生成确定，尺寸按 size 走', () => {
    expect(Object.keys(OUTDOOR_TEXTURES).sort()).toEqual(['adRunner', 'asphaltWet', 'bedSheet', 'busInterior', 'ceilingCrack', 'graffitiHand', 'palmEye',
      'plazaTile', 'skyGradient', 'trackRubber']);
    for (const [id, gen] of Object.entries(OUTDOOR_TEXTURES)) {
      const a = gen(64, {}), b = gen(64, {});
      expect(a.w * a.h * 4, id).toBe(a.data.length);
      expect(Array.from(a.data)).toEqual(Array.from(b.data));
      expect(gen(128, {}).w, id).toBeGreaterThan(a.w - 1);
    }
  });
  it('没有暖色（跑道本身除外，§5.1 跑道色）', () => {
    for (const [id, gen] of Object.entries(OUTDOOR_TEXTURES)) {
      if (id === 'trackRubber') continue;
      const im = gen(64, id === 'ceilingCrack' ? { shape: 'hand' } : {});
      let warm = 0, n = 0;
      for (let y = 0; y < im.h; y += 2) for (let x = 0; x < im.w; x += 2) {
        const [r, g, b, a] = px(im, x, y);
        if (a < 20) continue;
        n++;
        if (isWarm(hex(r, g, b))) warm++;
      }
      expect(warm / Math.max(1, n), id).toBeLessThan(0.002);
    }
  });
  it('TextureBank 注册幂等', () => {
    const bank = new FlatTextureBank(64);
    let n = 0;
    const reg = bank.register.bind(bank);
    bank.register = (id, g) => { n++; reg(id, g); };
    registerOutdoorTextures(bank); registerOutdoorTextures(bank);
    expect(n).toBe(10);
  });
});

describe('各纹理的内容', () => {
  it('skyGradient：地平线 = 1（与雾色无缝），越往上越暗；清晨正前方更亮', () => {
    const night = genSkyGradient(64, { kind: 'night' });
    expect(px(night, 10, night.h - 1)[0]).toBe(255);
    expect(px(night, 10, 0)[0]).toBeLessThan(220);
    const dawn = genSkyGradient(64, { kind: 'dawn' });
    const front = px(dawn, Math.round((dawn.w - 1) / 2), dawn.h - 1)[0], back = px(dawn, 0, dawn.h - 1)[0];
    expect(front).toBeGreaterThan(back);
    expect(front).toBe(255);
  });
  it('ceilingCrack：河与手两种形状不同；都有深色的裂缝', () => {
    const river = genCeilingCrack(64, { shape: 'river' }), hand = genCeilingCrack(64, { shape: 'hand' });
    expect(Array.from(river.data)).not.toEqual(Array.from(hand.data));
    for (const im of [river, hand]) {
      let dark = 0;
      for (let i = 0; i < im.w * im.h; i++) if ((im.data[i * 4] as number) < 110) dark++;
      expect(dark).toBeGreaterThan(20);
    }
  });
  it('palmEye：4 帧横排；闭眼那一帧没有瞳孔', () => {
    const im = genPalmEye(512);
    expect(im.w).toBe(im.h * 4);
    const F = im.h;
    const pupil = (f: number) => {
      let n = 0;
      for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
        const [r, g, b] = px(im, f * F + x, y);
        if (r < 40 && g < 40 && b < 40) n++;
      }
      return n;
    };
    expect(pupil(0)).toBeGreaterThan(10);
    expect(pupil(2)).toBe(0);
    expect(pupil(1)).toBeLessThan(pupil(0));
    // 皮肤偏暖但饱和度低（§5.1 皮肤 #C9B8A6）
    const [r, g, b] = px(im, 5, 5);
    expect(hsv(hex(r, g, b)).s).toBeLessThan(0.22);
  });
  it('graffitiHand：透明底，手的面积占一部分', () => {
    const im = OUTDOOR_TEXTURES.graffitiHand!(64, {});
    let solid = 0, clear = 0;
    for (let i = 0; i < im.w * im.h; i++) { const a = im.data[i * 4 + 3] as number; if (a > 200) solid++; if (a < 10) clear++; }
    expect(solid / (im.w * im.h)).toBeGreaterThan(0.1);
    expect(clear / (im.w * im.h)).toBeGreaterThan(0.4);
  });
});

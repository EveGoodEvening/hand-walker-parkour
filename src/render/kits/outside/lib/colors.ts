// src/render/kits/outside/lib/colors.ts —— WP4 户外、夜、梦的色板（DESIGN.md §5.1、附录 A-9）。
// 取自 §5.1 的色值，外加少量由它们混出来的冷灰。WP3 的 render/palette.ts 是另一个包的内部文件，这里不 import。
// 暖色只有三种（§5.1 最后一行，只在第三章）：路灯碎金 lampGold、烟头 ember（WP6 用，这里只登记）、栏杆红灯 barrierRed。
// 其余颜色一律冷色或近乎无彩；单元测试（tests/unit/outside）逐顶点检查。

export const C = {
  // —— 通用冷色（§5.1 UI / 线 / 冷强调）——
  ink: 0x0d1216, fog: 0x3a464d, cold: 0x9fc3d6, lowSteady: 0x50606a, grey: 0x8a979e, paleText: 0xdfe6ea,
  steel: 0x9ba5a9, steelDark: 0x5b6468, chalk: 0xc7d0d3, white: 0xd9dee3, paper: 0xe6e1d6, shadow: 0x0b0f12,
  // —— 人（没有五官）——
  uniform: 0x2f4a6d, pants: 0x2a3a52, skin: 0xc9b8a6, callus: 0x9b8f82, lines: 0x8c8279, hair: 0x1e2226, shoe: 0x2b3034, sole: 0xcfd4d6,
  // —— 夜街（第三章）——
  asphalt: 0x1c2227, asphaltWet: 0x151b20, asphaltLight: 0x232b31, puddle: 0x22323b, curb: 0x3a444b, paver: 0x2a3238, paverJoint: 0x1a2025,
  wallNight: 0x2a3238, wallNight2: 0x232b31, wallNightDark: 0x171d22, windowDark: 0x1e282f, windowLitCold: 0x7d93a1,
  pole: 0x2a3136, iron: 0x20272c, tin: 0x4a545a, tin2: 0x3b444a, shutter: 0x4b565e, shutter2: 0x3f4950, signDark: 0x262e34,
  bush: 0x1b2420, bushDark: 0x141b18, lampDead: 0x39434a, boothLit: 0x9fb6c4, concreteNight: 0x2f383e,
  // —— 限用暖色（只在第三章，§5.1）——
  lampGold: 0xc8a15a, ember: 0xd2553a, barrierRed: 0xb3322c,
  // —— 清晨（第五章 5-3）——
  dawnPaver: 0x5e6870, dawnPaverJoint: 0x4a545b, dawnRoad: 0x3e474d, dawnCurb: 0x6f7a81, dawnWall: 0x56626a, dawnWall2: 0x4b565e,
  dawnWindow: 0x3c4750, dawnLamp: 0xc9d6de, trunk: 0x646b66, trunkPale: 0x858c86, canopy: 0x3c4845, canopy2: 0x46524e,
  leaf: 0x5b6052, leafWet: 0x4a5048, car: 0x4b555c, car2: 0x3a4349, carGlass: 0x222b31,
  // —— 梦（第四章）：发白、几乎没有颜色的浅灰（§4.4、§5.1）——
  plaza: 0xc9cfd2, plazaSeam: 0xb9c0c3, plazaSky: 0xe4e8ea, plazaWater: 0x5d6b73, crowd: 0x7e878b, crowdDark: 0x6c7478,
  dreamFog: 0xd9dee0,
  // —— 操场（第五章 5-7、5-8）——
  track: 0x7a4b44, trackLine: 0xcfd3d2, grass: 0x5e6b5a, grassDark: 0x53604f, kerb: 0xa9b0b2, bleacher: 0x8d9597, fence: 0x5b6468,
  // —— 室内（静场）——
  wall: 0xc9cfcf, ceiling: 0xb9c0c1, tube: 0xeef6ff, tile: 0xd5dbdc, grout: 0x9aa3a4, infirmary: 0xdde4e6,
  homeFloor: 0x1e252a, homeWall: 0x2a3237, homeWall2: 0x252c31, sofa: 0x252d33, tvGlow: 0x8fa9ba, windowLight: 0xa9b8c2, windowLightTop: 0xdce6ec,
} as const;

/** sRGB 十六进制 → HSV（h ∈ [0, 360)，s、v ∈ [0, 1]）。测试和暖色检查用。 */
export function hsv(hex: number): { h: number; s: number; v: number } {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max > 0 ? d / max : 0, v: max };
}

/** 「暖色」：色相在红—黄之间、有一定饱和度与亮度（附录 A-9 的检查口径）。 */
export function isWarm(hex: number): boolean {
  const { h, s, v } = hsv(hex);
  return (h < 70 || h >= 340) && s > 0.22 && v > 0.18;
}

/** 两个 sRGB 颜色按 t 混合。 */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** 按比例调亮度（k > 1 变亮，截到 255）。 */
export function shade(hex: number, k: number): number {
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c * k)));
  return (f((hex >> 16) & 255) << 16) | (f((hex >> 8) & 255) << 8) | f(hex & 255);
}

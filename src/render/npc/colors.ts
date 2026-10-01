// src/render/npc/colors.ts —— WP6 用到的色值（摘自 DESIGN.md §5.1 色板；WP3 的 palette.ts 是包内文件，不能 import）。
// 暖色只允许出现在规定位置：烟头 #D2553A、栏杆红灯 #B3322C 只在第三章（附录 A-9）。

export const C = {
  // 粉笔：白顶边（low）/ 细白线（bar）/ 描边
  chalkWhite: 0xe4e8e4,
  chalkLine: 0xc7d0d3,
  secondary: 0x8a979e,
  line: 0x3a464d,
  lowSteady: 0x50606a,
  // 人
  uniform: 0x2f4a6d,
  uniformStripe: 0xd9dee3,
  trousers: 0x2a3a52,
  skin: 0xc9b8a6,
  palmCallus: 0x9b8f82,
  hair: 0x1e2226,
  shoe: 0x2b3034,
  sole: 0xcfd4d6,
  bag: 0x3c4650,
  // 物件
  deskTop: 0xa8a294,
  deskLeg: 0x5b6468,
  steel: 0x9ba5a9,
  tile: 0xd5dbdc,
  grout: 0x9aa3a4,
  wall: 0xc9cfcf,
  wainscot: 0x5f7f7a,
  wainscotTop: 0x4c6763,
  concrete: 0x8d9493,
  terrazzoDark: 0x3e4546,
  terrazzoMid: 0x6b7270,
  terrazzoLight: 0xb7bdbb,
  asphalt: 0x1c2227,
  puddle: 0x22323b,
  paper: 0xe6e1d6,
  trackRed: 0x7a4b44,
  trackLine: 0xcfd3d2,
  grass: 0x5e6b5a,
  dreamFloor: 0xc9cfd2,
  dreamCrowd: 0x7e878b,
  voidSilhouette: 0x0a0c0e,
  dark: 0x2a3136,
  darker: 0x1c2227,
  // 限用暖色
  cigarette: 0xd2553a,
  barrierRed: 0xb3322c,
  // 特殊 NPC
  teacherSkirt: 0x3f4448,
  zhouJacket: 0x6c6f6e,
  maPants: 0x1e2226,
} as const;

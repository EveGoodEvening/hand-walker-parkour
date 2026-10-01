// src/render/palette.ts —— 色板（DESIGN.md §5.1，WP3）。全部是 sRGB 十六进制；写入顶点色时由 THREE.Color 转到线性空间。
// 冷色越多，偶尔出现的那点暖色越显得不对劲：暖色只允许出现在 WARM 列出的位置（附录 A-9）。

export const PAL = {
  // UI
  uiBg: 0x0d1216, uiText: 0xdfe6ea, uiDim: 0x8a979e, uiLine: 0x3a464d, coldAccent: 0x9fc3d6, lowSteady: 0x50606a,
  // 人物
  uniform: 0x2f4a6d, uniformStripe: 0xd9dee3, trousers: 0x2a3a52,
  skin: 0xc9b8a6, callus: 0x9b8f82, creaseGray: 0x8c8279, hair: 0x1e2226,
  shoeTop: 0x2b3034, shoeSole: 0xcfd4d6, bag: 0x3c4650,
  thirdHand: 0xe6ebee, shadow: 0x0b0f12,
  // 粉笔
  chalkLine: 0xc7d0d3, chalkText: 0xe4e8e4,
  // 水磨石：底 / 石子深 / 中 / 浅 / 白 / 暖 / 铜条
  terrazzo: 0x8d9493, stoneDark: 0x3e4546, stoneMid: 0x6b7270, stoneLight: 0xb7bdbb, stoneWhite: 0xd8dcda, stoneWarm: 0x9a8f82,
  brass: 0xa7adab,
  // 室内
  wall: 0xc9cfcf, wainscot: 0x5f7f7a, wainscotTop: 0x4c6763, ceiling: 0xb9c0c1, tube: 0xeef6ff,
  windowTop: 0xdce6ec, windowBottom: 0xa9b8c2,
  tile: 0xd5dbdc, grout: 0x9aa3a4,
  deskTop: 0xa8a294, deskLeg: 0x5b6468,
  blackboard: 0x2f3b37,
  steel: 0x9ba5a9,
  // 户外（WP4 用；列在这里保持色板唯一）
  asphaltNight: 0x1c2227, puddleTint: 0x22323b,
  dreamGround: 0xc9cfd2, dreamSky: 0xe4e8ea, dreamWater: 0x5d6b73, dreamCrowd: 0x7e878b,
  track: 0x7a4b44, trackLine: 0xcfd3d2, grass: 0x5e6b5a,
  infirmary: 0xdde4e6,
  voidFog: 0x07090b, voidFloor: 0x2a3136, voidSilhouette: 0x0a0c0e,
  note: 0xe6e1d6,
  // 镜中房间（暗）与玻璃
  mirrorDark: 0x1a2328, mirrorDarker: 0x121a1f, glass: 0x1a2a33,
} as const;

/**
 * 暖色（限用）：只允许出现在右列位置（§5.1、附录 A-9）。
 * windowLamp / braisedPork：只在 2-3（counter set）；streetGold / cigarette / barrierRed：只在第三章。
 */
export const WARM = {
  windowLamp: 0xb08d5e, braisedPork: 0x9c5f3e,
  streetGold: 0xc8a15a, cigarette: 0xd2553a, barrierRed: 0xb3322c,
} as const;

/** 校园场景里额外用到的冷灰（全部由上面的色板混出，集中在这里便于调色）。 */
export const SCHOOL = {
  // 门扇是走廊里最深的竖条（画面上的颜色；道具的暗色补偿后侧面约 #3F494C）
  doorLeaf: 0x354043, doorFrame: 0x6b7477, plate: 0xdfe6ea, plateText: 0x2a3136,
  radiator: 0x8a979e, pipe: 0x7c878c, baseboard: 0x3a464d, beam: 0xaeb5b6,
  locker: 0x7d8a90, lockerDark: 0x5f6b71, notice: 0x8f9a9c, paper: 0xdfe3e2,
  labBench: 0x2a3136, labBenchTop: 0x3a4246, stool: 0x6f7a7e,
  stall: 0x9fb0b5, stallDark: 0x7f9096, porcelain: 0xe6ebee,
  canteenTable: 0xb3b8b4, canteenStool: 0x7e8a8f, pillar: 0xbfc6c6,
  stair: 0x9aa09f, stairNose: 0x5b6468, rail: 0x3e4a50,
  concrete: 0x8f9594, peel: 0xa9afae,
} as const;

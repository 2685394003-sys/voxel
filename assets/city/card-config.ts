/**
 * 军需库卡牌配置 · 首版 12 张。
 *
 * 与 facility-config.ts 同一条纪律：纯数据 + 纯函数，零引擎 import。
 * 这份是数值的权威源；交付用的 xlsx 对照表由它导出，改数值只改这里。
 *
 * 首版选卡不是「从 30 张里砍前 12 张」，而是保证 Noita 组合语法的四条链路
 * 每条都有代表卡：修正堆叠 / 多重齐射 / 触发载荷 / 常驻被动。
 * 剩余 18 张候选等链路验收通过后再补。
 *
 * ⚠️ 首版 cost 全部为 0：让 12 张卡零成本试手感，方便先校手感再校经济。
 *    等「单局总军费 / 卡均价 / 预期购卡数」三个锚点拍板后统一放开价格。
 *    params 里的数值同样是占位值，待实机校准，不是定稿。
 */

/** 卡牌类型，对应 Noita 的 spell type（已砍掉材料/静态法术/工具三类）。 */
export type CardKind = 'projectile' | 'modifier' | 'multicast' | 'trigger' | 'passive';

/** 稀有度档位。价格放开后按倍率乘基数：1× / 2× / 4× / 8×。 */
export type CardRarity = 'common' | 'rare' | 'epic' | 'legendary';

export const RARITY_MULTIPLIER: Readonly<Record<CardRarity, number>> = {
  common: 1,
  rare: 2,
  epic: 4,
  legendary: 8,
};

export const CARD_KIND_LABEL: Readonly<Record<CardKind, string>> = {
  projectile: '弹体',
  modifier: '修正',
  multicast: '多重',
  trigger: '触发',
  passive: '被动',
};

export const CARD_RARITY_LABEL: Readonly<Record<CardRarity, string>> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

/**
 * 炮位装载槽数量（与 HUD 的槽位数同源，改这里就会同步改 HUD）。
 * 6 槽是为了装得下「修正 ×3 + 弹体 + 触发 ×2」这类长 combo。
 */
export const ARSENAL_SLOT_COUNT = 6;

export interface CardDef {
  /** 稳定英文键，写进存档/日志用，不要随中文名改动。 */
  readonly id: string;
  readonly name: string;
  /** Noita 原型法术名，仅作设计溯源，不参与运行时判定。 */
  readonly origin: string;
  readonly kind: CardKind;
  readonly rarity: CardRarity;
  /** 购买所需军费。首版一律 0。 */
  readonly cost: number;
  /** 策划语言的效果描述，不是实现细节。 */
  readonly effect: string;
  /** 可调参数（占位值，待实机校准）。 */
  readonly params: Readonly<Record<string, number>>;
  /** 建议搭配，纯备注，不参与判定。 */
  readonly combo: string;
}

/** 首版 12 张。顺序即配置表展示顺序，按类型分组。 */
export const ARSENAL_CARDS: readonly CardDef[] = [
  // ── 弹体：决定「打出去的是什么」────────────────────────────
  {
    id: 'solid_shell', name: '实心弹', origin: 'Spark Bolt',
    kind: 'projectile', rarity: 'common', cost: 0,
    effect: '基础直线弹，无特性。所有 combo 的地基。',
    params: { damage: 25, speed: 130 },
    combo: '加速 / 双联装 / 增伤装药',
  },
  {
    id: 'heavy_shell', name: '重炮榴弹', origin: 'Large Firebolt',
    kind: 'projectile', rarity: 'common', cost: 0,
    effect: '慢速高伤，命中带小范围溅射。',
    params: { damage: 55, speed: 85, splashRadius: 8 },
    combo: '爆炸弹头 / 燃烧挂链',
  },
  {
    id: 'ap_drill', name: '穿甲钻弹', origin: 'Luminous Drill',
    kind: 'projectile', rarity: 'rare', cost: 0,
    effect: '高速钻入建筑，对内部结构段持续造成伤害。',
    params: { damage: 18, speed: 180, segmentTicks: 3 },
    combo: '穿透 / 增伤装药',
  },
  {
    id: 'focused_beam', name: '集束激光', origin: 'Concentrated Light',
    kind: 'projectile', rarity: 'rare', cost: 0,
    effect: '瞬时射线，无飞行时间，瞄准即结算。',
    params: { damage: 40, range: 320 },
    combo: '战利品分成 / 穿透',
  },

  // ── 修正：抓取并作用于下一发弹，可连续堆叠 ─────────────────
  {
    id: 'damage_charge', name: '增伤装药', origin: 'Damage Plus',
    kind: 'modifier', rarity: 'common', cost: 0,
    effect: '下一发弹伤害 +N。连续堆叠时全部叠加到同一发。',
    params: { damagePlus: 10 },
    combo: '任意弹体 / 穿透',
  },
  {
    id: 'piercing', name: '穿透', origin: 'Piercing Shot',
    kind: 'modifier', rarity: 'epic', cost: 0,
    effect: '命中后弹体不消失，可继续贯穿 N 段结构。',
    params: { extraPierce: 2 },
    combo: '穿甲钻弹 / 增伤装药',
  },
  {
    id: 'explosive_warhead', name: '爆炸弹头', origin: 'Explosive Projectile',
    kind: 'modifier', rarity: 'rare', cost: 0,
    effect: '命中时附加 AOE 半径与溅射伤害。',
    params: { splashRadius: 12, splashDamage: 20 },
    combo: '双联装 / 命中引信',
  },
  {
    id: 'accelerator', name: '加速', origin: 'Speed Up',
    kind: 'modifier', rarity: 'common', cost: 0,
    effect: '下一发弹速度 +N，缩短飞行时间。',
    params: { speedPlus: 40 },
    combo: '实心弹 / 双联装',
  },
  {
    id: 'fire_trail', name: '燃烧挂链', origin: 'Fire Trail / Burning Trail',
    kind: 'modifier', rarity: 'rare', cost: 0,
    effect: '弹道残留火焰，点燃木质与油类结构，持续掉血。',
    params: { burnDps: 8, burnSeconds: 4 },
    combo: '重炮榴弹 / 油库殉爆',
  },

  // ── 多重：一次抓取 N 发同时施放 ───────────────────────────
  {
    id: 'dual_mount', name: '双联装', origin: 'Double Spell',
    kind: 'multicast', rarity: 'rare', cost: 0,
    effect: '一次装填发射 2 发，共享后续的修正效果。',
    params: { shots: 2 },
    combo: '爆炸弹头 / 实心弹',
  },

  // ── 触发：在落点开启一个隔离的「迷你法杖」─────────────────
  {
    id: 'impact_fuse', name: '命中引信', origin: 'Add Trigger / Spark Bolt with Trigger',
    kind: 'trigger', rarity: 'epic', cost: 0,
    effect: '命中时在落点再施放后续卡，载荷拥有独立 ShotState。',
    params: { payloadSlots: 2 },
    combo: '爆炸弹头 / 重炮榴弹',
  },

  // ── 被动：常驻，不占用施法队列 ────────────────────────────
  {
    id: 'war_dividend', name: '战利品分成', origin: 'Trick Greed / Gold is Forever',
    kind: 'passive', rarity: 'rare', cost: 0,
    effect: '常驻生效，摧毁设施获得的军费 +N%。',
    params: { rewardPct: 20 },
    combo: '集束激光 / 任意高射速组合',
  },
] as const;

/** 按 id 取卡。找不到返回 undefined，调用方自行决定降级还是报错。 */
export function findCard(id: string): CardDef | undefined {
  return ARSENAL_CARDS.find((card) => card.id === id);
}

/** 按类型筛卡，用于卡池分组与 HUD 分类展示。 */
export function cardsOfKind(kind: CardKind): readonly CardDef[] {
  return ARSENAL_CARDS.filter((card) => card.kind === kind);
}

/**
 * 价格放开后按稀有度算实际售价。
 * 当前基数 0 → 一律免费；把基数改成锚点价即可批量放开，不用逐张改 cost。
 */
export function cardPrice(card: CardDef, basePrice: number): number {
  return Math.round(basePrice * RARITY_MULTIPLIER[card.rarity]);
}

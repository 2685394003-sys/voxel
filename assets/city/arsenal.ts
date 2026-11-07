/**
 * 军需库抽卡状态机。
 *
 * 与 card-config.ts 的分工：那边是「卡有什么」，这边是「卡怎么流动」。
 * 放在 engine realm（而不是 HUD 里），因为买卡要扣军费、要跟 city.funds 联动——
 * 按本作"判定与表现分离"的硬约束，HUD 只负责显示和发点击消息。
 *
 * 三条规则来自 UI 简图（2026-11-07）：
 *   1. 抽卡池 4 格，买走后该格留空，**不自动补货**；
 *   2. 刷新重抽整池，且刷新本身要付军费；
 *   3. 已装载的卡不再出现在池中（避免买重）。
 *
 * 关于第 2 条的语义：这里实现为「重抽整池」而不是「只补空位」。
 * 只补空位会让玩家用「买空 → 等补」的方式免费定向摇卡，刷新费就失去意义。
 */

import { ARSENAL_CARDS, ARSENAL_SLOT_COUNT, type CardDef } from './card-config.ts';
import type { CityState } from './facility-config.ts';

/** 抽卡池格数。 */
export const POOL_SIZE = 4;

/**
 * 刷新一次的军费。首版 0：与卡价同步保持免费，先校手感再校经济。
 * 放开时改这一个数即可（全池共用同一价格，不随刷新次数递增）。
 */
export const REFRESH_COST = 0;

/** 出售回收比例。按原价的 50% 回收，向下取整（军费是整数，不出现小数）。 */
export const SELL_RATIO = 0.5;

/** 一张卡能卖多少钱。 */
export function sellValue(card: CardDef): number {
  return Math.floor(card.cost * SELL_RATIO);
}

/** 可注入的随机源：返回 [0, maxExclusive) 的整数。注入是为了测试可复现。 */
export type ArsenalRng = (maxExclusive: number) => number;

export interface ArsenalState {
  /** 6 个装载槽，null = 空。 */
  loadout: (CardDef | null)[];
  /** 4 个卡池格，null = 空（买走后留空，等刷新）。 */
  pool: (CardDef | null)[];
  /** 已购买过的卡 id，含已装载的。用于把牌从池中永久排除。 */
  owned: string[];
}

/** 一次操作的结果。失败时给原因，HUD 据此做提示，不静默吞掉。 */
export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ActionFailure };

export type ActionFailure =
  /** 抽卡池里那一格是空的。 */
  | 'empty-slot'
  /** 拖去填的那个装载槽已经有军需了。 */
  | 'slot-occupied'
  /** 点击购买时 6 个槽全满。 */
  | 'loadout-full'
  /** 没有可抽的卡了（12 张全部被买走）。 */
  | 'no-cards-left'
  | 'insufficient-funds'
  | 'invalid-slot'
  | 'empty-loadout-slot';

export function createArsenalState(): ArsenalState {
  return {
    loadout: Array.from({ length: ARSENAL_SLOT_COUNT }, () => null),
    pool: Array.from({ length: POOL_SIZE }, () => null),
    owned: [],
  };
}

/** 还能被抽到的卡：没买过的。 */
function availableCards(state: ArsenalState): CardDef[] {
  return ARSENAL_CARDS.filter((card) => !state.owned.includes(card.id));
}

/**
 * 重抽整个池子（刷新用，也用于开局发牌）。
 * 可抽卡不足 4 张时按实际数量放，剩下留空——不拿已购卡凑数。
 */
export function drawPool(state: ArsenalState, rng: ArsenalRng): void {
  const candidates = availableCards(state);
  const next: (CardDef | null)[] = Array.from({ length: POOL_SIZE }, () => null);
  for (let slot = 0; slot < POOL_SIZE && candidates.length > 0; slot += 1) {
    const pick = Math.min(candidates.length - 1, Math.max(0, rng(candidates.length)));
    next[slot] = candidates[pick] ?? null;
    candidates.splice(pick, 1);
  }
  state.pool = next;
}

/**
 * 买走池中的第 index 格。
 * 成功后：扣军费、卡进第一个空装载槽、池中该格留空、记入 owned。
 */
export function purchase(state: ArsenalState, index: number, city: CityState): ActionResult {
  const card = state.pool[index];
  if (card === undefined || card === null) return { ok: false, reason: 'empty-slot' };
  const slot = state.loadout.indexOf(null);
  if (slot < 0) return { ok: false, reason: 'loadout-full' };
  if (city.funds < card.cost) return { ok: false, reason: 'insufficient-funds' };

  city.funds -= card.cost;
  state.loadout[slot] = card;
  state.pool[index] = null;
  state.owned.push(card.id);
  return { ok: true };
}

/** 付费重抽整池。 */
export function refresh(state: ArsenalState, city: CityState, rng: ArsenalRng): ActionResult {
  if (city.funds < REFRESH_COST) return { ok: false, reason: 'insufficient-funds' };
  if (availableCards(state).length === 0) return { ok: false, reason: 'no-cards-left' };
  city.funds -= REFRESH_COST;
  drawPool(state, rng);
  return { ok: true };
}

function inLoadoutRange(state: ArsenalState, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < state.loadout.length;
}

/**
 * 拖拽购买：把池中第 poolIndex 格直接填进第 slotIndex 槽。
 *
 * 与 purchase() 的区别只在「填哪个槽」——purchase 自动找第一个空槽（点击购买），
 * 这里由玩家指定。目标槽已有军需时**不做交换**，直接失败：
 * 拖进来是"放入"，不是"替换"，替换会让玩家一不小心把宝贵组合换掉。
 */
export function purchaseToSlot(
  state: ArsenalState,
  poolIndex: number,
  slotIndex: number,
  city: CityState,
): ActionResult {
  const card = state.pool[poolIndex];
  if (card === undefined || card === null) return { ok: false, reason: 'empty-slot' };
  if (!inLoadoutRange(state, slotIndex)) return { ok: false, reason: 'invalid-slot' };
  if (state.loadout[slotIndex] !== null) return { ok: false, reason: 'slot-occupied' };
  if (city.funds < card.cost) return { ok: false, reason: 'insufficient-funds' };

  city.funds -= card.cost;
  state.loadout[slotIndex] = card;
  state.pool[poolIndex] = null;
  state.owned.push(card.id);
  return { ok: true };
}

/**
 * 槽内换位：交换两个槽的内容，等价于「改变触发顺序」。
 * 与空槽交换就是单纯移动。选交换而不是插入，是因为 6 个槽是固定格位，
 * 插入要级联后移、会连带改掉其他卡的位置，玩家更难预测。
 */
export function moveWithinLoadout(state: ArsenalState, from: number, to: number): ActionResult {
  if (!inLoadoutRange(state, from) || !inLoadoutRange(state, to)) {
    return { ok: false, reason: 'invalid-slot' };
  }
  if (from === to) return { ok: true };
  const source = state.loadout[from];
  if (source === null) return { ok: false, reason: 'empty-loadout-slot' };
  state.loadout[from] = state.loadout[to] ?? null;
  state.loadout[to] = source;
  return { ok: true };
}

/**
 * 出售：把第 slotIndex 槽的卡按 50% 原价回收，槽位清空。
 *
 * 卖掉的卡会**回到可抽池**（从 owned 移除），所以 12 张卡不会因为反复买卖而耗尽。
 * 因为有 50% 折价，卖回再刷新买回是纯亏损，不构成套利。
 */
export function sell(state: ArsenalState, slotIndex: number, city: CityState): ActionResult {
  if (!inLoadoutRange(state, slotIndex)) return { ok: false, reason: 'invalid-slot' };
  const card = state.loadout[slotIndex];
  if (card === null || card === undefined) return { ok: false, reason: 'empty-loadout-slot' };

  city.funds += sellValue(card);
  state.loadout[slotIndex] = null;
  state.owned = state.owned.filter((id) => id !== card.id);
  return { ok: true };
}

/** 已装载数量，HUD 显示与测试都用它，避免各处自己数。 */
export function loadoutCount(state: ArsenalState): number {
  return state.loadout.filter((card) => card !== null).length;
}

/**
 * 推给 HUD 的卡面数据。
 * 只带显示需要的字段——params 是判定用的，不该跨 port 传，也避免以后改参数时
 * 无意间把内部数值暴露到前端。
 */
export interface CardView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly rarity: string;
  readonly cost: number;
}

export function toCardView(card: CardDef | null): CardView | null {
  if (card === null) return null;
  return { id: card.id, name: card.name, kind: card.kind, rarity: card.rarity, cost: card.cost };
}


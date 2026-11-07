import { describe, expect, it } from 'vitest';
import { ARSENAL_CARDS, ARSENAL_SLOT_COUNT } from '../card-config.ts';
import {
  createArsenalState, drawPool, loadoutCount, POOL_SIZE, purchase, purchaseToSlot, REFRESH_COST,
  refresh, moveWithinLoadout, sell, sellValue, type ArsenalRng, type ArsenalState,
} from '../arsenal.ts';
import { createCityState } from '../facility-config.ts';

/** 顺序取牌，方便断言；不会随机跳。 */
const sequential: ArsenalRng = (max) => 0;
/** 取最后一张，用于验证洗牌确实换了位置。 */
const lastFirst: ArsenalRng = (max) => max - 1;

function ready(): { state: ArsenalState; city: ReturnType<typeof createCityState> } {
  const state = createArsenalState();
  drawPool(state, sequential);
  return { state, city: createCityState() };
}

describe('军需库抽卡状态机', () => {
  it('开局 6 空槽、4 空池', () => {
    const state = createArsenalState();
    expect(state.loadout).toHaveLength(ARSENAL_SLOT_COUNT);
    expect(state.pool).toHaveLength(POOL_SIZE);
    expect(loadoutCount(state)).toBe(0);
    expect(state.pool.every((card) => card === null)).toBe(true);
  });

  it('发牌后池中出现 4 张互不重复的卡', () => {
    const state = createArsenalState();
    drawPool(state, sequential);
    const ids = state.pool.filter((card) => card !== null).map((card) => card!.id);
    expect(ids).toHaveLength(POOL_SIZE);
    expect(new Set(ids).size).toBe(POOL_SIZE);
  });

  it('可抽卡不足 4 张时按实际数量放，不拿已购卡凑数', () => {
    const state = createArsenalState();
    // 买走 10 张，只剩 2 张可抽
    state.owned = ARSENAL_CARDS.slice(0, 10).map((card) => card.id);
    drawPool(state, sequential);
    const filled = state.pool.filter((card) => card !== null);
    expect(filled).toHaveLength(2);
    expect(filled.every((card) => !state.owned.includes(card!.id))).toBe(true);
  });

  it('买卡：扣军费、进装载槽、该格留空、记入已购', () => {
    const { state, city } = ready();
    const card = state.pool[0]!;
    city.funds = 500;
    const result = purchase(state, 0, city);
    expect(result.ok).toBe(true);
    expect(city.funds).toBe(500 - card.cost);
    expect(state.loadout[0]?.id).toBe(card.id);
    expect(state.pool[0]).toBeNull();
    expect(state.owned).toContain(card.id);
  });

  it('买走后不自动补货：池中留空直到刷新', () => {
    const { state, city } = ready();
    city.funds = 500;
    purchase(state, 0, city);
    expect(state.pool[0]).toBeNull();
    expect(state.pool.filter((card) => card !== null)).toHaveLength(POOL_SIZE - 1);
  });

  it('已装载的卡不会再出现在池中', () => {
    const { state, city } = ready();
    city.funds = 500;
    purchase(state, 0, city);
    refresh(state, city, sequential);
    const ids = state.pool.filter((card) => card !== null).map((card) => card!.id);
    expect(ids).not.toContain(state.loadout[0]!.id);
  });

  it('刷新重抽整池，不是只补空位', () => {
    const { state, city } = ready();
    city.funds = 500;
    purchase(state, 0, city);
    const before = state.pool.map((card) => card?.id ?? null);
    refresh(state, city, lastFirst);
    const after = state.pool.map((card) => card?.id ?? null);
    expect(after).not.toEqual(before);
    expect(after.filter((id) => id !== null)).toHaveLength(POOL_SIZE);
  });

  it('刷新扣刷新费', () => {
    const { state, city } = ready();
    city.funds = 300;
    refresh(state, city, sequential);
    expect(city.funds).toBe(300 - REFRESH_COST);
  });

  it('三种失败都给出原因，且不改状态', () => {
    const { state, city } = ready();
    city.funds = 0;

    // 空格购买：先手动挖空一格（发牌后 4 格是满的）
    state.pool[3] = null;
    expect(purchase(state, 3, city)).toEqual({ ok: false, reason: 'empty-slot' });

    // 填满 6 个槽
    for (let i = 0; i < ARSENAL_SLOT_COUNT; i += 1) state.loadout[i] = ARSENAL_CARDS[i]!;
    expect(purchase(state, 0, city)).toEqual({ ok: false, reason: 'loadout-full' });

    // 空出槽位但没钱（把某张卡标成高价位）
    state.loadout[0] = null;
    state.pool[0] = { ...ARSENAL_CARDS[0]!, cost: 999 };
    expect(purchase(state, 0, city)).toEqual({ ok: false, reason: 'insufficient-funds' });
    expect(state.pool[0]?.id).toBe(ARSENAL_CARDS[0]!.id);
  });

  it('卡抽光后刷新失败', () => {
    const { state, city } = ready();
    state.owned = ARSENAL_CARDS.map((card) => card.id);
    expect(refresh(state, city, sequential)).toEqual({ ok: false, reason: 'no-cards-left' });
  });
});

describe('拖拽：指定槽购买 / 槽内换位 / 出售', () => {
  it('拖入指定槽：买到那一个槽，不是第一个空槽', () => {
    const { state, city } = ready();
    city.funds = 500;
    const card = state.pool[0]!;
    expect(purchaseToSlot(state, 0, 4, city).ok).toBe(true);
    expect(state.loadout[4]?.id).toBe(card.id);
    expect(state.loadout[0]).toBeNull();
    expect(state.pool[0]).toBeNull();
    expect(state.owned).toContain(card.id);
  });

  it('拖入的目标槽已有军需 → slot-occupied，且什么都不改', () => {
    const { state, city } = ready();
    city.funds = 500;
    purchase(state, 0, city);
    const before = { funds: city.funds, pool: [...state.pool.map((c) => c?.id ?? null)], owned: [...state.owned] };
    expect(purchaseToSlot(state, 1, 0, city)).toEqual({ ok: false, reason: 'slot-occupied' });
    expect(city.funds).toBe(before.funds);
    expect(state.pool.map((c) => c?.id ?? null)).toEqual(before.pool);
    expect(state.owned).toEqual(before.owned);
  });

  it('拖到越界槽位 → invalid-slot', () => {
    const { state, city } = ready();
    city.funds = 500;
    expect(purchaseToSlot(state, 0, -1, city)).toEqual({ ok: false, reason: 'invalid-slot' });
    expect(purchaseToSlot(state, 0, ARSENAL_SLOT_COUNT, city)).toEqual({ ok: false, reason: 'invalid-slot' });
  });

  it('槽内换位：两张卡交换位置（= 改触发顺序）', () => {
    const { state, city } = ready();
    city.funds = 500;
    purchase(state, 0, city);
    purchase(state, 1, city);
    const first = state.loadout[0]!.id;
    const second = state.loadout[1]!.id;
    expect(moveWithinLoadout(state, 0, 1).ok).toBe(true);
    expect(state.loadout[0]?.id).toBe(second);
    expect(state.loadout[1]?.id).toBe(first);
  });

  it('槽内换位：拖到空槽等于移动，原槽清空', () => {
    const { state, city } = ready();
    city.funds = 500;
    purchase(state, 0, city);
    const card = state.loadout[0]!.id;
    expect(moveWithinLoadout(state, 0, 5).ok).toBe(true);
    expect(state.loadout[0]).toBeNull();
    expect(state.loadout[5]?.id).toBe(card);
  });

  it('槽内换位：源槽为空或越界都失败', () => {
    const { state } = ready();
    expect(moveWithinLoadout(state, 2, 3)).toEqual({ ok: false, reason: 'empty-loadout-slot' });
    expect(moveWithinLoadout(state, 0, 99)).toEqual({ ok: false, reason: 'invalid-slot' });
  });

  it('出售：回收 50%（向下取整），槽位清空', () => {
    const { state, city } = ready();
    state.loadout[0] = { ...ARSENAL_CARDS[0]!, cost: 150 };
    city.funds = 0;
    expect(sell(state, 0, city).ok).toBe(true);
    expect(city.funds).toBe(75);
    expect(state.loadout[0]).toBeNull();
  });

  it('出售后卡回到可抽池，能再次刷出来（12 张不会被买卖耗尽）', () => {
    const { state, city } = ready();
    city.funds = 500;
    purchase(state, 0, city);
    const sold = state.loadout[0]!.id;
    sell(state, 0, city);
    expect(state.owned).not.toContain(sold);
    refresh(state, city, sequential);
    // 顺序抽卡时一定能再抽到它（它已不在 owned 里）
    for (let i = 0; i < 6; i += 1) refresh(state, city, sequential);
    const seen = new Set(state.pool.map((c) => c?.id ?? null));
    refresh(state, city, sequential);
    state.pool.forEach((c) => { if (c !== null) seen.add(c.id); });
    expect(seen.has(sold)).toBe(true);
  });

  it('出售空槽失败', () => {
    const { state, city } = ready();
    expect(sell(state, 3, city)).toEqual({ ok: false, reason: 'empty-loadout-slot' });
    expect(sell(state, 99, city)).toEqual({ ok: false, reason: 'invalid-slot' });
  });

  it('sellValue 向下取整，不会出现小数军费', () => {
    expect(sellValue({ ...ARSENAL_CARDS[0]!, cost: 55 })).toBe(27);
    expect(sellValue({ ...ARSENAL_CARDS[0]!, cost: 0 })).toBe(0);
  });
});

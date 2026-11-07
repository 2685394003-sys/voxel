import { describe, expect, it } from 'vitest';
import {
  ARSENAL_CARDS, ARSENAL_SLOT_COUNT, CARD_KIND_LABEL, cardPrice, cardsOfKind, findCard,
} from '../card-config.ts';

describe('首版军需库卡表', () => {
  it('正好 12 张，且 id 不重复', () => {
    expect(ARSENAL_CARDS).toHaveLength(12);
    const ids = ARSENAL_CARDS.map((card) => card.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('首版全部免费：cost 一律为 0（放开价格前先改这条断言）', () => {
    for (const card of ARSENAL_CARDS) {
      expect(card.cost, `${card.name} 的 cost`).toBe(0);
    }
  });

  it('五条语法链路都有代表卡，没有空类', () => {
    for (const kind of Object.keys(CARD_KIND_LABEL)) {
      expect(cardsOfKind(kind as keyof typeof CARD_KIND_LABEL).length, `${kind} 类`).toBeGreaterThan(0);
    }
  });

  it('装载槽为 6，且能装下最长 combo（修正 + 弹体 + 触发）', () => {
    expect(ARSENAL_SLOT_COUNT).toBe(6);
    expect(ARSENAL_SLOT_COUNT).toBeGreaterThanOrEqual(4);
  });

  it('每张卡都有中文名、Noita 溯源、效果描述与参数', () => {
    for (const card of ARSENAL_CARDS) {
      expect(card.name.length).toBeGreaterThan(0);
      expect(card.origin.length).toBeGreaterThan(0);
      expect(card.effect.length).toBeGreaterThan(0);
      expect(Object.keys(card.params).length).toBeGreaterThan(0);
      for (const [key, value] of Object.entries(card.params)) {
        expect(Number.isFinite(value), `${card.name}.${key}`).toBe(true);
      }
    }
  });

  it('按 id 查找与按类型筛选一致', () => {
    const shell = findCard('solid_shell');
    expect(shell?.name).toBe('实心弹');
    expect(findCard('不存在')).toBeUndefined();
    expect(cardsOfKind('projectile')).toHaveLength(4);
    expect(cardsOfKind('modifier')).toHaveLength(5);
  });

  it('定价函数：基数 0 时全免费，基数 100 时按稀有度倍率', () => {
    expect(ARSENAL_CARDS.every((card) => cardPrice(card, 0) === 0)).toBe(true);
    expect(cardPrice(findCard('solid_shell')!, 100)).toBe(100);   // 普通 1×
    expect(cardPrice(findCard('ap_drill')!, 100)).toBe(200);      // 稀有 2×
    expect(cardPrice(findCard('piercing')!, 100)).toBe(400);       // 史诗 4×
  });
});

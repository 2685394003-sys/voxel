// 军需库验收探针：点击购买 / 拖拽购买 / 槽内换位 / 出售 / 槽满提示。
// Run: pnpm exec forgeax project play scripts/arsenal-probe.mjs --require-ui --json
const READ = 'voxel-warship.state';

const inHud = (fn, arg) => fn(arg);

const rectOf = (selector) => {
  const host = document.querySelector('[data-voxel-warship-hud]');
  const node = host?.shadowRoot?.querySelector(selector);
  if (node === null || node === undefined) return null;
  const r = node.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};

const toastState = () => {
  const host = document.querySelector('[data-voxel-warship-hud]');
  const node = host?.shadowRoot?.querySelector('[data-part="toast"]');
  if (node === null || node === undefined) return { text: null, shown: false };
  return { text: node.textContent, shown: node.classList.contains('toast-show') };
};

const clickPool = (index) => {
  const host = document.querySelector('[data-voxel-warship-hud]');
  const node = host?.shadowRoot?.querySelector(`[data-pool="${index}"][data-action="purchase"]`);
  if (node === null || node === undefined) return false;
  node.click();
  return true;
};

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function probe(play) {
  const dragTo = async (fromSelector, toSelector) => {
    const from = await play.page.evaluate(rectOf, fromSelector);
    const to = await play.page.evaluate(rectOf, toSelector);
    if (from === null || to === null) return { skipped: true, from, to };
    await play.page.mouse.move(from.x, from.y);
    await play.page.mouse.down();
    // 分 8 步移动：确保超过 6px 阈值，且拖拽过程中有连续的 pointermove
    for (let step = 1; step <= 8; step += 1) {
      await play.page.mouse.move(
        from.x + ((to.x - from.x) * step) / 8,
        from.y + ((to.y - from.y) * step) / 8,
      );
    }
    await play.page.mouse.up();
    await play.advance(0.25);
    return { from, to };
  };

  const start = await play.step('opening-deal', async () => {
    await play.advance(0.4);
    await play.screenshot('arsenal-01-opening');
    return play.state(READ);
  });

  // ── 规则 1：拖商店卡到指定槽 = 购买并填入该槽 ────────────────
  const dragBuy = await play.step('drag-pool-to-slot', async () => {
    const geometry = await dragTo('[data-pool="0"][data-action="purchase"]', '[data-slot="3"]');
    const state = await play.advance(0.2);
    await play.screenshot('arsenal-02-drag-to-slot');
    return { geometry, state };
  });

  // ── 规则 2：拖到已有军需的槽 = 失败 + 提示 ──────────────────
  const dragConflict = await play.step('drag-onto-occupied', async () => {
    const geometry = await dragTo('[data-pool="1"][data-action="purchase"]', '[data-slot="3"]');
    const state = await play.advance(0.2);
    const toast = await play.page.evaluate(toastState);
    await play.screenshot('arsenal-03-slot-occupied');
    return { geometry, state, toast };
  });

  // ── 规则 3：槽内拖动 = 换位（改触发顺序）────────────────────
  const dragMove = await play.step('drag-reorder', async () => {
    const geometry = await dragTo('[data-slot="3"]', '[data-slot="5"]');
    const state = await play.advance(0.2);
    await play.screenshot('arsenal-04-reordered');
    return { geometry, state };
  });

  // ── 规则 4：装载槽拖回商店 = 按 50% 出售 ────────────────────
  const dragSell = await play.step('drag-slot-to-shop-sell', async () => {
    const geometry = await dragTo('[data-slot="5"]', '.pool');
    const state = await play.advance(0.2);
    await play.screenshot('arsenal-05-sold');
    return { geometry, state };
  });

  // ── 规则 5：装满了还点购买 = 提示需求先出售 ─────────────────
  const fullToast = await play.step('fill-then-buy-when-full', async () => {
    for (let guard = 0; guard < 10; guard += 1) {
      const current = await play.state(READ);
      if (current.arsenal.loadoutCount >= 6) break;
      const index = current.arsenal.pool.findIndex((card) => card !== null);
      if (index >= 0) {
        await play.page.evaluate(clickPool, index);
      } else {
        await play.page.evaluate(() => {
          const host = document.querySelector('[data-voxel-warship-hud]');
          host?.shadowRoot?.querySelector('[data-action="refresh"]')?.click();
        });
      }
      await play.advance(0.2);
    }
    const beforeBuy = await play.state(READ);
    const poolIndex = beforeBuy.arsenal.pool.findIndex((card) => card !== null);
    if (poolIndex >= 0) await play.page.evaluate(clickPool, poolIndex);
    await play.advance(0.2);
    const state = await play.advance(0.1);
    const toast = await play.page.evaluate(toastState);
    await play.screenshot('arsenal-06-loadout-full');
    return { loadoutCount: state.arsenal.loadoutCount, toast, state };
  });

  const clickBuy = await play.step('click-buy-still-works', async () => {
    // 卖掉一张腾位，再点购买确认老路径没被拖拽破坏
    await dragTo('[data-slot="3"]', '.pool');
    await play.advance(0.2);
    const before = await play.state(READ);
    const poolIndex = before.arsenal.pool.findIndex((card) => card !== null);
    const clicked = poolIndex >= 0 ? await play.page.evaluate(clickPool, poolIndex) : false;
    const state = await play.advance(0.25);
    await play.screenshot('arsenal-07-click-buy');
    return { clicked, before: before.arsenal.loadoutCount, after: state.arsenal.loadoutCount, state };
  });

  return {
    opening: { pool: start.arsenal.pool, loadoutCount: start.arsenal.loadoutCount },
    dragBuy: {
      loadout: dragBuy.state.arsenal.loadout,
      pool: dragBuy.state.arsenal.pool,
      owned: dragBuy.state.arsenal.owned,
      funds: dragBuy.state.funds,
    },
    dragConflict: {
      loadout: dragConflict.state.arsenal.loadout,
      lastResult: dragConflict.state.arsenal.lastResult,
      toast: dragConflict.toast,
    },
    dragMove: {
      loadout: dragMove.state.arsenal.loadout,
      lastResult: dragMove.state.arsenal.lastResult,
    },
    dragSell: {
      loadout: dragSell.state.arsenal.loadout,
      owned: dragSell.state.arsenal.owned,
      funds: dragSell.state.funds,
      lastResult: dragSell.state.arsenal.lastResult,
    },
    fullToast: {
      loadoutCount: fullToast.loadoutCount,
      toast: fullToast.toast,
      lastResult: fullToast.state.arsenal.lastResult,
    },
    clickBuy: {
      clicked: clickBuy.clicked,
      loadoutBefore: clickBuy.before,
      loadoutAfter: clickBuy.after,
      lastResult: clickBuy.state.arsenal.lastResult,
    },
  };
}

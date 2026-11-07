// Run: pnpm exec forgeax project play scripts/playthrough.mjs --require-ui --json
//
// 这条脚本就是 M0 的验收口径。它不信任任何「看起来对」：
// 每一步都通过 `voxel-warship.state` 读投影断言真实状态，
// 并按需求清单各存一张命名截图（一个需求一张，便于逐条对照）。
//
// 需求覆盖：
//   R1 战舰能在黄浦江航道内航行
//   R2 鼠标指向能驱动炮塔转向
//   R3 开火能命中并摧毁设施
//   R4 摧毁后军费即时到账
//   R5 HUD 三要素在画面上（--require-ui 另外保证 UI 已挂载）

const READ = 'voxel-warship.state';

/** 求解「让瞄点落在 target」所需的屏幕坐标：三点测线性映射再反解。 */
async function solveScreenPoint(play, target) {
  // 诊断探针：统计浏览器是否真的把 pointermove 送到了页面。
  await play.page.evaluate(() => {
    globalThis.__hunt = { moves: 0, last: null };
    globalThis.addEventListener(
      'pointermove',
      (event) => {
        globalThis.__hunt.moves += 1;
        globalThis.__hunt.last = [event.clientX, event.clientY, event.pointerType];
      },
      true,
    );
  });
  const probe = async (x, y) => {
    await play.page.mouse.move(x, y);
    await play.advance(0.06);
    return (await play.state(READ)).aim;
  };
  const base = { x: 420, y: 430 };
  const step = 70;
  const a0 = await probe(base.x, base.y);
  const ax = await probe(base.x + step, base.y);
  const ay = await probe(base.x, base.y + step);

  const j11 = (ax.x - a0.x) / step;
  const j12 = (ay.x - a0.x) / step;
  const j21 = (ax.z - a0.z) / step;
  const j22 = (ay.z - a0.z) / step;
  const det = j11 * j22 - j12 * j21;
  if (Math.abs(det) < 1e-6) {
    const latest = await play.state(READ);
    const top = await play.page.evaluate(() => {
      const element = document.elementFromPoint(640, 360);
      const uiRoot = document.querySelector('#game-ui');
      const canvas = document.querySelector('canvas');
      const describe = (node) => node === null ? 'null' : `${node.tagName}${node.id ? '#' + node.id : ''}`;
      return {
        atCenter: describe(element),
        uiRoot: describe(uiRoot),
        canvas: describe(canvas),
        centerInsideUiRoot: uiRoot !== null && element !== null ? uiRoot.contains(element) : null,
        pointerMoves: globalThis.__hunt,
      };
    });
    throw new Error(
      `瞄准映射退化，无法反解屏幕坐标。采样 a0=${JSON.stringify(a0)} ax=${JSON.stringify(ax)} ` +
      `ay=${JSON.stringify(ay)} pointer=${JSON.stringify(latest.pointer)} ` +
      `viewport=${JSON.stringify(latest.viewport)} rayMisses=${latest.rayMisses} dom=${JSON.stringify(top)}`,
    );
  }

  const dx = target.x - a0.x;
  const dz = target.z - a0.z;
  return {
    x: Math.round(base.x + (j22 * dx - j12 * dz) / det),
    y: Math.round(base.y + (-j21 * dx + j11 * dz) / det),
  };
}

/** @param {import('@forgeax/engine/devkit').PlayContext} play */
export default async function playthrough(play) {
  // ── R1 航行 ───────────────────────────────────────────────
  const start = await play.step('spawn', async () => {
    await play.screenshot('01-spawn');
    return play.state(READ);
  });

  const sailed = await play.step('sail-north', async () => {
    await play.page.keyboard.down('KeyW');
    const state = await play.advance(52);
    await play.page.keyboard.up('KeyW');
    await play.screenshot('02-sailed-north');
    return state;
  });
  if (!(sailed.ship.z < start.ship.z - 200)) {
    throw new Error(`R1 失败：战舰未沿江航行（z ${start.ship.z} → ${sailed.ship.z}）`);
  }

  // ── R2 瞄准 ───────────────────────────────────────────────
  // 此时战舰应已北上到居民楼群（-95, -330）附近，向西瞄准即可打岸。
  const target = { x: -95, z: -330 };
  const aimed = await play.step('aim-at-bank', async () => {
    const point = await solveScreenPoint(play, target);
    await play.page.mouse.move(point.x, point.y);
    const state = await play.advance(0.6);
    await play.screenshot('03-aiming-west-bank');
    return state;
  });
  const aimError = Math.hypot(aimed.aim.x - target.x, aimed.aim.z - target.z);
  if (aimError > 25) {
    throw new Error(`R2 失败：瞄点未落到目标设施（偏差 ${aimError.toFixed(1)} m）`);
  }

  // ── R3 开火摧毁 + R4 军费到账 ─────────────────────────────
  const fired = await play.step('fire-until-destroyed', async () => {
    await play.page.mouse.down();
    const state = await play.advance(2.5);
    await play.page.mouse.up();
    return state;
  });
  await play.screenshot('04-after-fire');

  if (!(fired.destroyed >= 1)) {
    throw new Error(`R3 失败：未摧毁任何设施（destroyed=${fired.destroyed}）`);
  }
  if (!(fired.remaining < start.remaining)) {
    throw new Error(`R3 失败：剩余设施数未下降（${start.remaining} → ${fired.remaining}）`);
  }
  if (!(fired.funds >= 40)) {
    throw new Error(`R4 失败：军费未即时到账（funds=${fired.funds}）`);
  }

  // ── R5 HUD 与引擎一致 ─────────────────────────────────────
  // 屏幕上应当能读到同一个数字——顺带证明引擎到 UI 的推送链路是通的。
  const hudFunds = await play.page.evaluate(() => {
    const host = document.querySelector('[data-voxel-warship-hud]');
    const node = host?.shadowRoot?.querySelector('[data-part="funds"]');
    return node?.textContent?.trim() ?? null;
  });
  if (hudFunds === null || hudFunds === '') {
    throw new Error('R5 失败：HUD 军费节点不存在');
  }
  if (Number(hudFunds.replace(/[^0-9]/g, '')) !== fired.funds) {
    throw new Error(`R5 失败：HUD 显示 ${hudFunds} 与引擎 ${fired.funds} 不一致`);
  }

  return {
    sailedMeters: Math.round(start.ship.z - sailed.ship.z),
    aimErrorMeters: Number(aimError.toFixed(1)),
    destroyed: fired.destroyed,
    remaining: fired.remaining,
    funds: fired.funds,
    hudFunds,
  };
}

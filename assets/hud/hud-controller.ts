import type { GameHost } from '@forgeax/engine/app';
import { POOL_SIZE } from '../city/arsenal.ts';
import { ARSENAL_SLOT_COUNT } from '../city/card-config.ts';
import { HUD_CHANNEL } from '../city/pack-ids.ts';

/** 一张卡在 HUD 上需要的全部信息。字段与 arsenal.ts 的 CardView 一致。 */
interface CardView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly rarity: string;
  readonly cost: number;
}

/** 引擎推给 HUD 的状态快照。字段与 warship.ts 的推送保持一致。 */
interface HudState {
  readonly elapsed: number;
  readonly funds: number;
  readonly destroyed: number;
  readonly total: number;
  readonly loadout: readonly (CardView | null)[];
  readonly pool: readonly (CardView | null)[];
  readonly refreshCost: number;
  /** 最近一次操作结果。seq 变化即"有新事件"，HUD 据此弹一次提示。 */
  readonly lastResult: { readonly seq: number; readonly ok: boolean; readonly reason?: string } | null;
}

/**
 * 失败原因 → 玩家读得懂的话。
 * 判定本身在 arsenal.ts，这里只做措辞——两边不要重复实现规则。
 */
const FAILURE_TEXT: Readonly<Record<string, string>> = {
  'empty-slot': '这个卡位已经空了',
  'slot-occupied': '该槽位已有军需',
  'loadout-full': '军需已满，需先出售军需',
  'insufficient-funds': '军费不足',
  'no-cards-left': '没有可抽的军需了',
  'empty-loadout-slot': '该槽位没有军需',
  'invalid-slot': '无效的槽位',
};

/** 拖拽判定阈值（像素）。小于它按点击处理，避免手抖把买卡识别成拖动。 */
const DRAG_THRESHOLD = 6;

/** 秒 → mm:ss。超过 99 分钟也不截断，宁可显示 100:00 也不骗人。 */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * 军备装载池槽位数。数值来自 card-config 的 ARSENAL_SLOT_COUNT（单一数据源），
 * markup 与 aria 从这里派生，以后加/减槽不用去数 HTML 里写了几个 div。
 */
export const LOADOUT_SLOT_COUNT = ARSENAL_SLOT_COUNT;
const SLOT_LABELS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'] as const;

/**
 * 卡面配色：按「类型」着色，不按稀有度。
 * 理由是组合语法靠类型判断顺序（修正只抓下一发弹体、触发要放后面），
 * 玩家需要在扫一眼的瞬间知道这张卡能不能接在自己卡组后面；稀有度只是价值参考，
 * 所以它降级成一个圆点。五类颜色各自独立，色觉障碍也能靠类型文字读出来。
 */
const KIND_COLOR: Readonly<Record<string, string>> = {
  projectile: '#4fc3f7',
  modifier: '#ffb74d',
  multicast: '#ba68c8',
  trigger: '#ff7a6b',
  passive: '#81c784',
};
const KIND_TEXT: Readonly<Record<string, string>> = {
  projectile: '弹体',
  modifier: '修正',
  multicast: '多重',
  trigger: '触发',
  passive: '被动',
};
const RARITY_COLOR: Readonly<Record<string, string>> = {
  common: '#8a94a0',
  rare: '#4fc3f7',
  epic: '#ba68c8',
  legendary: '#ffd54f',
};
const RARITY_TEXT: Readonly<Record<string, string>> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
};

const emptySlotMarkup = Array.from({ length: LOADOUT_SLOT_COUNT }, (_, index) =>
  `<div class="slot" role="listitem" aria-label="空槽位 ${index + 1}" data-slot="${index}">${
    SLOT_LABELS[index] ?? index + 1
  }</div>`,
).join('\n        ');

const emptyPoolMarkup = Array.from({ length: POOL_SIZE }, (_, index) =>
  `<div class="card card-empty" role="listitem" data-pool="${index}" aria-label="空卡位">—</div>`,
).join('\n      ');

const HUD_STYLE = `
:host { all: initial; }
.hud {
  position: absolute; inset: 0; pointer-events: none;
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: #e8f2f8; text-shadow: 0 1px 3px rgba(0,0,0,0.75);
  user-select: none; -webkit-user-select: none;
}
.timer {
  position: absolute; top: 16px; right: 18px;
  display: flex; align-items: baseline; gap: 8px;
  padding: 6px 14px; border-radius: 999px;
  border: 1px solid rgba(127,211,255,0.32);
  background: rgba(8,16,24,0.62);
}
.timer-label { font-size: 12px; letter-spacing: 0.14em; opacity: 0.72; }
.timer-value {
  font-family: Consolas, "SFMono-Regular", monospace; font-size: 22px;
  font-variant-numeric: tabular-nums; letter-spacing: 0.04em; color: #bfe9ff;
}
.destroyed {
  position: absolute; top: 58px; right: 18px;
  font-size: 12px; letter-spacing: 0.08em; opacity: 0.68;
}
.destroyed strong {
  font-family: Consolas, monospace; font-variant-numeric: tabular-nums; color: #ffd08a;
}

/* 底部三层：装载槽 / 刷新 / 抽卡池 */
.bottom {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  /* 底部多留 26px：dev shell 会在左下角压一行 FPS 读数，挨太近两个数字会叠在一起。 */
  padding: 0 18px 26px;
}
.row-main {
  /* 军费贴左、提示贴右，装载槽用 auto margin 吃中间——三者中轴与下方卡池对齐。
     用绝对定位而不是 flex gap，是因为左右两块宽度不等，flex 居中会把槽推偏。 */
  position: relative; display: flex; align-items: flex-end; width: 100%; min-height: 62px;
}
.funds {
  position: absolute; left: 0; bottom: 0;
  display: flex; flex-direction: column; gap: 2px; min-width: 132px;
  padding: 8px 16px; border-left: 3px solid #ffc766;
  background: linear-gradient(90deg, rgba(8,16,24,0.72), rgba(8,16,24,0));
}
.funds-label { font-size: 11px; letter-spacing: 0.2em; opacity: 0.7; }
.funds-value {
  font-family: Consolas, "SFMono-Regular", monospace; font-size: 30px;
  font-variant-numeric: tabular-nums; line-height: 1.05; color: #ffd08a;
}
/* 装载槽容器不接收指针事件：它横跨画面中下方，一旦 auto 就会把瞄准射线一起挡住。
   只有"有卡的槽"需要接管事件（它能被拖动），空槽保持穿透，别让 HUD 变成遮光板。 */
.loadout { display: flex; gap: 10px; min-width: 0; margin: 0 auto; }
.slot {
  /* 76px 而不是 62px：卡名最长「战利品分成」5 字，62px 会被挤成两行。 */
  flex: 0 1 76px; min-width: 40px; box-sizing: border-box;
  position: relative; display: flex; align-items: center; justify-content: center;
  width: 76px; height: 62px; border-radius: 8px; overflow: hidden;
  /* 0.72 而不是更透：槽位横跨江面和陆地，太透会让底色差把后几格读成"未解锁"。 */
  border: 1px solid rgba(127,211,255,0.28); background: rgba(8,16,24,0.72);
  font-family: Consolas, monospace; font-size: 12px; letter-spacing: 0.1em; opacity: 0.5;
}
/* 已装载：左侧一道类型色条 + 卡名，比空槽亮，但不再发光以免抢画面。
   只有这一种槽接收指针事件——它是唯一能被拖动的对象。 */
.slot-filled {
  opacity: 1; pointer-events: auto; cursor: grab;
  border-color: rgba(127,211,255,0.5); background: rgba(10,22,32,0.82);
}
.slot-filled:active { cursor: grabbing; }
.slot-kind { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
.slot-name {
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  font-size: 11px; letter-spacing: 0; white-space: nowrap;
  text-align: center; line-height: 1.2; padding: 0 6px;
}
.hint {
  position: absolute; right: 0; bottom: 0; padding-bottom: 6px;
  font-size: 12px; letter-spacing: 0.06em; opacity: 0.55; text-align: right;
}
.refresh {
  pointer-events: auto; cursor: pointer;
  display: flex; align-items: baseline; gap: 8px;
  padding: 5px 20px; border-radius: 6px;
  border: 1px solid rgba(129,199,132,0.45); background: rgba(10,26,18,0.72);
  font-family: inherit; font-size: 14px; letter-spacing: 0.12em; color: #9be3a0;
}
.refresh:hover { border-color: rgba(129,199,132,0.9); background: rgba(16,42,28,0.88); }
.refresh:active { transform: translateY(1px); }
.refresh-cost {
  font-family: Consolas, monospace; font-variant-numeric: tabular-nums;
  font-size: 13px; color: #ffd08a; opacity: 0.9;
}
.pool { display: flex; gap: 10px; pointer-events: auto; }
.card {
  pointer-events: auto; cursor: pointer; box-sizing: border-box;
  position: relative; display: flex; flex-direction: column;
  width: 132px; height: 92px; padding: 7px 9px 6px;
  border-radius: 8px; border: 1px solid rgba(127,211,255,0.3);
  background: rgba(10,20,30,0.86);
}
.card:hover { border-color: rgba(127,211,255,0.75); background: rgba(16,30,44,0.94); transform: translateY(-2px); }
.card:active { transform: translateY(0); }
/* 买不起：整卡压暗、价格变红，但仍然可见（玩家要能看见自己想要什么） */
.card-locked { cursor: not-allowed; opacity: 0.5; }
.card-locked .card-cost { color: #ff8b7a; }
.card-empty {
  pointer-events: none; cursor: default; align-items: center; justify-content: center;
  border-style: dashed; border-color: rgba(127,211,255,0.16); background: rgba(10,20,30,0.42);
  color: rgba(200,225,240,0.35); font-size: 16px;
}
.card-empty:hover { transform: none; border-color: rgba(127,211,255,0.16); background: rgba(10,20,30,0.42); }
.card-top { display: flex; align-items: center; justify-content: space-between; }
.card-kind { font-size: 11px; letter-spacing: 0.14em; }
.card-rarity { width: 7px; height: 7px; border-radius: 50%; }
.card-name {
  flex: 1; display: flex; align-items: center;
  font-size: 16px; font-weight: 500; letter-spacing: 0.04em; color: #eef6fc;
}
.card-cost {
  align-self: flex-end; font-family: Consolas, monospace;
  font-variant-numeric: tabular-nums; font-size: 13px; color: #ffd08a;
}
.card-cost::before { content: "军费 "; font-family: inherit; font-size: 10px; opacity: 0.55; }

/* ── 拖拽反馈 ─────────────────────────────────────────────── */
/* 源元素压暗，让人看清"这张卡正在被我搬动" */
.dragging { opacity: 0.3; }
/* 跟随鼠标的幽灵卡。pointer-events: none 保证落点判定不会被它自己挡住 */
.ghost {
  position: fixed; left: 0; top: 0; z-index: 999; pointer-events: none;
  box-sizing: border-box; width: 132px; height: 92px; padding: 7px 9px 6px;
  display: flex; flex-direction: column; border-radius: 8px;
  border: 1px solid rgba(127,211,255,0.7); background: rgba(12,26,38,0.94);
  box-shadow: 0 6px 18px rgba(0,0,0,0.45); transform: translate(-50%, -50%);
  font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: #e8f2f8;
}
/* 可放 / 不可放。绿色只表示"买得起"，紫色表示"换位"，都不抢主界面 */
.drop-ok { border-color: rgba(110,231,255,0.95) !important; box-shadow: inset 0 0 0 1px rgba(110,231,255,0.55); }
.drop-bad { border-color: rgba(255,139,122,0.9) !important; box-shadow: inset 0 0 0 1px rgba(255,139,122,0.45); }

/* ── 提示条 ───────────────────────────────────────────────── */
.toast {
  position: absolute; left: 50%; top: 84px;
  padding: 7px 18px; border-radius: 6px;
  border: 1px solid rgba(255,139,122,0.5); background: rgba(28,14,12,0.88);
  font-size: 13px; letter-spacing: 0.06em; color: #ffcdc4; white-space: nowrap;
  opacity: 0; transform: translateX(-50%) translateY(-6px);
  transition: opacity 160ms ease, transform 160ms ease;
}
.toast-show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (max-height: 640px) {
  .timer { top: 10px; padding: 4px 12px; }
  .timer-value { font-size: 18px; }
  .destroyed { top: 46px; }
  .bottom { padding-bottom: 20px; gap: 6px; }
  .row-main { min-height: 52px; }
  .slot { width: 64px; height: 52px; }
  .slot-name { font-size: 10px; }
  .funds-value { font-size: 24px; }
  .card { width: 116px; height: 78px; padding: 5px 7px 4px; }
  .card-name { font-size: 14px; }
  .refresh { padding: 3px 14px; font-size: 12px; }
  .hint { display: none; }
}
@media (max-width: 900px) {
  /* 6 槽 + 4 卡在 900px 以下收紧，优先保住可读性，提示文字让位。 */
  .bottom { gap: 6px; padding-left: 10px; padding-right: 10px; }
  .row-main { min-height: 46px; }
  .loadout { gap: 6px; }
  .slot { width: 58px; height: 46px; }
  .slot-name { font-size: 10px; white-space: normal; word-break: break-all; }
  .pool { gap: 6px; }
  .card { width: 104px; height: 76px; }
  .hint { display: none; }
}
`;

const HUD_MARKUP = `
<div class="hud" role="group" aria-label="战斗界面">
  <div class="timer" role="timer">
    <span class="timer-label">计时</span>
    <strong class="timer-value" data-part="timer">00:00</strong>
  </div>
  <div class="destroyed">已摧毁 <strong data-part="destroyed">0/13</strong></div>
  <div class="toast" role="status" aria-live="polite" data-part="toast"></div>

  <div class="bottom">
    <div class="row-main">
      <div class="funds">
        <span class="funds-label">军费</span>
        <strong class="funds-value" data-part="funds">0</strong>
      </div>
      <div class="loadout" role="list" aria-label="军备装载池">
        ${emptySlotMarkup}
      </div>
      <div class="hint">WASD 航行 · 鼠标瞄准 · 左键开火</div>
    </div>

    <button class="refresh" type="button" data-action="refresh" aria-label="刷新抽卡池">
      <span>刷新</span>
      <span class="refresh-cost" data-part="refresh-cost">0</span>
    </button>

    <div class="pool" role="list" aria-label="军需库抽卡池">
      ${emptyPoolMarkup}
    </div>
  </div>
</div>
`;

/** HUD 的持有句柄。dispose 之后不再监听任何消息、也不再发意图。 */
export interface HudHandle {
  dispose(): void;
}

/**
 * 在前端领域挂载 HUD 并订阅引擎状态。
 *
 * 这里刻意不走 UI 资源导入管线：HUD 是纯展示 + 两个按钮，直接建 DOM 更简单，
 * 也避免为一个展示层引入编译期资源身份。引擎侧只发数据，不认识任何节点。
 *
 * 分工边界：HUD 不持有军费、不算价格、不判断能不能买——它只把点击变成
 * `{kind:'action'}` 意图发给引擎，能不能成交由 arsenal.ts 说了算。
 */
export function createHudUi(
  host: Pick<GameHost, 'uiRoot' | 'port' | 'presentationPort'>,
): HudHandle {
  const root = host.uiRoot;
  if (root === undefined) throw new Error('HUD 需要 GameHost.uiRoot（前端领域）');

  const owner = root.ownerDocument;
  const hostElement = owner.createElement('div');
  hostElement.setAttribute('data-voxel-warship-hud', '');
  const shadow = hostElement.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${HUD_STYLE}</style>${HUD_MARKUP}`;
  root.appendChild(hostElement);

  const timer = shadow.querySelector<HTMLElement>('[data-part="timer"]');
  const funds = shadow.querySelector<HTMLElement>('[data-part="funds"]');
  const destroyed = shadow.querySelector<HTMLElement>('[data-part="destroyed"]');
  const refreshCost = shadow.querySelector<HTMLElement>('[data-part="refresh-cost"]');
  const loadoutRow = shadow.querySelector<HTMLElement>('.loadout');
  const poolRow = shadow.querySelector<HTMLElement>('.pool');
  const toastEl = shadow.querySelector<HTMLElement>('[data-part="toast"]');

  const port = host.presentationPort ?? host.port;
  const view = owner.defaultView ?? window;
  let disposed = false;
  // 只在内容真的变了才重建 DOM：10 Hz 推送下每帧重写会让 hover 一直闪。
  let loadoutSignature = '';
  let poolSignature = '';
  /** 最近一次收到的状态。拖拽开始时要靠它查"我拖的是哪张卡"。 */
  let lastState: HudState | null = null;
  /** 已提示过的 lastResult.seq，防止同一个失败重复弹条。 */
  let shownResultSeq = -1;

  const cardMarkup = (card: CardView, index: number, fundsNow: number): string => {
    const locked = fundsNow < card.cost;
    const kindColor = KIND_COLOR[card.kind] ?? '#8a94a0';
    const rarityColor = RARITY_COLOR[card.rarity] ?? '#8a94a0';
    const rarityText = RARITY_TEXT[card.rarity] ?? card.rarity;
    return `<div class="card${locked ? ' card-locked' : ''}" role="listitem" data-action="purchase"
      data-index="${index}" data-pool="${index}"
      aria-label="${card.name}，${KIND_TEXT[card.kind] ?? card.kind}，${rarityText}，军费 ${card.cost}">
      <div class="card-top">
        <span class="card-kind" style="color:${kindColor}">${KIND_TEXT[card.kind] ?? card.kind}</span>
        <span class="card-rarity" style="background:${rarityColor}" title="${rarityText}"></span>
      </div>
      <div class="card-name">${card.name}</div>
      <div class="card-cost">${card.cost}</div>
    </div>`;
  };

  const slotMarkup = (card: CardView | null, index: number): string => {
    if (card === null) {
      return `<div class="slot" role="listitem" aria-label="空槽位 ${index + 1}" data-slot="${index}">${
        SLOT_LABELS[index] ?? index + 1
      }</div>`;
    }
    const kindColor = KIND_COLOR[card.kind] ?? '#8a94a0';
    const kindText = KIND_TEXT[card.kind] ?? card.kind;
    return `<div class="slot slot-filled" role="listitem" data-slot="${index}"
      title="${card.name} · ${kindText}" aria-label="已装载：${card.name}"><span class="slot-kind" style="background:${kindColor}"></span
      ><span class="slot-name">${card.name}</span></div>`;
  };

  const render = (state: HudState) => {
    if (loadoutRow !== null) {
      const signature = state.loadout.map((card) => card?.id ?? '-').join(',');
      if (signature !== loadoutSignature) {
        loadoutSignature = signature;
        loadoutRow.innerHTML = state.loadout.map((card, index) => slotMarkup(card, index)).join('\n        ');
      }
    }
    if (poolRow !== null) {
      // 军费也进签名：钱一变，买不起的卡要立刻解禁。
      const signature = `${state.pool.map((card) => card?.id ?? '-').join(',')}|${state.funds}`;
      if (signature !== poolSignature) {
        poolSignature = signature;
        poolRow.innerHTML = state.pool
          .map((card, index) => (card === null
            ? `<div class="card card-empty" role="listitem" data-pool="${index}" aria-label="空卡位">—</div>`
            : cardMarkup(card, index, state.funds)))
          .join('\n      ');
      }
    }
    if (refreshCost !== null) refreshCost.textContent = String(state.refreshCost);
  };

  /** 顶部提示条。只报失败，成功用画面本身说话（卡进槽、军费跳动）。 */
  let toastTimer = 0;
  const showToast = (text: string) => {
    if (toastEl === null) return;
    toastEl.textContent = text;
    toastEl.classList.add('toast-show');
    view.clearTimeout(toastTimer);
    toastTimer = view.setTimeout(() => toastEl.classList.remove('toast-show'), 2000);
  };

  const receive = (event: MessageEvent) => {
    const data = event.data as { channel?: unknown; kind?: unknown; state?: HudState } | undefined;
    if (data === undefined || data.channel !== HUD_CHANNEL || data.kind !== 'state') return;
    const state = data.state;
    if (state === undefined) return;
    lastState = state;
    if (timer !== null) timer.textContent = formatClock(state.elapsed);
    if (funds !== null) funds.textContent = state.funds.toLocaleString('zh-CN');
    if (destroyed !== null) destroyed.textContent = `${state.destroyed}/${state.total}`;
    render(state);

    // 引擎推来的操作结果：seq 变了才算新事件，失败就弹一次原因。
    const result = state.lastResult;
    if (result !== null && result.seq !== shownResultSeq) {
      shownResultSeq = result.seq;
      if (!result.ok) {
        showToast(FAILURE_TEXT[result.reason ?? ''] ?? '操作失败');
      }
    }
  };

  const send = (payload: Record<string, unknown>) => {
    if (disposed) return;
    port?.postMessage({ channel: HUD_CHANNEL, kind: 'action', ...payload });
  };

  // ── 拖拽 ────────────────────────────────────────────────────
  // 自实现而非 HTML5 DnD：pointer 事件序列能被验收脚本精确复现，
  // 而且幽灵卡、落点高亮都可控。阈值之内的按下仍然当点击处理。
  interface DragSession {
    readonly source: 'pool' | 'loadout';
    readonly index: number;
    readonly card: CardView;
    readonly startX: number;
    readonly startY: number;
    active: boolean;
  }
  let drag: DragSession | null = null;
  let ghostEl: HTMLElement | null = null;
  let highlighted: HTMLElement | null = null;
  /**
   * 拖拽松手时，浏览器可能给拖拽源补发一次 click。
   * 只吃掉"落在同一个源元素上"的那一次——用 key 精确匹配，而不是一个布尔标志：
   * 布尔标志一旦没被消费掉，会把玩家下一次真实点击也吞了（实测踩过）。
   */
  let suppressClickKey: string | null = null;

  const inRect = (rect: DOMRect, x: number, y: number) =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

  /** 落点判定：先看装载槽，再看具体卡位，最后看整块商店区域。 */
  const hitTest = (x: number, y: number):
    | { type: 'slot'; index: number }
    | { type: 'pool'; index: number }
    | { type: 'pool-area' }
    | { type: 'none' } => {
    for (const node of shadow.querySelectorAll<HTMLElement>('[data-slot]')) {
      const index = Number(node.dataset['slot']);
      if (inRect(node.getBoundingClientRect(), x, y)) return { type: 'slot', index };
    }
    for (const node of shadow.querySelectorAll<HTMLElement>('[data-pool]')) {
      const index = Number(node.dataset['pool']);
      if (inRect(node.getBoundingClientRect(), x, y)) return { type: 'pool', index };
    }
    if (poolRow !== null && inRect(poolRow.getBoundingClientRect(), x, y)) return { type: 'pool-area' };
    return { type: 'none' };
  };

  /** 这次拖拽放在该落点是否合法——只用于高亮，真正的判定在引擎。 */
  const dropAllowed = (session: DragSession, hit: ReturnType<typeof hitTest>): boolean => {
    if (hit.type === 'slot') {
      if (session.source === 'pool') {
        const slotCard = lastState?.loadout[hit.index] ?? null;
        return slotCard === null;
      }
      return true; // 槽内换位总是允许（含与空槽交换）
    }
    if (hit.type === 'pool' || hit.type === 'pool-area') return session.source === 'loadout';
    return false;
  };

  const clearHighlight = () => {
    if (highlighted !== null) {
      highlighted.classList.remove('drop-ok', 'drop-bad');
      highlighted = null;
    }
  };

  const startGhost = (card: CardView) => {
    ghostEl = owner.createElement('div');
    ghostEl.className = 'ghost';
    const kindColor = KIND_COLOR[card.kind] ?? '#8a94a0';
    ghostEl.innerHTML = `
      <div class="card-top">
        <span class="card-kind" style="color:${kindColor}">${KIND_TEXT[card.kind] ?? card.kind}</span>
        <span class="card-rarity" style="background:${RARITY_COLOR[card.rarity] ?? '#8a94a0'}"></span>
      </div>
      <div class="card-name">${card.name}</div>
      <div class="card-cost">${card.cost}</div>`;
    shadow.appendChild(ghostEl);
  };

  const endGhost = () => {
    ghostEl?.remove();
    ghostEl = null;
    clearHighlight();
  };

  const setSourceDimmed = (session: DragSession, dim: boolean) => {
    const selector = session.source === 'pool'
      ? `[data-pool="${session.index}"][data-action="purchase"]`
      : `[data-slot="${session.index}"]`;
    shadow.querySelector<HTMLElement>(selector)?.classList.toggle('dragging', dim);
  };

  const onPointerDown = (event: PointerEvent) => {
    const origin = event.composedPath()[0];
    if (!(origin instanceof HTMLElement)) return;
    const actionEl = origin.closest<HTMLElement>('[data-action]');
    const slotEl = origin.closest<HTMLElement>('[data-slot]');
    const poolSlotEl = origin.closest<HTMLElement>('[data-pool]');
    if (actionEl === null && slotEl === null && poolSlotEl === null) return;
    // 拦下这一下，别让它漏给引擎当成开火。
    event.stopPropagation();
    event.preventDefault();
    if (disposed) return;

    const poolCard = origin.closest<HTMLElement>('[data-action="purchase"]');
    if (poolCard !== null) {
      const index = Number(poolCard.dataset['index']);
      const card = lastState?.pool[index] ?? null;
      if (card !== null && Number.isInteger(index)) {
        drag = { source: 'pool', index, card, startX: event.clientX, startY: event.clientY, active: false };
      }
      return;
    }
    if (slotEl !== null) {
      const index = Number(slotEl.dataset['slot']);
      const card = lastState?.loadout[index] ?? null;
      if (card !== null) {
        drag = { source: 'loadout', index, card, startX: event.clientX, startY: event.clientY, active: false };
      }
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (drag === null) return;
    if (!drag.active) {
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (moved < DRAG_THRESHOLD) return;
      drag.active = true;
      setSourceDimmed(drag, true);
      startGhost(drag.card);
    }
    if (ghostEl !== null) {
      ghostEl.style.left = `${event.clientX}px`;
      ghostEl.style.top = `${event.clientY}px`;
    }
    const hit = hitTest(event.clientX, event.clientY);
    const target = hit.type === 'slot'
      ? shadow.querySelector<HTMLElement>(`[data-slot="${hit.index}"]`)
      : hit.type === 'pool'
        ? shadow.querySelector<HTMLElement>(`[data-pool="${hit.index}"]`)
        : hit.type === 'pool-area' ? poolRow : null;
    if (target !== highlighted) {
      clearHighlight();
      if (target !== null) {
        target.classList.add(dropAllowed(drag, hit) ? 'drop-ok' : 'drop-bad');
        highlighted = target;
      }
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (drag === null) return;
    const session = drag;
    drag = null;
    setSourceDimmed(session, false);
    if (!session.active) {
      endGhost();
      return; // 没超过阈值 → 交给 click 走"点击购买"
    }
    suppressClickKey = `${session.source}:${session.index}`;
    const hit = hitTest(event.clientX, event.clientY);
    endGhost();

    if (hit.type === 'slot') {
      if (session.source === 'pool') {
        send({ action: 'purchase-to-slot', poolIndex: session.index, slotIndex: hit.index });
      } else {
        send({ action: 'move-slot', from: session.index, to: hit.index });
      }
      return;
    }
    if (hit.type === 'pool' || hit.type === 'pool-area') {
      if (session.source === 'loadout') send({ action: 'sell', index: session.index });
    }
    // 落在别处 = 取消，不发消息
  };

  /** 把点击翻译成意图。拖拽刚结束的那一下要被吃掉。 */
  const onClick = (event: MouseEvent) => {
    // 监听挂在 host 上（ShadowRoot 的 addEventListener 没有 click 重载），
    // 事件从 shadow 内部冒泡上来后 event.target 会被重定向成 host，
    // 真实被点的元素要从 composedPath 的第一个取。
    const origin = event.composedPath()[0];
    const actionEl = origin instanceof HTMLElement ? origin.closest<HTMLElement>('[data-action]') : null;
    if (actionEl === null) return;
    event.stopPropagation();
    event.preventDefault();
    if (disposed) return;
    // 只有"落在拖拽源本身"的补发 click 才丢弃，其他照常处理。
    const key = actionEl.dataset['action'] === 'purchase'
      ? `pool:${actionEl.dataset['index']}`
      : actionEl.dataset['slot'] !== undefined
        ? `loadout:${actionEl.dataset['slot']}`
        : null;
    if (key !== null && key === suppressClickKey) {
      suppressClickKey = null;
      return;
    }
    const action = actionEl.dataset['action'];
    if (action === 'refresh') {
      send({ action: 'refresh' });
      return;
    }
    if (action === 'purchase') {
      const index = Number(actionEl.dataset['index']);
      if (Number.isInteger(index) && index >= 0) send({ action: 'purchase', index });
    }
  };

  hostElement.addEventListener('pointerdown', onPointerDown, true);
  hostElement.addEventListener('click', onClick);
  view.addEventListener('pointermove', onPointerMove);
  view.addEventListener('pointerup', onPointerUp);
  view.addEventListener('pointercancel', onPointerUp);
  port?.addEventListener('message', receive);
  port?.start();

  return {
    dispose() {
      disposed = true;
      hostElement.removeEventListener('pointerdown', onPointerDown, true);
      hostElement.removeEventListener('click', onClick);
      view.removeEventListener('pointermove', onPointerMove);
      view.removeEventListener('pointerup', onPointerUp);
      view.removeEventListener('pointercancel', onPointerUp);
      port?.removeEventListener('message', receive);
      endGhost();
      hostElement.remove();
    },
  };
}

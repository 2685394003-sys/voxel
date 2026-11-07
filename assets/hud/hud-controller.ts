import type { GameHost } from '@forgeax/engine/app';
import { HUD_CHANNEL } from '../city/pack-ids.ts';

/** 引擎推给 HUD 的状态快照。字段与 warship.ts 的推送保持一致。 */
interface HudState {
  readonly elapsed: number;
  readonly funds: number;
  readonly destroyed: number;
  readonly total: number;
}

/** 秒 → mm:ss。超过 99 分钟也不截断，宁可显示 100:00 也不骗人。 */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

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
.bottom {
  position: absolute; left: 0; right: 0; bottom: 0;
  /* 底部多留 26px：dev shell 会在左下角压一行 FPS 读数，挨太近两个数字会叠在一起。 */
  display: flex; align-items: flex-end; gap: 24px; padding: 0 18px 26px;
}
.funds {
  display: flex; flex-direction: column; gap: 2px; min-width: 132px;
  padding: 8px 16px; border-left: 3px solid #ffc766;
  background: linear-gradient(90deg, rgba(8,16,24,0.72), rgba(8,16,24,0));
}
.funds-label { font-size: 11px; letter-spacing: 0.2em; opacity: 0.7; }
.funds-value {
  font-family: Consolas, "SFMono-Regular", monospace; font-size: 30px;
  font-variant-numeric: tabular-nums; line-height: 1.05; color: #ffd08a;
}
.loadout { display: flex; gap: 10px; }
.slot {
  display: flex; align-items: center; justify-content: center;
  width: 62px; height: 62px; border-radius: 8px;
  border: 1px solid rgba(127,211,255,0.28); background: rgba(8,16,24,0.55);
  font-family: Consolas, monospace; font-size: 12px; letter-spacing: 0.1em; opacity: 0.42;
}
.hint {
  margin-left: auto; padding-bottom: 6px;
  font-size: 12px; letter-spacing: 0.06em; opacity: 0.55; text-align: right;
}
@media (max-height: 640px) {
  .timer { top: 10px; padding: 4px 12px; }
  .timer-value { font-size: 18px; }
  .destroyed { top: 46px; }
  .bottom { padding-bottom: 20px; gap: 16px; }
  .slot { width: 52px; height: 52px; }
  .funds-value { font-size: 24px; }
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
  <div class="bottom">
    <div class="funds">
      <span class="funds-label">军费</span>
      <strong class="funds-value" data-part="funds">0</strong>
    </div>
    <div class="loadout" role="list" aria-label="军备装载池">
      <div class="slot" role="listitem" aria-label="空槽位">I</div>
      <div class="slot" role="listitem" aria-label="空槽位">II</div>
      <div class="slot" role="listitem" aria-label="空槽位">III</div>
      <div class="slot" role="listitem" aria-label="空槽位">IV</div>
    </div>
    <div class="hint">WASD 航行 · 鼠标瞄准 · 左键开火</div>
  </div>
</div>
`;

/** HUD 的持有句柄。dispose 之后不再监听任何消息。 */
export interface HudHandle {
  dispose(): void;
}

/**
 * 在前端领域挂载 HUD 并订阅引擎状态。
 *
 * 这里刻意不走 UI 资源导入管线：HUD 只有三个信息块，直接建 DOM 更简单，
 * 也避免为一个纯展示层引入编译期资源身份。引擎侧只发数据，不认识任何节点；
 * 想加新数字，在 HUD_MARKUP 里加一个 data-part，再在下面多取一个节点即可。
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

  const port = host.presentationPort ?? host.port;
  const receive = (event: MessageEvent) => {
    const data = event.data as { channel?: unknown; kind?: unknown; state?: HudState } | undefined;
    if (data === undefined || data.channel !== HUD_CHANNEL || data.kind !== 'state') return;
    const state = data.state;
    if (state === undefined) return;
    if (timer !== null) timer.textContent = formatClock(state.elapsed);
    if (funds !== null) funds.textContent = state.funds.toLocaleString('zh-CN');
    if (destroyed !== null) destroyed.textContent = `${state.destroyed}/${state.total}`;
  };
  port?.addEventListener('message', receive);
  port?.start();

  return {
    dispose() {
      port?.removeEventListener('message', receive);
      hostElement.remove();
    },
  };
}

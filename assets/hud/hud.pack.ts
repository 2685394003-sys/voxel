import { definePack } from '@forgeax/engine/pack/source';
import type { Plugin } from '@forgeax/engine/plugin';
import { ok } from '@forgeax/engine/types';

import type {} from '@forgeax/engine/app';
import { HUD_PACKAGE_ID } from '../city/pack-ids.ts';
import { createHudUi } from './hud-controller.ts';

/**
 * 前端根插件：只负责在 DOM 领域挂载 HUD。
 *
 * 引擎世界的数据通过 MessagePort 以 `voxel-warship/hud` 通道送达，这里不读 ECS，
 * 也不持有任何游戏状态——所以 HUD 可以随时销毁重建而不影响模拟。
 */
export const hud: Plugin.Object<Record<string, never>> = {
  name: 'voxel-warship/hud',
  inject: ['gameHost'],
  apply(ctx) {
    const host = ctx.gameHost;
    if (host === undefined) throw new Error('voxel-warship/hud 需要 App 提供的 GameHost');
    ctx.effect(function* () {
      const handle = createHudUi(host);
      yield () => handle.dispose();
    }, 'voxel-warship/hud');
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  plugins: true,
  packageId: HUD_PACKAGE_ID,
  name: 'Voxel Warship / HUD',
  build: () => ok({
    'plugin/hud': {
      kind: 'plugin',
      module: { specifier: './hud.pack.ts', export: 'hud' },
    },
  }),
});

import { joinPluginFiber, mountPluginAsset, type Plugin } from '@forgeax/engine/plugin';
import { definePack } from '@forgeax/engine/pack/source';
import { worldDespawnScene } from '@forgeax/engine/scene';
import { ok } from '@forgeax/engine/types';
import { assetGuid, guidText } from '../shared/asset-refs.ts';
import type {} from './city-refs.ts';
import { CITY_PLUGIN_PACKAGE_ID, CITY_SCENE_PACKAGE_ID } from './pack-ids.ts';

export { default as camera } from './camera.ts';
export { default as warship } from './warship.ts';

/**
 * 城市根插件：加载地图场景 → 实例化 → 提供 cityScene → 挂载子插件。
 *
 * 这是全作唯一的「装配点」。子插件（战舰 / 相机 / HUD）都通过 GUID 挂进来，
 * 谁依赖谁只在这里表达，便于后期按里程碑增删而不动业务代码。
 */
export const city: Plugin.Object<{ readonly scene: string; readonly children: readonly string[] }> = {
  name: 'voxel-warship/city',
  inject: ['world', 'assets', 'physics', 'pluginPrograms'],
  async apply(ctx, config) {
    const assets = ctx.assets;
    if (assets === undefined) throw new Error('voxel-warship/city 需要 assets');
    const loaded = await assets.load(assets.parseGuid(config.scene), 'scene');
    if (!loaded.ok) throw loaded.error;

    await ctx.effect(async function* () {
      const handle = loaded.value;
      yield () => {
        assets.release(handle).unwrap();
      };
      const root = assets.instantiate(handle, ctx.world).unwrap();
      yield () => worldDespawnScene(ctx.world, root).unwrap();
      yield ctx.provide('cityScene', { root });
      for (const guid of config.children) {
        const child = await mountPluginAsset(ctx, guid);
        if (!child.ok) throw child.error;
        yield joinPluginFiber(child.value);
      }
    });
  },
};

export default definePack({
  schemaVersion: '2.0.0',
  plugins: true,
  packageId: CITY_PLUGIN_PACKAGE_ID,
  name: 'Voxel Warship / 城市插件',
  build: () => ok({
    'plugin/city': {
      kind: 'plugin',
      module: { specifier: './city.pack.ts', export: 'city' },
      config: {
        scene: { $asset: guidText(assetGuid(CITY_SCENE_PACKAGE_ID, 'scene/city')) },
        children: [
          { $asset: guidText(assetGuid(CITY_PLUGIN_PACKAGE_ID, 'plugin/warship')) },
          { $asset: guidText(assetGuid(CITY_PLUGIN_PACKAGE_ID, 'plugin/camera')) },
        ],
      },
    },
    'plugin/warship': {
      kind: 'plugin',
      module: { specifier: './city.pack.ts', export: 'warship' },
    },
    'plugin/camera': {
      kind: 'plugin',
      module: { specifier: './city.pack.ts', export: 'camera' },
    },
  }),
});

import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { sceneEntity, worldResolveSceneEntity } from '@forgeax/engine/scene';

/** 本作唯一的一张地图：`assets/city/scene.pack.ts` 产出的场景资源键。 */
export const CITY_SCENE_SOURCE_KEY = 'scene/city';

/** 由 city 插件提供的场景根，其它插件靠它解析实体。 */
export interface CityScene {
  readonly root: EntityHandle;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    cityScene: CityScene;
  }
}

/**
 * 按作者期的实体键解析运行期实体。
 * 不使用显示名（Name 可被改），只用场景资源键 + 实体内键，重命名不会破坏逻辑。
 */
export function resolveCityEntity(world: World, host: CityScene, entityKey: string): EntityHandle {
  const resolved = worldResolveSceneEntity(world, host.root, sceneEntity(CITY_SCENE_SOURCE_KEY, entityKey));
  if (!resolved.ok) throw resolved.error;
  return resolved.value;
}

import { quat } from '@forgeax/engine/math';
import { definePack, definePackageId } from '@forgeax/engine/pack/source';
import {
  ANTIALIAS_FXAA,
  Camera,
  DirectionalLight,
  MeshFilter,
  MeshRenderer,
  perspective,
  SKYBOX_MODE_CUBEMAP,
  SkyboxBackground,
  Skylight,
  TONEMAP_ACES_FILMIC,
} from '@forgeax/engine/render';
import { ChildOf, Name, Transform } from '@forgeax/engine/scene';
import type { AssetGuid, SceneAsset, SceneEntity } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { assetGuid, guidText, PACKAGE_IDS, SUN_OUTGOING_DIRECTION } from '../shared/asset-refs.ts';
import {
  AIM_MARKER_Y, AIM_RING_QUAT, BULLET_PARK_Y, BULLET_POOL_SIZE, CAMERA_LOOK_AHEAD, CAMERA_OFFSET,
  createShipState, FACILITY_PLACEMENTS, FACILITY_TYPES, MAP, RIVER_WALL, SHIP, TURRET,
} from './facility-config.ts';
import { CITY_SCENE_PACKAGE_ID } from './pack-ids.ts';

function keyed(key: string, entity: SceneEntity): readonly [string, SceneEntity] {
  return [key, entity];
}

function meshEntity(
  key: string,
  name: string,
  mesh: AssetGuid,
  position: readonly [number, number, number],
  scale: readonly [number, number, number] = [1, 1, 1],
  extra: Record<string, Record<string, unknown>> = {},
): readonly [string, SceneEntity] {
  return keyed(key, {
    components: {
      Name: { value: name },
      // extra.Transform 用来补朝向等字段；和基础位姿合并而不是整体覆盖，调用点只需写差异部分。
      Transform: { pos: position, scale, ...(extra['Transform'] ?? {}) },
      MeshFilter: { assetHandle: guidText(mesh) },
      MeshRenderer: { materials: [] },
      ...extra,
    },
  });
}

/**
 * 生成整张上海地图。
 *
 * 所有实体在这里一次编排完；运行期只改 Transform，不动态创建实体。
 * 这样「判定」与「表现」彻底分开，也避开了运行期资产句柄管理的复杂度。
 */
function cityScene(): SceneAsset {
  const shipStart = createShipState();
  const cameraTarget = [shipStart.x, MAP.shipY + 3, shipStart.z - CAMERA_LOOK_AHEAD] as const;
  const cameraPosition = [shipStart.x, MAP.shipY + CAMERA_OFFSET[1], shipStart.z + CAMERA_OFFSET[2]] as const;
  const cameraRotation = quat.fromLookAt(quat.create(), cameraPosition, cameraTarget, [0, 1, 0]);

  const facilityEntities = FACILITY_PLACEMENTS.map((placement) => {
    const type = FACILITY_TYPES[placement.type];
    const [width, height, depth] = type.size;
    return meshEntity(
      `facility/${placement.type}`,
      type.name,
      assetGuid(PACKAGE_IDS.geometry, `mesh/facility-${type.tone}`),
      [placement.x, height / 2, placement.z],
      [width, height, depth],
    );
  });

  const bulletEntities = Array.from({ length: BULLET_POOL_SIZE }, (_, index) =>
    meshEntity(
      `bullet/${index}`,
      `炮弹 ${index}`,
      assetGuid(PACKAGE_IDS.geometry, 'mesh/bullet'),
      [0, BULLET_PARK_Y, 0],
    ),
  );

  return {
    kind: 'scene',
    entities: Object.fromEntries([
      // 地面与黄浦江：江沿 Z 轴纵贯全图，是战舰唯一的移动走廊。
      meshEntity('ground', '陆地', assetGuid(PACKAGE_IDS.geometry, 'mesh/city-ground'), [0, -1, 0]),
      meshEntity('water', '黄浦江', assetGuid(PACKAGE_IDS.geometry, 'mesh/city-water'), [0, 0.06, 0]),
      // 两道防汛墙：内侧面正好在 ±waterHalfWidth，把可航走廊在画面上钉死。
      meshEntity(
        'wall-west', '西岸防汛墙', assetGuid(PACKAGE_IDS.geometry, 'mesh/river-wall'),
        [-(MAP.waterHalfWidth + RIVER_WALL.width / 2), RIVER_WALL.height / 2, 0],
      ),
      meshEntity(
        'wall-east', '东岸防汛墙', assetGuid(PACKAGE_IDS.geometry, 'mesh/river-wall'),
        [MAP.waterHalfWidth + RIVER_WALL.width / 2, RIVER_WALL.height / 2, 0],
      ),
      ...facilityEntities,

      // 战舰本体。yaw = π 表示船头朝 -Z（正北）。
      meshEntity('ship', '战舰', assetGuid(PACKAGE_IDS.geometry, 'mesh/ship-hull'), [
        shipStart.x,
        MAP.shipY + SHIP.size[1] / 2,
        shipStart.z,
      ]),
      // 炮塔、炮管、子弹、瞄准点都是世界级实体，运行期直接写绝对 Transform，
      // 不参与船体旋转继承，省掉一层坐标系换算。
      meshEntity('turret', '主炮塔', assetGuid(PACKAGE_IDS.geometry, 'mesh/ship-turret'), [
        shipStart.x,
        MAP.shipY + TURRET.height,
        shipStart.z,
      ]),
      meshEntity(
        'barrel',
        '炮管',
        assetGuid(PACKAGE_IDS.geometry, 'mesh/ship-barrel'),
        [0, 0, TURRET.barrelZ],
        [1, 1, 1],
        { ChildOf: { parent: 'turret' } },
      ),
      meshEntity(
        'aim', '瞄准环', assetGuid(PACKAGE_IDS.geometry, 'mesh/aim-marker'), [0, AIM_MARKER_Y, 0],
        [1, 1, 1], { Transform: { quat: AIM_RING_QUAT } },
      ),
      ...bulletEntities,

      keyed('sun', {
        components: {
          Name: { value: '阳光' },
          DirectionalLight: {
            direction: SUN_OUTGOING_DIRECTION,
            // 暖白直射光占主导，避免整场被天光染成蓝紫。
            color: [1, 0.96, 0.9],
            // 3.6 会把 0.68 的浅色设施顶面直接推到 2.4 线性值，过 ACES 后一律糊成纯白，
            // 体块之间没有明暗层级。压到 2.0 让最亮的面落在 0.85 左右，留给高光一点余量。
            intensity: 2,
            castShadow: true,
            // 相机在 360 m 高空，阴影覆盖要跟得上，否则远端建筑没有影子。
            shadowDistance: 620,
          },
        },
      }),
      keyed('skylight', {
        components: {
          Name: { value: '天光' },
          Skylight: {
            equirect: guidText(assetGuid(PACKAGE_IDS.environment, 'environment/daylight')),
            color: [1, 1, 1],
            // 直射光压低后，天光要接住背光面，否则侧面会黑成一片死板剪影。
            intensity: 0.5,
          },
        },
      }),
      keyed('sky-background', {
        components: {
          Name: { value: '天空' },
          SkyboxBackground: {
            equirect: guidText(assetGuid(PACKAGE_IDS.environment, 'environment/daylight')),
            mode: SKYBOX_MODE_CUBEMAP,
          },
        },
      }),
      keyed('camera', {
        components: {
          Name: { value: '主相机' },
          Transform: {
            pos: cameraPosition,
            quat: [
              cameraRotation[0] ?? 0,
              cameraRotation[1] ?? 0,
              cameraRotation[2] ?? 0,
              cameraRotation[3] ?? 1,
            ],
          },
          Camera: {
            ...perspective({ fov: Math.PI / 4.2, aspect: 16 / 9 }),
            tonemap: TONEMAP_ACES_FILMIC,
            antialias: ANTIALIAS_FXAA,
            clearColor: [0.06, 0.09, 0.14, 1],
          },
        },
      }),
    ]),
  };
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: CITY_SCENE_PACKAGE_ID,
  name: 'Voxel Warship / 上海地图',
  sceneComponents: [
    Camera,
    ChildOf,
    DirectionalLight,
    MeshFilter,
    MeshRenderer,
    Name,
    Skylight,
    SkyboxBackground,
    Transform,
  ],
  build: () => ok({ 'scene/city': cityScene() }),
});

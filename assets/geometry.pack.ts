import {
  createBoxGeometry,
  createCylinderGeometry,
  createSphereGeometry,
  createTorusGeometry,
} from '@forgeax/engine/geometry';
import { definePack } from '@forgeax/engine/pack/source';
import type { AssetGuid, MeshAsset } from '@forgeax/engine/types';
import { ok } from '@forgeax/engine/types';
import { AIM_RING, MAP, RIVER_WALL, SHIP, TURRET } from './city/facility-config.ts';
import { assetGuid, PACKAGE_IDS, RUSTED_IRON_MATERIAL_GUID } from './shared/asset-refs.ts';

function withMaterial(mesh: MeshAsset, material: AssetGuid, sourceKey: string): MeshAsset {
  return {
    ...mesh,
    materialSlots: [{ slotName: 'surface', sourceKey, defaultMaterial: material }],
  };
}

export default definePack({
  schemaVersion: '2.0.0',
  packageId: PACKAGE_IDS.geometry,
  name: 'Game 3D / Geometry',
  build: () => {
    const ground = createBoxGeometry(28, 0.4, 28);
    if (!ground.ok) return ground;
    const cube = createBoxGeometry(1.5, 1.5, 1.5);
    if (!cube.ok) return cube;
    const sphere = createSphereGeometry(0.9, 48, 32);
    if (!sphere.ok) return sphere;
    const pedestal = createCylinderGeometry(0.75, 0.9, 1, 32, 1);
    if (!pedestal.ok) return pedestal;
    const torus = createTorusGeometry(1, 0.24, 20, 64);
    if (!torus.ok) return torus;
    const light = createSphereGeometry(0.13, 16, 10);
    if (!light.ok) return light;
    const step = createBoxGeometry(2.4, 0.45, 2.4);
    if (!step.ok) return step;
    const ramp = createBoxGeometry(3.2, 0.3, 4.4);
    if (!ramp.ok) return ramp;

    // ── 体素战舰破坏：城市与战舰体块 ──────────────────────────────
    // 全部做成「单位体块 + Transform 缩放」或固定尺寸，灰盒阶段不追求造型。
    //
    // 陆地与江面都必须是可玩边界的 4 倍：相机吊在 360 m 高空斜俯视，视锥底边
    // 会打到地图之外，地面只要跟地图一样大，画面上下就会露出「世界尽头」的黑边。
    const cityGround = createBoxGeometry(MAP.size * 4, 2, MAP.size * 4);
    if (!cityGround.ok) return cityGround;
    const cityWater = createBoxGeometry(MAP.waterHalfWidth * 2, 0.4, MAP.size * 4);
    if (!cityWater.ok) return cityWater;
    // 两岸防汛墙：把「江」和「岸」在画面上切开。没有它，江只是一条画在灰色地板上
    // 的蓝带，玩家也看不出 ±laneHalfWidth 这条可航走廊到底在哪。
    const riverWall = createBoxGeometry(RIVER_WALL.width, RIVER_WALL.height, MAP.size * 4);
    if (!riverWall.ok) return riverWall;
    const facilityBox = createBoxGeometry(1, 1, 1);
    if (!facilityBox.ok) return facilityBox;
    // 船体与炮塔尺寸全部从 facility-config 推导，保证模型与弹道起点一致。
    const shipHull = createBoxGeometry(SHIP.size[0], SHIP.size[1], SHIP.size[2]);
    if (!shipHull.ok) return shipHull;
    const shipTurret = createCylinderGeometry(TURRET.radius, TURRET.radius * 1.1, TURRET.thickness, 24, 1);
    if (!shipTurret.ok) return shipTurret;
    const shipBarrel = createBoxGeometry(
      TURRET.barrelThickness, TURRET.barrelThickness, TURRET.barrelLength,
    );
    if (!shipBarrel.ok) return shipBarrel;
    const bullet = createSphereGeometry(0.6, 12, 8);
    if (!bullet.ok) return bullet;
    const aimMarker = createTorusGeometry(AIM_RING.radius, AIM_RING.tube, 10, 48);
    if (!aimMarker.ok) return aimMarker;

    return ok({
      'mesh/ground': withMaterial(ground.value, assetGuid(PACKAGE_IDS.materials, 'material/ground'), 'game-3d:ground'),
      'mesh/cube': withMaterial(cube.value, assetGuid(PACKAGE_IDS.materials, 'material/painted'), 'game-3d:cube'),
      'mesh/sphere': withMaterial(sphere.value, assetGuid(PACKAGE_IDS.materials, 'material/metal'), 'game-3d:sphere'),
      'mesh/pedestal': withMaterial(pedestal.value, assetGuid(PACKAGE_IDS.materials, 'material/white'), 'game-3d:pedestal'),
      'mesh/torus': withMaterial(torus.value, assetGuid(PACKAGE_IDS.materials, 'material/metal'), 'game-3d:torus'),
      'mesh/light': withMaterial(light.value, assetGuid(PACKAGE_IDS.materials, 'material/light'), 'game-3d:light'),
      'mesh/step': withMaterial(step.value, assetGuid(PACKAGE_IDS.materials, 'material/obstacle'), 'game-3d:step'),
      'mesh/ramp': withMaterial(ramp.value, RUSTED_IRON_MATERIAL_GUID, 'game-3d:ramp'),

      'mesh/city-ground': withMaterial(
        cityGround.value, assetGuid(PACKAGE_IDS.materials, 'material/asphalt'), 'voxel-warship:city-ground',
      ),
      'mesh/city-water': withMaterial(
        cityWater.value, assetGuid(PACKAGE_IDS.materials, 'material/water'), 'voxel-warship:city-water',
      ),
      'mesh/river-wall': withMaterial(
        riverWall.value, assetGuid(PACKAGE_IDS.materials, 'material/river-wall'), 'voxel-warship:river-wall',
      ),
      'mesh/facility-0': withMaterial(
        facilityBox.value, assetGuid(PACKAGE_IDS.materials, 'material/facility-tone-0'), 'voxel-warship:facility-0',
      ),
      'mesh/facility-1': withMaterial(
        facilityBox.value, assetGuid(PACKAGE_IDS.materials, 'material/facility-tone-1'), 'voxel-warship:facility-1',
      ),
      'mesh/facility-2': withMaterial(
        facilityBox.value, assetGuid(PACKAGE_IDS.materials, 'material/facility-tone-2'), 'voxel-warship:facility-2',
      ),
      'mesh/facility-3': withMaterial(
        facilityBox.value, assetGuid(PACKAGE_IDS.materials, 'material/facility-tone-3'), 'voxel-warship:facility-3',
      ),
      'mesh/ship-hull': withMaterial(
        shipHull.value, assetGuid(PACKAGE_IDS.materials, 'material/ship-hull'), 'voxel-warship:ship-hull',
      ),
      'mesh/ship-turret': withMaterial(
        shipTurret.value, assetGuid(PACKAGE_IDS.materials, 'material/ship-turret'), 'voxel-warship:ship-turret',
      ),
      'mesh/ship-barrel': withMaterial(
        shipBarrel.value, assetGuid(PACKAGE_IDS.materials, 'material/ship-barrel'), 'voxel-warship:ship-barrel',
      ),
      'mesh/bullet': withMaterial(
        bullet.value, assetGuid(PACKAGE_IDS.materials, 'material/bullet'), 'voxel-warship:bullet',
      ),
      'mesh/aim-marker': withMaterial(
        aimMarker.value, assetGuid(PACKAGE_IDS.materials, 'material/aim-marker'), 'voxel-warship:aim-marker',
      ),
    });
  },
});

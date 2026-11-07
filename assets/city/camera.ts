import { Time, Update, type EntityHandle } from '@forgeax/engine/ecs';
import { quat } from '@forgeax/engine/math';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { resolveCityEntity } from './city-refs.ts';
import { CAMERA_LOOK_AHEAD, CAMERA_OFFSET, MAP } from './facility-config.ts';

/** 相机跟随的收敛速度，越大越硬。俯视射击手感偏硬更稳。 */
const FOLLOW_RATE = 9;

/**
 * 俯视跟随相机。
 *
 * 刻意不做「随船转向」：一来鼠标瞄准是屏幕绝对坐标，视角跟着转会让准星乱飘；
 * 二来轴线对齐的视野更容易判断江面航道与两岸设施的位置关系。
 */
export const camera: Plugin.Object<Record<string, never>> = {
  name: 'voxel-warship/camera',
  inject: ['world', 'gameHost', 'cityScene', 'voxelWarship'],
  apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    if (host === undefined) throw new Error('voxel-warship/camera 需要 App 提供的 GameHost');
    const scene = ctx.cityScene;
    const warship = ctx.voxelWarship;
    const cameraEntity: EntityHandle = resolveCityEntity(world, scene, 'camera');

    // 初始位姿：避免第一帧从原点飞过去。
    let focusX = warship.ship.x;
    let focusZ = warship.ship.z;
    const applyPose = (x: number, z: number) => {
      const position = [x + CAMERA_OFFSET[0], MAP.shipY + CAMERA_OFFSET[1], z + CAMERA_OFFSET[2]] as const;
      const target = [x, MAP.shipY + 3, z - CAMERA_LOOK_AHEAD] as const;
      const rotation = quat.fromLookAt(quat.create(), position, target, [0, 1, 0]);
      world.set(cameraEntity, Transform, {
        pos: position,
        quat: [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1],
      }).unwrap();
    };
    applyPose(focusX, focusZ);

    // 光标类游戏：鼠标要一直可见可点，不能进指针锁定。
    host.setPointerLockAllowed?.(false);

    ctx.effect(function* () {
      world.addSystem(Update, {
        name: 'voxel-warship-camera',
        after: ['voxel-warship-aim'],
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const dt = world.getResource(Time).delta;
          const t = 1 - Math.exp(-FOLLOW_RATE * dt);
          const targetX = warship.ship.x;
          const targetZ = warship.ship.z;
          focusX += (targetX - focusX) * t;
          focusZ += (targetZ - focusZ) * t;
          applyPose(focusX, focusZ);
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'voxel-warship-camera').unwrap();
    }, 'voxel-warship/camera');
  },
};

export default camera;

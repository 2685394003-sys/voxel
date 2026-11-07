import { FixedTime, FixedUpdate, Time, Update, type EntityHandle, type World } from '@forgeax/engine/ecs';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine/input';
import { quat, ray, vec3 } from '@forgeax/engine/math';
import { viewportToWorld } from '@forgeax/engine/picking';
import type { Plugin } from '@forgeax/engine/plugin';
import { PROPAGATE_TRANSFORMS_SYSTEM, Transform } from '@forgeax/engine/scene';
import { resolveCityEntity, type CityScene } from './city-refs.ts';
import { HUD_CHANNEL } from './pack-ids.ts';
import {
  createArsenalState, drawPool, loadoutCount, moveWithinLoadout, POOL_SIZE, purchase,
  purchaseToSlot, refresh, REFRESH_COST, sell, toCardView, type ActionResult, type ArsenalRng,
} from './arsenal.ts';
import {
  AIM_MARKER_Y, AIM_RING_QUAT, applyDamage, BULLET_PARK_Y, BULLET_POOL_SIZE, createCityState,
  createShipState, FACILITY_PLACEMENTS, MAP, segmentHitsFacility, SHIP, steerTurret, stepShip,
  surfaceHeightAt, TURRET, WEAPON, type CityState, type ShipState,
} from './facility-config.ts';

/** 炮口相对炮塔中心的前向距离：炮管安装偏移 + 半个炮管长度。 */
const MUZZLE_RADIUS = TURRET.barrelZ + TURRET.barrelLength / 2;
/** HUD 推送节流（秒）。10 Hz 足够看清数字，又不会每帧唤醒 UI。 */
const HUD_PUSH_INTERVAL = 0.1;

/** 供其它插件（相机、HUD）读取的运行期状态。 */
export interface WarshipService {
  readonly ship: ShipState;
  readonly city: CityState;
  readonly turretYaw: number;
  readonly elapsed: number;
  readonly aimX: number;
  readonly aimZ: number;
}

declare module '@forgeax/engine/plugin' {
  interface EngineContextServices {
    voxelWarship: WarshipService;
  }
}

interface Bullet {
  active: boolean;
  x: number;
  y: number;
  z: number;
  /** 水平方向单位向量。 */
  dx: number;
  dz: number;
  /** 剩余寿命（秒）。 */
  life: number;
}

interface Bindings {
  readonly ship: EntityHandle;
  readonly turret: EntityHandle;
  readonly aim: EntityHandle;
  readonly bullets: readonly EntityHandle[];
  readonly facilities: readonly EntityHandle[];
}

/** 把场景里预编排好的实体一次性解析出来。解析失败立刻抛错，不静默降级。 */
function bind(world: World, scene: CityScene): Bindings {
  return {
    ship: resolveCityEntity(world, scene, 'ship'),
    turret: resolveCityEntity(world, scene, 'turret'),
    aim: resolveCityEntity(world, scene, 'aim'),
    bullets: Array.from({ length: BULLET_POOL_SIZE }, (_, index) =>
      resolveCityEntity(world, scene, `bullet/${index}`),
    ),
    facilities: FACILITY_PLACEMENTS.map((placement) =>
      resolveCityEntity(world, scene, `facility/${placement.type}`),
    ),
  };
}

function yawQuat(yaw: number): [number, number, number, number] {
  const rotation = quat.eulerY(yaw);
  return [rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1];
}

export const warship: Plugin.Object<Record<string, never>> = {
  name: 'voxel-warship/warship',
  provide: 'voxelWarship',
  inject: ['world', 'gameHost', 'cityScene'],
  apply(ctx) {
    const world = ctx.world;
    const host = ctx.gameHost;
    if (host === undefined) throw new Error('voxel-warship/warship 需要 App 提供的 GameHost');
    const scene = ctx.cityScene;

    const bindings = bind(world, scene);
    const cameraEntity = resolveCityEntity(world, scene, 'camera');
    // 鼠标坐标是「绘制缓冲像素」，视口尺寸必须用同一个口径，否则瞄点会整体偏移。
    const readDrawingBufferSize = host.drawingBufferSize?.bind(host);
    const ship = createShipState();
    const city = createCityState();

    // 军需库：开局发一手 4 张。抽卡要扣军费，所以必须住在 engine realm，
    // HUD 只拿 CardView 显示、只发 purchase / refresh 意图。
    const arsenal = createArsenalState();
    // 可复现随机源。做种子系统时把这里换掉，其余逻辑不用动。
    const arsenalRng: ArsenalRng = (max) => Math.floor(Math.random() * max);
    drawPool(arsenal, arsenalRng);

    // 语义输入：Update 采样，FixedUpdate 消费。两者解耦后不受帧率影响。
    let intentForward = 0;
    let intentStrafe = 0;
    let firing = false;

    let turretYaw = Math.PI;
    let aimX = ship.x;
    let aimZ = ship.z - 80;
    // 上一次写进 Transform 的环位姿。Y 也要参与比较：环下的楼被打掉后，
    // 瞄点坐标没变但该落回地面，只比 XZ 会让环一直悬在半空。
    let writtenAim: [number, number, number] | undefined;
    let elapsed = 0;
    let fireCooldown = 0;
    let hudPushTimer = 0;
    // 诊断用：记录最近一帧的指针与视口读数，方便排查「瞄不准」类问题。
    let pointerX = -1;
    let pointerY = -1;
    let pointerPresent = false;
    let viewportWidth = 0;
    let viewportHeight = 0;
    let rayMissed = 0;

    const bullets: Bullet[] = Array.from({ length: BULLET_POOL_SIZE }, () => ({
      active: false, x: 0, y: BULLET_PARK_Y, z: 0, dx: 0, dz: 1, life: 0,
    }));

    const service: WarshipService = {
      ship,
      city,
      get turretYaw() { return turretYaw; },
      get elapsed() { return elapsed; },
      get aimX() { return aimX; },
      get aimZ() { return aimZ; },
    };

    const parkBullet = (index: number) => {
      const bullet = bullets[index];
      if (bullet === undefined) return;
      bullet.active = false;
      bullet.life = 0;
      const entity = bindings.bullets[index];
      if (entity !== undefined) {
        world.set(entity, Transform, { pos: [0, BULLET_PARK_Y, 0] }).unwrap();
      }
    };

    /** 从弹药池取一发沿炮口方向射出。池满则丢弃——射速与池容量已配平。 */
    const fire = () => {
      const index = bullets.findIndex((bullet) => !bullet.active);
      if (index < 0) return;
      const bullet = bullets[index];
      if (bullet === undefined) return;
      const sin = Math.sin(turretYaw);
      const cos = Math.cos(turretYaw);
      bullet.active = true;
      bullet.x = ship.x + sin * MUZZLE_RADIUS;
      bullet.y = MAP.shipY + TURRET.height;
      bullet.z = ship.z + cos * MUZZLE_RADIUS;
      bullet.dx = sin;
      bullet.dz = cos;
      bullet.life = WEAPON.bulletLife;
      const entity = bindings.bullets[index];
      if (entity !== undefined) {
        world.set(entity, Transform, { pos: [bullet.x, bullet.y, bullet.z] }).unwrap();
      }
    };

    /** 一步子弹推进 + 命中判定。这里只改数据，表现由 present 系统负责。 */
    const stepBullets = (dt: number) => {
      for (let index = 0; index < bullets.length; index += 1) {
        const bullet = bullets[index];
        if (bullet === undefined || !bullet.active) continue;
        const fromX = bullet.x;
        const fromZ = bullet.z;
        bullet.life -= dt;
        bullet.x += bullet.dx * WEAPON.bulletSpeed * dt;
        bullet.z += bullet.dz * WEAPON.bulletSpeed * dt;

        // 取最近命中点，避免一颗子弹穿过前排打到后排。
        let hitIndex = -1;
        let hitT = Number.POSITIVE_INFINITY;
        for (let f = 0; f < city.facilities.length; f += 1) {
          const facility = city.facilities[f];
          if (facility === undefined) continue;
          const t = segmentHitsFacility(fromX, fromZ, bullet.x, bullet.z, facility);
          if (t >= 0 && t < hitT) {
            hitT = t;
            hitIndex = f;
          }
        }

        if (hitIndex >= 0) {
          const facility = city.facilities[hitIndex];
          if (facility !== undefined) {
            const result = applyDamage(city, facility, WEAPON.damage);
            if (result.destroyed) {
              const entity = bindings.facilities[hitIndex];
              if (entity !== undefined) world.despawn(entity).unwrap();
            }
          }
          parkBullet(index);
          continue;
        }

        const outOfBounds = Math.abs(bullet.x) > MAP.size / 2 || Math.abs(bullet.z) > MAP.size / 2;
        if (bullet.life <= 0 || outOfBounds) parkBullet(index);
      }
    };

    ctx.effect(function* () {
      // 最近一次操作的结果。HUD 靠 seq 变化判断"有没有新事件"，
      // 从而只在真的失败时弹一次提示，不必自己重复实现判定。
      let actionSeq = 0;
      let lastResult: { seq: number; ok: boolean; reason?: string } | null = null;
      const record = (result: ActionResult) => {
        actionSeq += 1;
        lastResult = result.ok
          ? { seq: actionSeq, ok: true }
          : { seq: actionSeq, ok: false, reason: result.reason };
      };

      /** 推一次完整状态。操作成功后立即调一次，别让玩家等 10 Hz 的节拍。 */
      const pushHudState = () => {
        host.port?.postMessage({
          channel: HUD_CHANNEL,
          kind: 'state',
          state: {
            elapsed,
            funds: city.funds,
            destroyed: city.destroyedCount,
            total: city.facilities.length,
            loadout: arsenal.loadout.map(toCardView),
            pool: arsenal.pool.map(toCardView),
            refreshCost: REFRESH_COST,
            lastResult,
          },
        });
      };

      // ── HUD → 引擎：购买 / 拖拽 / 出售 / 刷新意图 ──────────────
      // 只收意图，扣钱和改状态都在这里做——HUD 永远不持有军费所有权。
      const onHudAction = (event: MessageEvent) => {
        const data = event.data as
          | {
            channel?: unknown; kind?: unknown; action?: unknown;
            index?: unknown; poolIndex?: unknown; slotIndex?: unknown; from?: unknown; to?: unknown;
          }
          | undefined;
        if (data === undefined || data === null || typeof data !== 'object') return;
        if (data.channel !== HUD_CHANNEL || data.kind !== 'action') return;
        switch (data.action) {
          case 'refresh':
            record(refresh(arsenal, city, arsenalRng));
            break;
          case 'purchase':
            if (typeof data.index !== 'number') return;
            record(purchase(arsenal, data.index, city));
            break;
          case 'purchase-to-slot':
            if (typeof data.poolIndex !== 'number' || typeof data.slotIndex !== 'number') return;
            record(purchaseToSlot(arsenal, data.poolIndex, data.slotIndex, city));
            break;
          case 'move-slot':
            if (typeof data.from !== 'number' || typeof data.to !== 'number') return;
            record(moveWithinLoadout(arsenal, data.from, data.to));
            break;
          case 'sell':
            if (typeof data.index !== 'number') return;
            record(sell(arsenal, data.index, city));
            break;
          default:
            return;
        }
        pushHudState();
      };
      host.port?.addEventListener('message', onHudAction);
      host.port?.start();
      yield () => host.port?.removeEventListener('message', onHudAction);

      // ── 输入与瞄准（每帧）──────────────────────────────────────
      world.addSystem(Update, {
        name: 'voxel-warship-aim',
        after: [FixedUpdate],
        before: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          const input = world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
          const keyboard = input.keyboard;
          intentForward =
            Number(keyboard.downCode('KeyW') || keyboard.downCode('ArrowUp')) -
            Number(keyboard.downCode('KeyS') || keyboard.downCode('ArrowDown'));
          intentStrafe =
            Number(keyboard.downCode('KeyD') || keyboard.downCode('ArrowRight')) -
            Number(keyboard.downCode('KeyA') || keyboard.downCode('ArrowLeft'));
          firing = input.mouse.button(0);

          // 鼠标位置 → 世界射线 → 地面交点。拿不到就保持上一帧瞄点。
          const pointer = input.mouse.position;
          const viewport = readDrawingBufferSize?.();
          const width = viewport?.width ?? 0;
          const height = viewport?.height ?? 0;
          viewportWidth = width;
          viewportHeight = height;
          pointerPresent = pointer !== undefined;
          pointerX = pointer?.x ?? -1;
          pointerY = pointer?.y ?? -1;
          if (pointer !== undefined && width > 0 && height > 0) {
            const hit = viewportToWorld(world, cameraEntity, pointer.x, pointer.y, width, height);
            if (hit === undefined) {
              rayMissed += 1;
            } else {
              const origin = ray.getOrigin(vec3.create(), hit);
              const direction = ray.getDirection(vec3.create(), hit);
              const dirY = direction[1] ?? 0;
              if (dirY < -1e-5) {
                const distance = -(origin[1] ?? 0) / dirY;
                const limit = MAP.size / 2;
                aimX = Math.max(-limit, Math.min(limit, (origin[0] ?? 0) + (direction[0] ?? 0) * distance));
                aimZ = Math.max(-limit, Math.min(limit, (origin[2] ?? 0) + (direction[2] ?? 0) * distance));
              } else {
                rayMissed += 1;
              }
            }
          } else {
            rayMissed += 1;
          }
          turretYaw = steerTurret(
            turretYaw,
            Math.atan2(aimX - ship.x, aimZ - ship.z),
            world.getResource(Time).delta,
          );
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'voxel-warship-aim').unwrap();

      // ── 推进、开火、命中结算（固定步长）────────────────────────
      world.addSystem(FixedUpdate, {
        name: 'voxel-warship-sim',
        queries: [],
        fn: () => {
          const dt = world.getResource(FixedTime).delta;
          elapsed += dt;
          stepShip(ship, { forward: intentForward, strafe: intentStrafe }, dt);

          fireCooldown -= dt;
          if (firing && fireCooldown <= 0) {
            fire();
            fireCooldown = WEAPON.fireInterval;
          } else if (fireCooldown < 0) {
            fireCooldown = 0;
          }

          stepBullets(dt);

          hudPushTimer += dt;
          if (hudPushTimer >= HUD_PUSH_INTERVAL) {
            hudPushTimer = 0;
            pushHudState();
          }
        },
      }).unwrap();
      yield () => world.removeSystem(FixedUpdate, 'voxel-warship-sim').unwrap();

      // ── 把判定位姿写回 Transform（表现层）──────────────────────
      world.addSystem(Update, {
        name: 'voxel-warship-present',
        after: [PROPAGATE_TRANSFORMS_SYSTEM],
        queries: [],
        fn: () => {
          world.set(bindings.ship, Transform, {
            pos: [ship.x, MAP.shipY + SHIP.size[1] / 2, ship.z],
            quat: yawQuat(ship.yaw),
          }).unwrap();
          world.set(bindings.turret, Transform, {
            pos: [ship.x, MAP.shipY + TURRET.height, ship.z],
            quat: yawQuat(turretYaw),
          }).unwrap();
          // 环贴在瞄点正下方的表面上：空地/江面贴地，压在楼上就盖在屋顶。
          const aimY = AIM_MARKER_Y + surfaceHeightAt(city.facilities, aimX, aimZ);
          if (
            writtenAim === undefined ||
            writtenAim[0] !== aimX || writtenAim[1] !== aimY || writtenAim[2] !== aimZ
          ) {
            writtenAim = [aimX, aimY, aimZ];
            // world.set 是整体替换：只写 pos 会把场景里那次「转平」的四元数一起冲掉，
            // 圆环会立起来变成一堵墙。朝向是常量，跟着一起写。
            world.set(bindings.aim, Transform, {
              pos: [aimX, aimY, aimZ],
              quat: [AIM_RING_QUAT[0], AIM_RING_QUAT[1], AIM_RING_QUAT[2], AIM_RING_QUAT[3]],
            }).unwrap();
          }
          for (let index = 0; index < bullets.length; index += 1) {
            const bullet = bullets[index];
            const entity = bindings.bullets[index];
            if (bullet === undefined || entity === undefined || !bullet.active) continue;
            world.set(entity, Transform, { pos: [bullet.x, bullet.y, bullet.z] }).unwrap();
          }
        },
      }).unwrap();
      yield () => world.removeSystem(Update, 'voxel-warship-present').unwrap();

      // ── 验收用的读投影：脚本化通关靠它断言 ─────────────────────
      const unregisterRead = host.gameProjection?.registerRead({
        id: 'voxel-warship.state',
        title: '战舰与城市状态',
        description: '军费、计时、摧毁数、战舰位姿与炮塔朝向。',
        read: () => ({
          funds: city.funds,
          elapsed: Math.round(elapsed * 100) / 100,
          destroyed: city.destroyedCount,
          remaining: city.facilities.filter((facility) => !facility.destroyed).length,
          ship: { x: Math.round(ship.x * 100) / 100, z: Math.round(ship.z * 100) / 100, yaw: ship.yaw },
          turretYaw,
          aim: { x: Math.round(aimX * 100) / 100, z: Math.round(aimZ * 100) / 100 },
          // 诊断：指针是否到、视口多大、有多少帧没解出地面交点。
          pointer: { present: pointerPresent, x: pointerX, y: pointerY },
          viewport: { width: viewportWidth, height: viewportHeight },
          rayMisses: rayMissed,
          // 军需库：验收脚本靠这几个字段断言"买卡扣钱 / 池里不重复 / 刷新重抽"。
          arsenal: {
            loadout: arsenal.loadout.map((card) => card?.id ?? null),
            pool: arsenal.pool.map((card) => card?.id ?? null),
            owned: [...arsenal.owned],
            loadoutCount: loadoutCount(arsenal),
            refreshCost: REFRESH_COST,
            poolSize: POOL_SIZE,
            lastResult,
          },
        }),
      });
      if (unregisterRead !== undefined) yield unregisterRead;

      ctx.provide('voxelWarship', service);
    }, 'voxel-warship/warship');
  },
};

export default warship;

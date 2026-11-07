/**
 * 一张地图的全部可调内容：地图尺度、黄浦江航道、13 个设施的坐标与数值。
 *
 * 这个文件是「纯数据 + 纯函数」，不 import 任何引擎包。
 * 好处：调参只改这里；逻辑能用单元测试锁死；渲染层如何表现与判定无关。
 */

/** 地图与航道。单位：米（m）。世界原点在正中，Y 轴向上。 */
export const MAP = {
  /** 地图边长：800×800 m。 */
  size: 800,
  /** 黄浦江水面半宽（沿 X 轴方向）。 */
  waterHalfWidth: 45,
  /** 战舰可航行半宽：比水面窄，留出靠岸余量，避免船体吃进岸线。 */
  laneHalfWidth: 36,
  /** 战舰巡航高度（船底离水面）。 */
  shipY: 1.2,
} as const;

/** 一次单局的目标时长（秒）。HUD 计时器按此倒计时。 */
export const RUN_SECONDS = 25 * 60;

/**
 * 两岸防汛墙（外滩那种）。内侧面正好压在水面边缘，于是「可航走廊」有了可见边界。
 * 真实防汛墙约 5~6 m 高；这里加高一倍，是为了在 360 m 高空俯视下还留得住影子和轮廓。
 */
export const RIVER_WALL = { width: 7, height: 12 } as const;

/** 军费账户初始值。 */
export const STARTING_FUNDS = 0;

/** 十三种设施的六大类（对应《设施清单》的分类轴）。 */
export type FacilityCategory = 'civic' | 'industry' | 'energy' | 'transport' | 'military' | 'core';

/** 单个设施类型的静态数值。改这里就等于改平衡。 */
export interface FacilityType {
  /** 内部键名，同时决定场景内实体键 `facility/<key>`。 */
  readonly key: string;
  readonly category: FacilityCategory;
  /** 中文显示名。 */
  readonly name: string;
  /** 结构耐久。M0 不显示血条，仅用于内部判定。 */
  readonly hp: number;
  /** 摧毁后即时到账的军费。 */
  readonly reward: number;
  /** 体块尺寸（宽 × 高 × 深，米）。灰盒阶段一律用长方体。 */
  readonly size: readonly [number, number, number];
  /** 材质色调档位，0 冷灰 / 1 暖灰 / 2 砖红 / 3 金属。 */
  readonly tone: 0 | 1 | 2 | 3;
}

/**
 * 13 种设施。数量对应《设施清单》的最终定稿：民生 4、工业 3、能源 2、交通 1、军事 2、核心 1。
 * 奖励梯度按「越硬越贵」设计，保证拆高价值目标有明确收益。
 */
export const FACILITY_TYPES = {
  residential: {
    key: 'residential', category: 'civic', name: '居民楼群',
    hp: 150, reward: 40, size: [26, 42, 26], tone: 0,
  },
  commercial: {
    key: 'commercial', category: 'civic', name: '商业街区',
    hp: 180, reward: 55, size: [34, 26, 30], tone: 1,
  },
  hospital: {
    key: 'hospital', category: 'civic', name: '医院',
    hp: 200, reward: 60, size: [30, 34, 24], tone: 0,
  },
  school: {
    key: 'school', category: 'civic', name: '学校',
    hp: 170, reward: 50, size: [32, 20, 28], tone: 1,
  },
  factory: {
    key: 'factory', category: 'industry', name: '工厂',
    hp: 260, reward: 85, size: [40, 30, 30], tone: 3,
  },
  warehouse: {
    key: 'warehouse', category: 'industry', name: '仓库区',
    hp: 220, reward: 75, size: [36, 18, 36], tone: 3,
  },
  sewage: {
    key: 'sewage', category: 'industry', name: '污水处理厂',
    hp: 240, reward: 80, size: [34, 16, 34], tone: 1,
  },
  powerplant: {
    key: 'powerplant', category: 'energy', name: '火力发电厂',
    hp: 380, reward: 150, size: [44, 52, 34], tone: 3,
  },
  oiltank: {
    key: 'oiltank', category: 'energy', name: '储油罐群',
    hp: 320, reward: 170, size: [38, 26, 38], tone: 3,
  },
  overpass: {
    key: 'overpass', category: 'transport', name: '高架桥',
    hp: 300, reward: 100, size: [72, 14, 18], tone: 1,
  },
  barracks: {
    key: 'barracks', category: 'military', name: '军营',
    hp: 340, reward: 130, size: [38, 22, 32], tone: 2,
  },
  aad: {
    key: 'aad', category: 'military', name: '防空阵地',
    hp: 360, reward: 160, size: [30, 18, 30], tone: 2,
  },
  command: {
    key: 'command', category: 'core', name: '指挥中心',
    hp: 900, reward: 300, size: [46, 64, 46], tone: 2,
  },
} as const satisfies Record<string, FacilityType>;

export type FacilityKey = keyof typeof FACILITY_TYPES;

/**
 * 地图布点。参考上海真实地理关系：
 * 黄浦江沿 Z 轴纵贯全图，西岸（x < 0）是老城厢与工业区，东岸（x > 0）是陆家嘴与防空阵地。
 * 全部设施都放在岸上，战舰只能走江面航道——江就是天然的移动走廊。
 */
export const FACILITY_PLACEMENTS: readonly { readonly type: FacilityKey; readonly x: number; readonly z: number }[] = [
  // 西岸 · 老城厢与工业带（x 在 -90 ~ -125 之间，紧贴江岸但不出水面）
  { type: 'residential', x: -95, z: -330 },
  { type: 'powerplant', x: -118, z: -250 },
  { type: 'sewage', x: -92, z: -175 },
  { type: 'commercial', x: -122, z: -100 },
  { type: 'hospital', x: -95, z: -25 },
  { type: 'school', x: -120, z: 50 },
  { type: 'command', x: -100, z: 140 },
  { type: 'factory', x: -124, z: 225 },
  { type: 'warehouse', x: -96, z: 300 },
  { type: 'oiltank', x: -120, z: 370 },
  // 东岸 · 陆家嘴与驻军
  { type: 'overpass', x: 110, z: -260 },
  { type: 'barracks', x: 105, z: 30 },
  { type: 'aad', x: 100, z: 240 },
];

/** 战舰运动参数。 */
export const SHIP = {
  /** 最大航速，米/秒。刻意偏慢：这是拆建筑的节奏，不是飞行游戏。 */
  speed: 12,
  /** 加速与减速的响应速度，越大越跟手。 */
  accel: 9,
  /** 船体转向角速度，弧度/秒。 */
  turnRate: 2.2,
  /** 船体尺寸（宽 × 高 × 长，米）。模型与判定共用这一份。 */
  size: [14, 9, 36] as const,
} as const;

/**
 * 炮塔几何。同样只有这一份：模型尺寸、炮口位置、判定全部从这里推导，
 * 避免「改了模型忘了改弹道起点」这类经典错位。
 */
export const TURRET = {
  /** 炮塔中心相对船体原点的高度。 */
  height: 8.2,
  /** 炮塔底座半径。 */
  radius: 5.2,
  /** 炮塔高度。 */
  thickness: 4.2,
  /** 炮管长度与粗细。 */
  barrelLength: 16,
  barrelThickness: 1.8,
  /** 炮管中心相对炮塔中心的前向偏移。 */
  barrelZ: 5,
} as const;

/** 炮塔与射击参数。 */
export const WEAPON = {
  /** 炮塔转速，弧度/秒（约合 180°/s）。 */
  turretTurnRate: Math.PI,
  /** 死区：目标偏角小于此值就不转，避免抖动。 */
  turretDeadzone: (2 * Math.PI) / 180,
  /** 射速间隔，秒。4 发/秒。 */
  fireInterval: 0.25,
  /** 单发伤害。 */
  damage: 25,
  /** 弹速，米/秒。 */
  bulletSpeed: 130,
  /** 子弹存活时间，秒。 */
  bulletLife: 1.6,
  /** 炮口相对船体的前向 / 高度偏移。 */
  muzzleOffset: 6.5,
  muzzleHeight: 2.6,
} as const;

/**
 * 相机相对战舰的偏移：正后方 + 正上方，形成约 53° 的俯角。
 * 高度 360 m 时画面横跨约 280 m，正好能同时看到江面与两岸设施。
 */
export const CAMERA_OFFSET = [0, 360, 230] as const;

/** 相机注视点在战舰前方的前置量（米），让视野偏向航行方向。 */
export const CAMERA_LOOK_AHEAD = 40;

/** 同时存在的子弹上限。4 发/秒 × 1.6 秒存活 ≈ 7 发，留一倍余量。 */
export const BULLET_POOL_SIZE = 12;

/** 隐藏子弹用的「冷宫」高度（米）。子弹空闲时停在这里。 */
export const BULLET_PARK_Y = -400;

/** 瞄准点离地高度。必须高于水面顶面（水板半厚 0.2 + 0.06），否则会被江水盖住。 */
export const AIM_MARKER_Y = 0.42;

/**
 * 瞄准环尺寸（米）。做成空心环而不是实心圆点：
 * 落点标记要能指示位置，又不能盖住被判定的目标本身——实心点会把设施顶面吃掉。
 */
export const AIM_RING = { radius: 7, tube: 0.55 } as const;

/**
 * 圆环几何默认躺在 XY 平面（孔轴朝 +Z），绕 X 轴转 90° 才是贴地的水平环。
 * 直接写死四元数，避免为首帧一次性旋转去引入 eulerX（引擎只导出了 eulerY）。
 */
export const AIM_RING_QUAT: readonly [number, number, number, number] = [
  Math.SQRT1_2, 0, 0, Math.SQRT1_2,
];

/** 移动输入（-1 / 0 / 1），与帧率无关的语义意图。 */
export interface MoveIntent {
  readonly forward: number;
  readonly strafe: number;
}

/** 一艘战舰的运动状态。纯数据，便于单测。 */
export interface ShipState {
  x: number;
  z: number;
  /** 当前航向（绕 Y 轴，弧度）。 */
  yaw: number;
  /** 当前前向速度。 */
  speed: number;
}

export function createShipState(): ShipState {
  return { x: 0, z: 300, yaw: Math.PI, speed: 0 };
}

/**
 * 推进一步战舰状态。返回是否有实际位移。
 * 只沿航道（X 轴夹紧到 laneHalfWidth）运动，`dt` 为固定步长。
 */
export function stepShip(state: ShipState, intent: MoveIntent, dt: number): boolean {
  const accel = SHIP.accel;
  const targetSpeed = Math.max(-1, Math.min(1, intent.forward)) * SHIP.speed;
  state.speed += (targetSpeed - state.speed) * Math.min(1, accel * dt);
  if (Math.abs(state.speed) < 0.01) state.speed = 0;

  const strafe = Math.max(-1, Math.min(1, intent.strafe)) * SHIP.speed * 0.62;
  const prevX = state.x;
  const prevZ = state.z;
  state.z -= state.speed * dt;
  state.x += strafe * dt;
  // 航道是唯一走廊：横向夹紧在江面内，纵向夹紧在地图边界内，别让船开出世界。
  state.x = Math.max(-MAP.laneHalfWidth, Math.min(MAP.laneHalfWidth, state.x));
  const limitZ = MAP.size / 2 - SHIP.size[2] / 2;
  state.z = Math.max(-limitZ, Math.min(limitZ, state.z));

  const movedX = state.x - prevX;
  const movedZ = state.z - prevZ;
  if (Math.hypot(movedX, movedZ) > 0.0001) {
    state.yaw = Math.atan2(movedX, movedZ);
    return true;
  }
  return false;
}

/**
 * 炮塔跟随目标角度，返回新角度。
 * 采用最短弧旋转 + 死区，避免跨越 ±π 时抖动。
 */
export function steerTurret(current: number, target: number, dt: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= WEAPON.turretDeadzone) return current;
  const step = WEAPON.turretTurnRate * dt;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}

/** 一个设施在运行期的状态。 */
export interface FacilityState {
  readonly key: string;
  readonly type: FacilityKey;
  readonly x: number;
  readonly z: number;
  /** 命中判定用的水平半径（米）。灰盒用外接圆，够用且便宜。 */
  readonly radius: number;
  readonly height: number;
  hp: number;
  destroyed: boolean;
}

/** 全局城市状态：军费账户 + 设施列表。 */
export interface CityState {
  funds: number;
  destroyedCount: number;
  /** 首次命中发生时的时间戳（秒），供后续「破防」类反馈使用。 */
  readonly facilities: FacilityState[];
}

export function createCityState(): CityState {
  return {
    funds: STARTING_FUNDS,
    destroyedCount: 0,
    facilities: FACILITY_PLACEMENTS.map((placement) => {
      const type = FACILITY_TYPES[placement.type];
      return {
        key: `${placement.type}@${placement.x},${placement.z}`,
        type: placement.type,
        x: placement.x,
        z: placement.z,
        radius: Math.hypot(type.size[0], type.size[2]) / 2,
        height: type.size[1],
        hp: type.hp,
        destroyed: false,
      };
    }),
  };
}

/** 一次伤害结算的结果。 */
export interface DamageResult {
  readonly hit: boolean;
  /** 本次是否击毁。 */
  readonly destroyed: boolean;
  /** 本次入账军费；未击毁为 0。 */
  readonly reward: number;
}

const NO_HIT: DamageResult = { hit: false, destroyed: false, reward: 0 };

/**
 * 对设施结算一次伤害。命中与击毁都在这里，表现层只负责播。
 * 已摧毁的设施不再结算，防止重复入账。
 */
export function applyDamage(state: CityState, facility: FacilityState, damage: number): DamageResult {
  if (facility.destroyed) return NO_HIT;
  facility.hp = Math.max(0, facility.hp - damage);
  if (facility.hp > 0) return { hit: true, destroyed: false, reward: 0 };
  facility.destroyed = true;
  state.destroyedCount += 1;
  const reward = FACILITY_TYPES[facility.type].reward;
  state.funds += reward;
  return { hit: true, destroyed: true, reward };
}

/**
 * 瞄点正下方的表面高度：落在某个设施投影范围内就返回它的顶面，否则返回 0（地面/江面）。
 *
 * 为什么需要：瞄准环半径 7 m、默认贴在离地 0.42 m。瞄一个 26~46 m 高的体块时，
 * 环会整个被体块吞掉——玩家瞄得越准，准星越看不见，恰好是反的。
 * 抬到顶面之后，「环盖在屋顶上」本身就是「这一发会打在这栋楼」的反馈。
 */
export function surfaceHeightAt(
  facilities: readonly Pick<FacilityState, 'x' | 'z' | 'radius' | 'height' | 'destroyed'>[],
  x: number,
  z: number,
): number {
  let top = 0;
  for (const facility of facilities) {
    if (facility.destroyed) continue;
    const dx = x - facility.x;
    const dz = z - facility.z;
    if (dx * dx + dz * dz > facility.radius * facility.radius) continue;
    if (facility.height > top) top = facility.height;
  }
  return top;
}

/**
 * 线段与竖直圆柱求交（水平面近似）。用于子弹步进检测。
 * 返回命中参数 t ∈ [0,1]，未命中返回 -1。
 */
export function segmentHitsFacility(
  ax: number, az: number, bx: number, bz: number,
  facility: Pick<FacilityState, 'x' | 'z' | 'radius' | 'destroyed'>,
): number {
  if (facility.destroyed) return -1;
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - facility.x;
  const fz = az - facility.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return fx * fx + fz * fz <= facility.radius * facility.radius ? 0 : -1;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - facility.radius * facility.radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

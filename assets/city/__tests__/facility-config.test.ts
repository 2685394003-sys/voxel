import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  createCityState,
  createShipState,
  FACILITY_PLACEMENTS,
  FACILITY_TYPES,
  MAP,
  segmentHitsFacility,
  SHIP,
  stepShip,
  steerTurret,
  surfaceHeightAt,
  WEAPON,
} from '../facility-config.ts';

describe('设施配置表', () => {
  it('正好 13 个设施，且布点与类型表一一对应', () => {
    expect(FACILITY_PLACEMENTS).toHaveLength(13);
    for (const placement of FACILITY_PLACEMENTS) {
      expect(FACILITY_TYPES[placement.type]).toBeDefined();
    }
  });

  it('六大类都有覆盖，核心只有一个', () => {
    const categories = new Set(FACILITY_PLACEMENTS.map((p) => FACILITY_TYPES[p.type].category));
    expect(categories).toEqual(new Set(['civic', 'industry', 'energy', 'transport', 'military', 'core']));
    expect(FACILITY_PLACEMENTS.filter((p) => FACILITY_TYPES[p.type].category === 'core')).toHaveLength(1);
  });

  it('没有两个设施重叠在一起（布点不打架）', () => {
    const state = createCityState();
    for (let i = 0; i < state.facilities.length; i += 1) {
      for (let j = i + 1; j < state.facilities.length; j += 1) {
        const a = state.facilities[i]!;
        const b = state.facilities[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.radius + b.radius);
      }
    }
  });

  it('全部设施都在航道之外，战舰不会开进建筑里', () => {
    for (const facility of createCityState().facilities) {
      expect(Math.abs(facility.x)).toBeGreaterThan(MAP.laneHalfWidth + facility.radius * 0.5);
    }
  });
});

describe('战舰运动', () => {
  it('前进时向 -Z 移动，且航向对准移动方向', () => {
    const ship = createShipState();
    const startZ = ship.z;
    for (let i = 0; i < 60; i += 1) stepShip(ship, { forward: 1, strafe: 0 }, 1 / 60);
    expect(ship.z).toBeLessThan(startZ);
    expect(Math.abs(Math.abs(ship.yaw) - Math.PI)).toBeLessThan(0.2);
  });

  it('横向输入被航道夹紧，不会冲出江面', () => {
    const ship = createShipState();
    for (let i = 0; i < 600; i += 1) stepShip(ship, { forward: 0, strafe: 1 }, 1 / 60);
    expect(ship.x).toBeCloseTo(MAP.laneHalfWidth, 5);
    for (let i = 0; i < 600; i += 1) stepShip(ship, { forward: 0, strafe: -1 }, 1 / 60);
    expect(ship.x).toBeCloseTo(-MAP.laneHalfWidth, 5);
  });

  it('速度收敛到最大航速而不是无限加速', () => {
    const ship = createShipState();
    for (let i = 0; i < 300; i += 1) stepShip(ship, { forward: 1, strafe: 0 }, 1 / 60);
    expect(ship.speed).toBeCloseTo(SHIP.speed, 1);
  });

  it('一路向北也不会开出地图边界', () => {
    const ship = createShipState();
    for (let i = 0; i < 6000; i += 1) stepShip(ship, { forward: 1, strafe: 0 }, 1 / 60);
    const limit = MAP.size / 2 - SHIP.size[2] / 2;
    expect(ship.z).toBeGreaterThanOrEqual(-limit - 1e-6);
    expect(ship.z).toBeCloseTo(-limit, 3);
  });
});

describe('炮塔转向', () => {
  it('死区内不转动，避免抖动', () => {
    expect(steerTurret(0, WEAPON.turretDeadzone * 0.5, 1 / 60)).toBe(0);
  });

  it('跨 ±π 时走近路而不是绕一整圈', () => {
    const from = Math.PI - 0.05;
    const to = -Math.PI + 0.05;
    // 走近路只需 0.1 弧度，单步（0.314 弧度）内应直接贴到目标；
    // 若绕远路则要转过约 6.18 弧度，不可能一步到位。
    expect(steerTurret(from, to, 0.1)).toBeCloseTo(-Math.PI + 0.05, 6);
  });

  it('单步不会越过目标', () => {
    const next = steerTurret(0, 0.05, 1);
    expect(next).toBeCloseTo(0.05, 6);
  });
});

describe('伤害与军费结算', () => {
  it('未击毁不入账，击毁后按类型奖励入账一次', () => {
    const state = createCityState();
    const facility = state.facilities[0]!;
    const type = FACILITY_TYPES[facility.type];

    const first = applyDamage(state, facility, 10);
    expect(first).toEqual({ hit: true, destroyed: false, reward: 0 });
    expect(state.funds).toBe(0);

    const kill = applyDamage(state, facility, type.hp);
    expect(kill.destroyed).toBe(true);
    expect(kill.reward).toBe(type.reward);
    expect(state.funds).toBe(type.reward);
    expect(state.destroyedCount).toBe(1);

    // 重复命中已摧毁目标不再入账
    expect(applyDamage(state, facility, 999)).toEqual({ hit: false, destroyed: false, reward: 0 });
    expect(state.funds).toBe(type.reward);
  });

  it('耐久不会变成负数', () => {
    const state = createCityState();
    const facility = state.facilities[0]!;
    applyDamage(state, facility, 1e9);
    expect(facility.hp).toBe(0);
  });
});

describe('子弹线段与设施求交', () => {
  const target = { x: 0, z: 0, radius: 10, destroyed: false };

  it('线段穿过圆返回命中参数', () => {
    const t = segmentHitsFacility(0, -50, 0, 50, target);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });

  it('线段擦不到就返回 -1', () => {
    expect(segmentHitsFacility(0, -50, 0, -40, target)).toBe(-1);
    expect(segmentHitsFacility(30, -50, 30, 50, target)).toBe(-1);
  });

  it('已摧毁的目标不再拦截子弹', () => {
    expect(segmentHitsFacility(0, -50, 0, 50, { ...target, destroyed: true })).toBe(-1);
  });
});

describe('瞄准环的贴面高度', () => {
  const box = { x: -100, z: 0, radius: 20, height: 40, destroyed: false };

  it('空地/江面返回 0', () => {
    expect(surfaceHeightAt([box], 0, 0)).toBe(0);
    expect(surfaceHeightAt([box], -100 + 21, 0)).toBe(0);
  });

  it('压在楼上就返回楼顶高度，避免环被体块吞掉', () => {
    expect(surfaceHeightAt([box], -100, 0)).toBe(40);
  });

  it('楼被打掉后回到地面', () => {
    expect(surfaceHeightAt([{ ...box, destroyed: true }], -100, 0)).toBe(0);
  });

  it('多个体块重叠时取最高的那个', () => {
    const tall = { x: -100, z: 0, radius: 20, height: 64, destroyed: false };
    expect(surfaceHeightAt([box, tall], -100, 0)).toBe(64);
  });
});
